/**
 * The test kit: in-memory fakes for every adapter, data builders and a clock
 * tests can move by hand (AR-02). Test data is always built here, never copied
 * from real people (RG-07).
 *
 * The fakes arrive with the ports they stand in for (INF-05). What is here now
 * is the one thing the skeleton needs to prove: that one workspace package can
 * import another.
 */
import { API_VERSION } from '@trygghverdag/contracts';

/** The path a test should call for a route, so tests never hard-code the API version. */
export function apiPath(route: string): string {
  return `/${API_VERSION}/${route.replace(/^\/+/, '')}`;
}
