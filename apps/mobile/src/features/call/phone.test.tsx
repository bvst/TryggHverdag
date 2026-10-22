// CALL-01-AC2, AC4 and AC5, and CALL-02-AC3 (L5): the phone's calling path,
// features/call/phone.ts, the one module that reaches it (CALL-01, approach
// 1): `callNumber`, `openDialer`, `callPermission`, `askCallPermission` and
// `openAppSettings`.
//
// What it must do with a number (CALL-01, approach 2), whatever the number:
//   - clean it: drop whitespace, `-`, `.`, `(` and `)`, and nothing else, and
//     build every `tel:` URI from the cleaned string, never from what it was
//     given;
//   - send anything that is not then a plain number (`^\+?[0-9]+$`, ASCII
//     digits) to the dialer, with every character but the digits and a first
//     + percent-encoded, and never to ACTION_CALL;
//   - reduce a plain number, in a loop, by a leading +47, else 0047, else +,
//     and send an emergency number to the dialer with the reduced digits:
//     exactly 112, 911, 110, 113, 000, 08, 118, 119 or 999, or 110, 112, 113,
//     000, 118 or 119 followed by more digits. 911, 999 and 08 followed by
//     more digits are the shapes of real Norwegian numbers, and call;
//   - otherwise, with CALL_PHONE, start android.intent.action.CALL through
//     expo-intent-launcher; without it, or when ACTION_CALL is refused, open
//     the dialer (`Linking.openURL('tel:' + cleaned)`); if both fail, reject.
//     It never asks `Linking.canOpenURL` first.
//
// This file does not import features/grp/first-contact.ts, and passes every
// number in as written, so nothing here leans on GRP-02's normalisation: the
// emergency rule lives wholly in phone.ts, an owned path (D-141 (a), (e), (f)).
//
// What stands in for the platform, and nothing else: expo-intent-launcher
// (not installed until task 2 adds it, so its mock is virtual), React
// Native's Linking (openURL, canOpenURL, openSettings) and PermissionsAndroid
// (check, request), on Android. ACTION_CALL without the permission is refused,
// as Android refuses it, so a phone.ts that tries it first and one that reads
// the permission first are held to the same outcome.
//
// This file is named .tsx, though it holds no JSX, on purpose. The app's
// tsconfig reads every src/**/*.ts before any .tsx, and a .ts test that sorts
// before features/grp/index.ts and imports @jest/globals first changes how
// TypeScript types process.env across the whole app (two @types/node
// versions, 22 and 26, meet there): lint then calls the casts in
// shared/api/client.ts, app.config.ts and app.config.test.ts unnecessary.
// As .tsx it is read after them, as grp.test.tsx is, and changes nothing.
//
// The module is loaded afresh in each test, so each reports its own failure
// while it does not exist yet. No test dials anything: every number reaches a
// mock. Numbers are synthetic, from the test kit's fixtures (RG-07, HK-07);
// emergency numbers are written here because they are the subject.
import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import {
  FIVE_DIGIT_SPECIAL,
  MOBILE,
  MOBILE_BEGINNING_911,
  MOBILE_BEGINNING_999,
  MOBILE_WITH_112_INSIDE,
  OTHER_MOBILE,
} from '../../../../../packages/test-kit/src/fixtures/phone-numbers.ts';

/** The platform as the mocks see it, set per test. */
const mockPlatform = {
  /** Whether the app holds CALL_PHONE. */
  granted: false,
  /** What Android answers a request for it. */
  answer: 'denied' as 'granted' | 'denied' | 'never_ask_again',
  /** ACTION_CALL refused even with the permission. */
  callRefused: false,
  /** The dialer refused. */
  dialRefused: false,
  /** Every activity started, in order: its action and its parameters. */
  intents: [] as { action: string; params: unknown }[],
};

const CALL = 'android.intent.action.CALL';

