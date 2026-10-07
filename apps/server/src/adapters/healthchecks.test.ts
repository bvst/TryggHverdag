// INF-08, serving REL-08: the worker's check-in with Healthchecks.io.
//
// A check that stops getting pings pages the owner; that is the whole of the
// worker's monitoring. So the adapter has two jobs. It must count as success
// only what Healthchecks.io counts as success — a 2xx answer — and nothing that
// merely looks like one. And it must never let the ping URL out: anyone who has
// it can keep the check green while the worker is dead.
//
// No test here sends anything to hc-ping.com, and none could, even through an
// adapter that ignored the fetch it was handed: a ping from a test would tell a
// real check that the worker is alive. What is fetched is a stand-in server on
// the loopback address, or port 1 there, which fetch refuses to connect to.
import {
  SYNTHETIC_CHECK_UUID as CHECK,
  SYNTHETIC_PING_URL as PING_URL,
} from '@trygghverdag/test-kit';
import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';
import { CHECK_IN_TIMEOUT_MS, healthchecksAlarm, healthchecksCheckIn } from './healthchecks.ts';

// CHECK is the path of a ping URL, the check's UUID: all zeros, so it names no
// real check. PING_URL is for the tests that hand the adapter a fetch of their
// own: https, like a real ping URL, but port 1 on the loopback address, so
// nothing leaves this machine even if the adapter reached past that fetch for
// the real one. Both come from the test kit, where test data is built.
//
// LOST-07 adds the SMS check's alarm (AC11): its own check, the same rules.
// `ok` is a HEAD to the check's ping URL and `failing` a HEAD to that URL with
// /fail appended, Healthchecks.io's failure signal; only a 2xx counts, no
// redirect is followed, a stop aborts a report in flight, and no error holds
// the URL.

/** How a stand-in Healthchecks.io answers: a status, never at all, or by hanging up. */
type Answer = number | 'never' | 'hang up';

interface Received {
  method: string | undefined;
  path: string | undefined;
  bodyBytes: number;
  headers: IncomingHttpHeaders;
}

