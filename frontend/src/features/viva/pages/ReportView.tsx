import { ArrowLeft, ArrowRight, BookOpen, Download, Info, ListChecks, Mic, PartyPopper, Printer, RotateCcw, Sparkles } from "../components/icons";
import type { CSSProperties, ReactNode } from "react";
import type { Context, PlanItem, Report } from "../api/types";
import { api, conceptLabel, date, downloadJson, label, resultLabels, resultOf } from "../api/client";
import { Integrations, integrationLabel, ResourceLink } from "../components/components";
import { CountUp } from "../components/charts";
import "../styles/student.css";

const RESULT: Record<string, { tone: string; meaning: string }> = {
  STRONG: { tone: "tone-strong", meaning: "You covered the expected points in every topic without needing help." },
  LIKELY_KNOWLEDGE_GAP: {
    tone: "tone-knowledge",
    meaning: "Some ideas were still missing after the follow-up questions. Revising them should help most: your study plan lists what to revise.",
  },
  LIKELY_COMMUNICATION_DIFFICULTY: {
    tone: "tone-communication",
    meaning: "You showed the knowledge once prompted, but found it harder to explain at first. Your speaking plan shows how to practise.",
  },
  REACHED_WITH_HELP: {
    tone: "tone-mixed",
    meaning: "You reached the expected points, but only after follow-up questions. Practise giving the full answer the first time.",
  },
  SPEAKING_DIFFICULTY_SEEN: {
    tone: "tone-communication",
    meaning: "Explaining out loud was hard in this viva, and not all the expected points came through, so it is not yet clear which held you back. Practise with your speaking plan, and revise the missing points too.",
  },
  MIXED_RESULTS: { tone: "tone-mixed", meaning: "Some topics came through well and some need more work. See each topic below." },
  NOT_ENOUGH_EVIDENCE: {
    tone: "tone-mixed",
    meaning: "There were not enough clear answers to give a result. Try the viva again and answer each question as fully as you can.",
  },
};
const STATE_WORDS: Record<string, string> = {
  complete: "complete",
  partial: "partly complete",
  superficial: "too brief",
  incorrect: "incorrect",
  misconception_bearing: "based on a misunderstanding",
  non_answer: "not an answer",
};
const COLOR: Record<string, string> = {
  "No gap identified": "var(--st-green)",
  "Likely knowledge gap": "var(--st-rose)",
  "Likely communication difficulty": "var(--st-amber)",
  "Speaking difficulty seen; knowledge unclear": "var(--st-amber)",
  "Reached with help": "var(--st-indigo, #4f7be0)",
};

