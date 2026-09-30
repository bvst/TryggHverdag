// SPIKE-01-AC9 (S5): the alert's payload and its shown text match the fixed,
// content-free alert exactly, with no other keys or values; and, on Android,
// whether it was shown and heard on the silenced device. Pure.
//
// Problems name where the payload differs, never what it holds.

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const NOT_SHOWN = 'not shown on simulators';

/** The stream each usage plays on, as Android maps it (AudioAttributes.toLegacyStreamType). */
const STREAM_OF_USAGE = {
  USAGE_UNKNOWN: 'STREAM_MUSIC',
  USAGE_MEDIA: 'STREAM_MUSIC',
  USAGE_GAME: 'STREAM_MUSIC',
  USAGE_ASSISTANCE_NAVIGATION_GUIDANCE: 'STREAM_MUSIC',
  USAGE_VOICE_COMMUNICATION: 'STREAM_VOICE_CALL',
  USAGE_VOICE_COMMUNICATION_SIGNALLING: 'STREAM_DTMF',
  USAGE_ALARM: 'STREAM_ALARM',
  USAGE_NOTIFICATION_RINGTONE: 'STREAM_RING',
  USAGE_NOTIFICATION: 'STREAM_NOTIFICATION',
  USAGE_NOTIFICATION_COMMUNICATION_REQUEST: 'STREAM_NOTIFICATION',
  USAGE_NOTIFICATION_COMMUNICATION_INSTANT: 'STREAM_NOTIFICATION',
  USAGE_NOTIFICATION_COMMUNICATION_DELAYED: 'STREAM_NOTIFICATION',
  USAGE_NOTIFICATION_EVENT: 'STREAM_NOTIFICATION',
  USAGE_ASSISTANCE_ACCESSIBILITY: 'STREAM_ACCESSIBILITY',
  USAGE_ASSISTANCE_SONIFICATION: 'STREAM_SYSTEM',
  USAGE_ASSISTANT: 'STREAM_ASSISTANT',
};

const STREAM_HEADING = /^- (STREAM_[A-Z_]+)(?: \(aliased to: STREAM_[A-Z_]+\))?:$/;
const NEW_PLAYER =
  /new player piid:(\d+) uid\/pid:(\d+)\/\d+ package:(\S+) .*attr:AudioAttributes: usage=(\w+)/;
const PLAYER_ATTRIBUTES = /player piid:(\d+) new AudioAttributes:AudioAttributes: usage=(\w+)/;
const PLAYER_STARTED = /player piid:(\d+) event:started/;

/**
 * Android's audio dump (`dumpsys audio`): the ringer mode, Do Not Disturb, the
 * streams that are muted (by the ringer or by the user), and every player in
 * the playback log with the usage it played with. Text that is not the dump is
 * refused, never read as "nothing muted".
 *
 * @param {string} text
 * @returns {{ ringerMode: string, zenMode: string, mutedStreams: string[],
 *   players: { piid: number, uid: number, package: string, usage: string, started: boolean }[] }}
 */
export function readAudio(text) {
  if (typeof text !== 'string') throw new Error('the audio dump must be text');
  const lines = text.split(/\r?\n/);
  const ringerMode = lines
    .map((line) => /^- mode \(internal\) = (\w+)/.exec(line)?.[1])
    .find(Boolean);
  const zenMode = lines.map((line) => /^- zen mode:(\w+)/.exec(line)?.[1]).find(Boolean);
  if (
    ringerMode === undefined ||
    zenMode === undefined ||
    !lines.includes('Stream volumes (device: index)')
  ) {
    throw new Error(
      'the text is not the audio dump: no ringer mode, Do Not Disturb or stream volumes',
    );
  }

  const muted = new Set();
  const byRinger = lines
    .map((line) => /^- ringer mode muted streams = 0x[0-9a-f]+ \(([A-Z_,]+)\)/.exec(line)?.[1])
    .find(Boolean);
  for (const stream of byRinger?.split(',') ?? []) muted.add(stream);
  for (const [i, line] of lines.entries()) {
    const stream = STREAM_HEADING.exec(line);
    if (stream !== null && /^\s+Muted: true$/.test(lines[i + 1] ?? '')) muted.add(stream[1]);
  }

  const players = new Map();
  const log = lines.indexOf('### Playback activity');
  for (const line of log < 0 ? [] : lines.slice(log + 1)) {
    if (line.startsWith('#')) break;
    const created = NEW_PLAYER.exec(line);
    if (created !== null) {
      const [, piid, uid, pkg, usage] = created;
      players.set(piid, {
        piid: Number(piid),
        uid: Number(uid),
        package: pkg,
        usage,
        started: false,
      });
      continue;
    }
    const moved = PLAYER_ATTRIBUTES.exec(line);
    const player = players.get(moved?.[1] ?? PLAYER_STARTED.exec(line)?.[1]);
    if (player === undefined) continue;
    // The usage a player started with is the stream it was heard on.
    if (moved !== null && !player.started) player.usage = moved[2];
    else if (moved === null) player.started = true;
  }
  return { ringerMode, zenMode, mutedStreams: [...muted], players: [...players.values()] };
}