const servers: { close: () => Promise<void> }[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

/**
 * A stand-in Healthchecks.io on 127.0.0.1, on a port the system picks. Any
 * `headers` go out with its answer, such as a redirect's Location.
 */
async function standIn(answer: Answer, headers: Record<string, string> = {}) {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    let bodyBytes = 0;
    request.on('data', (chunk: Buffer) => {
      bodyBytes += chunk.length;
    });
    request.on('end', () => {
      received.push({
        method: request.method,
        path: request.url,
        bodyBytes,
        headers: request.headers,
      });
      if (answer === 'never') {
        return;
      }
      if (answer === 'hang up') {
        request.socket.destroy();
        return;
      }
      response.writeHead(answer, { 'content-type': 'text/plain', ...headers });
      response.end(answer >= 200 && answer < 300 ? 'OK' : 'not OK');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const close = async () => {
    if (!server.listening) {
      return;
    }
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  };
  servers.push({ close });
  return { url: `http://127.0.0.1:${String(port)}/${CHECK}`, port, received, close };
}

/** A port nothing listens on: taken from the system, then given back. */
async function closedPort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, 'close');
  return port;
}

/** Long enough for a retry to have arrived, had there been one. */
const aMoment = () => new Promise((resolve) => setTimeout(resolve, 100));

/** Whatever a promise, or the call that makes it, rejects with — or undefined if it resolves. */
async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

/** Everything an error carries, as a log line or an uncaught-exception printer would show it. */
const everything = (error: unknown) => inspect(error, { depth: 10, showHidden: true });

/** The URL a fetch was asked for, however it was handed over. */
function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

describe('REL-08: the check-in with Healthchecks.io', () => {
  test('INF-08-AC1: gives up after 10 seconds by default, as the spec sets', () => {
    expect(CHECK_IN_TIMEOUT_MS).toBe(10_000);
  });

  test('INF-08-AC1: a 200 answer resolves, after exactly one request, with no body, to the ping URL', async () => {
    const healthchecks = await standIn(200);

    await expect(healthchecksCheckIn({ url: healthchecks.url }).checkIn()).resolves.toBeUndefined();
    await aMoment();

    expect(healthchecks.received).toHaveLength(1);
    const [request] = healthchecks.received;
    expect(request?.path).toBe(`/${CHECK}`);
    // Healthchecks.io accepts all three; what matters is that nothing is sent with it.
    expect(['HEAD', 'GET', 'POST']).toContain(request?.method);
    expect(request?.bodyBytes).toBe(0);
    expect(request?.headers['content-length'] ?? '0').toBe('0');
    expect(request?.headers['transfer-encoding']).toBeUndefined();
  });

  test.each([201, 202, 204])('INF-08-AC1: a %i answer counts as a check-in too', async (status) => {
    const healthchecks = await standIn(status);

    await expect(healthchecksCheckIn({ url: healthchecks.url }).checkIn()).resolves.toBeUndefined();
    expect(healthchecks.received).toHaveLength(1);
  });

  test.each([404, 429, 500])(
    'INF-08-AC1: a %i answer is a failure that names the status, and is not retried',
    async (status) => {
      // 429 above all: Healthchecks.io rate-limits more than five pings a
      // minute, and a retry loop is exactly how a worker would get there. The
      // next minute's beat is the retry.
      const healthchecks = await standIn(status);

      const failure = await failureOf(() =>
        healthchecksCheckIn({ url: healthchecks.url }).checkIn(),
      );
      await aMoment();

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(String(status));
      expect(healthchecks.received).toHaveLength(1);
    },
  );

  test.each([301, 302, 303, 307, 308])(
    'INF-08-AC1: a %i redirect is a failure that names the status, and is never followed',
    async (status) => {
      // Only Healthchecks.io's own 2xx is a check-in. A redirect followed
      // would count whatever answered at the other end as one, and would
      // carry the check's UUID there — in clear text, when the new address is
      // http:, as this one is.
      const elsewhere = await standIn(200);
      const healthchecks = await standIn(status, { location: elsewhere.url });

      const failure = await failureOf(() =>
        healthchecksCheckIn({ url: healthchecks.url }).checkIn(),
      );
      await aMoment();

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(String(status));
      expect(healthchecks.received).toHaveLength(1);
      expect(elsewhere.received).toHaveLength(0);
    },
  );

  test('INF-08-AC1: a connection that cannot be made is a failure', async () => {
    const url = `http://127.0.0.1:${String(await closedPort())}/${CHECK}`;

    await expect(healthchecksCheckIn({ url }).checkIn()).rejects.toBeInstanceOf(Error);
  });

  test('INF-08-AC1: a server that hangs up without answering is a failure, and is not retried', async () => {
    const healthchecks = await standIn('hang up');

    await expect(healthchecksCheckIn({ url: healthchecks.url }).checkIn()).rejects.toBeInstanceOf(
      Error,
    );
    await aMoment();

    expect(healthchecks.received).toHaveLength(1);
  });

  test('INF-08-AC1: no answer within the timeout is a failure, and is not retried', async () => {
    // The timeout is injected short so this takes milliseconds; the test's own
    // limit below is what fails it if the injected one is ignored.
    const healthchecks = await standIn('never');

    await expect(
      healthchecksCheckIn({ url: healthchecks.url, timeoutMs: 50 }).checkIn(),
    ).rejects.toBeInstanceOf(Error);
    await aMoment();

    expect(healthchecks.received).toHaveLength(1);
  }, 2_000);

  test('INF-08-AC1: by default it does not give up in the first moments — 10 seconds, not 10 milliseconds', async () => {
    const healthchecks = await standIn('never');
    const settled: string[] = [];

    const checking = healthchecksCheckIn({ url: healthchecks.url })
      .checkIn()
      .then(
        () => settled.push('resolved'),
        () => settled.push('rejected'),
      );
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(settled).toEqual([]);
    expect(healthchecks.received).toHaveLength(1);
    await healthchecks.close();
    await checking;
  });

  test('INF-08-AC1: with an injected fetch it asks exactly once, for the ping URL, with no body', async () => {
    const asked: { url: string; body: unknown }[] = [];
    const fetchOnce: typeof fetch = (input, init) => {
      asked.push({ url: urlOf(input), body: init?.body });
      return Promise.resolve(new Response('OK', { status: 200 }));
    };

    await healthchecksCheckIn({ url: PING_URL, fetch: fetchOnce }).checkIn();

    expect(asked).toHaveLength(1);
    expect(asked[0]?.url).toBe(PING_URL);
    expect(asked[0]?.body ?? null).toBeNull();
  });
});

describe('REL-08: the ping URL never leaves the adapter', () => {
  test('INF-08-AC5: an error from fetch that carries the URL does not carry it any further', async () => {
    // Node's own fetch does this: "Failed to parse URL from <the URL>", with
    // the URL again in the cause's `input`.
    const leaky: typeof fetch = (input) =>
      Promise.reject(
        new TypeError(`Failed to parse URL from ${urlOf(input)}`, {
          cause: Object.assign(new TypeError(`Invalid URL: ${urlOf(input)}`), {
            code: 'ERR_INVALID_URL',
            input: urlOf(input),
          }),
        }),
      );

    const failure = await failureOf(() =>
      healthchecksCheckIn({ url: PING_URL, fetch: leaky }).checkIn(),
    );

    expect(failure).toBeInstanceOf(Error);
    expect(everything(failure)).not.toContain(PING_URL);
    expect(everything(failure)).not.toContain(CHECK);
  });

  test('INF-08-AC5: a URL that real fetch cannot parse fails without repeating it', async () => {
    // No scheme, so nothing can be sent: Node's fetch refuses it before any
    // connection, and puts the whole address in its error.
    const unparseable = `hc-ping.com/${CHECK}`;

    const failure = await failureOf(() => healthchecksCheckIn({ url: unparseable }).checkIn());

    expect(failure).toBeInstanceOf(Error);
    expect(everything(failure)).not.toContain(unparseable);
    expect(everything(failure)).not.toContain(CHECK);
  });

  test.each([404, 429, 500])(
    'INF-08-AC5: a %i failure does not name the check it failed to ping',
    async (status) => {
      const healthchecks = await standIn(status);

      const failure = await failureOf(() =>
        healthchecksCheckIn({ url: healthchecks.url }).checkIn(),
      );

      expect(failure).toBeInstanceOf(Error);
      expect(everything(failure)).not.toContain(CHECK);
    },
  );

  test('INF-08-AC5: a timeout does not name the check it failed to ping', async () => {
    const healthchecks = await standIn('never');

    const failure = await failureOf(() =>
      healthchecksCheckIn({ url: healthchecks.url, timeoutMs: 50 }).checkIn(),
    );

    expect(failure).toBeInstanceOf(Error);
    expect(everything(failure)).not.toContain(CHECK);
  }, 2_000);

  test('INF-08-AC5: a refused connection does not name the check it failed to ping', async () => {
    const url = `http://127.0.0.1:${String(await closedPort())}/${CHECK}`;

    const failure = await failureOf(() => healthchecksCheckIn({ url }).checkIn());

    expect(failure).toBeInstanceOf(Error);
    expect(everything(failure)).not.toContain(CHECK);
  });
});

// What the adapter says when fetch fails rather than answering. The one thing
// it copies from the underlying error is a code, from an Error's Error cause,
// and only a code shaped like a bare identifier such as ECONNREFUSED. Anything
// else is dropped, however it arrives. The worker writes this message as the
// reason for a failed check-in (INF-08-AC4), so it is held exactly: a mutant
// that loses the code, keeps a bad one, or throws while describing the error
// changes it. These fetches reject without sending anything.

/** The whole of a failure that has no code to give, as its message and class print. */
const NOT_REACHED = 'Error: Healthchecks.io could not be reached.';

/** A fetch that sends nothing and rejects with `reason`, whatever it is. */
function rejectingWith(reason: unknown): typeof fetch {
  // Thrown in the executor, which rejects with it unchanged. The lint rule
  // against rejecting with a non-Error is right everywhere but here, where a
  // non-Error is the case under test.
  return () =>
    new Promise<Response>(() => {
      throw reason;
    });
}

/** How Node's fetch fails to connect: a TypeError whose cause says why. */
const fetchFailed = (cause: unknown) => new TypeError('fetch failed', { cause });

/** A cause carrying `code`, the way Node's net module and undici set one. */
const causeCoded = (code: unknown) => Object.assign(new Error('connect failed'), { code });

/** What a check-in says when fetch rejects with `reason`. */
async function describedAs(reason: unknown): Promise<unknown> {
  return failureOf(() =>
    healthchecksCheckIn({ url: PING_URL, fetch: rejectingWith(reason) }).checkIn(),
  );
}

// Named here, not in the tables below: HK-05 counts tests by their text.
const aLookalike = { name: 'TypeError', message: 'fetch failed', cause: causeCoded('ECONNRESET') };
const noCause = new TypeError('fetch failed');
const aStringCause = fetchFailed('ECONNRESET');
const aPlainObjectCause = fetchFailed({ code: 'ECONNRESET' });
const anUncodedCause = fetchFailed(new Error('connect failed'));
const aSymbol = Symbol('ECONNRESET');

describe('REL-08: a failed fetch is described only in words chosen here', () => {
  test.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'fetch failed'],
    ['a plain object shaped like fetch’s error, coded cause and all', aLookalike],
  ])(
    'INF-08-AC1: a fetch that rejects with %s, not an Error, fails as not reached, with no code',
    async (_what, reason) => {
      const failure = await describedAs(reason);

      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toBe(NOT_REACHED);
    },
  );

  test.each([
    ['no cause at all', noCause],
    ['a cause that is a string', aStringCause],
    ['a cause that is a plain object with a code', aPlainObjectCause],
    ['a cause that is an Error without a code', anUncodedCause],
  ])(
    'INF-08-AC1: an Error from fetch with %s fails as not reached, with no code',
    async (_what, reason) => {
      const failure = await describedAs(reason);

      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toBe(NOT_REACHED);
    },
  );

  test.each([
    ['a number', -111],
    ['a symbol', aSymbol],
    ['an empty string', ''],
    ['in lower case', 'econnreset'],
    ['starting with a digit', '1ECONNRESET'],
    ['with a space in it', 'ECONN RESET'],
    ['with a hyphen in it', 'ECONN-RESET'],
  ])(
    'INF-08-AC1: a cause whose code is %s, not a bare identifier, fails with no code',
    async (_what, code) => {
      const failure = await describedAs(fetchFailed(causeCoded(code)));

      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toBe(NOT_REACHED);
    },
  );

  test.each([
    ['the ping URL', PING_URL],
    ['the check’s UUID', CHECK],
    ['the ping URL, then an identifier', `${PING_URL} ECONNRESET`],
    ['an identifier, then the ping URL', `ECONNRESET ${PING_URL}`],
    ['an identifier, a line break, then the ping URL', `ECONNRESET\n${PING_URL}`],
    ['the UUID, then an identifier', `${CHECK} ECONNRESET`],
    ['an identifier, then the UUID', `ECONNRESET${CHECK}`],
  ])(
    'INF-08-AC5: a cause whose code carries %s is dropped, and the failure does not repeat it',
    async (_what, code) => {
      // The cause's message is clean on purpose: the code is the only way
      // the URL could get out, so it is the only thing this can be about.
      const failure = await describedAs(fetchFailed(causeCoded(code)));

      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toBe(NOT_REACHED);
      expect(everything(failure)).not.toContain(PING_URL);
      expect(everything(failure)).not.toContain(CHECK);
    },
  );

  test('INF-08-AC5: a fetch that rejects with just a string naming the ping URL does not repeat it', async () => {
    const failure = await describedAs(`fetch failed for ${PING_URL}`);

    expect(String(failure)).toBe(NOT_REACHED);
    expect(everything(failure)).not.toContain(PING_URL);
    expect(everything(failure)).not.toContain(CHECK);
  });

  test.each([['ECONNRESET'], ['ENOTFOUND'], ['EAI_AGAIN'], ['UND_ERR_CONNECT_TIMEOUT']])(
    'INF-08-AC1: a cause with the code %s is named in the failure, exactly',
    async (code) => {
      const failure = await describedAs(fetchFailed(causeCoded(code)));

      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toBe(`Error: Healthchecks.io could not be reached (${code}).`);
    },
  );

  test('INF-08-AC1: no answer within the timeout is described as exactly that, naming the time', async () => {
    // Node's fetch rejects with its signal's reason when the signal fires;
    // this one does the same, so the timeout here is the adapter's own.
    const neverAnswers: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      if (!signal) {
        throw new Error('the adapter sent no signal, so nothing could ever end this request');
      }
      await once(signal, 'abort');
      throw signal.reason;
    };

    const failure = await failureOf(() =>
      healthchecksCheckIn({ url: PING_URL, fetch: neverAnswers, timeoutMs: 50 }).checkIn(),
    );

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toBe('Error: Healthchecks.io did not answer within 50 ms.');
  }, 2_000);

  test('INF-08-AC1: an abort that is not the timeout is not described as one', async () => {
    const failure = await describedAs(new DOMException('This operation was aborted', 'AbortError'));

    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toBe(NOT_REACHED);
  });
});

