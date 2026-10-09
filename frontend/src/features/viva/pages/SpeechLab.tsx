import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { AudioLines, Download, FileAudio, Info, UploadCloud, X } from "lucide-react";
import { api, downloadJson } from "../api/client";
import type { Auth, LabResult } from "../api/types";
import { PageTitle } from "../components/components";
import { CountUp, Meter, Timeline } from "../components/charts";
import "../styles/dashboard.css";

const ACCEPT = ".m4a,.mp3,.wav,.webm,.mp4,.ogg,.flac,audio/*";
const CORE: Record<string, { name: string; unit: string; decimals: number; why: string }> = {
  speech_rate_syll_s: { name: "Speech rate", unit: "syllables/s", decimals: 2, why: "Speed, pauses included" },
  articulation_rate_syll_s: { name: "Articulation rate", unit: "syllables/s", decimals: 2, why: "Speed while actually speaking" },
  mean_length_of_run_syll: { name: "Mean length of run", unit: "syllables", decimals: 1, why: "Syllables between pauses" },
  mean_silent_pause_ms: { name: "Mean silent pause", unit: "ms", decimals: 0, why: "Average pause of 0.25 s or more" },
};
const MORE: [keyof LabResult["session"], string, string, number][] = [
  ["silent_pauses_per_min", "Silent pauses", "per min", 1],
  ["long_pauses_per_min", "Pauses of 2 s or more", "per min", 1],
  ["filled_pauses_per_min", "Filled pauses", "per min", 1],
  ["filled_pauses_per_100_words", "Filled pauses", "per 100 words", 1],
  ["mid_clause_pause_share", "Pauses inside sentences", "share", 2],
  ["response_latency_s", "Response latency", "s", 1],
  ["phonation_time_ratio", "Phonation time ratio", "share", 2],
  ["speaking_time_s", "Speaking time", "s", 0],
];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Admin tool: analyse one recorded viva with the research measures and thresholds. */
export default function SpeechLab({ auth, onError }: { auth: Auth; onError: (s: string) => void }) {
  const [student, setStudent] = useState<File | null>(null),
    [examiner, setExaminer] = useState<File | null>(null),
    [transcriber, setTranscriber] = useState("auto"),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<LabResult | null>(null);
  async function analyse() {
    if (!student) return;
    setBusy(true);
    setResult(null);
    const form = new FormData();
    form.append("audio", student);
    if (examiner) form.append("examiner", examiner);
    form.append("transcriber", transcriber);
    try {
      setResult(await api<LabResult>("/lab/analyse", auth.token, form, "POST", AbortSignal.timeout(300000)));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dash">
      <PageTitle
        eyebrow="SPEECH LAB · ADMIN"
        title="Analyse a recording"
        description="Measure pauses, speed and fillers in a recorded viva and compare them with the literature thresholds. Audio is analysed in memory and never stored."
      />
      <section className="panel lab-upload">
        <div className="lab-drops">
          <DropZone label="Student recording" hint="Required. The student's voice, for example P03_student.m4a" file={student} onFile={setStudent} />
          <DropZone label="Examiner recording" hint="Optional. Your voice from the same call; splits the viva per question" file={examiner} onFile={setExaminer} />
        </div>
        <div className="lab-controls">
          <label className="field-inline">
            Transcription
            <select value={transcriber} onChange={(e) => setTranscriber(e.target.value)}>
              <option value="auto">Automatic (Groq when configured)</option>
              <option value="groq">Groq: adds fillers and pause positions</option>
              <option value="none">Sound only: private, no words</option>
            </select>
          </label>
          <button className="button primary" disabled={!student || busy} onClick={analyse}>
            <AudioLines size={16} />
            {busy ? "Analysing… up to a minute" : "Analyse recording"}
          </button>
        </div>
        {busy && <div className="lab-progress" aria-hidden="true"><span /></div>}
      </section>
      {result && <LabResults result={result} />}
    </div>
  );
}

function DropZone({ label, hint, file, onFile }: { label: string; hint: string; file: File | null; onFile: (f: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  function drop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  }
  return (
    <div
      className={`lab-drop ${over ? "is-over" : ""} ${file ? "has-file" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      role="button"
      tabIndex={0}
      aria-label={`${label}: ${file ? file.name : "choose a file"}`}
    >
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {file ? <FileAudio size={26} /> : <UploadCloud size={26} />}
      <strong>{label}</strong>
      <span className="small muted">{file ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MB` : hint}</span>
      {file && (
        <button
          className="icon-button lab-clear"
          aria-label={`Remove ${label.toLowerCase()}`}
          onClick={(e) => {
            e.stopPropagation();
            onFile(null);
            if (input.current) input.current.value = "";
          }}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}

function LabResults({ result }: { result: LabResult }) {
  const s = result.session;
  const rules = Object.fromEntries(result.profile.rules.map((r) => [r.measure, r]));
  const flagged = new Set(s.flagged_measures ? s.flagged_measures.split(" ") : []);
  const rate = rules.speech_rate_syll_s;
  return (
    <div className="lab-results">
      <section className={`lab-verdict ${s.literature_flagged ? "is-flagged" : ""}`}>
        <div>
          <span className="eyebrow">LITERATURE PROFILE · {result.profile.name}</span>
          <h2>
            {s.literature_flagged == null
              ? "Not enough speech to measure"
              : s.literature_flagged
                ? "Matches the communication-difficulty pattern"
                : "Within the typical range"}
          </h2>
          <p className="small">
            {s.literature_flags} of {result.profile.rules.length} core measures are beyond the published thresholds; {result.profile.min_flags} or more
            match the pattern. Provisional: the thresholds come from intermediate L2 English monologues, not technical vivas.
          </p>
        </div>
        <div className="lab-chips">
          <span>{clock(result.duration_s)} recording</span>
          <span>{s.answers} {s.answers === 1 ? "answer" : "answers"}</span>
          <span>Words: {result.transcript_source === "none" ? "none" : result.transcript_source}</span>
          <span>Syllables: {result.syllable_source}</span>
        </div>
      </section>

      <section className="lab-core">
        {Object.entries(CORE).map(([key, info]) => {
          const value = s[key as keyof typeof s] as number | null | undefined;
          const rule = rules[key];
          return (
            <article className={`kpi lab-measure ${flagged.has(key) ? "is-flagged" : ""}`} key={key}>
              <span>{info.name}</span>
              <strong>{value == null ? "n/a" : <CountUp value={value} decimals={info.decimals} />}<small> {info.unit}</small></strong>
              {rule && <Meter value={value} threshold={rule.threshold} direction={rule.direction} />}
              <small>
                {rule ? `Flag when ${rule.direction} ${rule.threshold}` : ""} · {info.why}
              </small>
            </article>
          );
        })}
      </section>

      <section className="panel dash-card">
        <header>
          <h2>Other measures</h2>
          <span className="small muted">Exploratory: reported, not used by the rule</span>
        </header>
        <div className="lab-more">
          {MORE.map(([key, name, unit, decimals]) => {
            const value = s[key] as number | null | undefined;
            return (
              <div key={`${key}-${unit}`}>
                <span>{name}</span>
                <strong>{value == null ? "n/a" : Number(value).toFixed(decimals)}</strong>
                <small>{unit}</small>
              </div>
            );
          })}
        </div>
      </section>

      {result.windows.length > 0 && (
        <section className="panel dash-card">
          <header>
            <h2>Timeline</h2>
            <span className="small muted">Speech rate per 15-second window (orange: below the dashed threshold line). Strip below: pauses per window, darker means more.</span>
          </header>
          <Timeline
            windows={result.windows.map((w) => ({
              start: w.window_start_s,
              end: w.window_end_s,
              rate: w.speech_rate_syll_s ?? null,
              pauses: w.silent_pauses ?? 0,
              fillers: w.filled_pauses ?? 0,
            }))}
            threshold={rate?.threshold}
          />
        </section>
      )}

      {result.answers.length > 1 && (
        <section className="panel dash-card">
          <header>
            <h2>Per answer</h2>
            <span className="small muted">Split by the examiner's questions</span>
          </header>
          <div className="table-scroll">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>Answer</th>
                  <th>From</th>
                  <th>Latency</th>
                  <th>Speech rate</th>
                  <th>Run length</th>
                  <th>Mean pause</th>
                  <th>Pauses/min</th>
                  <th>Fillers/min</th>
                </tr>
              </thead>
              <tbody>
                {result.answers.map((a) => (
                  <tr key={a.answer}>
                    <td>{a.answer}</td>
                    <td>{clock(a.start_s)}</td>
                    <td>{a.response_latency_s == null ? "n/a" : `${a.response_latency_s.toFixed(1)} s`}</td>
                    <td>{a.speech_rate_syll_s == null ? "n/a" : a.speech_rate_syll_s.toFixed(2)}</td>
                    <td>{a.mean_length_of_run_syll == null ? "n/a" : a.mean_length_of_run_syll.toFixed(1)}</td>
                    <td>{a.mean_silent_pause_ms == null ? "n/a" : `${a.mean_silent_pause_ms} ms`}</td>
                    <td>{a.silent_pauses_per_min?.toFixed(1) ?? "n/a"}</td>
                    <td>{a.filled_pauses_per_min?.toFixed(1) ?? "n/a"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel dash-card">
        <header>
          <h2>What was said</h2>
          <span className="small muted">Fillers highlighted; pauses of 0.5 s or more shown where they happened</span>
        </header>
        {result.words.length ? <Transcript result={result} /> : <p className="muted small">No transcript for this analysis (sound-only mode or transcription unavailable).</p>}
      </section>

      {result.notes.length > 0 && (
        <div className="notice">
          <Info size={18} />
          <span>{result.notes.join(" ")}</span>
        </div>
      )}
      <button className="button secondary" onClick={() => downloadJson(result, `speech-lab-${result.file.replace(/\.[^.]+$/, "")}.json`)}>
        <Download size={16} />
        Download the full analysis (JSON)
      </button>
    </div>
  );
}

function Transcript({ result }: { result: LabResult }) {
  const pieces: ReactNode[] = [];
  let pause = 0;
  const pauses = result.pauses.filter((p) => p.ms >= 500);
  result.words.forEach((w, i) => {
    while (pause < pauses.length && pauses[pause]!.end <= w.start + 0.05) {
      const p = pauses[pause]!;
      if (i > 0) pieces.push(<span className="st-pause" key={`p${pause}`}>pause {(p.ms / 1000).toFixed(1)}s</span>);
      pause += 1;
    }
    const text = w.word.trim();
    pieces.push(
      w.filler ? (
        <span key={`w${i}`}>
          <mark className="st-filler">{text}</mark>{" "}
        </span>
      ) : (
        <span key={`w${i}`}>{text} </span>
      ),
    );
  });
  return <p className="lab-transcript">{pieces}</p>;
}
