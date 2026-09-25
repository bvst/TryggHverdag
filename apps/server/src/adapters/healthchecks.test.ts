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
import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import { afterEach, describe, expect, test } from 'vitest';
import { CHECK_IN_TIMEOUT_MS, healthchecksCheckIn } from './healthchecks.ts';

/** The path of a ping URL: the check's UUID. All zeros, so it names no real check. */
const CHECK = '00000000-0000-0000-0000-000000000000';
/**
 * For the tests that hand the adapter a fetch of their own. https, like a real
 * ping URL; port 1 on the loopback address, so nothing leaves this machine
 * even if the adapter reached past that fetch for the real one.
 */
const PING_URL = `https://127.0.0.1:1/${CHECK}`;

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

/** A stand-in Healthchecks.io on 127.0.0.1, on a port the system picks. */
async function standIn(answer: Answer) {
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
      response.writeHead(answer, { 'content-type': 'text/plain' });
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
