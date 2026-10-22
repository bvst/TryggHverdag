// CALL-01-AC2, CALL-01-AC4 and CALL-02-AC3 (L7's readers): what the emulator
// records of a call, and of the dialer, read by scripts/e2e-android.mjs
// between the flows, because Maestro cannot see a call (CALL-01's test plan:
// "the readers get tests in scripts/lib/, as S6's did").
//
// The readers, in scripts/lib/call-records.mjs:
//   - readTelecom(text): Telecom's "Historical Events" in `adb shell dumpsys
//     telecom`, each call with its id, its direction, the package its CREATED
//     event names, its events in order, and its address as Telecom shows it,
//     masked (`tel:***********18`). Text with no such heading is refused,
//     never read as "no call";
//   - newCalls({ before, after }): the calls `after` holds that `before` does
//     not: Telecom keeps its history until the emulator restarts;
//   - callPlacedByApp({ before, after, app, number }): CALL-01-AC2's L7 half,
//     "one outgoing call to that number, placed with no second tap": exactly
//     one new call, outgoing, created by the app itself (not by the dialer,
//     which would mean a second tap), that reached SET_DIALING, its masked
//     address matching the number;
//   - noNewCall({ before, after }): CALL-01-AC4's and CALL-02-AC3's "Telecom
//     has no call";
//   - addressMatches(address, number): Telecom's masked address against a
//     number: the same length, and every character Telecom shows the same;
//   - focusedPackage(text): the package of the focused window in `adb shell
//     dumpsys window`, or null when nothing has focus;
//   - roleHolders(text): the packages `adb shell cmd role get-role-holders
//     android.app.role.DIALER` names;
//   - dialerInFront({ window, holders }): CALL-02-AC3's "the focused window
//     belongs to the phone's default dialer", from those two outputs.
// Each verdict is { ok, message }. No message repeats the dumps' text, or the
// number: a dump may hold a number (SPIKE-01's S6 readers held the same rule).
//
// The samples keep the real dumps' structure, cut down, built by the test
// kit's android-dumps.ts, which the stand-in emulator of
// scripts/e2e-android.test.mjs prints too: Telecom's from SPIKE-01's dry run
// on 2026-09-30, the window's and the role's as Android 14 prints them. The number
// is the test kit's emulator #1, from Ofcom's range reserved for drama; no
// emergency number is ever a call here (SPIKE-01-AC10's rule).
//
// The module is imported in each test, so each reports a missing module on
// its own.
import { describe, expect, test } from 'vitest';
import { EMULATOR_FIRST_CONTACT } from '../../packages/test-kit/src/fixtures/phone-numbers.ts';
import {
  DIALER_PACKAGE,
  appWindow,
  callRecord as recordOfCall,
  dialerWindow,
  dialledEvents,
  maskedAddress,
  telecomDump as dumpOfTelecom,
  telecomHead,
  windowDump,
} from '../../packages/test-kit/src/android-dumps.ts';

/** The module, loaded per test. */
const records = () => import('./call-records.mjs');

const APP = 'no.example.placeholder';
const DIALER = DIALER_PACKAGE;
const NUMBER = EMULATOR_FIRST_CONTACT.normalised;
/** The number as Telecom shows it: all but its last two characters masked. */
const MASKED = maskedAddress(NUMBER);

/** The dump down to its "Historical Events:" heading, as the emulator prints it. */
const TELECOM_HEAD = telecomHead(DIALER);

/** A call's events, from CREATED on, as the sample has them; `by` is the package that placed it. */
const dialled = (by, address = MASKED) => dialledEvents(by, address);

/** One call's record under "Historical Events:". */
const callRecord = ({
  id = 1,
  direction = 'MO - outgoing',
  address = MASKED,
  events = dialled(APP, address),
} = {}) => recordOfCall({ id, direction, address, events });

const telecomDump = (...calls) => dumpOfTelecom(calls);
const NO_CALL = telecomDump();
const APP_CALL = telecomDump(callRecord());

const DIALER_FOCUS = dialerWindow(DIALER);
const APP_FOCUS = appWindow(APP);

const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError, RangeError];

/** Throws on purpose: not a missing module, and not a programming error. */
function refuses(read, why) {
  let thrown;
  try {
    read();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `${why}: it read the text instead of refusing it`).toBeDefined();
  expect(
    PROGRAMMING_ERRORS.some((type) => thrown instanceof type),
    `${why}: it broke instead of refusing (${String(thrown)})`,
  ).toBe(false);
}

