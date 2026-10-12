import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

import { ApiError } from '@/shared/api/client';
import { useAuth } from '@/shared/auth/AuthProvider';
import { Banner, Button, Card, cx } from '@/shared/components/ui';
import {
  useStartTest,
  useSubmitTest,
  useTestStatus,
  type Attempt,
  type TestItem,
  type TestKind,
  type TestPaper,
} from '../api/curriculumApi';
import { ErrorCard, PageSkeleton } from '../components/common';
import { Stem } from '../components/Stem';
import { clearDraft, loadDraft, saveDraft, type Draft } from '../lib/draft';
import { TEST_LABELS, moduleName } from '../lib/modules';

function isKind(value: string | undefined): value is TestKind {
  return value === 'pretest' || value === 'posttest';
}

export function TestPage() {
  const { moduleId = '', kind } = useParams<{ moduleId: string; kind: string }>();
  if (!isKind(kind)) return <Navigate to={`/curriculum/${moduleId}`} replace />;
  return <TestFlow key={`${moduleId}:${kind}`} moduleId={moduleId} kind={kind} />;
}

/** Intro, then the paper, then the result. One attempt per test. */
function TestFlow({ moduleId, kind }: { moduleId: string; kind: TestKind }) {
  const status = useTestStatus(moduleId);
  const start = useStartTest(moduleId, kind);
  const resumed = useRef(false);

  const attempt = status.data?.[kind] ?? null;
  const open = status.data?.open_test === kind;

  // An attempt already exists, so starting again only resumes it (same option order).
  useEffect(() => {
    if (open && attempt && !attempt.submitted_at && !resumed.current) {
      resumed.current = true;
      start.mutate();
    }
  }, [open, attempt, start]);

  const title = `${TEST_LABELS[kind]}: ${moduleName(moduleId)}`;

  if (status.error) return <ErrorCard error={status.error} what="this test" />;
  if (!status.data) return <PageSkeleton />;

  if (attempt?.submitted_at) {
    return <Result moduleId={moduleId} title={title} attempt={attempt} />;
  }
  if (!open) {
    return (
      <Shell moduleId={moduleId} title={title}>
        <Card className="px-[20px] py-[18px]">
          <p className="text-[13px] text-ink-muted">
            This test is not open right now. Your lecturer opens it for the whole class.
          </p>
        </Card>
      </Shell>
    );
  }
  if (start.data) {
    return <Paper moduleId={moduleId} kind={kind} title={title} paper={start.data} />;
  }
  if (attempt && start.error) {
    return (
      <Shell moduleId={moduleId} title={title}>
        <StartError error={start.error} />
      </Shell>
    );
  }
  if (start.isPending || attempt) return <PageSkeleton />;

  return (
    <Shell moduleId={moduleId} title={title}>
      <Card className="flex flex-col gap-[14px] px-[22px] py-[20px]">
        <ul className="flex list-disc flex-col gap-[6px] pl-[18px] text-[13px] leading-[1.6] text-ink-soft">
          <li>Multiple-choice questions on Java. Pick one answer for each.</li>
          <li>You have one attempt. Answers are checked on the server after you submit.</li>
          <li>Your answers are saved in this browser, so you can come back and finish.</li>
          <li>If you do not know an answer, leave it blank rather than guessing.</li>
        </ul>
        {start.error && <StartError error={start.error} />}
        <div>
          <Button onClick={() => start.mutate()}>Start {TEST_LABELS[kind].toLowerCase()}</Button>
        </div>
      </Card>
    </Shell>
  );
}

function StartError({ error }: { error: unknown }) {
  if (error instanceof ApiError) return <Banner code={error.code} message={error.message} />;
  return <Banner message="Could not start the test. Try again in a moment." />;
}

