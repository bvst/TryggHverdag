// SPIKE-01: the throwaway receiver (receiver/receiver.mjs).
//
// The coordinates below are made up: open sea near 0° N 0° E, where nobody
// lives. They exist only to prove that none of them reaches a record or the
// output. The receiver is given its clock and its timer, so nothing here waits
// for real time. Records go to a fresh temporary directory, never the repository.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { networkInterfaces, tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Imported per call, so that each test reports a missing module on its own. */
const receiverModule = () => import('./receiver.mjs');
const startReceiver = async (options) => (await receiverModule()).startReceiver(options);

const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url));
const WALL0 = Date.UTC(2031, 0, 1, 21, 0, 0);
const LATITUDE = 0.1357913;
const LONGITUDE = 0.2468024;
const ALTITUDE = 97.531;
const BODY_MARKER = 'body-marker-zq7';
/** Text that would show that a position, or the body itself, got through. */
const LEAKS = ['1357913', '2468024', '97.531', BODY_MARKER];
const NETWORK_TEST = { timeout: 20_000 };

/** A location as the SDK uploads it (field names to verify against the pinned SDK). */
function location(uuid, { moving = true, recordedAt = '2031-01-01T21:01:00.000Z' } = {}) {
  return {
    uuid,
    timestamp: recordedAt,
    is_moving: moving,
    odometer: 4321.5,
    coords: {
      latitude: LATITUDE,
      longitude: LONGITUDE,
      altitude: ALTITUDE,
      accuracy: 5,
      speed: 1.4,
      heading: 90,
    },
    activity: { type: 'walking', confidence: 100 },
    battery: { level: 0.8, is_charging: false },
    extras: { note: BODY_MARKER },
  };
}

/** The status fields the app adds to each upload. */
const STATUS = { queueCount: 3, permission: 'always', exempt: true };
const upload = (uuid) => ({ location: location(uuid), app: STATUS });

/** A clock and a timer the test moves by hand. */
function fakeClock() {
  const state = { at: WALL0, mono: 50_000, intervals: [] };
  const clock = {
    now: () => state.at,
    monotonic: () => state.mono,
    setInterval: (fn, ms) => {
      const handle = { fn, ms, cleared: false };
      state.intervals.push(handle);
      return handle;
    },
    clearInterval: (handle) => {
      if (handle) handle.cleared = true;
    },
  };
  return { state, clock };
}

/** Copies everything written to stdout and stderr into `into`, and passes it on. */
function captureOutput(into) {
  const { stdout, stderr } = process;
  const originals = [stdout.write, stderr.write];
  for (const stream of [stdout, stderr]) {
    const original = stream.write;
    stream.write = function write(chunk, ...rest) {
      into.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return original.call(this, chunk, ...rest);
    };
  }
  return () => {
    [stdout.write, stderr.write] = originals;
  };
}

/** One POST on a fresh connection. A connection error comes back as `refused`. */
function post(port, path, body = {}, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const req = request(
      {
        host,
        port,
        path,
        method: 'POST',
        agent: false,
        timeout: 5_000,
        headers: { 'content-type': 'application/json' },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', (error) => resolve({ refused: true, reason: error.code ?? error.message }));
    req.end(typeof body === 'string' ? body : JSON.stringify(body));
  });
}

/**
 * Starts a receiver on a fresh temporary directory, runs `body`, closes it, and
 * returns what it wrote and printed (its `print` and stdout and stderr together).
 */
