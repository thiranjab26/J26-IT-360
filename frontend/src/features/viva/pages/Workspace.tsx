import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Keyboard,
  Mic,
  RotateCcw,
  Send,
  SkipForward,
  Volume2,
  Square,
} from "lucide-react";
import { api, label } from "../api/client";
import type { AudioMetrics, Auth, Context, Report, Session, Topic } from "../api/types";
import { Busy, ErrorNotice, Integrations, integrationLabel } from "../components/components";
import { useSpeech } from "../hooks/useSpeech";
import { Mascot } from "../components/Mascot";
import "../styles/student.css";

export default function Workspace({
  auth,
  topics,
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
  const [topicId, setTopicId] = useState(topics[0]?.id || ""),
    [context, setContext] = useState<Context | null>(null),
    [mode, setMode] = useState<"text" | "speech">("speech"),
    [loading, setLoading] = useState(false),
    [contextError, setContextError] = useState("");
  useEffect(() => {
    if (!topicId && topics.length) setTopicId(topics[0]!.id);
  }, [topics, topicId]);
  useEffect(() => {
    if (!topicId) return;
    let cancelled = false;
    setContext(null);
    setContextError("");
    api<Context>(`/integrations/context?topic_id=${topicId}`, auth.token)
      .then((c) => {
        if (!cancelled) setContext(c);
      })
      .catch((e) => {
        if (!cancelled) setContextError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [topicId, auth.token]);
  async function start() {
    setLoading(true);
    try {
      setSession(
        await api<Session>("/sessions", auth.token, {
          topic_id: topicId,
          input_mode: mode,
          max_depth: 2,
        }),
      );
    } catch (e) {
      onError((e as Error).message);
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
  return (
    <div className="st">
      <div className="st-hero">
        <div className="st-eyebrow">Intelligent viva</div>
        <h1>Explain what you know, out loud.</h1>
        <p className="st-muted">
          A short spoken conversation. Follow-up questions build on your own
          answers, and you get a clear report with next steps.
        </p>
      </div>

      <section className="st-card">
        <div className="st-label">1. Choose a topic</div>
        <div className="st-options" role="group" aria-label="Topic">
          {topics.length ? (
            topics.map((t) => (
              <button
                key={t.id}
                type="button"
                className="st-option"
                aria-pressed={topicId === t.id}
                onClick={() => setTopicId(t.id)}
              >
                <span className="st-icon">
                  <BookOpen size={19} />
                </span>
                <strong>{t.name}</strong>
                <span className="st-muted st-small">{t.description}</span>
                <span className="st-muted st-small">
                  {t.question_count} {t.question_count === 1 ? "concept" : "concepts"}
                </span>
              </button>
            ))
          ) : (
            <p className="st-muted">No topics are available yet.</p>
          )}
        </div>

        <div className="st-label" style={{ marginTop: 24 }}>
          2. How will you answer?
        </div>
        <div className="st-options" role="group" aria-label="Answer mode">
          <button
            type="button"
            className="st-option"
            aria-pressed={mode === "speech"}
            onClick={() => setMode("speech")}
          >
            <span className="st-icon">
              <Mic size={19} />
            </span>
            <strong>Speak (recommended)</strong>
            <span className="st-muted st-small">
              Questions are read aloud. You answer with your microphone.
            </span>
          </button>
          <button
            type="button"
            className="st-option"
            aria-pressed={mode === "text"}
            onClick={() => setMode("text")}
          >
            <span className="st-icon">
              <Keyboard size={19} />
            </span>
            <strong>Type</strong>
            <span className="st-muted st-small">
              Use this if you cannot use a microphone.
            </span>
          </button>
        </div>

        <div className="st-row st-between" style={{ marginTop: 24 }}>
          <span className="st-muted st-small">
            About 5–10 minutes · up to 2 follow-ups per concept
          </span>
          <button className="st-btn st-btn-primary" onClick={start} disabled={loading || !topicId}>
            {loading ? (
              <Busy text="Starting…" />
            ) : (
              <>
                Start viva <ArrowRight size={18} />
              </>
            )}
          </button>
        </div>
      </section>

      <section className="st-card st-steps">
        <div>
          <span>1</span>
          <p>
            <strong>Hear the question</strong>
            <br />
            <span className="st-muted st-small">Your viva guide asks each question out loud. It also stays on screen, and you can replay it.</span>
          </p>
        </div>
        <div>
          <span>2</span>
          <p>
            <strong>Answer in your own words</strong>
            <br />
            <span className="st-muted st-small">Tap the microphone and explain in your own words. Check the transcript, then submit.</span>
          </p>
        </div>
        <div>
          <span>3</span>
          <p>
            <strong>Get your report</strong>
            <br />
            <span className="st-muted st-small">See what you explained well, what to revisit, and a plan to improve.</span>
          </p>
        </div>
      </section>

      <details className="st-card">
        <summary>Learning context from AdaptLearn · {integrationLabel(context)}</summary>
        <div style={{ marginTop: 14 }}>
          <ErrorNotice message={contextError} />
          <Integrations context={context} />
        </div>
      </details>
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
    [audioEvidence, setAudioEvidence] = useState<{ metrics: AudioMetrics; latency: number | null } | null>(null),
    [autoRead, setAutoRead] = useState(true),
    [finishConfirm, setFinishConfirm] = useState(false),
    [nodding, setNodding] = useState(false),
    [ready, setReady] = useState(session.turns.length > 0);
  const speech = useSpeech(auth.token, (text, metrics, latency) => {
    setAnswer(text);
    setAudioEvidence({ metrics, latency });
  });
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
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!q || !answer.trim()) return;
    const key = JSON.stringify([q.id, answer.trim(), audioEvidence]);
    if (submission.current?.key !== key) submission.current = { key, id: crypto.randomUUID() };
    setBusy(true);
    speech.stopSpeaking();
    try {
      const result = await api<{ session: Session }>(`/sessions/${session.id}/answers`, auth.token, {
        question_id: q.id,
        transcript: answer.trim(),
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
      onError((e as Error).message);
    } finally {
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
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || speech.recording || speech.transcribing;
  const mascot = busy || speech.transcribing ? "thinking" : speech.recording ? "listening" : nodding ? "nodding" : speech.speaking ? "speaking" : "idle";
  const status = busy
    ? "Thinking about your answer…"
    : speech.transcribing
      ? "Turning your recording into text…"
      : speech.recording
        ? `Listening · ${speech.seconds}s. Tap the button when you finish`
        : speech.speaking
          ? "Reading the question…"
          : speech.starting
            ? "Opening microphone…"
            : mode === "speech" && !answer
              ? "Tap the microphone and answer when ready"
              : "";
  const progress = (session.progress.completed_concepts / Math.max(1, session.progress.total_concepts)) * 100;
  return (
    <div className="st">
      <div className="st-topbar">
        <div>
          <div className="st-eyebrow">Live viva</div>
          <h2>{session.topic}</h2>
        </div>
        {finishConfirm ? (
          <div className="st-row">
            <span className="st-small st-muted">End now? Unanswered concepts count as insufficient evidence.</span>
            <button className="st-btn st-btn-ghost" onClick={() => setFinishConfirm(false)}>
              Keep going
            </button>
            <button className="st-btn st-btn-danger" disabled={busy} onClick={finish}>
              Finish now
            </button>
          </div>
        ) : (
          <div className="st-row">
            <button className="st-btn st-btn-ghost" disabled={locked} onClick={() => setSession(null)}>
              Save &amp; leave
            </button>
            <button className="st-btn st-btn-ghost" disabled={locked} onClick={() => setFinishConfirm(true)}>
              Finish session
            </button>
          </div>
        )}
      </div>

      <div className="st-row st-between">
        <div className="st-row">
          <span className="st-chip st-chip-accent">
            Concept {q?.ordinal || session.progress.completed_concepts} of {session.progress.total_concepts}
          </span>
          {q && <span className="st-chip">{q.depth ? `Follow-up ${q.depth} of ${session.max_depth}` : "Main question"}</span>}
        </div>
        {q && <span className="st-chip">{q.concept}</span>}
      </div>
      <div className="st-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>

      {q && !ready ? (
        <section className="st-card st-stage">
          <Mascot state="idle" />
          <p className="st-question">Ready when you are.</p>
          <p className="st-muted" style={{ maxWidth: 520 }}>
            Your viva guide will ask each question out loud. Find a quiet place, then allow microphone access when asked.
            You can skip a question, or say "stop the session" at any time.
          </p>
          <button className="st-btn st-btn-primary" onClick={() => setReady(true)}>
            Start the viva
          </button>
        </section>
      ) : q ? (
        <section className="st-card st-stage" aria-live="polite">
          <Mascot state={mascot} />
          <p className="st-question">{q.question}</p>
          <div className="st-row" style={{ justifyContent: "center" }}>
            <button
              className="st-btn st-btn-ghost"
              disabled={speech.recording}
              onClick={() => (speech.speaking ? speech.stopSpeaking() : speech.speak(q.question))}
            >
              {speech.speaking ? <><Square size={15} /> Stop</> : <><Volume2 size={16} /> Listen again</>}
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

          {mode === "speech" && (
            <>
              <button
                className={`st-mic ${speech.recording ? "is-recording" : ""}`}
                aria-label={speech.recording ? "Stop recording" : "Start recording your answer"}
                disabled={busy || speech.starting || speech.transcribing}
                onClick={speech.recording ? speech.stop : speech.start}
              >
                {speech.recording ? <Square size={28} /> : <Mic size={30} />}
              </button>
              {speech.hasRecording && !speech.transcribing && (
                <button className="st-btn st-btn-ghost" disabled={speech.starting || speech.recording} onClick={speech.retry}>
                  <RotateCcw size={16} /> Retry transcription
                </button>
              )}
            </>
          )}
          <p className="st-status">{status}</p>
          <ErrorNotice message={speech.speechError} />

          {(mode === "text" || answer || audioEvidence) && (
            <div className="st-answer">
              <label htmlFor="answer" className="st-label">
                {audioEvidence ? "Your answer (check the transcript and fix any mistakes)" : "Your answer"}
              </label>
              <textarea
                id="answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Explain in your own words. An example can help…"
                rows={5}
                maxLength={10000}
                disabled={locked}
              />
              <div className="st-row st-between">
                <span className="st-small st-muted">
                  {audioEvidence ? "Pauses and timing come from your recording." : "Typed answers have no timing data."}
                </span>
                <button className="st-btn st-btn-primary" disabled={locked || !answer.trim()} onClick={submit}>
                  {busy ? <Busy text="Thinking…" /> : <>Submit answer <Send size={16} /></>}
                </button>
              </div>
            </div>
          )}
          <button className="st-btn st-btn-ghost" disabled={locked} onClick={skip}>
            <SkipForward size={16} /> Skip question
          </button>
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
        </section>
      ) : (
        <section className="st-card st-stage">
          <p className="st-question">Conversation complete.</p>
          <p className="st-muted">Your report is ready.</p>
        </section>
      )}

      {session.turns.length > 0 && (
        <details className="st-card">
          <summary>Conversation so far · {session.turns.length} answers</summary>
          <div className="st-history" style={{ marginTop: 14 }}>
            {session.turns.map((t) => (
              <div className="st-turn" key={t.id}>
                <div className="st-row st-between">
                  <strong className="st-small">{t.depth ? "Follow-up" : "Main question"}</strong>
                  <span className="st-chip">{label(t.state)}</span>
                </div>
                <p>{t.question}</p>
                <blockquote>“{t.transcript}”</blockquote>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
