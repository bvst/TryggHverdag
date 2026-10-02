// The API process as the platform runs it: real adapters, a real port.
//
// createApi is tested against fakes elsewhere, which proves the routes. What
// only this proves is the wiring: that the process hands the API the database
// clock, the database heartbeats, the database journey store and the
// database authenticator, not something that merely has the right shape.
//
// How a request fails with no database is not enough to show that. An empty
// service fails with the same 500 as a missing database, and three mutants
// that hand the API its services empty survived the tests that relied on it
// (BUG-12). So the tests that prove the wiring talk to the test kit's fake
// PostgreSQL server, which records what the process asked it, and assert
// what came back from it: the database's time, in the health check and in a
// started journey. The tests with no database at all prove what happens when
// it cannot be reached.
import {
  apiPath,
  fakePostgres,
  syntheticCredential,
  syntheticUuid,
  type FakePostgresHandler,
  type FakePostgresQuery,
} from '@trygghverdag/test-kit';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { describe, expect, test } from 'vitest';
import { startApiProcess } from './api-process.ts';

/** A socket directory that does not exist: every query fails in milliseconds, offline. */
const NO_DATABASE = 'postgres:///db?host=/nonexistent-socket-dir';

/**
 * The test kit's fake PostgreSQL server on a local port, for a process to
 * connect to by URL. It records what it is asked and answers through
 * `handler`. No password: the fake lets anyone in, so none is ever written
 * here.
 *
 * The fake throws on anything it would otherwise have to guess at (a message
 * it does not speak, an answer it cannot encode). Thrown inside the socket's
 * data handler, that was an uncaught exception, and the request waited for a
 * reply until the test timed out (test audit, test-auditor). So the throw is
 * caught, the connection is closed, which fails the request at once, and
 * `close()` rejects with what the fake said. Every test awaits `close()` in
 * its `finally`, so it fails with the fake's own message, in place of
 * whatever the failed request made it assert, and even when the request
 * somehow succeeded.
 */
async function listeningFakePostgres(handler: FakePostgresHandler): Promise<{
  url: string;
  queries: readonly FakePostgresQuery[];
  close: () => Promise<void>;
}> {
  const database = fakePostgres(handler);
  const sockets = new Set<Socket>();
  const thrown: unknown[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const connection = database.connect();
    socket.on('data', (chunk) => {
      let reply: Uint8Array;
      try {
        reply = connection.receive(chunk);
      } catch (error) {
        thrown.push(error);
        socket.destroy();
        return;
      }
      socket.write(reply);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `postgres://synthetic@127.0.0.1:${String(port)}/synthetic`,
    queries: database.queries,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          if (thrown.length === 0) {
            resolve();
            return;
          }
          const said = thrown.map((error) =>
            error instanceof Error ? error.message : String(error),
          );
          reject(
            new Error(
              `The fake PostgreSQL server threw, and closed the connection: ${said.join(' | ')}`,
              { cause: thrown[0] },
            ),
          );
        });
      }),
  };
}

describe('startApiProcess, and the journey route it serves', () => {
  test('SM-01-AC12: credentials are checked against the database, so with none reachable a credential is a 500, not a 401', async () => {
    // SEC-07: every request is authenticated per device. A process wired to
    // anything but the database authenticator would answer this without a
    // database: 401 from an empty stand-in, or 404 with no route at all.
    const api = await startApiProcess({ databaseUrl: NO_DATABASE, port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${String(api.port)}/v1/journeys`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${syntheticCredential()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ responderIds: [syntheticUuid()] }),
      });

      expect(response.status).toBe(500);
    } finally {
      await api.stop();
    }
  });
});

describe('startApiProcess', () => {
  test('serves the health check wired to the database, not to a stand-in', async () => {
    const api = await startApiProcess({ databaseUrl: NO_DATABASE, port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${String(api.port)}/v1/health`);
      // 500, not 200: the database clock was asked and could not answer. A
      // process wired to a fake clock would have said "ok" with no database.
      expect(response.status).toBe(500);
    } finally {
      await api.stop();
    }
  });

  test('a port that is already taken fails the start, rather than leaving a process that serves nothing', async () => {
    const first = await startApiProcess({ databaseUrl: NO_DATABASE, port: 0 });

    try {
      await expect(startApiProcess({ databaseUrl: NO_DATABASE, port: first.port })).rejects.toThrow(
        /EADDRINUSE/,
      );
    } finally {
      await first.stop();
    }
  });

  test('stopping closes the port', async () => {
    const api = await startApiProcess({ databaseUrl: NO_DATABASE, port: 0 });

    await api.stop();

    await expect(fetch(`http://127.0.0.1:${String(api.port)}/v1/health`)).rejects.toThrow();
  });
});