describe('readTelecom: Telecom’s own record of calls', () => {
  test('CALL-01-AC2: reads an outgoing call from Telecom’s record: its id, its direction, the package that placed it, its events in order, and its address as Telecom masks it', async () => {
    const { readTelecom } = await records();

    const calls = readTelecom(APP_CALL);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ direction: 'outgoing', createdBy: APP, address: MASKED });
    expect(String(calls[0].id)).toMatch(/TC@1\b/);
    expect(calls[0].events).toEqual([
      'CREATED',
      'SET_CONNECTING',
      'START_CONNECTION',
      'SET_DIALING',
      'SET_DISCONNECTED',
      'LOG_CALL',
      'DESTROYED',
    ]);
  });

  test('CALL-01-AC4 and CALL-02-AC3: a dump with no call record reads as no call', async () => {
    const { readTelecom } = await records();

    expect(readTelecom(NO_CALL)).toEqual([]);
  });

  test('CALL-01-AC2: several calls read in the dump’s order, an incoming one as incoming', async () => {
    const { readTelecom } = await records();

    const calls = readTelecom(
      telecomDump(
        callRecord({ id: 1 }),
        callRecord({ id: 2, direction: 'MT - incoming', events: dialled(DIALER) }),
      ),
    );

    expect(calls.map((call) => [call.direction, call.createdBy])).toEqual([
      ['outgoing', APP],
      ['incoming', DIALER],
    ]);
  });

  test('CALL-01-AC2: output that is not Telecom’s dump is refused, never read as "no call"', async () => {
    const { readTelecom } = await records();

    refuses(() => readTelecom("Can't find service: telecom\n"), 'no telecom service');
    refuses(() => readTelecom('error: no devices/emulators found\n'), 'adb’s error');
    refuses(() => readTelecom(''), 'no output at all');
    refuses(
      () => readTelecom(`${TELECOM_HEAD.slice(0, -1).join('\n')}\n`),
      'a dump cut off before its heading',
    );
  });
});

describe('addressMatches: Telecom’s masked address against a number', () => {
  test('CALL-01-AC2: the masked address matches the number it masks, with or without the plus, and nothing else', async () => {
    const { addressMatches } = await records();
    const other = `${NUMBER.slice(0, -2)}${NUMBER.slice(-2) === '00' ? '11' : '00'}`;

    expect(addressMatches(MASKED, NUMBER)).toBe(true);
    expect(addressMatches(`tel:${NUMBER}`, NUMBER)).toBe(true);
    expect(addressMatches(MASKED, other)).toBe(false);
    expect(addressMatches(MASKED, NUMBER.slice(1))).toBe(false);
    expect(addressMatches(MASKED, `${NUMBER}0`)).toBe(false);
    expect(addressMatches(null, NUMBER)).toBe(false);
  });
});

