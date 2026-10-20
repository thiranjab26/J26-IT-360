import { useEffect, useState } from "react";
import {
  ArrowRight,
  AudioLines,
  BookOpenCheck,
  ClipboardCheck,
  FlaskConical,
  MessagesSquare,
  RefreshCw,
  Server,
  Users,
} from "../components/icons";
import { ago, api, date, label, resultLabels, resultOf } from "../api/client";
import type { Auth, Case, Health, Overview, Report } from "../api/types";
import { Badge, PageTitle, Skeleton } from "../components/components";
import { BarList, Columns, CountUp, Donut, Legend, Ring, type Slice } from "../components/charts";
import { providerName } from "../hooks/useSpeech";
import type { LecturerPage } from "./LecturerApp";
import "../styles/dashboard.css";

type StaffView = Exclude<LecturerPage, "overview">;
type OnReport = (r: Report, participant?: string) => void;

const OUTCOME_COLORS: Record<string, string> = {
  STRONG: "#2f9e74",
  LIKELY_KNOWLEDGE_GAP: "#e0566f",
  LIKELY_COMMUNICATION_DIFFICULTY: "#e3a33f",
  REACHED_WITH_HELP: "#4f7be0",
  SPEAKING_DIFFICULTY_SEEN: "#efc27a",
  MIXED_RESULTS: "#7d8fb3",
  NOT_ENOUGH_EVIDENCE: "#c3ccda",
};
const STATE_COLORS: Record<string, string> = {
  complete: "#2f9e74",
  partial: "#4f7be0",
  superficial: "#8b6fe0",
  incorrect: "#e0566f",
  misconception_bearing: "#e3803f",
  non_answer: "#9aa8bc",
};

/** Lecturer landing page: the overview dashboard, or a rater's queue. */
export default function StaffHome({
  auth,
  health,
  navigate,
  onReport,
  onError,
}: {
  auth: Auth;
  health: Health | null;
  navigate: (view: StaffView) => void;
  onReport: OnReport;
  onError: (s: string) => void;
}) {
  return auth.user.role === "admin" ? (
    <AdminOverview auth={auth} health={health} navigate={navigate} onReport={onReport} onError={onError} />
  ) : (
    <EvaluatorHome auth={auth} navigate={navigate} onError={onError} />
  );
}

