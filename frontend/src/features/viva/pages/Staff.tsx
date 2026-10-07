import { useEffect, useState } from "react";
import {
  BookOpenCheck,
  Check,
  ChevronDown,
  Download,
  FlaskConical,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, downloadJson, gapLabels, label } from "../api/client";
import type { Auth, BankQuestion, Case, Metrics, Rating, Topic } from "../api/types";
import { Badge, Busy, Empty, Modal, PageTitle } from "../components/components";
import Courses from '../pages/Courses';
export function Bank({
  auth,
  topics,
  onError,
  onTopicsChanged,
}: {
  auth: Auth;
  topics: Topic[];
  onError: (s: string) => void;
  onTopicsChanged: () => Promise<void>;
}) {
  const [topic, setTopic] = useState(topics[0]?.id || ""),
    [status, setStatus] = useState("all"),
    [items, setItems] = useState<BankQuestion[]>([]),
    [loading, setLoading] = useState(false),
    [working, setWorking] = useState(false),
    [edit, setEdit] = useState<BankQuestion | null>(null),
    [nested, setNested] = useState(""),
    [message, setMessage] = useState("");
  async function load() {
    setLoading(true);
    try {
      setItems(
        (
          await api<{ items: BankQuestion[] }>(
            `/bank?status=${status}${topic ? `&topic_id=${topic}` : ""}`,
            auth.token,
          )
        ).items,
      );
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [topic, status, auth.token]);
  async function generate() {
    setWorking(true);
    setMessage("");
    try {
      const result = await api<{ items: BankQuestion[]; provider: string }>(
        "/bank/generate",
        auth.token,
        { topic_id: topic, count: 2 },
      );
      setMessage(
        `${result.items.length} draft questions created · Provider: ${result.provider}. Review source material and every rubric before approval.`,
      );
      await load();
      await onTopicsChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function review(q: BankQuestion, newStatus: string) {
    setWorking(true);
    try {
      await api(`/bank/${q.id}/review`, auth.token, {
        status: newStatus,
        review_notes: q.review_notes || "",
      });
      await load();
      await onTopicsChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  function open(q: BankQuestion) {
    setEdit({ ...q });
    setNested(
      JSON.stringify(
        {
          rubric_points: q.rubric_points,
          misconceptions: q.misconceptions,
          follow_ups: q.follow_ups,
          sources: q.sources,
        },
        null,
        2,
      ),
    );
  }
  async function save() {
    if (!edit) return;
    setWorking(true);
    try {
      const parsed = JSON.parse(nested);
      await api(`/bank/${edit.id}`, auth.token, { ...edit, ...parsed }, "PUT");
      setEdit(null);
      setMessage(
        "Revision saved. Edited questions require approval before use in new sessions.",
      );
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="CONTENT STUDIO · ADMIN"
        title="A bank of better questions."
        description="Review the question, the evidence, and the next step before it reaches a learner."
        action={
          <button
            className="button primary"
            disabled={working || !topic}
            onClick={generate}
          >
            <Plus size={17} />
            {working ? "Working…" : "Generate 2 drafts"}
          </button>
        }
      />
      <div className="notice">
        <ShieldCheck size={19} />
        <span>
          Only approved questions are used in new sessions. Sample seeds are
          explicitly identified; generated content always starts as a draft.
        </span>
      </div>
      <Courses auth={auth} onChanged={onTopicsChanged} onError={onError} />
      {message && (
        <div className="notice success" role="status">
          {message}
        </div>
      )}
      <div className="filter-bar">
        <label>
          Topic
          <select value={topic} onChange={(e) => setTopic(e.target.value)}>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {["all", "draft", "approved", "rejected"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <span className="small muted">{items.length} questions</span>
        <button
          className="icon-button"
          aria-label="Refresh question bank"
          onClick={load}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {loading ? (
        <Busy />
      ) : items.length ? (
        <div className="bank-list">
          {items.map((q) => (
            <article className="panel bank-card" key={q.id}>
              <div className="section-heading">
                <div className="tag-row">
                  <Badge
                    tone={
                      q.status === "approved"
                        ? "green"
                        : q.status === "draft"
                          ? "amber"
                          : "neutral"
                    }
                  >
                    {label(q.status)}
                  </Badge>
                  <Badge>{q.origin}</Badge>
                </div>
                <span className="small muted">Version {q.version}</span>
              </div>
              <div className="eyebrow">{q.concept}</div>
              <h2>{q.question}</h2>
              <details>
                <summary>
                  Review answer, rubric, follow-ups & sources
                  <ChevronDown size={16} />
                </summary>
                <h3>Reference answer</h3>
                <p>{q.reference_answer}</p>
                <h3>Rubric points</h3>
                <ul className="plain-list">
                  {q.rubric_points.map((p) => (
                    <li key={p.id}>
                      <strong>{p.point}</strong>
                      {p.probe && <p className="small">Follow-up: {p.probe}</p>}
                      {p.evidence_quote && <p className="small">Evidence: “{p.evidence_quote}” · Sources {p.source_indices?.map(i => i + 1).join(', ')}</p>}
                      <span className="small muted">
                        {" "}
                        · Keywords: {p.keywords.join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
                <h3>Misconceptions</h3>
                <ul className="plain-list">
                  {q.misconceptions.map((m) => (
                    <li key={m.id}>
                      {m.description}
                      <span className="small muted">
                        {" "}
                        · {m.keywords.join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
                <h3>Follow-up prompts</h3>
                <dl className="followup-list">
                  {Object.entries(q.follow_ups).map(([state, prompt]) => (
                    <div key={state}>
                      <dt>{label(state)}</dt>
                      <dd>
                        {typeof prompt === "string"
                          ? prompt
                          : JSON.stringify(prompt)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <h3>Source grounding</h3>
                {q.sources.map((s, i) => (
                  <p key={i}>
                    <strong>
                      {s.source}
                      {s.page != null ? ` · page ${s.page}` : ""}
                    </strong>
                    {s.text && (
                      <>
                        <br />
                        {s.text}
                      </>
                    )}
                  </p>
                ))}
                {q.review_notes && (
                  <p>
                    <strong>Review notes:</strong> {q.review_notes}
                  </p>
                )}
              </details>
              <div className="card-actions">
                <button className="button secondary" onClick={() => open(q)}>
                  <Pencil size={15} />
                  Edit & annotate
                </button>
                <div className="button-row">
                  {q.status !== "rejected" && (
                    <button
                      className="button subtle"
                      disabled={working}
                      onClick={() => review(q, "rejected")}
                    >
                      <X size={15} />
                      Reject
                    </button>
                  )}
                  {q.status !== "approved" && (
                    <button
                      className="button primary"
                      disabled={working}
                      onClick={() => review(q, "approved")}
                    >
                      <Check size={16} />
                      Approve
                    </button>
                  )}
                  {q.status === "approved" && (
                    <button
                      className="button subtle"
                      disabled={working}
                      onClick={() => review(q, "draft")}
                    >
                      Return to draft
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          icon={<BookOpenCheck size={28} />}
          title="No questions in this view"
        >
          Generate drafts or choose a different topic or status.
        </Empty>
      )}
      {edit && (
        <Modal title="Review question revision" onClose={() => setEdit(null)}>
          <div className="notice">
            Saving changes invalidates approval for future sessions. Existing
            session snapshots stay unchanged.
          </div>
          <div className="field">
            <label htmlFor="edit-concept">Concept</label>
            <input
              id="edit-concept"
              value={edit.concept}
              onChange={(e) => setEdit({ ...edit, concept: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-question">Question</label>
            <textarea
              id="edit-question"
              rows={3}
              value={edit.question}
              onChange={(e) => setEdit({ ...edit, question: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="edit-answer">Reference answer</label>
            <textarea
              id="edit-answer"
              rows={4}
              value={edit.reference_answer}
              onChange={(e) =>
                setEdit({ ...edit, reference_answer: e.target.value })
              }
            />
          </div>
          <div className="field">
            <label htmlFor="edit-criteria">
              Rubrics, misconceptions, follow-ups and sources · JSON
            </label>
            <textarea
              className="code-input"
              id="edit-criteria"
              rows={16}
              value={nested}
              onChange={(e) => setNested(e.target.value)}
              spellCheck={false}
            />
            <p className="field-help">
              Preserve field names and valid JSON. Every nested field is
              editable.
            </p>
          </div>
          <div className="field">
            <label htmlFor="edit-notes">Review notes</label>
            <textarea
              id="edit-notes"
              rows={3}
              value={edit.review_notes || ""}
              onChange={(e) =>
                setEdit({ ...edit, review_notes: e.target.value })
              }
            />
          </div>
          <button className="button primary" disabled={working} onClick={save}>
            <Save size={17} />
            Save draft revision
          </button>
        </Modal>
      )}
    </>
  );
}
const states = [
  "complete",
  "partial",
  "superficial",
  "incorrect",
  "misconception_bearing",
  "non_answer",
];
export function Research({
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
            <Busy />
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
        <Busy />
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
