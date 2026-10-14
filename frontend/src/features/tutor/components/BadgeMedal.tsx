import { cx } from '@/shared/components/ui';
import type { BadgeInfo, Rarity } from '../api/sessionApi';
import { BADGE_ICONS, LockIcon } from './icons';

const SIZES = {
  sm: { box: 'size-[42px]', icon: 'size-[20px]' },
  md: { box: 'size-[62px]', icon: 'size-[30px]' },
  lg: { box: 'size-[112px]', icon: 'size-[54px]' },
} as const;

/** Colour by rarity. Epic gets gold in the mix, which is what makes it read as rarer. */
const TONES: Record<Rarity, string> = {
  common:
    'bg-gradient-to-br from-[oklch(0.94_0.03_265)] to-[oklch(0.8_0.08_265)] text-brand ' +
    'ring-2 ring-brand-soft',
  rare:
    'bg-gradient-to-br from-[oklch(0.78_0.12_245)] to-[oklch(0.48_0.17_265)] text-white ' +
    'ring-2 ring-brand shadow-[0_4px_16px_oklch(0.52_0.14_265/0.35)]',
  epic:
    'bg-gradient-to-br from-[oklch(0.6_0.21_295)] to-[oklch(0.8_0.15_85)] text-white ' +
    'ring-2 ring-gold shadow-[0_4px_20px_oklch(0.8_0.15_85/0.5)]',
};

interface BadgeMedalProps {
  badge: BadgeInfo;
  earned?: boolean;
  size?: keyof typeof SIZES;
  /** Run the shine sweep and a gentle bob, for the unlock moment. */
  celebrate?: boolean;
  className?: string;
}

/** A round medal. Locked ones are greyed out with a padlock, so there is something to chase. */
export function BadgeMedal({
  badge,
  earned = true,
  size = 'md',
  celebrate = false,
  className,
}: BadgeMedalProps) {
  const Icon = BADGE_ICONS[badge.id] ?? BADGE_ICONS.first_steps!;
  const dims = SIZES[size];

  return (
    <span
      role="img"
      aria-label={earned ? `${badge.name} badge` : `${badge.name} badge, locked`}
      className={cx(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        dims.box,
        earned
          ? TONES[badge.rarity]
          : 'border border-dashed border-line-strong bg-surface-muted text-ink-faint',
        celebrate && 'animate-bob',
        className,
      )}
    >
      {earned ? <Icon className={dims.icon} /> : <LockIcon className={cx(dims.icon, 'opacity-70')} />}
      {earned && celebrate && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1/3 animate-shine bg-gradient-to-r from-transparent via-white/70 to-transparent"
        />
      )}
    </span>
  );
}

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
};
