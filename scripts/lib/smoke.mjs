// The staging smoke test (INF-07): after a deploy, is the safety system working?
//
// Two things must be true, and the second is the one that is easy to get wrong:
//
//   1. The API answers /v1/health.
//   2. The worker has checked in *since the deploy*.
//
// "status: ok" alone does not prove the second. The worker's last beat counts
// as fresh for three minutes, so for a while after a deploy the API says ok on
// the strength of a beat from the worker that was just stopped — while the new
// one may never have started. So the smoke test takes the database's time from
// its first answer (checkedAt) and waits for a beat more than LINGER_MS after
// that. Both stamps come from the same database clock (REL-01), so comparing
// them is fair.

const HEALTH_PATH = '/v1/health';

/**
 * How long the old instance may outlive a deploy. A beat inside this window
 * after the first answer could still be the old worker's, if the old instance
 * lingered past a minute boundary (safety-reviewer, INF-07). Ninety seconds
 * means the passing beat is at least the second one after the deploy began.
 * The lasting fix is a beat that says which worker made it; until then, this.
 */
export const LINGER_MS = 90_000;

/** The shape /v1/health answers with, or null when the body is something else. */
function asHealth(body) {
  if (
    body === null ||
    typeof body !== 'object' ||
    typeof body.status !== 'string' ||
    typeof body.checkedAt !== 'string' ||
    typeof body.worker !== 'object' ||
    body.worker === null ||
    !(typeof body.worker.lastBeatAt === 'string' || body.worker.lastBeatAt === null)
  ) {
    return null;
  }
  return body;
}

async function fetchFromNetwork(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  let body;
  try {
    body = await response.json();
  } catch {
    // Not JSON: something other than this API answered. asHealth says so.
    body = null;
  }
  return { status: response.status, body };
}

/**
 * @param {{
 *   url: string,
 *   attempts?: number,
 *   intervalMs?: number,
 *   fetchHealth?: (url: string) => Promise<{ status: number, body: unknown }>,
 *   sleep?: (ms: number) => Promise<unknown>,
 *   log?: (line: string) => void,
 * }} options
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
export async function smokeTest({
  url,
  attempts = 60,
  intervalMs = 5_000,
  fetchHealth = fetchFromNetwork,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = () => undefined,
}) {
  const endpoint = `${url}${HEALTH_PATH}`;
  let deployedBy;
  let lastSeen = 'nothing yet';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      await sleep(intervalMs);
    }

    let answer;
    try {
      answer = await fetchHealth(endpoint);
    } catch (error) {
      lastSeen = `could not reach ${endpoint}: ${error instanceof Error ? error.message : String(error)}`;
      log(`attempt ${String(attempt)}: ${lastSeen}`);
      continue;
    }

    if (answer.status !== 200) {
      lastSeen = `${endpoint} answered HTTP ${String(answer.status)}`;
      log(`attempt ${String(attempt)}: ${lastSeen}`);
      continue;
    }

    const health = asHealth(answer.body);
    if (health === null) {
      return {
        ok: false,
        reason:
          `${endpoint} answered 200, but not a health response — the address points at ` +
          'something other than this API.',
      };
    }

    deployedBy ??= health.checkedAt;
    const lastBeat = health.worker.lastBeatAt;
    if (
      health.status === 'ok' &&
      lastBeat !== null &&
      Date.parse(lastBeat) > Date.parse(deployedBy) + LINGER_MS
    ) {
      return {
        ok: true,
        reason: `The API answers, and the worker checked in at ${lastBeat}, after the deploy (${deployedBy}).`,
      };
    }

    lastSeen =
      `status ${health.status}; the worker has not checked in since the deploy ` +
      `(${deployedBy}); its last beat was ${lastBeat ?? 'never'}`;
    log(`attempt ${String(attempt)}: ${lastSeen}`);
  }

  return { ok: false, reason: `Staging is not working after the deploy. Last seen: ${lastSeen}.` };
}