describe('callPlacedByApp: one tap placed one call to #1, with no second tap', () => {
  test('CALL-01-AC2: with the permission, one new outgoing call created by the app, dialled, to #1’s number, passes, and says so without the number', async () => {
    const { callPlacedByApp, readTelecom } = await records();

    const verdict = callPlacedByApp({
      before: readTelecom(NO_CALL),
      after: readTelecom(APP_CALL),
      app: APP,
      number: NUMBER,
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.message).not.toContain(NUMBER.slice(1));
    expect(verdict.message).not.toContain(MASKED);
  });

  test.each([
    ['no call at all: the dialer waited for a second tap', () => NO_CALL],
    [
      'a call the dialer placed: it took a second tap',
      () => telecomDump(callRecord({ id: 2, events: dialled(DIALER) })),
    ],
    [
      'a call that never dialled',
      () =>
        telecomDump(
          callRecord({
            id: 3,
            events: dialled(APP).filter((event) => !event.includes(' - SET_DIALING ')),
          }),
        ),
    ],
    ['an incoming call', () => telecomDump(callRecord({ id: 4, direction: 'MT - incoming' }))],
    [
      'a call to another number',
      () =>
        telecomDump(
          callRecord({
            id: 5,
            address: `tel:${'*'.repeat(NUMBER.length - 2)}${NUMBER.slice(-2) === '00' ? '11' : '00'}`,
          }),
        ),
    ],
    ['two calls from one tap', () => telecomDump(callRecord({ id: 6 }), callRecord({ id: 7 }))],
  ])(
    'CALL-01-AC2: %s does not pass, and the message says why without the number',
    async (_case, after) => {
      const { callPlacedByApp, readTelecom } = await records();

      const verdict = callPlacedByApp({
        before: readTelecom(NO_CALL),
        after: readTelecom(after()),
        app: APP,
        number: NUMBER,
      });

      expect(verdict.ok).toBe(false);
      expect(verdict.message.trim()).not.toBe('');
      expect(verdict.message).not.toContain(NUMBER.slice(1));
    },
  );

  test('CALL-01-AC2: a call already in Telecom’s history before the tap is not the tap’s call', async () => {
    const { callPlacedByApp, newCalls, readTelecom } = await records();
    const earlier = readTelecom(APP_CALL);

    expect(newCalls({ before: earlier, after: earlier })).toEqual([]);
    expect(callPlacedByApp({ before: earlier, after: earlier, app: APP, number: NUMBER }).ok).toBe(
      false,
    );
  });
});

describe('noNewCall: Telecom has no call', () => {
  test('CALL-01-AC4 and CALL-02-AC3: no new call record passes; one new call of any kind, from anyone, does not', async () => {
    const { noNewCall, readTelecom } = await records();
    const before = readTelecom(APP_CALL);

    expect(noNewCall({ before, after: readTelecom(APP_CALL) }).ok).toBe(true);
    expect(noNewCall({ before: readTelecom(NO_CALL), after: readTelecom(NO_CALL) }).ok).toBe(true);
    for (const after of [
      telecomDump(callRecord(), callRecord({ id: 2, events: dialled(DIALER) })),
      telecomDump(callRecord(), callRecord({ id: 3 })),
    ]) {
      const verdict = noNewCall({ before, after: readTelecom(after) });
      expect(verdict.ok).toBe(false);
      expect(verdict.message).not.toContain(NUMBER.slice(1));
    }
  });
});

describe('the dialer in front: the focused window and the dialer role', () => {
  test('CALL-02-AC3: the focused window’s package is read from dumpsys window, or null when nothing has focus', async () => {
    const { focusedPackage } = await records();

    expect(focusedPackage(windowDump(DIALER_FOCUS))).toBe(DIALER);
    expect(focusedPackage(windowDump(APP_FOCUS))).toBe(APP);
    expect(focusedPackage(windowDump('null', 'null'))).toBeNull();
  });

  test('CALL-02-AC3: a focused window with no package of its own is read by the focused app’s', async () => {
    const { focusedPackage } = await records();

    expect(
      focusedPackage(
        windowDump(
          'Window{2b3c4d5 u0 PopupWindow:8f9e7d6}',
          `ActivityRecord{8e1d2c3 u0 ${DIALER}/.extensions.GoogleDialtactsActivity t12}`,
        ),
      ),
    ).toBe(DIALER);
  });

  test('CALL-02-AC3: output with no focused window line is refused, never read as "not the dialer"', async () => {
    const { focusedPackage } = await records();

    refuses(() => focusedPackage(''), 'no output');
    refuses(() => focusedPackage('error: no devices/emulators found\n'), 'adb’s error');
  });

  test('CALL-02-AC3: the dialer role’s holders are read one per line; an error is refused', async () => {
    const { roleHolders } = await records();

    expect(roleHolders(`${DIALER}\n`)).toEqual([DIALER]);
    expect(roleHolders('')).toEqual([]);
    refuses(
      () =>
        roleHolders('Exception occurred while executing: Unknown role android.app.role.DIALER\n'),
      'the role service’s error',
    );
  });

  test('CALL-02-AC3 and CALL-01-AC4: the dialer is in front only when the focused window belongs to a holder of the dialer role', async () => {
    const { dialerInFront } = await records();

    expect(dialerInFront({ window: windowDump(DIALER_FOCUS), holders: `${DIALER}\n` }).ok).toBe(
      true,
    );
    const app = dialerInFront({ window: windowDump(APP_FOCUS), holders: `${DIALER}\n` });
    expect(app.ok).toBe(false);
    expect(app.message).toContain(APP);
    expect(app.message).toContain(DIALER);
    expect(dialerInFront({ window: windowDump(DIALER_FOCUS), holders: '' }).ok).toBe(false);
    expect(dialerInFront({ window: windowDump('null', 'null'), holders: `${DIALER}\n` }).ok).toBe(
      false,
    );
  });
});
