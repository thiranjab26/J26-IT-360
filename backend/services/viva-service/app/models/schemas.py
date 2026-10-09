from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

State = Literal[
    "complete", "partial", "superficial", "incorrect", "misconception_bearing", "non_answer"
]
Gap = Literal[
    "LIKELY_KNOWLEDGE_GAP", "LIKELY_COMMUNICATION_DIFFICULTY", "MIXED_INSUFFICIENT_EVIDENCE"
]
Condition = Literal["A", "B", "C"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ParticipantIn(StrictModel):
    participant_code: str = Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    consent: Literal[True]


class StaffIn(StrictModel):
    access_key: str = Field(min_length=1, max_length=256)
    role: Literal["admin", "evaluator"]


class SessionIn(StrictModel):
    topic_id: str = Field(max_length=64)
    input_mode: Literal["text", "speech"] = "text"
    max_depth: int = Field(default=2, ge=0, le=3)


class FluencyMetrics(StrictModel):
    """Literature-profile measures of one spoken answer (app/domain/fluency.answer_profile)."""

    speaking_time_s: float | None = Field(default=None, ge=0, le=900)
    speech_rate_syll_s: float | None = Field(default=None, ge=0, le=30)
    articulation_rate_syll_s: float | None = Field(default=None, ge=0, le=30)
    mean_length_of_run_syll: float | None = Field(default=None, ge=0, le=10000)
    mean_silent_pause_ms: float | None = Field(default=None, ge=0, le=900000)
    silent_pauses: int | None = Field(default=None, ge=0, le=10000)
    syllables: int | None = Field(default=None, ge=0, le=100000)


class AudioMetrics(StrictModel):
    pause_count: int | None = Field(default=None, ge=0, le=10000)
    total_pause_ms: float | None = Field(default=None, ge=0, le=900000)
    average_pause_ms: float | None = Field(default=None, ge=0, le=900000)
    long_pause_count: int | None = Field(default=None, ge=0, le=10000)
    audio_duration_ms: float | None = Field(default=None, ge=0, le=900000)
    fluency: FluencyMetrics | None = None

    @model_validator(mode="after")
    def consistency(self):
        if (
            self.total_pause_ms is not None
            and self.audio_duration_ms is not None
            and self.total_pause_ms > self.audio_duration_ms
        ):
            raise ValueError("Total pause time cannot exceed audio duration.")
        return self


class AnswerIn(StrictModel):
    question_id: str = Field(min_length=1, max_length=128)
    transcript: str = Field(max_length=12000)
    input_mode: Literal["text", "speech"]
    response_latency_ms: float | None = Field(default=None, ge=0, le=900000)
    audio_metrics: AudioMetrics | None = None
    request_id: str = Field(min_length=1, max_length=128)
    skip: bool = False


class SpeakIn(StrictModel):
    text: str = Field(min_length=1, max_length=600)


class RubricPoint(StrictModel):
    id: str = Field(min_length=1, max_length=64)
    point: str = Field(min_length=1, max_length=1000)
    keywords: list[str] = Field(min_length=1, max_length=30)
    probe: str | None = Field(default=None, min_length=5, max_length=1000)
    source_indices: list[int] = Field(default_factory=list, max_length=12)
    evidence_quote: str | None = Field(default=None, max_length=1600)


class Misconception(StrictModel):
    id: str = Field(min_length=1, max_length=64)
    description: str = Field(min_length=1, max_length=1000)
    keywords: list[str] = Field(min_length=1, max_length=30)


class FollowUps(StrictModel):
    partial: str = Field(min_length=5, max_length=1500)
    superficial: str = Field(min_length=5, max_length=1500)
    incorrect: str = Field(min_length=5, max_length=1500)
    misconception_bearing: str = Field(min_length=5, max_length=1500)
    non_answer: str = Field(min_length=5, max_length=1500)


class Source(StrictModel):
    source: str = Field(min_length=1, max_length=300)
    page: int | None = Field(default=None, ge=1)
    text: str | None = Field(default=None, max_length=6000)
    chunk_id: str | None = Field(default=None, max_length=100)


class CourseIn(StrictModel):
    name: str = Field(min_length=2, max_length=150)
    description: str = Field(default="", max_length=2000)


class MaterialTextIn(StrictModel):
    name: str = Field(default="Course notes.txt", min_length=1, max_length=200)
    text: str = Field(min_length=40, max_length=200000)


class QuestionContent(StrictModel):
    topic_id: str = Field(min_length=1, max_length=64)
    concept: str = Field(min_length=1, max_length=150)
    question: str = Field(min_length=5, max_length=2000)
    reference_answer: str = Field(min_length=5, max_length=6000)
    rubric_points: list[RubricPoint] = Field(min_length=1, max_length=12)
    misconceptions: list[Misconception] = Field(default_factory=list, max_length=12)
    follow_ups: FollowUps
    sources: list[Source] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def unique_points(self):
        ids = [p.id for p in self.rubric_points]
        if len(ids) != len(set(ids)):
            raise ValueError("Rubric point IDs must be unique.")
        return self


class BankQuestion(QuestionContent):
    id: str
    status: Literal["draft", "approved", "rejected"]
    origin: str
    review_notes: str | None = None
    version: int = Field(ge=1)


class ReviewIn(StrictModel):
    status: Literal["draft", "approved", "rejected"]
    review_notes: str | None = Field(default=None, max_length=4000)


class GenerateIn(StrictModel):
    topic_id: str
    count: int = Field(default=2, ge=1, le=5)


class Hit(StrictModel):
    id: str
    point: str
    covered: bool  # full credit only
    # AI marking since 9 Oct 2026: "partial" is the right idea in everyday words, or part of
    # the point, and counts half. Demo and older results have no level.
    level: Literal["full", "partial", "none"] | None = None


class Assessment(StrictModel):
    state: State
    coverage: float = Field(ge=0, le=100)
    rubric_hits: list[Hit]
    missing_points: list[str]
    misconceptions: list[str]
    reason: str = Field(max_length=4000)
    provider: str


class RatingIn(StrictModel):
    case_id: str
    condition: Condition
    answer_state: State
    gap_outcome: Gap
    follow_up_appropriateness: int | None = Field(default=None, ge=1, le=5)
    feedback_usefulness: int | None = Field(default=None, ge=1, le=5)
    notes: str | None = Field(default=None, max_length=4000)
