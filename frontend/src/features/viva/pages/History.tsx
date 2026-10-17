import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, History as HistoryIcon, Search } from "../components/icons";
import { ago, api, date, resultLabels, resultOf } from "../api/client";
import type { Auth, Report, Session, Summary } from "../api/types";
import { Empty, PageTitle, Skeleton } from "../components/components";
import { CountUp } from "../components/charts";

type Filter = "all" | "active" | "completed";
type Tone = "active" | "strong" | "knowledge" | "communication" | "mixed";

function tone(s: Summary): Tone {
  if (s.status === "active") return "active";
  const result = resultOf(s);
  if (result === "STRONG") return "strong";
  if (result === "LIKELY_KNOWLEDGE_GAP") return "knowledge";
  if (result === "LIKELY_COMMUNICATION_DIFFICULTY") return "communication";
  return "mixed";
}

/**
 * A student's own vivas (resume the active ones, open the reports of finished ones), or, with
 * `staff`, every student's vivas for a lecturer, who can search by code and open reports.
 */
export default function History({
  auth,
  staff = false,
  onResume,
  onReport,
  onError,
}: {
  auth: Auth;
  staff?: boolean;
  onResume: (s: Session) => void;
  onReport: (r: Report, participant?: string) => void;
  onError: (s: string) => void;
}) {
  const [items, setItems] = useState<Summary[]>([]),
    [busy, setBusy] = useState(true),
    [opening, setOpening] = useState(""),
    [filter, setFilter] = useState<Filter>("all"),
    [search, setSearch] = useState("");
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
        onReport(await api<Report>(`/sessions/${s.id}/report`, auth.token), s.participant_code ?? undefined);
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
  const query = search.trim().toLowerCase();
  const shown = items.filter(
    (s) =>
      (filter === "all" || (filter === "active" ? s.status === "active" : s.status === "completed")) &&
      (!query || (s.participant_code ?? "").toLowerCase().includes(query) || s.topic.toLowerCase().includes(query)),
  );
  return (
    <>
      {staff ? (
        <PageTitle eyebrow="STUDENT VIVAS" title="Student vivas" description="Every viva your students have taken. Open a report to see their answers, result and timing." />
      ) : (
        <PageTitle eyebrow="MY VIVAS" title="Your vivas" description="Continue a viva you started, or open the report of one you finished." />
      )}
      {busy ? (
        <Skeleton rows={4} height={96} />
      ) : items.length ? (
        <>
          <div className="hx-stats">
            <div className="hx-stat">
              <span>Vivas</span>
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
          <div className="hx-tools">
            <div className="segmented" role="tablist" aria-label="Filter vivas">
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
            {staff && (
              <label className="hx-search">
                <Search size={16} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by participant code or topic" aria-label="Search vivas" />
              </label>
            )}
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
                      <span className={`hx-chip tone-${t}`}>{t === "active" ? "In progress" : resultLabels[resultOf(s)] ?? "Finished"}</span>
                    </div>
                    <p className="small muted">
                      {staff && <code className="hx-code">{s.participant_code ?? "unknown"}</code>}
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
                  {staff && s.status === "active" ? (
                    <span className="small muted">Not finished yet</span>
                  ) : (
                    <button className="button secondary" disabled={!!opening} onClick={() => open(s)}>
                      {opening === s.id ? "Opening…" : s.status === "active" ? "Continue" : "View report"}
                      <ArrowRight size={16} />
                    </button>
                  )}
                </article>
              );
            })}
            {!shown.length && <p className="muted hx-none">No vivas match.</p>}
          </div>
        </>
      ) : (
        <Empty icon={<HistoryIcon size={30} />} title="No vivas yet">
          {staff ? "Vivas appear here as soon as students start them." : "Start your first viva from the Viva tab. Your reports will appear here."}
        </Empty>
      )}
    </>
  );
}
