import { Link } from 'react-router-dom';

import { Badge, Card } from '@/shared/components/ui';
import {
  useGraph,
  useMastery,
  useTestStatus,
  type ConceptMastery,
  type TestStatus,
} from '../api/curriculumApi';
import { ErrorCard, PageSkeleton, PhaseBadge } from '../components/common';
import { TEST_LABELS, moduleIds, moduleName, testStep } from '../lib/modules';

/** Module choice: one card per module in the prerequisite graph. */
export function CurriculumHomePage() {
  const graph = useGraph();
  const mastery = useMastery();

  if (graph.isPending) return <PageSkeleton />;
  if (graph.error) return <ErrorCard error={graph.error} what="your modules" />;

  const ids = moduleIds(graph.data.nodes);

  return (
    <div className="flex flex-col gap-[28px]">
      <header>
        <p className="font-mono text-[11px] tracking-tight text-ink-faint">ADAPTIVE CURRICULUM</p>
        <h1 className="mt-[6px] text-[25px] font-semibold tracking-tight text-ink">
          My learning path
        </h1>
        <p className="mt-[5px] max-w-[620px] text-[13px] text-ink-muted">
          Each module starts with a short pre-test. Your answers set where you begin, and the
          path then adapts as you practise.
        </p>
      </header>

      <div className="grid gap-[14px] sm:grid-cols-2">
        {ids.map((id) => (
          <ModuleCard
            key={id}
            moduleId={id}
            concepts={(mastery.data?.concepts ?? []).filter((c) => c.module_id === id)}
            conceptCount={graph.data.nodes.filter((n) => n.module_id === id).length}
          />
        ))}
      </div>
    </div>
  );
}

function ModuleCard({
  moduleId,
  concepts,
  conceptCount,
}: {
  moduleId: string;
  concepts: ConceptMastery[];
  conceptCount: number;
}) {
  const status = useTestStatus(moduleId);
  const mastered = concepts.filter((c) => c.is_mastered).length;

  return (
    <Link to={`/curriculum/${moduleId}`} className="group rounded-[14px] focus-visible:outline-none">
      <Card className="h-full px-[20px] py-[18px] transition-colors group-hover:border-line-strong">
        <div className="flex items-start justify-between gap-[12px]">
          <div>
            <span className="font-mono text-[10.5px] tracking-tight text-ink-faint">
              {moduleId.toUpperCase()}
            </span>
            <h2 className="mt-[3px] text-[15.5px] font-semibold tracking-tight text-ink group-hover:text-brand">
              {moduleName(moduleId)}
            </h2>
          </div>
          {status.data && <PhaseBadge phase={status.data.phase} />}
        </div>

        <p className="mt-[8px] text-[12.5px] leading-[1.6] text-ink-muted">
          {nextStep(status.data)}
        </p>

        <div className="mt-[16px] flex flex-wrap items-center gap-[7px] border-t border-line-soft pt-[13px]">
          <Badge>{conceptCount} concepts</Badge>
          <Badge tone={mastered > 0 ? 'verified' : 'neutral'}>{mastered} mastered</Badge>
        </div>
      </Card>
    </Link>
  );
}

function nextStep(status: TestStatus | undefined): string {
  const step = testStep(status);
  if (step && step.state !== 'done') {
    const verb = step.state === 'resume' ? 'Resume' : 'Start';
    return `The ${TEST_LABELS[step.kind].toLowerCase()} is open. ${verb} it here.`;
  }
  if (status?.pretest?.submitted_at) return 'See your progress and the concept roadmap.';
  return 'See the concepts and how they build on each other.';
}
