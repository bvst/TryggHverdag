// SPIKE-01: the S5 payload check (analysis/s5.mjs): the alert's payload and
// its shown text match the fixed, content-free alert exactly, with no other
// keys or values. The text below is made up for the test and names no one.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const checkAlert = async (input) => (await import('./s5.mjs')).checkAlert(input);

const TEXT = 'Test alert. Open the app.';
/** The fixed alert, as `simctl push` delivers it at the Time Sensitive level. */
const EXPECTED = {
  payload: {
    aps: {
      alert: { title: 'Spike alert', body: TEXT },
      'interruption-level': 'time-sensitive',
      sound: 'default',
    },
  },
  text: TEXT,
};

/** What was delivered, starting from an exact copy of the fixed alert and changed by `change`. */
function delivered(change = () => {}) {
  const copy = { payload: structuredClone(EXPECTED.payload), shownText: TEXT };
  change(copy);
  return copy;
}

async function assertFails(change, why) {
  const result = await checkAlert({ expected: EXPECTED, delivered: delivered(change) });
  assert.equal(result.status, 'failed', why);
  assert.ok(result.problems.length > 0, `${why}: no problem was named`);
}

test('SPIKE-01-AC9: a payload and shown text that match the fixed alert exactly pass', async () => {
  const result = await checkAlert({ expected: EXPECTED, delivered: delivered() });
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.problems, []);
});

test('SPIKE-01-AC9: an extra key fails, at the top of the payload or inside it', async () => {
  await assertFails((d) => {
    d.payload.journey = 'j-1';
  }, 'an extra key at the top');
  await assertFails((d) => {
    d.payload.aps.alert.subtitle = '';
  }, 'an extra key in the alert');
  await assertFails((d) => {
    d.payload.aps['thread-id'] = 'group';
  }, 'an extra key in aps');
});

test('SPIKE-01-AC9: any change to the fixed text fails, in the payload or on the screen', async () => {
  const changes = [
    ['one character', (text) => text.replace('Open', 'Opne')],
    ['a trailing space', (text) => `${text} `],
    ['a change of case', (text) => text.toUpperCase()],
    ['an empty text', () => ''],
  ];
  for (const [what, change] of changes) {
    await assertFails((d) => {
      d.payload.aps.alert.body = change(TEXT);
    }, `${what} in the payload`);
    await assertFails((d) => {
      d.shownText = change(TEXT);
    }, `${what} on the screen`);
  }
});

test('SPIKE-01-AC9: a missing key or a changed value fails', async () => {
  await assertFails((d) => {
    delete d.payload.aps.sound;
  }, 'a missing key');
  await assertFails((d) => {
    d.payload.aps['interruption-level'] = 'active';
  }, 'a lower interruption level');
  await assertFails((d) => {
    d.payload.aps.alert.title = 'Spike alert.';
  }, 'a changed title');
});

// Android: shown, and heard. `dumpsys audio` holds the ringer mode, Do Not
// Disturb, each stream's muted state and a log of every player. The dump below
// keeps the structure of one taken 25 s after the S5 alert in a dry run
// (android-37.2, 2026-09-30: priority Do Not Disturb, ringer SILENT), cut
// down, with the times rewritten. In that run nothing played for the app: the
// alert's effective usage was NOTIFICATION, a stream the silent ringer mutes.
//
// "Heard" (the spec: "If no such record exists, 'heard' is not shown"):
// - passed only with the app's own player started on a stream that is not muted;
// - failed when the platform's records show the alert's sound went to a muted stream;
// - not shown on simulators otherwise.
// The alert's record is readAndroidAlert's (analysis/notifications.mjs).

const readAudio = async (text) => (await import('./s5.mjs')).readAudio(text);
const judgeAndroidAlert = async (input) => (await import('./s5.mjs')).judgeAndroidAlert(input);

const SPIKE_APP = 'org.example.spike.backgroundsafety';
const NOT_SHOWN = 'not shown on simulators';
const RINGER_MUTED = [
  'STREAM_SYSTEM',
  'STREAM_RING',
  'STREAM_NOTIFICATION',
  'STREAM_SYSTEM_ENFORCED',
  'STREAM_DTMF',
];
/** Each stream in the order Android dumps it, with its alias and index range. */
const STREAMS = [
  ['STREAM_VOICE_CALL', null, 1, 15],
  ['STREAM_SYSTEM', 'STREAM_RING', 0, 7],
  ['STREAM_RING', null, 0, 7],
  ['STREAM_MUSIC', null, 0, 15],
  ['STREAM_ALARM', null, 1, 7],
  ['STREAM_NOTIFICATION', null, 0, 7],
  ['STREAM_SYSTEM_ENFORCED', 'STREAM_RING', 0, 7],
  ['STREAM_DTMF', 'STREAM_RING', 0, 15],
  ['STREAM_TTS', 'STREAM_MUSIC', 0, 15],
  ['STREAM_ACCESSIBILITY', 'STREAM_MUSIC', 1, 15],
  ['STREAM_ASSISTANT', null, 0, 15],
];
const STREAM_BIT = Object.fromEntries(
  STREAMS.map(([name]) => name).map((name, i) => [name, i < 6 ? i : i + 1]),
);

