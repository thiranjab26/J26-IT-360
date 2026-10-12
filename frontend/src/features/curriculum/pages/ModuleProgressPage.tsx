import { Link, useParams } from 'react-router-dom';

import { Badge, Card, cx } from '@/shared/components/ui';
import {
  useGraph,
  useMastery,
  useTestStatus,
  type Attempt,
  type ConceptMastery,
  type GraphNode,
  type TestStatus,
} from '../api/curriculumApi';
import {
  ErrorCard,
  LEVEL_LABEL,
  LEVEL_TONE,
  MasteryBar,
  ModuleHeader,
  PageSkeleton,
} from '../components/common';
import { RecommendationCard } from '../components/RecommendationCard';
import { TEST_LABELS, masteryLevel, moduleName, percent, testStep } from '../lib/modules';

/** Test status and the mastery dashboard for one module. */
export function ModuleProgressPage() {
  const { moduleId = '' } = useParams<{ moduleId: string }>();
  const status = useTestStatus(moduleId);
  const graph = useGraph(moduleId);
  const mastery = useMastery(moduleId);

  const error = status.error ?? graph.error ?? mastery.error;
  if (error) return <ErrorCard error={error} what="this module" />;
  if (!status.data || !graph.data || !mastery.data) return <PageSkeleton />;

  return (
    <div className="flex flex-col gap-[24px]">
      <ModuleHeader moduleId={moduleId} phase={status.data.phase} />
      {status.data.phase === 'learning' && <RecommendationCard moduleId={moduleId} />}
      <TestCard moduleId={moduleId} status={status.data} />
      <MasteryDashboard
        moduleId={moduleId}
        nodes={graph.data.nodes}
        concepts={mastery.data.concepts}
        threshold={mastery.data.threshold}
      />
    </div>
  );
}

/* --------------------------------------------------------------- Test card */

function TestCard({ moduleId, status }: { moduleId: string; status: TestStatus }) {
  const step = testStep(status);

  return (
    <Card className="px-[20px] py-[18px]">
      <div className="flex flex-wrap items-start justify-between gap-[14px]">
        <div className="max-w-[560px]">
          <h2 className="text-[14px] font-semibold text-ink">Pre-test and post-test</h2>
          <p className="mt-[4px] text-[12.5px] leading-[1.6] text-ink-muted">
            {cardMessage(status)}
          </p>
        </div>
        {step && step.state !== 'done' && (
          <Link
            to={`/curriculum/${moduleId}/test/${step.kind}`}
            className="inline-flex items-center rounded-[8px] bg-brand px-[18px] py-[10px] text-[13.5px] font-medium text-white hover:bg-brand-hover"
          >
            {step.state === 'resume' ? 'Resume' : 'Start'} {TEST_LABELS[step.kind].toLowerCase()}
          </Link>
        )}
      </div>

      {(status.pretest || status.posttest) && (
        <div className="mt-[14px] grid gap-[10px] border-t border-line-soft pt-[14px] sm:grid-cols-2">
          <AttemptLine label={TEST_LABELS.pretest} attempt={status.pretest} />
          <AttemptLine label={TEST_LABELS.posttest} attempt={status.posttest} />
        </div>
      )}
      {status.posttest?.submitted_at && (
        <Link
          to={`/curriculum/${moduleId}/gain`}
          className="mt-[12px] inline-block text-[13px] font-medium text-brand hover:text-brand-hover"
        >
          See how much you learned
        </Link>
      )}
    </Card>
  );
}

function cardMessage(status: TestStatus): string {
  const step = testStep(status);
  const name = moduleName(status.module_id);
  if (step?.state === 'start' && step.kind === 'pretest')
    return `Answer a short set of questions on ${name} so your path starts at the right place. You have one attempt.`;
  if (step?.state === 'start') return 'Answer the same kind of questions again to see how much you learned. One attempt.';
  if (step?.state === 'resume') return 'You started this test. Your saved answers are waiting.';
  if (step?.state === 'done') return 'Submitted. Thank you.';
  switch (status.phase) {
    case 'closed':
      return 'Your lecturer has not opened this module yet.';
    case 'learning':
      return status.pretest?.submitted_at
        ? 'Learning phase. Your path below updates as you practise.'
        : 'The pre-test has closed. Ask your lecturer if you missed it.';
    case 'finished':
      return 'This module is finished.';
    default:
      return '';
  }
}