function AdminOverview({
  auth,
  health,
  navigate,
  onReport,
  onError,
}: {
  auth: Auth;
  health: Health | null;
  navigate: (view: StaffView) => void;
  onReport: OnReport;
  onError: (s: string) => void;
}) {
  const [data, setData] = useState<Overview | null>(null),
    [loading, setLoading] = useState(false),
    [opening, setOpening] = useState("");
  async function load() {
    setLoading(true);
    try {
      setData(await api<Overview>("/overview", auth.token));
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [auth.token]);
  async function openReport(id: string, participant: string) {
    setOpening(id);
    try {
      onReport(await api<Report>(`/sessions/${id}/report`, auth.token), participant);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setOpening("");
    }
  }
  const t = data?.totals;
  const completion = t && t.sessions ? (100 * t.completed) / t.sessions : 0;
  // Older services send only the research categories; their mixed count shows as "Mixed results".
  const results = data?.results ?? { ...data?.outcomes, MIXED_RESULTS: data?.outcomes.MIXED_INSUFFICIENT_EVIDENCE ?? 0 };
  const outcomes: Slice[] = data
    ? Object.keys(OUTCOME_COLORS).map((key) => ({ label: resultLabels[key]!, value: results[key] ?? 0, color: OUTCOME_COLORS[key]! }))
    : [];
  return (
    <div className="dash">
      <PageTitle
        eyebrow="OVERVIEW"
        title="Viva overview"
        description="How your students' vivas are going: sessions, results, questions and ratings."
        action={
          <div className="dash-actions">
            {data && <span className="small muted">Updated {new Date(data.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
            <button className="button secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={15} className={loading ? "spin" : ""} />
              Refresh
            </button>
          </div>
        }
      />
      {!data ? (
        <Skeleton rows={3} height={150} />
      ) : (
        <>
          <section className="kpi-grid">
            <article className="kpi">
              <div className="kpi-icon"><Users size={18} /></div>
              <span>Students</span>
              <strong><CountUp value={t!.participants} /></strong>
              <small>Signed in with a participant code</small>
            </article>
            <article className="kpi kpi-ring">
              <div>
                <div className="kpi-icon"><MessagesSquare size={18} /></div>
                <span>Vivas</span>
                <strong><CountUp value={t!.sessions} /></strong>
                <small>{t!.completed} completed · {t!.active} in progress</small>
              </div>
              <Ring value={completion} size={64}>
                <b>{Math.round(completion)}%</b>
              </Ring>
            </article>
            <article className="kpi">
              <div className="kpi-icon"><AudioLines size={18} /></div>
              <span>Answers</span>
              <strong><CountUp value={t!.answers} /></strong>
              <div className="kpi-split" title={`${t!.spoken_answers} spoken, ${t!.typed_answers} typed`}>
                <span style={{ flexGrow: Math.max(t!.spoken_answers, 0.001) }} />
                <span style={{ flexGrow: Math.max(t!.typed_answers, 0.001) }} />
              </div>
              <small>{t!.spoken_answers} spoken · {t!.typed_answers} typed{t!.skipped ? ` · ${t!.skipped} skipped` : ""}</small>
            </article>
            <article className="kpi">
              <div className="kpi-icon"><ClipboardCheck size={18} /></div>
              <span>Average rubric coverage</span>
              <strong>{t!.average_coverage == null ? "n/a" : <CountUp value={t!.average_coverage} decimals={1} suffix="%" />}</strong>
              <div className="kpi-bar"><span style={{ width: `${t!.average_coverage ?? 0}%` }} /></div>
              <small>
                {t!.average_minutes == null
                  ? "Across completed sessions"
                  : t!.average_minutes < 1
                    ? "Under a minute per session"
                    : `About ${Math.round(t!.average_minutes)} min per session`}
              </small>
            </article>
            <article className="kpi kpi-link" onClick={() => navigate("bank")} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && navigate("bank")}>
              <div className="kpi-icon"><BookOpenCheck size={18} /></div>
              <span>Approved questions</span>
              <strong><CountUp value={data.bank.approved} /></strong>
              <small>{data.bank.draft ? `${data.bank.draft} waiting for review` : "Nothing waiting for review"} · {data.bank.courses} {data.bank.courses === 1 ? "course" : "courses"}</small>
            </article>
            <article className="kpi kpi-link" onClick={() => navigate("research")} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && navigate("research")}>
              <div className="kpi-icon"><FlaskConical size={18} /></div>
              <span>Blinded ratings</span>
              <strong><CountUp value={data.ratings.total} /></strong>
              <small>From {data.ratings.raters} {data.ratings.raters === 1 ? "rater" : "raters"}</small>
            </article>
          </section>

          <section className="dash-row dash-row-wide">
            <article className="panel dash-card">
              <header>
                <h2>Vivas in the last 14 days</h2>
                <span className="small muted">Started and completed per day</span>
              </header>
              <Columns
                items={data.daily.map((d) => ({
                  label: String(new Date(d.date + "T00:00:00").getDate()),
                  title: date(d.date + "T00:00:00"),
                  values: [d.started, d.completed],
                }))}
                series={[
                  { name: "Started", color: "#9db4f0" },
                  { name: "Completed", color: "#315bd6" },
                ]}
              />
            </article>
            <article className="panel dash-card">
              <header>
                <h2>Outcomes</h2>
                <span className="small muted">Finished vivas</span>
              </header>
              <div className="dash-donut">
                <Donut
                  items={outcomes}
                  center={
                    <>
                      <strong><CountUp value={t!.completed} /></strong>
                      <small>reports</small>
                    </>
                  }
                />
                <Legend items={outcomes} />
              </div>
            </article>
          </section>

          <section className="dash-row">
            <article className="panel dash-card">
              <header>
                <h2>How answers were marked</h2>
                <span className="small muted">All answered questions, by answer state</span>
              </header>
              <BarList
                items={Object.entries(data.answer_states).map(([state, value]) => ({
                  label: label(state),
                  value,
                  color: STATE_COLORS[state] ?? "#9aa8bc",
                }))}
              />
            </article>
            <article className="panel dash-card">
              <header>
                <h2>Topics</h2>
                <span className="small muted">Vivas and average coverage</span>
              </header>
              {data.topics.length ? (
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Topic</th>
                      <th>Vivas</th>
                      <th>Done</th>
                      <th>Coverage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topics.map((topic) => (
                      <tr key={topic.topic}>
                        <td>{topic.topic}</td>
                        <td>{topic.sessions}</td>
                        <td>{topic.completed}</td>
                        <td>
                          <div className="dash-cover">
                            <div><span style={{ width: `${topic.average_coverage ?? 0}%` }} /></div>
                            <small>{topic.average_coverage == null ? "n/a" : `${Math.round(topic.average_coverage)}%`}</small>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted small">No vivas yet.</p>
              )}
            </article>
          </section>

          <article className="panel dash-card">
            <header className="dash-head-row">
              <h2>Recent vivas</h2>
              <button className="text-button" onClick={() => navigate("vivas")}>
                See all
              </button>
            </header>
            {data.recent.length ? (
              <div className="table-scroll">
                <table className="dash-table dash-recent">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Topic</th>
                      <th>Status</th>
                      <th>Outcome</th>
                      <th>Coverage</th>
                      <th>Answers</th>
                      <th>Started</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((s) => {
                      const key = resultOf(s);
                      return (
                        <tr key={s.id}>
                          <td><code>{s.participant_code}</code></td>
                          <td>{s.topic}</td>
                          <td>
                            <Badge tone={s.status === "completed" ? "green" : "blue"}>{s.status === "completed" ? "Completed" : "In progress"}</Badge>
                          </td>
                          <td>
                            {s.status === "completed" ? (
                              <span className="dash-outcome">
                                <i style={{ background: OUTCOME_COLORS[key] ?? "#9aa8bc" }} />
                                {resultLabels[key] ?? "n/a"}
                              </span>
                            ) : (
                              <span className="muted">n/a</span>
                            )}
                          </td>
                          <td>{s.coverage == null ? "n/a" : `${Math.round(s.coverage)}%`}</td>
                          <td>{s.answers}</td>
                          <td title={date(s.created_at)}>{ago(s.created_at)}</td>
                          <td>
                            {s.status === "completed" && (
                              <button className="text-button" disabled={!!opening} onClick={() => openReport(s.id, s.participant_code)}>
                                {opening === s.id ? "Opening…" : "Report"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted small">No vivas yet. They appear here as students take them.</p>
            )}
          </article>

          <section className="dash-quick">
            {(
              [
                ["vivas", MessagesSquare, "Student vivas", "Every viva, with reports and answers"],
                ["bank", BookOpenCheck, "Question bank", "Courses, material, AI drafts and approval"],
                ["lab", AudioLines, "Speech lab", "Measure pauses and speed in a recorded viva"],
                ["research", FlaskConical, "Research", "Blinded ratings and agreement"],
              ] as const
            ).map(([view, Icon, title, text]) => (
              <button key={view} className="dash-quick-card" onClick={() => navigate(view)}>
                <Icon size={20} />
                <span>
                  <strong>{title}</strong>
                  <small>{text}</small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </section>

          {health && (
            <article className="panel dash-card dash-system">
              <header>
                <h2>
                  <Server size={17} /> System
                </h2>
                <span className="small muted">Services this workspace uses</span>
              </header>
              <dl className="signal-details">
                {(
                  [
                    ["Marking", health.assessment_provider],
                    ["Speech to text", providerName(health.live_speech_provider) || health.speech_provider],
                    ["Question voice", providerName(health.voice_provider) || "Browser voice"],
                    ["Learning context (C1 to C3)", health.integration_mode],
                  ] as const
                ).map(([name, value]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{value || "Off"}</dd>
                  </div>
                ))}
              </dl>
            </article>
          )}
        </>
      )}
    </div>
  );
}

function EvaluatorHome({
  auth,
  navigate,
  onError,
}: {
  auth: Auth;
  navigate: (view: StaffView) => void;
  onError: (s: string) => void;
}) {
  const [progress, setProgress] = useState<{ condition: string; total: number; rated: number }[] | null>(null);
  useEffect(() => {
    Promise.all(
      ["A", "B", "C"].map((condition) =>
        api<{ items: Case[] }>(`/evaluation/cases?condition=${condition}`, auth.token).then((r) => ({
          condition,
          total: r.items.length,
          rated: r.items.filter((c) => c.my_rating).length,
        })),
      ),
    )
      .then(setProgress)
      .catch((e) => onError(e.message));
  }, [auth.token]);
  const names: Record<string, string> = { A: "Initial answer", B: "Follow-up evidence", C: "Full available evidence" };
  return (
    <div className="dash">
      <PageTitle eyebrow="RATER" title="Your rating queue" description="Rate each case on the evidence shown. The system's decisions stay hidden from you." />
      {!progress ? (
        <Skeleton rows={1} height={170} />
      ) : (
        <section className="kpi-grid kpi-grid-3">
          {progress.map((p) => {
            const share = p.total ? (100 * p.rated) / p.total : 0;
            return (
              <article className="kpi kpi-ring" key={p.condition}>
                <div>
                  <span>Condition {p.condition}</span>
                  <strong className="kpi-name">{names[p.condition]}</strong>
                  <small>{p.rated} of {p.total} cases rated</small>
                </div>
                <Ring value={share} size={64}>
                  <b>{Math.round(share)}%</b>
                </Ring>
              </article>
            );
          })}
        </section>
      )}
      <button className="button primary" style={{ justifySelf: "start" }} onClick={() => navigate("research")}>
        Open blind review
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
