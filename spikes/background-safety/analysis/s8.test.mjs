// SPIKE-01: the S8 map check (analysis/s8.mjs). Outside the go/no-go.
//
// Screenshots are PNGs: `adb exec-out screencap -p` on Android and
// `xcrun simctl io <device> screenshot --type=png` on iOS (formats to verify).
// They are built here with node:zlib rather than committed as binary fixtures,
// with every PNG row filter, RGB and RGBA, split data chunks and an extra
// chunk, as real encoders write them. Crash logs are samples written from
// knowledge of `adb logcat -b crash -d` and of iOS `.ips` reports (verify).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';

/** Imported per call, so that each test reports a missing module on its own. */
const s8 = () => import('./s8.mjs');
const judgeTiles = async (input) => (await s8()).judgeTiles(input);
const readCrashes = async (input) => (await s8()).readCrashes(input);
const judgeS8 = async (input) => (await s8()).judgeS8(input);

const APP = 'org.example.spike';
const SIZE = 100; // 100 × 100 = 10 000 pixels, so 1 % is 100 pixels
const SENTINEL = [255, 0, 255];
/** A varied, map-like pattern, never near the sentinel (its green is 60 or more). */
const tiles = (x, y) => [
  ((x * 7 + y * 3) % 200) + 20,
  ((x * 5 + y) % 180) + 60,
  ((y * 11 + x) % 150) + 40,
];
const sentinel = () => SENTINEL;
/** The first `count` pixels, in reading order, are the sentinel; the rest are tiles. */
const withSentinel = (count) => (x, y) => (y * SIZE + x < count ? SENTINEL : tiles(x, y));

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * A PNG of `pixel(x, y)` → [r, g, b]. `filter(y)` picks each row's filter
 * (0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth). The data is split into chunks of
 * at most 1000 bytes, after an ancillary pHYs chunk.
 */
function png({ pixel, colourType = 6, filter = () => 0, bitDepth = 8, interlace = 0 }) {
  const channels = colourType === 6 ? 4 : 3;
  const stride = SIZE * channels;
  const rows = [];
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = pixel(x, y);
      row.set(channels === 4 ? [r, g, b, 255] : [r, g, b], x * channels);
    }
    const type = filter(y);
    const out = Buffer.alloc(stride + 1);
    out[0] = type;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      const predictor = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][type];
      out[i + 1] = (row[i] - predictor + 256) & 0xff;
    }
    rows.push(out);
    previous = row;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = bitDepth;
  header[9] = colourType;
  header[12] = interlace;
  const physical = Buffer.alloc(9);
  physical.writeUInt32BE(2835, 0);
  physical.writeUInt32BE(2835, 4);
  physical[8] = 1;
  const data = deflateSync(Buffer.concat(rows));
  const pieces = [];
  for (let i = 0; i < data.length; i += 1000)
    pieces.push(chunk('IDAT', data.subarray(i, i + 1000)));
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('pHYs', physical),
    ...pieces,
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError];
/** Rejects on purpose: not a missing module, and not a programming error. */
async function refuses(promise, why) {
  await assert.rejects(
    promise,
    (error) => {
      assert.ok(
        error?.code !== 'ERR_MODULE_NOT_FOUND' &&
          !PROGRAMMING_ERRORS.some((type) => error instanceof type),
        `${why}: it broke instead of refusing (${error?.name}: ${error?.message})`,
      );
      return true;
    },
    why,
  );
}

test('SPIKE-01-AC16: a map that is all sentinel fails', async () => {
  const result = await judgeTiles({ png: png({ pixel: sentinel }), sentinel: SENTINEL });
  assert.equal(result.status, 'failed');
  assert.equal(result.sentinelShare, 1);
});

test('SPIKE-01-AC16: a map with its tiles drawn passes', async () => {
  const result = await judgeTiles({ png: png({ pixel: tiles }), sentinel: SENTINEL });
  assert.equal(result.status, 'passed');
  assert.equal(result.sentinelShare, 0);
});

test('SPIKE-01-AC16: exactly 1 % sentinel passes, and one pixel more fails', async () => {
  const atLimit = await judgeTiles({ png: png({ pixel: withSentinel(100) }), sentinel: SENTINEL });
  assert.equal(atLimit.status, 'passed');
  assert.equal(atLimit.sentinelShare, 0.01);
  const over = await judgeTiles({ png: png({ pixel: withSentinel(101) }), sentinel: SENTINEL });
  assert.equal(over.status, 'failed');
  assert.equal(over.sentinelShare, 0.0101);
});

