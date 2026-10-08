import { useEffect, useState, type ReactNode } from 'react';
import { FileText, Plus, Upload } from 'lucide-react';
import { api } from '../api/client';
import type { Auth, Topic } from '../api/types';
type Course = { id: string; name: string; description: string; materials: { id: string; name: string; chunk_count: number }[] };
type Usage = { counters: { scope: string; used: number; resets_at: number }[]; limits: Record<string, number>; notes: string };

/** One numbered card in the question bank flow. */
export function Step({ n, title, hint, done, children }: { n: number; title: string; hint: string; done?: boolean; children: ReactNode }) {
  return <section className={`panel bank-step ${done ? 'done' : ''}`}>
    <div className="bank-step-head">
      <span className="bank-step-n">{done ? '✓' : n}</span>
      <div><h2>{title}</h2><p className="small muted">{hint}</p></div>
    </div>
    {children}
  </section>;
}

/** Steps 1 and 2: pick or create a course, then give it source material. */
export default function Courses({ auth, topics, selected, onSelect, onChanged, onError }: {
  auth: Auth; topics: Topic[]; selected: string; onSelect: (id: string) => void;
  onChanged: () => Promise<void>; onError: (s: string) => void;
}) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [text, setText] = useState('');
  const [sourceName, setSourceName] = useState('Course notes');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<{ source: string; page: number | null; text: string }[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  async function load() {
    const [c, u] = await Promise.all([api<{ items: Course[] }>('/courses', auth.token), api<Usage>('/usage', auth.token)]);
    setCourses(c.items); setUsage(u);
  }
  useEffect(() => { void load().catch(e => onError(e.message)); }, [auth.token]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await action(); await load(); await onChanged(); }
    catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  }
  const course = courses.find(c => c.id === selected);
  const sample = !!selected && !course;
  return <>
    <Step n={1} title="Choose a course" hint="Each course becomes one viva topic that students can pick." done={!!selected && !creating}>
      <div className="bank-step-row">
        <label className="field-inline">Course
          <select value={selected} onChange={e => { onSelect(e.target.value); setPreview([]); setMessage(''); }}>
            {!selected && <option value="">Select a course</option>}
            {topics.map(t => <option value={t.id} key={t.id}>{t.name}{courses.some(c => c.id === t.id) ? '' : ' (built-in sample)'}</option>)}
          </select>
        </label>
        <button className="button secondary" onClick={() => setCreating(v => !v)}><Plus size={16} />{creating ? 'Cancel' : 'New course'}</button>
      </div>
      {creating && <form className="bank-form" onSubmit={e => { e.preventDefault(); void run(async () => {
        const c = await api<Course>('/courses', auth.token, { name: name.trim(), description });
        onSelect(c.id); setName(''); setDescription(''); setCreating(false);
        setMessage(`Course "${c.name}" created. Now add its material in step 2.`);
      }); }}>
        <label>Course name<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={150} required placeholder="e.g. Database Systems" /></label>
        <label>Topics and learning objectives (optional)<textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} rows={2} /></label>
        <button className="button primary" disabled={busy || name.trim().length < 2}>Create course</button>
      </form>}
    </Step>

    <Step n={2} title="Add course material" hint="Questions are written only from this material, so add the notes or slides students studied." done={sample || !!course?.materials.length}>
      {!selected ? <p className="muted">Choose a course in step 1 first.</p>
        : sample ? <p className="muted">This built-in sample topic already has its material. Go to step 3.</p>
        : <>
          {course && course.materials.length > 0 && <ul className="bank-materials">
            {course.materials.map(m => <li key={m.id}><FileText size={16} /><span>{m.name}<small className="muted"> · {m.chunk_count} excerpts</small></span>
              <button className="text-button" onClick={() => void api<{ chunks: typeof preview }>(`/courses/${selected}/materials/${m.id}`, auth.token).then(r => setPreview(r.chunks)).catch(e => onError(e.message))}>View text</button>
            </li>)}
          </ul>}
          {preview.length > 0 && <details open><summary>Extracted text</summary><div className="source-preview">{preview.map((c, i) => <p key={i}><strong>{c.source}{c.page ? ` · page ${c.page}` : ''}</strong><br />{c.text}</p>)}</div></details>}
          <div className="tab-bar">
            <button className={mode === 'file' ? 'selected' : ''} onClick={() => setMode('file')}>Upload a file</button>
            <button className={mode === 'text' ? 'selected' : ''} onClick={() => setMode('text')}>Paste text</button>
          </div>
          {mode === 'file' ? <div className="bank-form">
            <label>PDF, TXT or Markdown file<input type="file" accept=".txt,.md,.pdf" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
            <p className="small muted">Up to 5 MB and 100 pages. Scanned PDFs need OCR first.</p>
            <button className="button primary" disabled={busy || !file} onClick={() => void run(async () => {
              if (!file) return;
              const form = new FormData(); form.append('file', file);
              const result = await api<{ chunk_count: number; duplicate: boolean }>(`/courses/${selected}/materials`, auth.token, form);
              setMessage(result.duplicate ? 'This file is already stored.' : `File saved as ${result.chunk_count} excerpts. Go to step 3.`);
            })}><Upload size={16} />{busy ? 'Uploading…' : 'Upload file'}</button>
          </div> : <div className="bank-form">
            <label>Title<input value={sourceName} onChange={e => setSourceName(e.target.value)} maxLength={190} /></label>
            <label>Text (at least 40 characters)<textarea value={text} onChange={e => setText(e.target.value)} maxLength={200000} rows={5} /></label>
            <button className="button primary" disabled={busy || text.trim().length < 40 || !sourceName.trim()} onClick={() => void run(async () => {
              const result = await api<{ duplicate: boolean }>(`/courses/${selected}/materials/text`, auth.token, { name: sourceName, text });
              setText(''); setMessage(result.duplicate ? 'This text is already stored.' : 'Text saved. Go to step 3.');
            })}>Save text</button>
          </div>}
        </>}
      {message && <p role="status" className="notice success">{message}</p>}
      <details className="small"><summary>API usage and daily limits</summary>
        <button className="text-button" onClick={() => void load().catch(e => onError(e.message))}>Refresh</button>
        {usage && <><p className="small muted">{usage.notes}</p>
          <ul>{Object.entries(usage.limits).map(([k, v]) => <li key={k}>{k.replaceAll('_', ' ')}: {v.toLocaleString()}</li>)}</ul>
          <ul>{usage.counters.map(c => <li key={c.scope}>{c.scope}: {c.used.toLocaleString()} used · resets {new Date(c.resets_at * 1000).toLocaleString()}</li>)}</ul>
        </>}
      </details>
    </Step>
  </>;
}
