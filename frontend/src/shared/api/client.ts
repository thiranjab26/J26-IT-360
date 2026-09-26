/**
 * The only place the app talks to the network.
 *
 * Base URL is always /api, which the Vite dev proxy forwards to the gateway.
 * The browser never addresses a service directly: architecture rule 2.
 */
import { clearToken, getToken } from '@/shared/auth/token';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

/** A failed request, carrying the service's own error code and field details. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error?.code ?? 'unknown_error';
    this.details = body?.error?.details ?? {};
  }

  /** The form field this error belongs to, when the service named one. */
  get field(): string | null {
    const field = this.details.field;
    return typeof field === 'string' ? field : null;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header, for login and registration. */
  anonymous?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, anonymous = false } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (!anonymous) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    // An expired or rejected token means the stored session is useless; drop it
    // so the router sends the user to the login screen instead of looping.
    if (response.status === 401 && !anonymous) clearToken();
    throw new ApiError(response.status, payload as ApiErrorBody | null, response.statusText);
  }

  return payload as T;
}
