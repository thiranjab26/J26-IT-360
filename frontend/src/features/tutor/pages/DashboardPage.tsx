import { Link } from 'react-router-dom';

import { useAuth } from '@/shared/auth/AuthProvider';
import { Badge, Card } from '@/shared/components/ui';
import { useModules, type Module } from '../api/tutorApi';

export function DashboardPage() {
  const { user } = useAuth();
  const { data: modules, isPending, error } = useModules();

  const firstName = user?.full_name.split(' ')[0] ?? 'there';

  return (
    <div className="flex flex-col gap-[28px]">
      <header>
        <p className="font-mono text-[11px] tracking-tight text-ink-faint">
          {user?.role === 'lecturer' ? 'LECTURER' : 'STUDENT'}
          {user?.student_number ? ` · ${user.student_number}` : ''}
        </p>
        <h1 className="mt-[6px] text-[25px] font-semibold tracking-tight text-ink">
          Welcome back, {firstName}.
        </h1>
        <p className="mt-[5px] text-[13px] text-ink-muted">
          Pick a module to see the concepts it covers.
        </p>
      </header>

      <section>
        <div className="mb-[12px] flex items-baseline justify-between">
          <h2 className="text-[13px] font-medium text-ink">Your modules</h2>
          {modules && (
            <span className="font-mono text-[10.5px] text-ink-faint">
              {modules.length} enrolled
            </span>
          )}
        </div>

        {isPending && <ModuleSkeletons />}

        {error && (
          <Card className="px-[18px] py-[16px]">
            <p className="text-[12.5px] text-caution-ink">
              Could not load your modules. Check that the tutor service is running on
              port 8301.
            </p>
          </Card>
        )}

        {modules && modules.length === 0 && (
          <Card className="px-[18px] py-[16px]">
            <p className="text-[12.5px] text-ink-muted">
              No modules yet. Seed them with{' '}
              <code className="font-mono text-[11.5px] text-ink">
                python database/seed/seed_concepts.py
              </code>
              .
            </p>
          </Card>
        )}

        {modules && modules.length > 0 && (
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

function ModuleCard({ module }: { module: Module }) {
  return (
    <Link
      to={`/modules/${module.module_id}`}
      className="group rounded-[14px] focus-visible:outline-none"
    >
      <Card className="h-full px-[20px] py-[18px] transition-colors group-hover:border-line-strong">
        <div className="flex items-start justify-between gap-[12px]">
          <div>
            {module.code && (
              <span className="font-mono text-[10.5px] tracking-tight text-ink-faint">
                {module.code}
              </span>
            )}
            <h3 className="mt-[3px] text-[15.5px] font-semibold tracking-tight text-ink group-hover:text-brand">
              {module.name}
            </h3>
          </div>
          <Arrow />
        </div>

        {module.description && (
          <p className="mt-[8px] text-[12.5px] leading-[1.6] text-ink-muted">
            {module.description}
          </p>
        )}

        <div className="mt-[16px] flex items-center gap-[7px] border-t border-line-soft pt-[13px]">
          <Badge>{module.topic_count} topics</Badge>
          <Badge>{module.concept_count} concepts</Badge>
        </div>
      </Card>
    </Link>
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
