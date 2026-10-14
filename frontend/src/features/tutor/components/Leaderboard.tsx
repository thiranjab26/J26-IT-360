import { Card, cx } from '@/shared/components/ui';
import { useLeaderboard, type LeaderEntry } from '../api/sessionApi';
import { TrophyIcon } from './icons';

const PODIUM = [
  'bg-gradient-to-br from-[oklch(0.9_0.12_90)] to-[oklch(0.72_0.15_75)] text-gold-ink',
  'bg-gradient-to-br from-[oklch(0.94_0.01_265)] to-[oklch(0.78_0.02_265)] text-ink-soft',
  'bg-gradient-to-br from-[oklch(0.85_0.08_55)] to-[oklch(0.65_0.1_45)] text-white',
];

/** The top students by XP. Names are shortened to a first name and an initial. */
export function Leaderboard({ className }: { className?: string }) {
  const { data, isPending, error } = useLeaderboard();

  return (
    <Card className={cx('overflow-hidden', className)}>
      <div className="flex items-center gap-[8px] border-b border-line-soft px-[18px] py-[13px]">
        <TrophyIcon className="size-[16px] text-gold-deep" />
        <h2 className="text-[13px] font-semibold text-ink">Leaderboard</h2>
        <span className="ml-auto font-mono text-[10.5px] text-ink-faint">by XP</span>
      </div>

      {isPending && (
        <div className="flex animate-pulse flex-col gap-[10px] px-[18px] py-[16px]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[28px] rounded-[8px] bg-surface-sunken" />
          ))}
        </div>
      )}
      {error && (
        <p className="px-[18px] py-[16px] text-[12.5px] text-caution-ink">
          The leaderboard is not available right now.
        </p>
      )}
      {data && data.entries.length === 0 && (
        <p className="px-[18px] py-[18px] text-[12.5px] text-ink-muted">
          Nobody has earned XP yet. Finish a checkpoint to take first place.
        </p>
      )}
      {data && data.entries.length > 0 && (
        <ol className="divide-y divide-line-soft">
          {data.entries.map((entry, i) => (
            <Row key={entry.rank} entry={entry} delay={i * 60} />
          ))}
          {data.you && (
            <>
              <li aria-hidden="true" className="px-[18px] py-[2px] text-center text-ink-faint">
                ...
              </li>
              <Row entry={data.you} delay={data.entries.length * 60} />
            </>
          )}
        </ol>
      )}
    </Card>
  );
}

function Row({ entry, delay }: { entry: LeaderEntry; delay: number }) {
  const podium = entry.rank <= 3 ? PODIUM[entry.rank - 1] : null;
  return (
    <li
      style={{ animationDelay: `${delay}ms` }}
      className={cx(
        'flex animate-slide-up items-center gap-[11px] px-[18px] py-[9px]',
        entry.is_you && 'bg-brand-wash',
      )}
    >
      <span
        className={cx(
          'flex size-[24px] shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold',
          podium ?? 'bg-surface-muted text-ink-muted',
        )}
      >
        {entry.rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-[13px]', entry.is_you ? 'font-semibold text-brand' : 'text-ink')}>
          {entry.name}
          {entry.is_you && ' (you)'}
        </span>
        <span className="block font-mono text-[10.5px] text-ink-faint">
          Level {entry.level_number} {entry.level_name}
        </span>
      </span>
      <span className="font-mono text-[12.5px] font-semibold text-ink">{entry.xp} XP</span>
    </li>
  );
}
