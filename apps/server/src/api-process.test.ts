// The API process as the platform runs it: real adapters, a real port.
//
// createApi is tested against fakes elsewhere, which proves the routes. What
// only this proves is the wiring: that the process hands the API the database
// clock and the database heartbeats, not something that merely has the right
// shape. The database here does not exist, so how the request fails is the
// assertion — reaching the database at all means the real adapters are in.
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
 */
async function listeningFakePostgres(handler: FakePostgresHandler): Promise<{
  url: string;
  queries: readonly FakePostgresQuery[];
  close: () => Promise<void>;
}> {
  const database = fakePostgres(handler);
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const connection = database.connect();
    socket.on('data', (chunk) => {
      socket.write(connection.receive(chunk));
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
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
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

  test("BUG-12: the health check reads the time from the database, and answers with the database's time", async () => {
    // REL-01: the API's clock is the database's. A time no process clock is
    // showing, so an answer timed by anything else cannot match it.
    const database = await listeningFakePostgres(({ text }) =>
      /\bnow\(\)/i.test(text)
        ? { columns: ['now'], rows: [['2031-02-03 04:05:06.789+00']] }
        : // No worker has checked in yet.
          { columns: [], rows: [] },
    );
    const api = await startApiProcess({ databaseUrl: database.url, port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${String(api.port)}${apiPath('health')}`);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ checkedAt: '2031-02-03T04:05:06.789Z' });
      expect(database.queries[0]?.text).toMatch(/\bnow\(\)/i);
    } finally {
      await api.stop();
      await database.close();
    }
  });

  test("BUG-12: a known credential goes on to the database's journey store, for the device's own user, and the credential never reaches the database", async () => {
    // SEC-07 first: the credential is looked up in `devices`. Then SM-01's
    // start reads the walker's unended journey from `journeys`. The fake
    // refuses that read, so the answer is a 500; what matters is that it was
    // asked, for the device's user, which only a journey service wired to the
    // database store does.
    const credential = syntheticCredential();
    const device = { id: syntheticUuid(), userId: syntheticUuid() };
    const database = await listeningFakePostgres(({ text }) => {
      if (/\bfrom "devices"/i.test(text)) {
        return { columns: ['id', 'user_id'], rows: [[device.id, device.userId]] };
      }
      throw new Error('the fake database answers nothing past the credential');
    });
    const api = await startApiProcess({ databaseUrl: database.url, port: 0 });

    try {
      const response = await fetch(`http://127.0.0.1:${String(api.port)}${apiPath('journeys')}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
        body: JSON.stringify({ responderIds: [syntheticUuid()] }),
      });

      expect(response.status).toBe(500);
      expect(database.queries.map((query) => query.text)).toEqual([
        expect.stringMatching(/\bfrom "devices"/i),
        expect.stringMatching(/\bfrom "journeys"/i),
      ]);
      expect(database.queries[1]?.values).toContain(device.userId);
      expect(JSON.stringify(database.queries)).not.toContain(credential);
    } finally {
      await api.stop();
      await database.close();
    }
  });
});
