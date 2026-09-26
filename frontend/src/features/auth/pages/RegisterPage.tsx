import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError } from '@/shared/api/client';
import { useAuth } from '@/shared/auth/AuthProvider';
import { Banner, Button, Field } from '@/shared/components/ui';
import { registerLecturer, registerStudent } from '../api/authApi';
import { AuthShell } from '../components/AuthShell';
import { RoleTabs, type AccountRole } from '../components/RoleTabs';

export function RegisterPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const [role, setRole] = useState<AccountRole>('student');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [department, setDepartment] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // The role is the endpoint, not a field in the body: a student form can
      // never create a lecturer account.
      const session =
        role === 'student'
          ? await registerStudent({
              email,
              password,
              full_name: fullName,
              student_number: studentNumber,
            })
          : await registerLecturer({
              email,
              password,
              full_name: fullName,
              department: department.trim() || undefined,
            });

      signIn(session);
      navigate('/dashboard', { replace: true });
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

  // 422 responses carry a map of field messages; 409 carries a single field.
  const validationFields = (error?.details.fields ?? null) as Record<string, string> | null;
  const fieldError = (name: string) =>
    validationFields?.[name] ?? (error?.field === name ? error.message : null);
  const generalError = error && !error.field && !validationFields ? error : null;

  return (
    <AuthShell title="Create your account" subtitle="One account, one role. Choose yours.">
      <form onSubmit={onSubmit} className="flex flex-col gap-[16px]" noValidate>
        <RoleTabs value={role} onChange={setRole} disabled={busy} />

        {generalError && <Banner code={generalError.code} message={generalError.message} />}

        <Field
          label="Full name"
          name="full_name"
          autoComplete="name"
          required
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          error={fieldError('full_name')}
        />

        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldError('email')}
          placeholder={role === 'student' ? 'it00000000@my.sliit.lk' : 'name@sliit.lk'}
        />

        {role === 'student' ? (
          <Field
            label="Student number"
            name="student_number"
            required
            value={studentNumber}
            onChange={(event) => setStudentNumber(event.target.value)}
            error={fieldError('student_number')}
            placeholder="IT00000000"
          />
        ) : (
          <Field
            label="Department"
            name="department"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            error={fieldError('department')}
            hint="Optional"
            placeholder="Information Technology"
          />
        )}

        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldError('password')}
          hint="At least 8 characters"
        />

        <Button type="submit" busy={busy} className="mt-[4px] w-full">
          {busy ? 'Creating account' : `Create ${role} account`}
        </Button>
      </form>

      <p className="mt-[20px] text-[12.5px] text-ink-muted">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-brand hover:text-brand-hover">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