const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError, RangeError];
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

const attr = (usage, content = 'CONTENT_TYPE_SONIFICATION') =>
  `AudioAttributes: usage=${usage} content=${content} flags=0x800(FLAG_MUTE_HAPTIC)  tags= bundle=null`;

/** The dry run's playback log: the image's own players, and none for the app. */
const IMAGE_PLAYERS = [
  `  01-01 20:50:50:678 new player piid:95 uid/pid:1000/699 package:com.android.inputdevices type:android.media.SoundPool attr:${attr('USAGE_ASSISTANCE_SONIFICATION')} session:0`,
  `  01-01 20:50:51:171 new player piid:103 uid/pid:1000/699 package:com.android.inputdevices type:android.media.SoundPool attr:${attr('USAGE_ASSISTANCE_SONIFICATION')} session:0`,
  `  01-01 20:51:01:065 new player piid:111 uid/pid:10198/1008 package:com.android.systemui type:android.media.SoundPool attr:${attr('USAGE_ASSISTANCE_SONIFICATION')} session:0`,
  `  01-01 20:59:36:835 new player piid:119 uid/pid:1000/699 package:com.android.localtransport type:android.media.MediaPlayer attr:${attr('USAGE_UNKNOWN', 'CONTENT_TYPE_UNKNOWN')} session:137`,
  `  01-01 20:59:36:835 player piid:119 new AudioAttributes:${attr('USAGE_VOICE_COMMUNICATION', 'CONTENT_TYPE_SPEECH')}`,
  '  01-01 20:59:37:019 player piid:119 event:started',
  '  01-01 20:59:37:140 port updated portId:[23] mapped to player piid:119',
  '  01-01 20:59:37:148 player piid:119 event:muted updated source:none ',
  '  01-01 20:59:37:180 player piid:119 event:device updated deviceIds:[2]',
  '  01-01 20:59:37:982 player piid:119 event:stopped',
  '  01-01 20:59:37:984 releasing player piid:119, uid:1000',
];

/** A player's lines in the playback log: created, maybe moved to another usage, maybe started. */
function player({ piid, pkg = SPIKE_APP, uid = 10123, usage, movedTo = null, started = true }) {
  const lines = [
    `  01-01 21:00:10:120 new player piid:${piid} uid/pid:${uid}/4321 package:${pkg} type:android.media.MediaPlayer attr:${attr(usage)} session:145`,
  ];
  if (movedTo !== null) {
    lines.push(`  01-01 21:00:10:125 player piid:${piid} new AudioAttributes:${attr(movedTo)}`);
  }
  if (started) {
    lines.push(
      `  01-01 21:00:10:130 player piid:${piid} event:started`,
      `  01-01 21:00:12:000 player piid:${piid} event:stopped`,
    );
  }
  lines.push(`  01-01 21:00:12:010 releasing player piid:${piid}, uid:${uid}`);
  return lines;
}

const streamMask = (names) => names.reduce((mask, name) => mask | (1 << STREAM_BIT[name]), 0);
const ringerStreams = (kind, names) => {
  const mask = streamMask(names);
  return `- ringer mode ${kind} streams = 0x${mask.toString(16)}${mask === 0 ? '' : ` (${names.join(',')})`}`;
};

