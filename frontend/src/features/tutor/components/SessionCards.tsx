import { useEffect, useState, type ReactNode } from 'react';

import { Badge, Card, cx } from '@/shared/components/ui';
import type {
  Rewards,
  Session,
  SessionFeedback,
  Source,
  SessionQuestion,
  SessionSummary,
  TextCheck,
  TextSource,
} from '../api/sessionApi';
import { BadgeMedal } from './BadgeMedal';
import { useCountUp } from './fx';
import { GameButton, Hearts } from './GameButton';
import { CheckIcon, SparkleIcon } from './icons';
import { Markdown } from './Markdown';
import { RewardStrip } from './RewardStrip';
import { WrongAnswer } from './WrongAnswer';
import { playCue } from './sound';

/* ------------------------------------------------------------------- shells */

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cx('animate-slide-up px-[26px] py-[24px]', className)}>{children}</Card>;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[10.5px] tracking-wide text-ink-faint uppercase">{children}</p>
  );
}

/**
 * Says who wrote a piece of tutor text and whether it was fact-checked. Generated text
 * reaches a student only after the faithfulness gate has checked it against the course
 * passage; the other labels cover the cases where it did not.
 */
function SourceBadge({ source, check }: { source: TextSource | null; check: TextCheck | null }) {
  if (source === 'generated' && check === 'verified') {
    return (
      <Badge tone="verified" className="shrink-0">
        AI explanation, checked against the course
      </Badge>
    );
  }
  if (source === 'generated') {
    return (
      <Badge tone="caution" className="shrink-0">
        AI explanation, not fact-checked
      </Badge>
    );
  }
  if (check === 'blocked') {
    return (
      <Badge tone="neutral" className="shrink-0">
        Course material (the AI wording failed the check)
      </Badge>
    );
  }
  return (
    <Badge tone="verified" className="shrink-0">
      Course material
    </Badge>
  );
}

/**
 * What the explanation was built from, so the retrieval is visible: the main passage and
 * the passages the retriever pulled from the course index to go with it.
 */
export function Sources({ sources }: { sources: Source[] }) {
  return (
    <div className="mt-[16px] rounded-[10px] border border-line-soft bg-surface-muted px-[14px] py-[10px]">
      <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
        Built from the course index
      </p>
      <ul className="mt-[7px] flex flex-wrap gap-[6px]">
        {sources.map((source) => (
          <li
            key={source.chunk_id}
            title={source.chunk_id}
            className={cx(
              'inline-flex items-center gap-[5px] rounded-full border px-[9px] py-[3px] text-[11.5px]',
              source.kind === 'main'
                ? 'border-brand-soft bg-brand-wash text-brand'
                : 'border-line bg-surface text-ink-soft',
            )}
          >
            <span className="font-mono text-[9.5px] tracking-wide uppercase opacity-70">
              {source.kind === 'main' ? 'main' : 'retrieved'}
            </span>
            {source.label}
          </li>
        ))}
      </ul>
    </div>
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
        <GameButton onClick={onNext} busy={busy}>
          Start learning
        </GameButton>
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
        <SourceBadge source={session.text_source} check={session.text_check} />
      </div>
      <h2 className="mt-[6px] text-[19px] font-semibold tracking-tight text-ink">
        {session.heading}
      </h2>
      {session.text && <Markdown className="mt-[14px]">{session.text}</Markdown>}
      {session.sources && <Sources sources={session.sources} />}
      {session.source_text && <OriginalPassage text={session.source_text} />}
      <div className="mt-[22px]">
        <GameButton onClick={onNext} busy={busy}>
          Continue
        </GameButton>
      </div>
    </Panel>
  );
}

