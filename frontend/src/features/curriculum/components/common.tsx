import { Link, NavLink } from 'react-router-dom';

import { ApiError } from '@/shared/api/client';
import { useAuth } from '@/shared/auth/AuthProvider';
import { Badge, Card, cx } from '@/shared/components/ui';
import type { Phase } from '../api/curriculumApi';
import { PHASE_LABELS, moduleName, percent, type MasteryLevel } from '../lib/modules';

/* ----------------------------------------------------------- Module header */

export function isStaff(role: string | undefined): boolean {
  return role === 'lecturer' || role === 'admin';
}

export function ModuleHeader({ moduleId, phase }: { moduleId: string; phase?: Phase }) {
  const { user } = useAuth();
  return (
    <header>
      <Link to="/curriculum" className="font-mono text-[11px] text-ink-faint hover:text-brand">
        ← My learning path
      </Link>
      <div className="mt-[12px] flex flex-wrap items-end justify-between gap-[12px]">
        <div>
          <span className="font-mono text-[11px] tracking-tight text-ink-faint">
            {moduleId.toUpperCase()}
          </span>
          <h1 className="mt-[3px] text-[23px] font-semibold tracking-tight text-ink">
            {moduleName(moduleId)}
          </h1>
        </div>
        {phase && <PhaseBadge phase={phase} />}
      </div>
      <nav
        aria-label="Module sections"
        className="mt-[16px] flex gap-[4px] overflow-x-auto border-b border-line"
      >
        <Tab to={`/curriculum/${moduleId}`} end>
          Progress
        </Tab>
        <Tab to={`/curriculum/${moduleId}/roadmap`}>Roadmap</Tab>
        <Tab to={`/curriculum/${moduleId}/gain`}>My gain</Tab>
        {isStaff(user?.role) && (
          <>
            <Tab to={`/curriculum/${moduleId}/staff`}>Lecturer</Tab>
            <Tab to={`/curriculum/${moduleId}/questions`}>Questions</Tab>
          </>
        )}
      </nav>
    </header>
  );
}

function Tab({ to, end, children }: { to: string; end?: boolean; children: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          '-mb-px shrink-0 border-b-2 px-[12px] py-[8px] text-[13px] transition-colors',
          isActive
            ? 'border-brand font-medium text-ink'
            : 'border-transparent text-ink-muted hover:text-ink',
        )
      }
    >
      {children}
    </NavLink>
  );
}

export function PhaseBadge({ phase }: { phase: Phase }) {
  const tone = phase === 'pretest' || phase === 'posttest' ? 'brand' : 'neutral';
  return <Badge tone={tone}>{PHASE_LABELS[phase]}</Badge>;
}

/* ------------------------------------------------------------- Mastery bar */

const BAR_FILL: Record<MasteryLevel, string> = {
  mastered: 'bg-verified',
  learning: 'bg-caution',
  none: 'bg-transparent',
};

/** Mastery as a bar, with a tick at the mastered threshold. */
export function MasteryBar({
  score,
  level,
  threshold,
}: {
  score: number | null;
  level: MasteryLevel;
  threshold: number;
}) {
  return (
    <div
      role="meter"
      aria-label="Mastery"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score === null ? undefined : Math.round(score * 100)}
      aria-valuetext={score === null ? 'No evidence yet' : percent(score)}
      className="relative h-[6px] w-full rounded-full bg-surface-sunken"
    >
      <div
        className={cx('h-full rounded-full', BAR_FILL[level])}
        style={{ width: `${Math.max(0, Math.min(1, score ?? 0)) * 100}%` }}
      />
      <span
        aria-hidden="true"
        className="absolute top-[-3px] h-[12px] w-[1.5px] bg-ink-faint"
        style={{ left: `${threshold * 100}%` }}
      />
    </div>
  );
}

export const LEVEL_LABEL: Record<MasteryLevel, string> = {
  mastered: 'Mastered',
  learning: 'In progress',
  none: 'Not started',
};

export const LEVEL_TONE: Record<MasteryLevel, 'verified' | 'caution' | 'neutral'> = {
  mastered: 'verified',
  learning: 'caution',
  none: 'neutral',
};

/* ------------------------------------------------------- Loading and errors */

export function PageSkeleton() {
  return (
    <div className="animate-pulse" aria-busy="true">
      <div className="h-[9px] w-[70px] rounded-full bg-surface-sunken" />
      <div className="mt-[12px] h-[22px] w-1/2 rounded-full bg-surface-sunken" />
      <div className="mt-[28px] h-[90px] rounded-[14px] bg-surface-sunken" />
      <div className="mt-[14px] h-[160px] rounded-[14px] bg-surface-sunken" />
    </div>
  );
}

/** Shows the service's own message; a 503 means the gateway could not reach C1. */
export function ErrorCard({ error, what }: { error: unknown; what: string }) {
  const unavailable = error instanceof ApiError && error.status === 503;
  const message =
    error instanceof ApiError && !unavailable
      ? error.message
      : `Could not load ${what}. Check that the curriculum service is running on port 8101.`;
  return (
    <Card className="px-[20px] py-[18px]">
      <p className="text-[13px] text-caution-ink">{message}</p>
      {error instanceof ApiError && (
        <p className="mt-[4px] font-mono text-[10.5px] text-ink-faint">{error.code}</p>
      )}
    </Card>
  );
}
