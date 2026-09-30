// SPIKE-01: the sleep reader (analysis/pmset.mjs). A sleep of the Mac leaves no
// hole in the receiver's ticks: the monotonic clock is believed not to advance
// while the Mac sleeps, and the emulator and simulator are frozen with it. So a
// sleep must reach the judges as a break. It is read from `pmset -g log`, which
// needs no admin rights, for the run's window on the Mac's wall clock.
//
// The sample follows the line format of `pmset -g log` on this Mac (Darwin 25.6,
// read on 2026-09-30):
// - an event is "<date> <time> <±hhmm> <domain, padded to 20>\t<message>";
// - a Sleep or DarkWake message ends with how long it lasted ("… 57 secs"),
//   and a Wake message has no duration;
// - the lines are not strictly in time order;
// - the output ends with "<now> : Showing all currently held IOKit power
//   assertions" and the assertions held at that moment.
// Every line here is synthesised in that format; none is copied from the Mac.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const readSleeps = async (input) => (await import('./pmset.mjs')).readSleeps(input);
const judgeS1 = async (input) => (await import('./s1.mjs')).judgeS1(input);

const S = 1_000;
const MIN = 60 * S;
/** The run's window: 22:00 to 22:45 on the Mac's clock in Oslo in winter (+0100). */
const FROM = Date.UTC(2031, 0, 1, 21, 0, 0);
const TO = FROM + 45 * MIN;

/** One event line, as `pmset -g log` prints it. */
const event = (time, domain, message) => `${time} ${domain.padEnd(20)}\t${message}   `;
const sleep = (time, why, secs) =>
  event(
    time,
    'Sleep',
    `Entering Sleep state due to '${why}':TCPKeepAlive=active Using AC (Charge:100%) ${secs} secs`,
  );
const darkWake = (time, secs) =>
  event(
    time,
    'DarkWake',
    `DarkWake from Deep Idle [CDNP] : due to EC.RTC/Maintenance Using AC (Charge:100%) ${secs} secs`,
  );
const wake = (time) =>
  event(
    time,
    'Wake',
    'Wake from Deep Idle [CDNVA] : due to EC.KeyboardTouchpad/UserActivity Assertion Using AC (Charge:100%)',
  );

/** Before the window: a sleep, a dark wake and a sleep that end at 20:45:51. */
const BEFORE = [
  'PM ASL data store: /var/log/powermanagement',
  event(
    '2031-01-01 20:05:00 +0100',
    'Assertions',
    'PID 311(coreaudiod) Released PreventUserIdleSystemSleep "com.apple.audio.context12.preventuseridlesleep" 00:04:01  id:0x0x100008230 [System: DeclUser kDisp]',
  ),
  sleep('2031-01-01 20:10:00 +0100', 'Idle Sleep', 906),
  event(
    '2031-01-01 20:10:02 +0100',
    'Wake Requests',
    '[process=mDNSResponder request=Maintenance deltaSecs=7198 wakeAt=2031-01-01 22:10:00 info="upkeep wake"]',
  ),
  event(
    '2031-01-01 20:10:02 +0100',
    'PM Client Acks',
    'Delays to Sleep notifications: [com.apple.apsd is slow(1461 ms)] [com.apple.bluetooth.sleep is slow(1563 ms)]',
  ),
  // Out of time order, as the real log has it during a sleep.
  event(
    '2031-01-01 20:40:34 +0100',
    'Assertions',
    'PID 0(kernel_task) Released Kernel Assertion "CPU"  id:0x0x0 [System: DeclUser kDisp]',
  ),
  event(
    '2031-01-01 20:25:06 +0100',
    'com.apple.sleepservices.sessionStarted',
    'SleepService: window begins with cap time=86400 secs',
  ),
  darkWake('2031-01-01 20:25:06 +0100', 45),
  event('2031-01-01 20:25:06 +0100', 'WakeDetails', 'DriverReason:E_RX_IP_PACKET - DriverDetails:'),
  'DriverReason:ARPT - DriverDetails:                                         ',
  event('2031-01-01 20:25:06 +0100', 'WakeTime', 'WakeTime: 1.424 sec'),
  event(
    '2031-01-01 20:25:16 +0100',
    'com.apple.sleepservices.sessionTerminated',
    'SleepService: window has terminated.',
  ),
  sleep('2031-01-01 20:25:51 +0100', 'Maintenance Sleep', 1200),
  wake('2031-01-01 20:45:51 +0100'),
  event(
    '2031-01-01 20:45:51 +0100',
    'HibernateStats',
    'hibmode=3 standbydelaylow=0 standbydelayhigh=86400\t          227 ms\t',
  ),
  event(
    '2031-01-01 20:45:51 +0100',
    'Kernel Client Acks',
    'Delays to Wake notifications: [RP17 driver is slow(msg: SetState to 2)(311 ms)]',
  ),
  'Sleep/Wakes since boot:12   Dark Wake Count in this sleep cycle:1',
  '',
  'Time stamp                Domain              \tMessage                                                                    \tDuration  \tDelay     ',
  '==========                ======              \t=======                                                                    \t========  \t=====     ',
  'UUID: 00000000-0000-4000-8000-000000000001',
];

