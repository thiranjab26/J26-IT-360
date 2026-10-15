import { Link } from 'react-router-dom';

import { Badge, Card, cx } from '@/shared/components/ui';
import { usePracticals, type PracticalSummary } from '../api/practicalApi';
import { BoltIcon, CheckIcon, LockIcon } from '../components/icons';

/** Program-writing practicals from the course, grouped by concept. */
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
      <header className="flex flex-wrap items-end justify-between gap-[14px]">
        <div>
          <p className="font-mono text-[11px] tracking-tight text-ink-faint">PRACTICALS</p>
          <h1 className="mt-[6px] text-[23px] font-semibold tracking-tight text-ink">
            Write real Java
          </h1>
          <p className="mt-[5px] max-w-[600px] text-[13px] text-ink-muted">
            Each practical is a program that reads input and prints a result. Run it as often as you
            like, then submit it: it is marked on the sample and on hidden tests. Passing one for the
            first time earns XP.
          </p>
        </div>
        {data && (
          <span className="inline-flex items-center gap-[6px] rounded-full border border-gold bg-gold-wash px-[12px] py-[4px] font-mono text-[12px] font-semibold text-gold-ink">
            <BoltIcon className="size-[13px] text-gold-deep" />
            {passed} of {total} passed
          </span>
        )}
      </header>

      {isPending && <p className="text-[13px] text-ink-muted">Loading the practicals...</p>}
      {error && (
        <Card className="px-[18px] py-[16px]">
          <p className="text-[12.5px] text-caution-ink">Could not load the practicals.</p>
        </Card>
      )}

      <div className="flex flex-col gap-[14px]">
        {[...groups.entries()].map(([concept, items], index) => (
          <Card
            key={concept}
            className="animate-slide-up overflow-hidden"
          >
            <div
              style={{ animationDelay: `${index * 40}ms` }}
              className="flex items-center justify-between border-b border-line-soft px-[18px] py-[11px]"
            >
              <h2 className="text-[14px] font-semibold text-ink">{concept}</h2>
              <span className="font-mono text-[10.5px] text-ink-faint">
                {items.filter((p) => p.passed).length} of {items.length} passed
              </span>
            </div>
            <ul className="divide-y divide-line-soft">
              {items.map((practical) => (
                <Row key={practical.practical_id} practical={practical} />
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Row({ practical }: { practical: PracticalSummary }) {
  const usable = practical.unlocked && practical.ready;
  const inner = (
    <div className="flex items-center gap-[12px] px-[18px] py-[12px]">
      <span
        aria-hidden="true"
        className={cx(
          'flex size-[24px] shrink-0 items-center justify-center rounded-full',
          practical.passed
            ? 'bg-verified text-white'
            : practical.unlocked
              ? 'border border-line-strong bg-surface text-ink-faint'
              : 'border border-dashed border-line-strong bg-surface-muted text-ink-faint',
        )}
      >
        {practical.passed ? (
          <CheckIcon className="size-[13px]" />
        ) : !practical.unlocked ? (
          <LockIcon className="size-[12px]" />
        ) : (
          <span className="size-[6px] rounded-full bg-line-strong" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-ink">{practical.title}</p>
        <p className="text-[12px] text-ink-muted">
          {!practical.unlocked
            ? 'Locked until you master what this concept builds on'
            : !practical.ready
              ? 'Its tests are being prepared'
              : practical.best
                ? `Best so far: ${practical.best} tests`
                : 'Not tried yet'}
        </p>
      </div>
      <Badge tone={practical.level >= 5 ? 'caution' : 'brand'}>level {practical.level}</Badge>
      <span className="hidden font-mono text-[11px] text-gold-ink sm:inline">
        +{practical.level >= 5 ? 250 : 150} XP
      </span>
    </div>
  );

  return (
    <li className={cx(!practical.unlocked && 'opacity-70')}>
      {usable ? (
        <Link
          to={`/practicals/${practical.practical_id}`}
          className="block transition-colors hover:bg-surface-muted"
        >
          {inner}
        </Link>
      ) : (
        inner
      )}
    </li>
  );
}
