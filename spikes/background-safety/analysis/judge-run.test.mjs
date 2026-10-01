// SPIKE-01: the per-run judge (analysis/judge-run.mjs), moved out of the
// drivers into the tested analysis (the code review's N4, the safety review's
// B2b and B2c, 2026-10-01). It judges one run's saved folder, given as data:
//
//   judgeRun({ meta, records, files, exit }) → { status, evidence, details }
//
// - meta: meta.json as an object, or null when the run left none;
// - records: the receiver's records, or null when the run left none;
// - files: each saved file by name, as text: pmset.txt, driver.jsonl,
//   notification.txt, audio.txt, expected-alert.json, telecom-before.txt,
//   telecom.txt, received.json, delivered.json, payload.json, crash.txt; and
//   capture.txt, the text of `tcpdump -tt -nn -r` on meta.capture;
// - exit: the driver's exit, { code, signal }.
//
// It reads no file and no clock, and never throws. The fixed alert, the app's
// id and the receiver's port are its own (app/src/fixed.json), and so is the
// emulator's network: none of them is passed in, so these tests hold the
// values the night's runs are re-judged with.
//
// Every record, dump and log line below is synthetic, in the format of the
// night's runs (night-20260930, read on 2026-10-01) or of the samples in
// ~/spike-runs/samples, cut down. No position, and no phone number but the
// masked one Telecom prints.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const judgeRun = async (input) => (await import('./judge-run.mjs')).judgeRun(input);

/** The app's fixed texts and the receiver's port: the file the app and the drivers read. */
const FIXED = JSON.parse(readFileSync(new URL('../app/src/fixed.json', import.meta.url), 'utf8'));
const APP = 'org.example.spike.backgroundsafety';
const PORT = FIXED.receiverPort;
const NOT_SHOWN = 'not shown on simulators';

const S = 1_000;
const MIN = 60 * S;
const WALL0 = Date.UTC(2031, 0, 1, 21, 0, 0);
const MONO0 = 7_000_000;

// The receiver's records, as in s1.test.mjs.

const tick = (t) => ({ kind: 'tick', at: WALL0 + t, mono: MONO0 + t });
const mark = (label, t) => ({ kind: 'mark', label, at: WALL0 + t, mono: MONO0 + t });
const arrival = (t, fields = {}) => ({
  kind: 'arrival',
  at: WALL0 + t,
  mono: MONO0 + t,
  platform: 'android',
  recordId: `rec-${t}`,
  recordedAt: new Date(WALL0 + t - 2 * S).toISOString(),
  hasPosition: true,
  moving: true,
  queueCount: 0,
  permission: 'always/precise',
  exempt: true,
  ...fields,
});

/** Times from `from` to `to`, `step` apart, both ends included. */
const every = (step, from, to) =>
  Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

const byMono = (a, b) => a.mono - b.mono;

/** A journey's records: its marks, the receiver's ticks every 10 s, and the arrivals. */
function journey({ end, arrivals = [], marks = [] }) {
  return [
    mark('journey-started', 0),
    ...marks,
    ...every(10 * S, -5 * S, end + 5 * S).map(tick),
    ...arrivals,
    mark('journey-ended', end),
  ].sort(byMono);
}
/** The receiver's ticks alone, for a scenario with no journey (S5, S6). */
const ticksOnly = (end) => every(10 * S, 10 * S, end).map(tick);

// `pmset -g log`, as in pmset.test.mjs, with every time at +0000.

const pad = (n) => String(n).padStart(2, '0');
function stamp(ms) {
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}
const pmEvent = (ms, domain, message) => `${stamp(ms)} ${domain.padEnd(20)}\t${message}   `;

/** The log over the run's window, with a Sleep at each [ms, secs] in `sleeps`. */
function pmsetLog({ startedAt, endedAt }, sleeps = []) {
  return (
    [
      'PM ASL data store: /var/log/powermanagement',
      pmEvent(startedAt - 30 * MIN, 'Notification', 'Display is turned off'),
      pmEvent(
        startedAt - 10 * MIN,
        'Assertions',
        'PID 40001(caffeinate) Summary PreventUserIdleSystemSleep "caffeinate command-line tool" 00:10:00  id:0x0x100008dcb [System: PrevIdle DeclUser kDisp]',
      ),
      ...sleeps.map(([at, secs]) =>
        pmEvent(
          at,
          'Sleep',
          `Entering Sleep state due to 'Clamshell Sleep':TCPKeepAlive=active Using AC (Charge:100%) ${secs} secs`,
        ),
      ),
      '',
      'Total Sleep/Wakes since boot:15',
      '',
      `${stamp(endedAt + 2 * MIN)} : Showing all currently held IOKit power assertions`,
      'Assertion status system-wide:',
      '   PreventUserIdleSystemSleep     0',
    ].join('\n') + '\n'
  );
}