// LOST-02 (D-079's second follow-up): the worker hands the check-in Graphile's
// `helpers.abortSignal`, so a stop no longer waits for a Healthchecks.io that
// never answers. Before, only the adapter's own 10 s timeout could end it,
// and a stop waited for it (safety-reviewer measured an exit 6.8 s after
// SIGTERM during a hung check-in).
describe('REL-08 and LOST-02: a check-in ends when the signal it was given aborts', () => {
  /** A fetch that never answers, and rejects with its signal's reason when that signal aborts, as Node's does. */
  function neverAnswering() {
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetchNever: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      signals.push(signal);
      if (!signal) {
        throw new Error('the adapter sent no signal, so nothing could ever end this request');
      }
      await once(signal, 'abort');
      throw signal.reason;
    };
    return { fetchNever, signals };
  }

  test('LOST-02-AC21: a check-in whose signal aborts fails at once, long before its own 10 s timeout, and its error names nothing of the check', async () => {
    const { fetchNever } = neverAnswering();
    const controller = new AbortController();
    const started = performance.now();

    const checking = failureOf(() =>
      healthchecksCheckIn({ url: PING_URL, fetch: fetchNever }).checkIn(controller.signal),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    const failure = await checking;

    expect(failure).toBeInstanceOf(Error);
    expect(performance.now() - started).toBeLessThan(CHECK_IN_TIMEOUT_MS / 10);
    expect(everything(failure)).not.toContain(CHECK);
    expect(everything(failure)).not.toContain(PING_URL);
  }, 2_000);

  test('LOST-02-AC21: the signal fetch is handed aborts when the caller’s does, and not before', async () => {
    const { fetchNever, signals } = neverAnswering();
    const controller = new AbortController();

    const checking = failureOf(() =>
      healthchecksCheckIn({ url: PING_URL, fetch: fetchNever }).checkIn(controller.signal),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    controller.abort();
    await checking;

    expect(signals[0]?.aborted).toBe(true);
  }, 2_000);

  test('LOST-02-AC21: with a signal that never aborts, the adapter’s own timeout still ends the check-in, described as before', async () => {
    const { fetchNever } = neverAnswering();

    const failure = await failureOf(() =>
      healthchecksCheckIn({ url: PING_URL, fetch: fetchNever, timeoutMs: 50 }).checkIn(
        new AbortController().signal,
      ),
    );

    expect(String(failure)).toBe('Error: Healthchecks.io did not answer within 50 ms.');
  }, 2_000);

  test('LOST-02-AC21: a check-in aborted through the caller’s signal fails with exactly “Healthchecks.io check-in cancelled: the worker is stopping.”; a timeout and an unreachable host keep their own messages', async () => {
    const { fetchNever } = neverAnswering();
    const controller = new AbortController();
    const cancelling = failureOf(() =>
      healthchecksCheckIn({ url: PING_URL, fetch: fetchNever }).checkIn(controller.signal),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    expect(String(await cancelling)).toBe(
      'Error: Healthchecks.io check-in cancelled: the worker is stopping.',
    );

    // A caller's signal that does not abort changes neither of the others.
    const timedOut = await failureOf(() =>
      healthchecksCheckIn({
        url: PING_URL,
        fetch: neverAnswering().fetchNever,
        timeoutMs: 50,
      }).checkIn(new AbortController().signal),
    );
    expect(String(timedOut)).toBe('Error: Healthchecks.io did not answer within 50 ms.');

    const port = await closedPort();
    const unreachable = await failureOf(() =>
      healthchecksCheckIn({ url: `http://127.0.0.1:${String(port)}/${CHECK}` }).checkIn(
        new AbortController().signal,
      ),
    );
    expect(String(unreachable)).toBe('Error: Healthchecks.io could not be reached (ECONNREFUSED).');
  }, 5_000);

  test('LOST-02-AC21: against a stand-in that never answers, a check-in aborted by its signal ends at once, after exactly one request', async () => {
    const healthchecks = await standIn('never');
    const controller = new AbortController();

    const checking = failureOf(() =>
      healthchecksCheckIn({ url: healthchecks.url }).checkIn(controller.signal),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    const failure = await checking;
    await aMoment();

    expect(failure).toBeInstanceOf(Error);
    expect(healthchecks.received).toHaveLength(1);
    expect(everything(failure)).not.toContain(CHECK);
  }, 2_000);
});

// ---------------------------------------------------------------------------
// LOST-07-AC11: the SMS check's alarm.
// ---------------------------------------------------------------------------

describe('LOST-07 and D-079: the SMS check’s alarm reports to its own Healthchecks.io check', () => {
  test('LOST-07-AC11: ok is exactly one HEAD to the ping URL, and failing exactly one HEAD to the ping URL with /fail appended, each with no body', async () => {
    const healthchecks = await standIn(200);
    const alarm = healthchecksAlarm({ url: healthchecks.url });

    await expect(alarm.report('ok')).resolves.toBeUndefined();
    await expect(alarm.report('failing')).resolves.toBeUndefined();
    await aMoment();

    expect(
      healthchecks.received.map(({ method, path, bodyBytes }) => ({ method, path, bodyBytes })),
    ).toEqual([
      { method: 'HEAD', path: `/${CHECK}`, bodyBytes: 0 },
      { method: 'HEAD', path: `/${CHECK}/fail`, bodyBytes: 0 },
    ]);
    for (const request of healthchecks.received) {
      expect(request.headers['content-length'] ?? '0').toBe('0');
      expect(request.headers['transfer-encoding']).toBeUndefined();
    }
  });

  test.each([201, 202, 204])(
    'LOST-07-AC11: a %i answer counts, for ok and for failing',
    async (status) => {
      const healthchecks = await standIn(status);
      const alarm = healthchecksAlarm({ url: healthchecks.url });

      await expect(alarm.report('ok')).resolves.toBeUndefined();
      await expect(alarm.report('failing')).resolves.toBeUndefined();
      expect(healthchecks.received).toHaveLength(2);
    },
  );

  test.each([404, 429, 500])(
    'LOST-07-AC11: a %i answer is a failure that names the status, for ok and for failing, and is not retried',
    async (status) => {
      const healthchecks = await standIn(status);
      const alarm = healthchecksAlarm({ url: healthchecks.url });

      const failures = [
        await failureOf(() => alarm.report('ok')),
        await failureOf(() => alarm.report('failing')),
      ];
      await aMoment();

      for (const failure of failures) {
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain(String(status));
      }
      expect(healthchecks.received).toHaveLength(2);
    },
  );

  test.each([301, 302, 303, 307, 308])(
    'LOST-07-AC11: a %i redirect is a failure that names the status, and is never followed',
    async (status) => {
      const elsewhere = await standIn(200);
      const healthchecks = await standIn(status, { location: elsewhere.url });
      const alarm = healthchecksAlarm({ url: healthchecks.url });

      const failures = [
        await failureOf(() => alarm.report('ok')),
        await failureOf(() => alarm.report('failing')),
      ];
      await aMoment();

      for (const failure of failures) {
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain(String(status));
      }
      expect(healthchecks.received).toHaveLength(2);
      expect(elsewhere.received).toHaveLength(0);
    },
  );

  test('LOST-07-AC11: a connection that cannot be made, a hang-up, and no answer within the timeout are each a failure, and none is retried', async () => {
    const url = `http://127.0.0.1:${String(await closedPort())}/${CHECK}`;
    await expect(healthchecksAlarm({ url }).report('failing')).rejects.toBeInstanceOf(Error);

    const hangingUp = await standIn('hang up');
    await expect(
      healthchecksAlarm({ url: hangingUp.url }).report('failing'),
    ).rejects.toBeInstanceOf(Error);

    const silent = await standIn('never');
    await expect(
      healthchecksAlarm({ url: silent.url, timeoutMs: 50 }).report('failing'),
    ).rejects.toBeInstanceOf(Error);
    await aMoment();

    expect(hangingUp.received).toHaveLength(1);
    expect(silent.received).toHaveLength(1);
  }, 2_000);

  test('LOST-07-AC11: with an injected fetch each report asks exactly once, with HEAD, no body and redirects not followed: the ping URL for ok, the ping URL with /fail for failing', async () => {
    const asked: { url: string; method: unknown; body: unknown; redirect: unknown }[] = [];
    const fetchOnce: typeof fetch = (input, init) => {
      asked.push({
        url: urlOf(input),
        method: init?.method,
        body: init?.body ?? null,
        redirect: init?.redirect,
      });
      return Promise.resolve(new Response(null, { status: 200 }));
    };
    const alarm = healthchecksAlarm({ url: PING_URL, fetch: fetchOnce });

    await alarm.report('ok');
    await alarm.report('failing');

    expect(asked).toEqual([
      { url: PING_URL, method: 'HEAD', body: null, redirect: 'manual' },
      { url: `${PING_URL}/fail`, method: 'HEAD', body: null, redirect: 'manual' },
    ]);
  });

  test('LOST-07-AC11: a stop aborts a report in flight: it fails at once, long before its own timeout, and the signal fetch was handed aborts with the caller’s and not before', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetchNever: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      signals.push(signal);
      if (!signal) {
        throw new Error('the adapter sent no signal, so nothing could ever end this request');
      }
      await once(signal, 'abort');
      throw signal.reason;
    };
    const controller = new AbortController();
    const started = performance.now();

    const reporting = failureOf(() =>
      healthchecksAlarm({ url: PING_URL, fetch: fetchNever, timeoutMs: 60_000 }).report(
        'failing',
        controller.signal,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);
    controller.abort();
    const failure = await reporting;

    expect(failure).toBeInstanceOf(Error);
    expect(signals[0]?.aborted).toBe(true);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(everything(failure)).not.toContain(CHECK);
  }, 2_000);

  test('LOST-07-AC11: failing goes to /fail on the check’s own path whatever the configured address ends in: for one with a trailing slash, to /<uuid>/fail, not //fail; for one with a query, to /<uuid>/fail with the query after it, not ?rid=…/fail; ok goes to the address as configured', async () => {
    // LOST-07 review loop 1 (safety-reviewer, REL-07): the settings refuse
    // such addresses at start; this is the adapter's own half, so an address
    // that got past them still pages. A misplaced /fail is a ping to an
    // address Healthchecks.io does not read as a failure: no page.
    const RID = '0f0e0d0c';
    const healthchecks = await standIn(200);

    for (const configured of [`${healthchecks.url}/`, `${healthchecks.url}?rid=${RID}`]) {
      const alarm = healthchecksAlarm({ url: configured });
      await expect(alarm.report('failing'), configured).resolves.toBeUndefined();
      await expect(alarm.report('ok'), configured).resolves.toBeUndefined();
    }
    await aMoment();

    expect(healthchecks.received.map(({ method, path }) => ({ method, path }))).toEqual([
      { method: 'HEAD', path: `/${CHECK}/fail` },
      { method: 'HEAD', path: `/${CHECK}/` },
      { method: 'HEAD', path: `/${CHECK}/fail?rid=${RID}` },
      { method: 'HEAD', path: `/${CHECK}?rid=${RID}` },
    ]);
  });

  test('LOST-07-AC11: a report the caller’s signal aborts fails saying the report was cancelled because the worker is stopping, as the check-in says it of itself: not a check-in, not a timeout, and not the URL', async () => {
    // The worker hands on Graphile's signal, which aborts when it stops; the
    // line it writes should send nobody looking for a network fault, nor
    // mistake the SMS check for the worker's check-in.
    const neverAnswering: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      if (!signal) {
        throw new Error('the adapter sent no signal, so nothing could ever end this request');
      }
      await once(signal, 'abort');
      throw signal.reason;
    };
    const controller = new AbortController();

    const reporting = failureOf(() =>
      healthchecksAlarm({ url: PING_URL, fetch: neverAnswering }).report(
        'failing',
        controller.signal,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    const message = String(await reporting);

    expect(message).toMatch(/\breport\b/);
    expect(message).toMatch(/\bcancelled: the worker is stopping\.$/);
    expect(message).not.toMatch(/check-in|did not answer within|could not be reached/);
    expect(message).not.toContain(CHECK);
  }, 2_000);

  test('LOST-07-AC11: no error a report throws holds the ping URL: not from a fetch whose error repeats it, not for a status, a timeout or a refused connection, for ok and for failing', async () => {
    const repeatingFetch: typeof fetch = (input) =>
      Promise.reject(
        new TypeError(`Failed to parse URL from ${urlOf(input)}`, {
          cause: Object.assign(new TypeError(`Invalid URL: ${urlOf(input)}`), {
            code: 'ERR_INVALID_URL',
            input: urlOf(input),
          }),
        }),
      );
    const answering500 = await standIn(500);
    const silent = await standIn('never');
    const refused = `http://127.0.0.1:${String(await closedPort())}/${CHECK}`;

    const alarms = [
      healthchecksAlarm({ url: PING_URL, fetch: repeatingFetch }),
      healthchecksAlarm({ url: answering500.url }),
      healthchecksAlarm({ url: silent.url, timeoutMs: 50 }),
      healthchecksAlarm({ url: refused }),
    ];
    const failures: unknown[] = [];
    for (const alarm of alarms) {
      failures.push(await failureOf(() => alarm.report('ok')));
      failures.push(await failureOf(() => alarm.report('failing')));
    }

    expect(failures).toHaveLength(8);
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(Error);
      expect(everything(failure)).not.toContain(CHECK);
      expect(everything(failure)).not.toContain(PING_URL);
      expect(everything(failure)).not.toContain('/fail');
    }
  }, 5_000);
});
