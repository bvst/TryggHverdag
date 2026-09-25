/**
 * Synthetic Healthchecks.io ping data for tests (INF-08, RG-07).
 *
 * A real ping URL is a secret: anyone holding it can keep a check green while
 * the worker is dead. And a request from a test to a real one would tell that
 * check the worker is alive. So tests never hold a real one, and this is the
 * one place their stand-in is defined.
 */

/** A check UUID of all zeros: well formed, and naming no real check. */
export const SYNTHETIC_CHECK_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * A ping URL the worker accepts: https, as a real one is. On the loopback
 * address and port 1, which fetch refuses to connect to at all, so whatever
 * reaches for it — a fake, an injected fetch, or the real adapter — nothing
 * leaves the machine.
 */
export const SYNTHETIC_PING_URL = `https://127.0.0.1:1/${SYNTHETIC_CHECK_UUID}`;