/** driver.jsonl: one step per line, as the driver logs it. */
const driverLog = (steps) => steps.map((step) => JSON.stringify(step)).join('\n') + '\n';

/** meta.json as run.close() writes it. */
function metaOf(scenario, platform, runCase, { startedAt, endedAt, ...extra }) {
  return {
    runId: `night-20310101-${scenario}-${platform}${runCase ? `-${runCase}` : ''}-1`,
    scenario,
    platform,
    runCase,
    dry: false,
    startedAt,
    endedAt,
    breaks: [],
    build: { platform, commit: '0000000' },
    ...extra,
  };
}

/** The judge's input for one run: pmset.txt over its window unless `files` gives one. */
const runOf = ({ meta, records, files = {}, exit = { code: 0, signal: null }, sleeps = [] }) => ({
  meta,
  records,
  files: { 'pmset.txt': pmsetLog(meta, sleeps), ...files },
  exit,
});

// S1, and the AC12 capture it carries.

const S1_END = 45 * MIN;
const s1Meta = (extra = {}) =>
  metaOf('s1', 'android', null, {
    startedAt: WALL0 - 90 * S,
    endedAt: WALL0 + S1_END + 10 * S,
    ...extra,
  });
/** Arrivals every minute: no gap. */
const steady = (end = S1_END) =>
  journey({ end, arrivals: every(MIN, 30 * S, end - MIN).map((t) => arrival(t)) });
/** Arrivals every minute but for a gap of 200 s, from 10 min 30 s to 13 min 50 s. */
const withGap = (end = S1_END) =>
  journey({
    end,
    arrivals: [
      ...every(MIN, 30 * S, 10 * MIN + 30 * S),
      ...every(MIN, 13 * MIN + 50 * S, end - MIN),
    ].map((t) => arrival(t)),
  });

/**
 * The capture's clock is not the Mac's. On the night's S1 pcap, all 69 of the
 * run's uploads to the receiver match its 69 arrivals when the pcap's times
 * are taken as 3603.3 to 3603.65 s behind the Mac's; on the S8 pcap the first
 * upload sits the same distance from its arrival. And the pcap kept growing
 * after the run, for hours (its last upload is 4 h after the run ended). So
 * the run's window has to be found on the capture's own clock.
 */
const LAG = 3_603_500;
/** The emulator's own IPv6 address, as the dry probe and the night's capture saw it. */
const DEVICE6 = 'fec0::5054:ff:fe12:3456';
/** One `tcpdump -tt -nn` line for something that happened at `macMs` on the Mac's clock. */
const capturedAt = (macMs, rest) => `${((macMs - LAG) / 1000).toFixed(6)} ${rest}`;

/**
 * The text of `tcpdump -tt -nn -r capture.pcap` for an S1 run: the device
 * coming up, the platform's lookups and connections over both families, one
 * upload per arrival, `extra` ([macMs, line] pairs), and a later run on the
 * same emulator two hours after this one.
 */
function captureText(meta, records, extra = []) {
  const s = meta.startedAt;
  const uploads = records
    .filter((record) => record.kind === 'arrival')
    .flatMap((a, i) => [
      [
        a.at - 120,
        `IP 10.0.2.15.${54000 + i} > 10.0.2.2.${PORT}: Flags [P.], seq 1:260, ack 1, win 65535, length 259`,
      ],
      [
        a.at - 60,
        `IP 10.0.2.2.${PORT} > 10.0.2.15.${54000 + i}: Flags [P.], seq 1:20, ack 260, win 65535, length 19`,
      ],
    ]);
  const later = meta.endedAt + 120 * MIN;
  const lines = [
    [
      s + 75 * S,
      'IP6 :: > ff02::1:ff12:3456: ICMP6, neighbor solicitation, who has fe80::5054:ff:fe12:3456, length 32',
    ],
    [
      s + 76 * S,
      'IP6 fe80::5054:ff:fe12:3456 > ff02::16: HBH ICMP6, multicast listener report v2, 1 group record(s), length 28',
    ],
    [s + 77 * S, 'ARP, Request who-has 10.0.2.3 tell 10.0.2.15, length 28'],
    [s + 78 * S, 'IP 10.0.2.15.40001 > 10.0.2.3.53: 4101+ A? connectivitycheck.gstatic.com. (47)'],
    [s + 78 * S + 10, 'IP 10.0.2.3.53 > 10.0.2.15.40001: 4101 1/0/0 A 192.0.2.10 (63)'],
    [
      s + 78 * S + 20,
      'IP 10.0.2.15.50001 > 192.0.2.10.443: Flags [S], seq 1000, win 65535, length 0',
    ],
    [s + 79 * S, 'IP 10.0.2.15.40002 > 10.0.2.3.53: 4102+ AAAA? android.clients.google.com. (44)'],
    [
      s + 79 * S + 10,
      'IP 10.0.2.3.53 > 10.0.2.15.40002: 4102 2/0/0 CNAME android.l.google.com., AAAA 2001:db8::10 (100)',
    ],
    [
      s + 79 * S + 20,
      `IP6 ${DEVICE6}.60920 > 2001:db8::10.443: Flags [S], seq 3000, win 65535, length 0`,
    ],
    [
      s + 79 * S + 30,
      `IP6 fe80::2 > ${DEVICE6}: ICMP6, destination unreachable, unreachable address 2001:db8::10, length 88`,
    ],
    ...uploads,
    ...extra,
    [later, 'IP 10.0.2.15.40100 > 10.0.2.3.53: 6101+ A? tracker.transistorsoft.com. (44)'],
    [later + 10, 'IP 10.0.2.3.53 > 10.0.2.15.40100: 6101 1/0/0 A 198.51.100.20 (60)'],
    [later + 20, 'IP 10.0.2.15.50100 > 198.51.100.20.443: Flags [S], seq 1, win 65535, length 0'],
    [later + MIN, 'IP 10.0.2.15.50101 > 203.0.113.40.443: Flags [S], seq 1, win 65535, length 0'],
    [
      later + 2 * MIN,
      `IP6 ${DEVICE6}.50102 > 2001:db8::99.443: Flags [S], seq 1, win 65535, length 0`,
    ],
    [
      later + 3 * MIN,
      `IP 10.0.2.15.54999 > 10.0.2.2.${PORT}: Flags [P.], seq 1:260, ack 1, win 65535, length 259`,
    ],
  ].sort((a, b) => a[0] - b[0]);
  return (
    [
      'reading from file capture.pcap, link-type EN10MB (Ethernet), snapshot length 262144',
      ...lines.map(([at, rest]) => capturedAt(at, rest)),
    ].join('\n') + '\n'
  );
}

