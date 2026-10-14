import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { request } from '@/shared/api/client';

export type Phase = 'hook' | 'teach' | 'checkpoint' | 'feedback' | 'reteach' | 'ended';
export type TextSource = 'generated' | 'authored';
/**
 * What the faithfulness gate did with a text: verified (passed), unchecked (generated
 * with no gate), blocked (the model's wording was rejected, so this is the course text).
 */
export type TextCheck = 'verified' | 'unchecked' | 'blocked';

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
  hint_check: TextCheck | null;
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

export type Rarity = 'common' | 'rare' | 'epic';

export interface Bonus {
  kind: string;
  label: string;
  amount: number;
}

export interface BadgeInfo {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
}

export interface Level {
  number: number;
  name: string;
  total_xp: number;
  xp_into_level: number;
  /** XP between this level and the next; null at the top level. */
  xp_for_next: number | null;
  percent: number;
  next_name: string | null;
}

export interface LevelUp {
  from_level: number;
  to_level: number;
  name: string;
}

/** What one action paid out, for the celebration on screen. */
export interface Rewards {
  xp_gained: number;
  points: number;
  bonuses: Bonus[];
  badges: BadgeInfo[];
  level: Level;
  level_up: LevelUp | null;
}

export interface SessionSummary {
  exit_reason: string;
  xp_earned: number;
  gating_done: number;
  gating_total: number;
  mastery: number | null;
  can_resume: boolean;
  bonuses: Bonus[];
  badges: BadgeInfo[];
}

/** A passage an explanation was built from: the main one, and each the retriever added. */
export interface Source {
  chunk_id: string;
  label: string;
  kind: 'main' | 'retrieved';
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
  text_check: TextCheck | null;
  source_text: string | null;
  sources: Source[] | null;
  question: SessionQuestion | null;
  feedback: SessionFeedback | null;
  summary: SessionSummary | null;
  rewards: Rewards | null;
}

/** A part already read, for looking back. */
export interface HistoryPart {
  step_number: number;
  heading: string;
  text: string;
  text_source: TextSource | null;
  text_check: TextCheck | null;
  sources: Source[] | null;
}

export function useSessionHistory(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['tutor', 'session', sessionId, 'history'],
    queryFn: () =>
      request<{ parts: HistoryPart[] }>(`/v1/tutor/sessions/${sessionId}/history`),
    enabled: Boolean(sessionId),
    staleTime: 0,
    retry: false,
  });
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

export interface Quest {
  topic: string;
  concept_ids: string[];
  mastered: number;
  total: number;
  complete: boolean;
  reward_xp: number;
  reward_claimed: boolean;
}

export interface Progress {
  module_id: string;
  policy: 'mastery_gated' | 'points_only';
  total_xp: number;
  next_concept_id: string | null;
  active_session_id: string | null;
  concepts: ConceptProgress[];
  quests: Quest[];
  level: Level | null;
}

export interface Streak {
  current: number;
  longest: number;
  /** False with current > 0 means "learn today to keep it". */
  learned_today: boolean;
}

export interface BadgeStatus extends BadgeInfo {
  earned: boolean;
  earned_at: string | null;
}

export interface Profile {
  total_xp: number;
  level: Level;
  streak: Streak;
  badges: BadgeStatus[];
  completed_sessions: number;
}

export interface LeaderEntry {
  rank: number;
  name: string;
  xp: number;
  level_number: number;
  level_name: string;
  is_you: boolean;
}

export interface Leaderboard {
  entries: LeaderEntry[];
  you: LeaderEntry | null;
}

export function useProfile() {
  return useQuery({
    queryKey: ['tutor', 'profile'],
    queryFn: () => request<Profile>('/v1/tutor/profile'),
    // Level, streak and badges move with every answer, so never serve a stale copy.
    staleTime: 0,
  });
}

export function useLeaderboard() {
  return useQuery({
    queryKey: ['tutor', 'leaderboard'],
    queryFn: () => request<Leaderboard>('/v1/tutor/leaderboard?limit=8'),
    staleTime: 0,
  });
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
      // XP, level, streak, badges, unlocks and the leaderboard may all have moved.
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'progress'] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'profile'] });
      void queryClient.invalidateQueries({ queryKey: ['tutor', 'leaderboard'] });
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
