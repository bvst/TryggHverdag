/**
 * The HTTP API (AR-01: one of the two processes).
 *
 * Hono holds the server; oRPC implements the contract from
 * `packages/contracts`, so the routes cannot drift from the schemas the app
 * was built against (AR-07).
 *
 * `createApi` takes its dependencies rather than building them, so a system
 * test can run the whole API in-process against fakes and a clock it controls
 * (L6) — which is where the alert behaviour will be proven in M2.
 */
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { implement } from '@orpc/server';
import { API_PREFIX, contract } from '@trygghverdag/contracts';
import { Hono } from 'hono';
import type { HealthService } from './modules/health/service.ts';

export interface ApiDependencies {
  health: HealthService;
}

export function createApi({ health }: ApiDependencies): Hono {
  const os = implement(contract);

  const router = os.router({
    health: os.health.handler(() => health.check()),
  });

  const handler = new OpenAPIHandler(router);
  const app = new Hono();

  app.all('/*', async (context) => {
    const { matched, response } = await handler.handle(context.req.raw, {
      prefix: API_PREFIX,
      context: {},
    });

    if (matched) {
      return response;
    }
    return context.notFound();
  });

  return app;
}