const S1_CAPTURE = { capture: 'capture.pcap', wifiOffForCapture: true };
/** The S1 run that carries the capture, its records being `records`. */
const capturedRun = (records, extra = []) => {
  const meta = s1Meta(S1_CAPTURE);
  return runOf({ meta, records, files: { 'capture.txt': captureText(meta, records, extra) } });
};
const AFTER_THE_RUN = ['198.51.100.20', '203.0.113.40', '2001:db8::99'];
const listed = (capture) => capture.destinations.map((d) => `${d.address} ${d.port} ${d.owner}`);

test("SPIKE-01-AC12: the S1 run's capture is judged on its own, sees the device over IPv6, keeps its destinations, and is cut to the run on the capture's own clock", async () => {
  const result = await judgeRun(capturedRun(steady()));
  assert.equal(result.status, 'passed', "S1's own verdict");
  const capture = result.details.capture;
  assert.equal(capture?.status, 'passed', 'the capture is not judged on its own');
  assert.deepEqual(capture.flagged, []);
  assert.ok(Array.isArray(capture.destinations), 'the destinations are not kept');
  assert.ok(
    listed(capture).includes('2001:db8::10 443 platform'),
    "the device's IPv6 connection is not listed",
  );
  assert.ok(listed(capture).includes(`10.0.2.2 ${PORT} receiver`), 'the receiver is not listed');
  for (const address of AFTER_THE_RUN) {
    assert.equal(
      capture.destinations.some((d) => d.address === address),
      false,
      `${address}, from a later run on the same emulator, is listed`,
    );
  }
});

test("SPIKE-01-AC12: the vendor reached from the device's IPv6 address during the run fails the capture, and leaves S1's verdict alone", async () => {
  const vendor = [
    [
      WALL0 + 10 * MIN,
      'IP 10.0.2.15.40003 > 10.0.2.3.53: 4103+ AAAA? tracker.transistorsoft.com. (44)',
    ],
    [WALL0 + 10 * MIN + 10, 'IP 10.0.2.3.53 > 10.0.2.15.40003: 4103 1/0/0 AAAA 2001:db8::66 (72)'],
    [
      WALL0 + 10 * MIN + 20,
      `IP6 ${DEVICE6}.60930 > 2001:db8::66.443: Flags [S], seq 1, win 65535, length 0`,
    ],
  ];
  const result = await judgeRun(capturedRun(steady(), vendor));
  assert.equal(result.status, 'passed', "the capture's failure changed S1's verdict");
  assert.equal(result.details.capture?.status, 'failed');
  assert.ok(result.details.capture.flagged.some((flag) => flag.owner === 'vendor'));
  assert.ok(listed(result.details.capture).includes('2001:db8::66 443 vendor'));
});

test("SPIKE-01-AC12: S1's verdict and the capture's never decide each other: a gap fails S1 with the capture passed", async () => {
  const result = await judgeRun(capturedRun(withGap()));
  assert.equal(result.status, 'failed');
  assert.equal(result.details.capture?.status, 'passed');
});