async function withReceiver(body = async () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'spike-receiver-'));
  const { state, clock } = fakeClock();
  const output = [];
  const restore = captureOutput(output);
  try {
    const receiver = await startReceiver({
      dir,
      port: 0,
      clock,
      print: (line) => output.push(String(line)),
    });
    try {
      await body({ receiver, state });
    } finally {
      await receiver.close();
    }
    restore();
    const text = existsSync(receiver.file) ? readFileSync(receiver.file, 'utf8') : '';
    const records = text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));
    return { dir, file: receiver.file, text, records, output: output.join('\n'), state };
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The error the receiver refuses to start with, or null if it started. */
async function refusal(options) {
  const { startReceiver: start } = await receiverModule();
  const scratch = mkdtempSync(join(tmpdir(), 'spike-receiver-'));
  try {
    const receiver = await start({
      dir: scratch,
      port: 0,
      clock: fakeClock().clock,
      print: () => {},
      ...options,
    });
    await receiver.close();
    return null;
  } catch (error) {
    return error;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** An IPv4 address of this machine that is not loopback, if it has one. */
function lanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

const arrivals = (records) => records.filter((record) => record.kind === 'arrival');

test(
  'SPIKE-01-AC3: listens on the loopback address only, and refuses to listen anywhere else',
  NETWORK_TEST,
  async () => {
    await withReceiver(async ({ receiver }) => {
      assert.equal(receiver.address, '127.0.0.1');
      assert.equal((await post(receiver.port, '/upload/android', upload('rec-l1'))).status, 200);
      const lan = lanAddress();
      if (lan !== null) {
        const reply = await post(receiver.port, '/upload/android', upload('rec-l2'), lan);
        assert.equal(reply.refused, true, `reached the receiver on ${lan}, which is not loopback`);
      }
    });
    for (const host of ['0.0.0.0', '::', '192.0.2.10']) {
      const error = await refusal({ host });
      assert.ok(error instanceof Error, `the receiver listened on ${host}`);
      assert.match(error.message, /loopback/i);
    }
  },
);

test(
  'SPIKE-01-AC3: keeps its records in the directory it is given, which must be outside the repository',
  NETWORK_TEST,
  async () => {
    const run = await withReceiver(async ({ receiver }) => {
      await post(receiver.port, '/upload/android', upload('rec-d1'));
    });
    assert.ok(run.file.startsWith(run.dir + sep), `${run.file} is not inside ${run.dir}`);
    assert.equal(arrivals(run.records).length, 1);

    const inside = join(REPOSITORY, 'spikes', 'background-safety', 'receiver', 'records-not-here');
    try {
      const error = await refusal({ dir: inside });
      assert.ok(error instanceof Error, 'the receiver wrote its records inside the repository');
      assert.match(error.message, /repository/i);
      assert.equal(
        existsSync(inside),
        false,
        'a records directory was created inside the repository',
      );
    } finally {
      rmSync(inside, { recursive: true, force: true });
    }

    const missing = await refusal({ dir: undefined });
    assert.ok(missing instanceof Error, 'the receiver started with no records directory');
    assert.match(missing.message, /dir/i);
  },
);

test(
  "SPIKE-01-AC3: stores an upload as the listed fields only, timed on the Mac's clock and its monotonic clock",
  NETWORK_TEST,
  async () => {
    const run = await withReceiver(async ({ receiver, state }) => {
      state.at = WALL0 + 61_000;
      state.mono = 111_000;
      const reply = await post(receiver.port, '/upload/android', upload('rec-f1'));
      assert.equal(reply.status, 200, 'the upload was not confirmed the way the SDK expects');
    });
    assert.deepEqual(arrivals(run.records), [
      {
        kind: 'arrival',
        at: WALL0 + 61_000,
        mono: 111_000,
        platform: 'android',
        recordId: 'rec-f1',
        recordedAt: '2031-01-01T21:01:00.000Z',
        hasPosition: true,
        moving: true,
        queueCount: 3,
        permission: 'always',
        exempt: true,
      },
    ]);
    for (const leak of LEAKS) {
      assert.equal(run.text.includes(leak), false, `the records hold "${leak}" from the request`);
    }
  },
);

test(
  'SPIKE-01-AC3: keeps a batch in its order, takes the platform from the address, and marks a report with no position',
  NETWORK_TEST,
  async () => {
    const run = await withReceiver(async ({ receiver, state }) => {
      state.at = WALL0 + 120_000;
      state.mono = 170_000;
      const batch = {
        location: [
          location('rec-b1', { moving: false, recordedAt: '2031-01-01T21:01:40.000Z' }),
          location('rec-b2', { moving: false, recordedAt: '2031-01-01T21:01:50.000Z' }),
        ],
        app: STATUS,
      };
      assert.equal((await post(receiver.port, '/upload/ios', batch)).status, 200);
      state.at += 5_000;
      state.mono += 5_000;
      const report = { app: { queueCount: 0, permission: 'whenInUse', exempt: null } };
      assert.equal((await post(receiver.port, '/upload/ios', report)).status, 200);
    });
    const fromBatch = (recordId, recordedAt) => ({
      kind: 'arrival',
      at: WALL0 + 120_000,
      mono: 170_000,
      platform: 'ios',
      recordId,
      recordedAt,
      hasPosition: true,
      moving: false,
      queueCount: 3,
      permission: 'always',
      exempt: true,
    });
    assert.deepEqual(arrivals(run.records), [
      fromBatch('rec-b1', '2031-01-01T21:01:40.000Z'),
      fromBatch('rec-b2', '2031-01-01T21:01:50.000Z'),
      {
        kind: 'arrival',
        at: WALL0 + 125_000,
        mono: 175_000,
        platform: 'ios',
        recordId: null,
        recordedAt: null,
        hasPosition: false,
        moving: null,
        queueCount: 0,
        permission: 'whenInUse',
        exempt: null,
      },
    ]);
  },
);

test(
  'SPIKE-01-AC3: prints no request body, not even one it cannot read or one sent to a wrong address',
  NETWORK_TEST,
  async () => {
    const run = await withReceiver(async ({ receiver }) => {
      assert.equal((await post(receiver.port, '/upload/android', upload('rec-p1'))).status, 200);
      const broken = JSON.stringify(upload('rec-p2')).slice(0, -7);
      const unreadable = await post(receiver.port, '/upload/android', broken);
      assert.ok(
        unreadable.status >= 400,
        `confirmed a body it could not read (${unreadable.status})`,
      );
      const elsewhere = await post(receiver.port, '/elsewhere', upload('rec-p3'));
      assert.equal(elsewhere.status, 404);
    });
    for (const leak of LEAKS) {
      assert.equal(run.output.includes(leak), false, `printed "${leak}" from a request body`);
      assert.equal(
        run.text.includes(leak),
        false,
        `the records hold "${leak}" from a request body`,
      );
    }
    assert.deepEqual(
      arrivals(run.records).map((record) => record.recordId),
      ['rec-p1'],
    );
  },
);

test(
  'SPIKE-01-AC3: confirms each upload, and refuses uploads while told to, keeping none of them',
  NETWORK_TEST,
  async () => {
    const run = await withReceiver(async ({ receiver }) => {
      assert.equal((await post(receiver.port, '/upload/ios', upload('rec-r1'))).status, 200);
      assert.equal((await post(receiver.port, '/refuse')).status, 200, 'the refuse command failed');
      const refused = await post(receiver.port, '/upload/ios', upload('rec-r2'));
      assert.ok(
        refused.refused === true || refused.status >= 400,
        `confirmed an upload while refusing (${refused.status})`,
      );
      assert.equal((await post(receiver.port, '/mark/offline-started')).status, 200);
      assert.equal((await post(receiver.port, '/accept')).status, 200, 'the accept command failed');
      assert.equal((await post(receiver.port, '/upload/ios', upload('rec-r3'))).status, 200);
    });
    assert.deepEqual(
      arrivals(run.records).map((record) => record.recordId),
      ['rec-r1', 'rec-r3'],
    );
    assert.deepEqual(
      run.records.filter((record) => record.kind === 'mark').map((record) => record.label),
      ['offline-started'],
      'a mark sent while refusing uploads was lost',
    );
  },
);

test(
  "SPIKE-01-AC3: records a driver's mark on the receiver's own clock",
  NETWORK_TEST,
  async () => {
    const run = await withReceiver(async ({ receiver, state }) => {
      state.at = WALL0 + 300_000;
      state.mono = 350_000;
      assert.equal((await post(receiver.port, '/mark/journey-started')).status, 200);
    });
    assert.deepEqual(
      run.records.filter((record) => record.kind === 'mark'),
      [{ kind: 'mark', label: 'journey-started', at: WALL0 + 300_000, mono: 350_000 }],
    );
  },
);

test(
  'SPIKE-01-AC3: writes a tick every 10 s from the timer it is given, and stops that timer on close',
  NETWORK_TEST,
  async () => {
    const run = await withReceiver(async ({ state }) => {
      assert.equal(state.intervals.length, 1, 'expected one timer, taken from the injected clock');
      assert.equal(state.intervals[0].ms, 10_000);
      state.at = WALL0 + 10_000;
      state.mono = 60_000;
      state.intervals[0].fn();
      state.at = WALL0 + 20_000;
      state.mono = 70_000;
      state.intervals[0].fn();
    });
    const ticks = run.records.filter((record) => record.kind === 'tick');
    assert.deepEqual(ticks.slice(-2), [
      { kind: 'tick', at: WALL0 + 10_000, mono: 60_000 },
      { kind: 'tick', at: WALL0 + 20_000, mono: 70_000 },
    ]);
    for (const tick of ticks) assert.deepEqual(Object.keys(tick).sort(), ['at', 'kind', 'mono']);
    assert.equal(run.state.intervals[0].cleared, true, 'the tick timer was left running');
  },
);
