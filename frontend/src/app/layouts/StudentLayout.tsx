import { Link, Outlet, useNavigate } from 'react-router-dom';

import { useAuth } from '@/shared/auth/AuthProvider';
import { Badge } from '@/shared/components/ui';

/** The signed-in shell: thin top bar, centred content column. */
export function StudentLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

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
        <div className="mx-auto flex h-[52px] max-w-[1100px] items-center justify-between px-[20px]">
          <Link to="/dashboard" className="flex items-center gap-[9px]">
            <span
              aria-hidden="true"
              className="flex size-[22px] items-center justify-center rounded-[6px] bg-brand font-mono text-[11px] font-semibold text-white"
            >
              A
            </span>
            <span className="text-[13.5px] font-semibold tracking-tight">AdaptLearn</span>
          </Link>

          <div className="flex items-center gap-[12px]">
            <Badge tone="verified">Verified tutoring</Badge>
            <span
              aria-hidden="true"
              className="flex size-[26px] items-center justify-center rounded-full border border-line bg-surface-muted font-mono text-[10.5px] text-ink-muted"
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

      <main className="mx-auto max-w-[1100px] px-[20px] py-[32px]">
        <Outlet />
      </main>
    </div>
  );
}
