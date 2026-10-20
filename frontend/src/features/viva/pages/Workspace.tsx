import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Keyboard,
  LogOut,
  MessagesSquare,
  Mic,
  RotateCcw,
  Search,
  Send,
  SkipForward,
  Snail,
  Square,
  Volume2,
  X,
} from "../components/icons";
import { api, ApiError, label } from "../api/client";
import type { AudioMetrics, Auth, Report, Session, Topic } from "../api/types";
import { Busy, ErrorNotice, Modal } from "../components/components";
import { useSpeech, type SpokenCommand } from "../hooks/useSpeech";
import { Examiner } from "../components/Examiner";
import { MicCheck, VoiceWave } from "../components/voice";

/** Topics under their module (IT1010 first, then IT2070), other courses last. */
function groupTopics(topics: Topic[], query: string) {
  const q = query.trim().toLowerCase();
  const groups = new Map<string, Topic[]>();
  for (const t of topics) {
    const text = `${t.short_name ?? t.name} ${t.summary ?? t.description} ${t.code ?? ""} ${t.module ?? ""}`.toLowerCase();
    if (q && !text.includes(q)) continue;
    const group = t.code ? `${t.code} · ${t.module}` : "Other courses";
    groups.set(group, [...(groups.get(group) ?? []), t]);
  }
  return [...groups].sort(([a], [b]) => (a === "Other courses" ? 1 : b === "Other courses" ? -1 : a.localeCompare(b)));
}
import "../styles/student.css";

/** Students see a plain message when marking is busy; the answer stays in the box to resend. */
function studentMessage(error: unknown) {
  if (error instanceof ApiError && [429, 502, 503, 504].includes(error.status))
    return "We could not mark your answer just now because the marking service is busy. Your answer is still here: wait a few seconds, then press Submit again.";
  return (error as Error).message;
}

/**
 * The transcript without "um" and "uh", for the student to read and edit. The server still counts the
 * fillers from the original, which is sent as spoken_transcript. Same filler words as disfluency.py.
 */
