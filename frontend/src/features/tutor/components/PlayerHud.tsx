import { Link } from 'react-router-dom';

import { cx } from '@/shared/components/ui';
import { useProfile, type Streak } from '../api/sessionApi';
import { useCountUp } from './fx';
import { FlameIcon } from './icons';
import { LevelRing } from './LevelRing';

/**
 * The player's status in the header: streak, level ring and an XP bar. It reads the
 * profile, which every answer invalidates, so it moves the moment XP is earned.
 */
export function PlayerHud() {
  const { data, error } = useProfile();
  const xp = useCountUp(data?.total_xp ?? 0);

  // Lecturers have no learner profile. Show nothing rather than a loading bar that never ends.
  if (error) return null;
  if (!data) {
    return <span className="h-[34px] w-[150px] animate-pulse rounded-full bg-surface-sunken" />;
  }

  const { level, streak } = data;
  const closeToLevelUp = level.xp_for_next !== null && level.percent >= 80;

  return (
    <Link
      to="/profile"
      title={`Level ${level.number} ${level.name}. Open your profile.`}
      className="group flex items-center gap-[10px] rounded-full py-[2px] pr-[6px] pl-[2px] transition-colors hover:bg-surface-muted"
    >
      <StreakChip streak={streak} />
      <LevelRing level={level.number} percent={level.percent} size={34} glow={closeToLevelUp} />
      <span className="hidden w-[132px] flex-col gap-[3px] md:flex">
        <span className="flex items-baseline justify-between">
          <span className="text-[11.5px] font-semibold text-ink">{level.name}</span>
          <span className="font-mono text-[10.5px] text-ink-muted">{xp} XP</span>
        </span>
        <span className="h-[6px] overflow-hidden rounded-full bg-surface-sunken">
          <span
            className="block h-full rounded-full bg-gradient-to-r from-brand to-violet"
            style={{
              width: `${level.percent}%`,
              transition: 'width 0.9s cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          />
        </span>
      </span>
    </Link>
  );
}

export function StreakChip({ streak, large = false }: { streak: Streak; large?: boolean }) {
  const alive = streak.current > 0;
  const lit = alive && streak.learned_today;

  return (
    <span
      title={
        !alive
          ? 'Learn today to start a streak'
          : lit
            ? `${streak.current} day streak`
            : `${streak.current} day streak. Learn today to keep it.`
      }
      className={cx(
        'inline-flex items-center gap-[4px] rounded-full font-mono font-semibold',
        large ? 'px-[12px] py-[6px] text-[15px]' : 'px-[7px] py-[3px] text-[12px]',
        lit
          ? 'bg-[oklch(0.96_0.05_55)] text-flame-deep'
          : alive
            ? 'bg-surface-muted text-flame'
            : 'bg-surface-muted text-ink-faint',
      )}
    >
      <FlameIcon
        className={cx(large ? 'size-[20px]' : 'size-[14px]', lit && 'animate-flicker text-flame')}
      />
      {streak.current}
    </span>
  );
}
