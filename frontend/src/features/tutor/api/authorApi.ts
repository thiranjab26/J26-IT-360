import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { request } from "@/shared/api/client";

/** Everything a lecturer sees about practicals. These carry answers: students never get them. */

export type CheckStatus = "pass" | "warn" | "fail";

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

export type ItemStatus = "draft" | "approved" | "rejected" | "retired";
export type ItemOrigin = "authored" | "generated" | "manual";

export interface AuthorItem {
  practical_id: string;
  slot_id: string;
  concept_id: string;
  concept_title: string;
  title: string;
  number: number;
  level: number;
  origin: ItemOrigin;
  status: ItemStatus;
  statement: string;
  reference_solution: string;
  checks: Check[];
  tests_total: number;
  replaces: string | null;
  replaced_by: string | null;
  created_by: string | null;
  created_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  can_approve: boolean;
}

export interface AuthorTest {
  stdin: string;
  expected: string;
  visible: boolean;
  source: string;
}

export interface AuthorDetail extends AuthorItem {
  tests: AuthorTest[];
  slot_history: AuthorItem[];
}

export interface AuthorOverview {
  current: AuthorItem[];
  drafts: AuthorItem[];
  history: AuthorItem[];
}

export interface Job {
  job_id: string;
  concept_id: string;
  status: "queued" | "running" | "finished" | "failed";
  requested: number;
  done: number;
  failed: number;
  hint: string | null;
  draft_ids: string[];
  message: string | null;
}

export interface BulkResult {
  practical_id: string;
  ok: boolean;
  code: string | null;
  message: string | null;
}

const KEY = ["tutor", "author"] as const;
const BASE = "/v1/tutor/author";

export function useAuthorOverview(conceptId: string | undefined) {
  return useQuery({
    queryKey: [...KEY, "overview", conceptId],
    queryFn: () =>
      request<AuthorOverview>(`${BASE}/practicals?concept_id=${conceptId}`),
    enabled: Boolean(conceptId),
    staleTime: 0,
  });
}

export function useAuthorDetail(practicalId: string | null) {
  return useQuery({
    queryKey: [...KEY, "detail", practicalId],
    queryFn: () => request<AuthorDetail>(`${BASE}/practicals/${practicalId}`),
    enabled: Boolean(practicalId),
    staleTime: 0,
  });
}

/** Polls a generation job until it has finished, so drafts appear as they are made. */
export function useJob(jobId: string | null) {
  const client = useQueryClient();
  return useQuery({
    queryKey: [...KEY, "job", jobId],
    queryFn: async () => {
      const job = await request<Job>(`${BASE}/jobs/${jobId}`);
      // New drafts may have been saved since the last look.
      void client.invalidateQueries({ queryKey: [...KEY, "overview"] });
      return job;
    },
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "finished" || status === "failed" ? false : 3000;
    },
    staleTime: 0,
  });
}

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: KEY });
}

export function useGenerate() {
  return useMutation({
    mutationFn: (input: {
      concept_id: string;
      count: number;
      hint: string | null;
      replaces?: string[];
    }) => request<Job>(`${BASE}/generate`, { method: "POST", body: input }),
  });
}

export function useCreateDraft() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: {
      concept_id: string;
      statement: string;
      reference_solution: string;
      level: number;
      replaces: string | null;
      suggest_tests: boolean;
    }) =>
      request<AuthorItem>(`${BASE}/drafts`, { method: "POST", body: input }),
    onSuccess: refresh,
  });
}

export function useEditDraft() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: {
      practical_id: string;
      statement: string;
      reference_solution: string;
      level: number;
    }) =>
      request<AuthorItem>(`${BASE}/drafts/${input.practical_id}/edit`, {
        method: "POST",
        body: {
          statement: input.statement,
          reference_solution: input.reference_solution,
          level: input.level,
          suggest_tests: false,
        },
      }),
    onSuccess: refresh,
  });
}

export function useReview() {
  const refresh = useRefresh();
  return {
    approve: useMutation({
      mutationFn: (input: { practical_id: string; note: string | null }) =>
        request<AuthorItem>(`${BASE}/drafts/${input.practical_id}/approve`, {
          method: "POST",
          body: { note: input.note },
        }),
      onSuccess: refresh,
    }),
    reject: useMutation({
      mutationFn: (input: { practical_id: string; note: string | null }) =>
        request<AuthorItem>(`${BASE}/drafts/${input.practical_id}/reject`, {
          method: "POST",
          body: { note: input.note },
        }),
      onSuccess: refresh,
    }),
    restore: useMutation({
      mutationFn: (practicalId: string) =>
        request<AuthorItem>(`${BASE}/practicals/${practicalId}/restore`, {
          method: "POST",
        }),
      onSuccess: refresh,
    }),
    approveMany: useMutation({
      mutationFn: (input: { practical_ids: string[]; note: string | null }) =>
        request<{ results: BulkResult[] }>(`${BASE}/drafts/bulk-approve`, {
          method: "POST",
          body: input,
        }),
      onSuccess: refresh,
    }),
    rejectMany: useMutation({
      mutationFn: (input: { practical_ids: string[]; note: string | null }) =>
        request<{ results: BulkResult[] }>(`${BASE}/drafts/bulk-reject`, {
          method: "POST",
          body: input,
        }),
      onSuccess: refresh,
    }),
  };
}
