import { Link } from 'react-router-dom';

import { Card, cx } from '@/shared/components/ui';
import { useExplanationFeedback, useMastery, usePlan } from '../api/curriculumApi';
import { percent } from '../lib/modules';
import { ErrorCard } from './common';

/**
 * What to study next and why. The study group, reason, model version and readiness are
 * never shown, so learners stay blind to their group; comparison learners simply get no sentence.
 */
export function RecommendationCard({ moduleId }: { moduleId: string }) {
  const plan = usePlan(moduleId);
  const mastery = useMastery(moduleId);

  if (plan.error) return <ErrorCard error={plan.error} what="your next step" />;
  if (!plan.data) {
    return <div className="h-[132px] animate-pulse rounded-[14px] bg-surface-sunken" />;
  }

  const rec = plan.data.recommendation;
  if (plan.data.complete || !rec) {
    return (
      <Card className="border-verified-line px-[20px] py-[18px]">
        <p className="font-mono text-[10.5px] tracking-tight text-verified-ink">MODULE COMPLETE</p>
        <p className="mt-[6px] text-[14px] font-semibold text-ink">
          You have mastered every concept in this module.
        </p>
      </Card>
    );
  }

  const score = mastery.data?.concepts.find(
    (c) => c.concept_id === rec.next_concept.concept_id,
  )?.mastery_score;

  return (
    <Card className="border-brand-soft px-[20px] py-[18px]">
      <div className="flex flex-wrap items-start justify-between gap-[14px]">
        <div className="min-w-0 max-w-[620px]">
          <p className="font-mono text-[10.5px] tracking-tight text-brand">NEXT UP</p>
          <h2 className="mt-[4px] text-[18px] font-semibold tracking-tight text-ink">
            {rec.next_concept.name}
          </h2>
          {rec.target_concept && (
            <p className="mt-[2px] text-[12px] text-ink-muted">
              On the way to {rec.target_concept.name}
            </p>
          )}
          {rec.explanation && (
            <>
              <p className="mt-[10px] text-[13px] leading-[1.6] text-ink-soft">
                {rec.explanation}
              </p>
              <Feedback
                key={`${rec.next_concept.concept_id}:${rec.explanation}`}
                moduleId={moduleId}
                conceptId={rec.next_concept.concept_id}
              />
            </>
          )}
        </div>
        <div className="flex flex-col items-end gap-[10px]">
          {/* Mastery, not readiness: readiness means different things per group and would reveal it. */}
          <div className="text-right">
            <p className="text-[11px] text-ink-muted">Your mastery</p>
            <p className="font-mono text-[18px] font-semibold text-ink">
              {score === null || score === undefined ? 'Not started' : percent(score)}
            </p>
          </div>
          <Link
            to={`/curriculum/${moduleId}/practice/${rec.next_concept.concept_id}`}
            className="inline-flex items-center rounded-[8px] bg-brand px-[18px] py-[10px] text-[13.5px] font-medium text-white hover:bg-brand-hover"
          >
            Practise this
          </Link>
        </div>
      </div>
    </Card>
  );
}

/** Was the sentence helpful? Feeds the explanation pilot; one rating per explanation. */
function Feedback({ moduleId, conceptId }: { moduleId: string; conceptId: string }) {
  const feedback = useExplanationFeedback(moduleId);
  const chosen = feedback.isSuccess ? feedback.variables?.helpful : undefined;

  const button = (helpful: boolean, label: string) => (
    <button
      type="button"
      disabled={feedback.isPending}
      onClick={() => feedback.mutate({ conceptId, helpful })}
      aria-pressed={chosen === helpful}
      className={cx(
        'rounded-full border px-[10px] py-[3px] text-[11.5px] transition-colors disabled:opacity-55',
        chosen === helpful
          ? 'border-brand bg-brand-wash text-brand'
          : 'border-line text-ink-muted hover:border-line-strong hover:text-ink',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-[10px] flex flex-wrap items-center gap-[8px]">
      <span className="text-[11.5px] text-ink-muted">
        {chosen === undefined ? 'Was this explanation helpful?' : 'Thanks for the feedback.'}
      </span>
      {button(true, 'Yes')}
      {button(false, 'No')}
      {feedback.isError && (
        <span className="text-[11.5px] text-caution-ink">Not saved. Refresh and try again.</span>
      )}
    </div>
  );
}
