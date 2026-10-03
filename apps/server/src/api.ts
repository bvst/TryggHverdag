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
 *
 * Every request but a health check comes from a known device (SEC-07). The
 * credential is checked first, before the body is even validated, so an
 * unknown caller learns nothing about what a valid request looks like; and
 * the walker of any journey a device starts is that device's own user, so no
 * field in a request can name anyone else. A journey records the device that
 * started it, and takes heartbeats from that device only (D-101).
 *
 * No answer carries anything of the request. Every 400 is one fixed body, see
 * BAD_REQUEST_BODY below, and every other answer is a fixed shape.
 */
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { implement, ORPCError } from '@orpc/server';
import {
  API_PREFIX,
  contract,
  deviceCredentialErrors,
  heartbeatErrors,
} from '@trygghverdag/contracts';
import { Hono } from 'hono';
import type { HealthService } from './modules/health/service.ts';
import type { JourneyService } from './modules/journeys/service.ts';
import type { DeviceAuthenticator } from './ports.ts';

export interface ApiDependencies {
  health: HealthService;
  journeys: JourneyService;
  devices: DeviceAuthenticator;
}

/** What a request brings in besides its body: only what the credential check reads. */
interface RequestContext {
  authorization: string | undefined;
}

/**
 * `Authorization: Bearer <credential>`. Anything else — no header, an empty
 * one, another scheme, `Bearer` with nothing after it — is no credential at
 * all. The scheme's name is case-insensitive (RFC 7235); the credential is not.
 */
const BEARER = /^Bearer (\S+)$/i;

/**
 * The one body every 400 carries, on every route: the code, the status and a
 * fixed message, and never `data`.
 *
 * oRPC puts the validator's issues in a 400's `data`, and zod's issue for an
 * unknown key names the key. So a heartbeat holding a `background_geolocation`
 * key would have been answered with that key in the body: an echo the
 * location SDK could take for a command of its own (04b-spike-results.md
 * §4.5). A body that is not JSON at all gets a 400 of its own words before
 * any procedure runs. Both are replaced here, where an error becomes a body,
 * so no 400 can hold anything the request held, whichever check refused it.
 *
 * Both device routes declare this 400 with these words (heartbeatErrors and
 * startJourneyErrors); before LOST-01, the start route's 400 also carried
 * `data`, which no caller read.
 */
const BAD_REQUEST_BODY = new ORPCError('BAD_REQUEST', {
  defined: true,
  status: heartbeatErrors.BAD_REQUEST.status,
  message: heartbeatErrors.BAD_REQUEST.message,
}).toJSON();

export function createApi({ health, journeys, devices }: ApiDependencies): Hono {
  const os = implement(contract).$context<RequestContext>();

  /**
   * Every route is built from this except health, so a route added later is
   * authenticated unless someone builds it from `os` on purpose — and the
   * system test that calls every route in the contract without a credential
   * fails if they do.
   *
   * One 401 for every cause, so it says nothing about which check failed. A
   * check that cannot run is not one of those causes: the authenticator
   * rejects, and that goes on as a 500. A 401 tells an app its credential is
   * bad, and a database that blinked must never sign a walker out.
   *
   * The credential itself is passed to the authenticator and to nothing else:
   * it is never logged, and never part of an answer. Past this point the
   * header is gone from the context: handlers get the device, and
   * `authorization` is undefined, so none can read the credential.
   */
  const fromKnownDevice = os.use(async ({ context, next }) => {
    const credential = BEARER.exec(context.authorization ?? '')?.[1];
    const device = credential === undefined ? null : await devices.authenticate(credential);
    if (device === null) {
      throw new ORPCError('UNAUTHORIZED', { message: deviceCredentialErrors.UNAUTHORIZED.message });
    }
    return next({ context: { device, authorization: undefined } });
  });

  const router = os.router({
    // The one public route: uptime monitors and the platform's deploy check
    // call it, they are not devices, and it carries no personal data.
    health: os.health.handler(() => health.check()),

    startJourney: fromKnownDevice.startJourney.handler(async ({ input, context, errors }) => {
      const result = await journeys.start({
        walkerId: context.device.userId,
        deviceId: context.device.deviceId,
        responderIds: input.responderIds,
      });
      if (result.type === 'started') {
        return result.journey;
      }
      switch (result.reason) {
        case 'ALREADY_ON_A_JOURNEY':
          throw errors.ALREADY_ON_A_JOURNEY({ data: { journeyId: result.journeyId } });
        case 'INVALID_RESPONDER':
          throw errors.INVALID_RESPONDER();
        case 'NO_RESPONDER':
          throw errors.NO_RESPONDER();
      }
    }),

    // LOST-01. The walker is the device's own user and the device is the one
    // that sent it; the body names only the journey. A 200 means the server
    // has the event, so the phone may drop it.
    recordHeartbeat: fromKnownDevice.recordHeartbeat.handler(async ({ input, context, errors }) => {
      const result = await journeys.heartbeat({
        walkerId: context.device.userId,
        deviceId: context.device.deviceId,
        heartbeat: input,
      });
      switch (result.type) {
        case 'recorded':
          return { outcome: 'RECORDED' };
        case 'duplicate':
          return { outcome: 'DUPLICATE' };
        case 'ignored':
        case 'refused':
          // Each reason the rule gives is the contract's code for it:
          // JOURNEY_ENDED (409), JOURNEY_NOT_FOUND (404) and
          // NOT_THE_JOURNEYS_DEVICE (403).
          throw errors[result.reason]();
      }
    }),
  });

  const handler = new OpenAPIHandler(router, {
    customErrorResponseBodyEncoder: (error) =>
      error.status === BAD_REQUEST_BODY.status ? BAD_REQUEST_BODY : undefined,
  });
  const app = new Hono();

  app.all('/*', async (context) => {
    const { matched, response } = await handler.handle(context.req.raw, {
      prefix: API_PREFIX,
      context: { authorization: context.req.header('authorization') },
    });

    if (matched) {
      return response;
    }
    return context.notFound();
  });

  return app;
}