export function ReteachCard({ session, onNext, busy }: StepProps) {
  return (
    <div className="flex flex-col gap-[14px]">
      {session.feedback && (
        <FeedbackBanner
          feedback={session.feedback}
          rewards={session.rewards}
          sessionId={session.session_id}
        />
      )}
      <Panel>
        <div className="flex items-start justify-between gap-[12px]">
          <Eyebrow>Another look</Eyebrow>
          <SourceBadge source={session.text_source} check={session.text_check} />
        </div>
        <h2 className="mt-[6px] text-[19px] font-semibold tracking-tight text-ink">
          {session.heading}
        </h2>
        {session.text && <Markdown className="mt-[14px]">{session.text}</Markdown>}
        {session.sources && <Sources sources={session.sources} />}
        {session.source_text && <OriginalPassage text={session.source_text} />}
        <div className="mt-[22px]">
          <GameButton onClick={onNext} busy={busy}>
            Try the question again
          </GameButton>
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
      {session.feedback && (
        <FeedbackBanner
          feedback={session.feedback}
          rewards={session.rewards}
          sessionId={session.session_id}
        />
      )}
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
    <Panel className={cx(question.gating && 'neon-edge')}>
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <Eyebrow>{question.gating ? 'Boss checkpoint' : 'Quick check'}</Eyebrow>
        <div className="flex items-center gap-[7px]">
          {question.gating ? (
            <>
              <Badge tone="brand">Must pass to finish</Badge>
              <Hearts
                total={question.max_attempts}
                left={Math.max(0, question.max_attempts - question.attempt + 1)}
              />
            </>
          ) : (
            <Badge>never blocks you</Badge>
          )}
        </div>
      </div>

      {question.hint && (
        <div className="mt-[14px] rounded-[10px] border border-caution-line bg-caution-wash px-[14px] py-[10px]">
          <div className="flex items-center justify-between gap-[8px]">
            <p className="font-mono text-[10.5px] tracking-wide text-caution-ink uppercase">Hint</p>
            {question.hint_source === 'generated' && (
              <span className="font-mono text-[10px] text-ink-faint">
                {question.hint_check === 'verified' ? 'AI-written, checked' : 'AI-written'}
              </span>
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
                'flex cursor-pointer items-start gap-[12px] rounded-[14px] border-2 px-[14px] py-[12px]',
                'transition-all duration-100 active:translate-y-[3px]',
                choice === option.letter
                  ? 'translate-y-[1px] border-brand bg-brand-wash shadow-[0_3px_0_0_var(--color-brand),0_0_22px_oklch(0.68_0.19_275/0.35)]'
                  : 'border-line bg-surface shadow-[0_4px_0_0_var(--color-line)] hover:-translate-y-[1px] hover:border-brand-soft hover:shadow-[0_5px_0_0_var(--color-brand-soft)]',
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
                  'flex size-[28px] shrink-0 items-center justify-center rounded-[8px] border-2',
                  'font-mono text-[12px] font-bold transition-colors',
                  choice === option.letter
                    ? 'border-brand bg-brand text-white'
                    : 'border-line-strong text-ink-muted',
                )}
              >
                {choice === option.letter ? (
                  <CheckIcon className="size-[13px] animate-pop" />
                ) : (
                  option.letter
                )}
              </span>
              <span className="pt-[3px] text-[14px] text-ink">{option.text}</span>
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
        <GameButton
          variant="go"
          onClick={() => onAnswer(answer)}
          busy={busy}
          disabled={!answer.trim()}
        >
          Check answer
        </GameButton>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ feedback */

export function FeedbackBanner({
  feedback,
  rewards,
  sessionId,
}: {
  feedback: SessionFeedback;
  rewards?: Rewards | null;
  sessionId?: string;
}) {
  const correct = feedback.outcome === 'correct';
  const unreadable = feedback.outcome === 'unreadable';
  const xp = useCountUp(feedback.xp_earned, 600);

  // One sound per answer shown: this banner is mounted fresh for each new result.
  useEffect(() => {
    playCue(correct ? 'correct' : unreadable ? 'tap' : 'wrong');
    if (!correct || feedback.xp_earned <= 0) return;
    const later = window.setTimeout(() => playCue('xp'), 380);
    return () => window.clearTimeout(later);
  }, [correct, unreadable, feedback.xp_earned]);

  return (
    <div
      role="status"
      className={cx(
        'relative rounded-[14px] border px-[20px] py-[16px]',
        correct
          ? 'animate-pop-in border-verified-line bg-verified-wash'
          : 'animate-shake border-caution-line bg-caution-wash',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <p
          className={cx(
            'flex items-center gap-[8px] text-[14.5px] font-semibold',
            correct ? 'text-verified-ink' : 'text-caution-ink',
          )}
        >
          {correct && (
            <span className="flex size-[22px] items-center justify-center rounded-full bg-verified text-white">
              <CheckIcon className="size-[13px]" />
            </span>
          )}
          {feedback.message}
        </p>
        <div className="flex items-center gap-[7px]">
          {correct && feedback.xp_earned > 0 && (
            <span className="relative">
              <span className="inline-flex animate-pop items-center gap-[4px] rounded-full bg-verified px-[11px] py-[3px] font-mono text-[12px] font-semibold text-white">
                <SparkleIcon className="size-[12px]" />+{xp} XP
              </span>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-[6px] -top-[6px] animate-float-up font-mono text-[13px] font-bold text-verified-ink"
              >
                +{feedback.xp_earned}
              </span>
            </span>
          )}
          {feedback.tries_left !== null && !correct && (
            <Badge tone="caution">
              {feedback.tries_left} {feedback.tries_left === 1 ? 'try' : 'tries'} left
            </Badge>
          )}
        </div>
      </div>

      {feedback.correct_text && sessionId ? (
        <WrongAnswer feedback={feedback} sessionId={sessionId} />
      ) : (
        feedback.correct_option && (
          <p className="mt-[6px] text-[13px] text-ink-soft">
            The answer was{' '}
            <strong className="font-semibold text-ink">{feedback.correct_option}</strong>.
          </p>
        )
      )}
      {feedback.explanation && !unreadable && (
        <Markdown className="mt-[8px]">{feedback.explanation}</Markdown>
      )}

      {rewards && rewards.bonuses.length > 0 && (
        <RewardStrip points={0} bonuses={rewards.bonuses} className="mt-[12px]" />
      )}
    </div>
  );
}

export function FeedbackCard({ session, onNext, busy }: StepProps) {
  const feedback = session.feedback;
  const retry = feedback?.outcome === 'wrong' && (feedback.tries_left ?? 0) > 0;
  return (
    <div className="flex flex-col gap-[14px]">
      {feedback && (
        <FeedbackBanner
          feedback={feedback}
          rewards={session.rewards}
          sessionId={session.session_id}
        />
      )}
      <div>
        <GameButton variant={retry ? 'go' : 'primary'} onClick={onNext} busy={busy}>
          {retry ? 'Try again' : 'Continue'}
        </GameButton>
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
  const xp = useCountUp(summary.xp_earned, 1100);

  return (
    <div className="flex flex-col gap-[14px]">
      {session.feedback && (
        <FeedbackBanner
          feedback={session.feedback}
          rewards={session.rewards}
          sessionId={session.session_id}
        />
      )}
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
          <Stat label="XP earned" value={`+${xp}`} highlight />
          <Stat
            label="Checkpoints passed"
            value={`${summary.gating_done} of ${summary.gating_total}`}
          />
          <Stat
            label="Mastery"
            value={
              summary.mastery === null ? 'not enough yet' : `${Math.round(summary.mastery * 100)}%`
            }
          />
        </dl>

        {(summary.bonuses.length > 0 || summary.badges.length > 0) && (
          <div className="mt-[20px] rounded-[12px] border border-gold bg-gold-wash px-[16px] py-[14px]">
            <p className="font-mono text-[10.5px] tracking-wide text-gold-ink uppercase">
              Session rewards
            </p>
            {summary.bonuses.length > 0 && (
              <RewardStrip points={0} bonuses={summary.bonuses} className="mt-[10px]" />
            )}
            {summary.badges.length > 0 && (
              <ul className="mt-[12px] flex flex-wrap gap-[14px]">
                {summary.badges.map((badge, i) => (
                  <li
                    key={badge.id}
                    style={{ animationDelay: `${300 + i * 150}ms` }}
                    className="flex animate-pop-in items-center gap-[9px]"
                  >
                    <BadgeMedal badge={badge} size="sm" />
                    <span className="text-[12.5px] font-medium text-ink">{badge.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-[24px] flex flex-wrap gap-[10px]">
          {summary.can_resume && (
            <GameButton onClick={onResume} busy={busy}>
              Resume session
            </GameButton>
          )}
          <GameButton
            variant={summary.can_resume ? 'secondary' : 'go'}
            onClick={onRestart}
            busy={busy}
          >
            {summary.can_resume ? 'Start over' : 'Play again'}
          </GameButton>
          <GameButton variant="ghost" onClick={onBack}>
            Back to quest map
          </GameButton>
        </div>
      </Panel>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cx(
        'rounded-[10px] border px-[14px] py-[12px]',
        highlight ? 'border-gold bg-gold-wash' : 'border-line-soft bg-surface-muted',
      )}
    >
      <dt className="text-[11.5px] text-ink-muted">{label}</dt>
      <dd
        className={cx(
          'mt-[2px] font-mono text-[17px] font-semibold',
          highlight ? 'text-gold-ink' : 'text-ink',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
