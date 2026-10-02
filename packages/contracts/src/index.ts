/**
 * The one shared contract between app and server (AR-07).
 *
 * Schemas are defined here and nowhere else: the server validates with them,
 * the app's client is typed from them, and the OpenAPI description is generated
 * from them. That is what stops app and server from drifting apart without
 * anyone noticing.
 *
 * This file only re-exports. Nothing inside the package imports it, because a
 * module that imported its own entry point would form a cycle — and a cycle
 * here is not a style complaint. It bit exactly once: `openapi.ts` read
 * `API_PREFIX` from this file at module scope, Node happened to evaluate it in
 * an order that worked, Vitest did not, and the published description quietly
 * lost its version and said routes live "under undefined". The import rule
 * `no-circular` is what catches the next one.
 */

export { API_PREFIX, API_VERSION } from './api-version.ts';
export { contract } from './contract.ts';
export { deviceCredentialErrors } from './device-credential.ts';
export { health, healthResponseSchema, WORKER_STALE_AFTER_MS } from './health.ts';
export type { HealthResponse } from './health.ts';
export {
  MAX_RESPONDERS,
  startJourney,
  startJourneyErrors,
  startJourneyRequestSchema,
  startJourneyResponseSchema,
} from './journeys.ts';
export type {
  StartJourneyErrorCode,
  StartJourneyRequest,
  StartJourneyResponse,
} from './journeys.ts';
export { openApiDocument, openApiJson, OPENAPI_INFO } from './openapi.ts';
