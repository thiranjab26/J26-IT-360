import { request } from '@/shared/api/client';
import type { AuthSession } from '@/shared/auth/AuthProvider';

export interface StudentRegistration {
  email: string;
  password: string;
  full_name: string;
  student_number: string;
}

export interface LecturerRegistration {
  email: string;
  password: string;
  full_name: string;
  department?: string;
}

export function login(email: string, password: string): Promise<AuthSession> {
  return request<AuthSession>('/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    anonymous: true,
  });
}

export function registerStudent(payload: StudentRegistration): Promise<AuthSession> {
  return request<AuthSession>('/v1/auth/register/student', {
    method: 'POST',
    body: payload,
    anonymous: true,
  });
}

export function registerLecturer(payload: LecturerRegistration): Promise<AuthSession> {
  return request<AuthSession>('/v1/auth/register/lecturer', {
    method: 'POST',
    body: payload,
    anonymous: true,
  });
}
