import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/shared/api/client';

const BASE = '/v1/curriculum';

/* ------------------------------------------------------------------- Types */

export type Phase = 'closed' | 'pretest' | 'learning' | 'posttest' | 'finished';
export type TestKind = 'pretest' | 'posttest';

export interface GraphNode {
  concept_id: string;
  name: string;
  module_id: string;
  topic_id: string;
  topic_name: string;
  position: number;
  depth: number;
  prerequisite_count: number;
}

/** `prerequisite_id` must be learned before `concept_id`. */
export interface GraphEdge {
  concept_id: string;
  prerequisite_id: string;
  cross_module: boolean;
}

export interface Graph {
  graph_version: string;
  source: string;
  fallback_reason: string | null;
  module_id: string | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { concepts: number; edges: number; cross_module_edges: number; max_depth: number };
}

export interface ConceptMastery {
  concept_id: string;
  name: string;
  module_id: string;
  topic_id: string;
  /** null = no evidence yet */
  mastery_score: number | null;
  is_mastered: boolean;
  evidence_count: number;
  needs_reassessment: boolean;
  updated_at: string | null;
}

export interface Mastery {
  module_id: string | null;
  threshold: number;
  params_version: string;
  concepts: ConceptMastery[];
}

export interface Attempt {
  started_at: string;
  submitted_at: string | null;
  score_pct: number | null;
  main_correct: number | null;
  main_total: number | null;
}

export interface TestStatus {
  module_id: string;
  phase: Phase;
  open_test: TestKind | null;
  pretest: Attempt | null;
  posttest: Attempt | null;
}

/** A question as the learner sees it: options already shuffled, never the answer. */
export interface TestItem {
  item_id: string;
  position: number;
  section: 'main' | 'prereq';
  stem: string;
  options: string[];
}

export interface TestPaper {
  module_id: string;
  kind: TestKind;
  attempt: Attempt;
  items: TestItem[];
}

/** `chosen_index` is the position as shown; the server maps it back before scoring. */
export interface Answer {
  item_id: string;
  chosen_index: number | null;
}

export interface SubmitResult {
  module_id: string;
  kind: TestKind;
  repeat: boolean;
  attempt: Attempt;
}

export interface ConceptRef {
  concept_id: string;
  name: string;
}

export interface Recommendation {
  next_concept: ConceptRef;
  next_topic_id: string;
  target_concept: ConceptRef | null;
  weak_prerequisite: ConceptRef | null;
  readiness: number;
  /** null for the comparison group */
  explanation: string | null;
  reason: string;
  model_version: string;
}

export interface Plan {
  module_id: string;
  graph_version: string;
  complete: boolean;
  recommendation: Recommendation | null;
  locked: Array<{
    concept: ConceptRef;
    weak_prerequisite: ConceptRef;
    weak_prerequisite_mastery: number;
  }>;
}

/** A practice question as shown: options shuffled for this learner, never the answer. */
export interface PracticeItem {
  item_id: string;
  concept: ConceptRef;
  stem: string;
  options: string[];
  has_hint: boolean;
}

export interface PracticeResult {
  correct: boolean;
  /** shown position of the right option */
  right_option: number;
  /** false for a question already answered before */
  counted: boolean;
  /** first try and no hint */
  counted_as_correct: boolean;
  hints_used: number;
  mastery: ConceptMastery;
}

export interface GainLine {
  pre_pct: number;
  post_pct: number;
  /** null when the pre-test score was 100 */
  gain: number | null;
}

export interface Gain {
  module_id: string;
  overall: GainLine;
  by_topic: Record<string, GainLine>;
  by_concept: Record<string, GainLine>;
}

/* ------------------------------------------------------------ Staff types */

export interface Overview {
  module_id: string;
  threshold: number;
  learners: number;
  groups: Record<string, number>;
  pretest_done: number;
  posttest_done: number;
  concepts: Array<{
    concept_id: string;
    name: string;
    topic_id: string;
    learners: number;
    mastered: number;
    mastered_pct: number | null;
    mean_mastery: number | null;
  }>;
}

