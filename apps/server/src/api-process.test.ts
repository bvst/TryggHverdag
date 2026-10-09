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
  pgSettingsAnswer,
  syntheticCredential,
  syntheticHeartbeat,
  syntheticUuid,
  type FakePgSetting,
  type FakePostgresHandler,
} from '@trygghverdag/test-kit';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startApiProcess } from './api-process.ts';
import { captured, markersIn } from './capture.test.ts';
// The test kit's fake PostgreSQL server on a local port, for a process to
// connect to by URL. It lived here until LOST-02, whose worker tests need it
// too; it moved, unchanged in what it does, to fake-postgres-server.test.ts,
// which also holds its controls and the two abilities LOST-02 added: a
// connection's startup parameters, and ending a connection as PostgreSQL ends
// a session. No assertion of this file changed with the move.
import {
  askedFor,
  eventually,
  listeningFakePostgres,
  quietDatabase,
  sessionSetting,
} from './fake-postgres-server.test.ts';

/** A socket directory that does not exist: every query fails in milliseconds, offline. */
const NO_DATABASE = 'postgres:///db?host=/nonexistent-socket-dir';

/** A line the API's start-up read-back of its session limits writes (approach item 7). */
const READ_BACK_LINE = /^api: session limits?\b/;

// LOST-02, review loop 2: since loop 1 every API this file starts reads its
// session limits back and writes a line about them on stderr (D-109). Only
// the tests that test that line look at it, through their own capture; for
// every other test it would be output left over in the run. So, around each
// test, a chunk of stderr that is nothing but read-back lines is kept back,
// and everything else passes. A plain replacement rather than a spy: a test's
// own spy, or captured(), goes over it, sees every line, and restores to it.
type StderrWrite = (chunk: unknown, ...rest: unknown[]) => boolean;
const stderrWrite = process.stderr as unknown as { write: StderrWrite };
let realStderrWrite: StderrWrite | undefined;
beforeEach(() => {
  const write = stderrWrite.write;
  realStderrWrite = write;
  stderrWrite.write = (chunk, ...rest) => {
    const lines = typeof chunk === 'string' ? chunk.split('\n').filter((line) => line !== '') : [];
    if (lines.length > 0 && lines.every((line) => READ_BACK_LINE.test(line))) {
      return true;
    }
    return write.call(process.stderr, chunk, ...rest);
  };
});
afterEach(() => {
  if (realStderrWrite !== undefined) {
    stderrWrite.write = realStderrWrite;
  }
});

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
      // RG-03 (LOST-02, review loop 1, approach item 7, D-109): the API now
      // reads its session limits back from pg_settings once at start, and
      // that read can be the first query the database sees. So this takes the
      // first query other than that read: the health check's own, which must
      // still be the database's now(). What it proves is unchanged.
      const asked = database.queries.filter(({ text }) => !/\bpg_settings\b/i.test(text));
      expect(asked[0]?.text).toMatch(/\bnow\(\)/i);
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

