import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ApiError } from '@/shared/api/client';
import { useAuth } from '@/shared/auth/AuthProvider';
import { Badge, Banner, Card, cx } from '@/shared/components/ui';
import {
  useAuthorOverview,
  useGenerate,
  useJob,
  useReview,
  type AuthorItem,
  type BulkResult,
  type Job,
} from '../api/authorApi';
import { useModuleConcepts } from '../api/tutorApi';
import { fireConfetti, useCountUp } from '../components/fx';
import { GameButton } from '../components/GameButton';
import { BoltIcon, CheckIcon, SparkleIcon, TrophyIcon } from '../components/icons';
import { Companion, type Mood } from '../components/Mascot';
import { playCue } from '../components/sound';
import { CheckChips, Editor, Modal, OriginBadge, Preview } from '../components/StudioParts';

const MODULE = 'prog';

type Tab = 'drafts' | 'live' | 'history';

type EditorState =
  | { kind: 'new'; replaces: string }
  | { kind: 'edit'; item: AuthorItem }
  | { kind: 'copy'; item: AuthorItem };

/** The same compact button shape everywhere in a row of actions. */
const SMALL = 'px-[14px] py-[7px] text-[12px]';

/**
 * Where a lecturer decides what students practise. Ask Byte for drafts, or write one; each
 * draft arrives with its checks; approving one replaces the practical in that place for every
 * student, and the old one is kept in the history.
 */
export function StudioPage() {
  const { user } = useAuth();
  if (user?.role !== 'lecturer') {
    return (
      <Card className="px-[20px] py-[18px]">
        <p className="text-[13px] text-ink">The practical studio is for lecturers.</p>
      </Card>
    );
  }
  return <Studio />;
}

