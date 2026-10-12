import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ApiError } from '@/shared/api/client';
import { Badge, Banner, Button, Card, cx } from '@/shared/components/ui';
import {
  useMastery,
  usePracticeAnswer,
  usePracticeHint,
  usePracticeItem,
  type ConceptMastery,
  type PracticeItem,
} from '../api/curriculumApi';
import { MasteryBar, PageSkeleton } from '../components/common';
import { Stem } from '../components/Stem';
import { masteryLevel, percent } from '../lib/modules';

/**
 * Practice (C3 stand-in): server-checked questions that feed BKT until C3's tutor
 * publishes its attempt view. Only the first try at a question, without a hint, counts as correct.
 */
export function PracticePage() {
  const { moduleId = '', conceptId = '' } = useParams<{ moduleId: string; conceptId: string }>();
  const item = usePracticeItem(conceptId);
  const mastery = useMastery(moduleId);
  const current = mastery.data?.concepts.find((c) => c.concept_id === conceptId);

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-[18px]">
      <header>
        <Link
          to={`/curriculum/${moduleId}`}
          className="font-mono text-[11px] text-ink-faint hover:text-brand"
        >
          ← Back to my path
        </Link>
        <div className="mt-[10px] flex flex-wrap items-center justify-between gap-[10px]">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">
            {item.data?.concept.name ?? current?.name ?? 'Practice'}
          </h1>
          <Badge>Practice (C3 stand-in)</Badge>
        </div>
      </header>

      <MasteryPanel concept={current} threshold={mastery.data?.threshold ?? 0.7} />

      {item.error ? (
        <PracticeUnavailable error={item.error} moduleId={moduleId} />
      ) : item.isFetching || !item.data ? (
        <PageSkeleton />
      ) : (
        <Question
          key={item.data.item_id}
          moduleId={moduleId}
          item={item.data}
          onNext={() => item.refetch()}
        />
      )}
    </div>
  );
}

function MasteryPanel({
  concept,
  threshold,
}: {
  concept: ConceptMastery | undefined;
  threshold: number;
}) {
  const score = concept?.mastery_score ?? null;
  return (
    <Card className="px-[18px] py-[14px]">
      <div className="flex items-baseline justify-between gap-[10px]">
        <span className="text-[12.5px] text-ink-soft">Your mastery</span>
        <span className="font-mono text-[12px] text-ink">
          {score === null ? 'No answers yet' : percent(score)}
          {concept?.is_mastered && <span className="ml-[6px] text-verified-ink">Mastered</span>}
        </span>
      </div>
      <div className="mt-[8px]">
        <MasteryBar score={score} level={masteryLevel(concept)} threshold={threshold} />
      </div>
    </Card>
  );
}

function PracticeUnavailable({ error, moduleId }: { error: unknown; moduleId: string }) {
  let message = 'Could not load a practice question. Try again in a moment.';
  if (error instanceof ApiError && error.code === 'no_practice_items') {
    message = 'There are no practice questions for this concept yet.';
  } else if (error instanceof ApiError && error.status === 404) {
    // In live mode the stand-in routes are off: practice happens in the C3 tutor.
    message = 'Practice for this concept happens in the tutor.';
  }
  return (
    <Card className="px-[20px] py-[18px]">
      <p className="text-[13px] text-ink-muted">{message}</p>
      <Link
        to={`/curriculum/${moduleId}`}
        className="mt-[10px] inline-block text-[13px] font-medium text-brand hover:text-brand-hover"
      >
        Back to my path
      </Link>
    </Card>
  );
}

