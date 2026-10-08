import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import type { BankQuestion } from "../api/types";

/** The five stored follow-ups, keyed by answer state, with plain names for staff. */
const FOLLOW_UPS: [string, string, string][] = [
  ["partial", "Partly correct", "Some marking points are there, others are missing."],
  ["superficial", "Too shallow", "Names the idea but does not explain it."],
  ["incorrect", "Incorrect", "The answer is wrong."],
  ["misconception_bearing", "Holds a misconception", "The answer contains one of the misconceptions above."],
  ["non_answer", "No answer", "The student did not answer or said they do not know."],
];
const MAX_ITEMS = 12;
const MAX_WORDS = 30;

type Point = { id: string; point: string; keywords: string; probe: string; evidence_quote: string; source_indices: number[] };
type Wrong = { id: string; description: string; keywords: string };
type Form = {
  concept: string;
  question: string;
  reference_answer: string;
  review_notes: string;
  points: Point[];
  misconceptions: Wrong[];
  follow_ups: Record<string, string>;
};

const words = (s: string) => s.split(",").map((w) => w.trim()).filter(Boolean);
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

function toForm(q: BankQuestion): Form {
  return {
    concept: q.concept,
    question: q.question,
    reference_answer: q.reference_answer,
    review_notes: q.review_notes || "",
    points: q.rubric_points.map((p) => ({
      id: p.id,
      point: p.point,
      keywords: p.keywords.join(", "),
      probe: p.probe || "",
      evidence_quote: p.evidence_quote || "",
      source_indices: p.source_indices || [],
    })),
    misconceptions: q.misconceptions.map((m) => ({ id: m.id, description: m.description, keywords: m.keywords.join(", ") })),
    follow_ups: { ...q.follow_ups },
  };
}

function toQuestion(q: BankQuestion, f: Form): BankQuestion {
  return {
    ...q,
    concept: f.concept.trim(),
    question: f.question.trim(),
    reference_answer: f.reference_answer.trim(),
    review_notes: f.review_notes.trim(),
    rubric_points: f.points.map((p) => ({
      id: p.id,
      point: p.point.trim(),
      keywords: words(p.keywords),
      ...(p.probe.trim() ? { probe: p.probe.trim() } : {}),
      ...(p.evidence_quote.trim() ? { evidence_quote: p.evidence_quote.trim() } : {}),
      source_indices: p.source_indices,
    })),
    misconceptions: f.misconceptions.map((m) => ({ id: m.id, description: m.description.trim(), keywords: words(m.keywords) })),
    follow_ups: Object.fromEntries(FOLLOW_UPS.map(([key]) => [key, (f.follow_ups[key] || "").trim()])),
  };
}

/** What blocks saving, in the order the fields appear. Mirrors the server's bank schema. */
function problems(f: Form) {
  const out: string[] = [];
  if (!f.concept.trim()) out.push("Add the concept name.");
  if (f.question.trim().length < 5) out.push("The question needs at least 5 characters.");
  if (f.reference_answer.trim().length < 5) out.push("The model answer needs at least 5 characters.");
  if (!f.points.length) out.push("Add at least one marking point.");
  f.points.forEach((p, i) => {
    if (!p.point.trim()) out.push(`Marking point ${i + 1}: say what the answer must contain.`);
    const n = words(p.keywords).length;
    if (!n || n > MAX_WORDS) out.push(`Marking point ${i + 1}: give 1 to ${MAX_WORDS} key words.`);
    if (p.probe.trim() && p.probe.trim().length < 5) out.push(`Marking point ${i + 1}: the follow-up question is too short.`);
  });
  f.misconceptions.forEach((m, i) => {
    if (!m.description.trim()) out.push(`Misconception ${i + 1}: describe the wrong belief.`);
    const n = words(m.keywords).length;
    if (!n || n > MAX_WORDS) out.push(`Misconception ${i + 1}: give 1 to ${MAX_WORDS} key words.`);
  });
  FOLLOW_UPS.forEach(([key, name]) => {
    if ((f.follow_ups[key] || "").trim().length < 5) out.push(`Follow-up for "${name}": at least 5 characters.`);
  });
  return out;
}