function Studio() {
  const concepts = useModuleConcepts(MODULE);
  const [picked, setPicked] = useState('');
  const flat = useMemo(
    () => concepts.data?.topics.flatMap((t) => t.concepts) ?? [],
    [concepts.data],
  );
  const conceptId = picked || flat[0]?.concept_id || '';
  const conceptTitle = flat.find((c) => c.concept_id === conceptId)?.name ?? conceptId;

  const overview = useAuthorOverview(conceptId);
  const generate = useGenerate();
  const review = useReview();

  const [count, setCount] = useState(3);
  const [hint, setHint] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const [tab, setTab] = useState<Tab>('drafts');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [notDone, setNotDone] = useState<BulkResult[]>([]);
  const [cheer, setCheer] = useState<string | null>(null);

  const data = overview.data;
  const running = job.data?.status === 'queued' || job.data?.status === 'running';

  // Switching concept drops whatever was ticked, so a bulk action never reaches across concepts.
  useEffect(() => {
    setSelected(new Set());
    setNotDone([]);
    setEditor(null);
    setCheer(null);
  }, [conceptId]);

  // A note of success that goes away by itself.
  useEffect(() => {
    if (!cheer) return;
    const timer = window.setTimeout(() => setCheer(null), 7000);
    return () => window.clearTimeout(timer);
  }, [cheer]);

  // A little fanfare when a batch has been made.
  const lastStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = job.data?.status;
    if (status === lastStatus.current) return;
    lastStatus.current = status;
    if (status === 'finished') playCue('correct');
    if (status === 'failed') playCue('wrong');
  }, [job.data?.status]);

  const startGenerate = (replaces?: string[]) => {
    setEditor(null);
    generate.mutate(
      {
        concept_id: conceptId,
        count: replaces ? replaces.length : count,
        hint: hint.trim() || null,
        replaces,
      },
      {
        onSuccess: (started) => {
          playCue('run');
          setJobId(started.job_id);
          setTab('drafts');
        },
      },
    );
  };

  const celebrate = (message: string, big = false) => {
    fireConfetti(big ? 'big' : 'small', { x: 0.5, y: 0.3 });
    playCue(big ? 'levelup' : 'clear');
    setCheer(message);
  };

  const approveOne = (draft: AuthorItem) =>
    review.approve.mutate(
      { practical_id: draft.practical_id, note: note.trim() || null },
      {
        onSuccess: (done) =>
          celebrate(`Approved. Students now see ${done.title}. The old one is kept in History.`),
      },
    );

  const rejectOne = (draft: AuthorItem) =>
    review.reject.mutate(
      { practical_id: draft.practical_id, note: note.trim() || null },
      { onSuccess: () => playCue('tap') },
    );

  const bulk = (kind: 'approve' | 'reject') => {
    const input = { practical_ids: [...selected], note: note.trim() || null };
    const action = kind === 'approve' ? review.approveMany : review.rejectMany;
    action.mutate(input, {
      onSuccess: (done) => {
        const ok = done.results.filter((r) => r.ok).length;
        setNotDone(done.results.filter((r) => !r.ok));
        setSelected(new Set());
        if (kind === 'approve' && ok > 0) {
          celebrate(
            `${ok} ${ok === 1 ? 'practical' : 'practicals'} approved and live for students.`,
            true,
          );
        } else {
          playCue('tap');
        }
      },
    });
  };

  const failure =
    generate.error ?? review.approve.error ?? review.reject.error ?? review.restore.error;
  const toggle = (id: string) =>
    setSelected((now) => {
      const next = new Set(now);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const placeOf = (slot: string) =>
    data?.current.find((c) => c.slot_id === slot)?.title ?? 'a new place';
  const approvable = data?.drafts.filter((d) => d.can_approve) ?? [];
  const waiting = data?.drafts.length ?? 0;
  const byLecturers = data?.current.filter((c) => c.origin !== 'authored').length ?? 0;

  const say = byteSays(job.data, waiting, running);

  return (
    <div className="flex flex-col gap-[18px]">
      <header>
        <p className="font-mono text-[11px] tracking-wide text-brand uppercase">Lecturer</p>
        <h1 className="mt-[2px] bg-gradient-to-r from-ink to-brand bg-clip-text text-[26px] font-extrabold tracking-tight text-transparent">
          Practical studio
        </h1>
        <Companion mood={say.mood} text={say.text} size={64} className="mt-[10px]" />
      </header>

      <div className="grid gap-[12px] sm:grid-cols-3">
        <Stat
          icon={<TrophyIcon className="size-[18px]" />}
          label="Live for students"
          value={data?.current.length ?? 0}
        />
        <Stat
          icon={<SparkleIcon className="size-[18px]" />}
          label="Waiting for your review"
          value={waiting}
          glow={waiting > 0}
        />
        <Stat
          icon={<BoltIcon className="size-[18px]" />}
          label="Added by lecturers"
          value={byLecturers}
        />
      </div>

      <Card className="neon-edge px-[18px] py-[16px]">
        <div className="flex flex-wrap items-end gap-[12px]">
          <label className="text-[12px] font-medium text-ink-soft">
            Concept
            <select
              value={conceptId}
              onChange={(e) => setPicked(e.target.value)}
              className="mt-[4px] block min-w-[220px] rounded-[10px] border-2 border-line bg-surface px-[10px] py-[7px] text-[13px] text-ink"
            >
              {concepts.data?.topics.map((topic) => (
                <optgroup key={topic.topic_id} label={topic.name}>
                  {topic.concepts.map((c) => (
                    <option key={c.concept_id} value={c.concept_id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="text-[12px] font-medium text-ink-soft">
            How many drafts
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="mt-[4px] block rounded-[10px] border-2 border-line bg-surface px-[10px] py-[7px] text-[13px] text-ink"
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[240px] flex-1 text-[12px] font-medium text-ink-soft">
            What do you want? (optional)
            <input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              maxLength={500}
              placeholder="for example: tracing loop variables, a counting problem"
              className="mt-[4px] block w-full rounded-[10px] border-2 border-line bg-surface px-[10px] py-[7px] text-[13px] text-ink focus:outline-none"
            />
          </label>
          <GameButton
            onClick={() => startGenerate()}
            busy={generate.isPending}
            disabled={!conceptId || running}
          >
            <SparkleIcon className="size-[14px]" />
            Generate drafts
          </GameButton>
          <GameButton
            variant="secondary"
            disabled={!conceptId}
            onClick={() =>
              setEditor({ kind: 'new', replaces: data?.current[0]?.practical_id ?? '' })
            }
          >
            Write one myself
          </GameButton>
        </div>
        <p className="mt-[8px] text-[11.5px] text-ink-faint">
          Each draft takes about half a minute and uses a few model requests. They are made one at a
          time and appear below as they are ready.
        </p>
      </Card>

      {cheer && (
        <div
          role="status"
          className="flex animate-pop-in items-center gap-[10px] rounded-[14px] border-2 border-gold bg-gold-wash px-[16px] py-[11px] text-[13px] font-semibold text-gold-ink"
        >
          <CheckIcon className="size-[16px] shrink-0" />
          {cheer}
        </div>
      )}

      {failure && (
        <Banner
          message={failure instanceof ApiError ? failure.message : 'Something went wrong.'}
          code={failure instanceof ApiError ? failure.code : undefined}
        />
      )}

      {job.data && <JobBar job={job.data} />}

      {editor && data && (
        <Modal label="Practical editor" onClose={() => setEditor(null)}>
          {editor.kind === 'new' && (
            <label className="mb-[8px] block rounded-[12px] bg-surface px-[14px] py-[9px] text-[12px] font-medium text-ink-soft">
              This takes the place of
              <select
                value={editor.replaces}
                onChange={(e) => setEditor({ kind: 'new', replaces: e.target.value })}
                className="ml-[8px] rounded-[8px] border border-line bg-surface px-[10px] py-[5px] text-[12.5px] text-ink"
              >
                {data.current.map((c) => (
                  <option key={c.practical_id} value={c.practical_id}>
                    {c.title}
                  </option>
                ))}
                <option value="">Nothing: add it as an extra practical</option>
              </select>
            </label>
          )}
          <Editor
            key={editor.kind === 'new' ? 'new' : editor.item.practical_id + editor.kind}
            conceptId={conceptId}
            conceptTitle={conceptTitle}
            replaces={
              editor.kind === 'new'
                ? editor.replaces || null
                : editor.kind === 'copy'
                  ? editor.item.practical_id
                  : null
            }
            draftId={editor.kind === 'edit' ? editor.item.practical_id : undefined}
            initial={
              editor.kind === 'new'
                ? undefined
                : {
                    statement: editor.item.statement,
                    solution: editor.item.reference_solution,
                    level: editor.item.level,
                  }
            }
            onDone={() => {
              setEditor(null);
              setTab('drafts');
            }}
          />
        </Modal>
      )}

      <nav className="flex gap-[6px]" aria-label="Practicals">
        <TabButton active={tab === 'drafts'} onClick={() => setTab('drafts')}>
          Drafts to review{data ? ` (${data.drafts.length})` : ''}
        </TabButton>
        <TabButton active={tab === 'live'} onClick={() => setTab('live')}>
          Live now{data ? ` (${data.current.length})` : ''}
        </TabButton>
        <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
          History{data ? ` (${data.history.length})` : ''}
        </TabButton>
      </nav>

      {overview.isPending && <p className="text-[13px] text-ink-muted">Loading...</p>}

      {data && tab === 'drafts' && (
        <section className="flex flex-col gap-[12px]">
          {data.drafts.length === 0 ? (
            <Card className="px-[18px] py-[16px]">
              <p className="text-[13px] text-ink-muted">
                No drafts waiting for this concept. Generate some above.
              </p>
            </Card>
          ) : (
            <>
              <Card className="flex flex-wrap items-center gap-[10px] px-[14px] py-[10px]">
                <GameButton
                  variant="secondary"
                  className={SMALL}
                  onClick={() => setSelected(new Set(approvable.map((d) => d.practical_id)))}
                  disabled={approvable.length === 0}
                >
                  Select all that can be approved ({approvable.length})
                </GameButton>
                <GameButton
                  variant="go"
                  className={SMALL}
                  onClick={() => bulk('approve')}
                  disabled={selected.size === 0}
                  busy={review.approveMany.isPending}
                >
                  Approve selected ({selected.size})
                </GameButton>
                <GameButton
                  variant="secondary"
                  className={SMALL}
                  onClick={() => bulk('reject')}
                  disabled={selected.size === 0}
                  busy={review.rejectMany.isPending}
                >
                  Reject selected
                </GameButton>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                  placeholder="Note for the record (optional)"
                  className="min-w-[200px] flex-1 rounded-[10px] border-2 border-line bg-surface px-[10px] py-[6px] text-[12.5px] text-ink focus:outline-none"
                />
              </Card>
              {notDone.length > 0 && (
                <Banner
                  message={`Not done: ${notDone.map((r) => `${r.practical_id} (${r.message ?? r.code})`).join('; ')}`}
                />
              )}
              {data.drafts.map((draft, i) => (
                <DraftRow
                  key={draft.practical_id}
                  index={i}
                  item={draft}
                  place={placeOf(draft.slot_id)}
                  checked={selected.has(draft.practical_id)}
                  onCheck={() => toggle(draft.practical_id)}
                  onApprove={() => approveOne(draft)}
                  onReject={() => rejectOne(draft)}
                  onEdit={() => setEditor({ kind: 'edit', item: draft })}
                  busy={review.approve.isPending || review.reject.isPending}
                />
              ))}
            </>
          )}
        </section>
      )}

      {data && tab === 'live' && (
        <section className="flex flex-col gap-[10px]">
          {data.current.map((item, i) => (
            <LiveRow
              key={item.practical_id}
              index={i}
              item={item}
              disabled={running || generate.isPending}
              onReplace={() => startGenerate([item.practical_id])}
              onCopy={() => setEditor({ kind: 'copy', item })}
            />
          ))}
        </section>
      )}

      {data && tab === 'history' && (
        <section className="flex flex-col gap-[10px]">
          {data.history.length === 0 ? (
            <Card className="px-[18px] py-[16px]">
              <p className="text-[13px] text-ink-muted">
                Nothing has been replaced or rejected yet.
              </p>
            </Card>
          ) : (
            data.history.map((item, i) => (
              <HistoryRow
                key={item.practical_id}
                index={i}
                item={item}
                onRestore={() => review.restore.mutate(item.practical_id)}
                busy={review.restore.isPending}
              />
            ))
          )}
        </section>
      )}
    </div>
  );
}

/** What Byte says, from what is going on. */
function byteSays(
  job: Job | undefined,
  drafts: number,
  running: boolean,
): { mood: Mood; text: string } {
  if (running && job) {
    const now = Math.min(job.done + job.failed + 1, job.requested);
    return {
      mood: 'think',
      text: `Writing and checking draft ${now} of ${job.requested}. You can start reviewing the ones that appear.`,
    };
  }
  if (job?.status === 'failed') {
    return {
      mood: 'oops',
      text: 'I could not make any drafts this time. The message below says why.',
    };
  }
  if (drafts > 0) {
    return {
      mood: job?.status === 'finished' ? 'cheer' : 'idle',
      text: `${drafts} ${drafts === 1 ? 'draft is' : 'drafts are'} waiting for you. Look at each one's checks, then approve.`,
    };
  }
  return {
    mood: 'idle',
    text: 'Pick a concept and ask me for drafts, or write one yourself. Nothing reaches students until you approve it.',
  };
}

function Stat({
  icon,
  label,
  value,
  glow = false,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  glow?: boolean;
}) {
  const shown = useCountUp(value, 700);
  return (
    <div
      className={cx(
        'flex items-center gap-[12px] rounded-[14px] border-2 bg-surface px-[14px] py-[11px]',
        glow ? 'animate-pulse-ring border-brand' : 'border-line',
      )}
    >
      <span className="flex size-[36px] items-center justify-center rounded-[11px] bg-gradient-to-br from-brand to-violet text-white">
        {icon}
      </span>
      <div>
        <p className="font-mono text-[20px] leading-none font-bold text-ink">{shown}</p>
        <p className="mt-[3px] text-[11.5px] text-ink-muted">{label}</p>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'rounded-full border-2 px-[14px] py-[5px] text-[12.5px] font-semibold transition-all',
        active
          ? 'border-brand bg-brand-wash text-brand shadow-[0_2px_0_0_var(--color-brand-soft)]'
          : 'border-line bg-surface text-ink-soft hover:border-brand-soft',
      )}
    >
      {children}
    </button>
  );
}

function JobBar({ job }: { job: Job }) {
  const finished = job.status === 'finished' || job.status === 'failed';
  const percent = Math.round(((job.done + job.failed) / Math.max(1, job.requested)) * 100);
  return (
    <Card className="px-[16px] py-[12px]">
      <div className="flex items-center justify-between gap-[10px]">
        <p className="text-[13px] font-semibold text-ink">
          {finished
            ? job.status === 'failed'
              ? 'Generation did not produce any drafts'
              : 'Generation finished'
            : 'Writing and checking drafts...'}
        </p>
        <span className="font-mono text-[11.5px] text-ink-muted">
          {job.done} of {job.requested} ready{job.failed > 0 ? `, ${job.failed} failed` : ''}
        </span>
      </div>
      <div className="mt-[8px] h-[9px] overflow-hidden rounded-full bg-surface-sunken">
        <div
          className={cx(
            'h-full rounded-full transition-[width] duration-700',
            job.status === 'failed'
              ? 'bg-caution'
              : 'bg-gradient-to-r from-brand to-violet shadow-[0_0_10px_oklch(0.52_0.14_265/0.5)]',
          )}
          style={{ width: `${finished ? 100 : Math.max(6, percent)}%` }}
        />
      </div>
      {job.message && <p className="mt-[8px] text-[12px] text-caution-ink">{job.message}</p>}
    </Card>
  );
}

function Toggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-[8px] text-[12px] font-semibold text-brand hover:text-brand-hover"
    >
      {open ? 'Hide the details' : 'Show the task, solution and tests'}
    </button>
  );
}

/** Rows slide in one after another, so a batch arriving feels like cards being dealt. */
function Deal({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }} className="animate-rise">
      {children}
    </div>
  );
}

function DraftRow({
  index,
  item,
  place,
  checked,
  onCheck,
  onApprove,
  onReject,
  onEdit,
  busy,
}: {
  index: number;
  item: AuthorItem;
  place: string;
  checked: boolean;
  onCheck: () => void;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Deal index={index}>
      <Card
        className={cx('border-2 px-[16px] py-[13px] transition-colors', checked && 'border-brand')}
      >
        <div className="flex flex-wrap items-start gap-[10px]">
          <input
            type="checkbox"
            checked={checked}
            onChange={onCheck}
            disabled={!item.can_approve}
            aria-label={`Select ${item.title}`}
            title={item.can_approve ? 'Select for a bulk action' : 'A failed check blocks this one'}
            className="mt-[4px] size-[16px]"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-[8px]">
              <p className="text-[14px] font-bold text-ink">{item.title}</p>
              <OriginBadge origin={item.origin} />
              <Badge>level {item.level}</Badge>
              <span className="text-[11.5px] text-ink-faint">
                would replace <span className="text-ink-soft">{place}</span> · {item.tests_total}{' '}
                tests
              </span>
            </div>
            <p className="mt-[5px] line-clamp-2 text-[12.5px] text-ink-soft">
              {item.statement.split('Sample input')[0]?.trim()}
            </p>
            <div className="mt-[8px]">
              <CheckChips checks={item.checks} />
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-[6px]">
            <GameButton
              variant="go"
              className={SMALL}
              onClick={onApprove}
              disabled={!item.can_approve || busy}
            >
              Approve
            </GameButton>
            <GameButton variant="secondary" className={SMALL} onClick={onEdit} disabled={busy}>
              Edit
            </GameButton>
            <GameButton variant="ghost" className={SMALL} onClick={onReject} disabled={busy}>
              Reject
            </GameButton>
          </div>
        </div>
        <Toggle open={open} onClick={() => setOpen((v) => !v)} />
        {open && <Preview id={item.practical_id} />}
      </Card>
    </Deal>
  );
}

function LiveRow({
  index,
  item,
  disabled,
  onReplace,
  onCopy,
}: {
  index: number;
  item: AuthorItem;
  disabled: boolean;
  onReplace: () => void;
  onCopy: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Deal index={index}>
      <Card className="px-[16px] py-[12px]">
        <div className="flex flex-wrap items-center gap-[8px]">
          <p className="text-[13.5px] font-bold text-ink">{item.title}</p>
          <OriginBadge origin={item.origin} />
          <Badge>level {item.level}</Badge>
          <span className="text-[11.5px] text-ink-faint">{item.tests_total} tests</span>
          <div className="ml-auto flex flex-wrap gap-[6px]">
            <GameButton
              variant="secondary"
              className={SMALL}
              onClick={onReplace}
              disabled={disabled}
            >
              Draft a replacement
            </GameButton>
            <GameButton variant="ghost" className={SMALL} onClick={onCopy}>
              Edit a copy
            </GameButton>
          </div>
        </div>
        <Toggle open={open} onClick={() => setOpen((v) => !v)} />
        {open && <Preview id={item.practical_id} />}
      </Card>
    </Deal>
  );
}

function HistoryRow({
  index,
  item,
  onRestore,
  busy,
}: {
  index: number;
  item: AuthorItem;
  onRestore: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Deal index={index}>
      <Card className="px-[16px] py-[12px]">
        <div className="flex flex-wrap items-center gap-[8px]">
          <p className="text-[13.5px] font-bold text-ink">{item.title}</p>
          <OriginBadge origin={item.origin} />
          <Badge tone={item.status === 'retired' ? 'caution' : 'neutral'}>
            {item.status === 'retired' ? 'replaced' : item.status}
          </Badge>
          <span className="text-[11.5px] text-ink-faint">
            {item.replaced_by ? `replaced by ${item.replaced_by}` : ''}
            {item.review_note ? ` · "${item.review_note}"` : ''}
          </span>
          {item.status === 'retired' && (
            <GameButton
              variant="secondary"
              className={cx(SMALL, 'ml-auto')}
              onClick={onRestore}
              disabled={busy}
            >
              Restore this one
            </GameButton>
          )}
        </div>
        <Toggle open={open} onClick={() => setOpen((v) => !v)} />
        {open && <Preview id={item.practical_id} />}
      </Card>
    </Deal>
  );
}
