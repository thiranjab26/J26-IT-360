import { Link } from 'react-router-dom';

import { Card, cx } from '@/shared/components/ui';
import { usePracticals, type PracticalSummary } from '../api/practicalApi';
import { BoltIcon, CheckIcon, LockIcon, StarIcon } from '../components/icons';
import { Mascot } from '../components/Mascot';

/** Program-writing practicals from the course, grouped by concept, as a board of missions. */
export function PracticalsPage() {
  const { data, isPending, error } = usePracticals();

  const groups = new Map<string, PracticalSummary[]>();
  for (const practical of data?.practicals ?? []) {
    groups.set(practical.concept_title, [...(groups.get(practical.concept_title) ?? []), practical]);
  }
  const total = data?.practicals.length ?? 0;
  const passed = data?.practicals.filter((p) => p.passed).length ?? 0;

  return (
    <div className="flex flex-col gap-[22px]">
      <header className="flex flex-wrap items-center justify-between gap-[16px]">
        <div className="flex items-center gap-[14px]">
          <Mascot mood={passed > 0 ? 'cheer' : 'idle'} size={68} />
          <div>
            <p className="font-mono text-[11px] tracking-wide text-brand uppercase">Mission board</p>
            <h1 className="mt-[4px] bg-gradient-to-r from-ink to-brand bg-clip-text text-[26px] font-extrabold tracking-tight text-transparent">
              Write real Java
            </h1>
            <p className="mt-[4px] max-w-[560px] text-[13px] text-ink-muted">
              Each mission is a program that reads input and prints a result. Run it as often as you
              like, then submit it against the hidden tests. Your first clear of a mission earns XP.
            </p>
          </div>
        </div>
        {data && (
          <div className="min-w-[190px]">
            <p className="flex items-center justify-between font-mono text-[11.5px] font-semibold text-gold-ink">
              <span className="inline-flex items-center gap-[5px]">
                <BoltIcon className="size-[13px] text-gold-deep" />
                Missions cleared
              </span>
              <span>
                {passed} / {total}
              </span>
            </p>
            <Bar done={passed} total={total} className="mt-[6px]" />
          </div>
        )}
      </header>

      {isPending && <p className="text-[13px] text-ink-muted">Loading the missions...</p>}
      {error && (
        <Card className="px-[18px] py-[16px]">
          <p className="text-[12.5px] text-caution-ink">Could not load the missions.</p>
        </Card>
      )}

      <div className="flex flex-col gap-[18px]">
        {[...groups.entries()].map(([concept, items], index) => {
          const cleared = items.filter((p) => p.passed).length;
          return (
            <section
              key={concept}
              style={{ animationDelay: `${index * 60}ms` }}
              className="animate-slide-up"
            >
              <div className="mb-[10px] flex items-center justify-between gap-[12px]">
                <h2 className="flex items-center gap-[8px] text-[15px] font-bold text-ink">
                  {cleared === items.length && (
                    <StarIcon className="size-[16px] text-gold drop-shadow-[0_0_6px_oklch(0.8_0.15_85/0.8)]" />
                  )}
                  {concept}
                </h2>
                <span className="flex items-center gap-[8px] font-mono text-[10.5px] text-ink-faint">
                  {cleared} of {items.length}
                  <Bar done={cleared} total={items.length} className="w-[70px]" />
                </span>
              </div>
              <ul className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-3">
                {items.map((practical) => (
                  <MissionTile key={practical.practical_id} practical={practical} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Bar({ done, total, className }: { done: number; total: number; className?: string }) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <span className={cx('block h-[8px] overflow-hidden rounded-full bg-surface-sunken', className)}>
      <span
        className="block h-full rounded-full bg-gradient-to-r from-gold-deep to-gold shadow-[0_0_8px_oklch(0.8_0.15_85/0.6)] transition-[width] duration-700"
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}

function MissionTile({ practical }: { practical: PracticalSummary }) {
  const usable = practical.unlocked && practical.ready;
  const stars = Math.min(5, Math.max(1, practical.level));

  const inner = (
    <div
      className={cx(
        'relative flex h-full flex-col gap-[10px] rounded-[16px] border-2 px-[15px] py-[14px] transition-all duration-150',
        practical.passed
          ? 'border-gold bg-gold-wash'
          : practical.unlocked
            ? 'border-line bg-surface shadow-[0_4px_0_0_var(--color-line)]'
            : 'border-dashed border-line bg-surface-sunken',
        usable &&
          'hover:-translate-y-[2px] hover:border-brand hover:shadow-[0_6px_0_0_var(--color-brand-soft),0_0_24px_oklch(0.68_0.19_275/0.3)] active:translate-y-[2px]',
      )}
    >
      <div className="flex items-start justify-between gap-[8px]">
        <span
          aria-hidden="true"
          className={cx(
            'flex size-[34px] shrink-0 items-center justify-center rounded-[11px]',
            practical.passed
              ? 'bg-gradient-to-br from-gold to-flame text-[oklch(0.25_0.06_70)]'
              : practical.unlocked
                ? 'bg-gradient-to-br from-brand to-violet text-white'
                : 'border border-line bg-surface-muted text-ink-faint',
          )}
        >
          {practical.passed ? (
            <CheckIcon className="size-[18px]" />
          ) : !practical.unlocked ? (
            <LockIcon className="size-[16px]" />
          ) : (
            <BoltIcon className="size-[16px]" />
          )}
        </span>
        <span role="img" aria-label={`Difficulty ${stars} of 5`} className="flex gap-[1px] pt-[3px]">
          {Array.from({ length: 5 }, (_, i) => (
            <StarIcon
              key={i}
              className={cx('size-[12px]', i < stars ? 'text-gold' : 'text-line-strong')}
            />
          ))}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold text-ink">{practical.title}</p>
        <p className="mt-[2px] text-[12px] text-ink-muted">
          {!practical.unlocked
            ? 'Locked. Master what this concept builds on.'
            : !practical.ready
              ? 'Its tests are being prepared'
              : practical.best
                ? `Best so far: ${practical.best} tests`
                : 'Not tried yet'}
        </p>
      </div>

      <span className="font-mono text-[11px] font-semibold text-gold-ink">
        {practical.passed ? 'CLEARED' : `+${practical.level >= 5 ? 250 : 150} XP`}
      </span>
    </div>
  );

  return (
    <li className={cx(!practical.unlocked && 'opacity-75')}>
      {usable ? (
        <Link to={`/practicals/${practical.practical_id}`} className="block h-full">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
}
