import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, History as HistoryIcon } from "lucide-react";
import { ago, api, date, gapLabels } from "../api/client";
import type { Auth, Report, Session, Summary } from "../api/types";
import { Empty, PageTitle, Skeleton } from "../components/components";
import { CountUp } from "../components/charts";

type Filter = "all" | "active" | "completed";
type Tone = "active" | "strong" | "knowledge" | "communication" | "mixed";

const TONE_LABEL: Record<Tone, string> = {
  active: "In progress",
  strong: "No gap identified",
  knowledge: gapLabels.LIKELY_KNOWLEDGE_GAP!,
  communication: gapLabels.LIKELY_COMMUNICATION_DIFFICULTY!,
  mixed: gapLabels.MIXED_INSUFFICIENT_EVIDENCE!,
};

function tone(s: Summary): Tone {
  if (s.status === "active") return "active";
  if (s.strong) return "strong";
  if (s.outcome === "LIKELY_KNOWLEDGE_GAP") return "knowledge";
  if (s.outcome === "LIKELY_COMMUNICATION_DIFFICULTY") return "communication";
  return "mixed";
}

/** A participant's sessions: resume the active ones, open the reports of finished ones. */
export default function History({
  auth,
  onResume,
  onReport,
  onError,
}: {
  auth: Auth;
  onResume: (s: Session) => void;
  onReport: (r: Report) => void;
  onError: (s: string) => void;
}) {
  const [items, setItems] = useState<Summary[]>([]),
    [busy, setBusy] = useState(true),
    [opening, setOpening] = useState(""),
    [filter, setFilter] = useState<Filter>("all");
  useEffect(() => {
    api<{ items: Summary[] }>("/sessions", auth.token)
      .then((r) => setItems(r.items))
      .catch((e) => onError(e.message))
      .finally(() => setBusy(false));
  }, [auth.token]);
  async function open(s: Summary) {
    setOpening(s.id);
    try {
      if (s.status === "completed")
        onReport(await api<Report>(`/sessions/${s.id}/report`, auth.token));
      else onResume(await api<Session>(`/sessions/${s.id}`, auth.token));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setOpening("");
    }
  }
  const completed = items.filter((s) => s.status === "completed");
  const active = items.length - completed.length;
  const coverage = completed.map((s) => s.coverage).filter((c): c is number => c != null);
  const average = coverage.length ? coverage.reduce((a, b) => a + b, 0) / coverage.length : null;
  const shown = filter === "all" ? items : items.filter((s) => (filter === "active" ? s.status === "active" : s.status === "completed"));
  return (
    <>
      <PageTitle
        eyebrow="YOUR LEARNING JOURNEY"
        title="Every conversation counts."
        description="Pick up where you left off, or revisit the evidence behind a past session."
      />
      {busy ? (
        <Skeleton rows={4} height={96} />
      ) : items.length ? (
        <>
          <div className="hx-stats">
            <div className="hx-stat">
              <span>Sessions</span>
              <strong><CountUp value={items.length} /></strong>
            </div>
            <div className="hx-stat">
              <span>Completed</span>
              <strong><CountUp value={completed.length} /></strong>
            </div>
            <div className="hx-stat">
              <span>In progress</span>
              <strong><CountUp value={active} /></strong>
            </div>
            <div className="hx-stat">
              <span>Average rubric coverage</span>
              <strong>{average == null ? "n/a" : <CountUp value={average} suffix="%" />}</strong>
            </div>
          </div>
          <div className="segmented" role="tablist" aria-label="Filter sessions">
            {(
              [
                ["all", "All", items.length],
                ["active", "In progress", active],
                ["completed", "Completed", completed.length],
              ] as const
            ).map(([key, name, count]) => (
              <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? "selected" : ""} onClick={() => setFilter(key)}>
                {name} <span>{count}</span>
              </button>
            ))}
          </div>
          <div className="history-list hx-list">
            {shown.map((s, i) => {
              const t = tone(s);
              return (
                <article className={`panel history-card hx-card tone-${t}`} key={s.id} style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}>
                  <div className="square-icon">
                    <BookOpen size={23} />
                  </div>
                  <div className="history-info">
                    <div className="tag-row">
                      <h2>{s.topic}</h2>
                      <span className={`hx-chip tone-${t}`}>{TONE_LABEL[t]}</span>
                    </div>
                    <p className="small muted">
                      <span title={date(s.created_at)}>{ago(s.created_at)}</span> ·{" "}
                      {s.questions_asked != null
                        ? `${s.questions_asked} question${s.questions_asked === 1 ? "" : "s"} asked · ${s.answered_count} answered`
                        : `${s.turn_count} answer${s.turn_count === 1 ? "" : "s"}`}
                    </p>
                    {s.status === "completed" && s.coverage != null && (
                      <div className="hx-cover" title="Rubric coverage">
                        <div className="hx-cover-track">
                          <span style={{ width: `${Math.max(0, Math.min(100, s.coverage))}%` }} />
                        </div>
                        <small>{Math.round(s.coverage)}% covered</small>
                      </div>
                    )}
                  </div>
                  <button className="button secondary" disabled={!!opening} onClick={() => open(s)}>
                    {opening === s.id ? "Opening…" : s.status === "active" ? "Resume session" : "View report"}
                    <ArrowRight size={16} />
                  </button>
                </article>
              );
            })}
            {!shown.length && <p className="muted hx-none">No sessions in this view.</p>}
          </div>
        </>
      ) : (
        <Empty icon={<HistoryIcon size={30} />} title="Your first conversation is ahead">
          Start a viva from the workspace. Your saved sessions and reports will appear here.
        </Empty>
      )}
    </>
  );
}