test("SPIKE-01-AC12: a capture that cannot be read is the capture's own invalid result: it never changes S1's status or its evidence", async () => {
  const unreadable = [
    [
      'tcpdump could not read the pcap',
      { 'capture.txt': 'tcpdump: capture.pcap: No such file or directory\n' },
    ],
    ['no capture text at all', {}],
  ];
  for (const [what, files] of unreadable) {
    for (const [records, s1] of [
      [steady(), 'passed'],
      [withGap(), 'failed'],
    ]) {
      const result = await judgeRun(runOf({ meta: s1Meta(S1_CAPTURE), records, files }));
      assert.equal(result.status, s1, `${what}: S1 became ${result.status}`);
      assert.equal(result.details.capture?.status, 'invalid', `${what}: the capture's status`);
      assert.doesNotMatch(
        result.evidence.join('\n'),
        /capture|tcpdump|pcap/i,
        `${what}: the capture's error reached S1's evidence`,
      );
    }
  }
});

// A driver that exited non-zero (the safety review's B2c): the runner used to
// record such a run as invalid without judging it, and re-run it. Its records
// are judged: a failure they show is failed; otherwise the run is invalid,
// with the exit as its evidence, and never passed.

const THREW = { code: 1, signal: null };
const TIMED_OUT = { code: null, signal: 'SIGTERM' };

test('SPIKE-01-AC13: a driver that exited non-zero: its records are still judged, and a failure they show is failed', async () => {
  // The driver threw at 30 min; runJourney writes the end mark on its way out.
  const shortWithGap = withGap(30 * MIN);
  for (const exit of [THREW, TIMED_OUT]) {
    const s1 = await judgeRun(
      runOf({ meta: s1Meta({ endedAt: WALL0 + 30 * MIN + 10 * S }), records: shortWithGap, exit }),
    );
    assert.equal(
      s1.status,
      'failed',
      `S1, exit ${JSON.stringify(exit)}: a gap seen was left to a re-run`,
    );
  }

  // S7: the driver threw 2 min after the change; nothing reported it.
  const s7 = await judgeRun(
    runOf({
      meta: metaOf('s7', 'android', 'fine', {
        startedAt: WALL0 - 30 * S,
        endedAt: WALL0 + 5 * MIN + 10 * S,
      }),
      records: journey({
        end: 5 * MIN,
        marks: [mark('permission-reduced', 3 * MIN)],
        arrivals: every(30 * S, 15 * S, 2 * MIN + 45 * S).map((t) => arrival(t)),
      }),
      files: {
        'driver.jsonl': driverLog([
          { at: WALL0 + 3 * MIN, mono: 200_000, step: 'mark', label: 'permission-reduced' },
          {
            at: WALL0 + 3 * MIN + 3_387,
            mono: 203_387,
            step: 'revoked',
            permission: 'android.permission.ACCESS_FINE_LOCATION',
            processEnded: true,
          },
          { at: WALL0 + 5 * MIN, mono: 320_000, step: 'mark', label: 'journey-ended' },
        ]),
      },
      exit: THREW,
    }),
  );
  assert.equal(s7.status, 'failed', 'S7: a report that never came was left to a re-run');
});

test('SPIKE-01-AC13: a driver that exited non-zero, whose records show no failure, makes the run invalid, never passed, with the exit as evidence', async () => {
  for (const [exit, says] of [
    [THREW, /\b1\b/],
    [TIMED_OUT, /SIGTERM/],
  ]) {
    const result = await judgeRun(runOf({ meta: s1Meta(), records: steady(), exit }));
    assert.equal(result.status, 'invalid', `exit ${JSON.stringify(exit)} was passed`);
    const evidence = result.evidence.join('\n');
    assert.match(evidence, /exit|killed/i, 'the evidence does not say the driver failed');
    assert.match(evidence, says, 'the evidence does not give the exit');
  }
});

// The run's breaks: the driver's own (meta.breaks, with no time) and the Mac's
// sleeps in the run's window (pmset.txt, through readSleeps, with their span).

test("SPIKE-01-AC13: the Mac's sleeps reach the judge with their span: one over the gap makes S1 invalid, one elsewhere leaves the gap failed, and a driver's break makes it invalid", async () => {
  const over = await judgeRun(
    runOf({ meta: s1Meta(), records: withGap(), sleeps: [[WALL0 + 11 * MIN, 60]] }),
  );
  assert.equal(
    over.status,
    'invalid',
    "the Mac's sleep during the gap was judged as a silent phone",
  );
  assert.match(over.evidence.join('\n'), /slept|sleep/i);

  const elsewhere = await judgeRun(
    runOf({ meta: s1Meta(), records: withGap(), sleeps: [[WALL0 + 35 * MIN, 60]] }),
  );
  assert.equal(elsewhere.status, 'failed', 'a sleep after the gap rescued it');
  assert.match(elsewhere.evidence.join('\n'), /slept|sleep/i, 'the sleep is not in the evidence');

  const driverBreak = await judgeRun(
    runOf({
      meta: s1Meta({ breaks: ['the receiver exited before the run ended'] }),
      records: withGap(),
    }),
  );
  assert.equal(driverBreak.status, 'invalid');
  assert.ok(driverBreak.evidence.includes('the receiver exited before the run ended'));
});

