import { Link } from 'react-router-dom';

import { useAuth } from '@/shared/auth/AuthProvider';
import { Badge, Card, cx } from '@/shared/components/ui';
import { useModules, type Module } from '../api/tutorApi';

export function DashboardPage() {
  const { user } = useAuth();
  const { data: modules, isPending, error } = useModules();

  const firstName = user?.full_name.split(' ')[0] ?? 'there';
  const open = modules?.find((module) => module.status === 'available');

  return (
    <div className="flex flex-col gap-[28px]">
      <header className="flex flex-wrap items-end justify-between gap-[16px]">
        <div>
          <p className="font-mono text-[11px] tracking-tight text-ink-faint">
            {user?.role === 'lecturer' ? 'LECTURER' : 'STUDENT'}
            {user?.student_number ? ` · ${user.student_number}` : ''}
          </p>
          <h1 className="mt-[6px] text-[25px] font-semibold tracking-tight text-ink">
            Welcome back, {firstName}.
          </h1>
          <p className="mt-[5px] text-[13px] text-ink-muted">
            Pick a module to open its quest map.
          </p>
        </div>

        {/*
         * Zero-state until sessions exist. These are placeholders for the
         * progress API that arrives with phase P5, not data from the server.
         */}
        <div className="grid grid-cols-3 gap-[10px]">
          <Stat label="XP" value="0" />
          <Stat label="Streak" value="0 days" />
          <Stat label="Mastered" value={open ? `0 of ${open.topic_count}` : '0'} />
        </div>
      </header>

      <section>
        <div className="mb-[12px] flex items-baseline justify-between">
          <h2 className="text-[13px] font-medium text-ink">Your modules</h2>
          {modules && (
            <span className="font-mono text-[10.5px] text-ink-faint">
              {modules.filter((m) => m.status === 'available').length} open ·{' '}
              {modules.filter((m) => m.status === 'coming_soon').length} coming soon
            </span>
          )}
        </div>

        {isPending && <ModuleSkeletons />}

        {error && (
          <Card className="px-[18px] py-[16px]">
            <p className="text-[12.5px] text-caution-ink">
              Could not load your modules. Check that the tutor service is running on port
              8301.
            </p>
          </Card>
        )}

        {modules && (
          <div className="grid gap-[14px] sm:grid-cols-2">
            {modules.map((module) => (
              <ModuleCard key={module.module_id} module={module} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[88px] rounded-[10px] border border-line bg-surface px-[13px] py-[9px]">
      <p className="font-mono text-[10px] tracking-wide text-ink-faint uppercase">{label}</p>
      <p className="mt-[2px] text-[17px] font-semibold tracking-tight text-ink">{value}</p>
    </div>
  );
}

/** Diagonal hatching, borrowed from the locked checkpoints in the mockups. */
const HATCH = {
  backgroundImage:
    'repeating-linear-gradient(135deg, transparent 0 7px, oklch(0.94 0.004 265) 7px 8px)',
};

function ModuleCard({ module }: { module: Module }) {
  const soon = module.status === 'coming_soon';

  const content = (
    <>
      <div className="flex items-start justify-between gap-[12px]">
        <div className="flex items-start gap-[12px]">
          <ModuleMark soon={soon} />
          <div>
            {module.code && (
              <span className="font-mono text-[10.5px] tracking-tight text-ink-faint">
                {module.code}
              </span>
            )}
            <h3
              className={cx(
                'text-[15.5px] font-semibold tracking-tight',
                soon ? 'text-ink-muted' : 'text-ink group-hover:text-brand',
              )}
            >
              {module.name}
            </h3>
          </div>
        </div>
        {soon ? <Badge>Coming soon</Badge> : <Arrow />}
      </div>

      {module.description && (
        <p
          className={cx(
            'mt-[10px] text-[12.5px] leading-[1.6]',
            soon ? 'text-ink-faint' : 'text-ink-muted',
          )}
        >
          {module.description}
        </p>
      )}

      <div className="mt-[16px] flex items-center gap-[7px] border-t border-line-soft pt-[13px]">
        {soon ? (
          <span className="font-mono text-[10.5px] text-ink-faint">
            Course content in preparation
          </span>
        ) : (
          <>
            <Badge tone="brand">Open</Badge>
            <Badge>{module.topic_count} topics</Badge>
            <Badge>{module.concept_count} concepts</Badge>
          </>
        )}
      </div>
    </>
  );

  if (soon) {
    // Not a Card: the hatching has to cover the whole surface, edge to edge.
    return (
      <div
        aria-disabled="true"
        style={HATCH}
        className="h-full cursor-not-allowed rounded-[14px] border border-dashed border-line-strong bg-surface-muted px-[20px] py-[18px]"
      >
        {content}
      </div>
    );
  }

  return (
    <Link
      to={`/modules/${module.module_id}`}
      className="group rounded-[14px] focus-visible:outline-none"
    >
      <Card className="h-full px-[20px] py-[18px] transition-colors group-hover:border-brand-soft">
        {content}
      </Card>
    </Link>
  );
}

function ModuleMark({ soon }: { soon: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'mt-[2px] flex size-[34px] shrink-0 items-center justify-center rounded-[10px]',
        'font-mono text-[12px] font-semibold',
        soon
          ? 'border border-dashed border-line-strong bg-surface text-ink-faint'
          : 'bg-brand text-white',
      )}
    >
      {soon ? '···' : '</>'}
    </span>
  );
}

function Arrow() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="mt-[2px] size-[15px] shrink-0 text-ink-faint transition-transform group-hover:translate-x-[2px] group-hover:text-brand"
      fill="none"
    >
      <path
        d="M4 8h8M8.5 4.5 12 8l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ModuleSkeletons() {
  return (
    <div className="grid gap-[14px] sm:grid-cols-2">
      {[0, 1].map((index) => (
        <Card key={index} className="px-[20px] py-[18px]">
          <div className="animate-pulse">
            <div className="h-[9px] w-[56px] rounded-full bg-surface-sunken" />
            <div className="mt-[10px] h-[15px] w-3/4 rounded-full bg-surface-sunken" />
            <div className="mt-[12px] h-[9px] w-full rounded-full bg-surface-sunken" />
            <div className="mt-[6px] h-[9px] w-2/3 rounded-full bg-surface-sunken" />
          </div>
        </Card>
      ))}
    </div>
  );
}
