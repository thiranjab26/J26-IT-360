import { Card } from '@/shared/components/ui';
import { useProfile } from '../api/sessionApi';
import { Leaderboard } from '../components/Leaderboard';
import { BadgeShelf, HeroStats } from '../components/ProfileStats';

/** Everything the student has earned: level, streak, every badge, and where they rank. */
export function ProfilePage() {
  const { data, error } = useProfile();

  return (
    <div className="flex flex-col gap-[22px]">
      <header>
        <p className="font-mono text-[11px] tracking-tight text-ink-faint">YOUR PROFILE</p>
        <h1 className="mt-[6px] text-[23px] font-semibold tracking-tight text-ink">
          Level, streak and badges
        </h1>
        <p className="mt-[5px] max-w-[560px] text-[13px] text-ink-muted">
          XP comes from checkpoints you pass and bonuses for finishing, mastering and keeping a
          streak. Badges are earned once, for good.
        </p>
      </header>

      <HeroStats />

      <div className="grid items-start gap-[22px] lg:grid-cols-[1fr_320px]">
        <section aria-label="Badges">
          <div className="mb-[12px] flex items-baseline justify-between">
            <h2 className="text-[14px] font-semibold text-ink">Badges</h2>
            {data && (
              <span className="font-mono text-[10.5px] text-ink-faint">
                {data.badges.filter((b) => b.earned).length} of {data.badges.length} earned
              </span>
            )}
          </div>
          {error && (
            <Card className="px-[18px] py-[16px]">
              <p className="text-[12.5px] text-caution-ink">Could not load your badges.</p>
            </Card>
          )}
          {data && <BadgeShelf badges={data.badges} />}
        </section>

        <aside className="lg:sticky lg:top-[20px]">
          <Leaderboard />
        </aside>
      </div>
    </div>
  );
}