export interface GroupSummary {
  learners: number;
  mean_pre: number | null;
  mean_post: number | null;
  mean_gain: number | null;
  class_gain: number | null;
}

export interface CohortGain {
  module_id: string;
  enrolled: number;
  pretest_done: number;
  posttest_done: number;
  groups: Record<string, GroupSummary>;
  learners: Array<GainLine & { user_id: string; group: string; form_order: string }>;
}

export interface SnapshotValidation {
  module_id: string;
  params_version: string;
  answers: number;
  learners: number;
  correct_rate: number | null;
  auc: number | null;
  brier: number | null;
  threshold_accuracy: number | null;
}

export type PaperStatus = 'draft' | 'published' | 'locked';

export interface PaperSummary {
  paper_id: string;
  module_id: string;
  form: 'A' | 'B';
  title: string;
  version: number;
  status: PaperStatus;
  /** the version new learners get */
  current: boolean;
  main_items: number;
  prereq_items: number;
  published_at: string | null;
  locked_at: string | null;
}

/** Includes the answer: staff only. */
export interface StaffItem {
  item_id: string;
  position: number;
  concept_id: string;
  section: 'main' | 'prereq';
  stem: string;
  options: string[];
  answer_index: number;
  twin_item_id: string | null;
}

export interface Paper extends PaperSummary {
  items: StaffItem[];
}

export type ItemInput = Omit<StaffItem, 'item_id' | 'position'> & { position?: number | null };

export type GraphEditAction = 'add_edge' | 'remove_edge';

/** `prerequisite_id` must be learned before `concept_id`. */
export interface GraphEditInput {
  action: GraphEditAction;
  concept_id: string;
  prerequisite_id: string;
  /** kept in the audit log */
  reason: string;
}

export interface GraphEditResult {
  graph_version: string;
  edges: number;
  action: GraphEditAction;
  concept_id: string;
  prerequisite_id: string;
}

export interface GraphAuditEntry {
  changed_at: string | null;
  actor: string;
  action: string;
  concept_id: string | null;
  prerequisite_id: string | null;
  graph_version: string;
  details: { reason?: string; previous_version?: string; [key: string]: unknown };
}

/* ------------------------------------------------------------------- Hooks */

export const curriculumKeys = {
  all: ['curriculum'] as const,
  graph: (moduleId?: string) => ['curriculum', 'graph', moduleId ?? 'all'] as const,
  mastery: (moduleId?: string) => ['curriculum', 'mastery', moduleId ?? 'all'] as const,
  tests: (moduleId: string) => ['curriculum', 'tests', moduleId] as const,
  plan: (moduleId: string) => ['curriculum', 'plan', moduleId] as const,
  practice: (conceptId: string) => ['curriculum', 'practice', conceptId] as const,
  gain: (moduleId: string) => ['curriculum', 'gain', moduleId] as const,
  staff: (moduleId: string) => ['curriculum', 'staff', moduleId] as const,
  papers: (moduleId: string) => ['curriculum', 'staff', moduleId, 'papers'] as const,
  paper: (paperId: string) => ['curriculum', 'staff', 'paper', paperId] as const,
  graphAudit: ['curriculum', 'staff', 'graph-audit'] as const,
};

function moduleQuery(moduleId?: string): string {
  return moduleId ? `?module=${encodeURIComponent(moduleId)}` : '';
}

export function useGraph(moduleId?: string) {
  return useQuery({
    queryKey: curriculumKeys.graph(moduleId),
    queryFn: () => request<Graph>(`${BASE}/graph${moduleQuery(moduleId)}`),
    staleTime: 5 * 60_000,
  });
}

export function useMastery(moduleId?: string) {
  return useQuery({
    queryKey: curriculumKeys.mastery(moduleId),
    queryFn: () => request<Mastery>(`${BASE}/me/mastery${moduleQuery(moduleId)}`),
  });
}