function withoutFillers(text: string) {
  return text
    .replace(/\b(?:u+m+|u+h+|e+rm+|e+r+|h+m+|m{2,}|a+h{2,})\b[,.]?\s*/gi, "")
    .replace(/\s+([,.?!])/g, "$1")
    .replace(/([,.])(?:\s*,)+/g, "$1")
    .replace(/^[\s,.]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** What a student can say at any time; the service recognises them only when said on their own. */
const COMMANDS = [
  ["I don't understand the question", "simpler words"],
  ["Skip this question", "next question"],
  ["Stop the viva", "finish"],
] as const;

function Commands() {
  return (
    <div className="st-commands" aria-label="Words you can say at any time">
      <span className="st-commands-head">
        <Mic size={14} /> You can say
      </span>
      {COMMANDS.map(([say, does]) => (
        <span className="st-command" key={say} title={`Say it, then submit: ${does}`}>
          <q>{say}</q>
          <small>{does}</small>
        </span>
      ))}
    </div>
  );
}

export default function Workspace({
  auth,
  topics: allTopics,
  session,
  setSession,
  onReport,
  onError,
}: {
  auth: Auth;
  topics: Topic[];
  session: Session | null;
  setSession: (s: Session | null) => void;
  onReport: (r: Report) => void;
  onError: (s: string) => void;
}) {
  // Students only see topics they can start: a topic needs at least one approved question.
  const topics = useMemo(() => allTopics.filter((t) => t.question_count > 0), [allTopics]);
  const [topicId, setTopicId] = useState(() => groupTopics(topics, "")[0]?.[1][0]?.id || ""),
    [mode, setMode] = useState<"text" | "speech">("speech"),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(false),
    // C1 mastery and C2 load are simulated here until those components are connected.
    [load, setLoad] = useState<"low" | "moderate" | "high">("moderate"),
    [mastery, setMastery] = useState<"below_50" | "above_50">("above_50"),
    [askRevise, setAskRevise] = useState(false);
  // Only the practice code P00 sees the simulation (the server checks it too).
  const practice = auth.user.participant_code.toUpperCase().replace(/O/g, "0") === "P00";
  // The native dialog dims the page behind it, traps focus and closes on Escape.
  const reviseRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = reviseRef.current;
    if (askRevise && d && !d.open) d.showModal();
    if (!askRevise && d?.open) d.close();
  }, [askRevise]);
  useEffect(() => {
    if (!topicId && topics.length) setTopicId(groupTopics(topics, "")[0]![1][0]!.id);
  }, [topics, topicId]);
  async function start(confirmed = false) {
    if (practice && mastery === "below_50" && !confirmed) {
      setAskRevise(true);
      return;
    }
    setAskRevise(false);
    setLoading(true);
    try {
      setSession(
        await api<Session>("/sessions", auth.token, {
          topic_id: topicId,
          input_mode: mode,
          max_depth: 2,
          ...(practice && { simulated_load: load, simulated_mastery: mastery }),
        }),
      );
    } catch (e) {
      onError(studentMessage(e));
    } finally {
      setLoading(false);
    }
  }
  if (session)
    return (
      <LiveSession
        key={session.id}
        auth={auth}
        session={session}
        setSession={setSession}
        onReport={onReport}
        onError={onError}
      />
    );
  const selected = topics.find((t) => t.id === topicId);
  return (
    <div className="st st-fill st-start">
      <section className="st-card st-topics">
        <header className="st-card-head">
          <div>
            <div className="st-eyebrow">Hi {auth.user.participant_code} · Step 1</div>
            <h2>Choose a topic</h2>
          </div>
          {topics.length > 4 && (
            <label className="st-search">
              <Search size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search topics"
                aria-label="Search topics"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )}
        </header>
        <div className="st-topic-scroll" role="group" aria-label="Topic">
          {topics.length ? (
            groupTopics(topics, query).map(([group, items]) => (
              <div className="st-topic-group" key={group}>
                <div className="st-topic-group-head">
                  <span>{group}</span>
                  <small>
                    {items.length} {items.length === 1 ? "topic" : "topics"}
                  </small>
                </div>
                <div className="st-topic-grid">
                  {items.map((t) => (
                    <button key={t.id} type="button" className="st-topic" aria-pressed={topicId === t.id} onClick={() => setTopicId(t.id)}>
                      <span className="st-icon">
                        <BookOpen size={18} />
                      </span>
                      <span className="st-topic-text">
                        <strong>{t.short_name ?? t.name}</strong>
                        <span className="st-muted st-small">{t.summary ?? t.description}</span>
                      </span>
                      <span className="st-topic-count">
                        {t.question_count} {t.question_count === 1 ? "question" : "questions"}
                      </span>
                      {topicId === t.id && <CheckCircle2 className="st-topic-check" size={18} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="st-muted">No topics are open yet. Please check back later.</p>
          )}
          {topics.length > 0 && !groupTopics(topics, query).length && <p className="st-muted st-small">No topics match "{query}".</p>}
        </div>
      </section>

      <aside className="st-card st-plan-card">
        <div className="st-plan-head">
          <Examiner state="idle" view="head" follow className="ex-round" />
          <div>
            <div className="st-eyebrow">Your viva</div>
            <h2>{selected ? (selected.short_name ?? selected.name) : "Pick a topic"}</h2>
            {selected && (
              <p className="st-muted st-small">
                {selected.code ? `${selected.code} · ` : ""}
                {selected.question_count} {selected.question_count === 1 ? "question" : "questions"} · about 5–10 minutes
              </p>
            )}
          </div>
        </div>
        <div>
          <div className="st-label">Step 2 · How will you answer?</div>
          <div className="st-segment" role="group" aria-label="Answer mode">
            <button type="button" aria-pressed={mode === "speech"} onClick={() => setMode("speech")}>
              <Mic size={17} /> Speak
            </button>
            <button type="button" aria-pressed={mode === "text"} onClick={() => setMode("text")}>
              <Keyboard size={17} /> Type
            </button>
          </div>
          <p className="st-muted st-small st-segment-note">
            {mode === "speech" ? "Recommended. Each question is read aloud and you answer with your microphone." : "For when you cannot use a microphone."}
          </p>
        </div>
        {practice && (
        <div className="st-sim">
          <div className="st-label">AdaptLearn context · simulated</div>
          <div className="st-sim-row">
            <span className="st-small">Cognitive load (C2)</span>
            <div className="st-segment st-segment-sm" role="group" aria-label="Simulated cognitive load">
              {(["low", "moderate", "high"] as const).map((v) => (
                <button key={v} type="button" aria-pressed={load === v} onClick={() => setLoad(v)}>
                  {v[0]!.toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="st-sim-row">
            <span className="st-small">Topic mastery (C1)</span>
            <div className="st-segment st-segment-sm" role="group" aria-label="Simulated topic mastery">
              <button type="button" aria-pressed={mastery === "below_50"} onClick={() => setMastery("below_50")}>
                Below 50%
              </button>
              <button type="button" aria-pressed={mastery === "above_50"} onClick={() => setMastery("above_50")}>
                50% or above
              </button>
            </div>
          </div>
          <p className="st-muted st-small">
            {load === "high"
              ? "High load: a shorter, easier viva with at most 2 questions and 1 follow-up each. Take your time."
              : "Normal viva."}{" "}
            C1 and C2 are not connected yet, so these values are chosen here.
          </p>
        </div>
        )}
        <div>
          <div className="st-label">Before you start</div>
          <ul className="st-checklist">
            <li>
              <Check size={15} strokeWidth={3} /> A quiet room, with no one else talking
            </li>
            {mode === "speech" && (
              <li>
                <Check size={15} strokeWidth={3} /> Allow the microphone when the browser asks
              </li>
            )}
            <li>
              <Check size={15} strokeWidth={3} /> Headphones, if you have them
            </li>
            <li>
              <Check size={15} strokeWidth={3} /> About 10 minutes without interruptions
            </li>
          </ul>
        </div>
        {practice && (
          <dialog ref={reviseRef} className="st-modal" aria-labelledby="revise-title" onClose={() => setAskRevise(false)}>
            <button type="button" className="st-modal-close" aria-label="Close" onClick={() => setAskRevise(false)}>
              <X size={18} />
            </button>
            <h3 id="revise-title">Your mastery for this topic is below 50%</h3>
            <p className="st-small st-muted">Revising the topic first may help. You can still start the viva now.</p>
            <div className="st-row st-modal-actions">
              <button type="button" className="st-btn st-btn-ghost st-btn-sm" onClick={() => setAskRevise(false)}>
                Revise first
              </button>
              <button type="button" className="st-btn st-btn-primary st-btn-sm" onClick={() => start(true)}>
                Start anyway
              </button>
            </div>
          </dialog>
        )}
        <button className="st-btn st-btn-primary st-block" onClick={() => start()} disabled={loading || !topicId}>
          {loading ? (
            <Busy text="Starting…" />
          ) : (
            <>
              Start viva <ArrowRight size={18} />
            </>
          )}
        </button>
      </aside>
    </div>
  );
}

function LiveSession({
  auth,
  session,
  setSession,
  onReport,
  onError,
}: {
  auth: Auth;
  session: Session;
  setSession: (s: Session | null) => void;
  onReport: (r: Report) => void;
  onError: (s: string) => void;
}) {
  const [answer, setAnswer] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState<"text" | "speech">(session.input_mode),
    [audioEvidence, setAudioEvidence] = useState<{ metrics: AudioMetrics; latency: number | null; provider: string; text: string; command: SpokenCommand } | null>(null),
    [autoRead, setAutoRead] = useState(true),
    [finishConfirm, setFinishConfirm] = useState(false),
    [nodding, setNodding] = useState(false),
    [slow, setSlow] = useState(false),
    [showTurns, setShowTurns] = useState(false),
    [ready, setReady] = useState(session.turns.length > 0);
  const speech = useSpeech(
    auth.token,
    (text, metrics, latency, provider, _heard, command) => {
      setAnswer(withoutFillers(text));
      setAudioEvidence({ metrics, latency, provider, text, command });
    },
    session.topic_id,
  );
  const q = session.current_question;
  const submission = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    setAnswer("");
    setAudioEvidence(null);
    speech.reset();
    if (autoRead && q && ready) speech.speak(q.question);
  }, [q?.id, ready]);
  async function skip() {
    if (!q) return;
    setBusy(true);
    speech.stopSpeaking();
    try {
      const result = await api<{ session: Session }>(`/sessions/${session.id}/answers`, auth.token, {
        question_id: q.id, transcript: "", input_mode: mode, skip: true, request_id: crypto.randomUUID(),
      });
      setSession(result.session);
      if (result.session.status === "completed")
        onReport(result.session.report || (await api<Report>(`/sessions/${session.id}/report`, auth.token)));
    } catch (e) {
      onError(studentMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!q || !answer.trim()) return;
    const key = JSON.stringify([q.id, answer.trim(), audioEvidence?.metrics, audioEvidence?.latency]);
    if (submission.current?.key !== key) submission.current = { key, id: crypto.randomUUID() };
    setBusy(true);
    speech.stopSpeaking();
    const slowTimer = setTimeout(() => setSlow(true), 12000);
    try {
      const result = await api<{ session: Session }>(`/sessions/${session.id}/answers`, auth.token, {
        question_id: q.id,
        transcript: answer.trim(),
        spoken_transcript: audioEvidence?.text ?? null,
        input_mode: audioEvidence ? "speech" : "text",
        response_latency_ms: audioEvidence?.latency ?? null,
        audio_metrics: audioEvidence?.metrics ?? null,
        request_id: submission.current.id,
      });
      setSession(result.session);
      setNodding(true);
      setTimeout(() => setNodding(false), 1700);
      if (result.session.status === "completed")
        onReport(result.session.report || (await api<Report>(`/sessions/${session.id}/report`, auth.token)));
    } catch (e) {
      onError(studentMessage(e));
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
      setBusy(false);
    }
  }
  async function finish() {
    setBusy(true);
    speech.stopSpeaking();
    try {
      const report = await api<Report>(`/sessions/${session.id}/finish`, auth.token, {});
      setSession(null);
      onReport(report);
    } catch (e) {
      onError(studentMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || speech.recording || speech.transcribing;
  // Keyboard: Space starts or stops recording (outside text fields and buttons);
  // Ctrl+Enter or Cmd+Enter submits the answer, also from inside the answer box.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        if (q && ready && !locked && answer.trim()) {
          e.preventDefault();
          void submit();
        }
        return;
      }
      const target = e.target as HTMLElement | null;
      if (e.key !== " " || e.repeat || target?.closest("input, textarea, select, button, a, [contenteditable='true'], [role='button']")) return;
      if (!q || !ready || mode !== "speech" || busy || speech.starting || speech.transcribing) return;
      e.preventDefault();
      if (speech.recording) speech.stop();
      else void speech.start();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const mascot = busy || speech.transcribing ? "thinking" : speech.recording ? "listening" : nodding ? "nodding" : speech.speaking ? "speaking" : "idle";
  const status = busy
    ? slow
      ? "Still marking your answer. This is taking longer than usual…"
      : "Thinking about your answer…"
    : speech.transcribing
      ? "Turning your recording into text…"
      : speech.recording
        ? `Listening · ${speech.seconds}s. Tap the button when you finish`
        : nodding
          ? q?.depth
            ? "Thank you. Here is a follow-up question."
            : "Thank you. Here is the next question."
          : speech.speaking
          ? "Reading the question…"
          : speech.starting
            ? "Opening microphone…"
            : mode === "speech" && !answer
              ? "Take your time. Tap the microphone when you are ready"
              : "";
  const heardCommand = audioEvidence?.command && answer.trim() === audioEvidence.text.trim() ? audioEvidence.command : null;
  const { completed_concepts: done, total_concepts: total } = session.progress;
  const answered = session.turns.filter((t) => !t.depth).map((t) => t.concept);
  // A concept counts as skipped when every turn on it was skipped.
  const skipped = new Set(
    answered.filter((c) => session.turns.filter((t) => t.concept === c).every((t) => t.transcript === "[skipped by student]")),
  );
  const modeSwitch = (
    <button
      className="st-link"
      disabled={locked}
      onClick={() => {
        if (mode === "speech") {
          setMode("text");
          setAudioEvidence(null);
        } else setMode("speech");
      }}
    >
      {mode === "speech" ? "Type instead" : "Use microphone instead"}
    </button>
  );
  return (
    <div className="st st-fill st-session">
      <aside className="st-card st-rail">
        <div className="st-rail-head">
          <div className="st-eyebrow">Live viva</div>
          <h2>{session.topic}</h2>
          <p className="st-small st-muted">
            Question {Math.min(q?.ordinal || done, total)} of {total}
          </p>
        </div>
        <ol className="st-rail-steps">
          {Array.from({ length: total }, (_, i) => {
            const state = i < done ? "done" : i === done && q ? "current" : "todo";
            return (
              <li key={i} className={`is-${state}`} aria-current={state === "current" ? "step" : undefined}>
                <span className="st-rail-dot">{state === "done" ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
                <span className="st-rail-text">
                  <strong>{state === "done" ? answered[i] || `Question ${i + 1}` : state === "current" ? q!.concept : `Question ${i + 1}`}</strong>
                  {state === "current" && <small>{q!.depth ? `Follow-up ${q!.depth} of ${session.max_depth}` : "Main question"}</small>}
                  {state === "done" && <small>{skipped.has(answered[i] ?? "") ? "Skipped" : "Answered"}</small>}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="st-rail-foot">
          {session.turns.length > 0 && (
            <button className="st-btn st-btn-ghost st-block" onClick={() => setShowTurns(true)}>
              <MessagesSquare size={16} /> Previous answers ({session.turns.length})
            </button>
          )}
          {finishConfirm ? (
            <div className="st-confirm">
              <p className="st-small">End now? Questions you have not answered will not count.</p>
              <div className="st-row">
                <button className="st-btn st-btn-ghost" onClick={() => setFinishConfirm(false)}>
                  Keep going
                </button>
                <button className="st-btn st-btn-danger" disabled={busy} onClick={finish}>
                  Finish now
                </button>
              </div>
            </div>
          ) : (
            <div className="st-rail-actions">
              <button className="st-btn st-btn-ghost" disabled={locked} onClick={() => setSession(null)}>
                <LogOut size={15} /> Save &amp; leave
              </button>
              <button className="st-btn st-btn-ghost" disabled={locked} onClick={() => setFinishConfirm(true)}>
                Finish
              </button>
            </div>
          )}
        </div>
      </aside>

      <section className="st-card st-viva" aria-live="polite">
        {q && !ready ? (
          <div className="st-viva-ready">
            <Examiner state="idle" voice={speech.voiceEvents} />
            <h2>Ready when you are.</h2>
            <p className="st-muted">
              Your examiner will ask each question out loud. Find a quiet place, then allow microphone access when asked. During the viva
              you can also say these on their own:
            </p>
            <Commands />
            {mode === "speech" && <MicCheck />}
            <button
              className="st-btn st-btn-primary"
              onClick={() => {
                speech.prime();
                setReady(true);
              }}
            >
              Start the viva <ArrowRight size={18} />
            </button>
          </div>
        ) : q ? (
          <>
            <div className="st-viva-q">
              <Examiner state={mascot} voice={speech.voiceEvents} />
              <div className="st-viva-qtext">
                <div className="st-row" style={{ gap: 8 }}>
                  <span className="st-chip st-chip-accent">{q.depth ? "Follow-up question" : "Main question"}</span>
                  <span className="st-chip">{q.concept}</span>
                </div>
                <p className="st-question" key={q.id}>
                  {q.question}
                </p>
                <div className="st-row st-q-tools">
                  <button
                    className="st-btn st-btn-ghost st-btn-sm"
                    disabled={speech.recording}
                    onClick={() => (speech.speaking ? speech.stopSpeaking() : speech.speak(q.question))}
                  >
                    {speech.speaking ? (
                      <>
                        <Square size={14} /> Stop
                      </>
                    ) : (
                      <>
                        <Volume2 size={15} /> Listen again
                      </>
                    )}
                  </button>
                  <button
                    className="st-btn st-btn-ghost st-btn-sm"
                    disabled={speech.recording}
                    title="Hear the question again, more slowly"
                    onClick={() => speech.speak(q.question, 0.8)}
                  >
                    <Snail size={15} /> Slower
                  </button>
                  <label className="st-small st-muted st-row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={autoRead}
                      onChange={(e) => {
                        setAutoRead(e.target.checked);
                        if (!e.target.checked) speech.stopSpeaking();
                      }}
                    />
                    Read questions aloud
                  </label>
                </div>
              </div>
            </div>

            <div className="st-viva-a">
              <div className="st-a-head">
                <div className="st-eyebrow">Your answer</div>
                <Commands />
              </div>
              {mode === "speech" && (
                <div className={`st-recorder ${speech.recording ? "is-recording" : ""}`}>
                  <button
                    className={`st-mic ${speech.recording ? "is-recording" : ""}`}
                    aria-label={speech.recording ? "Stop recording" : "Start recording your answer"}
                    title="Space starts or stops recording. Ctrl + Enter submits."
                    disabled={busy || speech.starting || speech.transcribing}
                    onClick={speech.recording ? speech.stop : speech.start}
                  >
                    {speech.recording ? <Square size={24} /> : <Mic size={26} />}
                  </button>
                  <div className="st-recorder-body">
                    <p className="st-status">{status || "Ready"}</p>
                    {speech.recording ? (
                      <VoiceWave className="st-mic-wave" source={() => speech.meters.current.mic} active />
                    ) : (
                      speech.hasRecording &&
                      !speech.transcribing && (
                        <button className="st-link" disabled={speech.starting} onClick={speech.retry}>
                          <RotateCcw size={14} /> Retry transcription
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
              {mode === "text" && status && <p className="st-status">{status}</p>}
              {speech.recording && speech.liveProvider && (
                <div className="st-live">
                  <div className="st-label">Live transcript</div>
                  <p>{speech.liveText || "Listening…"}</p>
                </div>
              )}
              <ErrorNotice message={speech.speechError} />
              {heardCommand && (
                <p className="st-command-heard" role="status">
                  <Mic size={16} />
                  <span>
                    Heard <q>{heardCommand === "stop" ? "Stop the viva" : "Skip this question"}</q>. Press{" "}
                    <strong>{heardCommand === "stop" ? "Finish viva" : "Skip question"}</strong>, or edit the words if you meant something else.
                  </span>
                </p>
              )}
              {mode === "text" || answer || audioEvidence ? (
                <>
                  {!heardCommand && (
                    <label htmlFor="answer" className="st-label">
                      {audioEvidence ? "Check the words, and fix anything we misheard" : "Type your answer"}
                    </label>
                  )}
                  <textarea
                    id="answer"
                    className="st-answer-box"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Explain in your own words. An example can help…"
                    maxLength={10000}
                    disabled={locked}
                  />
                </>
              ) : (
                <div className="st-answer-empty">
                  <Mic size={20} />
                  <span>Your words appear here after you record. You can check and fix them before you submit.</span>
                </div>
              )}
              <div className="st-a-foot">
                <div className="st-row">
                  <button className="st-btn st-btn-ghost st-btn-sm" disabled={locked} onClick={skip}>
                    <SkipForward size={15} /> Skip
                  </button>
                  {modeSwitch}
                </div>
                <button className="st-btn st-btn-primary" disabled={locked || !answer.trim()} onClick={submit}>
                  {busy ? (
                    <Busy text="Thinking…" />
                  ) : heardCommand === "stop" ? (
                    "Finish viva"
                  ) : heardCommand === "skip" ? (
                    "Skip question"
                  ) : (
                    <>
                      Submit answer <Send size={16} />
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="st-viva-ready">
            <h2>Viva complete.</h2>
            <p className="st-muted">Your report is ready.</p>
          </div>
        )}
      </section>

      {showTurns && (
        <Modal title="Previous answers" onClose={() => setShowTurns(false)}>
          <div className="st st-history">
            {session.turns.map((t) => (
              <div className="st-turn" key={t.id}>
                <div className="st-row st-between">
                  <strong className="st-small">
                    {t.concept} · {t.depth ? "Follow-up" : "Main question"}
                  </strong>
                  <span className="st-chip">{label(t.state)}</span>
                </div>
                <p>{t.question}</p>
                <blockquote>{t.transcript ? `“${t.transcript}”` : "Skipped"}</blockquote>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