function AttemptLine({ label, attempt }: { label: string; attempt: Attempt | null }) {
  let value = 'Not taken';
  if (attempt?.submitted_at && attempt.score_pct !== null) {
    value = `${Math.round(attempt.score_pct)}%`;
    if (attempt.main_total) value += ` (${attempt.main_correct} of ${attempt.main_total})`;
  } else if (attempt) {
    value = 'In progress';
  }
  return (
    <div className="flex items-baseline justify-between gap-[10px] rounded-[8px] bg-surface-muted px-[12px] py-[9px]">
      <span className="text-[12.5px] text-ink-soft">{label}</span>
      <span className="font-mono text-[12px] text-ink">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------ Mastery dashboard */

interface TopicGroup {
  topicId: string;
  name: string;
  concepts: Array<{ node: GraphNode; mastery: ConceptMastery | undefined }>;
}

/** Module's own topics in teaching order; prerequisites from other modules go last. */
function groupByTopic(moduleId: string, nodes: GraphNode[], concepts: ConceptMastery[]) {
  const byId = new Map(concepts.map((c) => [c.concept_id, c]));
  const groups = new Map<string, TopicGroup>();
  const outside: TopicGroup = { topicId: '_other', name: 'From other modules', concepts: [] };

  for (const node of [...nodes].sort((a, b) => a.position - b.position)) {
    const entry = { node, mastery: byId.get(node.concept_id) };
    if (node.module_id !== moduleId) {
      outside.concepts.push(entry);
      continue;
    }
    const group = groups.get(node.topic_id) ?? {
      topicId: node.topic_id,
      name: node.topic_name,
      concepts: [],
    };
    group.concepts.push(entry);
    groups.set(node.topic_id, group);
  }
  return outside.concepts.length ? [...groups.values(), outside] : [...groups.values()];
}

function MasteryDashboard({
  moduleId,
  nodes,
  concepts,
  threshold,
}: {
  moduleId: string;
  nodes: GraphNode[];
  concepts: ConceptMastery[];
  threshold: number;
}) {
  const own = concepts.filter((c) => c.module_id === moduleId);
  const mastered = own.filter((c) => c.is_mastered).length;
  const started = own.filter((c) => c.mastery_score !== null).length;
  const groups = groupByTopic(moduleId, nodes, concepts);

  return (
    <section className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-baseline justify-between gap-[10px]">
        <h2 className="text-[14px] font-semibold text-ink">Mastery</h2>
        <span className="font-mono text-[10.5px] text-ink-faint">
          mastered at {percent(threshold)} or more
        </span>
      </div>

      <div className="grid grid-cols-3 gap-[10px]">
        <Stat label="Mastered" value={mastered} of={own.length} />
        <Stat label="In progress" value={started - mastered} of={own.length} />
        <Stat label="Not started" value={own.length - started} of={own.length} />
      </div>

      {groups.map((group) => (
        <TopicCard key={group.topicId} group={group} threshold={threshold} />
      ))}
    </section>
  );
}

function Stat({ label, value, of }: { label: string; value: number; of: number }) {
  return (
    <Card className="px-[14px] py-[12px]">
      <p className="text-[11.5px] text-ink-muted">{label}</p>
      <p className="mt-[2px] text-[20px] font-semibold tracking-tight text-ink">
        {value}
        <span className="ml-[4px] text-[12px] font-normal text-ink-faint">/ {of}</span>
      </p>
    </Card>
  );
}

function TopicCard({ group, threshold }: { group: TopicGroup; threshold: number }) {
  const done = group.concepts.filter((c) => c.mastery?.is_mastered).length;
  const outside = group.topicId === '_other';

  return (
    <div>
      <div className="mb-[8px] flex items-center justify-between gap-[10px]">
        <h3 className={cx('text-[13px] font-medium', outside ? 'text-ink-muted' : 'text-ink')}>
          {group.name}
        </h3>
        <span className="font-mono text-[10.5px] text-ink-faint">
          {done} / {group.concepts.length} mastered
        </span>
      </div>
      <Card className="divide-y divide-line-soft overflow-hidden">
        {group.concepts.map(({ node, mastery }) => {
          const level = masteryLevel(mastery);
          const score = mastery?.mastery_score ?? null;
          return (
            <div
              key={node.concept_id}
              className="grid gap-[8px] px-[16px] py-[11px] sm:grid-cols-[1fr_200px_auto] sm:items-center sm:gap-[16px]"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] text-ink">{node.name}</p>
                <p className="font-mono text-[10px] text-ink-faint">
                  {mastery?.evidence_count ?? 0} answers
                </p>
              </div>
              <MasteryBar score={score} level={level} threshold={threshold} />
              <div className="flex items-center gap-[8px] sm:justify-end">
                <span className="w-[36px] text-right font-mono text-[11.5px] text-ink-soft">
                  {score === null ? '-' : percent(score)}
                </span>
                <Badge tone={LEVEL_TONE[level]}>{LEVEL_LABEL[level]}</Badge>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
