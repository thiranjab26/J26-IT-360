import { Link, useParams } from 'react-router-dom';

import { ApiError } from '@/shared/api/client';
import { Badge, Button, Card, cx } from '@/shared/components/ui';
import { useModuleConcepts, type Concept, type Topic } from '../api/tutorApi';

/**
 * The module as a path of topics, in teaching order.
 *
 * Only real data is shown. Mastery, locks and XP depend on the session and
 * progress APIs (phases P2 and P5), so every topic reads "not started" for now
 * and the first one is marked as the place to begin.
 */
export function QuestMapPage() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const { data, isPending, error } = useModuleConcepts(moduleId);

  if (isPending) return <MapSkeleton />;

  if (error || !data) {
    const comingSoon = error instanceof ApiError && error.code === 'module_coming_soon';
    return (
      <Card className="px-[20px] py-[18px]">
        <p className="text-[13px] text-ink">
          {comingSoon ? error.message : 'Could not load this module.'}
        </p>
        {!comingSoon && (
          <p className="mt-[4px] text-[12.5px] text-caution-ink">
            It may not exist, or the tutor service may not be running.
          </p>
        )}
        <Link
          to="/dashboard"
          className="mt-[10px] inline-block text-[12.5px] font-medium text-brand hover:text-brand-hover"
        >
          Back to modules
        </Link>
      </Card>
    );
  }

  const { module, topics } = data;
  const conceptNames = new Map(
    topics.flatMap((topic) => topic.concepts.map((c) => [c.concept_id, c.name] as const)),
  );
  const firstConcept = topics[0]?.concepts[0];

  return (
    <div className="flex flex-col gap-[22px]">
      <header>
        <Link to="/dashboard" className="font-mono text-[11px] text-ink-faint hover:text-brand">
          ← Modules
        </Link>
        <h1 className="mt-[10px] text-[23px] font-semibold tracking-tight text-ink">
          {module.name}
        </h1>
        {module.description && (
          <p className="mt-[6px] max-w-[640px] text-[13px] leading-[1.6] text-ink-muted">
            {module.description}
          </p>
        )}
      </header>

      {firstConcept && (
        <div className="flex flex-wrap items-center justify-between gap-[14px] rounded-[14px] border border-brand-soft bg-brand-wash px-[20px] py-[16px]">
          <div>
            <p className="font-mono text-[10.5px] tracking-wide text-brand uppercase">
              Start here
            </p>
            <p className="mt-[3px] text-[15.5px] font-semibold tracking-tight text-ink">
              {firstConcept.name}
            </p>
            <p className="mt-[2px] text-[12.5px] text-ink-muted">
              Guided sessions open in the next phase. The path below is already your route.
            </p>
          </div>
          <Button disabled title="Guided sessions are not available yet">
            Start session
          </Button>
        </div>
      )}

      <div className="grid items-start gap-[22px] lg:grid-cols-[1fr_270px]">
        <section aria-label="Module path">
          <div className="mb-[14px] flex items-baseline justify-between">
            <h2 className="text-[14px] font-semibold text-ink">Module path</h2>
            <span className="font-mono text-[10.5px] text-ink-faint">
              0 of {module.topic_count} topics mastered
            </span>
          </div>

          <ol>
            {topics.map((topic, index) => (
              <TopicStep
                key={topic.topic_id}
                topic={topic}
                number={index + 1}
                first={index === 0}
                last={index === topics.length - 1}
                conceptNames={conceptNames}
              />
            ))}
          </ol>
        </section>

        <aside className="flex flex-col gap-[12px] lg:sticky lg:top-[20px]">
          <Card className="px-[18px] py-[16px]">
            <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
              Module overview
            </p>
            <dl className="mt-[10px] flex flex-col gap-[8px] text-[12.5px]">
              <Row label="Topics" value={String(module.topic_count)} />
              <Row label="Concepts" value={String(module.concept_count)} />
              <Row label="Mastered" value="0%" />
            </dl>
            <div className="mt-[12px] h-[6px] overflow-hidden rounded-full bg-surface-sunken">
              <div className="h-full w-0 rounded-full bg-brand" />
            </div>
          </Card>

          <Card className="px-[18px] py-[16px]">
            <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
              How progress works
            </p>
            <ul className="mt-[10px] flex flex-col gap-[9px]">
              {[
                'You earn XP for each checkpoint you pass.',
                'Topics unlock on demonstrated mastery, not on points.',
                'Quick multiple-choice checks never unlock anything.',
              ].map((line) => (
                <li key={line} className="flex gap-[8px]">
                  <span className="mt-[7px] size-[4px] shrink-0 rounded-full bg-brand" />
                  <span className="text-[12px] leading-[1.55] text-ink-muted">{line}</span>
                </li>
              ))}
            </ul>
          </Card>

          <div className="flex items-start gap-[8px] px-[4px]">
            <Shield />
            <p className="text-[11.5px] leading-[1.5] text-ink-faint">
              Every tutor statement is checked against this module's course material before it
              reaches you.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TopicStep({
  topic,
  number,
  first,
  last,
  conceptNames,
}: {
  topic: Topic;
  number: number;
  first: boolean;
  last: boolean;
  conceptNames: Map<string, string>;
}) {
  return (
    <li className="grid grid-cols-[38px_1fr] gap-[14px]">
      {/* Node and the line down to the next topic */}
      <div className="flex flex-col items-center">
        <span
          className={cx(
            'flex size-[34px] shrink-0 items-center justify-center rounded-full',
            'font-mono text-[12.5px] font-semibold',
            first
              ? 'bg-brand text-white shadow-[0_0_0_4px_oklch(0.52_0.14_265/0.14)]'
              : 'border border-line-strong bg-surface text-ink-muted',
          )}
        >
          {number}
        </span>
        {!last && <span className="my-[4px] w-px flex-1 bg-line" />}
      </div>

      <div className={cx(last ? 'pb-0' : 'pb-[18px]')}>
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-[8px] border-b border-line-soft px-[18px] py-[12px]">
            <h3 className="text-[14.5px] font-semibold tracking-tight text-ink">{topic.name}</h3>
            <div className="flex items-center gap-[7px]">
              {first && <Badge tone="brand">Start here</Badge>}
              <Badge>
                {topic.concepts.length} {topic.concepts.length === 1 ? 'concept' : 'concepts'}
              </Badge>
              <Badge>not started</Badge>
            </div>
          </div>

          <ul className="divide-y divide-line-soft">
            {topic.concepts.map((concept) => (
              <ConceptItem key={concept.concept_id} concept={concept} names={conceptNames} />
            ))}
          </ul>
        </Card>
      </div>
    </li>
  );
}

function ConceptItem({ concept, names }: { concept: Concept; names: Map<string, string> }) {
  return (
    <li className="px-[18px] py-[13px]">
      <h4 className="text-[13.5px] font-medium text-ink">{concept.name}</h4>

      {concept.description && (
        <p className="mt-[3px] max-w-[620px] text-[12.5px] leading-[1.6] text-ink-muted">
          {concept.description}
        </p>
      )}

      {concept.prerequisite_ids.length > 0 && (
        <div className="mt-[8px] flex flex-wrap items-center gap-[6px]">
          <span className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
            builds on
          </span>
          {concept.prerequisite_ids.map((id) => (
            <Badge key={id}>{names.get(id) ?? id}</Badge>
          ))}
        </div>
      )}
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-mono text-[12px] text-ink">{value}</dd>
    </div>
  );
}

function Shield() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-[2px] size-[13px] shrink-0 text-verified">
      <path
        d="M8 1.5 2.5 3.4v4.2c0 3.1 2.2 5.4 5.5 6.9 3.3-1.5 5.5-3.8 5.5-6.9V3.4L8 1.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function MapSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-[9px] w-[70px] rounded-full bg-surface-sunken" />
      <div className="mt-[12px] h-[22px] w-1/2 rounded-full bg-surface-sunken" />
      <div className="mt-[28px] flex flex-col gap-[16px]">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-[96px] rounded-[14px] bg-surface-sunken" />
        ))}
      </div>
    </div>
  );
}