/** `dumpsys audio`, cut down to the parts S5 reads and the parts around them. */
function audioDump({
  ringer = 'SILENT',
  zen = 'ZEN_MODE_IMPORTANT_INTERRUPTIONS',
  userMuted = [],
  playback = [],
} = {}) {
  const byRinger = ringer === 'NORMAL' ? [] : RINGER_MUTED;
  const muted = new Set([...byRinger, ...userMuted]);
  const streams = STREAMS.flatMap(([name, alias, min, max]) => [
    `- ${name}${alias === null ? '' : ` (aliased to: ${alias})`}:`,
    `   Muted: ${muted.has(name)}`,
    '   Muted Internally: false',
    `   Min: ${min}`,
    `   Max: ${max}`,
    `   streamVolume:${muted.has(name) ? 0 : 5}`,
    '   Current: 2 (speaker): 5, 40000000 (default): 5',
    '   Devices: speaker(2)',
    `   Volume Group: AUDIO_${name === 'STREAM_SYSTEM_ENFORCED' ? 'STREAM_ENFORCED_AUDIBLE' : name}`,
    '',
    '',
  ]);
  const groups = ['NOTIFICATION', 'RING', 'SYSTEM', 'ALARM', 'MUSIC'].flatMap((name) => [
    `- VOLUME GROUP AUDIO_STREAM_${name}:`,
    `   Muted: ${muted.has(`STREAM_${name}`)}`,
    '   Min: 0',
    '   Max: 7',
    '   Current: 2 (speaker): 5, 40000000 (default): 5',
    '   Devices: speaker',
    `   Streams: STREAM_${name} `,
  ]);
  return [
    'AudioService Dumpsys',
    'Current time: Wed Jan 01 21:00:42 GMT+01:00 2031',
    '',
    '# IPC',
    '## Native audioserver lifecycle events',
    '  01-01 20:50:49:756 AudioService()',
    '',
    '# Stream activity',
    '## PlaybackActivityMonitor',
    '  playback listeners:',
    ' PlayMonitorClient:S uid:1000 pid:699',
    '',
    '  players:',
    `  AudioPlaybackConfiguration piid:95 deviceIds:[] type:android.media.SoundPool u/pid:1000/699 state:idle attr:${attr('USAGE_ASSISTANCE_SONIFICATION')} sessionId:0 mutedState:none  FormatInfo{isSpatialized=false, channelMask=0x0, sampleRate=0}`,
    '',
    '  muted player piids due to call/ring:',
    '',
    '### Playback activity',
    ...IMAGE_PLAYERS,
    ...playback,
    '',
    '',
    '  allowed capture policies:',
    '## RecordActivityMonitor',
    '',
    '# Volume state',
    '',
    'Stream volumes (device: index)',
    ...streams,
    '',
    '- mute affected streams = 0x86f',
    '',
    '- user mutable streams = 0x82e',
    '',
    'Volume Groups (device: index)',
    ...groups,
    '',
    'Ringer mode: ',
    `- mode (internal) = ${ringer}`,
    `- mode (external) = ${ringer}`,
    `- zen mode:${zen}`,
    ringerStreams('affected', RINGER_MUTED),
    ringerStreams('muted', byRinger),
    '- delegate = ZenModeHelper',
    '',
    '## Volume events',
    '### Mute commands',
    '  01-01 21:00:16:676 STREAM_SYSTEM muting by updateStreamMuteFromRingerMode',
    '  01-01 21:00:16:979 STREAM_NOTIFICATION muting by updateStreamMuteFromRingerMode',
    '  01-01 21:00:16:997 RingerZenMutedStreams 0x1a6 from updateStreamMuteFromRingerMode',
  ].join('\n');
}

/** The dry run's alert, as readAndroidAlert gives it: shown, and sent to NOTIFICATION. */
const DRY_RUN_ALERT = {
  posted: true,
  intercepted: false,
  channel: 'alert',
  bypassDnd: true,
  usage: 'USAGE_NOTIFICATION',
};
/** The same alert had its effective usage been ALARM, a stream the silent ringer leaves alone. */
const ALARM_ALERT = { ...DRY_RUN_ALERT, usage: 'USAGE_ALARM' };

test("SPIKE-01-AC9: reads the ringer mode, Do Not Disturb, the muted streams and the players from Android's audio dump", async () => {
  const audio = await readAudio(audioDump());
  assert.equal(audio.ringerMode, 'SILENT');
  assert.equal(audio.zenMode, 'ZEN_MODE_IMPORTANT_INTERRUPTIONS');
  assert.deepEqual([...audio.mutedStreams].sort(), [...RINGER_MUTED].sort());
  assert.deepEqual(
    audio.players.filter((p) => p.package === SPIKE_APP),
    [],
    'nothing played for the app in the dry run',
  );
  const call = audio.players.filter((p) => p.package === 'com.android.localtransport');
  assert.equal(call.length, 1);
  assert.equal(call[0].usage, 'USAGE_VOICE_COMMUNICATION', 'the usage it was moved to');
  assert.equal(call[0].started, true);
  const idle = audio.players.filter((p) => p.package === 'com.android.inputdevices');
  assert.deepEqual(
    idle.map((p) => p.started),
    [false, false],
    'players that never started',
  );
});

