import { ArrowLeft, Download, Printer } from "lucide-react";
import type { Report } from "../api/types";
import { api, date, downloadJson, gapLabels, label } from "../api/client";
import { ResourceLink } from "../components/components";
import { CountUp } from "../components/charts";
import "../styles/student.css";

const STRONG = {
  tone: "tone-strong",
  color: "var(--st-green)",
  meaning: "You covered the expected points in every concept without needing help. There is no weakness to explain.",
};
const TONE: Record<string, { tone: string; color: string; meaning: string }> = {
  LIKELY_KNOWLEDGE_GAP: {
    tone: "tone-knowledge",
    color: "var(--st-rose)",
    meaning: "Some ideas were still missing after follow-up questions. Reviewing the material should help most.",
  },
  LIKELY_COMMUNICATION_DIFFICULTY: {
    tone: "tone-communication",
    color: "var(--st-amber)",
    meaning: "You showed the knowledge once prompted, but found it harder to explain at first. Practising explanations should help most.",
  },
  MIXED_INSUFFICIENT_EVIDENCE: {
    tone: "tone-mixed",
    color: "var(--st-muted)",
    meaning: "The evidence does not clearly point one way. Read the concept notes below for details.",
  },
};

export default function ReportView({
  report,
  token,
  onBack,
  onError,
}: {
  report: Report;
  token: string;
  onBack: () => void;
  onError: (s: string) => void;
}) {
  const exportReport = async () => {
    try {
      downloadJson(await api(`/sessions/${report.session_id}/export`, token), `viva-${report.session_id}.json`);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  // Student-facing wording only: a session with no weakness keeps the stored MIXED research category.
  const outcome = report.strong_answers ? STRONG : TONE[report.outcome] ?? TONE.MIXED_INSUFFICIENT_EVIDENCE!;
  const title = report.strong_answers ? "No gap identified: strong answers" : gapLabels[report.outcome] || label(report.outcome);
  const h = report.hesitation;
  const coverage = Math.round(report.rubric_coverage);
  return (
    <div className="st st-report">
      <div className="st-row st-between no-print">
        <button className="st-link" onClick={onBack}>
          <ArrowLeft size={15} style={{ verticalAlign: "-2px" }} /> Back
        </button>
        <div className="st-row">
          <button className="st-btn st-btn-ghost" onClick={exportReport}>
            <Download size={16} /> Export
          </button>
          <button className="st-btn st-btn-ghost" onClick={() => window.print()}>
            <Printer size={16} /> Print / PDF
          </button>
        </div>
      </div>

      <section className={`st-card st-outcome ${outcome.tone}`}>
        <div>
          <div className="st-eyebrow">
            {report.topic} · {date(report.created_at)}
          </div>
          <h1>{title}</h1>
          <p className="st-muted">{outcome.meaning}</p>
        </div>
      </section>

      <section className="st-card st-row" style={{ gap: 20 }}>
        <div className="st-ring" style={{ ["--value" as string]: coverage }} aria-label={`Rubric coverage ${coverage}%`}>
          <div>
            <span>
              <strong>
                <CountUp value={coverage} />%
              </strong>
              <br />
              <small>rubric coverage</small>
            </span>
          </div>
        </div>
        <p className="st-muted st-small" style={{ flex: 1, minWidth: 220 }}>
          <strong>Rubric coverage</strong> is the share of expected points your answers covered. It is not a confidence score
          for the result above.
        </p>
      </section>

      <section className="st-card">
        <h2>Your plan to improve</h2>
        {report.plan_summary && <p className="st-muted" style={{ marginTop: 8 }}>{report.plan_summary}</p>}
        <ol className="st-plan">
          {report.improvement_plan.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        {report.review_resources.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="st-label">Review material</div>
            {report.review_resources.map((r, i) => (
              <ResourceLink key={i} title={r.title} url={r.url} />
            ))}
          </div>
        )}
      </section>

      <div className="st-grid-2">
        <section className="st-card">
          <h3>What came through</h3>
          {report.strengths.length ? (
            <div className="st-tags">
              {report.strengths.map((s, i) => (
                <span className="st-tag good" key={i}>{s}</span>
              ))}
            </div>
          ) : (
            <p className="st-muted st-small" style={{ marginTop: 10 }}>Not enough evidence yet to name a clear strength.</p>
          )}
        </section>
        <section className="st-card">
          <h3>Worth revisiting</h3>
          {report.missing_concepts.length ? (
            <div className="st-tags">
              {report.missing_concepts.map((s, i) => (
                <span className="st-tag warn" key={i}>{s}</span>
              ))}
            </div>
          ) : (
            <p className="st-muted st-small" style={{ marginTop: 10 }}>Nothing missing in the evidence collected.</p>
          )}
        </section>
      </div>

      <section className="st-card">
        <h2>Concept by concept</h2>
        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
          {report.concepts.map((c, i) => {
            const t = c.no_weakness ? STRONG : TONE[c.outcome] ?? TONE.MIXED_INSUFFICIENT_EVIDENCE!;
            return (
              <article className="st-concept" key={i}>
                <div className="st-row st-between">
                  <strong>{c.concept}</strong>
                  <span className="st-row" style={{ gap: 8 }}>
                    <span className="st-dot" style={{ background: t.color }} />
                    <span className="st-small">{c.no_weakness ? "No gap identified" : gapLabels[c.outcome] || label(c.outcome)}</span>
                  </span>
                </div>
                <details>
                  <summary className="st-small">Why this result</summary>
                  <p className="st-small" style={{ marginTop: 8 }}>{c.explanation}</p>
                  {c.signal_details && c.signal_details.length > 0 ? (
                    <div style={{ overflowX: "auto", marginTop: 8 }}>
                      <table className="st-signals">
                        <thead>
                          <tr><th>Hesitation signal (first answer)</th><th>Your value</th><th>Counts when</th><th>Counted</th></tr>
                        </thead>
                        <tbody>
                          {c.signal_details.map((s) => (
                            <tr key={s.signal}>
                              <td>{s.signal}</td><td>{s.value}</td><td>{s.threshold}</td>
                              <td className={s.counted ? "is-counted" : ""}>{s.counted ? "Yes" : "No"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="st-small st-muted" style={{ marginTop: 6 }}>
                        A complete answer only counts as a communication difficulty with 2 or more signals, at least one of
                        them fillers, restarts or hedges. Timing alone never decides it.
                      </p>
                    </div>
                  ) : (
                    <p className="st-small st-muted" style={{ marginTop: 6 }}>Typed first answer: no hesitation signals were measured.</p>
                  )}
                </details>
                <div className="st-row">
                  <span className="st-chip">{Math.round(c.rubric_coverage)}% covered</span>
                  {c.initial_state && (
                    <span className="st-chip">
                      {label(c.initial_state)} → {label(c.final_state || c.initial_state)}
                    </span>
                  )}
                  <span className="st-chip">
                    {c.turn_count} {c.turn_count === 1 ? "answer" : "answers"}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {report.transcript && report.transcript.length > 0 && (
        <section className="st-card">
          <h2>Questions and your answers</h2>
          <ol className="st-qa">
            {report.transcript.map((t, i) => (
              <li key={i}>
                <div className="st-small st-muted">
                  {t.concept} · {t.follow_up ? "Follow-up question" : "Main question"}
                </div>
                <p className="st-qa-q">{t.question}</p>
                <p className="st-qa-a">{t.skipped ? <em>Skipped</em> : t.answer}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="st-card">
        <h2>How you spoke</h2>
        <p className="st-muted st-small" style={{ marginTop: 6 }}>
          Supporting information only. Pauses and fillers never decide the outcome on their own.
        </p>
        {h.available ? (
          <div className="st-stats">
            {(
              [
                ["Time to first word", h.response_latency_ms, "ms"],
                ["Pauses", h.pause_count, ""],
                ["Total pause time", h.total_pause_ms, "ms"],
                ["Fillers per 100 words", h.fillers_per_100_words, ""],
              ] as [string, number | undefined, string][]
            ).map(([name, value, unit]) => (
              <div className="st-stat" key={name}>
                <strong>{value == null ? "Not measured" : `${Math.round(value)}${unit ? ` ${unit}` : ""}`}</strong>
                <span>{name}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="st-small" style={{ marginTop: 12 }}>No spoken answers were recorded, so there is no timing data.</p>
        )}
      </section>

      <details className="st-card">
        <summary>About this report</summary>
        <ul className="st-small st-muted" style={{ marginTop: 12, paddingLeft: 18, display: "grid", gap: 6 }}>
          {report.limitations.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        {report.mastery_mismatch && (
          <p className="st-small" style={{ marginTop: 10 }}>
            This result differs from your AdaptLearn mastery level. Your mastery has not been changed.
          </p>
        )}
      </details>
    </div>
  );
}
