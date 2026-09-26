import { config as loadEnv } from 'dotenv';

loadEnv();

/** Public routes below the versioned prefix. Everything else needs a token. */
export const PUBLIC_PATHS = [
  '/api/v1/auth/login',
  '/api/v1/auth/register/student',
  '/api/v1/auth/register/lecturer',
];

export interface ServiceRoute {
  /** The path segment after /api/v1, which is also the service's own prefix. */
  readonly name: string;
  readonly upstream: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy backend/services/api-gateway/.env.example to .env.`,
    );
  }
  return value;
}

function upstream(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(process.env.GATEWAY_PORT ?? 8080),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  jwtSecret: required('JWT_SECRET'),
  jwtIssuer: process.env.JWT_ISSUER ?? 'adaptlearn-auth',

  services: [
    { name: 'auth', upstream: upstream('AUTH_SERVICE_URL', 'http://localhost:8001') },
    {
      name: 'curriculum',
      upstream: upstream('CURRICULUM_SERVICE_URL', 'http://localhost:8101'),
    },
    { name: 'load', upstream: upstream('LOAD_SERVICE_URL', 'http://localhost:8201') },
    { name: 'tutor', upstream: upstream('TUTOR_SERVICE_URL', 'http://localhost:8301') },
    { name: 'viva', upstream: upstream('VIVA_SERVICE_URL', 'http://localhost:8401') },
  ] satisfies ServiceRoute[],
} as const;