/** Inside the window, and none of it a sleep: caffeinate holding the Mac awake, the display off. */
const QUIET = [
  event(
    '2031-01-01 22:05:00 +0100',
    'Notification',
    'Display is turned off                                                      \t          ',
  ),
  event(
    '2031-01-01 22:10:00 +0100',
    'Assertions',
    'PID 40001(caffeinate) Summary PreventUserIdleSystemSleep "caffeinate command-line tool" 00:10:00  id:0x0x100008dcb [System: PrevIdle DeclUser kDisp]',
  ),
  event(
    '2031-01-01 22:30:00 +0100',
    'Assertions',
    'Summary- [System: PrevIdle DeclUser kDisp] Using AC(Charge: 100)',
  ),
];

/** Inside the window: the lid closed at 22:20 for 5 min, a dark wake, then 2 min more. */
const SLEPT = [
  QUIET[0],
  QUIET[1],
  sleep('2031-01-01 22:20:00 +0100', 'Clamshell Sleep', 300),
  event(
    '2031-01-01 22:20:02 +0100',
    'Wake Requests',
    '[process=powerd request=CSPNEvaluation deltaSecs=7190 wakeAt=2031-01-02 00:20:00]',
  ),
  event(
    '2031-01-01 22:20:02 +0100',
    'PM Client Acks',
    'Delays to Sleep notifications: [com.apple.apsd is slow(1493 ms)]',
  ),
  event(
    '2031-01-01 22:25:00 +0100',
    'com.apple.sleepservices.sessionStarted',
    'SleepService: window begins with cap time=86400 secs',
  ),
  darkWake('2031-01-01 22:25:00 +0100', 45),
  event('2031-01-01 22:25:00 +0100', 'WakeDetails', 'DriverReason:ARPT - DriverDetails:'),
  'DriverReason:ARPT - DriverDetails:                                         ',
  event(
    '2031-01-01 22:25:10 +0100',
    'com.apple.sleepservices.sessionTerminated',
    'SleepService: window has terminated.',
  ),
  sleep('2031-01-01 22:25:45 +0100', 'Maintenance Sleep', 120),
  wake('2031-01-01 22:27:45 +0100'),
  event('2031-01-01 22:27:45 +0100', 'WakeTime', 'WakeTime: 1.440 sec'),
  QUIET[2],
];
/** When each Sleep and DarkWake in SLEPT began, as pmset printed it. */
const SLEPT_AT = [
  '2031-01-01 22:20:00 +0100',
  '2031-01-01 22:25:00 +0100',
  '2031-01-01 22:25:45 +0100',
];

/** After the window: caffeinate ends, then the Mac sleeps from 23:10. */
const AFTER = [
  event(
    '2031-01-01 22:45:30 +0100',
    'Assertions',
    'PID 40001(caffeinate) ClientDied PreventUserIdleSystemSleep "caffeinate command-line tool" 00:45:29  id:0x0x100008dcb [System: No Assertions]',
  ),
  sleep('2031-01-01 23:10:00 +0100', 'Idle Sleep', 1200),
  darkWake('2031-01-01 23:30:00 +0100', 45),
  sleep('2031-01-01 23:30:45 +0100', 'Maintenance Sleep', 555),
  wake('2031-01-01 23:40:00 +0100'),
];

/** How the output ends: the time it was read, and the assertions held then. */
const closing = (readAt) => [
  '',
  'Total Sleep/Wakes since boot:15',
  '',
  `${readAt} : Showing all currently held IOKit power assertions`,
  'Assertion status system-wide:',
  '   BackgroundTask                 0',
  '   PreventUserIdleDisplaySleep    0',
  '   PreventSystemSleep             0',
  '   PreventUserIdleSystemSleep     0',
  'Kernel Assertions: 0x100=MAGICWAKE',
  '   id=507  level=255 0x100=MAGICWAKE creat=01/01/2031, 20:00  mod=01/01/2031, 23:40 description=en0 owner=IOSkywalkNetworkBSDClient',
];

