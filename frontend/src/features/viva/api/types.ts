export type Role = "participant" | "admin" | "evaluator";
export type Auth = {
  token: string;
  user: { id: string; participant_code: string; role: Role };
};
export type Topic = {
  id: string;
  name: string;
  course_id: string;
  description: string;
  question_count: number;
};
export type Context = {
  c01: {
    topic: string;
    mastery: number;
    confidence: number;
    starting_difficulty: string;
    source: string;
  };
  c02: {
    cognitive_load: string | number;
    frustration: string | number;
    engagement: string | number;
    source: string;
  };
  c03: {
    course_id: string;
    topic: string;
    chunks: { text: string; source: string; page?: number }[];
    review_resources: { title: string; resource_id: string; url?: string }[];
    source: string;
  };
};
export type Turn = {
  id: string;
  question_id: string;
  question: string;
  transcript: string;
  state: string;
  coverage?: number;
  depth: number;
  action: string;
  input_mode: string;
  hesitation?: Record<string, unknown>;
  created_at: string;
};
export type Session = {
  id: string;
  topic_id: string;
  topic: string;
  status: "active" | "completed";
  input_mode: "text" | "speech";
  max_depth: number;
  created_at: string;
  completed_at?: string;
  current_question: {
    id: string;
    concept: string;
    question: string;
    depth: number;
    ordinal: number;
    total_concepts: number;
  } | null;
  turns: Turn[];
  integration_context: Context;
  progress: { completed_concepts: number; total_concepts: number };
  report?: Report;
};
export type Summary = {
  id: string;
  topic_id: string;
  topic: string;
  status: string;
  created_at: string;
  completed_at?: string;
  turn_count: number;
  questions_asked?: number;
  answered_count?: number;
  outcome?: string;
};
export type Report = {
  session_id: string;
  topic: string;
  created_at: string;
  outcome: string;
  explanation: string;
  rubric_coverage: number;
  strengths: string[];
  missing_concepts: string[];
  concepts: {
    concept: string;
    outcome: string;
    explanation: string;
    initial_state: string;
    final_state: string;
    rubric_coverage: number;
    turn_count: number;
    no_weakness?: boolean;
    signal_details?: { signal: string; value: string; threshold: string; counted: boolean }[];
  }[];
  strong_answers?: boolean;
  hesitation: {
    available: boolean;
    response_latency_ms?: number;
    pause_count?: number;
    total_pause_ms?: number;
    filler_count?: number;
    fillers_per_100_words?: number;
    hedge_count?: number;
    restart_count?: number;
    notes: string[];
  };
  improvement_plan: string[];
  plan_summary?: string;
  plan_provider?: string;
  review_resources: { title: string; resource_id: string; url?: string }[];
  mastery_mismatch: boolean;
  integration_events: {
    component: string;
    event: string;
    status: string;
    detail: string;
  }[];
  evidence_conditions: {
    condition: string;
    outcome: string;
    explanation: string;
  }[];
  limitations: string[];
  transcript?: { concept: string; question: string; answer: string; skipped: boolean; follow_up: boolean }[];
};
export type BankQuestion = {
  id: string;
  topic_id: string;
  concept: string;
  question: string;
  reference_answer: string;
  rubric_points: { id: string; point: string; keywords: string[]; probe?: string; evidence_quote?: string; source_indices?: number[] }[];
  misconceptions: { id: string; description: string; keywords: string[] }[];
  follow_ups: Record<string, string>;
  sources: { source: string; page?: number; text?: string }[];
  status: "draft" | "approved" | "rejected";
  origin: string;
  review_notes?: string;
  version: number;
};
export type Case = {
  case_id: string;
  session_id: string;
  topic: string;
  concept: string;
  condition: string;
  c01_mastery?: { mastery: number; confidence: number; source: string };
  turns: {
    id: string;
    question: string;
    transcript: string;
    depth: number;
    input_mode: string;
    hesitation?: Record<string, unknown>;
  }[];
  my_rating?: Rating;
};
export type Rating = {
  answer_state: string;
  gap_outcome: string;
  follow_up_appropriateness?: number;
  feedback_usefulness?: number;
  notes?: string;
};
export type Metrics = {
  conditions: {
    condition: string;
    n: number;
    answer_accuracy: number | null;
    answer_macro_f1: number | null;
    answer_kappa: number | null;
    gap_accuracy: number | null;
    gap_macro_f1: number | null;
    gap_kappa: number | null;
  }[];
  inter_rater?: { n: number; kappa: number | null };
  follow_up_appropriateness?: number | null;
  feedback_usefulness?: number | null;
  notes: string[];
};
export type Health = {
  status: string;
  database: string;
  assessment_provider: string;
  speech_provider: string;
  live_speech_provider?: string | null;
  voice_provider?: string;
  integration_mode: string;
  demo_mode: boolean;
};
export type AudioMetrics = {
  pause_count: number;
  total_pause_ms: number;
  average_pause_ms: number;
  audio_duration_ms: number;
  long_pause_count?: number;
};