jest.mock(
  'expo-intent-launcher',
  () => ({
    startActivityAsync: (action: string, params?: unknown) => {
      mockPlatform.intents.push({ action, params });
      if (action === CALL && (!mockPlatform.granted || mockPlatform.callRefused)) {
        return Promise.reject(new Error('synthetic: Permission Denial: CALL_PHONE'));
      }
      return Promise.resolve({ resultCode: 0 });
    },
    // The settings actions are android.settings.<NAME>, as the package's own enum has them.
    ActivityAction: new Proxy({}, { get: (_target, name) => `android.settings.${String(name)}` }),
    ResultCode: { Success: -1, Canceled: 0, FirstUser: 1 },
  }),
  { virtual: true },
);

type ReactNative = typeof import('react-native');

/** What phone.ts exports. */
interface PhoneModule {
  callNumber: (number: string) => Promise<void>;
  openDialer: (number: string) => Promise<void>;
  callPermission: () => Promise<'granted' | 'notGranted'> | 'granted' | 'notGranted';
  askCallPermission: () =>
    Promise<'granted' | 'denied' | 'neverAskAgain'> | 'granted' | 'denied' | 'neverAskAgain';
  openAppSettings: () => Promise<void> | void;
}

/** What Linking was asked to do, in this test. */
const linking = { opened: [] as string[], asked: 0, settings: 0 };

/** The phone module, loaded afresh against this test's platform. */
function phone(): PhoneModule {
  const loaded: PhoneModule = jest.requireActual('./phone');
  return loaded;
}

beforeEach(() => {
  jest.resetModules();
  Object.assign(mockPlatform, {
    granted: false,
    answer: 'denied',
    callRefused: false,
    dialRefused: false,
    intents: [],
  });
  Object.assign(linking, { opened: [], asked: 0, settings: 0 });
  const native: ReactNative = jest.requireActual('react-native');
  (native.Platform as { OS: string }).OS = 'android';
  jest.spyOn(native.Linking, 'openURL').mockImplementation((url: string) => {
    linking.opened.push(url);
    return mockPlatform.dialRefused
      ? Promise.reject(new Error('synthetic: no activity found for the dialer'))
      : Promise.resolve(true);
  });
  jest.spyOn(native.Linking, 'canOpenURL').mockImplementation(() => {
    linking.asked += 1;
    return Promise.resolve(false);
  });
  jest.spyOn(native.Linking, 'openSettings').mockImplementation(() => {
    linking.settings += 1;
    return Promise.resolve();
  });
  jest
    .spyOn(native.PermissionsAndroid, 'check')
    .mockImplementation(() => Promise.resolve(mockPlatform.granted));
  jest
    .spyOn(native.PermissionsAndroid, 'request')
    .mockImplementation(() => Promise.resolve(mockPlatform.answer));
});

/** Every ACTION_CALL started, by its tel: URI. */
const callsStarted = (): unknown[] =>
  mockPlatform.intents
    .filter(({ action }) => action === CALL)
    .map(({ params }) => (params as { data?: unknown } | undefined)?.data);

/** ACTION_CALL started and not refused: a call placed. */
const callsPlaced = (): unknown[] =>
  mockPlatform.granted && !mockPlatform.callRefused ? callsStarted() : [];

/** Whether the permission is held, for the two halves of each case. */
const PERMISSION: [string, boolean][] = [
  ['with the call permission', true],
  ['without it', false],
];

/** The emergency set (CALL-01, approach 2). */
const EMERGENCY = ['112', '911', '110', '113', '000', '08', '118', '119', '999'];

/** The prefixes that send a longer number to the dialer. */
const PREFIXES = ['110', '112', '113', '000', '118', '119'];

/** Each emergency number written the ways a person might, each with the digits it reduces to. */
const WRITTEN: [string, string, string][] = EMERGENCY.flatMap(
  (number): [string, string, string][] =>
    (
      [
        ['spaces between the digits', Array.from(number).join(' ')],
        ['dashes between the digits', Array.from(number).join('-')],
        ['+47 in front', `+47${number}`],
        ['+47 and a space in front', `+47 ${number}`],
        ['0047 in front', `0047${number}`],
        ['+0047 in front', `+0047${number}`],
      ] as [string, string][]
    ).map(([how, written]) => [`${number} with ${how}`, written, number]),
);