describe('BUG-12: what the process hands the API, seen from the database', () => {
  // On its own, api-process.ts scored 62.5 %. Three mutants survived every
  // in-process test: the API, its health service and its journey service each
  // built from `{}`. With no database, an empty service fails with a 500 just
  // as the real one does, so the tests above cannot tell them apart; only L3,
  // which no mutation run starts, could. Here the database is the test kit's
  // fake PostgreSQL server, in this process: it records what the process
  // asked it, and an empty service asks it nothing.

  /**
   * What the fake database says `now()` is: a time no process clock is
   * showing, so an answer timed by anything else cannot match it. As
   * PostgreSQL writes a timestamptz, and as the API answers it.
   */
  const DATABASE_NOW = '2031-02-03 04:05:06.789+00';
  const DATABASE_NOW_ISO = '2031-02-03T04:05:06.789Z';

  test("BUG-12: the health check reads the time from the database, and answers with the database's time", async () => {
    // REL-01: the API's clock is the database's. A time no process clock is
    // showing, so an answer timed by anything else cannot match it.
    const database = await listeningFakePostgres(({ text }) =>
      /\bnow\(\)/i.test(text)
        ? { columns: ['now'], rows: [[DATABASE_NOW]] }
        : // No worker has checked in yet.
          { columns: [], rows: [] },
    );
    const api = await startApiProcess({ databaseUrl: database.url, port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${String(api.port)}${apiPath('health')}`);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ checkedAt: DATABASE_NOW_ISO });
      expect(database.queries[0]?.text).toMatch(/\bnow\(\)/i);
    } finally {
      await api.stop();
      await database.close();
    }
  });

  test("BUG-12: a journey started through the process is timed by the database clock and stored by the database store, for the device's own user; the credential never reaches the database", async () => {
    // REL-01 and SM-01. Review loop 1, safety-reviewer: this test's fake
    // refused every query after the credential's, so a start never reached
    // the clock, and any clock wired into the journey service passed. Now
    // the fake answers every query a start makes, in the order it makes
    // them:
    //   - SEC-07: the credential, looked up in `devices`;
    //   - the walker's unended journey, from `journeys`: none;
    //   - the responders, from `users`: each one exists;
    //   - the time, from `now()`: the synthetic 2031 time;
    //   - the journey and its responders, inserted in one transaction.
    // Any other query is refused, and the start answers 500.
    const credential = syntheticCredential();
    const device = { id: syntheticUuid(), userId: syntheticUuid() };
    const responderId = syntheticUuid();
    const journeyId = syntheticUuid();
    const database = await listeningFakePostgres(({ text }) => {
      if (/\bfrom "devices"/i.test(text)) {
        return { columns: ['id', 'user_id'], rows: [[device.id, device.userId]] };
      }
      if (/^insert into "journeys"/i.test(text)) {
        return { columns: ['id'], rows: [[journeyId]] };
      }
      if (/^insert into "journey_responders"/i.test(text)) {
        return { columns: [], rows: [] };
      }
      if (/\bfrom "journeys"/i.test(text)) {
        return { columns: ['id', 'state'], rows: [] };
      }
      if (/\bfrom "users"/i.test(text)) {
        return { columns: ['id'], rows: [[responderId]] };
      }
      if (/\bnow\(\)/i.test(text)) {
        return { columns: ['now'], rows: [[DATABASE_NOW]] };
      }
      if (/^(begin|commit)\b/i.test(text)) {
        return { columns: [], rows: [] };
      }
      throw new Error(`the fake database has no answer for: ${text}`);
    });
    const api = await startApiProcess({ databaseUrl: database.url, port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${String(api.port)}${apiPath('journeys')}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
        body: JSON.stringify({ responderIds: [responderId] }),
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ journeyId, startedAt: DATABASE_NOW_ISO });
      const asked = (pattern: RegExp) => database.queries.filter(({ text }) => pattern.test(text));
      expect(asked(/\bnow\(\)/i)).toHaveLength(1);
      expect(asked(/\bfrom "journeys"/i)[0]?.values).toContain(device.userId);
      // The journey is stored with the time the API answered with, not only
      // answered with it.
      expect(asked(/^insert into "journeys"/i)[0]?.values).toEqual(
        expect.arrayContaining([device.userId, DATABASE_NOW_ISO]),
      );
      expect(JSON.stringify(database.queries)).not.toContain(credential);
    } finally {
      await api.stop();
      await database.close();
    }
  });
});
