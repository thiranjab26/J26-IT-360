import { Link, useParams } from 'react-router-dom';

import { Badge, Card } from '@/shared/components/ui';
import { useModuleConcepts, type Concept } from '../api/tutorApi';

export function ModuleConceptsPage() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const { data, isPending, error } = useModuleConcepts(moduleId);

  if (isPending) {
    return (
      <div className="animate-pulse">
        <div className="h-[9px] w-[70px] rounded-full bg-surface-sunken" />
        <div className="mt-[12px] h-[22px] w-1/2 rounded-full bg-surface-sunken" />
        <div className="mt-[28px] h-[80px] rounded-[14px] bg-surface-sunken" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="px-[20px] py-[18px]">
        <p className="text-[13px] text-caution-ink">
          Could not load this module. It may not exist, or the tutor service may not be
          running.
        </p>
        <Link
          to="/dashboard"
          className="mt-[10px] inline-block text-[12.5px] font-medium text-brand hover:text-brand-hover"
        >
          Back to dashboard
        </Link>
      </Card>
    );
  }

  const { module, topics } = data;

  return (
    <div className="flex flex-col gap-[26px]">
      <header>
        <Link
          to="/dashboard"
          className="font-mono text-[11px] text-ink-faint hover:text-brand"
        >
          ← Dashboard
        </Link>

        <div className="mt-[12px] flex flex-wrap items-end justify-between gap-[12px]">
          <div>
            {module.code && (
              <span className="font-mono text-[11px] tracking-tight text-ink-faint">
                {module.code}
              </span>
            )}
            <h1 className="mt-[3px] text-[23px] font-semibold tracking-tight text-ink">
              {module.name}
            </h1>
          </div>
          <div className="flex items-center gap-[7px]">
            <Badge>{module.topic_count} topics</Badge>
            <Badge>{module.concept_count} concepts</Badge>
          </div>
        </div>

        {module.description && (
          <p className="mt-[10px] max-w-[640px] text-[13px] leading-[1.6] text-ink-muted">
            {module.description}
          </p>
        )}
      </header>

      <div className="flex flex-col gap-[20px]">
        {topics.map((topic, topicIndex) => (
          <section key={topic.topic_id}>
            <div className="mb-[10px] flex items-center gap-[9px]">
              <span className="flex size-[20px] items-center justify-center rounded-[5px] border border-line font-mono text-[11px] text-ink-muted">
                {topicIndex + 1}
              </span>
              <h2 className="text-[13.5px] font-medium text-ink">{topic.name}</h2>
              <span className="font-mono text-[10.5px] text-ink-faint">
                {topic.concepts.length} concepts
              </span>
            </div>

            <Card className="divide-y divide-line-soft overflow-hidden">
              {topic.concepts.map((concept) => (
                <ConceptRow key={concept.concept_id} concept={concept} />
              ))}
            </Card>
          </section>
        ))}
      </div>

      <p className="border-t border-line-soft pt-[14px] text-[11.5px] text-ink-faint">
        Concepts come from the agreed seed list in{' '}
        <code className="font-mono text-[11px]">database/seed/</code> and are the join key
        between course content and the concept graph. Tutoring sessions and mastery tracking
        arrive in later phases.
      </p>
    </div>
  );
}

function ConceptRow({ concept }: { concept: Concept }) {
  return (
    <div className="px-[18px] py-[13px]">
      <div className="flex flex-wrap items-baseline justify-between gap-[8px]">
        <h3 className="text-[13.5px] font-medium text-ink">{concept.name}</h3>
        <code className="font-mono text-[10.5px] text-ink-faint">{concept.concept_id}</code>
      </div>

      {concept.description && (
        <p className="mt-[4px] max-w-[680px] text-[12.5px] leading-[1.6] text-ink-muted">
          {concept.description}
        </p>
      )}

      {concept.prerequisite_ids.length > 0 && (
        <div className="mt-[9px] flex flex-wrap items-center gap-[6px]">
          <span className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">
            needs
          </span>
          {concept.prerequisite_ids.map((prerequisiteId) => (
            <Badge
              key={prerequisiteId}
              // A prerequisite from another module is the cross-module dependency
              // C1's graph cares about, so it reads differently here too.
              tone={prerequisiteId.startsWith(`${concept.concept_id.split('.')[0]}.`)
                ? 'neutral'
                : 'brand'}
            >
              {prerequisiteId}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