test('SPIKE-01-AC16: reads every PNG row filter, in RGB and in RGBA', async () => {
  const filters = [0, 1, 2, 3, 4].map((type) => [`filter ${type}`, () => type]);
  filters.push(['every filter in turn', (y) => y % 5]);
  for (const colourType of [2, 6]) {
    for (const [name, filter] of filters) {
      const read = (pixel) =>
        judgeTiles({ png: png({ pixel, colourType, filter }), sentinel: SENTINEL });
      const where = `colour type ${colourType}, ${name}`;
      assert.equal((await read(sentinel)).sentinelShare, 1, `all sentinel, ${where}`);
      assert.equal(
        (await read(withSentinel(101))).status,
        'failed',
        `101 sentinel pixels, ${where}`,
      );
      assert.equal((await read(tiles)).status, 'passed', `drawn tiles, ${where}`);
    }
  }
});

test('SPIKE-01-AC16: a pixel a few steps off the sentinel, as colour management may leave it, still counts', async () => {
  const result = await judgeTiles({ png: png({ pixel: () => [251, 3, 252] }), sentinel: SENTINEL });
  assert.equal(result.status, 'failed');
  assert.equal(result.sentinelShare, 1);
});

test("SPIKE-01-AC16: only the map's region of the screenshot counts", async () => {
  const shot = png({ pixel: (x, y) => (y < 20 ? SENTINEL : tiles(x, y)) });
  const map = { x: 0, y: 20, width: SIZE, height: SIZE - 20 };
  const inRegion = await judgeTiles({ png: shot, sentinel: SENTINEL, region: map });
  assert.equal(inRegion.status, 'passed');
  assert.equal(inRegion.sentinelShare, 0);
  const whole = await judgeTiles({ png: shot, sentinel: SENTINEL });
  assert.equal(whole.sentinelShare, 0.2);
});

test('SPIKE-01-AC16: a screenshot it cannot read is refused, never measured', async () => {
  const good = png({ pixel: tiles });
  const unreadable = [
    ['text instead of a PNG', Buffer.from('error: no devices/emulators found\n')],
    ['a palette PNG', png({ pixel: tiles, colourType: 3 })],
    ['a 16-bit PNG', png({ pixel: tiles, bitDepth: 16 })],
    ['an interlaced PNG', png({ pixel: tiles, interlace: 1 })],
    ['a PNG cut short', good.subarray(0, Math.floor(good.length / 2))],
  ];
  for (const [what, bytes] of unreadable) {
    await refuses(judgeTiles({ png: bytes, sentinel: SENTINEL }), what);
  }
});

const JAVA_CRASH = [
  '--------- beginning of crash',
  '09-30 21:14:03.123  4321  4321 E AndroidRuntime: FATAL EXCEPTION: main',
  `09-30 21:14:03.123  4321  4321 E AndroidRuntime: Process: ${APP}, PID: 4321`,
  '09-30 21:14:03.123  4321  4321 E AndroidRuntime: java.lang.UnsatisfiedLinkError: dlopen failed: library "libexample.so" not found',
  '09-30 21:14:03.124  4321  4321 E AndroidRuntime: \tat java.lang.Runtime.loadLibrary0(Runtime.java:1082)',
].join('\n');

const NATIVE_CRASH = [
  '--------- beginning of crash',
  '09-30 21:20:00.456  5010  5010 F DEBUG   : *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***',
  "09-30 21:20:00.456  5010  5010 F DEBUG   : Build fingerprint: 'google/sdk_gphone16k_x86_64/emu64xa16k:16/EXAMPLE/1:userdebug/dev-keys'",
  `09-30 21:20:00.456  5010  5010 F DEBUG   : pid: 4321, tid: 4400, name: mqt_v_native  >>> ${APP} <<<`,
  '09-30 21:20:00.456  5010  5010 F DEBUG   : signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0',
].join('\n');

const OTHER_APPS = [
  '--------- beginning of crash',
  '09-30 21:30:00.000  6000  6000 E AndroidRuntime: FATAL EXCEPTION: main',
  '09-30 21:30:00.000  6000  6000 E AndroidRuntime: Process: com.android.systemui, PID: 6000',
  '09-30 21:31:00.000  7000  7000 E AndroidRuntime: FATAL EXCEPTION: main',
  `09-30 21:31:00.000  7000  7000 E AndroidRuntime: Process: ${APP}.other, PID: 7000`,
  '09-30 21:32:00.000  5010  5010 F DEBUG   : pid: 8000, tid: 8000, name: surfaceflinger  >>> /system/bin/surfaceflinger <<<',
].join('\n');