/** Every case of WRITTEN, with and without the permission. */
const WRITTEN_BOTH: [string, string, string, string, boolean][] = WRITTEN.flatMap(
  ([what, written, reduced]) =>
    PERMISSION.map(([permission, granted]): [string, string, string, string, boolean] => [
      what,
      permission,
      written,
      reduced,
      granted,
    ]),
);

/** Each prefix followed by more digits, in the shapes 112d and 113dd, and once with +47 in front. */
const PREFIXED: [string, string, string][] = PREFIXES.flatMap((prefix) => [
  [`${prefix}d`, `${prefix}4`, `${prefix}4`],
  [`${prefix}dd`, `${prefix}45`, `${prefix}45`],
  [`+47 ${prefix}dddd`, `+47 ${prefix}4567`, `${prefix}4567`],
]);

/** Strings Android would read its own way, each with what it reads (CALL-01, approach 2). */
const NOT_PLAIN: [string, string][] = [
  ['112,5: a comma ends the number Android dials', '112,5'],
  ['11A: letters count as keypad digits', '11A'],
  ['١١٢: Arabic-Indic digits count as digits', '١١٢'],
  ['*31#112: # starts a URI fragment', '*31#112'],
  ['112;5: a semicolon ends the number too', '112;5'],
  ['a + not first', `${MOBILE.slice(0, 2)}+${MOBILE.slice(2)}`],
];

/** Numbers that are no emergency number, and call on the tap with the permission. */
const NOT_EMERGENCY: [string, string][] = [
  ['an eight-digit mobile number', MOBILE],
  ['another', OTHER_MOBILE],
  ['one shaped ddd112dd', MOBILE_WITH_112_INSIDE],
  ['47 and 110, with no +', '47110'],
  ['47 and 112, with no +', '47112'],
  ['47 and 113, with no +', '47113'],
];

/** The narrowed prefixes: shapes of real numbers, which call on the tap. */
const NARROWED: [string, string][] = [
  ['911ddddd, the shape of a Norwegian mobile number', MOBILE_BEGINNING_911],
  ['999ddddd, the same', MOBILE_BEGINNING_999],
  ['08ddd, a five-digit special number', FIVE_DIGIT_SPECIAL],
];

/** `eight` as `ddd dd ddd` and as `(ddd) dd-ddd`. */
const SPACED = `${MOBILE.slice(0, 3)} ${MOBILE.slice(3, 5)} ${MOBILE.slice(5)}`;
const BRACKETED = `(${MOBILE.slice(0, 3)}) ${MOBILE.slice(3, 5)}-${MOBILE.slice(5)}`;