describe('LOST-01: what the process hands the journey module for a heartbeat, seen from the database and from stdout', () => {
  // The spec's process wiring (LOST-01, "The process wiring"): an empty
  // store, a stand-in clock or a log that writes nowhere fail a heartbeat the
  // same way a missing database does, so they are told apart here by what the
  // fake database was asked, and what reached the process's own stdout.
  const DATABASE_NOW = '2031-02-03 04:05:06.789+00';
  const DATABASE_NOW_MS = Date.parse('2031-02-03T04:05:06.789Z');

  /**
   * The column names a select or a returning clause asks for, in order, as
   * PostgreSQL names its answer's columns: an alias if there is one, else the
   * column. Drizzle reads a select's row by position, so the fake answers by
   * name, in the order asked, whatever order the adapter lists its fields in.
   */
  function askedFor(text: string): string[] {
    const list =
      /^\s*select\s+([\s\S]+?)\s+from\s/i.exec(text)?.[1] ??
      /\sreturning\s+([\s\S]+)$/i.exec(text)?.[1];
    if (list === undefined) {
      return [];
    }
    const items: string[] = [];
    let depth = 0;
    let current = '';
    for (const character of list) {
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      if (character === ',' && depth === 0) {
        items.push(current);
        current = '';
      } else {
        current += character;
      }
    }
    items.push(current);
    return items.map((item) => {
      const named = /("?)(\w+)\1\s*$/.exec(item.trim());
      return named?.[2] ?? item.trim();
    });
  }

  /** A row of these values, in the order the query asked for them. */
  function rowOf(text: string, values: Record<string, string | null>) {
    const columns = askedFor(text);
    const missing = columns.filter((column) => !(column in values));
    if (missing.length > 0) {
      throw new Error(`the fake database has no ${missing.join(', ')} for: ${text}`);
    }
    return { columns, rows: [columns.map((column) => values[column] ?? null)] };
  }

  /** The fake database for one heartbeat, its journey in `state`. Every query not listed is refused. */
  function heartbeatDatabase(state: 'ACTIVE' | 'ENDED') {
    const device = { id: syntheticUuid(), userId: syntheticUuid() };
    const journeyId = syntheticUuid();
    const journey = {
      id: journeyId,
      walker_id: device.userId,
      device_id: device.id,
      state,
      started_at: '2031-02-03 03:00:00+00',
      last_heartbeat_at: null,
    };
    const handler: FakePostgresHandler = ({ text }) => {
      if (/^(begin|commit|rollback)\b/i.test(text)) {
        return { columns: [], rows: [] };
      }
      if (/\bfrom "?devices"?/i.test(text)) {
        return { columns: ['id', 'user_id'], rows: [[device.id, device.userId]] };
      }
      if (/^insert into "?heartbeats"?/i.test(text)) {
        return rowOf(text, { id: '1', journey_id: journeyId });
      }
      if (/^insert into "?positions"?/i.test(text)) {
        return askedFor(text).length > 0
          ? rowOf(text, { heartbeat_id: '1' })
          : { columns: [], rows: [] };
      }
      if (/^update "?journeys"?/i.test(text)) {
        return askedFor(text).length > 0 ? rowOf(text, journey) : { columns: [], rows: [] };
      }
      if (/\bfrom "?journeys"?/i.test(text)) {
        return rowOf(text, journey);
      }
      if (/\bnow\(\)/i.test(text)) {
        return { columns: ['now'], rows: [[DATABASE_NOW]] };
      }
      throw new Error(`the fake database has no answer for: ${text}`);
    };
    return { device, journeyId, handler };
  }

  async function sendHeartbeat(port: number, credential: string, body: unknown) {
    return fetch(`http://127.0.0.1:${String(port)}${apiPath('heartbeats')}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  test('LOST-01-AC1: through the process, a heartbeat is timed by the database’s now() and written by the database store, in one begin…commit holding the journey’s row for update', async () => {
    const credential = syntheticCredential();
    const { journeyId, handler } = heartbeatDatabase('ACTIVE');
    const database = await listeningFakePostgres(handler);
    const api = await startApiProcess({ databaseUrl: database.url, port: 0 });
    const body = syntheticHeartbeat({ journeyId });

    try {
      const response = await sendHeartbeat(api.port, credential, body);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ outcome: 'RECORDED' });
      const texts = database.queries.map(({ text }) => text);
      const index = (pattern: RegExp) => texts.findIndex((text) => pattern.test(text));
      expect(texts.filter((text) => /\bnow\(\)/i.test(text))).toHaveLength(1);
      // REL-01: the receive time is the database's, read before the journey is.
      expect(index(/\bnow\(\)/i)).toBeLessThan(index(/\bfrom "?journeys"?/i));
      const begin = index(/^begin\b/i);
      const commit = index(/^commit\b/i);
      const locked = index(/\bfrom "?journeys"?[\s\S]*\bfor update\b/i);
      const inserted = index(/^insert into "?heartbeats"?/i);
      expect(begin).toBeGreaterThan(-1);
      expect(locked).toBeGreaterThan(begin);
      expect(inserted).toBeGreaterThan(locked);
      expect(index(/^insert into "?positions"?/i)).toBeGreaterThan(inserted);
      expect(index(/^update "?journeys"?/i)).toBeGreaterThan(inserted);
      expect(commit).toBeGreaterThan(index(/^update "?journeys"?/i));
      // The heartbeat is written with the database's time, not this machine's.
      const insert = database.queries[inserted];
      expect(
        insert?.values.some((value) => value !== null && Date.parse(value) === DATABASE_NOW_MS),
      ).toBe(true);
      expect(insert?.values).toContain(body.eventId);
      expect(JSON.stringify(database.queries)).not.toContain(credential);
    } finally {
      await api.stop();
      await database.close();
    }
  });

  test('LOST-01-AC7: through the process, an ignored heartbeat’s line reaches the process’s own stdout, naming the journey and nothing of the heartbeat; nothing is written to the database', async () => {
    const credential = syntheticCredential();
    const { journeyId, handler } = heartbeatDatabase('ENDED');
    const database = await listeningFakePostgres(handler);
    // The log is made at start-up, as in production; the capture comes after.
    const api = await startApiProcess({ databaseUrl: database.url, port: 0 });
    const body = syntheticHeartbeat({ journeyId });
    const seen: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      seen.push(String(chunk));
      return true;
    });

    try {
      const response = await sendHeartbeat(api.port, credential, body);
      spy.mockRestore();

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'JOURNEY_ENDED' });
      const lines = seen
        .join('')
        .split('\n')
        .filter((line) => line.includes('heartbeat_ignored'));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? 'null')).toMatchObject({
        event: 'heartbeat_ignored',
        reason: 'JOURNEY_ENDED',
        journeyId,
      });
      expect(seen.join('')).not.toContain(body.eventId);
      expect(
        database.queries.map(({ text }) => text).filter((text) => /^insert\b/i.test(text)),
      ).toEqual([]);
    } finally {
      spy.mockRestore();
      await api.stop();
      await database.close();
    }
  });
});

// ---------------------------------------------------------------------------
// LOST-02: the API's pool. Its session limits (approach item 7), and its
// listeners for a connection PostgreSQL ends (approach item 8, D-068).
// ---------------------------------------------------------------------------

describe('SEC-03 and LOST-02: the API’s pool, seen from the database and from the process’s output', () => {
  const DATABASE_NOW = '2031-02-03 04:05:06.789+00';

  /** Health's two queries: the time, and no worker beat yet. Anything a pool sends on connect is answered. */
  const healthDatabase: FakePostgresHandler = (query) =>
    /\bnow\(\)/i.test(query.text)
      ? { columns: ['now'], rows: [[DATABASE_NOW]] }
      : quietDatabase(query);

  /** The lines a capture saw that are the given log event, parsed. */
  function eventLines(written: string, event: string): unknown[] {
    return written
      .split('\n')
      .filter((line) => line.includes(`"event":"${event}"`))
      .map((line) => JSON.parse(line.slice(line.indexOf('{'))) as unknown);
  }

  async function health(port: number): Promise<number> {
    return (await fetch(`http://127.0.0.1:${String(port)}${apiPath('health')}`)).status;
  }

  // LOST-02, review loop 1 (approach item 7, D-109): asking is not getting.
  // The API reads both limits back once at start, from pg_settings, and says
  // on one fixed line what is in force, or which one is not; it starts anyway.

  /** What the API asks for, as pg_settings reports it when the startup parameters arrived. */
  const AS_ASKED: Record<string, FakePgSetting> = {
    idle_in_transaction_session_timeout: { setting: '10000', unit: 'ms' },
    lock_timeout: { setting: '5000', unit: 'ms' },
  };

  /** The lines written about the session limits. */
  const limitLines = (written: string) =>
    written.split('\n').filter((line) => /\bsession limits?\b/.test(line));

  /**
   * Starts the API over the fake server, waits for its read of pg_settings to
   * be answered and a moment more, asks for /v1/health, and stops it: what it
   * wrote meanwhile, and what health answered.
   */
  async function startedReadingBack(
    handler: FakePostgresHandler,
    { password }: { password?: string } = {},
  ) {
    const database = await listeningFakePostgres(
      handler,
      password === undefined ? {} : { password },
    );
    const { result: status, written } = await captured(async () => {
      const api = await startApiProcess({ databaseUrl: database.url, port: 0 });
      try {
        await eventually(() => database.queries.some(({ text }) => /\bpg_settings\b/.test(text)));
        await new Promise((resolve) => setTimeout(resolve, 50));
        return await health(api.port);
      } finally {
        await api.stop();
      }
    });
    await database.close();
    return { database, status, written };
  }

  test('LOST-02-AC17: at start the API reads idle_in_transaction_session_timeout and lock_timeout back from pg_settings and writes exactly one line: api: session limits in force: idle_in_transaction_session_timeout=10000ms lock_timeout=5000ms', async () => {
    const { database, written } = await startedReadingBack(
      (query) => pgSettingsAnswer(query, AS_ASKED) ?? healthDatabase(query),
    );

    const reads = database.queries.filter(({ text }) => /\bpg_settings\b/.test(text));
    expect(reads).toHaveLength(1);
    const read = `${reads[0]?.text ?? ''} ${(reads[0]?.values ?? []).join(' ')}`;
    expect(read).toContain('idle_in_transaction_session_timeout');
    expect(read).toContain('lock_timeout');
    expect(limitLines(written)).toEqual([
      'api: session limits in force: idle_in_transaction_session_timeout=10000ms lock_timeout=5000ms',
    ]);
  });

  test('LOST-02-AC17: when the database reports a limit other than the one asked for, as a pooler that dropped the startup parameters would, the API writes the fixed mismatch line for each such setting, and still starts and answers /v1/health', async () => {
    const dropped: Record<string, FakePgSetting> = {
      idle_in_transaction_session_timeout: { setting: '0', unit: 'ms' },
      lock_timeout: { setting: '0', unit: 'ms' },
    };
    const { status, written } = await startedReadingBack(
      (query) => pgSettingsAnswer(query, dropped) ?? healthDatabase(query),
    );

    const lines = limitLines(written);
    expect(lines).toHaveLength(2);
    expect(lines).toContain(
      'api: session limit idle_in_transaction_session_timeout is 0ms, not 10000ms: a stalled transaction will not be ended.',
    );
    expect(
      lines.filter((line) =>
        /^api: session limit lock_timeout is 0ms, not 5000ms: a heartbeat may wait for a lock without end\.?$/.test(
          line,
        ),
      ),
    ).toHaveLength(1);
    expect(status).toBe(200);
  });

  test('LOST-02-AC17: a limit that is not digits and a unit is written as unreadable, a failed read gives one line with its SQLSTATE, and no start-up line holds the connection URL, its password marker or an error message', async () => {
    const marker = syntheticCredential();
    const unreadable = await startedReadingBack(
      (query) =>
        pgSettingsAnswer(query, {
          ...AS_ASKED,
          lock_timeout: { setting: 'eleventy', unit: 'fortnights' },
        }) ?? healthDatabase(query),
      { password: marker },
    );
    const refusal = `the settings are not for you, ${marker}`;
    const failed = await startedReadingBack(
      (query) => {
        if (/\bpg_settings\b/.test(query.text)) {
          throw Object.assign(new Error(refusal), { code: '57014' });
        }
        return healthDatabase(query);
      },
      { password: marker },
    );

    const unreadableLines = limitLines(unreadable.written);
    expect(unreadableLines).toHaveLength(1);
    expect(unreadableLines[0]).toContain('lock_timeout');
    expect(unreadableLines[0]).toContain('unreadable');
    expect(limitLines(failed.written)).toEqual(['api: session limits could not be read (57014).']);
    expect([unreadable.status, failed.status]).toEqual([200, 200]);
    expect(
      markersIn(`${unreadable.written}\n${failed.written}`, [
        'eleventy',
        'fortnights',
        marker,
        unreadable.database.url,
        failed.database.url,
        refusal,
      ]),
    ).toEqual([]);
  });

  // LOST-02, review loop 2 (approach item 7): the read-back's own edges.

  test('LOST-02-AC17: stop() waits for a read-back still in flight: its line is written before stop() resolves, and the pool ends after it', async () => {
    const database = await listeningFakePostgres(
      (query) => pgSettingsAnswer(query, AS_ASKED) ?? healthDatabase(query),
    );
    const read = database.holdAnswer(/\bpg_settings\b/);
    const order: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      if (READ_BACK_LINE.test(String(chunk))) {
        order.push(`line, with ${String(database.closed().length)} connections closed`);
      }
      return true;
    });
    try {
      const api = await startApiProcess({ databaseUrl: database.url, port: 0 });
      expect(await eventually(() => read.arrived())).toBe(true);
      // A health check meanwhile, on the pool's other connection, which is
      // then idle: a pool ended before the read's line would close it then.
      expect(await health(api.port)).toBe(200);
      expect(database.connections()).toHaveLength(2);

      const stopping = api.stop().then(() => order.push('stopped'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Still waiting for the read: nothing written, and stop() not done.
      expect(order).toEqual([]);
      read.release();
      await stopping;

      expect(order).toEqual(['line, with 0 connections closed', 'stopped']);
      expect(
        await eventually(() => database.closed().length === database.connections().length),
      ).toBe(true);
    } finally {
      stderr.mockRestore();
      await database.close();
    }
  });

  test('LOST-02-AC17: the read-back lines go to stderr and nothing goes to stdout', async () => {
    const database = await listeningFakePostgres(
      (query) => pgSettingsAnswer(query, AS_ASKED) ?? healthDatabase(query),
    );
    const toStdout: string[] = [];
    const toStderr: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      toStdout.push(String(chunk));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      toStderr.push(String(chunk));
      return true;
    });
    try {
      const api = await startApiProcess({ databaseUrl: database.url, port: 0 });
      await eventually(() => toStderr.join('').includes('session limits'));
      await api.stop();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      await database.close();
    }

    expect(limitLines(toStderr.join(''))).toEqual([
      'api: session limits in force: idle_in_transaction_session_timeout=10000ms lock_timeout=5000ms',
    ]);
    expect(toStdout.join('')).not.toMatch(/\bsession limits?\b/);
  });

  test('LOST-02-AC17: a limit pg_settings returns no row for is written as unreadable, not in force', async () => {
    const { written } = await startedReadingBack(
      (query) =>
        pgSettingsAnswer(query, {
          idle_in_transaction_session_timeout: { setting: '10000', unit: 'ms' },
        }) ?? healthDatabase(query),
    );

    expect(limitLines(written)).toEqual([
      'api: session limit lock_timeout is unreadable, not 5000ms: a heartbeat may wait for a lock without end.',
    ]);
  });

  test.each(['10000x', 'x10000', '10 000'])(
    'LOST-02-AC17: a setting with anything around its digits (10000x, x10000, 10 000) is written as unreadable — %s',
    async (setting) => {
      const { written } = await startedReadingBack(
        (query) =>
          pgSettingsAnswer(query, {
            ...AS_ASKED,
            idle_in_transaction_session_timeout: { setting, unit: 'ms' },
          }) ?? healthDatabase(query),
      );

      expect(limitLines(written)).toEqual([
        'api: session limit idle_in_transaction_session_timeout is unreadable, not 10000ms: a stalled transaction will not be ended.',
      ]);
      expect(written).not.toContain(setting);
    },
  );

  test.each(['h', 'us', 'constructor', 'toString', '__proto__'])(
    'LOST-02-AC17: a unit other than ms, s and min, including names every object has (constructor, toString, __proto__), is written as unreadable — %s',
    async (unit) => {
      const { written } = await startedReadingBack(
        (query) =>
          pgSettingsAnswer(query, {
            ...AS_ASKED,
            idle_in_transaction_session_timeout: { setting: '10000', unit },
          }) ?? healthDatabase(query),
      );

      expect(limitLines(written)).toEqual([
        'api: session limit idle_in_transaction_session_timeout is unreadable, not 10000ms: a stalled transaction will not be ended.',
      ]);
      expect(written).not.toContain(`10000${unit}`);
    },
  );

  test('LOST-02-AC17: the API’s pool asks, for every connection it makes, idle_in_transaction_session_timeout 10 000 ms and lock_timeout 5 000 ms', async () => {
    const database = await listeningFakePostgres(healthDatabase);
    const api = await startApiProcess({ databaseUrl: database.url, port: 0 });

    try {
      expect(await health(api.port)).toBe(200);

      const connections = database.connections();
      expect(connections.length).toBeGreaterThan(0);
      for (const connection of connections) {
        expect(sessionSetting(connection, 'idle_in_transaction_session_timeout')).toBe(10_000);
        expect(sessionSetting(connection, 'lock_timeout')).toBe(5_000);
      }
    } finally {
      await api.stop();
      await database.close();
    }
  });

  test('LOST-02-AC18: an idle connection ended with a fatal error is exactly one database_error line, pool api and its SQLSTATE; nothing written holds the password, the URL or the message; and the pool serves the next request', async () => {
    const marker = syntheticCredential();
    const database = await listeningFakePostgres(healthDatabase, { password: marker });
    const message = `terminating connection due to administrator command for ${database.url}`;
    const api = await startApiProcess({ databaseUrl: database.url, port: 0 });

    try {
      const { result: statuses, written } = await captured(async () => {
        const before = await health(api.port);
        const [connection] = database.connections();
        if (connection === undefined) {
          throw new Error('the health check made no connection');
        }
        database.end(connection, { code: '57P01', message });
        await eventually(() => database.connections().length === 1 && connection.ended);
        await new Promise((resolve) => setTimeout(resolve, 100));
        return [before, await health(api.port)];
      });

      expect(statuses).toEqual([200, 200]);
      expect(database.connections().length).toBe(2);
      expect(eventLines(written, 'database_error')).toEqual([
        { event: 'database_error', pool: 'api', code: '57P01' },
      ]);
      expect(markersIn(written, [marker, database.url, message, 'administrator command'])).toEqual(
        [],
      );
    } finally {
      await api.stop();
      await database.close();
    }
  });

  test('LOST-02-AC18: a connection ended while a heartbeat holds it, between two queries, is exactly one database_error line, pool api and its SQLSTATE; the heartbeat is a 500, nothing written holds the password or the message, and the pool serves the next request', async () => {
    const marker = syntheticCredential();
    const credential = syntheticCredential();
    const device = { id: syntheticUuid(), userId: syntheticUuid() };
    const journeyId = syntheticUuid();
    const journey: Record<string, string | null> = {
      id: journeyId,
      walker_id: device.userId,
      device_id: device.id,
      state: 'ACTIVE',
      started_at: '2031-02-03 03:00:00+00',
      last_heartbeat_at: null,
    };
    const database = await listeningFakePostgres(
      (query) => {
        const { text } = query;
        if (/\bfrom "?devices"?/i.test(text)) {
          return { columns: ['id', 'user_id'], rows: [[device.id, device.userId]] };
        }
        if (/\bfrom "?journeys"?/i.test(text)) {
          const columns = askedFor(text);
          return { columns, rows: [columns.map((column) => journey[column] ?? null)] };
        }
        return healthDatabase(query);
      },
      { password: marker },
    );
    const message = `terminating connection due to idle-in-transaction timeout ${marker}`;
    // Right after the heartbeat's row lock is answered: the client still holds the connection.
    database.endAfter(/\bfor update\b/i, { code: '25P03', message });
    const api = await startApiProcess({ databaseUrl: database.url, port: 0 });

    try {
      const { result: statuses, written } = await captured(async () => {
        const heartbeat = await fetch(
          `http://127.0.0.1:${String(api.port)}${apiPath('heartbeats')}`,
          {
            method: 'POST',
            headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
            body: JSON.stringify(syntheticHeartbeat({ journeyId })),
          },
        );
        await new Promise((resolve) => setTimeout(resolve, 100));
        return [heartbeat.status, await health(api.port)];
      });

      expect(statuses).toEqual([500, 200]);
      expect(database.connections().some((connection) => connection.ended)).toBe(true);
      expect(eventLines(written, 'database_error')).toEqual([
        { event: 'database_error', pool: 'api', code: '25P03' },
      ]);
      expect(markersIn(written, [marker, database.url, message, 'idle-in-transaction'])).toEqual(
        [],
      );
    } finally {
      await api.stop();
      await database.close();
    }
  });
});