/** An iOS crash report: a JSON header line, then the JSON body. */
const ips = (bundleID, bugType = '309') =>
  [
    JSON.stringify({
      app_name: 'SpikeApp',
      timestamp: '2031-01-01 21:20:00.00 +0000',
      app_version: '1.0.0',
      bug_type: bugType,
      bundleID,
      platform: 7,
      os_version: 'macOS 26.0',
      name: 'SpikeApp',
      incident_id: '00000000-0000-4000-8000-000000000002',
    }),
    JSON.stringify(
      {
        procName: 'SpikeApp',
        bundleInfo: { CFBundleIdentifier: bundleID, CFBundleShortVersionString: '1.0.0' },
        exception: { type: 'EXC_BAD_ACCESS', signal: 'SIGSEGV' },
      },
      null,
      2,
    ),
  ].join('\n');

test("SPIKE-01-AC16: Android's crash log: a Java crash of the app is found", async () => {
  const crashes = await readCrashes({ platform: 'android', text: JAVA_CRASH, app: APP });
  assert.ok(crashes.length > 0, 'the crash was missed');
  assert.ok(crashes.every((crash) => crash.process === APP));
  assert.ok(crashes.some((crash) => crash.kind === 'java'));
});

test("SPIKE-01-AC16: Android's crash log: a native crash of the app is found", async () => {
  const crashes = await readCrashes({ platform: 'android', text: NATIVE_CRASH, app: APP });
  assert.ok(crashes.length > 0, 'the crash was missed');
  assert.ok(crashes.every((crash) => crash.process === APP));
  assert.ok(crashes.some((crash) => crash.kind === 'native'));
});

test("SPIKE-01-AC16: Android's crash log: other apps' crashes, and an empty log, are no crash of the app", async () => {
  assert.deepEqual(await readCrashes({ platform: 'android', text: OTHER_APPS, app: APP }), []);
  assert.deepEqual(
    await readCrashes({ platform: 'android', text: '--------- beginning of crash\n', app: APP }),
    [],
  );
  assert.deepEqual(await readCrashes({ platform: 'android', text: '', app: APP }), []);
});

test('SPIKE-01-AC16: output that is not a crash log is refused, never read as "no crash"', async () => {
  await refuses(
    readCrashes({ platform: 'android', text: 'error: no devices/emulators found\n', app: APP }),
    "adb's error",
  );
  await refuses(
    readCrashes({ platform: 'android', text: 'adb: device offline\n', app: APP }),
    'an offline device',
  );
  await refuses(
    readCrashes({ platform: 'ios', text: 'not a report\n', app: APP }),
    'not an .ips report',
  );
});

test("SPIKE-01-AC16: an iOS crash report is the app's crash only if it names the app", async () => {
  const mine = await readCrashes({ platform: 'ios', text: ips(APP), app: APP });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].process, APP);
  assert.deepEqual(
    await readCrashes({ platform: 'ios', text: ips('com.apple.Preferences'), app: APP }),
    [],
  );
});

/** One device's S8 run: three zoom levels, all drawn, no crash, still running. */
function device(platform, change = () => {}) {
  const run = {
    platform,
    shots: [12, 15, 18].map((zoom) => ({ zoom, png: png({ pixel: tiles }) })),
    sentinel: SENTINEL,
    crashes: [],
    processRunning: true,
    ...(platform === 'android' ? { aligned16k: true } : {}),
  };
  change(run);
  return run;
}

test('SPIKE-01-AC16: a device passes with the tiles drawn at all three zoom levels, no crash, the app running, and on Android 16 KB alignment', async () => {
  const android = await judgeS8(device('android'));
  assert.equal(android.status, 'passed');
  assert.deepEqual(
    android.shots.map((shot) => [shot.zoom, shot.status]),
    [
      [12, 'passed'],
      [15, 'passed'],
      [18, 'passed'],
    ],
  );
  assert.equal(
    (await judgeS8(device('ios'))).status,
    'passed',
    'iOS has no 16 KB alignment to check',
  );

  const failing = [
    ['one zoom level with no tiles', (run) => (run.shots[1].png = png({ pixel: sentinel }))],
    ['a crash', (run) => (run.crashes = [{ kind: 'native', process: APP }])],
    ['the app no longer running', (run) => (run.processRunning = false)],
    ['native libraries not aligned for 16 KB pages', (run) => (run.aligned16k = false)],
  ];
  for (const [what, change] of failing) {
    assert.equal((await judgeS8(device('android', change))).status, 'failed', what);
  }
});

test('SPIKE-01-AC16: a device run without three zoom levels, or on Android without the alignment check, is refused', async () => {
  await refuses(judgeS8(device('android', (run) => run.shots.pop())), 'two zoom levels');
  await refuses(
    judgeS8(device('android', (run) => (run.shots[2].zoom = 15))),
    'a zoom level taken twice',
  );
  await refuses(judgeS8(device('android', (run) => delete run.aligned16k)), 'no alignment check');
});
