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
import { CHECK_IN_TIMEOUT_MS, healthchecksCheckIn } from './healthchecks.ts';

// CHECK is the path of a ping URL, the check's UUID: all zeros, so it names no
// real check. PING_URL is for the tests that hand the adapter a fetch of their
// own: https, like a real ping URL, but port 1 on the loopback address, so
// nothing leaves this machine even if the adapter reached past that fetch for
// the real one. Both come from the test kit, where test data is built.

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