/** The whole output of `pmset -g log`, read at 23:59 unless told otherwise. */
function log({
  before = BEFORE,
  inside = QUIET,
  after = AFTER,
  readAt = '2031-01-01 23:59:00 +0100',
  complete = true,
} = {}) {
  return [...before, ...inside, ...after, ...(complete ? closing(readAt) : [])].join('\n') + '\n';
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

/** Each of `times` is quoted by exactly one break. */
function quotesEach(breaks, times) {
  for (const time of times) {
    const quoting = breaks.filter((line) => line.includes(time));
    assert.equal(quoting.length, 1, `the event at ${time} is quoted by ${quoting.length} breaks`);
  }
}

test("SPIKE-01-AC13: each Sleep and DarkWake inside the run's window is one break, quoting the time pmset gave it", async () => {
  const breaks = await readSleeps({ text: log({ inside: SLEPT }), from: FROM, to: TO });
  assert.ok(Array.isArray(breaks), 'the breaks must be a list the judges take');
  assert.equal(breaks.length, 3, 'two sleeps and the dark wake between them');
  for (const line of breaks) {
    assert.equal(typeof line, 'string');
    assert.match(line, /sle(?:ep|pt)|dark ?wake/i, `"${line}" does not say the Mac slept`);
  }
  quotesEach(breaks, SLEPT_AT);
});

test("SPIKE-01-AC13: sleeps outside the window are no break, and inside it neither are caffeinate's assertions, the display turning off, nor lines that merely mention sleep", async () => {
  assert.deepEqual(await readSleeps({ text: log(), from: FROM, to: TO }), []);
});

test('SPIKE-01-AC13: a sleep that began before the window and lasted into it is a break; one that ended before it is not', async () => {
  const inside = [
    sleep('2031-01-01 21:50:00 +0100', 'Clamshell Sleep', 300), // 21:50 to 21:55
    wake('2031-01-01 21:55:00 +0100'),
    sleep('2031-01-01 21:58:00 +0100', 'Clamshell Sleep', 300), // 21:58 to 22:03
    wake('2031-01-01 22:03:00 +0100'),
    ...QUIET,
  ];
  const breaks = await readSleeps({ text: log({ inside }), from: FROM, to: TO });
  assert.equal(breaks.length, 1);
  quotesEach(breaks, ['2031-01-01 21:58:00 +0100']);
});

test('SPIKE-01-AC13: each line is read with its own UTC offset, so a run across the autumn clock change is read right', async () => {
  // Oslo leaves summer time at 01:00 UTC on 2031-10-26: 02:59:59 +0200 is
  // followed by 02:00:00 +0100, so the same wall-clock time comes twice.
  const from = Date.UTC(2031, 9, 26, 0, 30, 0); // 02:30 +0200
  const to = Date.UTC(2031, 9, 26, 1, 30, 0); // 02:30 +0100
  const text = [
    'PM ASL data store: /var/log/powermanagement',
    event(
      '2031-10-26 01:00:00 +0200',
      'Notification',
      'Display is turned off                                                      \t          ',
    ),
    sleep('2031-10-26 02:10:00 +0200', 'Idle Sleep', 600), // 00:10 to 00:20 UTC: before
    wake('2031-10-26 02:20:00 +0200'),
    sleep('2031-10-26 02:50:00 +0200', 'Clamshell Sleep', 1800), // 00:50 UTC: inside
    darkWake('2031-10-26 02:20:00 +0100', 45), // 01:20 UTC: inside
    sleep('2031-10-26 02:20:45 +0100', 'Maintenance Sleep', 300), // inside
    wake('2031-10-26 02:25:45 +0100'),
    sleep('2031-10-26 02:40:00 +0100', 'Idle Sleep', 600), // 01:40 UTC: after
    wake('2031-10-26 02:50:00 +0100'),
    ...closing('2031-10-26 03:00:00 +0100'),
  ].join('\n');
  const breaks = await readSleeps({ text, from, to });
  assert.equal(breaks.length, 3);
  quotesEach(breaks, [
    '2031-10-26 02:50:00 +0200',
    '2031-10-26 02:20:00 +0100',
    '2031-10-26 02:20:45 +0100',
  ]);
});

const NOT_A_LOG = [
  ['empty text', ''],
  ['the shell not finding pmset', 'zsh: command not found: pmset\n'],
  [
    'the settings `pmset -g` prints',
    [
      'System-wide power settings:',
      ' SleepDisabled\t\t0',
      'Currently in use:',
      ' lidwake              1',
      ' standby              1',
      ' hibernatemode        3',
      ' powernap             1',
    ].join('\n'),
  ],
  [
    'the assertions `pmset -g assertions` prints',
    [
      '2031-01-01 23:59:00 +0100 ',
      'Assertion status system-wide:',
      '   BackgroundTask                 0',
      '   PreventUserIdleSystemSleep     0',
      'Kernel Assertions: 0x100=MAGICWAKE',
    ].join('\n'),
  ],
  [
    "an Android device's log",
    '01-01 22:14:03.123  4321  4321 I ActivityManager: Start proc 4321:org.example.spike/u0a190\n',
  ],
];

test('SPIKE-01-AC13: text that is not `pmset -g log` output is refused, never read as "the Mac did not sleep"', async () => {
  for (const [what, text] of NOT_A_LOG) {
    await refuses(readSleeps({ text, from: FROM, to: TO }), what);
  }
});

test('SPIKE-01-AC13: a log that does not cover the whole window is refused: it starts after the run began, it was read before the run ended, or it is cut short', async () => {
  const rotated = log({
    before: ['PM ASL data store: /var/log/powermanagement'],
    inside: [QUIET[2]],
  });
  await refuses(
    readSleeps({ text: rotated, from: FROM, to: TO }),
    'the log begins at 22:30, half an hour into the run',
  );
  const early = log({ inside: QUIET.slice(0, 2), after: [], readAt: '2031-01-01 22:20:00 +0100' });
  await refuses(
    readSleeps({ text: early, from: FROM, to: TO }),
    'the log was read at 22:20, before the run ended at 22:45',
  );
  await refuses(
    readSleeps({ text: log({ inside: SLEPT, complete: false }), from: FROM, to: TO }),
    'the text stops before the line that says when it was read',
  );
});

test('SPIKE-01-AC13: a window that is not two wall-clock times in order is refused', async () => {
  const text = log({ inside: SLEPT });
  await refuses(readSleeps({ text, to: TO }), 'no start');
  await refuses(readSleeps({ text, from: FROM, to: Number.NaN }), 'an end that is not a time');
  await refuses(readSleeps({ text, from: TO, to: FROM }), 'the end before the start');
});

test("SPIKE-01-AC13: the reader's breaks make an S1 run invalid, with each break as evidence", async () => {
  // The receiver's records for the same run. The monotonic clock stood still
  // for the 7 min the Mac slept, so the ticks show no hole and the arrivals no
  // gap: only the wall clock moved on.
  const MONO0 = 7_000_000;
  const SLEPT_MS = 7 * MIN;
  const wall = (t) => FROM + t + (t >= 20 * MIN ? SLEPT_MS : 0);
  const at = (kind, t, fields) => ({ kind, at: wall(t), mono: MONO0 + t, ...fields });
  const times = (step, from, to) =>
    Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
  const records = [
    at('mark', 0, { label: 'journey-started' }),
    ...times(10 * S, 5 * S, 45 * MIN - 5 * S).map((t) => at('tick', t)),
    ...times(MIN, 30 * S, 44 * MIN + 30 * S).map((t) =>
      at('arrival', t, {
        platform: 'ios',
        recordId: `rec-${t}`,
        recordedAt: new Date(wall(t) - 2 * S).toISOString(),
        hasPosition: true,
        moving: true,
        queueCount: 0,
        permission: 'always',
        exempt: null,
      }),
    ),
    at('mark', 45 * MIN, { label: 'journey-ended' }),
  ].sort((a, b) => a.mono - b.mono);
  const [start, end] = ['journey-started', 'journey-ended'].map(
    (label) => records.find((record) => record.label === label).at,
  );

  const breaks = await readSleeps({ text: log({ inside: SLEPT }), from: start, to: end });
  assert.equal(breaks.length, 3);
  const result = await judgeS1({ records, breaks });
  assert.equal(result.status, 'invalid', 'a run the Mac slept through was judged');
  for (const line of breaks) {
    assert.ok(result.evidence.includes(line), `the break "${line}" is not in the evidence`);
  }
});
