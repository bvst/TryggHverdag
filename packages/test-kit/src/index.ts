/**
 * The test kit: in-memory fakes for every adapter, data builders and a clock
 * tests can move by hand (AR-02). Test data is always built here, never copied
 * from real people (RG-07).
 *
 * Nothing here imports the server. The fakes match the server's ports by shape
 * rather than by import, so the test kit stays usable from the app as well and
 * cannot drag server code into a test bundle.
 */
import { API_VERSION } from '@trygghverdag/contracts';

export { fakeClock } from './fake-clock.ts';
export type { FakeClock } from './fake-clock.ts';
export { BEAT_RECORDED, fakeWorkerHeartbeats } from './fake-worker-heartbeats.ts';
export type { FakeWorkerHeartbeats } from './fake-worker-heartbeats.ts';
export { CHECKED_IN, fakeCheckIn } from './fake-check-in.ts';
export type { FakeCheckIn } from './fake-check-in.ts';
export { SYNTHETIC_CHECK_UUID, SYNTHETIC_PING_URL } from './ping-url.ts';
export { CREDENTIAL_BYTES, syntheticCredential, syntheticUuid } from './synthetic-ids.ts';
export { fakeDeviceAuthenticator } from './fake-device-authenticator.ts';
export type {
  AuthenticatedDevice,
  FakeDeviceAuthenticator,
  RegisteredDevice,
} from './fake-device-authenticator.ts';
export { fakeJourneyStore } from './fake-journey-store.ts';
export type {
  FakeJourneyState,
  FakeJourneyStore,
  InsertStartedResult,
  JourneyStoreCall,
  StartedJourney,
  StoredJourney,
  UnendedJourneyState,
} from './fake-journey-store.ts';
export { JOURNEY_STORE_BEHAVIOUR, RACE_ROUNDS, RACERS } from './journey-store-behaviour.ts';
export { ADMIN_SHUTDOWN, endTestPool } from './end-test-pool.ts';
export type { EndablePool } from './end-test-pool.ts';
export { fakePostgres } from './fake-postgres.ts';
export type {
  FakePostgres,
  FakePostgresAnswer,
  FakePostgresConnection,
  FakePostgresHandler,
  FakePostgresQuery,
} from './fake-postgres.ts';
export type {
  JourneyAsStored,
  JourneyStoreBehaviour,
  JourneyStoreUnderTest,
} from './journey-store-behaviour.ts';

/**
 * fast-check, for the rules about time and order that no list of examples can
 * cover: "for any sequence of events, …" (D-039). Handed out here so that every
 * package's tests reach it the same way they reach the fakes.
 */
export * as fc from 'fast-check';

/** The path a test should call for a route, so tests never hard-code the API version. */
export function apiPath(route: string): string {
  return `/${API_VERSION}/${route.replace(/^\/+/, '')}`;
}
