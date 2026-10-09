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
 * credential is checked before the body is validated against the route's
 * schema, so an unknown caller learns nothing about what a valid request
 * looks like. oRPC decodes the body before the credential check runs (in
 * @orpc/server 1.15.3's StandardHandler, `decode_input` comes before
 * `call_procedure`, which runs the middleware), so a body that is not JSON at
 * all is answered with the fixed 400 even without a credential: that answer
 * holds nothing of the request either. The walker of any journey a device
 * starts is that device's own user, so no field in a request can name anyone
 * else. A journey records the device that started it, and takes heartbeats
 * from that device only (D-101).
 *
 * No answer carries anything of the request. Every BAD_REQUEST is one fixed
 * body, see BAD_REQUEST_BODY below, and every other answer is a fixed shape.
 */
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { implement, ORPCError } from '@orpc/server';
import {
  API_PREFIX,
  badRequestError,
  contract,
  deviceCredentialErrors,
} from '@trygghverdag/contracts';
import { Hono } from 'hono';
import type { AcknowledgementService } from './modules/alerts/acknowledgement.ts';
import type { ClosureService } from './modules/alerts/closure.ts';
import type { HealthService } from './modules/health/service.ts';
import type { JourneyService } from './modules/journeys/service.ts';
import type { DeviceAuthenticator } from './ports.ts';

export interface ApiDependencies {
  health: HealthService;
  journeys: JourneyService;
  devices: DeviceAuthenticator;
  acknowledgements: AcknowledgementService;
  closures: ClosureService;
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
 * The one body every BAD_REQUEST carries, on every route: the code, the
 * status and a fixed message, and never `data`.
 *
 * oRPC puts the validator's issues in a 400's `data`, and zod's issue for an
 * unknown key names the key. So a heartbeat holding a `background_geolocation`
 * key would have been answered with that key in the body: an echo the
 * location SDK could take for a command of its own (04b-spike-results.md
 * §4.5). A body that is not JSON at all gets a 400 of its own words before
 * any procedure runs. Both are BAD_REQUEST, and both are replaced here, where
 * an error becomes a body, so no 400 can hold anything the request held,
 * whichever check refused it.
 *
 * Built from the contract's `badRequestError`, the one object the error map
 * of every route with a body declares as its 400, so this body and the
 * published contract cannot drift apart.
 *
 * A 400's error object holds the device credential (LOST-03). With detailed
 * input, as the "I'm home", "I'm on it" and "They're safe" routes have, oRPC
 * puts the whole input it validated
 * in the validation error's `cause.data`, `request.headers` included, so the
 * `Authorization` header is there (read in @orpc/openapi 1.15.3's detailed
 * decode and @orpc/server 1.15.3's `validateInput`). Nothing prints that
 * object today: the answer is this fixed body, and no log event has a field
 * for it. So nothing may log, echo or rethrow outward a 400's error or its
 * cause (PRIV-07, SEC-07).
 */
const BAD_REQUEST_BODY = new ORPCError('BAD_REQUEST', {
  defined: true,
  status: badRequestError.status,
  message: badRequestError.message,
}).toJSON();

export function createApi({
  health,
  journeys,
  devices,
  acknowledgements,
  closures,
}: ApiDependencies): Hono {
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

    // "I'm home" (SM-04, D-110). The journey is the path's, and only the
    // path's: the input is detailed, so the body cannot name another. Only the
    // device that started it may end it. A 200 and a 409 both mean the
    // journey is over.
    reportHome: fromKnownDevice.reportHome.handler(async ({ input, context, errors }) => {
      const result = await journeys.home({
        walkerId: context.device.userId,
        deviceId: context.device.deviceId,
        journeyId: input.params.journeyId,
      });
      switch (result.type) {
        case 'ended':
          return { outcome: 'ENDED' };
        case 'ignored':
        case 'refused':
          // As for a heartbeat: JOURNEY_ENDED (409), JOURNEY_NOT_FOUND (404)
          // and NOT_THE_JOURNEYS_DEVICE (403).
          throw errors[result.reason]();
      }
    }),

    // "I'm on it" (LOST-06, D-114). The responder is the device's own user,
    // from any of their devices; the alert is the path's, and only the
    // path's, as the input is detailed. A 200 means the caller is the one on
    // it. No answer says who is.
    acknowledgeAlert: fromKnownDevice.acknowledgeAlert.handler(
      async ({ input, context, errors }) => {
        const result = await acknowledgements.acknowledge({
          responderId: context.device.userId,
          alertId: input.params.alertId,
        });
        if (result.type === 'acknowledged') {
          return { outcome: 'ACKNOWLEDGED' };
        }
        // Each reason the rule gives is the contract's code for it:
        // ALERT_NOT_FOUND (404), ALREADY_ACKNOWLEDGED (409) and
        // ALERT_RESOLVED (409).
        throw errors[result.reason]();
      },
    ),

    // "They're safe" (LOST-08, D-126). The responder is the device's own
    // user, from any of their devices; the alert is the path's, and only the
    // path's, as the input is detailed. A 200 means the caller closed it now;
    // a 409 that it is over. No answer says who is on it or who closed it.
    closeAlert: fromKnownDevice.closeAlert.handler(async ({ input, context, errors }) => {
      const result = await closures.close({
        responderId: context.device.userId,
        alertId: input.params.alertId,
      });
      if (result.type === 'closed') {
        return { outcome: 'CLOSED' };
      }
      // Each reason the rule gives is the contract's code for it:
      // NOT_THE_ACKNOWLEDGER (403), ALERT_NOT_FOUND (404) and
      // ALERT_RESOLVED (409).
      throw errors[result.reason]();
    }),
  });

  const handler = new OpenAPIHandler(router, {
    // Keyed on the code, not the status: a route that later defines a 400 of
    // its own, with its own code, keeps its own body.
    customErrorResponseBodyEncoder: (error) =>
      error.code === BAD_REQUEST_BODY.code ? BAD_REQUEST_BODY : undefined,
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