// S5 on Android (the safety review's B2b, the code review's S6): "seen",
// "heard" and the alert's text are three results, each in the details. The
// run's status never hides "heard": a sound the records show going to a muted
// stream fails the run, and "heard" not shown leaves it passed with that said
// beside it. Seen and the text failing fail it too.

/** One NotificationRecord in the "Notification List", in the real dump's format, cut down. */
function notificationRecord({ title, text, created, intercept = false, usage, bypassDnd = true }) {
  const tag = '00000000-0000-4000-8000-0000000000a1';
  const key = `0|${APP}|0|${tag}|10231`;
  const attributes = `AudioAttributes: usage=${usage} content=CONTENT_TYPE_SONIFICATION flags=0x800(FLAG_MUTE_HAPTIC)  tags= bundle=null`;
  const extra = (name) =>
    text === null ? `                ${name}=null` : `                ${name}=String (${text})`;
  return [
    `    NotificationRecord(0x01bb4529: pkg=${APP} user=UserHandle{0} id=0 tag=${tag} importance=5 key=${key}: Notification(channel=alert shortcut=null contentView=null vibrate=null sound=null defaults=0 flags=AUTO_CANCEL color=0x00000000 vis=PRIVATE template=android.app.Notification$BigTextStyle))`,
    '      uid=10231 userId=0',
    `      opPkg=${APP}`,
    '      flags=AUTO_CANCEL',
    `      key=${key}`,
    '      notification=',
    `            when=${created - 8}/${created - 8}`,
    '            extras={',
    `                android.title=String (${title})`,
    '                android.reduced.images=Boolean (true)',
    '                expo.notification_request=byte[] (4)',
    '                  [0] 36',
    '                  [1] 0',
    '                  [2] 0',
    '                  [3] 0',
    '                android.template=String (android.app.Notification$BigTextStyle)',
    extra('android.text'),
    `                android.appInfo=ApplicationInfo (ApplicationInfo{7381e4f ${APP}})`,
    '                android.showWhen=Boolean (true)',
    extra('android.bigText'),
    '            }',
    '      publicNotification=',
    '            None',
    '      mImportance=MAX',
    '      mImportanceExplanation=app',
    `      mIntercept=${intercept}`,
    '      mHidden==false',
    `      mCreationTimeMs=${created}`,
    `      mInterruptionTimeMs=${created + 254}`,
    `      mAttributes= ${attributes}`,
    `      effectiveNotificationChannel=NotificationChannel{mId='alert', mName=Alerts, mDescription=, mImportance=5, mBypassDnd=${bypassDnd}, mLockscreenVisibility=-1000, mAudioAttributes=${attributes}, mBlockableSystem=false}`,
  ];
}

/** `dumpsys notification --noredact` with the alert's record, changed by `change`. */
const notificationDump = (change = {}) =>
  [
    'Current Notification Manager state:',
    '  Notification List:',
    ...notificationRecord({
      title: FIXED.alert.title,
      text: FIXED.alert.body,
      created: WALL0 + 10 * S,
      usage: 'USAGE_NOTIFICATION',
      ...change,
    }),
    '  ',
    '  mMaxPackageEnqueueRate=5.0',
    '',
    '  Notification attention state:',
    '      mSoundNotificationKey=null',
  ].join('\n') + '\n';

/** `dumpsys audio`, cut down, after S5 on a silenced device: the ringer mutes NOTIFICATION. */
function audioDump() {
  const muted = [
    'STREAM_SYSTEM',
    'STREAM_RING',
    'STREAM_NOTIFICATION',
    'STREAM_SYSTEM_ENFORCED',
    'STREAM_DTMF',
  ];
  const streams = [
    'STREAM_VOICE_CALL',
    'STREAM_SYSTEM',
    'STREAM_RING',
    'STREAM_MUSIC',
    'STREAM_ALARM',
    'STREAM_NOTIFICATION',
  ];
  return (
    [
      'AudioService Dumpsys',
      'Current time: Wed Jan 01 22:00:42 GMT+01:00 2031',
      '',
      '# Stream activity',
      '### Playback activity',
      '  01-01 21:50:50:678 new player piid:95 uid/pid:1000/699 package:com.android.inputdevices type:android.media.SoundPool attr:AudioAttributes: usage=USAGE_ASSISTANCE_SONIFICATION content=CONTENT_TYPE_SONIFICATION flags=0x800(FLAG_MUTE_HAPTIC)  tags= bundle=null session:0',
      '',
      '# Volume state',
      '',
      'Stream volumes (device: index)',
      ...streams.flatMap((name) => [
        `- ${name}:`,
        `   Muted: ${muted.includes(name)}`,
        '   Min: 0',
        '   Max: 7',
        '',
      ]),
      'Ringer mode: ',
      '- mode (internal) = SILENT',
      '- mode (external) = SILENT',
      '- zen mode:ZEN_MODE_IMPORTANT_INTERRUPTIONS',
      `- ringer mode muted streams = 0x1a6 (${muted.join(',')})`,
      '- delegate = ZenModeHelper',
    ].join('\n') + '\n'
  );
}