// Reading the SQL a store sends, for the fake databases below: the select
// list or returning clause of a statement, and the table it is about. Shared
// by LOST-06's "I'm on it" and LOST-08's "They're safe"; moved here,
// unchanged, from LOST-06's describe when LOST-08's joined it.

/** One item of a select list or a returning clause: its table, if written before it, and its name. */
interface Item {
  table: string | undefined;
  name: string;
}

/**
 * The items a select or a returning clause asks for, in order, as
 * PostgreSQL names its answer's columns: an alias if there is one, else the
 * column, with the table that qualifies it when it is written.
 */
function itemsOf(text: string): Item[] {
  const list =
    /^\s*select\s+([\s\S]+?)\s+from\s/i.exec(text)?.[1] ??
    /\sreturning\s+([\s\S]+)$/i.exec(text)?.[1];
  if (list === undefined) {
    return [];
  }
  const items: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of list) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      items.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  items.push(current);
  return items.map((item) => {
    const trimmed = item.trim();
    const qualified = /^"?(\w+)"?\."?(\w+)"?$/.exec(trimmed);
    if (qualified !== null) {
      return { table: qualified[1], name: qualified[2] ?? '' };
    }
    const named = /("?)(\w+)\1\s*$/.exec(trimmed);
    return { table: undefined, name: named?.[2] ?? trimmed };
  });
}

