import { Badge, cx } from '@/shared/components/ui';
import { useMiss, type SessionFeedback } from '../api/sessionApi';
import { Markdown } from './Markdown';

/**
 * After a wrong multiple-choice quick check: what the student chose and what the right option
 * says, side by side, then a short note on why their choice was wrong. The note is written for
 * them as they answer, so it may take a moment: a placeholder shows while it is written, and it
 * only ever adds to what is already on screen. If it cannot be written (the model could not be
 * reached, or the checker would not pass it) nothing is shown in its place.
 */
export function WrongAnswer({
  feedback,
  sessionId,
}: {
  feedback: SessionFeedback;
  sessionId: string;
}) {
  const note = useMiss(sessionId, Boolean(feedback.correct_text));
  const status = note.data?.status ?? 'pending';

  return (
    <div className="mt-[12px] flex flex-col gap-[8px]">
      {feedback.chosen_text && (
        <Choice
          tone="wrong"
          label="Your answer"
          letter={feedback.chosen_option}
          text={feedback.chosen_text}
        />
      )}
      <Choice
        tone="right"
        label="Correct answer"
        letter={feedback.correct_option}
        text={feedback.correct_text ?? ''}
      />

      {status === 'pending' && !note.isError && (
        <div
          role="status"
          aria-label="Working out why your answer was wrong"
          className="rounded-[10px] border border-line-soft bg-surface px-[12px] py-[10px]"
        >
          <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
            Why your answer was wrong
          </p>
          <div className="mt-[8px] flex animate-pulse flex-col gap-[7px]" aria-hidden="true">
            <div className="h-[9px] w-full rounded-full bg-surface-sunken" />
            <div className="h-[9px] w-[70%] rounded-full bg-surface-sunken" />
          </div>
        </div>
      )}

      {status === 'ready' && note.data?.text && (
        <div className="animate-fade-in rounded-[10px] border border-line-soft bg-surface px-[12px] py-[10px]">
          <div className="flex items-center justify-between gap-[8px]">
            <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">
              Why your answer was wrong
            </p>
            <Badge tone="verified">checked against the course</Badge>
          </div>
          <Markdown className="mt-[6px]">{note.data.text}</Markdown>
        </div>
      )}
    </div>
  );
}

function Choice({
  tone,
  label,
  letter,
  text,
}: {
  tone: 'wrong' | 'right';
  label: string;
  letter: string | null | undefined;
  text: string;
}) {
  return (
    <div
      className={cx(
        'flex items-start gap-[10px] rounded-[10px] border px-[12px] py-[9px]',
        tone === 'wrong'
          ? 'border-caution-line bg-caution-wash'
          : 'border-verified-line bg-verified-wash',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'flex size-[24px] shrink-0 items-center justify-center rounded-[7px] font-mono text-[12px] font-bold text-white',
          tone === 'wrong' ? 'bg-caution' : 'bg-verified',
        )}
      >
        {letter ?? (tone === 'wrong' ? '×' : '✓')}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cx(
            'font-mono text-[10px] tracking-wide uppercase',
            tone === 'wrong' ? 'text-caution-ink' : 'text-verified-ink',
          )}
        >
          {label}
        </p>
        <Markdown className="mt-[2px] text-ink">{text}</Markdown>
      </div>
    </div>
  );
}