function Shell({
  moduleId,
  title,
  children,
}: {
  moduleId: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-[20px]">
      <header>
        <Link
          to={`/curriculum/${moduleId}`}
          className="font-mono text-[11px] text-ink-faint hover:text-brand"
        >
          ← Back to module
        </Link>
        <h1 className="mt-[10px] text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
      </header>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------- Paper */

function Paper({
  moduleId,
  kind,
  title,
  paper,
}: {
  moduleId: string;
  kind: TestKind;
  title: string;
  paper: TestPaper;
}) {
  const { user } = useAuth();
  const userId = user?.user_id ?? 'anon';
  const submit = useSubmitTest(moduleId, kind);
  const [answers, setAnswers] = useState<Draft>(() => loadDraft(userId, moduleId, kind));
  const [confirming, setConfirming] = useState(false);

  const items = useMemo(
    () => [...paper.items].sort((a, b) => a.position - b.position),
    [paper.items],
  );
  const prereq = items.filter((i) => i.section === 'prereq');
  const main = items.filter((i) => i.section === 'main');
  const answered = items.filter((i) => answers[i.item_id] !== undefined).length;
  const blank = items.length - answered;

  function choose(itemId: string, shownIndex: number) {
    const next = { ...answers, [itemId]: shownIndex };
    setAnswers(next);
    saveDraft(userId, moduleId, kind, next);
    setConfirming(false);
  }

  function onSubmit() {
    if (blank > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    // The index sent is the position as shown; the server maps it to the original option.
    submit.mutate(
      items.map((i) => ({ item_id: i.item_id, chosen_index: answers[i.item_id] ?? null })),
      { onSuccess: () => clearDraft(userId, moduleId, kind) },
    );
  }

  if (submit.data) {
    return <Result moduleId={moduleId} title={title} attempt={submit.data.attempt} />;
  }

  let number = 0;
  const numbered = (list: TestItem[]) =>
    list.map((item) => {
      number += 1;
      return (
        <Question
          key={item.item_id}
          number={number}
          item={item}
          chosen={answers[item.item_id]}
          onChoose={(index) => choose(item.item_id, index)}
          disabled={submit.isPending}
        />
      );
    });

  return (
    <Shell moduleId={moduleId} title={title}>
      {prereq.length > 0 && (
        <section className="flex flex-col gap-[12px]">
          <SectionTitle
            title="Background check"
            note="A few questions on earlier material. They set your starting point only."
          />
          {numbered(prereq)}
        </section>
      )}
      <section className="flex flex-col gap-[12px]">
        {prereq.length > 0 && <SectionTitle title="Main questions" />}
        {numbered(main)}
      </section>

      <div className="sticky bottom-0 -mx-[4px] border-t border-line bg-canvas px-[4px] py-[12px]">
        {submit.error && (
          <div className="mb-[10px]">
            <StartError error={submit.error} />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-[10px]">
          <span className="font-mono text-[11.5px] text-ink-muted">
            {answered} of {items.length} answered
          </span>
          <div className="flex flex-wrap items-center gap-[10px]">
            {confirming && (
              <span className="text-[12px] text-caution-ink">
                {blank} left blank. Submit anyway?
              </span>
            )}
            <Button busy={submit.isPending} onClick={onSubmit}>
              {confirming ? 'Yes, submit' : 'Submit answers'}
            </Button>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div>
      <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
      {note && <p className="mt-[2px] text-[12px] text-ink-muted">{note}</p>}
    </div>
  );
}

function Question({
  number,
  item,
  chosen,
  onChoose,
  disabled,
}: {
  number: number;
  item: TestItem;
  chosen: number | undefined;
  onChoose: (index: number) => void;
  disabled: boolean;
}) {
  const name = `q-${item.item_id}`;
  return (
    <Card className="px-[18px] py-[16px]">
      <fieldset disabled={disabled}>
        <legend className="flex gap-[10px]">
          <span className="font-mono text-[11.5px] text-ink-faint">{number}.</span>
          <Stem text={item.stem} />
        </legend>
        <div className="mt-[12px] flex flex-col gap-[6px]">
          {item.options.map((option, index) => (
            <label
              key={index}
              className={cx(
                'flex cursor-pointer items-start gap-[10px] rounded-[8px] border px-[12px] py-[9px] transition-colors',
                chosen === index
                  ? 'border-brand bg-brand-wash'
                  : 'border-line hover:border-line-strong',
              )}
            >
              <input
                type="radio"
                name={name}
                checked={chosen === index}
                onChange={() => onChoose(index)}
                className="mt-[3px] accent-brand"
              />
              <span className="whitespace-pre-wrap text-[13px] text-ink">{option}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </Card>
  );
}

/* ------------------------------------------------------------------ Result */

function Result({ moduleId, title, attempt }: { moduleId: string; title: string; attempt: Attempt }) {
  return (
    <Shell moduleId={moduleId} title={title}>
      <Card className="px-[22px] py-[20px]">
        <p className="text-[13px] text-ink-muted">Submitted. Thank you.</p>
        {attempt.score_pct !== null && (
          <p className="mt-[8px] text-[28px] font-semibold tracking-tight text-ink">
            {Math.round(attempt.score_pct)}%
            {attempt.main_total ? (
              <span className="ml-[8px] text-[13px] font-normal text-ink-muted">
                {attempt.main_correct} of {attempt.main_total} correct
              </span>
            ) : null}
          </p>
        )}
        <Link
          to={`/curriculum/${moduleId}`}
          className="mt-[14px] inline-block text-[13px] font-medium text-brand hover:text-brand-hover"
        >
          See your progress
        </Link>
      </Card>
    </Shell>
  );
}
