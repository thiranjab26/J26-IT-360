/**
 * Session state for the whole app.
 *
 * On first load, if a token is in storage, the profile is fetched from
 * /api/v1/auth/me. A rejected token clears itself in the API client, so the
 * only two states the rest of the app sees are "loading" and "resolved".
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { request } from '@/shared/api/client';
import { clearToken, getToken, setToken } from '@/shared/auth/token';

export interface UserProfile {
  user_id: string;
  email: string;
  full_name: string;
  role: 'student' | 'lecturer' | 'admin';
  student_number: string | null;
  department: string | null;
}

export interface AuthSession {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: UserProfile;
}

interface AuthContextValue {
  user: UserProfile | null;
  /** True until the stored token has been checked, so routes do not flash. */
  loading: boolean;
  signIn: (session: AuthSession) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }

    let active = true;
    request<UserProfile>('/v1/auth/me')
      .then((profile) => {
        if (active) setUser(profile);
      })
      .catch(() => {
        clearToken();
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback((session: AuthSession) => {
    setToken(session.access_token);
    setUser(session.user);
  }, []);

  const signOut = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signOut }),
    [user, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
