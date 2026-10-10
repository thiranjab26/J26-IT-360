import { useState, type ReactNode } from 'react';

import { Badge, Button, Card, cx } from '@/shared/components/ui';
import type {
  Session,
  SessionFeedback,
  SessionQuestion,
  SessionSummary,
  TextSource,
} from '../api/sessionApi';
import { Markdown } from './Markdown';

/* ------------------------------------------------------------------- shells */

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cx('px-[26px] py-[24px]', className)}>{children}</Card>;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[10.5px] tracking-wide text-ink-faint uppercase">{children}</p>
  );
}

/** Says who wrote a piece of tutor text. Generated text is not fact-checked yet (P3). */
function SourceBadge({ source }: { source: TextSource | null }) {
  if (source === 'generated') {
    return (
      <Badge tone="caution" className="shrink-0">
        AI explanation, fact-check gate not active yet
      </Badge>
    );
  }
  return (
    <Badge tone="verified" className="shrink-0">
      Course material
    </Badge>
  );
}

function OriginalPassage({ text }: { text: string }) {
  return (
    <details className="mt-[16px] rounded-[10px] border border-line-soft bg-surface-muted px-[14px] py-[10px]">
      <summary className="cursor-pointer text-[12.5px] font-medium text-ink-soft">
        Read the original course passage
      </summary>
      <Markdown className="mt-[10px]">{text}</Markdown>
    </details>
  );
}

/* ---------------------------------------------------------------- hook/teach */

export function HookCard({ session, onNext, busy }: StepProps) {
  return (
    <Panel>
      <Eyebrow>Before we start</Eyebrow>
      <h2 className="mt-[6px] text-[19px] font-semibold tracking-tight text-ink">
        {session.heading ?? session.concept_title}
      </h2>
      {session.text && <Markdown className="mt-[14px]">{session.text}</Markdown>}
      <div className="mt-[22px]">
        <Button onClick={onNext} busy={busy}>
          Start learning
        </Button>
      </div>
    </Panel>
  );
}

export function TeachCard({ session, onNext, busy }: StepProps) {
  return (
    <Panel>
      <div className="flex items-start justify-between gap-[12px]">
        <Eyebrow>
          Part {session.position.step_number} of {session.position.total_steps}
        </Eyebrow>
        <SourceBadge source={session.text_source} />
      </div>
      <h2 className="mt-[6px] text-[19px] font-semibold tracking-tight text-ink">
        {session.heading}
      </h2>
      {session.text && <Markdown className="mt-[14px]">{session.text}</Markdown>}
      {session.source_text && <OriginalPassage text={session.source_text} />}
      <div className="mt-[22px]">
        <Button onClick={onNext} busy={busy}>
          Continue
        </Button>
      </div>
    </Panel>
  );
}

export function ReteachCard({ session, onNext, busy }: StepProps) {
  return (
    <div className="flex flex-col gap-[14px]">
      {session.feedback && <FeedbackBanner feedback={session.feedback} />}
      <Panel>
        <div className="flex items-start justify-between gap-[12px]">
          <Eyebrow>Another look</Eyebrow>
          <SourceBadge source={session.text_source} />
        </div>
        <h2 className="mt-[6px] text-[19px] font-semibold tracking-tight text-ink">
          {session.heading}
        </h2>
        {session.text && <Markdown className="mt-[14px]">{session.text}</Markdown>}
        {session.source_text && <OriginalPassage text={session.source_text} />}
        <div className="mt-[22px]">
          <Button onClick={onNext} busy={busy}>
            Try the question again
          </Button>
        </div>
      </Panel>
    </div>
  );
}

interface StepProps {
  session: Session;
  onNext: () => void;
  busy: boolean;
}

/* ---------------------------------------------------------------- checkpoint */

export function QuestionCard({
  session,
  question,
  onAnswer,
  busy,
}: {
  session: Session;
  question: SessionQuestion;
  onAnswer: (answer: string) => void;
  busy: boolean;
}) {
  // Reset the input for every new question and every new try.
  return (
    <div className="flex flex-col gap-[14px]">
      {session.feedback && <FeedbackBanner feedback={session.feedback} />}
      <QuestionBody
        key={`${question.question_id}:${question.attempt}`}
        question={question}
        onAnswer={onAnswer}
        busy={busy}
      />
    </div>
  );
}

