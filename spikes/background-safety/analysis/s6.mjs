// SPIKE-01-AC10 (S6): says whether the tap started an outbound call. Pure.
// - readGsmList and callStarted read the emulator console's `gsm list`;
// - readTelecom and telecomCallStarted read Telecom's own record
//   (`dumpsys telecom`), which S6 uses: on the android-37.2 image `gsm list`
//   stays empty during a call.
//
// Errors never repeat the console's or the dump's text: it may hold a number.

const CALL = /^(outbound to|inbound from)\s+(\S+)\s*:\s*(\w+)$/;

/**
 * @param {string} text the console's reply to `gsm list`
 * @returns {{ direction: 'outbound' | 'inbound', number: string, state: string }[]}
 */
export function readGsmList(text) {
  if (typeof text !== 'string') throw new Error('the call list must be the console text');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.at(-1) !== 'OK') {
    throw new Error('the console did not answer "gsm list" with OK, so its call list is unknown');
  }
  return lines.slice(0, -1).map((line, i) => {
    const match = CALL.exec(line);
    if (match === null) {
      throw new Error(`line ${i + 1} of the call list is not a call, so the list is not read`);
    }
    const [, direction, number, state] = match;
    return { direction: direction === 'outbound to' ? 'outbound' : 'inbound', number, state };
  });
}

const digits = (number) => String(number).replace(/\D/g, '');

/** Whether the list shows an outbound call to `number`, with or without its plus sign. */
export function callStarted({ calls, number }) {
  if (!Array.isArray(calls)) throw new Error('calls must be the list readGsmList returned');
  const wanted = digits(number);
  if (wanted === '') throw new Error('the number to look for is empty');
  return calls.some((call) => call.direction === 'outbound' && digits(call.number) === wanted);
}

const HISTORY = 'Historical Events:';
/** "  CallTC@1/1112 [1. jan. 2031 21:00:00](MO - outgoing)(User=UserHandle{0})" */
const CALL_RECORD = /^\s+(CallTC@\S+) \[[^\]]*\]\(([^)]*)\)/;
/** "    21:00:00.556 - CREATED (org.example.app;requestedAcct:none, …):…" */
const CALL_EVENT = /^\s+\d\d:\d\d:\d\d\.\d{3} - ([A-Z][A-Z0-9_]*)(.*)$/;
const DIRECTIONS = { 'MO - outgoing': 'outgoing', 'MT - incoming': 'incoming' };

/**
 * Each call in Telecom's "Historical Events", in the dump's order: its id, its
 * direction, the package its CREATED event names, and its events' names in
 * order. Text with no "Historical Events:" heading is refused, never read as
 * "no call".
 *
 * @param {string} text `adb shell dumpsys telecom`
 * @returns {{ id: string, direction: string, createdBy: string | null, events: string[] }[]}
 */
export function readTelecom(text) {
  if (typeof text !== 'string') throw new Error("Telecom's record must be the dump's text");
  const lines = text.split(/\r?\n/);
  const at = lines.indexOf(HISTORY);
  if (at < 0) {
    throw new Error('the text has no "Historical Events:" heading, so it is not Telecom\'s dump');
  }
  const calls = [];
  for (const line of lines.slice(at + 1)) {
    const record = CALL_RECORD.exec(line);
    if (record !== null) {
      const [, id, direction] = record;
      calls.push({
        id,
        direction: DIRECTIONS[direction] ?? direction,
        createdBy: null,
        events: [],
      });
      continue;
    }
    const event = CALL_EVENT.exec(line);
    const call = calls.at(-1);
    if (event === null || call === undefined) continue;
    const [, name, rest] = event;
    call.events.push(name);
    if (name === 'CREATED' && call.createdBy === null) {
      call.createdBy = /^ \(([^;)]+)/.exec(rest)?.[1] ?? null;
    }
  }
  return calls;
}

/**
 * Whether the tap alone started a call: `after` holds an outgoing call that
 * `before` does not, placed by `app` itself (not the dialer, which would mean
 * a second tap), that reached SET_DIALING.
 *
 * @param {{ before: object[], after: object[], app: string }} input readTelecom's lists
 */
export function telecomCallStarted({ before, after, app }) {
  if (!Array.isArray(before) || !Array.isArray(after)) {
    throw new Error('before and after must be the lists readTelecom returned');
  }
  if (typeof app !== 'string' || app === '') throw new Error('the app id is missing');
  const earlier = new Set(before.map((call) => call.id));
  return after.some(
    (call) =>
      !earlier.has(call.id) &&
      call.direction === 'outgoing' &&
      call.createdBy === app &&
      call.events.includes('SET_DIALING'),
  );
}
