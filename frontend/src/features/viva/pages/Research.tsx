import { useEffect, useState } from "react";
import { Download, FlaskConical, Save, ShieldCheck } from "lucide-react";
import { api, downloadJson, gapLabels, label } from "../api/client";
import type { Auth, Case, Metrics, Rating } from "../api/types";
import { Badge, Empty, PageTitle, Skeleton } from "../components/components";

const states = [
  "complete",
  "partial",
  "superficial",
  "incorrect",
  "misconception_bearing",
  "non_answer",
];
export default function Research({
  auth,
  onError,
}: {
  auth: Auth;
  onError: (s: string) => void;
}) {
  const [tab, setTab] = useState<"ratings" | "metrics">("ratings"),
    [condition, setCondition] = useState("A"),
    [cases, setCases] = useState<Case[]>([]),
    [metrics, setMetrics] = useState<Metrics | null>(null),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (auth.user.role !== "admin") setTab("ratings");
  }, [auth.user.role]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const request =
      tab === "ratings"
        ? api<{ items: Case[] }>(
            `/evaluation/cases?condition=${condition}`,
            auth.token,
          ).then((r) => {
            if (!cancelled) setCases(r.items);
          })
        : api<Metrics>("/evaluation/metrics", auth.token).then((r) => {
            if (!cancelled) setMetrics(r);
          });
    request
      .catch((e) => {
        if (!cancelled) onError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, condition, auth.token, refresh]);
  async function exportData() {
    try {
      downloadJson(
        await api("/evaluation/export", auth.token),
        "adaptlearn-research-export.json",
      );
    } catch (e) {
      onError((e as Error).message);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="RESEARCH WORKSPACE"
        title="Let the evidence lead."
        description="Independent human ratings and measured agreement across three evidence conditions."
        action={
          auth.user.role === "admin" ? (
            <button className="button secondary" onClick={exportData}>
              <Download size={16} />
              Export research data
            </button>
          ) : undefined
        }
      />
      <div className="tab-bar">
        <button
          className={tab === "ratings" ? "selected" : ""}
          onClick={() => setTab("ratings")}
        >
          Blind review
        </button>
        {auth.user.role === "admin" && (
          <button
            className={tab === "metrics" ? "selected" : ""}
            onClick={() => setTab("metrics")}
          >
            Study metrics
          </button>
        )}
      </div>
      {tab === "ratings" ? (
        <>
          <div className="condition-grid">
            {[
              {
                id: "A",
                name: "Initial answer",
                description: "The first response only",
              },
              {
                id: "B",
                name: "Follow-up evidence",
                description: "Initial response + follow-ups",
              },
              {
                id: "C",
                name: "Full available evidence",
                description: "Follow-ups + hesitation signals",
              },
            ].map((c) => (
              <button
                key={c.id}
                className={`condition-card ${condition === c.id ? "selected" : ""}`}
                onClick={() => setCondition(c.id)}
              >
                <span>{c.id}</span>
                <strong>{c.name}</strong>
                <small>{c.description}</small>
              </button>
            ))}
          </div>
          <div className="notice">
            <ShieldCheck size={19} />
            <span>
              System classifications are hidden in this review. Rate only the
              evidence shown. Knowledge-check evidence, when present, is held
              constant across conditions.
            </span>
          </div>
          {loading ? (
            <Skeleton rows={3} height={120} />
          ) : cases.length ? (
            <div className="rating-list">
              {cases.map((c) => (
                <RatingCard
                  key={`${condition}-${c.case_id}`}
                  data={c}
                  token={auth.token}
                  onError={onError}
                  onSaved={() => setRefresh((v) => v + 1)}
                />
              ))}
            </div>
          ) : (
            <Empty
              icon={<FlaskConical size={28} />}
              title="The study begins with a conversation"
            >
              Complete participant sessions to create evidence cases. No ratings
              or research results have been invented.
            </Empty>
          )}
        </>
      ) : loading ? (
        <Skeleton rows={3} height={120} />
      ) : metrics ? (
        <>
          <div className="metrics-summary">
            <div className="panel">
              <span className="eyebrow">HUMAN RATER AGREEMENT</span>
              <strong className="metric-value">
                {metric(metrics.inter_rater?.kappa)}
              </strong>
              <span className="small muted">
                Cohen’s κ · {metrics.inter_rater?.n || 0} pairs
              </span>
            </div>
            <div className="panel">
              <span className="eyebrow">FOLLOW-UP APPROPRIATENESS</span>
              <strong className="metric-value">
                {metric(metrics.follow_up_appropriateness)}
                <small> / 5</small>
              </strong>
              <span className="small muted">Human rating average</span>
            </div>
            <div className="panel">
              <span className="eyebrow">FEEDBACK USEFULNESS</span>
              <strong className="metric-value">
                {metric(metrics.feedback_usefulness)}
                <small> / 5</small>
              </strong>
              <span className="small muted">Human rating average</span>
            </div>
          </div>
          <section className="panel">
            <h2>Condition comparison</h2>
            <p className="muted">
              Server-computed predictions against independent ratings. A dash
              means there are insufficient pairs.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Condition</th>
                    <th>Pairs</th>
                    <th>Answer accuracy</th>
                    <th>Answer macro F1</th>
                    <th>Answer κ</th>
                    <th>Gap accuracy</th>
                    <th>Gap macro F1</th>
                    <th>Gap κ</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.conditions.map((c) => (
                    <tr key={c.condition}>
                      <th>{c.condition}</th>
                      <td>{c.n}</td>
                      <td>{metric(c.answer_accuracy)}</td>
                      <td>{metric(c.answer_macro_f1)}</td>
                      <td>{metric(c.answer_kappa)}</td>
                      <td>{metric(c.gap_accuracy)}</td>
                      <td>{metric(c.gap_macro_f1)}</td>
                      <td>{metric(c.gap_kappa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <h2>Study notes</h2>
            <ul className="plain-list">
              {metrics.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </>
  );
}
function metric(n: number | null | undefined) {
  return n == null ? "n/a" : n.toFixed(3);
}
function RatingCard({
  data,
  token,
  onError,
  onSaved,
}: {
  data: Case;
  token: string;
  onError: (s: string) => void;
  onSaved: () => void;
}) {
  const [rating, setRating] = useState<Rating>(
      data.my_rating || { answer_state: "", gap_outcome: "", notes: "" },
    ),
    [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await api("/evaluation/ratings", token, {
        case_id: data.case_id,
        condition: data.condition,
        ...rating,
      });
      onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <div className="eyebrow">
            {data.topic} · CONDITION {data.condition}
          </div>
          <h2>{data.concept}</h2>
        </div>
        <Badge tone={data.my_rating ? "green" : "neutral"}>
          {data.my_rating ? "Your rating saved" : "Awaiting your rating"}
        </Badge>
      </div>
      {data.c01_mastery && (
        <p className="small muted">
          C01 mastery (reference only): {data.c01_mastery.mastery}% · {data.c01_mastery.source}
        </p>
      )}
      <div className="blind-evidence">
        {data.turns.map((t, i) => (
          <article key={t.id}>
            <span className="small muted">
              {i === 0 ? "Initial answer" : `Follow-up ${t.depth}`} ·{" "}
              {t.input_mode}
            </span>
            <h3>{t.question}</h3>
            <blockquote>{t.transcript}</blockquote>
            {data.condition === "C" && t.hesitation && (
              <details>
                <summary>Available hesitation evidence</summary>
                <pre>{JSON.stringify(t.hesitation, null, 2)}</pre>
              </details>
            )}
          </article>
        ))}
      </div>
      <div className="two-columns">
        <div className="field">
          <label htmlFor={`state-${data.case_id}`}>Answer classification</label>
          <select
            id={`state-${data.case_id}`}
            value={rating.answer_state}
            onChange={(e) =>
              setRating({ ...rating, answer_state: e.target.value })
            }
          >
            <option value="">Choose a classification</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`gap-${data.case_id}`}>Gap interpretation</label>
          <select
            id={`gap-${data.case_id}`}
            value={rating.gap_outcome}
            onChange={(e) =>
              setRating({ ...rating, gap_outcome: e.target.value })
            }
          >
            <option value="">Choose an interpretation</option>
            {Object.entries(gapLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="two-columns">
        <div className="field">
          <label htmlFor={`follow-${data.case_id}`}>
            Follow-up appropriateness (optional)
          </label>
          <select
            id={`follow-${data.case_id}`}
            disabled={data.condition === "A"}
            value={rating.follow_up_appropriateness || ""}
            onChange={(e) =>
              setRating({
                ...rating,
                follow_up_appropriateness: e.target.value
                  ? Number(e.target.value)
                  : undefined,
              })
            }
          >
            <option value="">Not assessed</option>
            {[1, 2, 3, 4, 5].map((i) => (
              <option key={i} value={i}>
                {i} / 5
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`feedback-${data.case_id}`}>
            Feedback usefulness (optional)
          </label>
          <select
            id={`feedback-${data.case_id}`}
            value={rating.feedback_usefulness || ""}
            onChange={(e) =>
              setRating({
                ...rating,
                feedback_usefulness: e.target.value
                  ? Number(e.target.value)
                  : undefined,
              })
            }
          >
            <option value="">Not assessed / not shown</option>
            {[1, 2, 3, 4, 5].map((i) => (
              <option key={i} value={i}>
                {i} / 5
              </option>
            ))}
          </select>
          <p className="field-help">
            Leave unassessed unless feedback was reviewed separately under your
            study protocol.
          </p>
        </div>
      </div>
      <div className="field">
        <label htmlFor={`notes-${data.case_id}`}>Evidence notes</label>
        <textarea
          id={`notes-${data.case_id}`}
          rows={3}
          value={rating.notes || ""}
          onChange={(e) => setRating({ ...rating, notes: e.target.value })}
          placeholder="What in the response supports your rating?"
        />
      </div>
      <button
        className="button primary"
        disabled={saving || !rating.answer_state || !rating.gap_outcome}
        onClick={save}
      >
        <Save size={16} />
        {saving
          ? "Saving…"
          : data.my_rating
            ? "Update my rating"
            : "Save independent rating"}
      </button>
    </section>
  );
}
