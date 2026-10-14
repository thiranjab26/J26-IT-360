import { useEffect, useMemo, useState } from 'react';

import { Button, cx } from '@/shared/components/ui';
import type { BadgeInfo, LevelUp, Rewards } from '../api/sessionApi';
import { BadgeMedal, RARITY_LABEL } from './BadgeMedal';
import { fireConfetti } from './fx';
import { BoltIcon } from './icons';
import { LevelRing } from './LevelRing';

type Step = { kind: 'level'; up: LevelUp; xp: number } | { kind: 'badge'; badge: BadgeInfo };

/**
 * The full-screen moments: levelling up, then each badge unlocked, one at a time. Plain XP
 * and bonuses are shown inline by RewardStrip; only the rare things earn a pause.
 *
 * Mount it with a `key` per response so a new set of rewards starts from the first step.
 */
export function RewardCelebration({
  rewards,
  onDone,
}: {
  rewards: Rewards;
  onDone: () => void;
}) {
  const steps = useMemo<Step[]>(() => {
    const list: Step[] = [];
    if (rewards.level_up) list.push({ kind: 'level', up: rewards.level_up, xp: rewards.level.total_xp });
    for (const badge of rewards.badges) list.push({ kind: 'badge', badge });
    return list;
  }, [rewards]);

  const [index, setIndex] = useState(0);
  const step = steps[index];

  useEffect(() => {
    if (step) fireConfetti('big', { x: 0.5, y: 0.4 });
  }, [step]);

  useEffect(() => {
    if (steps.length === 0) onDone();
  }, [steps.length, onDone]);

  if (!step) return null;

  const last = index === steps.length - 1;
  const next = () => (last ? onDone() : setIndex((i) => i + 1));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={step.kind === 'level' ? 'Level up' : 'Badge unlocked'}
      className="fixed inset-0 z-[150] flex animate-fade-in items-center justify-center bg-[oklch(0.2_0.04_265/0.55)] px-[20px] backdrop-blur-[3px]"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDone();
      }}
    >
      <div
        key={index}
        className="relative w-full max-w-[380px] animate-pop-in overflow-hidden rounded-[22px] border border-line bg-surface px-[28px] py-[30px] text-center shadow-[0_24px_80px_oklch(0.2_0.05_265/0.45)]"
      >
        <div
          aria-hidden="true"
          className={cx(
            'pointer-events-none absolute inset-x-0 top-0 h-[150px]',
            step.kind === 'level'
              ? 'bg-gradient-to-b from-[oklch(0.93_0.06_285)] to-transparent'
              : 'bg-gradient-to-b from-[oklch(0.96_0.06_90)] to-transparent',
          )}
        />

        {step.kind === 'level' ? <LevelStep up={step.up} /> : <BadgeStep badge={step.badge} />}

        {steps.length > 1 && (
          <p className="relative mt-[14px] font-mono text-[10.5px] text-ink-faint">
            {index + 1} of {steps.length}
          </p>
        )}

        <Button autoFocus onClick={next} className="relative mt-[18px] w-full py-[11px]">
          {last ? 'Keep going' : 'Next reward'}
        </Button>
      </div>
    </div>
  );
}

function LevelStep({ up }: { up: LevelUp }) {
  return (
    <div className="relative">
      <p className="font-mono text-[11px] tracking-[0.2em] text-violet uppercase">Level up</p>
      <div className="mt-[14px] flex justify-center">
        <LevelRing level={up.to_level} percent={100} size={116} glow />
      </div>
      <h2 className="mt-[16px] text-[24px] font-semibold tracking-tight text-ink">{up.name}</h2>
      <p className="mt-[4px] text-[13px] text-ink-muted">
        You went from level {up.from_level} to level {up.to_level}.
      </p>
    </div>
  );
}

function BadgeStep({ badge }: { badge: BadgeInfo }) {
  return (
    <div className="relative">
      <p className="font-mono text-[11px] tracking-[0.2em] text-gold-ink uppercase">
        Badge unlocked
      </p>
      <div className="mt-[16px] flex justify-center">
        <BadgeMedal badge={badge} size="lg" celebrate />
      </div>
      <h2 className="mt-[16px] text-[22px] font-semibold tracking-tight text-ink">{badge.name}</h2>
      <p className="mx-auto mt-[4px] max-w-[260px] text-[13px] text-ink-muted">
        {badge.description}
      </p>
      <span
        className={cx(
          'mt-[12px] inline-flex items-center gap-[5px] rounded-full px-[10px] py-[3px] font-mono text-[10.5px] tracking-wide uppercase',
          badge.rarity === 'epic'
            ? 'bg-violet-wash text-violet'
            : badge.rarity === 'rare'
              ? 'bg-brand-wash text-brand'
              : 'bg-surface-muted text-ink-muted',
        )}
      >
        <BoltIcon className="size-[11px]" />
        {RARITY_LABEL[badge.rarity]}
      </span>
    </div>
  );
}