/** A numbered plan: each step, and under it the evidence it was chosen from. */
function Plan({ items }: { items: (PlanItem | string)[] }) {
  return (
    <ol className="st-plan">
      {items.map((item, i) => {
        const { step, reason } = typeof item === "string" ? { step: item, reason: "" } : item;
        return (
          <li key={i}>
            <span>
              {step}
              {reason && <small className="st-plan-why">Why: {reason}</small>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Section({ icon, title, sub, children, className = "" }: { icon: ReactNode; title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`st-card st-section ${className}`}>
      <header className="st-section-head">
        <span className="st-section-icon">{icon}</span>
        <div>
          <h2>{title}</h2>
          {sub && <p className="st-muted st-small">{sub}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

/**
 * The viva report as the student sees it. With `staff`, a lecturer opens a student's report:
 * it names the participant, adds the learning context (C1 to C3), the method notes and a data export.
 */
export default function ReportView({
  report,
  celebrate = false,
  staff,
  token,
  onBack,
  onError,
}: {
  report: Report;
  celebrate?: boolean;
  staff?: { participant?: string; context: Context | null };
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
  const result = resultOf(report);
  const shown = RESULT[result] ?? RESULT.NOT_ENOUGH_EVIDENCE!;
  const h = report.hesitation;
  const coverage = Math.round(report.rubric_coverage);
  // What went well, said next to the result so a mixed outcome still names its strengths.
  const full = report.concepts.filter((c) => Math.round(c.rubric_coverage) >= 100).map((c) => c.concept);
  const wins = full.length
    ? `You reached every expected point on ${full.join(" and ")}.`
    : coverage >= 50
      ? `You covered ${coverage}% of the expected points.`
      : "";
  const followUps = report.transcript?.filter((t) => t.follow_up).length ?? 0;
  // Topics where every question was skipped.
  const skipped = new Set(
    (report.transcript ?? []).filter((t) => t.skipped).map((t) => t.concept).filter((c) => report.transcript!.every((t) => t.concept !== c || t.skipped)),
  );
  // Reports saved before the two plans existed have one combined list.
  const study = report.study_plan ?? report.improvement_plan;
  const speaking = report.speaking_plan ?? [];
  return (
    <div className="st st-report">
      <div className="st-row st-between no-print">
        <button className="st-link" onClick={onBack}>
          <ArrowLeft size={15} style={{ verticalAlign: "-2px" }} /> Back
        </button>
        <div className="st-row">
          {staff && (
            <button className="st-btn st-btn-ghost st-btn-sm" onClick={exportReport}>
              <Download size={15} /> Export data
            </button>
          )}
          <button className="st-btn st-btn-ghost st-btn-sm" onClick={() => window.print()}>
            <Printer size={15} /> Print or save as PDF
          </button>
        </div>
      </div>

      {staff && (
        <p className="st-staff-note st-small">
          {staff.participant ? <code>{staff.participant}</code> : "A student"}
          <span>This is the report the student sees.</span>
        </p>
      )}

      {celebrate && (
        <section className="st-card st-celebrate no-print" role="status">
          <span className="st-confetti" aria-hidden="true">
            {Array.from({ length: 18 }, (_, i) => (
              <i key={i} style={{ "--i": i } as CSSProperties} />
            ))}
          </span>
          <PartyPopper size={26} />
          <div>
            <strong>Viva complete. Well done for finishing!</strong>
            <p className="st-muted st-small">Explaining out loud takes practice. Here is your report.</p>
          </div>
        </section>
      )}

      <section className={`st-card st-outcome ${shown.tone}`}>
        <div>
          <div className="st-eyebrow">
            {report.topic} · {date(report.created_at)}
          </div>
          <h1>{resultLabels[result] ?? label(report.outcome)}</h1>
          <p className="st-muted">
            {new Set(report.concepts.map((c) => conceptLabel(c))).size > 1
              ? report.concepts.map((c) => `${c.concept}: ${conceptLabel(c).toLowerCase()}.`).join(" ")
              : shown.meaning}
          </p>
          {wins && result !== "STRONG" && (
            <p className="st-win">
              <Sparkles size={16} /> {wins}
            </p>
          )}
          <div className="st-facts">
            <span>
              {report.concepts.length} {report.concepts.length === 1 ? "question" : "questions"}
            </span>
            <span>
              {followUps} {followUps === 1 ? "follow-up" : "follow-ups"}
            </span>
            <span>{h.available ? "Spoken answers" : "Typed answers"}</span>
          </div>
        </div>
        <div className="st-outcome-ring" title="The share of the expected points your answers covered. It is not a confidence score for the result.">
          <div className="st-ring" style={{ ["--value" as string]: coverage }} aria-label={`Points covered ${coverage}%`}>
            <div>
              <span>
                <strong>
                  <CountUp value={coverage} />%
                </strong>
                <br />
                <small>covered</small>
              </span>
            </div>
          </div>
          <small className="st-muted">Expected points covered</small>
        </div>
      </section>

      <div className="st-grid-2 st-plans">
        <Section icon={<BookOpen size={18} />} title="Study plan" sub="What to learn or revise">
          <Plan items={study} />
          {report.review_resources.length > 0 && (
            <div className="st-resources">
              <div className="st-label">Review material</div>
              {report.review_resources.map((r, i) => (
                <ResourceLink key={i} title={r.title} url={r.url} />
              ))}
            </div>
          )}
        </Section>
        {speaking.length > 0 && (
          <Section icon={<Mic size={18} />} title="Speaking plan" sub="How to explain your answers out loud">
            <Plan items={speaking} />
          </Section>
        )}
      </div>

      <Section icon={<ListChecks size={18} />} title="Topic by topic" sub="The result for each question, and how your answer changed after follow-ups">
        <div className="st-topic-results">
          {report.concepts.map((c, i) => {
            const name = conceptLabel(c);
            const covered = Math.round(c.rubric_coverage);
            return (
              <article className="st-concept" key={i}>
                <div className="st-concept-top">
                  <strong>{c.concept}</strong>
                  <span className="st-result-pill">
                    <span className="st-dot" style={{ background: COLOR[name] ?? "var(--st-muted)" }} />
                    {name}
                  </span>
                </div>
                <div className="st-concept-bar" aria-label={`${covered}% of the points covered`}>
                  <span style={{ width: `${covered}%` }} />
                </div>
                <div className="st-row st-concept-meta">
                  <span>{covered}% of points covered</span>
                  {skipped.has(c.concept) ? (
                    <span>Skipped</span>
                  ) : (
                    c.initial_state && (
                      <span>
                        First answer {STATE_WORDS[c.initial_state] ?? label(c.initial_state).toLowerCase()}
                        {c.final_state && c.final_state !== c.initial_state ? `, then ${STATE_WORDS[c.final_state] ?? label(c.final_state).toLowerCase()}` : ""}
                      </span>
                    )
                  )}
                  <span>
                    {c.turn_count} {c.turn_count === 1 ? "answer" : "answers"}
                  </span>
                </div>
                {(c.covered?.length || c.missing?.length) ? (
                  <div className="st-grid-2 st-concept-points">
                    {c.covered && c.covered.length > 0 && (
                      <div>
                        <div className="st-label">You covered</div>
                        <ul className="st-points good">
                          {c.covered.map((p, j) => (
                            <li key={j}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {c.missing && c.missing.length > 0 && (
                      <div>
                        <div className="st-label">Missing</div>
                        <ul className="st-points warn">
                          {c.missing.map((p, j) => (
                            <li key={j}>{p}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : null}
                <details>
                  <summary className="st-small">Why this result</summary>
                  <p className="st-small" style={{ marginTop: 8 }}>
                    {c.explanation}
                  </p>
                  {staff && c.signal_details && c.signal_details.length > 0 && (
                    <div style={{ overflowX: "auto", marginTop: 8 }}>
                      <table className="st-signals">
                        <thead>
                          <tr>
                            <th>Speech sign (first answer)</th>
                            <th>Value</th>
                            <th>Counts when</th>
                            <th>Counted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {c.signal_details.map((s) => (
                            <tr key={s.signal}>
                              <td>{s.signal}</td>
                              <td>{s.value}</td>
                              <td>{s.threshold}</td>
                              <td className={s.counted ? "is-counted" : ""}>{s.counted ? "Yes" : "No"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="st-small st-muted" style={{ marginTop: 6 }}>
                        Speech signs only matter when the knowledge was shown. A communication difficulty needs 2 signs, one of them heard in
                        the words (fillers, or repeats and restarts): slow speech alone never decides it.
                      </p>
                    </div>
                  )}
                </details>
              </article>
            );
          })}
        </div>
      </Section>

      {report.transcript && report.transcript.length > 0 && (
        <Section icon={<Mic size={18} />} title="Questions and your answers" sub="Everything you were asked, in order">
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
        </Section>
      )}

      <Section icon={<Mic size={18} />} title="How you spoke" sub="For practice only: pauses and filler words never decide the result on their own">
        {h.available ? (
          <div className="st-stats">
            {(
              [
                ["Time to first word", h.response_latency_ms == null ? null : `${(h.response_latency_ms / 1000).toFixed(1)} s`, "How long before you started to answer"],
                ["Pauses", h.pause_count == null ? null : String(h.pause_count), "Silent breaks while you spoke"],
                ["Total pause time", h.total_pause_ms == null ? null : `${(h.total_pause_ms / 1000).toFixed(1)} s`, "All the silent breaks added up"],
                ["Fillers per 100 words", h.fillers_per_100_words == null ? null : String(Math.round(h.fillers_per_100_words)), 'Words like "um" and "uh"'],
              ] as [string, string | null, string][]
            ).map(([name, value, help]) => (
              <div className="st-stat" key={name}>
                <strong>{value ?? "Not measured"}</strong>
                <span>{name}</span>
                <small>{help}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="st-small">No spoken answers were recorded, so there is no timing data.</p>
        )}
      </Section>

      {staff && (
        <details className="st-card" open>
          <summary>Learning context from AdaptLearn · {staff.context ? integrationLabel(staff.context) : "Loading"}</summary>
          <p className="st-small st-muted" style={{ margin: "8px 0 14px" }}>
            Saved when the viva started. Lecturers only: students do not see this.
          </p>
          <Integrations context={staff.context} />
        </details>
      )}

      <Section icon={<Info size={18} />} title="How this works" className="st-howto">
        <ul className="st-points">
          <li>Each answer was marked against the points a full answer should cover. An idea in your own words earns part of a point; using the correct technical term earns all of it.</li>
          <li>Follow-up questions gave you a chance to add more, and the result looks at all your answers together.</li>
          <li>Pauses and filler words are shown to help you practise. They never decide the result on their own.</li>
          {report.mastery_mismatch && <li>This result differs from your AdaptLearn mastery level. Your mastery has not been changed.</li>}
        </ul>
        {staff && (
          <details>
            <summary className="st-small">Method notes (lecturers only)</summary>
            <ul className="st-small st-muted" style={{ marginTop: 10, paddingLeft: 18, display: "grid", gap: 6 }}>
              {report.limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </details>
        )}
      </Section>
      {!staff && (
        <section className="st-card st-next no-print" aria-label="What next">
          <strong>What next?</strong>
          <div className="st-row">
            <button className="st-btn st-btn-primary" onClick={onBack}>
              <RotateCcw size={16} /> Practise this topic again
            </button>
            <button className="st-btn st-btn-ghost" disabled title="Opens the C3 lesson for this topic once AdaptLearn is connected.">
              <BookOpen size={16} /> Revise the material (C3, coming soon)
            </button>
            <button className="st-btn st-btn-ghost" onClick={onBack}>
              Pick another topic <ArrowRight size={16} />
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
