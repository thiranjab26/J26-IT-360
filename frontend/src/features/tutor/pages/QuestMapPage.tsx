import { Link, useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '@/shared/api/client';
import { Badge, Banner, Button, Card, cx } from '@/shared/components/ui';
import { useStartSession, useProgress, type ConceptProgress } from '../api/sessionApi';
import { useModuleConcepts, type Concept, type Topic } from '../api/tutorApi';

/**
 * The module as a path of topics, in teaching order, with the student's own progress:
 * which concepts are open, which are mastered, and where to go next.
 */
export function QuestMapPage() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const navigate = useNavigate();
  const { data, isPending, error } = useModuleConcepts(moduleId);
  const { data: progress } = useProgress(moduleId);
  const start = useStartSession();

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
  const status = new Map<string, ConceptProgress>(
    (progress?.concepts ?? []).map((c) => [c.concept_id, c]),
  );

  const masteredCount = [...status.values()].filter((c) => c.mastered).length;
  const masteredPercent = module.concept_count
    ? Math.round((masteredCount / module.concept_count) * 100)
    : 0;

  const nextId = progress?.next_concept_id ?? topics[0]?.concepts[0]?.concept_id ?? null;
  const activeId = progress?.active_session_id ?? null;

  function begin(conceptId: string) {
    start.mutate(conceptId, {
      onSuccess: (session) => navigate(`/sessions/${session.session_id}`),
    });
  }

  const startError = start.error;

  return (
    <div className="flex flex-col gap-[22px]">
      <header>
        <Link to="/dashboard" className="font-mono text-[11px] text-ink-faint hover:text-brand">
          ← Modules
        </Link>
        <div className="mt-[10px] flex flex-wrap items-center justify-between gap-[12px]">
          <h1 className="text-[23px] font-semibold tracking-tight text-ink">{module.name}</h1>
          {progress && (
            <span className="rounded-full border border-brand-soft bg-brand-wash px-[12px] py-[4px] font-mono text-[12px] font-semibold text-brand">
              {progress.total_xp} XP
            </span>
          )}
        </div>
        {module.description && (
          <p className="mt-[6px] max-w-[640px] text-[13px] leading-[1.6] text-ink-muted">
            {module.description}
          </p>
        )}
      </header>

      {startError && (
        <Banner
          message={startError instanceof ApiError ? startError.message : 'Could not start.'}
          code={startError instanceof ApiError ? startError.code : undefined}
        />
      )}

      {nextId && (
        <div className="flex flex-wrap items-center justify-between gap-[14px] rounded-[14px] border border-brand-soft bg-brand-wash px-[20px] py-[16px]">
          <div>
            <p className="font-mono text-[10.5px] tracking-wide text-brand uppercase">
              {activeId ? 'In progress' : masteredCount > 0 ? 'Up next' : 'Start here'}
            </p>
            <p className="mt-[3px] text-[15.5px] font-semibold tracking-tight text-ink">
              {activeId ? 'Your guided session' : (conceptNames.get(nextId) ?? nextId)}
            </p>
            <p className="mt-[2px] text-[12.5px] text-ink-muted">
              {activeId
                ? 'You have a session open. Pick it up where you left off.'
                : 'A guided session: a short explanation, quick checks, then checkpoints.'}
            </p>
          </div>
          {activeId ? (
            <Button onClick={() => navigate(`/sessions/${activeId}`)}>Continue session</Button>
          ) : (
            <Button onClick={() => begin(nextId)} busy={start.isPending}>
              Start session
            </Button>
          )}
        </div>
      )}

      <div className="grid items-start gap-[22px] lg:grid-cols-[1fr_270px]">
        <section aria-label="Module path">
          <div className="mb-[14px] flex items-baseline justify-between">
            <h2 className="text-[14px] font-semibold text-ink">Module path</h2>
            <span className="font-mono text-[10.5px] text-ink-faint">
              {masteredCount} of {module.concept_count} concepts mastered
            </span>
          </div>

          <ol>
            {topics.map((topic, index) => (
              <TopicStep
                key={topic.topic_id}
                topic={topic}
                number={index + 1}
                last={index === topics.length - 1}
                conceptNames={conceptNames}
                status={status}
                current={nextId}
                busy={start.isPending}
                onStart={begin}
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
              <Row label="Mastered" value={`${masteredPercent}%`} />
            </dl>
            <div className="mt-[12px] h-[6px] overflow-hidden rounded-full bg-surface-sunken">
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-500"
                style={{ width: `${masteredPercent}%` }}
              />
            </div>
          </Card>

          <Card className="px-[18px] py-[16px]">
            <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
              How progress works
            </p>
            <ul className="mt-[10px] flex flex-col gap-[9px]">
              {[
                'You earn XP for each checkpoint you pass.',
                progress?.policy === 'points_only'
                  ? 'Topics unlock as your XP grows.'
                  : 'Topics unlock on demonstrated mastery, not on points.',
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
              Explanations are written from this module's course material. A fact-check gate for
              them is being built; until it is on, AI-written text is labelled as such.
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
  last,
  conceptNames,
  status,
  current,
  busy,
  onStart,
}: {
  topic: Topic;
  number: number;
  last: boolean;
  conceptNames: Map<string, string>;
  status: Map<string, ConceptProgress>;
  current: string | null;
  busy: boolean;
  onStart: (conceptId: string) => void;
}) {
  const mastered = topic.concepts.filter((c) => status.get(c.concept_id)?.mastered).length;
  const done = mastered === topic.concepts.length;
  const open = topic.concepts.some((c) => c.concept_id === current);

  return (
    <li className="grid grid-cols-[38px_1fr] gap-[14px]">
      {/* Node and the line down to the next topic */}
      <div className="flex flex-col items-center">
        <span
          className={cx(
            'flex size-[34px] shrink-0 items-center justify-center rounded-full',
            'font-mono text-[12.5px] font-semibold',
            done
              ? 'bg-verified text-white'
              : open
                ? 'bg-brand text-white shadow-[0_0_0_4px_oklch(0.52_0.14_265/0.14)]'
                : 'border border-line-strong bg-surface text-ink-muted',
          )}
        >
          {done ? '✓' : number}
        </span>
        {!last && <span className="my-[4px] w-px flex-1 bg-line" />}
      </div>

      <div className={cx(last ? 'pb-0' : 'pb-[18px]')}>
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-[8px] border-b border-line-soft px-[18px] py-[12px]">
            <h3 className="text-[14.5px] font-semibold tracking-tight text-ink">{topic.name}</h3>
            <div className="flex items-center gap-[7px]">
              {open && <Badge tone="brand">Up next</Badge>}
              <Badge tone={done ? 'verified' : 'neutral'}>
                {mastered} of {topic.concepts.length} mastered
              </Badge>
            </div>
          </div>

          <ul className="divide-y divide-line-soft">
            {topic.concepts.map((concept) => (
              <ConceptItem
                key={concept.concept_id}
                concept={concept}
                names={conceptNames}
                progress={status.get(concept.concept_id)}
                isNext={concept.concept_id === current}
                busy={busy}
                onStart={onStart}
              />
            ))}
          </ul>
        </Card>
      </div>
    </li>
  );
}

function ConceptItem({
  concept,
  names,
  progress,
  isNext,
  busy,
  onStart,
}: {
  concept: Concept;
  names: Map<string, string>;
  progress: ConceptProgress | undefined;
  isNext: boolean;
  busy: boolean;
  onStart: (conceptId: string) => void;
}) {
  const locked = progress ? !progress.unlocked : false;
  const unmet = (progress?.unmet ?? []).map((r) =>
    r.concept_id ? (names.get(r.concept_id) ?? r.concept_id) : `${Math.ceil(r.required)} XP`,
  );

  return (
    <li className={cx('flex items-start justify-between gap-[14px] px-[18px] py-[13px]', locked && 'opacity-70')}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-[8px]">
          <h4 className="text-[13.5px] font-medium text-ink">{concept.name}</h4>
          {progress?.mastered && <Badge tone="verified">mastered</Badge>}
          {progress && !progress.mastered && progress.mastery !== null && (
            <Badge tone="caution">{Math.round(progress.mastery * 100)}%</Badge>
          )}
          {locked && <Badge>locked</Badge>}
        </div>

        {concept.description && (
          <p className="mt-[3px] max-w-[620px] text-[12.5px] leading-[1.6] text-ink-muted">
            {concept.description}
          </p>
        )}

        {locked && unmet.length > 0 && (
          <p className="mt-[6px] text-[12px] text-caution-ink">Needs: {unmet.join(', ')}</p>
        )}

        {!locked && concept.prerequisite_ids.length > 0 && (
          <div className="mt-[8px] flex flex-wrap items-center gap-[6px]">
            <span className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
              builds on
            </span>
            {concept.prerequisite_ids.map((id) => (
              <Badge key={id}>{names.get(id) ?? id}</Badge>
            ))}
          </div>
        )}
      </div>

      {progress && !locked && (
        <Button
          variant={isNext ? 'primary' : 'secondary'}
          className="shrink-0 px-[14px] py-[7px] text-[12.5px]"
          onClick={() => onStart(concept.concept_id)}
          disabled={busy}
        >
          {progress.mastered ? 'Review' : progress.mastery !== null ? 'Practise' : 'Start'}
        </Button>
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
