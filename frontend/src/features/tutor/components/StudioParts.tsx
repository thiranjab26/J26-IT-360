import { useEffect, useState, type ReactNode } from 'react';

import { ApiError } from '@/shared/api/client';
import { Badge, Banner, Card, cx } from '@/shared/components/ui';
import {
  useAuthorDetail,
  useCreateDraft,
  useEditDraft,
  type AuthorItem,
  type Check,
} from '../api/authorApi';
import { GameButton } from './GameButton';
import { CheckIcon } from './icons';
import { Markdown } from './Markdown';

const CHECK_LABELS: Record<string, string> = {
  format: 'Valid program',
  safe_code: 'Safe code',
  compiles: 'Compiles',
  samples: 'Matches its sample',
  hidden: 'Hidden tests',
  stable: 'Repeatable',
  constructs: 'Taught features only',
  duplicate: 'Not a repeat',
  taught_scope: 'Within the course',
};

const TONE: Record<Check['status'], string> = {
  pass: 'border-verified-line bg-verified-wash text-verified-ink',
  warn: 'border-caution-line bg-caution-wash text-caution-ink',
  fail: 'border-[oklch(0.8_0.1_25)] bg-[oklch(0.97_0.02_25)] text-[oklch(0.45_0.15_25)]',
};

/** One chip per check, so a lecturer sees at a glance what passed and what needs a look. */
export function CheckChips({ checks }: { checks: Check[] }) {
  if (checks.length === 0) {
    return <span className="text-[11.5px] text-ink-faint">Written by the course authors</span>;
  }
  const notes = checks.filter((c) => c.status !== 'pass' && c.detail);
  return (
    <div>
      <ul className="flex flex-wrap gap-[6px]">
        {checks.map((c) => (
          <li
            key={c.name}
            title={c.detail || 'passed'}
            className={cx(
              'inline-flex items-center gap-[4px] rounded-full border px-[9px] py-[2px] text-[11px] font-medium',
              TONE[c.status],
            )}
          >
            {c.status === 'pass' ? <CheckIcon className="size-[10px]" /> : <span>!</span>}
            {CHECK_LABELS[c.name] ?? c.name}
          </li>
        ))}
      </ul>
      {notes.length > 0 && (
        <ul className="mt-[8px] flex flex-col gap-[3px]">
          {notes.map((c) => (
            <li key={c.name} className="text-[12px] text-ink-soft">
              <span className="font-medium">{CHECK_LABELS[c.name] ?? c.name}:</span> {c.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function OriginBadge({ origin }: { origin: AuthorItem['origin'] }) {
  return origin === 'generated' ? (
    <Badge tone="brand">AI draft</Badge>
  ) : origin === 'manual' ? (
    <Badge>written by hand</Badge>
  ) : (
    <Badge tone="verified">course author</Badge>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="max-h-[320px] overflow-auto rounded-[8px] border border-line bg-surface-muted px-[12px] py-[9px] font-mono text-[12px] leading-[1.55] whitespace-pre-wrap text-ink">
      {children}
    </pre>
  );
}

/** The statement, the reference solution and every test, loaded when it is opened. */
export function Preview({ id }: { id: string }) {
  const { data, isPending, error } = useAuthorDetail(id);
  if (isPending) return <p className="text-[12px] text-ink-muted">Loading...</p>;
  if (error || !data) return <p className="text-[12px] text-caution-ink">Could not load it.</p>;

  return (
    <div className="mt-[12px] grid gap-[14px] border-t border-line-soft pt-[12px] lg:grid-cols-2">
      <div>
        <p className="mb-[4px] font-mono text-[10px] tracking-wide text-ink-faint uppercase">
          What students read
        </p>
        <Markdown>{data.statement}</Markdown>
      </div>
      <div className="flex flex-col gap-[10px]">
        <div>
          <p className="mb-[4px] font-mono text-[10px] tracking-wide text-ink-faint uppercase">
            Reference solution
          </p>
          <Code>{data.reference_solution}</Code>
        </div>
        <div>
          <p className="mb-[4px] font-mono text-[10px] tracking-wide text-ink-faint uppercase">
            Tests ({data.tests.length})
          </p>
          <ul className="flex flex-col gap-[4px]">
            {data.tests.map((t, i) => (
              <li
                key={i}
                className="rounded-[6px] border border-line-soft bg-surface-muted px-[9px] py-[5px] font-mono text-[11.5px] text-ink"
              >
                <span className="mr-[6px] text-ink-faint">{t.visible ? 'shown' : 'hidden'}</span>
                in: {t.stdin.trim().replace(/\n/g, ' / ') || '(empty)'} → out:{' '}
                {t.expected.replace(/\n/g, ' / ')}
              </li>
            ))}
            {data.tests.length === 0 && (
              <li className="text-[12px] text-caution-ink">No tests were made.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

interface EditorProps {
  conceptId: string;
  conceptTitle: string;
  /** The practical this would replace, or null to add a new one. */
  replaces: string | null;
  /** Editing an existing draft, or starting from a copy. */
  draftId?: string;
  initial?: { statement: string; solution: string; level: number };
  onDone: () => void;
}

const STARTER_STATEMENT =
  'Describe what the program reads and prints.\n\nSample input:\n\n```text\n\n```\n\nSample output:\n\n```text\n\n```';

/** Write or change a draft by hand. The checks run again on every save. */
export function Editor({
  conceptId,
  conceptTitle,
  replaces,
  draftId,
  initial,
  onDone,
}: EditorProps) {
  const [statement, setStatement] = useState(initial?.statement ?? STARTER_STATEMENT);
  const [solution, setSolution] = useState(initial?.solution ?? '');
  const [level, setLevel] = useState(initial?.level ?? 4);
  const create = useCreateDraft();
  const edit = useEditDraft();
  const busy = create.isPending || edit.isPending;
  const failure = create.error ?? edit.error;

  const save = () => {
    const done = { onSuccess: onDone };
    if (draftId) {
      edit.mutate(
        {
          practical_id: draftId,
          statement,
          reference_solution: solution,
          level,
        },
        done,
      );
    } else {
      create.mutate(
        {
          concept_id: conceptId,
          statement,
          reference_solution: solution,
          level,
          replaces,
          suggest_tests: true,
        },
        done,
      );
    }
  };

  return (
    <Card className="px-[18px] py-[16px]">
      <p className="text-[13.5px] font-semibold text-ink">
        {draftId ? 'Edit the draft' : 'Write a practical'} · {conceptTitle}
      </p>
      <p className="mt-[2px] text-[12px] text-ink-muted">
        The sample output must be exactly what your solution prints. It is checked when you save.
      </p>
      {failure && (
        <div className="mt-[10px]">
          <Banner
            message={failure instanceof ApiError ? failure.message : 'Something went wrong.'}
            code={failure instanceof ApiError ? failure.code : undefined}
          />
        </div>
      )}
      <label className="mt-[12px] block text-[12px] font-medium text-ink-soft">
        What students read
        <textarea
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          rows={9}
          spellCheck={false}
          className="mt-[4px] w-full rounded-[8px] border border-line bg-surface px-[11px] py-[8px] font-mono text-[12.5px] text-ink focus:outline-none"
        />
      </label>
      <label className="mt-[10px] block text-[12px] font-medium text-ink-soft">
        Reference solution (Java, a class named Main)
        <textarea
          value={solution}
          onChange={(e) => setSolution(e.target.value)}
          rows={12}
          spellCheck={false}
          className="mt-[4px] w-full rounded-[8px] border border-line bg-surface px-[11px] py-[8px] font-mono text-[12.5px] text-ink focus:outline-none"
        />
      </label>
      <div className="mt-[12px] flex flex-wrap items-center gap-[10px]">
        <label className="text-[12px] text-ink-soft">
          Level{' '}
          <select
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            className="rounded-[6px] border border-line bg-surface px-[8px] py-[4px] text-[12.5px]"
          >
            <option value={4}>4</option>
            <option value={5}>5 (harder)</option>
          </select>
        </label>
        <GameButton
          variant="go"
          onClick={save}
          busy={busy}
          disabled={!statement.trim() || !solution.trim()}
        >
          Save and check
        </GameButton>
        <GameButton variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </GameButton>
      </div>
    </Card>
  );
}

/**
 * A pop-up over the page. It closes with the X, the Escape key or a click outside it, so a
 * lecturer who opens the editor by mistake is never stuck with it.
 */
export function Modal({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-[120] flex animate-fade-in items-start justify-center overflow-y-auto bg-[oklch(0.2_0.04_265/0.5)] px-[16px] py-[40px] backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-[820px] animate-pop-in">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-[12px] -right-[10px] z-10 flex size-[30px] items-center justify-center rounded-full border border-line bg-surface text-[16px] leading-none text-ink-soft shadow-[var(--shadow-card)] hover:text-ink"
        >
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
