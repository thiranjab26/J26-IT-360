import { useEffect, useState } from "react";
import { BookOpenCheck, Check, ChevronDown, Pencil, RefreshCw, Sparkles, X } from "lucide-react";
import { api, label } from "../api/client";
import type { Auth, BankQuestion, Topic } from "../api/types";
import { Badge, Empty, Modal, PageTitle, Skeleton } from "../components/components";
import Courses, { Step } from "../pages/Courses";
import { QuestionEditor } from "../components/QuestionEditor";

/** Question bank: course, material, generation, then review and approval. */
export default function Bank({
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
    [status, setStatus] = useState<"draft" | "approved" | "rejected" | "all">("draft"),
    [count, setCount] = useState(3),
    [items, setItems] = useState<BankQuestion[]>([]),
    [loading, setLoading] = useState(false),
    [working, setWorking] = useState(false),
    [edit, setEdit] = useState<BankQuestion | null>(null),
    [saved, setSaved] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (!topic && topics[0]) setTopic(topics[0].id);
  }, [topics]);
  async function load() {
    if (!topic) return setItems([]);
    setLoading(true);
    try {
      setItems((await api<{ items: BankQuestion[] }>(`/bank?status=all&topic_id=${topic}`, auth.token)).items);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setMessage("");
    void load();
  }, [topic, auth.token]);
  const tally = (s: string) => items.filter((q) => q.status === s).length;
  const shown = status === "all" ? items : items.filter((q) => q.status === status);
  async function generate() {
    setWorking(true);
    setMessage("");
    try {
      const result = await api<{ items: BankQuestion[]; provider: string }>(
        "/bank/generate",
        auth.token,
        { topic_id: topic, count },
      );
      setMessage(
        `${result.items.length} new questions are waiting for your review in step 4.`,
      );
      setStatus("draft");
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
  async function save(question: BankQuestion) {
    setWorking(true);
    try {
      await api(`/bank/${question.id}`, auth.token, question, "PUT");
      setEdit(null);
      setSaved(`"${question.concept}" saved. It is back in Waiting for review; approve it again before students get it.`);
      setStatus("draft");
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
        eyebrow="QUESTION BANK · ADMIN"
        title="Create viva questions"
        description="Four steps: choose a course, add its material, generate questions, then approve the ones students should get."
      />
      <ol className="bank-flow" aria-label="Steps">
        {["Course", "Material", "Generate", "Review and approve"].map((t, i) => (
          <li key={t}><span>{i + 1}</span>{t}</li>
        ))}
      </ol>
      <Courses
        auth={auth}
        topics={topics}
        selected={topic}
        onSelect={setTopic}
        onChanged={onTopicsChanged}
        onError={onError}
      />
      <Step
        n={3}
        title="Generate questions"
        hint="AI writes draft questions, model answers and marking points from the course material. Nothing reaches students yet."
        done={items.length > 0}
      >
        <div className="bank-step-row">
          <label className="field-inline">
            How many
            <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <button className="button primary" disabled={working || !topic} onClick={generate}>
            <Sparkles size={17} />
            {working ? "Generating, this can take a minute…" : `Generate ${count} question${count > 1 ? "s" : ""} from course material`}
          </button>
        </div>
        {message && (
          <div className="notice success" role="status">
            {message}
          </div>
        )}
      </Step>
      <Step
        n={4}
        title="Review and approve"
        hint="Read each question and its marking points. Only approved questions are asked in new vivas."
        done={tally("approved") > 0 && tally("draft") === 0}
      >
        {saved && (
          <div className="notice success" role="status">
            {saved}
          </div>
        )}
        <div className="filter-bar">
          <div className="tab-bar">
            {([
              ["draft", `Waiting for review (${tally("draft")})`],
              ["approved", `Approved (${tally("approved")})`],
              ["rejected", `Rejected (${tally("rejected")})`],
              ["all", `All (${items.length})`],
            ] as const).map(([s, l]) => (
              <button key={s} className={status === s ? "selected" : ""} onClick={() => setStatus(s)}>
                {l}
              </button>
            ))}
          </div>
          <button className="icon-button" aria-label="Refresh questions" onClick={load}>
            <RefreshCw size={17} />
          </button>
        </div>
      {loading ? (
        <Skeleton rows={3} height={150} />
      ) : shown.length ? (
        <div className="bank-list">
          {shown.map((q) => (
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
                  Show model answer, marking points and sources
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
                <button className="button secondary" onClick={() => { setSaved(""); setEdit(q); }}>
                  <Pencil size={15} />
                  Edit question
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
          title={status === "draft" ? "Nothing waiting for review" : "No questions here"}
        >
          {items.length ? "Try another tab above." : "Generate questions in step 3."}
        </Empty>
      )}
      </Step>
      {edit && (
        <Modal title="Edit question" onClose={() => setEdit(null)}>
          <QuestionEditor question={edit} working={working} onSave={save} />
        </Modal>
      )}
    </>
  );
}
