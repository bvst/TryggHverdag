/**
 * What the emulator records of a call, of the dialer, and of the phone's
 * wakefulness, read between the L7 flows by scripts/e2e-android.mjs (CALL-01,
 * approach 9; CALL-01-AC2, CALL-01-AC4, CALL-02-AC3), because Maestro cannot
 * see a call, nor a phone asleep. Pure: each reader takes what adb printed.
 * SPIKE-01's S6 read Telecom's record the same way
 * (spikes/background-safety/analysis/s6.mjs).
 *
 * Output a reader does not recognise is refused with an error, never read as
 * "no call" or "not the dialer": a check that cannot read its evidence must
 * not pass. No message repeats a dump's text or a number: a dump may hold one
 * (PRIV-07). A verdict is `{ ok, message }`.
 */

const HISTORY = 'Historical Events:';
/** "  CallTC@1/1112 [1. jan. 2031 21:00:00](MO - outgoing)(User=UserHandle{0})" */
const CALL_RECORD = /^\s+(CallTC@\S+) \[[^\]]*\]\(([^)]*)\)/;
/** "  \tTo address: tel:***********18 Presentation: Allowed" */
const CALL_ADDRESS = /^\s*To address:\s*(\S+)/;
/** "    21:00:00.556 - CREATED (org.example.app;requestedAcct:none, …):…" */
const CALL_EVENT = /^\s+\d\d:\d\d:\d\d\.\d{3} - ([A-Z][A-Z0-9_]*)(.*)$/;
const DIRECTIONS = { 'MO - outgoing': 'outgoing', 'MT - incoming': 'incoming' };

/**
 * @typedef {{
 *   id: string,
 *   direction: string,
 *   createdBy: string | null,
 *   address: string | null,
 *   events: string[],
 * }} TelecomCall
 */

/**
 * Each call in Telecom's "Historical Events" (`adb shell dumpsys telecom`),
 * in the dump's order: its id, its direction, the package its CREATED event
 * names, its address as Telecom shows it (masked), and its events' names in
 * order. Telecom keeps this history until the emulator restarts.
 *
 * @param {string} text
 * @returns {TelecomCall[]}
 */
export function readTelecom(text) {
  if (typeof text !== 'string') throw new Error("Telecom's record must be the dump's text.");
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((line) => line.trim() === HISTORY);
  if (at < 0) {
    throw new Error('the output has no "Historical Events:" heading, so it is not Telecom\'s dump');
  }
  /** @type {TelecomCall[]} */
  const calls = [];
  for (const line of lines.slice(at + 1)) {
    const record = CALL_RECORD.exec(line);
    if (record !== null) {
      const [, id = '', direction = ''] = record;
      calls.push({
        id,
        direction: DIRECTIONS[direction] ?? direction,
        createdBy: null,
        address: null,
        events: [],
      });
      continue;
    }
    const call = calls.at(-1);
    if (call === undefined) continue;
    const address = CALL_ADDRESS.exec(line);
    if (address !== null) {
      call.address ??= address[1] ?? null;
      continue;
    }
    const event = CALL_EVENT.exec(line);
    if (event === null) continue;
    const [, name = '', rest = ''] = event;
    call.events.push(name);
    if (name === 'CREATED' && call.createdBy === null) {
      call.createdBy = /^ \(([^;)]+)/.exec(rest)?.[1] ?? null;
    }
  }
  return calls;
}

/**
 * The calls `after` holds that `before` does not.
 *
 * @param {{ before: TelecomCall[], after: TelecomCall[] }} records
 */
export function newCalls({ before, after }) {
  const earlier = new Set(before.map((call) => call.id));
  return after.filter((call) => !earlier.has(call.id));
}

/**
 * Whether Telecom's masked address (`tel:***********18`) is `number`'s: the
 * same length, and every character Telecom shows the same.
 *
 * @param {string | null | undefined} address
 * @param {string} number
 */
export function addressMatches(address, number) {
  if (typeof address !== 'string' || typeof number !== 'string' || number === '') return false;
  const shown = Array.from(address.replace(/^tel:/, ''));
  const wanted = Array.from(number);
  return (
    shown.length === wanted.length &&
    shown.every((character, at) => character === '*' || character === wanted[at])
  );
}

/**
 * CALL-01-AC2's L7 half: one tap placed one call to #1, with no second tap.
 * Exactly one new call, outgoing, created by the app itself (one the dialer
 * created took a second tap), that reached SET_DIALING, to `number` as
 * Telecom shows it.
 *
 * @param {{ before: TelecomCall[], after: TelecomCall[], app: string, number: string }} input
 */
export function callPlacedByApp({ before, after, app, number }) {
  const added = newCalls({ before, after });
  if (added.length === 0) {
    return {
      ok: false,
      message:
        "Telecom's record shows no new call: the tap did not start one, or the dialer waited for a second tap.",
    };
  }
  if (added.length > 1) {
    return {
      ok: false,
      message: `Telecom's record shows ${String(added.length)} new calls, not the one the tap should place.`,
    };
  }
  const [call] = added;
  if (call.direction !== 'outgoing') {
    return {
      ok: false,
      message: `the new call in Telecom's record is ${call.direction}, not outgoing.`,
    };
  }
  if (call.createdBy !== app) {
    return {
      ok: false,
      message: `the new call was created by ${String(call.createdBy)}, not by ${app}: it took a second tap.`,
    };
  }
  if (!call.events.includes('SET_DIALING')) {
    return { ok: false, message: 'the new call never reached SET_DIALING: it was not dialled.' };
  }
  if (!addressMatches(call.address, number)) {
    return { ok: false, message: "the new call is not to #1's number." };
  }
  return {
    ok: true,
    message: `one outgoing call, placed by ${app} with no second tap, to #1's number.`,
  };
}