function QuestionBody({
  question,
  onAnswer,
  busy,
}: {
  question: SessionQuestion;
  onAnswer: (answer: string) => void;
  busy: boolean;
}) {
  const [choice, setChoice] = useState('');
  const [typed, setTyped] = useState('');
  const isChoice = question.kind === 'mcq';
  const answer = isChoice ? choice : typed;

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <Eyebrow>{question.gating ? 'Checkpoint' : 'Quick check'}</Eyebrow>
        <div className="flex items-center gap-[7px]">
          {question.gating ? (
            <>
              <Badge tone="brand">Must pass to finish</Badge>
              <Badge>
                try {question.attempt} of {question.max_attempts}
              </Badge>
            </>
          ) : (
            <Badge>never blocks you</Badge>
          )}
        </div>
      </div>

      {question.hint && (
        <div className="mt-[14px] rounded-[10px] border border-caution-line bg-caution-wash px-[14px] py-[10px]">
          <div className="flex items-center justify-between gap-[8px]">
            <p className="font-mono text-[10.5px] tracking-wide text-caution-ink uppercase">
              Hint
            </p>
            {question.hint_source === 'generated' && (
              <span className="font-mono text-[10px] text-ink-faint">AI-written</span>
            )}
          </div>
          <Markdown className="mt-[4px] text-caution-ink">{question.hint}</Markdown>
        </div>
      )}

      <Markdown className="mt-[16px]">{question.stem}</Markdown>

      {isChoice ? (
        <fieldset className="mt-[16px] flex flex-col gap-[8px]">
          <legend className="sr-only">Choose one answer</legend>
          {question.options.map((option) => (
            <label
              key={option.letter}
              className={cx(
                'flex cursor-pointer items-start gap-[12px] rounded-[10px] border px-[14px] py-[11px]',
                'transition-colors',
                choice === option.letter
                  ? 'border-brand bg-brand-wash'
                  : 'border-line bg-surface hover:border-line-strong',
              )}
            >
              <input
                type="radio"
                name={question.question_id}
                value={option.letter}
                checked={choice === option.letter}
                onChange={() => setChoice(option.letter)}
                className="sr-only"
              />
              <span
                className={cx(
                  'flex size-[24px] shrink-0 items-center justify-center rounded-full border',
                  'font-mono text-[11.5px] font-semibold',
                  choice === option.letter
                    ? 'border-brand bg-brand text-white'
                    : 'border-line-strong text-ink-muted',
                )}
              >
                {option.letter}
              </span>
              <span className="pt-[2px] text-[13.5px] text-ink">{option.text}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="mt-[16px]">
          <label htmlFor="typed-answer" className="text-[12px] font-medium text-ink-soft">
            What does it print? One line of your answer per line of output.
          </label>
          <textarea
            id="typed-answer"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            rows={4}
            spellCheck={false}
            className="mt-[6px] w-full rounded-[10px] border border-line bg-surface px-[14px] py-[10px] font-mono text-[13px] text-ink focus:outline-none"
          />
        </div>
      )}

      <div className="mt-[18px]">
        <Button onClick={() => onAnswer(answer)} busy={busy} disabled={!answer.trim()}>
          Check answer
        </Button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ feedback */

export function FeedbackBanner({ feedback }: { feedback: SessionFeedback }) {
  const correct = feedback.outcome === 'correct';
  const unreadable = feedback.outcome === 'unreadable';

  return (
    <div
      role="status"
      className={cx(
        'rounded-[14px] border px-[20px] py-[16px]',
        correct
          ? 'border-verified-line bg-verified-wash'
          : 'border-caution-line bg-caution-wash',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <p
          className={cx(
            'text-[14.5px] font-semibold',
            correct ? 'text-verified-ink' : 'text-caution-ink',
          )}
        >
          {feedback.message}
        </p>
        <div className="flex items-center gap-[7px]">
          {correct && feedback.xp_earned > 0 && (
            <span className="animate-pop rounded-full bg-verified px-[10px] py-[3px] font-mono text-[11.5px] font-semibold text-white">
              +{feedback.xp_earned} XP
            </span>
          )}
          {feedback.tries_left !== null && !correct && (
            <Badge tone="caution">
              {feedback.tries_left} {feedback.tries_left === 1 ? 'try' : 'tries'} left
            </Badge>
          )}
        </div>
      </div>

      {feedback.correct_option && (
        <p className="mt-[6px] text-[13px] text-ink-soft">
          The answer was <strong className="font-semibold text-ink">{feedback.correct_option}</strong>.
        </p>
      )}
      {feedback.explanation && !unreadable && (
        <Markdown className="mt-[8px]">{feedback.explanation}</Markdown>
      )}
    </div>
  );
}

export function FeedbackCard({ session, onNext, busy }: StepProps) {
  const feedback = session.feedback;
  const retry = feedback?.outcome === 'wrong' && (feedback.tries_left ?? 0) > 0;
  return (
    <div className="flex flex-col gap-[14px]">
      {feedback && <FeedbackBanner feedback={feedback} />}
      <div>
        <Button onClick={onNext} busy={busy}>
          {retry ? 'Try again' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- summary */

const EXIT_COPY: Record<string, { title: string; body: string }> = {
  completed: {
    title: 'Session complete',
    body: 'You worked through every part and passed the checkpoints.',
  },
  mastery_satisfied: {
    title: 'Mastery shown, finished early',
    body: 'You answered well enough that the rest of this session was not needed.',
  },
  struggling: {
    title: 'Time for a break',
    body: 'That checkpoint was tough. Re-read the explanation, then start the concept again; you will get fresh questions.',
  },
  student_ended: {
    title: 'Session paused',
    body: 'You can pick this up where you left off.',
  },
  load_exit: {
    title: 'Session paused',
    body: 'The tutor stopped early so you can rest. You can pick this up later.',
  },
  timeout: {
    title: 'Session timed out',
    body: 'It was quiet for a while, so the session stopped. You can pick it up again.',
  },
};

export function SummaryCard({
  session,
  summary,
  onResume,
  onRestart,
  onBack,
  busy,
}: {
  session: Session;
  summary: SessionSummary;
  onResume: () => void;
  onRestart: () => void;
  onBack: () => void;
  busy: boolean;
}) {
  const copy = EXIT_COPY[summary.exit_reason] ?? EXIT_COPY.completed!;
  const good = summary.exit_reason === 'completed' || summary.exit_reason === 'mastery_satisfied';

  return (
    <div className="flex flex-col gap-[14px]">
      {session.feedback && <FeedbackBanner feedback={session.feedback} />}
      <Panel>
        <Eyebrow>{session.concept_title}</Eyebrow>
        <h2
          className={cx(
            'mt-[6px] text-[21px] font-semibold tracking-tight',
            good ? 'text-verified-ink' : 'text-ink',
          )}
        >
          {copy.title}
        </h2>
        <p className="mt-[6px] max-w-[560px] text-[13.5px] text-ink-muted">{copy.body}</p>

        <dl className="mt-[20px] grid gap-[12px] sm:grid-cols-3">
          <Stat label="XP earned" value={String(summary.xp_earned)} />
          <Stat
            label="Checkpoints passed"
            value={`${summary.gating_done} of ${summary.gating_total}`}
          />
          <Stat
            label="Mastery"
            value={summary.mastery === null ? 'not enough yet' : `${Math.round(summary.mastery * 100)}%`}
          />
        </dl>

        <div className="mt-[24px] flex flex-wrap gap-[10px]">
          {summary.can_resume && (
            <Button onClick={onResume} busy={busy}>
              Resume session
            </Button>
          )}
          <Button
            variant={summary.can_resume ? 'secondary' : 'primary'}
            onClick={onRestart}
            busy={busy}
          >
            {summary.can_resume ? 'Start over' : 'Try this concept again'}
          </Button>
          <Button variant="ghost" onClick={onBack}>
            Back to quest map
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-line-soft bg-surface-muted px-[14px] py-[12px]">
      <dt className="text-[11.5px] text-ink-muted">{label}</dt>
      <dd className="mt-[2px] font-mono text-[17px] font-semibold text-ink">{value}</dd>
    </div>
  );
}