/** The table a statement is about: the first after from, into or update. */
function tableOf(text: string): string | undefined {
  return /\b(?:from|into|update)\s+"?(\w+)"?/i.exec(text)?.[1];
}

/** A column's name as the table holds it: an alias written in camelCase read as its column. */
const snake = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** The API's lock limit, which the fake answers a set_config with. */
const LOCK_LIMIT_MS = 5_000;

// ---------------------------------------------------------------------------
// LOST-06-AC1: what the process hands the acknowledgement module, seen from
// the database and from stdout. An empty store, or a log that writes nowhere,
// would fail "I'm on it" the way a missing database does; so the wiring is
// told apart by what the fake database was asked, in what order, and by what
// reached the process's own stdout (the spec's Mutation section: the wiring
// line must be killed here).
// ---------------------------------------------------------------------------

describe('LOST-06: what the process hands the acknowledgement module, seen from the database and from stdout', () => {
  /**
   * The fake database for one "I'm on it": R1's device, J LOST_CONTACT, and
   * its alert in `state` with R1, R2 and R3 its responders. It answers by
   * table and column name, in the order asked, whatever SQL the store writes;
   * a column it has no value for is refused, and named in `unanswered`, so a
   * failure here says what the fake does not know rather than guessing.
   */
  function acknowledgementDatabase(state: 'OPEN' | 'RESOLVED') {
    const device = { id: syntheticUuid(), userId: syntheticUuid() };
    const journeyId = syntheticUuid();
    const alertId = syntheticUuid();
    const responderIds = [device.userId, syntheticUuid(), syntheticUuid()];
    const tables: Record<string, Record<string, string | null>> = {
      journeys: {
        id: journeyId,
        walker_id: syntheticUuid(),
        device_id: syntheticUuid(),
        state: 'LOST_CONTACT',
        started_at: '2031-02-03 03:00:00+00',
        last_heartbeat_at: '2031-02-03 03:55:00+00',
        ended_at: null,
        end_reason: null,
      },
      alerts: {
        id: alertId,
        journey_id: journeyId,
        state,
        opened_at: '2031-02-03 04:00:00+00',
        silent_since: '2031-02-03 03:55:00+00',
        resolved_at: state === 'RESOLVED' ? '2031-02-03 04:03:00+00' : null,
        resolution: state === 'RESOLVED' ? 'BACK_IN_CONTACT' : null,
        acknowledged_by: null,
        acknowledged_at: null,
      },
      journey_responders: { journey_id: journeyId },
      outbox: { alert_id: alertId, kind: 'ACKNOWLEDGED', attempts: '0' },
    };
    const unanswered: string[] = [];
    /** The session limits the API reads back once at start (LOST-02-AC17), as in force. */
    const inForce: Record<string, FakePgSetting> = {
      idle_in_transaction_session_timeout: { setting: '10000', unit: 'ms' },
      lock_timeout: { setting: String(LOCK_LIMIT_MS), unit: 'ms' },
    };

    const valueOf = (item: Item, main: string | undefined, recipient: string): string | null => {
      const name = snake(item.name);
      if (name === 'responder_id' || name === 'recipient_id') {
        return recipient;
      }
      if (main === 'outbox' && name === 'id') {
        return syntheticUuid();
      }
      for (const table of [item.table, main, 'alerts', 'journeys', 'outbox']) {
        const row = table === undefined ? undefined : tables[table];
        if (row !== undefined && name in row) {
          return row[name] ?? null;
        }
      }
      throw new Error(`no value for ${item.table ?? main ?? '?'}.${item.name}`);
    };

    const handler: FakePostgresHandler = (query) => {
      // The read at start, whatever this test sends: answered here, so it is
      // never what fails, nor what the order below counts.
      const settings = pgSettingsAnswer(query, inForce);
      if (settings !== undefined) {
        return settings;
      }
      const { text } = query;
      if (/^(begin|commit|rollback)\b/i.test(text)) {
        return { columns: [], rows: [] };
      }
      if (/\bset_config\b/i.test(text)) {
        return { columns: ['set_config'], rows: [[String(LOCK_LIMIT_MS)]] };
      }
      if (/\bfrom "?devices"?/i.test(text)) {
        return { columns: ['id', 'user_id'], rows: [[device.id, device.userId]] };
      }
      const items = itemsOf(text);
      const main = tableOf(text);
      if (items.length === 0) {
        // A write that returns nothing: one row changed.
        return /^\s*(update|insert)\b/i.test(text)
          ? { columns: [], rows: [[]] }
          : { columns: [], rows: [] };
      }
      // One row per responder for a read of the responder rows, one per
      // responder but R1 for the notices written, else one.
      const notices = main === 'outbox' && /^\s*insert\b/i.test(text);
      const recipients = notices
        ? responderIds.slice(1)
        : items.some(({ name }) => snake(name) === 'responder_id')
          ? responderIds
          : [device.userId];
      try {
        return {
          columns: items.map(({ name }) => name),
          rows: recipients.map((recipient) => items.map((item) => valueOf(item, main, recipient))),
        };
      } catch (error) {
        unanswered.push(`${(error as Error).message} in: ${text}`);
        throw error;
      }
    };
    return { device, journeyId, alertId, responderIds, handler, unanswered };
  }

  async function sendAcknowledgement(port: number, credential: string, alertId: string) {
    return fetch(
      `http://127.0.0.1:${String(port)}${apiPath(`alerts/${alertId}/acknowledgement`)}`,
      { method: 'POST', headers: { authorization: `Bearer ${credential}` } },
    );
  }

  test('LOST-06-AC1: through the process, "I’m on it" is read and written by the database store: the alert read, then one begin…commit that takes the journey’s row for update before it updates the alert, for the device’s own user, and writes the notices; the credential never reaches the database', async () => {
    const credential = syntheticCredential();
    const { device, alertId, handler, unanswered } = acknowledgementDatabase('OPEN');
    const database = await listeningFakePostgres(handler);
    const api = await startApiProcess({ databaseUrl: database.url, port: 0 });

    try {
      const response = await sendAcknowledgement(api.port, credential, alertId);

      expect(unanswered, 'queries the fake database could not answer').toEqual([]);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ outcome: 'ACKNOWLEDGED' });
      const texts = database.queries.map(({ text }) => text);
      const index = (pattern: RegExp) => texts.findIndex((text) => pattern.test(text));
      const begin = index(/^begin\b/i);
      const commit = index(/^commit\b/i);
      const locked = index(/\bfrom "?journeys"?[\s\S]*\bfor update\b/i);
      const updated = index(/^update "?alerts"?/i);
      const notices = index(/^insert into "?outbox"?/i);
      // The module's read, a plain one, before the transaction.
      const read = index(/\bfrom "?alerts"?/i);
      expect(read).toBeGreaterThan(-1);
      expect(read).toBeLessThan(begin);
      expect(begin).toBeGreaterThan(-1);
      expect(locked).toBeGreaterThan(begin);
      expect(updated).toBeGreaterThan(locked);
      expect(notices).toBeGreaterThan(updated);
      expect(commit).toBeGreaterThan(notices);
      expect(texts.filter((text) => /^begin\b/i.test(text))).toHaveLength(1);
      // For the device's own user, and the alert named in the path.
      expect(JSON.stringify(database.queries.slice(begin, commit))).toContain(device.userId);
      expect(JSON.stringify(database.queries.slice(begin, commit))).toContain(alertId);
      expect(JSON.stringify(database.queries)).not.toContain(credential);
    } finally {
      await api.stop();
      await database.close();
    }
  });

  test('LOST-06-AC1: through the process, an ignored "I’m on it", its alert RESOLVED, is 409 ALERT_RESOLVED; its acknowledgement_ignored line reaches the process’s own stdout, naming the alert and the reason and nothing else; nothing is written to the database', async () => {
    const credential = syntheticCredential();
    const { device, alertId, handler, unanswered } = acknowledgementDatabase('RESOLVED');
    const database = await listeningFakePostgres(handler);
    // The log is made at start-up, as in production; the capture comes after.
    const api = await startApiProcess({ databaseUrl: database.url, port: 0 });
    const seen: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      seen.push(String(chunk));
      return true;
    });

    try {
      const response = await sendAcknowledgement(api.port, credential, alertId);
      spy.mockRestore();

      expect(unanswered, 'queries the fake database could not answer').toEqual([]);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'ALERT_RESOLVED' });
      const lines = seen
        .join('')
        .split('\n')
        .filter((line) => line.includes('acknowledgement_ignored'));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? 'null')).toEqual({
        event: 'acknowledgement_ignored',
        reason: 'ALERT_RESOLVED',
        alertId,
      });
      expect(seen.join('')).not.toContain(device.userId);
      expect(seen.join('')).not.toContain(credential);
      expect(
        database.queries
          .map(({ text }) => text)
          .filter((text) => /^\s*(insert|update|delete)\b/i.test(text)),
      ).toEqual([]);
    } finally {
      spy.mockRestore();
      await api.stop();
      await database.close();
    }
  });
});