test('SPIKE-01-AC9: a stream the user muted is muted too, whatever the ringer does', async () => {
  const audio = await readAudio(audioDump({ userMuted: ['STREAM_MUSIC'] }));
  assert.ok(audio.mutedStreams.includes('STREAM_MUSIC'));
  assert.ok(!audio.mutedStreams.includes('STREAM_ALARM'));
});

test('SPIKE-01-AC9: output that is not the audio dump is refused, never read as "nothing muted"', async () => {
  await refuses(readAudio("Can't find service: audio\n"), 'no audio service');
  await refuses(readAudio('error: no devices/emulators found\n'), "adb's error");
  await refuses(readAudio(''), 'no output at all');
});

test("SPIKE-01-AC9: the dry run: shown, and not heard: the alert's sound went to NOTIFICATION, which the silent ringer mutes", async () => {
  const result = await judgeAndroidAlert({
    alert: DRY_RUN_ALERT,
    audio: await readAudio(audioDump()),
    app: SPIKE_APP,
  });
  assert.equal(result.shown, 'passed');
  assert.equal(result.heard, 'failed');
});

test("SPIKE-01-AC9: heard passes with the app's own player started on a stream the silent ringer leaves alone", async () => {
  const result = await judgeAndroidAlert({
    alert: ALARM_ALERT,
    audio: await readAudio(audioDump({ playback: player({ piid: 127, usage: 'USAGE_ALARM' }) })),
    app: SPIKE_APP,
  });
  assert.equal(result.heard, 'passed');
});

test('SPIKE-01-AC9: with no record of a sound, and none sent to a muted stream, heard is not shown on simulators', async () => {
  const result = await judgeAndroidAlert({
    alert: ALARM_ALERT,
    audio: await readAudio(audioDump()),
    app: SPIKE_APP,
  });
  assert.equal(result.heard, NOT_SHOWN);
});

test("SPIKE-01-AC9: heard never passes without the app's own player started on an unmuted stream", async () => {
  const notTheApps = [
    ['a player that never started', player({ piid: 127, usage: 'USAGE_ALARM', started: false })],
    [
      "another package's player",
      player({ piid: 131, pkg: 'com.android.systemui', uid: 10198, usage: 'USAGE_ALARM' }),
    ],
  ];
  for (const [what, playback] of notTheApps) {
    const result = await judgeAndroidAlert({
      alert: ALARM_ALERT,
      audio: await readAudio(audioDump({ playback })),
      app: SPIKE_APP,
    });
    assert.equal(result.heard, NOT_SHOWN, what);
  }
  const muted = [
    [
      'a player moved to NOTIFICATION before it started',
      audioDump({
        playback: player({ piid: 127, usage: 'USAGE_ALARM', movedTo: 'USAGE_NOTIFICATION' }),
      }),
    ],
    [
      'a player on MUSIC, which the user muted',
      audioDump({
        userMuted: ['STREAM_MUSIC'],
        playback: player({ piid: 127, usage: 'USAGE_MEDIA' }),
      }),
    ],
  ];
  for (const [what, text] of muted) {
    const result = await judgeAndroidAlert({
      alert: ALARM_ALERT,
      audio: await readAudio(text),
      app: SPIKE_APP,
    });
    assert.notEqual(result.heard, 'passed', what);
  }
});

test('SPIKE-01-AC9: shown fails when the alert was not posted, or Do Not Disturb intercepted it despite its channel', async () => {
  const audio = await readAudio(audioDump());
  const missing = await judgeAndroidAlert({
    alert: { posted: false, intercepted: null, channel: null, bypassDnd: null, usage: null },
    audio,
    app: SPIKE_APP,
  });
  assert.equal(missing.shown, 'failed', 'no record of the alert');
  const intercepted = await judgeAndroidAlert({
    alert: { ...DRY_RUN_ALERT, intercepted: true },
    audio,
    app: SPIKE_APP,
  });
  assert.equal(intercepted.shown, 'failed', 'intercepted with mBypassDnd=true');
});

test('SPIKE-01-AC9: a device that was not silenced is refused: S5 did not run as written', async () => {
  const cases = [
    ['the ringer was not silent', audioDump({ ringer: 'NORMAL' })],
    ['Do Not Disturb was off', audioDump({ zen: 'ZEN_MODE_OFF' })],
  ];
  for (const [what, text] of cases) {
    await refuses(
      (async () =>
        judgeAndroidAlert({
          alert: DRY_RUN_ALERT,
          audio: await readAudio(text),
          app: SPIKE_APP,
        }))(),
      what,
    );
  }
});
