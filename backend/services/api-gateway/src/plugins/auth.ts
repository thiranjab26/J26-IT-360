import jwt from 'jsonwebtoken';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';

import { PUBLIC_PATHS, config } from '../config.ts';
import { errorBody } from '../errors.ts';

/**
 * The gateway is the only component that verifies JWTs. It replaces the
 * Authorization header with X-User-Id and X-User-Role, which every service
 * trusts (see each service's core/deps.py). A client cannot forge those headers:
 * they are stripped from the incoming request before the token is read.
 */
export function registerAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    // Adopt the caller's request id, or mint one, and propagate it downstream so
    // one request can be followed across the gateway and the services it hits.
    const requestId = (request.headers['x-request-id'] as string | undefined) ?? randomUUID();
    request.headers['x-request-id'] = requestId;
    reply.header('x-request-id', requestId);

    // Never let a client supply its own identity.
    delete request.headers['x-user-id'];
    delete request.headers['x-user-role'];

    const path = request.url.split('?')[0] ?? '';

    // Internal routes are never reachable from the browser. They exist for
    // service-to-service calls only, such as C2 pushing a load signal to C3.
    if (path.startsWith('/internal/')) {
      return reply
        .code(404)
        .send(errorBody('not_found', 'No such route.'));
    }

    if (isPublic(path)) return;

    const token = bearerToken(request);
    if (!token) {
      return reply
        .code(401)
        .send(errorBody('unauthorized', 'Authentication required.'));
    }

    try {
      const claims = jwt.verify(token, config.jwtSecret, {
        issuer: config.jwtIssuer,
        algorithms: ['HS256'],
      }) as jwt.JwtPayload;

      if (!claims.sub || typeof claims.role !== 'string') {
        return reply
          .code(401)
          .send(errorBody('invalid_token', 'The access token is missing required claims.'));
      }

      request.headers['x-user-id'] = claims.sub;
      request.headers['x-user-role'] = claims.role;
    } catch (error) {
      const expired = error instanceof jwt.TokenExpiredError;
      return reply.code(401).send(
        errorBody(
          expired ? 'token_expired' : 'invalid_token',
          expired
            ? 'Your session has expired. Please sign in again.'
            : 'The access token is invalid.',
        ),
      );
    }
  });
}

function isPublic(path: string): boolean {
  if (path === '/health' || path === '/') return true;
  // Each service's own /health, reachable as /api/v1/<service>/health.
  if (/^\/api\/v1\/[a-z-]+\/health$/.test(path)) return true;
  return PUBLIC_PATHS.includes(path);
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim();
}
