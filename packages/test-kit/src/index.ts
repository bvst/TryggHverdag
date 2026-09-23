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
export { fakeWorkerHeartbeats } from './fake-worker-heartbeats.ts';
export type { FakeWorkerHeartbeats } from './fake-worker-heartbeats.ts';

/** The path a test should call for a route, so tests never hard-code the API version. */
export function apiPath(route: string): string {
  return `/${API_VERSION}/${route.replace(/^\/+/, '')}`;
}