/** One S5 run on Android, its alert's record changed by `change`. */
const s5Android = (change = {}) =>
  runOf({
    meta: metaOf('s5', 'android', null, {
      startedAt: WALL0 - 5 * S,
      endedAt: WALL0 + 45 * S,
      silenced: { dnd: 'priority', ringer: 'SILENT' },
    }),
    records: ticksOnly(40 * S),
    files: {
      'notification.txt': notificationDump(change),
      'audio.txt': audioDump(),
      'expected-alert.json': `${JSON.stringify(FIXED.alert, null, 2)}\n`,
      'crash.txt': '--------- beginning of crash\n',
    },
  });

const VERDICT_WORDS = new Set(['passed', 'failed', NOT_SHOWN]);

test('SPIKE-01-AC9: S5 on Android, the night\'s case: seen, its text exact, and its sound sent to a stream the silent ringer mutes: three results, and the status does not hide "heard"', async () => {
  const result = await judgeRun(s5Android());
  assert.equal(result.details.seen, 'passed');
  assert.equal(result.details.text, 'passed');
  assert.equal(result.details.heard, 'failed');
  assert.equal(result.status, 'failed', 'a sound sent to a muted stream was hidden under a pass');
});

test('SPIKE-01-AC9: S5 on Android: with no record of a sound, "heard" is not shown, said beside a passed status', async () => {
  const result = await judgeRun(s5Android({ usage: 'USAGE_ALARM' }));
  assert.equal(result.details.seen, 'passed');
  assert.equal(result.details.text, 'passed');
  assert.equal(result.details.heard, NOT_SHOWN);
  assert.equal(result.status, 'passed');
});

test("SPIKE-01-AC9: S5 on Android: the alert's shown text is compared with the fixed alert, and a text that differs fails the run", async () => {
  const result = await judgeRun(s5Android({ text: `${FIXED.alert.body.slice(0, -1)}!` }));
  assert.equal(result.details.seen, 'passed', 'the alert was still seen');
  assert.equal(result.details.text, 'failed', 'the changed text was not caught');
  assert.equal(result.status, 'failed');

  const none = await judgeRun(s5Android({ text: null }));
  assert.equal(none.details.text, 'failed', 'an alert with no text passed the text check');
});

test('SPIKE-01-AC9: S5 on Android: an alert Do Not Disturb intercepted is not seen, and "heard" is still reported', async () => {
  const result = await judgeRun(s5Android({ intercept: true }));
  assert.equal(result.details.seen, 'failed');
  assert.ok(VERDICT_WORDS.has(result.details.heard), '"heard" is missing from the details');
  assert.equal(result.status, 'failed');
});

// S5 on iOS (the safety review's S3): "presented" means the background push.
// The driver pushes twice: with the app in front (received.json), then with
// it in the background. Its second "pushed" step is logged after simctl
// returns: on the night (night-20260930-s5-ios-1) the platform delivered the
// background alert 8 ms before that step. The step before the second push is
// "app-backgrounded"; the times below keep the night's spacing.

const IOS_START = WALL0 + 20 * S;
const FOREGROUND_ID = '9C6964A0-0000-4000-8000-000000000001';
const BACKGROUND_ID = '93530EA4-0000-4000-8000-000000000002';
const PUSHED = {
  aps: {
    alert: { title: FIXED.alert.title, body: FIXED.alert.body },
    sound: 'default',
    'interruption-level': 'time-sensitive',
  },
};
const IOS_STEPS = [
  [0, 'run-opened', { scenario: 's5', platform: 'ios' }],
  [3_384, 'app-launched'],
  [17_915, 'pushed'],
  [18_220, 'saved', { name: 'received.json', bytes: 450 }],
  [18_989, 'app-backgrounded'],
  [18_989, 'hold', { why: 'the app in the background', seconds: 3 }],
  [22_175, 'pushed'],
  [22_175, 'hold', { why: 'S5: the alert, delivered in the background', seconds: 5 }],
  [27_842, 'app-launched'],
  [30_383, 'saved', { name: 'delivered.json', bytes: 320 }],
].map(([t, step, detail = {}]) => ({ at: IOS_START + t, mono: 300 + t, step, ...detail }));
const deliveredEntry = (id, t) => ({ id, title: FIXED.alert.title, deliveredAt: IOS_START + t });

