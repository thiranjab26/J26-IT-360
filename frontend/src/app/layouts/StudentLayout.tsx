import { NavLink, Link, Outlet, useNavigate } from 'react-router-dom';

import { useModules } from '@/features/tutor';
import { useAuth } from '@/shared/auth/AuthProvider';
import { cx } from '@/shared/components/ui';

/**
 * The signed-in shell, following the VeriTutor mockups: brand, section tabs,
 * the current module as a pill, and the learner's avatar.
 *
 * Practicals and Course material have no screens yet, so they render as
 * disabled tabs rather than links to nowhere.
 */
export function StudentLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { data: modules } = useModules();

  const current = modules?.find((module) => module.status === 'available');

  function onSignOut() {
    signOut();
    navigate('/login', { replace: true });
  }

  const initials =
    user?.full_name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') ?? '?';

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-[54px] max-w-[1180px] items-center justify-between gap-[16px] px-[20px]">
          <div className="flex items-center gap-[22px]">
            <Link to="/dashboard" className="flex items-center gap-[9px]">
              <span
                aria-hidden="true"
                className="flex size-[22px] items-center justify-center rounded-[6px] bg-brand font-mono text-[11px] font-semibold text-white"
              >
                V
              </span>
              <span className="text-[13.5px] font-semibold tracking-tight">VeriTutor</span>
            </Link>

            <nav aria-label="Sections" className="hidden items-center gap-[4px] sm:flex">
              {current && <Tab to={`/modules/${current.module_id}`}>Quest Map</Tab>}
              <Tab to="/dashboard">Modules</Tab>
              <DisabledTab>Practicals</DisabledTab>
              <DisabledTab>Course material</DisabledTab>
            </nav>
          </div>

          <div className="flex items-center gap-[12px]">
            {current && (
              <span className="hidden max-w-[260px] truncate rounded-full border border-line bg-surface-muted px-[11px] py-[4px] font-mono text-[10.5px] text-ink-muted md:inline">
                {current.name}
              </span>
            )}
            <span
              aria-hidden="true"
              className="flex size-[28px] items-center justify-center rounded-full border border-line bg-surface-muted font-mono text-[10.5px] text-ink-muted"
              title={user?.full_name}
            >
              {initials}
            </span>
            <button
              type="button"
              onClick={onSignOut}
              className="text-[12px] text-ink-muted hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-[20px] py-[30px]">
        <Outlet />
      </main>
    </div>
  );
}

const TAB = 'relative px-[10px] py-[17px] text-[13px] transition-colors';

function Tab({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cx(
          TAB,
          isActive
            ? 'font-medium text-ink after:absolute after:inset-x-[10px] after:bottom-0 after:h-[2px] after:bg-brand'
            : 'text-ink-muted hover:text-ink',
        )
      }
    >
      {children}
    </NavLink>
  );
}

function DisabledTab({ children }: { children: string }) {
  return (
    <span
      aria-disabled="true"
      title="Coming soon"
      className={cx(TAB, 'cursor-not-allowed text-ink-faint')}
    >
      {children}
    </span>
  );
}
