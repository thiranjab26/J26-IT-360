import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/shared/api/client';
import type { Rewards } from './sessionApi';

export interface PracticalSummary {
  practical_id: string;
  concept_id: string;
  concept_title: string;
  level: number;
  title: string;
  unlocked: boolean;
  /** False until the practical's tests have been built. */
  ready: boolean;
  passed: boolean;
  /** For example "4 of 7", after at least one submission. */
  best: string | null;
}

export interface VisibleTest {
  stdin: string;
  expected: string;
}

export interface Practical {
  practical_id: string;
  concept_id: string;
  concept_title: string;
  level: number;
  title: string;
  statement: string;
  starter_code: string;
  last_source: string | null;
  visible_tests: VisibleTest[];
  tests_total: number;
  passed: boolean;
}

export type RunStatus = 'ok' | 'runtime_error' | 'timeout' | 'output_limit' | 'not_compiled';

export interface RunResult {
  compiled: boolean;
  compile_output: string;
  status: RunStatus;
  stdout: string;
  stderr: string;
  ms: number;
}

export interface TestResult {
  number: number;
  visible: boolean;
  passed: boolean;
  status: Exclude<RunStatus, 'not_compiled'>;
  /** Only for visible tests. A hidden test says whether it passed and nothing more. */
  stdin: string | null;
  expected: string | null;
  actual: string | null;
  ms: number;
}

export interface SubmitResult {
  compiled: boolean;
  compile_output: string;
  passed: boolean;
  tests_passed: number;
  tests_total: number;
  results: TestResult[];
  /** Set the first time the practical is passed: the XP, any badge, any level up. */
  rewards: Rewards | null;
}

export function usePracticals() {
  return useQuery({
    queryKey: ['tutor', 'practicals'],
    queryFn: () => request<{ practicals: PracticalSummary[] }>('/v1/tutor/practicals'),
    staleTime: 0,
  });
}

export function usePractical(practicalId: string | undefined) {
  return useQuery({
    queryKey: ['tutor', 'practicals', practicalId],
    queryFn: () => request<Practical>(`/v1/tutor/practicals/${practicalId}`),
    enabled: Boolean(practicalId),
    staleTime: 0,
    retry: false,
  });
}

export function useRunPractical(practicalId: string) {
  return useMutation({
    mutationFn: (input: { source: string; stdin: string }) =>
      request<RunResult>(`/v1/tutor/practicals/${practicalId}/run`, {
        method: 'POST',
        body: input,
      }),
  });
}

export function useSubmitPractical(practicalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (source: string) =>
      request<SubmitResult>(`/v1/tutor/practicals/${practicalId}/submit`, {
        method: 'POST',
        body: { source },
      }),
    onSuccess: () => {
      // Standing, XP, level and badges may all have moved.
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'practicals'] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'profile'] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'leaderboard'] });
    },
  });
}
