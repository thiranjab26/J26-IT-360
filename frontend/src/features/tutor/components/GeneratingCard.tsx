import { Card, cx } from '@/shared/components/ui';
import { CheckIcon, SparkleIcon } from './icons';
import { Mascot } from './Mascot';

const STAGES = [
  { from: 0, label: 'Finding the most relevant passages in the course index' },
  { from: 5, label: 'Writing your explanation from them' },
  { from: 11, label: 'Checking every statement against the course material' },
] as const;

/**
 * Shown while the next part is being prepared. Nothing from the part is shown until it has
 * passed the check, so this is what the student sees instead: where the work has got to and
 * how long it has taken, rather than a frozen page.
 */
export function GeneratingCard({ elapsed }: { elapsed: number }) {
  const current = STAGES.reduce((index, stage, i) => (elapsed >= stage.from ? i : index), 0);
  const slow = elapsed >= 35;

  return (
    <div role="status" aria-live="polite">
    <Card className="animate-fade-in px-[26px] py-[24px]">
      <div className="flex items-center justify-between gap-[12px]">
        <div className="flex items-center gap-[10px]">
          <Mascot mood="think" size={44} />
          <p className="font-mono text-[10.5px] tracking-wide text-ink-faint uppercase">
            Loading your next level
          </p>
        </div>
        <span className="font-mono text-[11px] text-ink-muted">{elapsed}s</span>
      </div>
      <div className="mt-[12px] h-[8px] overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand to-violet shadow-[0_0_10px_oklch(0.68_0.19_275/0.7)] transition-[width] duration-1000"
          style={{ width: `${Math.min(94, 8 + (current + 1) * 24 + Math.min(elapsed, 30) * 0.4)}%` }}
        />
      </div>

      <ol className="mt-[16px] flex flex-col gap-[11px]">
        {STAGES.map((stage, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li key={stage.label} className="flex items-center gap-[11px]">
              <span
                className={cx(
                  'flex size-[22px] shrink-0 items-center justify-center rounded-full border',
                  done && 'border-verified bg-verified text-white',
                  active && 'border-brand bg-brand-wash text-brand',
                  !done && !active && 'border-line bg-surface-muted text-ink-faint',
                )}
              >
                {done ? (
                  <CheckIcon className="size-[12px]" />
                ) : active ? (
                  <SparkleIcon className="size-[12px] animate-flicker" />
                ) : (
                  <span className="size-[5px] rounded-full bg-line-strong" />
                )}
              </span>
              <span
                className={cx(
                  'text-[13.5px]',
                  active ? 'font-medium text-ink' : done ? 'text-ink-muted' : 'text-ink-faint',
                )}
              >
                {stage.label}
                {active && <span className="animate-pulse">...</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-[20px] flex animate-pulse flex-col gap-[9px]" aria-hidden="true">
        <div className="h-[10px] w-full rounded-full bg-surface-sunken" />
        <div className="h-[10px] w-[92%] rounded-full bg-surface-sunken" />
        <div className="h-[10px] w-[78%] rounded-full bg-surface-sunken" />
      </div>

      <p className="mt-[16px] text-[12px] text-ink-muted">
        {slow
          ? 'Still checking. The first attempt did not pass, so the tutor is writing it again.'
          : 'Nothing is shown until it has passed the check against the course.'}
      </p>
    </Card>
    </div>
  );
}
