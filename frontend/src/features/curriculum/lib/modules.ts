import type { ConceptMastery, GraphNode, Phase, TestKind, TestStatus } from '../api/curriculumApi';

/** Display names only; module ids always come from the graph. */
const MODULE_NAMES: Record<string, string> = {
  prog: 'Programming Fundamentals in Java',
  dsa: 'Data Structures and Algorithms',
};

const MODULE_ORDER = ['prog', 'dsa'];

export function moduleName(moduleId: string): string {
  return MODULE_NAMES[moduleId] ?? moduleId.toUpperCase();
}

export function moduleIds(nodes: GraphNode[]): string[] {
  const ids = [...new Set(nodes.map((n) => n.module_id))];
  const rank = (id: string) => {
    const index = MODULE_ORDER.indexOf(id);
    return index === -1 ? MODULE_ORDER.length : index;
  };
  return ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export const PHASE_LABELS: Record<Phase, string> = {
  closed: 'Not open yet',
  pretest: 'Pre-test open',
  learning: 'Learning',
  posttest: 'Post-test open',
  finished: 'Finished',
};

export const TEST_LABELS: Record<TestKind, string> = {
  pretest: 'Pre-test',
  posttest: 'Post-test',
};

export interface TestStep {
  kind: TestKind;
  state: 'start' | 'resume' | 'done';
}

/** The test the learner can act on now, if the lecturer has one open. */
export function testStep(status: TestStatus | undefined): TestStep | null {
  const kind = status?.open_test;
  if (!status || !kind) return null;
  const attempt = status[kind];
  if (attempt?.submitted_at) return { kind, state: 'done' };
  return { kind, state: attempt ? 'resume' : 'start' };
}

export type MasteryLevel = 'mastered' | 'learning' | 'none';

export function masteryLevel(concept: ConceptMastery | undefined): MasteryLevel {
  if (!concept || concept.mastery_score === null) return 'none';
  return concept.is_mastered ? 'mastered' : 'learning';
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
