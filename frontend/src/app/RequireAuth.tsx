import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '@/shared/auth/AuthProvider';

/**
 * Gate for every authenticated route. While the stored token is being checked
 * it renders nothing, so a signed-in user never sees the login screen flash.
 */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageLoading />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

function FullPageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <span
        aria-label="Loading"
        className="size-[18px] animate-spin rounded-full border-2 border-line-strong border-t-brand"
      />
    </div>
  );
}