export function useTestStatus(moduleId: string | undefined) {
  return useQuery({
    queryKey: curriculumKeys.tests(moduleId ?? ''),
    queryFn: () => request<TestStatus>(`${BASE}/me/tests${moduleQuery(moduleId)}`),
    enabled: Boolean(moduleId),
  });
}

/** Starts the test, or resumes it with the same option order. */
export function useStartTest(moduleId: string, kind: TestKind) {
  return useMutation({
    mutationFn: () =>
      request<TestPaper>(`${BASE}/me/tests/${kind}/start${moduleQuery(moduleId)}`, {
        method: 'POST',
      }),
  });
}

/** Submits once; a repeat submit returns the stored result. */
export function useSubmitTest(moduleId: string, kind: TestKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (answers: Answer[]) =>
      request<SubmitResult>(`${BASE}/me/tests/${kind}/submit${moduleQuery(moduleId)}`, {
        method: 'POST',
        body: { answers },
      }),
    // The pre-test sets starting mastery, so mastery and status both change.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: curriculumKeys.all }),
  });
}

/** Also ingests new practice answers, so the plan is never stale. */
export function usePlan(moduleId: string, enabled = true) {
  return useQuery({
    queryKey: curriculumKeys.plan(moduleId),
    queryFn: () => request<Plan>(`${BASE}/me/recommendation${moduleQuery(moduleId)}`),
    enabled,
  });
}

/** Rates the explanation the server last showed for this module; the sentence is never sent. */
export function useExplanationFeedback(moduleId: string) {
  return useMutation({
    mutationFn: ({ conceptId, helpful }: { conceptId: string; helpful: boolean }) =>
      request<void>(`${BASE}/me/recommendation/feedback${moduleQuery(moduleId)}`, {
        method: 'POST',
        body: { concept_id: conceptId, helpful },
      }),
  });
}

export function useGain(moduleId: string, enabled = true) {
  return useQuery({
    queryKey: curriculumKeys.gain(moduleId),
    queryFn: () => request<Gain>(`${BASE}/me/gain${moduleQuery(moduleId)}`),
    enabled,
    retry: false,
  });
}

/* ---------------------------------------------------------------- Practice */

export function usePracticeItem(conceptId: string) {
  return useQuery({
    queryKey: curriculumKeys.practice(conceptId),
    queryFn: () =>
      request<PracticeItem>(`${BASE}/me/practice/next?concept=${encodeURIComponent(conceptId)}`),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
}

export function usePracticeHint() {
  return useMutation({
    mutationFn: (itemId: string) =>
      request<{ hint: string; hints_used: number }>(`${BASE}/me/practice/hint`, {
        method: 'POST',
        body: { item_id: itemId },
      }),
  });
}

/** `chosenIndex` is the position as shown; the server maps it back. */
export function usePracticeAnswer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, chosenIndex }: { itemId: string; chosenIndex: number }) =>
      request<PracticeResult>(`${BASE}/me/practice/answer`, {
        method: 'POST',
        body: { item_id: itemId, chosen_index: chosenIndex },
      }),
    // Mastery and the plan change; the current question stays until "Next".
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['curriculum', 'mastery'] }),
        queryClient.invalidateQueries({ queryKey: ['curriculum', 'plan'] }),
      ]),
  });
}

/* ------------------------------------------------------------------- Staff */

export function useWindow(moduleId: string) {
  return useQuery({
    queryKey: [...curriculumKeys.staff(moduleId), 'window'],
    queryFn: () =>
      request<{ module_id: string; phase: Phase }>(`${BASE}/study/${moduleId}/window`),
  });
}

export function useSetWindow(moduleId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (phase: Phase) =>
      request<{ module_id: string; phase: Phase }>(`${BASE}/study/${moduleId}/window`, {
        method: 'PUT',
        body: { phase },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: curriculumKeys.all }),
  });
}

export function useOverview(moduleId: string) {
  return useQuery({
    queryKey: [...curriculumKeys.staff(moduleId), 'overview'],
    queryFn: () => request<Overview>(`${BASE}/study/${moduleId}/overview`),
  });
}