describe('CALL-01-AC2: with the call permission, the tap starts the call to #1; an emergency number goes to the dialer', () => {
  test('CALL-01-AC2: with the permission, callNumber starts android.intent.action.CALL with tel: and the number, once, and does not call Linking.openURL', async () => {
    mockPlatform.granted = true;

    await phone().callNumber(MOBILE);

    expect(callsStarted()).toEqual([`tel:${MOBILE}`]);
    expect(linking.opened).toEqual([]);
  });

  test.each(
    EMERGENCY.flatMap((number) =>
      PERMISSION.map(([permission, granted]): [string, string, boolean] => [
        number,
        permission,
        granted,
      ]),
    ),
  )(
    'CALL-01-AC2: the emergency number %s, %s, opens tel: with that number through Linking.openURL and never starts ACTION_CALL',
    async (number, _permission, granted) => {
      mockPlatform.granted = granted;

      await phone().callNumber(number);

      expect(callsStarted()).toEqual([]);
      expect(linking.opened).toEqual([`tel:${number}`]);
    },
  );

  test.each(WRITTEN_BOTH)(
    'CALL-01-AC2: %s, %s, opens the dialer with the reduced digits alone and never starts ACTION_CALL',
    async (_what, _permission, written, reduced, granted) => {
      mockPlatform.granted = granted;

      await phone().callNumber(written);

      expect(callsStarted()).toEqual([]);
      expect(linking.opened).toEqual([`tel:${reduced}`]);
    },
  );

  test.each(
    PREFIXED.flatMap(([shape, written, reduced]) =>
      PERMISSION.map(([permission, granted]): [string, string, string, string, boolean] => [
        shape,
        permission,
        written,
        reduced,
        granted,
      ]),
    ),
  )(
    'CALL-01-AC2: an emergency prefix followed by more digits, %s, %s, opens the dialer with the reduced digits and never starts ACTION_CALL',
    async (_shape, _permission, written, reduced, granted) => {
      mockPlatform.granted = granted;

      await phone().callNumber(written);

      expect(callsStarted()).toEqual([]);
      expect(linking.opened).toEqual([`tel:${reduced}`]);
    },
  );

  test.each(NARROWED)(
    'CALL-01-AC2: the narrowed prefixes: %s starts ACTION_CALL with the permission, as any other #1 does',
    async (_shape, number) => {
      mockPlatform.granted = true;

      await phone().callNumber(number);

      expect(callsStarted()).toEqual([`tel:${number}`]);
      expect(linking.opened).toEqual([]);
    },
  );

  test.each(
    NOT_PLAIN.flatMap(([what, given]) =>
      PERMISSION.map(([permission, granted]): [string, string, string, boolean] => [
        what,
        permission,
        given,
        granted,
      ]),
    ),
  )(
    'CALL-01-AC2: not a plain number, %s, %s: the dialer opens, ACTION_CALL is never started, and the URI holds the string with every character but the digits and a first + percent-encoded, so no , ; or # is read as a delimiter',
    async (_what, _permission, given, granted) => {
      mockPlatform.granted = granted;

      await phone().callNumber(given);

      expect(callsStarted()).toEqual([]);
      expect(linking.opened).toHaveLength(1);
      const uri = linking.opened[0] ?? '';
      expect(uri.startsWith('tel:')).toBe(true);
      const rest = uri.slice('tel:'.length);
      expect(rest).not.toMatch(/[,;#]/);
      expect(rest).toMatch(/^\+?(?:[0-9]|%[0-9A-Fa-f]{2})*$/);
      expect(decodeURIComponent(rest)).toBe(given.replace(/[\s\-.()]/g, ''));
    },
  );

  test.each([
    ['ddd dd ddd', SPACED],
    ['(ddd) dd-ddd', BRACKETED],
  ])(
    'CALL-01-AC2: the URI is built from the cleaned string: %s, with the permission, starts ACTION_CALL with tel: and the eight digits; without it, the dialer’s URI is the same',
    async (_shape, given) => {
      mockPlatform.granted = true;
      await phone().callNumber(given);
      expect(callsStarted()).toEqual([`tel:${MOBILE}`]);
      expect(linking.opened).toEqual([]);

      mockPlatform.granted = false;
      mockPlatform.intents = [];
      await phone().callNumber(given);
      expect(callsPlaced()).toEqual([]);
      expect(linking.opened).toEqual([`tel:${MOBILE}`]);
    },
  );

  test.each(NOT_EMERGENCY)(
    'CALL-01-AC2: no emergency number: %s starts ACTION_CALL with the permission',
    async (_what, number) => {
      mockPlatform.granted = true;

      await phone().callNumber(number);

      expect(callsStarted()).toEqual([`tel:${number}`]);
      expect(linking.opened).toEqual([]);
    },
  );

  test('CALL-01-AC2: it never asks Linking.canOpenURL first, which answers false on Android 11 and later without a <queries> entry', async () => {
    mockPlatform.granted = true;
    await phone().callNumber(MOBILE);
    mockPlatform.granted = false;
    await phone().callNumber(MOBILE);
    await phone().callNumber('112');
    await phone().openDialer('112');

    expect(linking.asked).toBe(0);
  });
});

describe('CALL-01-AC4: without the permission, the button still calls, through the dialer', () => {
  test('CALL-01-AC4: without the permission, callNumber opens the dialer with tel: and the number, and no call is placed: ACTION_CALL is refused, or not tried', async () => {
    mockPlatform.granted = false;

    await phone().callNumber(MOBILE);

    expect(callsPlaced()).toEqual([]);
    expect(linking.opened).toEqual([`tel:${MOBILE}`]);
  });

  test('CALL-01-AC4: with the permission, an ACTION_CALL that is refused falls back to the dialer, with tel: and the number', async () => {
    mockPlatform.granted = true;
    mockPlatform.callRefused = true;

    await phone().callNumber(MOBILE);

    expect(callsStarted()).toEqual([`tel:${MOBILE}`]);
    expect(linking.opened).toEqual([`tel:${MOBILE}`]);
  });

  test.each([
    [true, 'granted'],
    [false, 'notGranted'],
  ] as [boolean, string][])(
    'CALL-01-AC4: callPermission reads Android’s CALL_PHONE: held %s answers %s',
    async (granted, answer) => {
      mockPlatform.granted = granted;

      expect(await phone().callPermission()).toBe(answer);
    },
  );

  test.each([
    ['granted', 'granted'],
    ['denied', 'denied'],
    ['never_ask_again', 'neverAskAgain'],
  ] as ['granted' | 'denied' | 'never_ask_again', string][])(
    'CALL-01-AC4: askCallPermission asks Android for CALL_PHONE, and Android’s %s is %s',
    async (android, answer) => {
      mockPlatform.answer = android;
      const native: ReactNative = jest.requireActual('react-native');
      const asked: unknown[] = [];
      jest.spyOn(native.PermissionsAndroid, 'request').mockImplementation((permission) => {
        asked.push(permission);
        return Promise.resolve(mockPlatform.answer);
      });

      expect(await phone().askCallPermission()).toBe(answer);
      expect(asked).toEqual([native.PermissionsAndroid.PERMISSIONS.CALL_PHONE]);
    },
  );

  test('CALL-01-AC4: openAppSettings opens the app’s own settings, through Linking.openSettings or an APPLICATION_DETAILS_SETTINGS activity, once', async () => {
    await phone().openAppSettings();

    const detailsActivities = mockPlatform.intents.filter(({ action }) =>
      action.endsWith('APPLICATION_DETAILS_SETTINGS'),
    );
    expect(linking.settings + detailsActivities.length).toBe(1);
    expect(callsStarted()).toEqual([]);
    expect(linking.opened).toEqual([]);
  });
});

describe('CALL-01-AC5: a call the phone cannot start is said', () => {
  test.each(PERMISSION)(
    'CALL-01-AC5: %s, when every way to start the call fails, callNumber rejects, so the screen can say so',
    async (_permission, granted) => {
      mockPlatform.granted = granted;
      mockPlatform.callRefused = true;
      mockPlatform.dialRefused = true;

      await expect(phone().callNumber(MOBILE)).rejects.toBeDefined();
      expect(linking.opened).toEqual([`tel:${MOBILE}`]);
    },
  );
});

describe('CALL-02-AC3: 112 opens the phone’s own dialer, and places no call', () => {
  test.each(PERMISSION)(
    'CALL-02-AC3: %s, openDialer("112") calls Linking.openURL("tel:112") once and never starts ACTION_CALL',
    async (_permission, granted) => {
      mockPlatform.granted = granted;

      await phone().openDialer('112');

      expect(linking.opened).toEqual(['tel:112']);
      expect(callsStarted()).toEqual([]);
    },
  );

  test('CALL-02-AC5: openDialer rejects when the dialer cannot be opened, so the screen can say so', async () => {
    mockPlatform.dialRefused = true;

    await expect(phone().openDialer('112')).rejects.toBeDefined();
    expect(callsStarted()).toEqual([]);
  });
});