export function QuestionEditor({
  question,
  working,
  onSave,
}: {
  question: BankQuestion;
  working: boolean;
  onSave: (q: BankQuestion) => void;
}) {
  const [form, setForm] = useState(() => toForm(question));
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const setPoint = (i: number, patch: Partial<Point>) =>
    set({ points: form.points.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const setWrong = (i: number, patch: Partial<Wrong>) =>
    set({ misconceptions: form.misconceptions.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const blocking = problems(form);
  // Uploaded courses are checked against their material when approved; seed topics are not.
  const unlinked = form.points.filter((p) => !p.probe.trim() || !p.evidence_quote.trim() || !p.source_indices.length).length;
  const sourceName = (i: number) => {
    const s = question.sources[i];
    return s ? `${i + 1}. ${s.source}${s.page != null ? `, page ${s.page}` : ""}` : `${i + 1}`;
  };

  return (
    <div className="qe">
      <div className="notice">
        Saving moves this question back to "Waiting for review". Approve it again before students get it. Sessions already started keep their old copy.
      </div>

      <section className="qe-section">
        <h3>The question</h3>
        <label>Concept<input value={form.concept} maxLength={150} onChange={(e) => set({ concept: e.target.value })} /></label>
        <label>Question asked to the student<textarea rows={3} maxLength={2000} value={form.question} onChange={(e) => set({ question: e.target.value })} /></label>
        <label>Model answer<textarea rows={4} maxLength={6000} value={form.reference_answer} onChange={(e) => set({ reference_answer: e.target.value })} /></label>
      </section>

      <section className="qe-section">
        <h3>Marking points</h3>
        <p className="field-help">Each point is one idea a complete answer must contain. The answer is marked against these.</p>
        {form.points.map((p, i) => (
          <fieldset className="qe-item" key={p.id}>
            <legend>Marking point {i + 1}</legend>
            <label>What the answer must contain<textarea rows={2} maxLength={1000} value={p.point} onChange={(e) => setPoint(i, { point: e.target.value })} /></label>
            <label>Key words, separated by commas<input value={p.keywords} onChange={(e) => setPoint(i, { keywords: e.target.value })} placeholder="e.g. last in first out, LIFO" /></label>
            <p className="field-help">Used to spot this point in an answer, and to stop follow-up questions from giving it away.</p>
            <label>Follow-up question when this point is missing<textarea rows={2} maxLength={1000} value={p.probe} onChange={(e) => setPoint(i, { probe: e.target.value })} /></label>
            <p className="field-help">Ask about the point without stating it. The AI adapts this wording to what the student said.</p>
            <details>
              <summary>Course evidence {p.evidence_quote.trim() && p.source_indices.length ? "(linked)" : "(not linked)"}</summary>
              <label>Quote from the course material<textarea rows={2} maxLength={1600} value={p.evidence_quote} onChange={(e) => setPoint(i, { evidence_quote: e.target.value })} /></label>
              <div className="qe-sources" role="group" aria-label={`Sources for marking point ${i + 1}`}>
                {question.sources.map((_, s) => (
                  <label key={s} className="qe-check">
                    <input
                      type="checkbox"
                      checked={p.source_indices.includes(s)}
                      onChange={(e) =>
                        setPoint(i, {
                          source_indices: e.target.checked ? [...p.source_indices, s].sort((a, b) => a - b) : p.source_indices.filter((x) => x !== s),
                        })
                      }
                    />
                    {sourceName(s)}
                  </label>
                ))}
              </div>
              <p className="field-help">For uploaded courses, approval needs a follow-up question and a quote copied exactly from a ticked source.</p>
            </details>
            <button type="button" className="text-button qe-remove" disabled={form.points.length < 2} onClick={() => set({ points: form.points.filter((_, j) => j !== i) })}>
              <Trash2 size={14} /> Remove this point
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="button secondary"
          disabled={form.points.length >= MAX_ITEMS}
          onClick={() => set({ points: [...form.points, { id: newId("r"), point: "", keywords: "", probe: "", evidence_quote: "", source_indices: [] }] })}
        >
          <Plus size={15} /> Add marking point
        </button>
      </section>

      <section className="qe-section">
        <h3>Common misconceptions</h3>
        <p className="field-help">Wrong beliefs students often hold about this concept. An answer containing one is marked "holds a misconception".</p>
        {form.misconceptions.map((m, i) => (
          <fieldset className="qe-item" key={m.id}>
            <legend>Misconception {i + 1}</legend>
            <label>The wrong belief<textarea rows={2} maxLength={1000} value={m.description} onChange={(e) => setWrong(i, { description: e.target.value })} /></label>
            <label>Key words that show it, separated by commas<input value={m.keywords} onChange={(e) => setWrong(i, { keywords: e.target.value })} /></label>
            <button type="button" className="text-button qe-remove" onClick={() => set({ misconceptions: form.misconceptions.filter((_, j) => j !== i) })}>
              <Trash2 size={14} /> Remove this misconception
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="button secondary"
          disabled={form.misconceptions.length >= MAX_ITEMS}
          onClick={() => set({ misconceptions: [...form.misconceptions, { id: newId("m"), description: "", keywords: "" }] })}
        >
          <Plus size={15} /> Add misconception
        </button>
      </section>

      <section className="qe-section">
        <h3>Backup follow-up questions</h3>
        <p className="field-help">Used when the AI wording is unavailable or rejected. One per type of answer.</p>
        {FOLLOW_UPS.map(([key, name, hint]) => (
          <label key={key}>
            {name} <span className="small muted">· {hint}</span>
            <textarea rows={2} maxLength={1500} value={form.follow_ups[key] || ""} onChange={(e) => set({ follow_ups: { ...form.follow_ups, [key]: e.target.value } })} />
          </label>
        ))}
      </section>

      <section className="qe-section">
        <h3>Course sources</h3>
        <p className="field-help">Taken from the course material, so they cannot be edited here.</p>
        {question.sources.map((s, i) => (
          <details key={i}>
            <summary>{sourceName(i)}</summary>
            <p className="small">{s.text || "No excerpt stored."}</p>
          </details>
        ))}
      </section>

      <section className="qe-section">
        <label>Review notes<textarea rows={3} maxLength={4000} value={form.review_notes} onChange={(e) => set({ review_notes: e.target.value })} /></label>
      </section>

      {blocking.length > 0 ? (
        <div className="notice" role="status">
          <strong>Fix before saving</strong>
          <ul className="plain-list">{blocking.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      ) : unlinked > 0 ? (
        <p className="field-help">
          {unlinked} marking {unlinked === 1 ? "point has" : "points have"} no follow-up question or course evidence. Fine for built-in sample topics; uploaded courses need both to be approved.
        </p>
      ) : null}
      <button className="button primary" disabled={working || blocking.length > 0} onClick={() => onSave(toQuestion(question, form))}>
        <Save size={17} />
        {working ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}