function Question({
  moduleId,
  item,
  onNext,
}: {
  moduleId: string;
  item: PracticeItem;
  onNext: () => void;
}) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [askingHint, setAskingHint] = useState(false);
  const hint = usePracticeHint();
  const answer = usePracticeAnswer();
  const result = answer.data;

  function submit() {
    if (chosen === null) return;
    answer.mutate({ itemId: item.item_id, chosenIndex: chosen });
  }

  return (
    <Card className="px-[20px] py-[18px]">
      <Stem text={item.stem} />

      <fieldset disabled={Boolean(result) || answer.isPending} className="mt-[14px]">
        <legend className="sr-only">Options</legend>
        <div className="flex flex-col gap-[6px]">
          {item.options.map((option, index) => (
            <label
              key={index}
              className={cx(
                'flex cursor-pointer items-start gap-[10px] rounded-[8px] border px-[12px] py-[9px] transition-colors',
                optionStyle(index, chosen, result?.right_option ?? null),
              )}
            >
              <input
                type="radio"
                name={`practice-${item.item_id}`}
                checked={chosen === index}
                onChange={() => setChosen(index)}
                className="mt-[3px] accent-brand"
              />
              <span className="whitespace-pre-wrap text-[13px] text-ink">{option}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {hint.data && (
        <div className="mt-[12px] rounded-[8px] border border-caution-line bg-caution-wash px-[12px] py-[9px]">
          <p className="text-[12.5px] text-caution-ink">Hint: {hint.data.hint}</p>
        </div>
      )}
      {(hint.error || answer.error) && (
        <div className="mt-[12px]">
          <Banner message="Something went wrong. Try again." />
        </div>
      )}

      {result ? (
        <ResultPanel moduleId={moduleId} result={result} onNext={onNext} />
      ) : (
        <div className="mt-[16px] flex flex-wrap items-center justify-between gap-[10px]">
          <div className="flex flex-wrap items-center gap-[8px]">
            {item.has_hint && !hint.data && (
              <>
                {askingHint && (
                  <span className="text-[12px] text-caution-ink">
                    With a hint, this answer counts as not yet known. Show it?
                  </span>
                )}
                <Button
                  variant="secondary"
                  busy={hint.isPending}
                  onClick={() => (askingHint ? hint.mutate(item.item_id) : setAskingHint(true))}
                >
                  {askingHint ? 'Yes, show hint' : 'Show hint'}
                </Button>
              </>
            )}
          </div>
          <Button busy={answer.isPending} disabled={chosen === null} onClick={submit}>
            Check answer
          </Button>
        </div>
      )}
    </Card>
  );
}

function optionStyle(index: number, chosen: number | null, right: number | null): string {
  if (right !== null) {
    if (index === right) return 'border-verified-line bg-verified-wash';
    if (index === chosen) return 'border-caution-line bg-caution-wash';
    return 'border-line opacity-70';
  }
  return chosen === index ? 'border-brand bg-brand-wash' : 'border-line hover:border-line-strong';
}

function ResultPanel({
  moduleId,
  result,
  onNext,
}: {
  moduleId: string;
  result: NonNullable<ReturnType<typeof usePracticeAnswer>['data']>;
  onNext: () => void;
}) {
  let note = 'Counted towards your mastery.';
  if (!result.counted) note = 'You answered this question before, so it was not counted again.';
  else if (result.correct && !result.counted_as_correct)
    note = 'Correct, but a hint was used, so it counts as not yet known.';

  return (
    <div className="mt-[16px] border-t border-line-soft pt-[14px]">
      <p
        className={cx(
          'text-[15px] font-semibold',
          result.correct ? 'text-verified-ink' : 'text-caution-ink',
        )}
      >
        {result.correct ? 'Correct' : 'Not quite. The right answer is highlighted.'}
      </p>
      <p className="mt-[3px] text-[12.5px] text-ink-muted">{note}</p>
      {result.mastery.is_mastered && (
        <p className="mt-[6px] text-[13px] font-medium text-verified-ink">
          You have mastered {result.mastery.name}.
        </p>
      )}
      <div className="mt-[14px] flex flex-wrap gap-[10px]">
        <Button onClick={onNext}>Next question</Button>
        <Link
          to={`/curriculum/${moduleId}`}
          className="inline-flex items-center rounded-[8px] border border-line bg-surface px-[18px] py-[10px] text-[13.5px] font-medium text-ink-soft hover:border-line-strong hover:text-ink"
        >
          Back to my path
        </Link>
      </div>
    </div>
  );
}
