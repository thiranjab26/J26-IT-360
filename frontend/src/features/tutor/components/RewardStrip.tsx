import { cx } from '@/shared/components/ui';
import type { Bonus } from '../api/sessionApi';
import { BoltIcon, SparkleIcon } from './icons';

/**
 * The XP an action paid, as chips that pop in one after another: the checkpoint points
 * first, then each bonus. Bonuses are gold, so they read as something extra.
 */
export function RewardStrip({
  points,
  bonuses,
  className,
}: {
  points: number;
  bonuses: Bonus[];
  className?: string;
}) {
  if (points <= 0 && bonuses.length === 0) return null;

  return (
    <ul aria-label="XP earned" className={cx('flex flex-wrap gap-[8px]', className)}>
      {points > 0 && (
        <Chip delay={0} label="Points" amount={points} tone="brand" />
      )}
      {bonuses.map((bonus, i) => (
        <Chip
          key={bonus.kind}
          delay={(i + (points > 0 ? 1 : 0)) * 160}
          label={bonus.label}
          amount={bonus.amount}
          tone="gold"
        />
      ))}
    </ul>
  );
}

function Chip({
  label,
  amount,
  delay,
  tone,
}: {
  label: string;
  amount: number;
  delay: number;
  tone: 'brand' | 'gold';
}) {
  return (
    <li
      style={{ animationDelay: `${delay}ms` }}
      className={cx(
        'inline-flex animate-pop-in items-center gap-[6px] rounded-full border py-[4px] pr-[11px] pl-[8px]',
        'text-[12px] font-medium',
        tone === 'gold'
          ? 'border-gold bg-gold-wash text-gold-ink shadow-[0_2px_10px_oklch(0.8_0.15_85/0.3)]'
          : 'border-brand-soft bg-brand-wash text-brand',
      )}
    >
      {tone === 'gold' ? (
        <SparkleIcon className="size-[13px] text-gold-deep" />
      ) : (
        <BoltIcon className="size-[13px]" />
      )}
      <span>{label}</span>
      <span className="font-mono font-semibold">+{amount} XP</span>
    </li>
  );
}
