import fastifyProxy from '@fastify/http-proxy';
import type { FastifyInstance } from 'fastify';

import { config } from '../config.ts';
import { errorBody } from '../errors.ts';

/**
 * One proxy per service, mounted at the service's own route prefix so the path
 * the browser calls is the path the service sees: /api/v1/tutor/sessions is
 * /api/v1/tutor/sessions upstream too.
 *
 * Nobody runs the whole platform locally, so a service being down is the normal
 * case rather than an incident: it answers 503 with a message naming the
 * service and the command to start it.
 */
export async function registerProxies(app: FastifyInstance): Promise<void> {
  for (const service of config.services) {
    const prefix = `/api/v1/${service.name}`;

    await app.register(fastifyProxy, {
      upstream: service.upstream,
      prefix,
      rewritePrefix: prefix,
      // Forwarded to the upstream: the identity the gateway resolved.
      replyOptions: {
        rewriteRequestHeaders: (_request, headers) => headers,
        onError: (reply, { error }) => {
          reply.log.warn(
            { service: service.name, upstream: service.upstream, err: error.message },
            'upstream unavailable',
          );
          reply.code(503).send(
            errorBody(
              'service_unavailable',
              `The ${service.name} service is not responding. Start it with: ` +
                `uv run uvicorn app.main:app --reload --port ${portOf(service.upstream)}`,
              { service: service.name },
            ),
          );
        },
      },
    });
  }
}

function portOf(upstream: string): string {
  try {
    return new URL(upstream).port || '80';
  } catch {
    return '?';
  }
}