/** One S5 run on iOS whose delivered list holds `delivered`. */
const s5Ios = (delivered) =>
  runOf({
    meta: metaOf('s5', 'ios', null, {
      startedAt: IOS_START,
      endedAt: IOS_START + 31 * S,
      interruptionLevel: 'time-sensitive',
    }),
    records: ticksOnly(50 * S),
    files: {
      'driver.jsonl': driverLog(IOS_STEPS),
      'payload.json': `${JSON.stringify(PUSHED, null, 2)}\n`,
      'received.json': `${JSON.stringify(
        {
          notification: {
            id: FOREGROUND_ID,
            title: FIXED.alert.title,
            body: FIXED.alert.body,
            data: null,
            payload: PUSHED,
            deliveredAt: IOS_START + 17_825,
          },
          writtenAt: IOS_START + 17_911,
        },
        null,
        2,
      )}\n`,
      'delivered.json': `${JSON.stringify({ delivered, writtenAt: IOS_START + 28_357 }, null, 2)}\n`,
    },
  });

test('SPIKE-01-AC9: S5 on iOS: presented is the background push, delivered after the app went to the background, even when that delivery is logged before the driver\'s own "pushed" step', async () => {
  const result = await judgeRun(
    s5Ios([deliveredEntry(BACKGROUND_ID, 22_167), deliveredEntry(FOREGROUND_ID, 17_825)]),
  );
  assert.equal(
    result.details.presented,
    true,
    'the background delivery was not taken as presented',
  );
  assert.equal(result.status, 'passed');
});

test('SPIKE-01-AC9: S5 on iOS: the foreground push alone is not presented, and the run fails', async () => {
  const result = await judgeRun(s5Ios([deliveredEntry(FOREGROUND_ID, 17_825)]));
  assert.equal(result.details.presented, false);
  assert.equal(result.status, 'failed');
});

// S6 (AC10): the behaviour observed, per case: whether the tap alone started
// a call, the permission the case had, and who placed the call in Telecom's
// record (the app itself, or nobody: the dialer waits for a second tap).

const TELEPHONY =
  'ComponentInfo{com.android.phone/com.android.services.telephony.TelephonyConnectionService}, 1, UserHandle{0}';
/** `dumpsys telecom`, cut down to its "Historical Events", with `calls`. */
const telecomDump = (...calls) =>
  [
    'Init Path: On mainline',
    'CallsManager: ',
    '  mCalls: ',
    `  defaultOutgoing: ${TELEPHONY}`,
    'Historical Events:',
    ...calls.flat(),
  ].join('\n') + '\n';
/** One outgoing call that `by` placed, dialled, then ended by the network. */
const outgoingCall = (id, by = APP) => [
  `  CallTC@${id}/1112 [1. jan. 2031 21:00:00](MO - outgoing)(User=UserHandle{0})`,
  `  \t>>>Target PhoneAccount: ${TELEPHONY} (T-Mobile)`,
  '  \tTo address: tel:***********23 Presentation: Allowed',
  `    21:00:00.556 - CREATED (${by};requestedAcct:none, selfMgd:false):TSI.pC(cgat)@AOA`,
  `    21:00:00.575 - SET_CONNECTING (${TELEPHONY}):TSI.pC->CM.fOCP(cgat)@AOA`,
  '    21:00:02.599 - SET_DIALING (dialing set explicitly):CSW.hCCC(cap/cast)@E-E-AOM',
  '    21:00:02.743 - SET_DISCONNECTED (disconnected set explicitly):CSW.sDc(cap)@AQA',
  '    21:00:03.007 - DESTROYED:CSW.rC->CM.pR(cap)@AQ0',
];

/** One S6 run: an earlier run's call is already in Telecom's history; `after` is the dump after the tap. */
const s6Run = (runCase, callPhone, after) =>
  runOf({
    meta: metaOf('s6', 'android', runCase, {
      startedAt: WALL0,
      endedAt: WALL0 + 35 * S,
      callPhone,
      number: 'the synthetic number in app/src/fixed.json',
    }),
    records: ticksOnly(30 * S),
    files: {
      'telecom-before.txt': telecomDump(outgoingCall(3)),
      'telecom.txt': after,
      'crash.txt': '--------- beginning of crash\n',
    },
  });

test('SPIKE-01-AC10: S6 with CALL_PHONE: the tap alone started a call, which the app itself placed', async () => {
  const result = await judgeRun(s6Run('with', true, telecomDump(outgoingCall(3), outgoingCall(7))));
  assert.equal(result.status, 'passed', 'the behaviour was observed');
  assert.equal(result.details.callPhone, true);
  assert.equal(result.details.callStarted, true);
  assert.equal(result.details.placedBy, APP);
});

test("SPIKE-01-AC10: S6 without CALL_PHONE: no call started on the tap, and nobody placed one; the earlier run's call does not count", async () => {
  const result = await judgeRun(s6Run('without', false, telecomDump(outgoingCall(3))));
  assert.equal(result.status, 'passed', 'the behaviour was observed');
  assert.equal(result.details.callPhone, false);
  assert.equal(result.details.callStarted, false);
  assert.equal(result.details.placedBy, null);
});