// ---------------------------------------------------------------------------
// LOST-08-AC1 and AC2: what the process hands the closure module, seen from
// the database and from stdout. LOST-08 review loop 1 (safety-reviewer,
// should-fix 2; D-094): the closure service handed nothing, or a log that
// writes nowhere, survived every test, since none sent a close through the
// process (the mutant at api-process.ts's closure wiring). Told apart here as
// LOST-06's wiring is above: by what the fake database was asked, in what
// order, and by what reached the process's own stdout.
// ---------------------------------------------------------------------------

describe('LOST-08: what the process hands the closure module, seen from the database and from stdout', () => {
  /**
   * The fake database for one "They're safe": R1's device, J and its alert,
   * R1, R2 and R3 its responders, R1 the alert's acknowledger. `ACKNOWLEDGED`:
   * J LOST_CONTACT, so R1 can close it. `RESOLVED`: R1 closed it already, J
   * ENDED, SAFE. It answers by table and column name, in the order asked,
   * whatever SQL the store writes, as LOST-06's does; a column it has no value
   * for is refused, and named in `unanswered`.
   */
  function closureDatabase(state: 'ACKNOWLEDGED' | 'RESOLVED') {
    const device = { id: syntheticUuid(), userId: syntheticUuid() };
    const journeyId = syntheticUuid();
    const alertId = syntheticUuid();
    const responderIds = [device.userId, syntheticUuid(), syntheticUuid()];
    const closed = state === 'RESOLVED';
    const tables: Record<string, Record<string, string | null>> = {
      journeys: {
        id: journeyId,
        walker_id: syntheticUuid(),
        device_id: syntheticUuid(),
        state: closed ? 'ENDED' : 'LOST_CONTACT',
        started_at: '2031-02-03 03:00:00+00',
        last_heartbeat_at: '2031-02-03 03:55:00+00',
        ended_at: closed ? '2031-02-03 04:20:00+00' : null,
        end_reason: closed ? 'SAFE' : null,
      },
      alerts: {
        id: alertId,
        journey_id: journeyId,
        state,
        opened_at: '2031-02-03 04:00:00+00',
        silent_since: '2031-02-03 03:55:00+00',
        resolved_at: closed ? '2031-02-03 04:20:00+00' : null,
        resolution: closed ? 'SAFE' : null,
        acknowledged_by: device.userId,
        acknowledged_at: '2031-02-03 04:01:00+00',
      },
      journey_responders: { journey_id: journeyId },
      outbox: { alert_id: alertId, kind: 'SAFE', attempts: '0' },
    };
    const unanswered: string[] = [];
    /** The session limits the API reads back once at start (LOST-02-AC17), as in force. */
    const inForce: Record<string, FakePgSetting> = {
      idle_in_transaction_session_timeout: { setting: '10000', unit: 'ms' },
      lock_timeout: { setting: String(LOCK_LIMIT_MS), unit: 'ms' },
    };

    const valueOf = (item: Item, main: string | undefined, recipient: string): string | null => {
      const name = snake(item.name);
      if (name === 'responder_id' || name === 'recipient_id') {
        return recipient;
      }
      if (main === 'outbox' && name === 'id') {
        return syntheticUuid();
      }
      for (const table of [item.table, main, 'alerts', 'journeys', 'outbox']) {
        const row = table === undefined ? undefined : tables[table];
        if (row !== undefined && name in row) {
          return row[name] ?? null;
        }
      }
      throw new Error(`no value for ${item.table ?? main ?? '?'}.${item.name}`);
    };

    const handler: FakePostgresHandler = (query) => {
      const settings = pgSettingsAnswer(query, inForce);
      if (settings !== undefined) {
        return settings;
      }
      const { text } = query;
      if (/^(begin|commit|rollback)\b/i.test(text)) {
        return { columns: [], rows: [] };
      }
      if (/\bset_config\b/i.test(text)) {
        return { columns: ['set_config'], rows: [[String(LOCK_LIMIT_MS)]] };
      }
      if (/\bfrom "?devices"?/i.test(text)) {
        return { columns: ['id', 'user_id'], rows: [[device.id, device.userId]] };
      }
      // A statement that begins with a `with` (the stand-downs, written
      // after the withdrawal in one statement) is answered as its last
      // returning clause names, for the table its insert writes into.
      const withClause = /^\s*with\b/i.test(text);
      const last = text.search(/\sreturning\s(?![\s\S]*\sreturning\s)/i);
      const items = itemsOf(withClause && last >= 0 ? text.slice(last) : text);
      const main = withClause
        ? (/\binsert\s+into\s+"?(\w+)"?/i.exec(text)?.[1] ?? tableOf(text))
        : tableOf(text);
      if (items.length === 0) {
        return /^\s*(update|insert)\b/i.test(text)
          ? { columns: [], rows: [[]] }
          : { columns: [], rows: [] };
      }
      // One row per responder for a read of the responder rows, one per
      // responder but R1 for the stand-downs written, else one.
      const standDowns = main === 'outbox' && /\binsert\s+into\b/i.test(text);
      const recipients = standDowns
        ? responderIds.slice(1)
        : items.some(({ name }) => snake(name) === 'responder_id')
          ? responderIds
          : [device.userId];
      try {
        return {
          columns: items.map(({ name }) => name),
          rows: recipients.map((recipient) => items.map((item) => valueOf(item, main, recipient))),
        };
      } catch (error) {
        unanswered.push(`${(error as Error).message} in: ${text}`);
        throw error;
      }
    };
    return { device, journeyId, alertId, responderIds, handler, unanswered };
  }

  async function sendClosure(port: number, credential: string, alertId: string) {
    return fetch(`http://127.0.0.1:${String(port)}${apiPath(`alerts/${alertId}/closure`)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${credential}` },
    });
  }

  test('LOST-08-AC1: through the process, "They’re safe" is read and written by the database store: the alert read, then one begin…commit that takes the journey’s row for update, ends the journey SAFE, resolves the alert SAFE and writes the stand-downs, for the device’s own user; the credential never reaches the database', async () => {
    const credential = syntheticCredential();
    const { device, journeyId, alertId, handler, unanswered } = closureDatabase('ACKNOWLEDGED');
    const database = await listeningFakePostgres(handler);
    const api = await startApiProcess({ databaseUrl: database.url, port: 0 });

    try {
      const response = await sendClosure(api.port, credential, alertId);

      expect(unanswered, 'queries the fake database could not answer').toEqual([]);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ outcome: 'CLOSED' });
      const texts = database.queries.map(({ text }) => text);
      const index = (pattern: RegExp) => texts.findIndex((text) => pattern.test(text));
      const begin = index(/^begin\b/i);
      const commit = index(/^commit\b/i);
      const locked = index(/\bfrom "?journeys"?[\s\S]*\bfor update\b/i);
      const ended = index(/^update "?journeys"?/i);
      const resolved = index(/^update "?alerts"?/i);
      const standDowns = index(/\binsert into "?outbox"?/i);
      // The module's read, a plain one, before the transaction.
      const read = index(/\bfrom "?alerts"?/i);
      expect(read).toBeGreaterThan(-1);
      expect(read).toBeLessThan(begin);
      expect(begin).toBeGreaterThan(-1);
      expect(locked).toBeGreaterThan(begin);
      expect(ended).toBeGreaterThan(locked);
      expect(resolved).toBeGreaterThan(ended);
      expect(standDowns).toBeGreaterThan(resolved);
      expect(commit).toBeGreaterThan(standDowns);
      expect(texts.filter((text) => /^begin\b/i.test(text))).toHaveLength(1);
      // The journey ended SAFE and the alert resolved SAFE, as the store writes them.
      expect(database.queries[ended]?.values).toEqual(
        expect.arrayContaining(['ENDED', 'SAFE', journeyId]),
      );
      expect(database.queries[resolved]?.values).toEqual(expect.arrayContaining(['SAFE']));
      // For the device's own user, and the alert named in the path.
      expect(JSON.stringify(database.queries.slice(begin, commit))).toContain(device.userId);
      expect(JSON.stringify(database.queries.slice(begin, commit))).toContain(alertId);
      expect(JSON.stringify(database.queries)).not.toContain(credential);
    } finally {
      await api.stop();
      await database.close();
    }
  });

  test('LOST-08-AC2: through the process, a close of an alert already closed is 409 ALERT_RESOLVED; its closure_ignored line reaches the process’s own stdout, naming the alert and the reason and nothing else; nothing is written to the database', async () => {
    const credential = syntheticCredential();
    const { device, alertId, handler, unanswered } = closureDatabase('RESOLVED');
    const database = await listeningFakePostgres(handler);
    // The log is made at start-up, as in production; the capture comes after.
    const api = await startApiProcess({ databaseUrl: database.url, port: 0 });
    const seen: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      seen.push(String(chunk));
      return true;
    });

    try {
      const response = await sendClosure(api.port, credential, alertId);
      spy.mockRestore();

      expect(unanswered, 'queries the fake database could not answer').toEqual([]);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'ALERT_RESOLVED' });
      const lines = seen
        .join('')
        .split('\n')
        .filter((line) => line.includes('closure_ignored'));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? 'null')).toEqual({
        event: 'closure_ignored',
        reason: 'ALERT_RESOLVED',
        alertId,
      });
      expect(seen.join('')).not.toContain(device.userId);
      expect(seen.join('')).not.toContain(credential);
      const texts = database.queries.map(({ text }) => text);
      expect(texts.filter((text) => /^begin\b/i.test(text))).toEqual([]);
      expect(texts.filter((text) => /^\s*(with|insert|update|delete)\b/i.test(text))).toEqual([]);
    } finally {
      spy.mockRestore();
      await api.stop();
      await database.close();
    }
  });
});
