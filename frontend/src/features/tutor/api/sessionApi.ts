import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/shared/api/client';

export type Phase = 'hook' | 'teach' | 'checkpoint' | 'feedback' | 'reteach' | 'ended';
export type TextSource = 'generated' | 'authored';

export interface SessionOption {
  letter: string;
  text: string;
}

export interface SessionQuestion {
  question_id: string;
  kind: 'mcq' | 'predict_output' | 'explain' | 'code';
  stem: string;
  options: SessionOption[];
  gating: boolean;
  attempt: number;
  max_attempts: number;
  hint: string | null;
  hint_source: TextSource | null;
}

export interface SessionFeedback {
  outcome: 'correct' | 'wrong' | 'unreadable';
  message: string;
  explanation: string | null;
  correct_option: string | null;
  xp_earned: number;
  attempt: number;
  tries_left: number | null;
}

export interface SessionSummary {
  exit_reason: string;
  xp_earned: number;
  gating_done: number;
  gating_total: number;
  mastery: number | null;
  can_resume: boolean;
}

export interface Session {
  session_id: string;
  concept_id: string;
  concept_title: string;
  phase: Phase;
  position: {
    step_number: number;
    total_steps: number;
    gating_done: number;
    gating_total: number;
  };
  xp_earned: number;
  heading: string | null;
  text: string | null;
  text_source: TextSource | null;
  source_text: string | null;
  question: SessionQuestion | null;
  feedback: SessionFeedback | null;
  summary: SessionSummary | null;
}

export interface ConceptProgress {
  concept_id: string;
  title: string;
  unlocked: boolean;
  mastery: number | null;
  mastered: boolean;
  unmet: Array<{
    kind: string;
    concept_id: string | null;
    required: number;
    current: number | null;
  }>;
}

export interface Progress {
  module_id: string;
  policy: 'mastery_gated' | 'points_only';
  total_xp: number;
  next_concept_id: string | null;
  active_session_id: string | null;
  concepts: ConceptProgress[];
}

export function useProgress(moduleId: string | undefined) {
  return useQuery({
    queryKey: ['tutor', 'progress', moduleId],
    queryFn: () => request<Progress>(`/v1/tutor/progress?module_id=${moduleId}`),
    enabled: Boolean(moduleId),
    // XP and unlocks change whenever a session moves, so never trust a cached copy.
    staleTime: 0,
  });
}

const sessionKey = (id: string | undefined) => ['tutor', 'session', id] as const;

export function useSession(sessionId: string | undefined) {
  return useQuery({
    queryKey: sessionKey(sessionId),
    queryFn: () => request<Session>(`/v1/tutor/sessions/${sessionId}`),
    enabled: Boolean(sessionId),
    // The server owns the session; never show a stale copy of it.
    staleTime: 0,
    retry: false,
  });
}

/**
 * One mutation per thing a student can do. Each returns the session's new state, which
 * replaces the cached copy, and refreshes progress (XP and unlocks may have changed).
 */
function useSessionAction<TInput>(send: (input: TInput) => Promise<Session>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (session) => {
      queryClient.setQueryData(sessionKey(session.session_id), session);
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'progress'] });
    },
  });
}

export function useStartSession() {
  return useSessionAction((conceptId: string) =>
    request<Session>('/v1/tutor/sessions', { method: 'POST', body: { concept_id: conceptId } }),
  );
}

export function useContinueSession() {
  return useSessionAction((sessionId: string) =>
    request<Session>(`/v1/tutor/sessions/${sessionId}/continue`, { method: 'POST' }),
  );
}

export function useAnswerSession() {
  return useSessionAction((input: { sessionId: string; answer: string }) =>
    request<Session>(`/v1/tutor/sessions/${input.sessionId}/answer`, {
      method: 'POST',
      body: { answer: input.answer },
    }),
  );
}

export function useEndSession() {
  return useSessionAction((sessionId: string) =>
    request<Session>(`/v1/tutor/sessions/${sessionId}/end`, { method: 'POST' }),
  );
}

export function useResumeSession() {
  return useSessionAction((sessionId: string) =>
    request<Session>(`/v1/tutor/sessions/${sessionId}/resume`, { method: 'POST' }),
  );
}