// S7: what the go/no-go needs from each run, per run (the safety review's
// B1): whether the platform ended the app's process on the change, from the
// driver's own step (Android's "revoked", iOS's "reduced"), and how many
// arrivals came after the change.

const CHANGE = 3 * MIN;
const S7_END = 6 * MIN;
/** Arrivals every 30 s before the change; after it, from `back` on, if the app came back. */
const s7Records = (back) =>
  journey({
    end: S7_END,
    marks: [mark('permission-reduced', CHANGE)],
    arrivals: [
      ...every(30 * S, 15 * S, CHANGE - 15 * S).map((t) => arrival(t)),
      ...(back === null
        ? []
        : every(30 * S, CHANGE + back, S7_END - 5 * S).map((t) =>
            arrival(t, { permission: 'whenInUse/precise', hasPosition: false }),
          )),
    ],
  });
const s7Steps = (step, detail) =>
  driverLog([
    { at: WALL0, mono: 14_264, step: 'mark', label: 'journey-started' },
    { at: WALL0 + CHANGE, mono: 14_264 + CHANGE, step: 'mark', label: 'permission-reduced' },
    { at: WALL0 + CHANGE + 3_238, mono: 14_264 + CHANGE + 3_238, step, ...detail },
    { at: WALL0 + S7_END, mono: 14_264 + S7_END, step: 'mark', label: 'journey-ended' },
  ]);
const s7Run = (platform, runCase, back, steps) =>
  runOf({
    meta: metaOf('s7', platform, runCase, {
      startedAt: WALL0 - 30 * S,
      endedAt: WALL0 + S7_END + 5 * S,
    }),
    records: s7Records(back),
    files: { 'driver.jsonl': steps },
  });

test("SPIKE-01-AC11: S7 on Android, the fine case: the platform ended the app's process and nothing arrived after the change; the run is failed, and says both", async () => {
  const result = await judgeRun(
    s7Run(
      'android',
      'fine',
      null,
      s7Steps('revoked', {
        permission: 'android.permission.ACCESS_FINE_LOCATION',
        processEnded: true,
      }),
    ),
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.details.processEnded, true);
  assert.equal(result.details.arrivalsAfterChange, 0);
});

test('SPIKE-01-AC11: S7 on Android, the background case: the process ended and the app came straight back, so arrivals after the change count', async () => {
  const result = await judgeRun(
    s7Run(
      'android',
      'background',
      6_600,
      s7Steps('revoked', {
        permission: 'android.permission.ACCESS_BACKGROUND_LOCATION',
        processEnded: true,
      }),
    ),
  );
  assert.equal(result.status, 'passed');
  assert.equal(result.details.processEnded, true);
  assert.ok(
    result.details.arrivalsAfterChange > 0,
    'the arrivals after the restart are not counted',
  );
});

test('SPIKE-01-AC11: S7 on iOS: a process still running after the change did not end', async () => {
  const result = await judgeRun(
    s7Run('ios', 'always-to-inuse', 237, s7Steps('reduced', { processRunning: true })),
  );
  assert.equal(result.status, 'passed');
  assert.equal(result.details.processEnded, false);
});

test('SPIKE-01-AC13: an S7 run the Mac slept through is invalid, with the sleep as evidence', async () => {
  const run = s7Run(
    'android',
    'background',
    6_600,
    s7Steps('revoked', {
      permission: 'android.permission.ACCESS_BACKGROUND_LOCATION',
      processEnded: true,
    }),
  );
  const slept = {
    ...run,
    files: { ...run.files, 'pmset.txt': pmsetLog(run.meta, [[WALL0 + 4 * MIN, 60]]) },
  };
  const result = await judgeRun(slept);
  assert.equal(result.status, 'invalid');
  assert.match(result.evidence.join('\n'), /slept|sleep/i);
});

test('SPIKE-01-AC13: a run that cannot be judged is invalid with the reason, never an exception: no meta.json, no records, no pmset log, or a scenario it does not know', async () => {
  const records = steady();
  const cases = [
    ['no meta.json', { meta: null, records, files: {}, exit: THREW }],
    ['no receiver records', runOf({ meta: s1Meta(), records: null })],
    ['no pmset log', { ...runOf({ meta: s1Meta(), records }), files: {} }],
    ['an unknown scenario', runOf({ meta: { ...s1Meta(), scenario: 's9' }, records })],
  ];
  for (const [what, input] of cases) {
    let result;
    try {
      result = await judgeRun(input);
    } catch (error) {
      if (error?.code === 'ERR_MODULE_NOT_FOUND') throw error;
      assert.fail(`${what}: it threw (${error?.message})`);
    }
    assert.equal(result.status, 'invalid', what);
    assert.ok(result.evidence.length > 0, `${what}: invalid without saying why`);
  }
});
