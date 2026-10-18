import { NavLink, Link, Outlet, useNavigate } from 'react-router-dom';

import { PlayerHud, SoundToggle, useModules } from '@/features/tutor';
import { useAuth } from '@/shared/auth/AuthProvider';
import { cx } from '@/shared/components/ui';

/**
 * The signed-in shell, following the VeriTutor mockups: brand, section tabs,
 * the current module as a pill, and the learner's avatar.
 *
 * Course material has no screen yet, so it renders as
 * disabled tabs rather than links to nowhere.
 */
export function StudentLayout() {
  const { user, signOut } = useAuth();
  const lecturer = user?.role === 'lecturer';
  const navigate = useNavigate();
  const { data: modules } = useModules();

  const current = modules?.find((module) => module.status === 'available');

  function onSignOut() {
    signOut();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-[58px] max-w-[1180px] items-center justify-between gap-[16px] px-[20px]">
          <div className="flex items-center gap-[22px]">
            <Link to="/dashboard" className="flex items-center gap-[9px]">
              <span
                aria-hidden="true"
                className="flex size-[26px] items-center justify-center rounded-[8px] bg-gradient-to-br from-brand to-violet font-mono text-[12px] font-bold text-white shadow-[0_0_14px_oklch(0.68_0.19_275/0.6)]"
              >
                A
              </span>
              <span className="text-[14px] font-bold tracking-tight">AdaptLearn</span>
            </Link>

            <nav aria-label="Sections" className="hidden items-center gap-[4px] sm:flex">
              {current && <Tab to={`/modules/${current.module_id}`}>Quest Map</Tab>}
              <Tab to="/dashboard">Modules</Tab>
              {lecturer ? (
                <Tab to="/studio">Practical studio</Tab>
              ) : (
                <>
                  <Tab to="/profile">Profile</Tab>
                  <Tab to="/practicals">Practicals</Tab>
                </>
              )}
              <DisabledTab>Course material</DisabledTab>
            </nav>
          </div>

          <div className="flex items-center gap-[12px]">
            <PlayerHud />
            <SoundToggle />
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
            ? 'font-semibold text-ink after:absolute after:inset-x-[10px] after:bottom-0 after:h-[3px] after:rounded-t-full after:bg-gradient-to-r after:from-brand after:to-violet after:shadow-[0_0_10px_oklch(0.68_0.19_275/0.8)]'
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
