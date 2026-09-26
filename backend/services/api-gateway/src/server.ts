import Fastify from 'fastify';
import cors from '@fastify/cors';

import { config } from './config.ts';
import { errorBody } from './errors.ts';
import { registerAuth } from './plugins/auth.ts';
import { registerProxies } from './routes/proxy.ts';

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Match the services' JSON log shape so one request id links them all.
      formatters: { level: (label) => ({ level: label }) },
    },
    // The gateway forwards the body untouched; parsing it here would only add
    // a failure mode and break file uploads later.
    disableRequestLogging: false,
    trustProxy: true,
  });

  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });

  registerAuth(app);

  app.get('/health', async () => ({
    status: 'ok',
    services: config.services.map((service) => service.name),
  }));

  await registerProxies(app);

  app.setNotFoundHandler(async (request, reply) =>
    reply.code(404).send(
      errorBody('not_found', `No route for ${request.method} ${request.url}.`),
    ),
  );

  return app;
}

const app = await buildServer();

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