export function useCohortGain(moduleId: string) {
  return useQuery({
    queryKey: [...curriculumKeys.staff(moduleId), 'gain'],
    queryFn: () => request<CohortGain>(`${BASE}/study/${moduleId}/gain`),
  });
}

export function useSnapshotValidation(moduleId: string) {
  return useQuery({
    queryKey: [...curriculumKeys.staff(moduleId), 'snapshot'],
    queryFn: () => request<SnapshotValidation>(`${BASE}/study/${moduleId}/snapshot-validation`),
  });
}

/* ------------------------------------------------------------ Graph editor */

export function useGraphAudit() {
  return useQuery({
    queryKey: curriculumKeys.graphAudit,
    queryFn: () => request<GraphAuditEntry[]>(`${BASE}/graph/audit?limit=50`),
  });
}

/** The server validates (no loop, no duplicate) and logs every edit with its reason. */
export function useGraphEdit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: GraphEditInput) =>
      request<GraphEditResult>(`${BASE}/graph/edits`, { method: 'POST', body }),
    // Readiness and explanations read the graph, so plans change too.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['curriculum', 'graph'] }),
        queryClient.invalidateQueries({ queryKey: ['curriculum', 'plan'] }),
        queryClient.invalidateQueries({ queryKey: curriculumKeys.graphAudit }),
      ]),
  });
}

/* --------------------------------------------------------- Question editor */

const paperPath = (paperId: string) => `${BASE}/papers/${encodeURIComponent(paperId)}`;

export function usePapers(moduleId: string) {
  return useQuery({
    queryKey: curriculumKeys.papers(moduleId),
    queryFn: () => request<PaperSummary[]>(`${BASE}/papers${moduleQuery(moduleId)}`),
  });
}

export function usePaper(paperId: string) {
  return useQuery({
    queryKey: curriculumKeys.paper(paperId),
    queryFn: () => request<Paper>(paperPath(paperId)),
  });
}

/** Every editor change refreshes the paper list and the open paper. */
function useStaffMutation<TVars, TResult>(
  moduleId: string,
  fn: (vars: TVars) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: curriculumKeys.staff(moduleId) }),
        queryClient.invalidateQueries({ queryKey: ['curriculum', 'staff', 'paper'] }),
      ]),
  });
}

export function useCreatePaper(moduleId: string) {
  return useStaffMutation(moduleId, (body: { form: 'A' | 'B'; title: string }) =>
    request<Paper>(`${BASE}/papers${moduleQuery(moduleId)}`, { method: 'POST', body }),
  );
}

export function useRevisePaper(moduleId: string) {
  return useStaffMutation(moduleId, (paperId: string) =>
    request<Paper>(`${paperPath(paperId)}/revise`, { method: 'POST' }),
  );
}

export function useDiscardPaper(moduleId: string) {
  return useStaffMutation(moduleId, (paperId: string) =>
    request<void>(paperPath(paperId), { method: 'DELETE' }),
  );
}

export function usePublishPapers(moduleId: string) {
  return useStaffMutation(moduleId, () =>
    request<{ module_id: string; published: string[] }>(
      `${BASE}/papers/publish${moduleQuery(moduleId)}`,
      { method: 'POST' },
    ),
  );
}

export function useSaveItem(moduleId: string, paperId: string) {
  return useStaffMutation(moduleId, ({ itemId, item }: { itemId: string | null; item: ItemInput }) =>
    itemId
      ? request<StaffItem>(`${paperPath(paperId)}/items/${encodeURIComponent(itemId)}`, {
          method: 'PUT',
          body: item,
        })
      : request<StaffItem>(`${paperPath(paperId)}/items`, { method: 'POST', body: item }),
  );
}

export function useRemoveItem(moduleId: string, paperId: string) {
  return useStaffMutation(moduleId, (itemId: string) =>
    request<void>(`${paperPath(paperId)}/items/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
    }),
  );
}
