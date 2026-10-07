/**
 * The worker's check-in with Healthchecks.io (INF-08, REL-08): one ping each
 * minute the watchdog's beat is fresh. A check that stops getting pings pages
 * the owner.
 *
 * And the SMS check's alarm (LOST-07, D-115), on a check of its own: `ok` is
 * a ping to its URL as configured, `failing` a ping to that URL with `/fail`
 * added to its path, Healthchecks.io's failure signal, which pages the owner
 * at once. Both are sent exactly as the check-in is.
 *
 * One request, no body, no retry: the next minute's beat is the retry, and a
 * retry loop is how a worker would reach Healthchecks.io's rate limit. Only a
 * 2xx answer counts; anything else rejects.
 *
 * The ping URL is a secret — anyone holding it can keep the check green while
 * the worker is dead — so no error from here carries it. Node's fetch puts the
 * whole URL in some of its errors ("Failed to parse URL from …"), so those are
 * never passed on, not even as a cause: each failure is a new Error, built only
 * from words chosen here.
 */
import type { CheckIn, SmsAlarm } from '../ports.ts';

/** How long a check-in waits for an answer before it counts as failed. */
export const CHECK_IN_TIMEOUT_MS = 10_000;

export function healthchecksCheckIn({
  url,
  fetch: send = fetch,
  timeoutMs = CHECK_IN_TIMEOUT_MS,
}: {
  url: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): CheckIn {
  // Not parsed here: new URL() would throw with the value in its message, and
  // would do it at start-up, where a monitoring setting must never stop the
  // worker.
  return {
    checkIn: (signal?: AbortSignal) =>
      ping({ url, fail: false, send, timeoutMs, signal, what: 'check-in' }),
  };
}

/**
 * The SMS check's alarm (LOST-07): `ok` to the check's ping URL as
 * configured, `failing` to the same URL with `/fail` added to its path, so a
 * query stays after it and a trailing slash is not doubled. One request
 * each, sent as a check-in is.
 */
export function healthchecksAlarm({
  url,
  fetch: send = fetch,
  timeoutMs = CHECK_IN_TIMEOUT_MS,
}: {
  url: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): SmsAlarm {
  return {
    report: (status: 'ok' | 'failing', signal?: AbortSignal) =>
      ping({
        url,
        fail: status === 'failing',
        send,
        timeoutMs,
        signal,
        what: 'report',
      }),
  };
}

/**
 * One ping, to the URL or, with `fail`, to its failure signal: resolves when
 * Healthchecks.io accepted it, and rejects, in words chosen here, on anything
 * else.
 */
async function ping({
  url,
  fail,
  send,
  timeoutMs,
  signal,
  what,
}: {
  url: string;
  fail: boolean;
  send: typeof fetch;
  timeoutMs: number;
  signal: AbortSignal | undefined;
  what: string;
}): Promise<void> {
  // Its own timeout, and the caller's signal when there is one: the worker
  // hands on Graphile's, which aborts when the worker stops, so a stop never
  // waits for a Healthchecks.io that does not answer (D-079).
  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    // HEAD: Healthchecks.io counts it as a ping, and there is no body to
    // send or to read. The timer is a network timeout, not a safety
    // decision, so it is not the database clock's to keep (AR-03).
    // redirect 'manual': the URL goes nowhere but where it was set. A
    // followed redirect would count whatever answered elsewhere as a
    // ping, and could carry the URL there in clear; so a 3xx comes back as
    // it is and fails below, naming its status.
    // The failure address is built in here, so a URL that does not parse
    // fails as any unreachable address does, in words chosen here.
    response = await send(fail ? failureAddress(url) : url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
  } catch (error: unknown) {
    throw notReached(error, timeoutMs, signal, what);
  }
  if (!response.ok) {
    throw new Error(`Healthchecks.io answered ${String(response.status)}.`);
  }
}

/**
 * Healthchecks.io's failure signal for a check: /fail on the URL's own path,
 * with any trailing slash dropped, before any query. Throws for a URL that is
 * not one; `ping` rewords that.
 */
function failureAddress(url: string): string {
  const address = new URL(url);
  address.pathname = `${address.pathname.replace(/\/$/, '')}/fail`;
  return address.href;
}

/**
 * Why a ping got no answer, in words chosen here. Ended by the caller's
 * signal, it was the worker stopping, and is said as that, so whoever reads
 * the log does not go looking for a network fault. Otherwise a timeout, or an
 * address that could not be reached.
 */
function notReached(
  error: unknown,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  what: string,
): Error {
  if (signal?.aborted === true) {
    return new Error(`Healthchecks.io ${what} cancelled: the worker is stopping.`);
  }
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new Error(`Healthchecks.io did not answer within ${String(timeoutMs)} ms.`);
  }
  const code = codeOf(error);
  return new Error(
    `Healthchecks.io could not be reached${code === undefined ? '' : ` (${code})`}.`,
  );
}

/**
 * Why fetch failed, as its cause's code (ECONNREFUSED, ENOTFOUND, …). Only a
 * bare identifier is kept: a URL cannot pass for one, so nothing else can
 * leak through it.
 */
function codeOf(error: unknown): string | undefined {
  const cause = error instanceof Error ? error.cause : undefined;
  const code = cause instanceof Error && 'code' in cause ? cause.code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : undefined;
}