/**
 * CALL-01-AC4's and CALL-02-AC3's "Telecom has no call": no new call of any
 * kind, from anyone.
 *
 * @param {{ before: TelecomCall[], after: TelecomCall[] }} records
 */
export function noNewCall({ before, after }) {
  const added = newCalls({ before, after });
  if (added.length === 0) return { ok: true, message: "Telecom's record shows no new call." };
  const by = [...new Set(added.map((call) => String(call.createdBy)))].join(', ');
  return {
    ok: false,
    message: `Telecom's record shows ${String(added.length)} new call(s), created by ${by}, where none may be.`,
  };
}

/** A window or activity token's package: "Window{… u0 <package>/<activity>}". */
const WINDOW_PACKAGE = /\bu\d+\s+([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\//;

/**
 * The package of the focused window, from `adb shell dumpsys window`; for a
 * window with no package of its own (a popup), the focused app's; null when
 * nothing has focus. Output with no focused window line is refused.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function focusedPackage(text) {
  if (typeof text !== 'string') throw new Error('the window dump must be its text.');
  const lines = text.split(/\r?\n/);
  const focus = lines.find((line) => /^\s*mCurrentFocus=/.test(line));
  if (focus === undefined) {
    throw new Error('the output has no mCurrentFocus line, so it is not the window dump');
  }
  const own = WINDOW_PACKAGE.exec(focus)?.[1];
  if (own !== undefined) return own;
  const app = lines.find((line) => /^\s*mFocusedApp=/.test(line));
  return (app === undefined ? undefined : WINDOW_PACKAGE.exec(app)?.[1]) ?? null;
}

/**
 * The events that mark a call as ended in Telecom's record: disconnected, or
 * destroyed (SPIKE-01's s6.test.mjs sample).
 */
const ENDING_EVENTS = ['SET_DISCONNECTED', 'DESTROYED'];

/**
 * CALL-01, approach 9: whether the one new call in Telecom's record is still
 * in progress, so the end-call key ends a call rather than putting the phone
 * to sleep (with no call in progress, Android's END_BUTTON_BEHAVIOR_SLEEP).
 * The message names the events read, never the address. No new call, or more
 * than one, is refused: the key is never pressed on a guess.
 *
 * @param {{ before: TelecomCall[], after: TelecomCall[] }} records
 * @returns {{ inProgress: boolean, message: string }}
 */
export function callInProgress({ before, after }) {
  const added = newCalls({ before, after });
  if (added.length !== 1) {
    throw new Error(
      `Telecom's record shows ${String(added.length)} new calls, not one, so whether a call is in progress cannot be read.`,
    );
  }
  const [call] = added;
  const events = call.events.join(', ');
  if (call.events.some((name) => ENDING_EVENTS.includes(name))) {
    return {
      inProgress: false,
      message: `the new call had already ended (Telecom's events for it: ${events}).`,
    };
  }
  return {
    inProgress: true,
    message: `the new call is in progress, not yet ended (Telecom's events for it: ${events}).`,
  };
}

/** "  mWakefulness=Awake": not mWakefulnessChanging=. */
const WAKEFULNESS_LINE = /^\s*mWakefulness=([A-Za-z]+)\s*$/;

/**
 * CALL-01, approach 9: the phone's wakefulness, the value of the
 * `mWakefulness=` line in `adb shell dumpsys power` (Awake, Asleep, Dozing or
 * Dreaming). Output with no such line is refused, never read as awake.
 *
 * @param {string} text
 * @returns {string}
 */
export function readWakefulness(text) {
  if (typeof text !== 'string') throw new Error('the power dump must be its text.');
  for (const line of text.split(/\r?\n/)) {
    const value = WAKEFULNESS_LINE.exec(line)?.[1];
    if (value !== undefined) return value;
  }
  throw new Error('the output has no mWakefulness= line, so it is not the power dump');
}

const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

/**
 * The packages `adb shell cmd role get-role-holders android.app.role.DIALER`
 * names, one per line. Anything that is not a package name is refused.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function roleHolders(text) {
  if (typeof text !== 'string') throw new Error("the role's holders must be the command's text.");
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (!lines.every((line) => PACKAGE.test(line))) {
    throw new Error("the output is not a list of the dialer role's holders");
  }
  return lines;
}

/**
 * CALL-02-AC3's and CALL-01-AC4's "the focused window belongs to the phone's
 * default dialer": the focused window's package holds the dialer role.
 *
 * @param {{ window: string, holders: string }} dumps what `dumpsys window` and the role command printed
 */
export function dialerInFront({ window, holders }) {
  const focused = focusedPackage(window);
  const dialers = roleHolders(holders);
  if (dialers.length === 0) {
    return { ok: false, message: 'no app holds the dialer role, so no dialer can be in front.' };
  }
  if (focused === null) {
    return { ok: false, message: `nothing has focus, not the dialer (${dialers.join(', ')}).` };
  }
  if (!dialers.includes(focused)) {
    return {
      ok: false,
      message: `the focused window belongs to ${focused}, not to the dialer (${dialers.join(', ')}).`,
    };
  }
  return { ok: true, message: `the dialer, ${focused}, is in front.` };
}
