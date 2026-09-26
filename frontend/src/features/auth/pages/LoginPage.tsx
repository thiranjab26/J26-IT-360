import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { ApiError } from '@/shared/api/client';
import { useAuth } from '@/shared/auth/AuthProvider';
import { Banner, Button, Field } from '@/shared/components/ui';
import { login } from '../api/authApi';
import { AuthShell } from '../components/AuthShell';

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  // Where the user was headed before being sent here to sign in.
  const intended = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const session = await login(email, password);
      signIn(session);
      navigate(session.user.role === 'student' ? intended : '/dashboard', { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError(0, null, 'Could not reach the server. Is the gateway running?'),
      );
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (name: string) => (error?.field === name ? error.message : null);

  return (
    <AuthShell title="Sign in" subtitle="Continue where you left off.">
      <form onSubmit={onSubmit} className="flex flex-col gap-[16px]" noValidate>
        {error && !error.field && <Banner code={error.code} message={error.message} />}

        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldError('email')}
          placeholder="it00000000@my.sliit.lk"
        />

        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldError('password')}
        />

        <Button type="submit" busy={busy} className="mt-[4px] w-full">
          {busy ? 'Signing in' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-[20px] text-[12.5px] text-ink-muted">
        No account yet?{' '}
        <Link to="/register" className="font-medium text-brand hover:text-brand-hover">
          Create one
        </Link>
      </p>
    </AuthShell>
  );
}