/**
 * S5 on Android: shown, and heard, on a device with the ringer silent and Do
 * Not Disturb on. `alert` is readAndroidAlert's record; `audio` is readAudio's.
 * - shown: the alert was posted, and Do Not Disturb did not intercept it;
 * - heard: passed only with the app's own player started on a stream that is
 *   not muted; failed when the records show its sound went to a muted stream;
 *   otherwise not shown on simulators.
 * A device that was not silenced is refused: S5 did not run as written.
 */
export function judgeAndroidAlert({ alert, audio, app }) {
  if (!isObject(alert) || typeof alert.posted !== 'boolean') {
    throw new Error("alert must be readAndroidAlert's record");
  }
  if (!isObject(audio) || !Array.isArray(audio.mutedStreams) || !Array.isArray(audio.players)) {
    throw new Error("audio must be readAudio's result");
  }
  if (audio.ringerMode !== 'SILENT' || audio.zenMode === 'ZEN_MODE_OFF') {
    throw new Error(
      `the device was not silenced (ringer ${audio.ringerMode}, ${audio.zenMode}), so S5 did not run as written`,
    );
  }
  const muted = new Set(audio.mutedStreams);
  const isMuted = (usage) => muted.has(STREAM_OF_USAGE[usage]);
  const isOpen = (usage) => STREAM_OF_USAGE[usage] !== undefined && !isMuted(usage);
  const played = audio.players.filter((player) => player.package === app && player.started);

  const shown = alert.posted && alert.intercepted === false ? 'passed' : 'failed';
  let heard = NOT_SHOWN;
  if (played.some((player) => isOpen(player.usage))) heard = 'passed';
  else if (isMuted(alert.usage) || played.some((player) => isMuted(player.usage))) heard = 'failed';
  return { shown, heard };
}

/** Appends to `problems` every place where `actual` is not exactly `expected`. */
function compare(expected, actual, path, problems) {
  if (isObject(expected)) {
    if (!isObject(actual)) {
      problems.push(`${path} is not an object`);
      return;
    }
    for (const key of Object.keys(expected)) {
      if (!Object.hasOwn(actual, key)) problems.push(`${path}.${key} is missing`);
      else compare(expected[key], actual[key], `${path}.${key}`, problems);
    }
    for (const key of Object.keys(actual)) {
      if (!Object.hasOwn(expected, key)) problems.push(`${path}.${key} is an extra key`);
    }
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      problems.push(`${path} is not the expected list`);
      return;
    }
    expected.forEach((item, i) => compare(item, actual[i], `${path}[${i}]`, problems));
    return;
  }
  if (!Object.is(expected, actual)) problems.push(`${path} differs from the fixed alert`);
}

/**
 * @param {{ expected: { payload: object, text: string },
 *   delivered: { payload: object, shownText: string } }} input
 * @returns {{ status: 'passed' | 'failed', problems: string[] }}
 */
export function checkAlert({ expected, delivered }) {
  if (!isObject(expected?.payload) || typeof expected.text !== 'string') {
    throw new Error('expected must hold the fixed payload and the fixed text');
  }
  if (!isObject(delivered)) throw new Error('delivered must hold what the device received');
  const problems = [];
  compare(expected.payload, delivered.payload, 'payload', problems);
  if (delivered.shownText !== expected.text) {
    problems.push('the text on the screen differs from the fixed text');
  }
  return { status: problems.length === 0 ? 'passed' : 'failed', problems };
}
