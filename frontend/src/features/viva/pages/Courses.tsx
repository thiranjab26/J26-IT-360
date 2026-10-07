import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Auth } from '../api/types';
type Course = { id: string; name: string; description: string; materials: { id: string; name: string; chunk_count: number }[] };
type Usage = { counters: { scope: string; used: number; resets_at: number }[]; limits: Record<string, number>; notes: string };

export default function Courses({ auth, onChanged, onError }: { auth: Auth; onChanged: () => Promise<void>; onError: (s: string) => void }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
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
    setSelected(old => old || c.items[0]?.id || '');
  }
  useEffect(() => { void load().catch(e => onError(e.message)); }, [auth.token]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await action(); await load(); await onChanged(); }
    catch (e) { onError((e as Error).message); }
    finally { setBusy(false); }
  }
  const course = courses.find(c => c.id === selected);
  return <section className="panel course-studio">
    <h2>Courses & source materials</h2>
    <p>Create a course, add readable source material, then select it below to generate draft questions. Each course appears as one viva topic.</p>
    <details>
      <summary>Create a course</summary>
      <form onSubmit={e => { e.preventDefault(); void run(async () => {
        const c = await api<Course>('/courses', auth.token, { name: name.trim(), description });
        setSelected(c.id); setName(''); setDescription(''); setMessage('Course created. Add source material next.');
      }); }}>
        <label>Course name<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={150} required /></label>
        <label>Topics and learning objectives<textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} rows={2} /></label>
        <button className="button primary" disabled={busy || name.trim().length < 2}>Create course</button>
      </form>
    </details>
    {courses.length > 0 && <>
      <label>Course to add material to<select value={selected} onChange={e => { setSelected(e.target.value); setPreview([]); }}>
        {courses.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}
      </select></label>
      <details>
        <summary>Add text or upload a file</summary>
        <label>Source title<input value={sourceName} onChange={e => setSourceName(e.target.value)} maxLength={190} /></label>
        <label>Paste course text<textarea value={text} onChange={e => setText(e.target.value)} maxLength={200000} rows={5} /></label>
        <button className="button secondary" disabled={busy || text.trim().length < 40 || !sourceName.trim()} onClick={() => void run(async () => {
          const result = await api<{ duplicate: boolean }>(`/courses/${selected}/materials/text`, auth.token, { name: sourceName, text });
          setText(''); setMessage(result.duplicate ? 'This material is already stored.' : 'Text saved. Review extracted content before generating drafts.');
        })}>Save text</button>
        <label>Upload text or PDF<input type="file" accept=".txt,.md,.pdf" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
        <p className="small muted">Up to 5 MB, 100 PDF pages, and 200,000 extracted characters by default. Scanned PDFs need OCR first.</p>
        <button className="button secondary" disabled={busy || !file} onClick={() => void run(async () => {
          if (!file) return;
          const form = new FormData(); form.append('file', file);
          const result = await api<{ chunk_count: number; duplicate: boolean }>(`/courses/${selected}/materials`, auth.token, form);
          setMessage(result.duplicate ? 'This material is already stored.' : `Material saved as ${result.chunk_count} source excerpts.`);
        })}>Upload material</button>
      </details>
      <ul className="plain-list">{course?.materials.map(m => <li key={m.id}>{m.name} · {m.chunk_count} excerpts{' '}
        <button className="text-button" onClick={() => void api<{ chunks: typeof preview }>(`/courses/${selected}/materials/${m.id}`, auth.token).then(r => setPreview(r.chunks)).catch(e => onError(e.message))}>Review extracted text</button>
      </li>)}</ul>
      {preview.length > 0 && <details open><summary>Extracted source text</summary><div className="source-preview">{preview.map((c, i) => <p key={i}><strong>{c.source}{c.page ? ` · page ${c.page}` : ''}</strong><br />{c.text}</p>)}</div></details>}
    </>}
    {message && <p role="status" className="notice success">{message}</p>}
    <details><summary>API usage & daily budgets</summary>
      <button className="text-button" onClick={() => void load().catch(e => onError(e.message))}>Refresh usage</button>
      {usage && <><p className="small muted">{usage.notes}</p>
        <ul>{Object.entries(usage.limits).map(([k, v]) => <li key={k}>{k.replaceAll('_', ' ')}: {v.toLocaleString()}</li>)}</ul>
        <ul>{usage.counters.map(c => <li key={c.scope}>{c.scope}: {c.used.toLocaleString()} used · resets {new Date(c.resets_at * 1000).toLocaleString()}</li>)}</ul>
      </>}
    </details>
  </section>;
}
