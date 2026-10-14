import { Card, cx } from '@/shared/components/ui';
import { useProfile, type BadgeStatus, type Profile } from '../api/sessionApi';
import { BadgeMedal, RARITY_LABEL } from './BadgeMedal';
import { useCountUp } from './fx';
import { BoltIcon } from './icons';
import { LevelRing } from './LevelRing';
import { StreakChip } from './PlayerHud';

/** The player card: level, XP towards the next level, streak and badge count. */
export function HeroStats({ className }: { className?: string }) {
  const { data, isPending, error } = useProfile();

  if (error) return null;
  if (isPending || !data) {
    return (
      <Card className={cx('h-[132px] animate-pulse bg-surface-sunken', className)}>
        <span className="sr-only">Loading your progress</span>
      </Card>
    );
  }
  return <Hero profile={data} className={className} />;
}

function Hero({ profile, className }: { profile: Profile; className?: string }) {
  const { level, streak } = profile;
  const xp = useCountUp(profile.total_xp, 900);
  const earned = profile.badges.filter((b) => b.earned);
  const toNext = level.xp_for_next === null ? null : level.xp_for_next - level.xp_into_level;

  return (
    <Card
      className={cx(
        'relative overflow-hidden px-[22px] py-[18px]',
        'bg-gradient-to-br from-surface via-surface to-[oklch(0.96_0.025_285)]',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-[26px] gap-y-[16px]">
        <div className="flex items-center gap-[14px]">
          <LevelRing level={level.number} percent={level.percent} size={72} glow={level.percent >= 80} />
          <div>
            <p className="font-mono text-[10.5px] tracking-wide text-ink-faint uppercase">
              Level {level.number}
            </p>
            <p className="text-[20px] font-semibold tracking-tight text-ink">{level.name}</p>
            <p className="text-[12px] text-ink-muted">
              {toNext === null
                ? 'Top level reached'
                : `${toNext} XP to ${level.next_name ?? 'the next level'}`}
            </p>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-3 gap-[10px] sm:min-w-[320px]">
          <Tile label="Total XP">
            <span className="inline-flex items-center gap-[5px] text-gold-ink">
              <BoltIcon className="size-[15px] text-gold-deep" />
              {xp}
            </span>
          </Tile>
          <Tile label="Streak">
            <StreakChip streak={streak} />
            <span className="mt-[3px] block text-[10.5px] font-normal text-ink-faint">
              {streak.current === 0
                ? 'learn today to start'
                : streak.learned_today
                  ? 'kept for today'
                  : 'learn today to keep it'}
            </span>
          </Tile>
          <Tile label="Badges">
            <span>
              {earned.length}
              <span className="text-ink-faint"> / {profile.badges.length}</span>
            </span>
            <span className="mt-[5px] flex -space-x-[6px]">
              {earned.slice(-4).map((b) => (
                <BadgeMedal key={b.id} badge={b} size="sm" className="size-[24px] ring-2 ring-surface" />
              ))}
            </span>
          </Tile>
        </div>
      </div>
    </Card>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface/80 px-[13px] py-[9px]">
      <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">{label}</p>
      <div className="mt-[3px] font-mono text-[17px] font-semibold text-ink">{children}</div>
    </div>
  );
}

/** Every badge, earned ones lit and the rest locked, each saying how to get it. */
export function BadgeShelf({ badges, className }: { badges: BadgeStatus[]; className?: string }) {
  return (
    <ul className={cx('grid gap-[12px] sm:grid-cols-2', className)}>
      {badges.map((badge, i) => (
        <li
          key={badge.id}
          style={{ animationDelay: `${i * 50}ms` }}
          className={cx(
            'flex animate-slide-up items-center gap-[13px] rounded-[12px] border px-[14px] py-[12px]',
            badge.earned ? 'border-line bg-surface' : 'border-dashed border-line bg-surface-muted',
          )}
        >
          <BadgeMedal badge={badge} earned={badge.earned} size="md" />
          <div className="min-w-0">
            <p className={cx('text-[13.5px] font-semibold', badge.earned ? 'text-ink' : 'text-ink-muted')}>
              {badge.name}
            </p>
            <p className="text-[12px] leading-[1.5] text-ink-muted">{badge.description}</p>
            <p className="mt-[3px] font-mono text-[10px] tracking-wide text-ink-faint uppercase">
              {RARITY_LABEL[badge.rarity]}
              {badge.earned && badge.earned_at
                ? ` · earned ${new Date(badge.earned_at).toLocaleDateString()}`
                : ''}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
