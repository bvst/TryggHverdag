// GRP-02-AC1 to AC10 (L5): the walker's #1 contact, chosen, changed, kept on
// the phone and shown on the home screen, in the app as a person uses it.
//
// The whole app is rendered through Expo Router's own testing library from its
// route folder, src/app, as grp.test.tsx does, and found the way a screen
// reader finds it: by role, label and the text a person reads. The words are
// the bokmål of CALL-02.md's translations table, written here in full, as the
// spec asks: its keys may be renamed, its texts may not.
//
// What stands in for the world outside the app, and nothing else, each from
// the test kit and living outside the module registry, so it outlasts a
// launch as the phone outlasts a restart:
//   - expo-secure-store: fakeSecureStore, the Keystore in memory, recording
//     every read, write and delete with its options;
//   - features/call/phone.ts: fakePhone, the one module that reaches the
//     phone's calling path (CALL-01, approach 1), recording what the screens
//     asked of it. Mocked by its resolved path, `phone.ts`, and virtual, so this
//     file loads before the module exists (the red phase) and the same mock
//     stands in once it does: jest keys a mock by the path it resolves to;
//   - fetch: fakeApi, the API, answering each route as a test tells it, and
//     recording every request with its headers and body;
//   - expo-localization: a phone whose language is bokmål, or English when a
//     test asks;
//   - expo-crypto: random bytes, synthetic, for the join key.
// The app runs as Android (Platform.OS), the one platform it ships on until
// task 12 (D-134). AppState and Android's back are driven by the test.
//
// #1's key in secure storage is the app's to name (GRP-02, approach 4: "under
// its own key"). These tests learn it from the app itself, the first time #1
// is saved through the setup screen, and seed it under that key afterwards,
// so they hold "under its own key" without naming it.
//
// Test data is synthetic (RG-07): every number and name comes from the test
// kit's phone-number fixtures (HK-07), and is built into the shapes a person
// types at run time.
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type * as ExpoRouterTesting from 'expo-router/testing-library';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fakeApi, parsedOrText } from '../../../../../packages/test-kit/src/fake-api.ts';
import { fakePhone } from '../../../../../packages/test-kit/src/fake-phone.ts';
import { fakeSecureStore } from '../../../../../packages/test-kit/src/fake-secure-store.ts';
import {
  FIFTEEN_DIGITS,
  FIRST_CONTACT_NAME,
  FOREIGN_NORMALISED,
  FOREIGN_TYPED,
  MOBILE,
  NORWAY_PLUS,
  OTHER_FIRST_CONTACT_NAME,
  OTHER_MOBILE,
  SIXTEEN_DIGITS,
  TWO_DIGITS,
} from '../../../../../packages/test-kit/src/fixtures/phone-numbers.ts';
import {
  componentName,
  flattenStyle,
  labelOf,
  nameOf,
  roleOf,
  shownTexts,
  spelled,
  type FiberLike,
  type HostNode,
} from '../../../../../packages/test-kit/src/rendered-tree.ts';
import en from '../../shared/translations/en.json';
import nb from '../../shared/translations/nb.json';

// ---------------------------------------------------------------------------
// The world outside the app.
// ---------------------------------------------------------------------------

const mockJournal: string[] = [];
const mockStore = fakeSecureStore({ journal: mockJournal });
const mockPhone = fakePhone({ journal: mockJournal });
const api = fakeApi();
/** The phone's language, read by the expo-localization stand-in when a launch loads it. */
let mockLanguage: 'nb-NO' | 'en-GB' = 'nb-NO';

jest.mock('expo-secure-store', () => mockStore.module, { virtual: true });
jest.mock('../call/phone.ts', () => mockPhone.module, { virtual: true });
jest.mock(
  'expo-crypto',
  () => {
    const bytes = (size: number) =>
      Uint8Array.from({ length: size }, () => Math.floor(Math.random() * 256));
    return {
      getRandomBytes: jest.fn(bytes),
      getRandomBytesAsync: jest.fn((size: number) => Promise.resolve(bytes(size))),
      randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000000'),
    };
  },
  { virtual: true },
);
jest.mock('expo-localization', () => {
  const english = mockLanguage === 'en-GB';
  const locale = {
    languageTag: mockLanguage,
    languageCode: english ? 'en' : 'nb',
    regionCode: english ? 'GB' : 'NO',
    currencyCode: english ? 'GBP' : 'NOK',
    currencySymbol: english ? '£' : 'kr',
    languageScriptCode: null,
    languageRegionCode: english ? 'GB' : 'NO',
    languageCurrencyCode: english ? 'GBP' : 'NOK',
    languageCurrencySymbol: english ? '£' : 'kr',
    textDirection: 'ltr',
    decimalSeparator: ',',
    digitGroupingSeparator: ' ',
    measurementSystem: 'metric',
    temperatureUnit: 'celsius',
  };
  return {
    ...jest.requireActual<object>('expo-localization'),
    getLocales: () => [locale],
    useLocales: () => [locale],
    getCalendars: () => [
      { calendar: 'gregory', timeZone: 'Europe/Oslo', uses24hourClock: true, firstWeekday: 2 },
    ],
  };
});
jest.mock('@testing-library/react-native', () =>
  jest.requireActual<object>('@testing-library/react-native/pure'),
);

// A launch loads Expo Router afresh in a new module registry: slow on a cold
// cache, so a slow machine is never read as a broken app.
jest.setTimeout(90_000);

/** Requests the fake API had no answer for: each fails the test it was sent in. */
const unanswered: string[] = [];

/** The app's fetch: every request read into the fake API, and its reply turned into what fetch does. */
async function fakeFetch(input: unknown, init?: unknown): Promise<Response> {
  const request = new Request(input as RequestInfo, init as RequestInit | undefined);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const read = {
    method: request.method,
    path: new URL(request.url).pathname,
    headers,
    body: parsedOrText(await request.text()),
    at: Date.now(),
  };
  let reply;
  try {
    reply = api.answer(read);
  } catch (error) {
    unanswered.push(String(error));
    throw error;
  }
  if (reply === 'no answer') {
    return new Promise<Response>(() => undefined);
  }
  const answer = typeof reply === 'object' && 'held' in reply ? await reply.held : reply;
  if (answer === 'network failure') {
    throw new TypeError('Network request failed');
  }
  return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
    status: answer.status,
    headers: { 'content-type': 'application/json' },
  });
}

// Fixed in place for the file, as grp.test.tsx does: Expo's runtime puts its
// own fetch on the global when it loads, unless it cannot, and says so in one
// console error, the only one left out of what the console records below.
Object.defineProperty(globalThis, 'fetch', {
  value: fakeFetch,
  writable: false,
  configurable: false,
  enumerable: true,
});
const EXPO_LEAVES_FETCH = 'Failed to set polyfill. fetch is not configurable.';

/** Every call to the console, by method, as the app made it (GRP-02-AC9). */
const consoleCalls: { method: string; args: unknown[] }[] = [];
for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = console[method].bind(console);
  jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
    if (args[0] === EXPO_LEAVES_FETCH) {
      return;
    }
    consoleCalls.push({ method, args });
    original(...args);
  });
}

// ---------------------------------------------------------------------------
// The words, as CALL-02.md's translations table writes them (bokmål).
// ---------------------------------------------------------------------------

const NB = {
  emergencyLabel: 'Ring 112, nødnummeret',
  call: (name: string) => `Ring ${name}`,
  callFailed: (number: string) => `Telefonen kunne ikke starte samtalen. Ring ${number} selv.`,
  none: 'Velg hvem du vil ringe',
  noneHint: 'Du har ikke valgt en nummer 1-kontakt. Trykk for å velge.',
  unreadable: 'Vi fikk ikke lest hvem du skal ringe. Trykk for å velge igjen.',
  shown: (name: string) => `Nummer 1: ${name}`,
  change: 'Bytt nummer 1-kontakt',
  title: 'Hvem vil du ringe først?',
  intro: 'Den store knappen ringer denne personen. Det kan være hvem som helst du stoler på.',
  nameLabel: 'Navn',
  numberLabel: 'Telefonnummer',
  save: 'Lagre',
  cancel: 'Avbryt',
  numberNotUsable: 'Nummeret ser ikke riktig ut. Bruk bare sifre, gjerne med + og landskode først.',
  nameNotUsable: 'Navnet kan ikke brukes. Det må ha minst ett synlig tegn, og ingen skjulte tegn.',
  notSaved: 'Nummeret ble ikke lagret. Prøv igjen.',
  unreachable: 'Vi fikk ikke kontakt med serveren. Prøv igjen om litt.',
  retry: 'Prøv igjen',
  joinTitle: 'Bli med i gruppen',
  signedOut: 'Denne telefonen er ikke lenger logget inn i gruppen.',
  joinCode: 'Invitasjonskode',
  joinName: 'Navnet ditt',
  joinSubmit: 'Bli med',
  memberTitle: 'Du er med i gruppen',
} as const;

/** The same texts, as en.json is to hold them under the same keys (GRP-02-AC10). */
const EN = {
  shown: (name: string) => `#1: ${name}`,
  change: 'Change your #1 contact',
  title: 'Who do you call first?',
  nameLabel: 'Name',
  numberLabel: 'Phone number',
  save: 'Save',
};

/** A pattern for exactly `text`. */
const exactly = (text: string): RegExp =>
  new RegExp(`^${text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}$`);
/** A pattern for text that begins with `text`. */
const beginning = (text: string): RegExp =>
  new RegExp(`^${text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`);

// ---------------------------------------------------------------------------
// The app.
// ---------------------------------------------------------------------------

type ReactNative = typeof import('react-native');
type Screen = typeof ExpoRouterTesting.screen;

interface Launched {
  testing: typeof ExpoRouterTesting;
  native: ReactNative;
  /** Android's back listeners, as the app registered them, latest last. */
  back: BackListener[];
  /** AppState's change listeners. */
  appState: AppStateListener[];
}

/** A listener for Android's back, as BackHandler takes one. */
type BackListener = Parameters<ReactNative['BackHandler']['addEventListener']>[1];
/** A listener for AppState's changes, as AppState takes one. */
type AppStateListener = Parameters<ReactNative['AppState']['addEventListener']>[1];

let launched: Launched | undefined;

/**
 * Launches the app: a fresh module registry, so nothing kept in memory
 * survives, on Android, in the phone's language, opened at "/". Secure
 * storage, the phone and the API stay as they were.
 */
async function launch({
  language = 'nb-NO',
}: { language?: 'nb-NO' | 'en-GB' } = {}): Promise<Screen> {
  if (launched !== undefined) {
    await launched.testing.cleanup();
  }
  jest.resetModules();
  mockLanguage = language;
  const native: ReactNative = jest.requireActual('react-native');
  (native.Platform as { OS: string }).OS = 'android';
  const back: Launched['back'] = [];
  jest.spyOn(native.BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    back.push(handler);
    return {
      remove: () => {
        back.splice(back.indexOf(handler), 1);
      },
    };
  });
  const appState: Launched['appState'] = [];
  (native.AppState as { currentState: string }).currentState = 'active';
  jest.spyOn(native.AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appState.push(listener);
    return {
      remove: () => {
        appState.splice(appState.indexOf(listener), 1);
      },
    };
  });
  const testing: typeof ExpoRouterTesting = jest.requireActual('expo-router/testing-library');
  launched = { testing, native, back, appState };
  await testing.renderRouter('src/app', { initialUrl: '/' });
  return testing.screen;
}

function app(): Launched {
  if (launched === undefined) {
    throw new Error('the app was never launched');
  }
  return launched;
}

/** Presses Android's back, as the system does: the latest listener first, until one takes it. */
async function pressBack(): Promise<void> {
  await app().testing.act(async () => {
    for (const handler of [...app().back].reverse()) {
      if (handler({} as Parameters<BackListener>[0]) === true) {
        break;
      }
    }
    await Promise.resolve();
  });
}

/** Every host element on screen, in the order a screen reader meets them. */
const hostNodes = (screen: Screen): HostNode[] => screen.container.queryAll(() => true);

/** All the text on screen, in reading order. */
const texts = (screen: Screen): string[] => shownTexts(hostNodes(screen)).map(({ text }) => text);

/** Every button on screen, in reading order. */
const buttons = (screen: Screen): HostNode[] =>
  hostNodes(screen).filter((node) => roleOf(node) === 'button');

/**
 * The call button, however it reads now: "Ring {name}" with a #1, "Velg hvem
 * du vil ringe" without one. Exactly one, or it throws, saying what is there.
 */
function callButton(screen: Screen): HostNode {
  const found = buttons(screen).filter(
    (node) =>
      labelOf(node) !== NB.emergencyLabel &&
      (beginning(NB.none).test(nameOf(node)) || nameOf(node).startsWith('Ring ')),
  );
  const [only] = found;
  if (found.length !== 1 || only === undefined) {
    throw new Error(
      `expected one call button, found ${String(found.length)}; the buttons are ${JSON.stringify(
        buttons(screen).map(nameOf),
      )}`,
    );
  }
  return only;
}

/** Waits for the call button, reading `name` from its start. */
async function findCallButton(screen: Screen, name: string): Promise<HostNode> {
  await app().testing.waitFor(() => {
    expect(beginning(name).test(nameOf(callButton(screen)))).toBe(true);
  });
  return callButton(screen);
}

async function press(node: HostNode): Promise<void> {
  await app().testing.fireEvent.press(
    node as Parameters<Launched['testing']['fireEvent']['press']>[0],
  );
}

async function pressButton(screen: Screen, name: string): Promise<void> {
  await press(await screen.findByRole('button', { name: exactly(name) }));
}

async function type(screen: Screen, label: string, text: string): Promise<void> {
  await app().testing.fireEvent.changeText(await screen.findByLabelText(exactly(label)), text);
}

/** Lets every promise that can settle settle, and React render what it set. */
async function settle(): Promise<void> {
  await app().testing.act(async () => {
    for (let turn = 0; turn < 50; turn += 1) {
      await Promise.resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// The phone's state.
// ---------------------------------------------------------------------------

const ME = 'GET /v1/me';
const JOIN = 'POST /v1/group/members';
const CREDENTIAL_KEY = 'deviceCredential';
const JOIN_KEY = 'joinKey';

/** A synthetic credential, made at run time (gitleaks reads every committed line). */
const CREDENTIAL = 'C'.repeat(20) + 'd'.repeat(13) + '-_0123456789';
const MEMBER_ID = 'b2b2b2b2-0000-4000-8000-00000000000b';
const MEMBER_NAME = 'Testmedlem ØKVAR';

/** GET /v1/me's answer for a member of `role`. */
const meAnswer = (role: 'MEMBER' | 'ADMIN' = 'MEMBER') => ({
  status: 200,
  body: { userId: MEMBER_ID, displayName: MEMBER_NAME, role },
});

/** A #1 as a person types it, and as the app is to keep and show it. */
interface Contact {
  name: string;
  number: string;
}

/** The fixtures' mobile number as a person types it: `ddd dd ddd`. */
const spaced = (eight: string): string =>
  `${eight.slice(0, 3)} ${eight.slice(3, 5)} ${eight.slice(5)}`;

const FIRST: Contact = { name: FIRST_CONTACT_NAME, number: MOBILE };
const OTHER: Contact = { name: OTHER_FIRST_CONTACT_NAME, number: OTHER_MOBILE };

/** The key the app keeps #1 under, learned from the app the first time #1 is saved. */
let learnedKey: string | null = null;

/** The keys secure storage held before #1 existed, which are not #1's. */
const NOT_FIRST_CONTACT = new Set([CREDENTIAL_KEY, JOIN_KEY]);

/** The keys written since `from` in the journal of calls, other than the credential's and the join key's. */
const keysWritten = (): string[] => [
  ...new Set(
    mockStore
      .calls()
      .filter((call) => call.op === 'set' && !call.refused && !NOT_FIRST_CONTACT.has(call.key))
      .map((call) => call.key),
  ),
];

/** Signed in: a credential in secure storage, and GET /v1/me answering as `role`. */
function signedIn(role: 'MEMBER' | 'ADMIN' = 'MEMBER'): void {
  mockStore.items.set(CREDENTIAL_KEY, CREDENTIAL);
  api.always(ME, meAnswer(role));
}

/** On the home screen with no #1: the setup opened from the call button, `contact` typed, and saved. */
async function chooseThroughTheApp(screen: Screen, contact: Contact, typed = contact.number) {
  await press(await findCallButton(screen, NB.none));
  await screen.findByText(NB.title);
  await type(screen, NB.nameLabel, contact.name);
  await type(screen, NB.numberLabel, typed);
  await pressButton(screen, NB.save);
}

/** The key #1 is kept under: learned once, by choosing a #1 through the app, then everything is forgotten. */
async function firstContactKey(): Promise<string> {
  if (learnedKey !== null) {
    return learnedKey;
  }
  mockStore.reset();
  signedIn();
  mockPhone.permission = 'granted';
  const screen = await launch();
  await chooseThroughTheApp(screen, FIRST);
  await screen.findByText(NB.shown(FIRST.name));
  const written = keysWritten();
  if (written.length !== 1 || written[0] === undefined) {
    throw new Error(`saving #1 wrote ${JSON.stringify(written)}, not one key of its own`);
  }
  learnedKey = written[0];
  await app().testing.cleanup();
  launched = undefined;
  mockStore.reset();
  mockPhone.reset();
  api.reset();
  return learnedKey;
}

/** A phone as a test needs it: signed in or not, with a #1 stored, raw, or none. */
async function phoneHolding({
  credential = true,
  role = 'MEMBER',
  firstContact,
}: {
  credential?: boolean;
  role?: 'MEMBER' | 'ADMIN';
  firstContact?: Contact | { raw: string };
} = {}): Promise<void> {
  const key = firstContact === undefined ? null : await firstContactKey();
  if (credential) {
    signedIn(role);
  }
  if (key !== null && firstContact !== undefined) {
    mockStore.items.set(
      key,
      'raw' in firstContact ? firstContact.raw : JSON.stringify(firstContact),
    );
  }
}

/** The home screen shows `contact`: "Nummer 1: {name}", the number under it, and the call button "Ring {name}". */
async function expectShown(screen: Screen, contact: Contact): Promise<void> {
  await screen.findByText(NB.shown(contact.name));
  const order = texts(screen);
  expect(order[order.indexOf(NB.shown(contact.name)) + 1]).toBe(contact.number);
  expect(nameOf(await findCallButton(screen, NB.call(contact.name)))).toMatch(
    beginning(NB.call(contact.name)),
  );
}

/** Every form #1 can take, typed, normalised and spelled, that must never leave the app. */
function formsOf(contact: Contact): string[] {
  const digits = contact.number.replace(/\D/g, '');
  return [contact.name, contact.number, digits, spelled(contact.number), spaced(digits)].filter(
    (form) => form.length >= 3,
  );
}

/** Everything a value says, an error's message and stack included. */
function said(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}\n${value.stack ?? ''}`;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    const json = JSON.stringify(value) as string | undefined;
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

beforeEach(() => {
  mockStore.reset();
  mockPhone.reset();
  mockPhone.permission = 'granted';
  api.reset();
  mockJournal.length = 0;
  consoleCalls.length = 0;
  unanswered.length = 0;
});

afterEach(async () => {
  if (launched !== undefined) {
    await launched.testing.cleanup();
    launched = undefined;
  }
  // Real timers come back here, once the app is unmounted, and never in a
  // describe's own afterEach, which Jest runs before this one. Expo Router's
  // renderRouter fakes the timers, and React Native's StatusBar, drawn by the
  // root layout (CALL-02-AC7), clears its pending immediate as it unmounts:
  // unmounted under real timers, it hands its fake id to Node's real
  // clearImmediate, which corrupts Node's count of immediates, and from then
  // on React's act never settles and every later launch in the file hangs.
  jest.useRealTimers();
  expect(unanswered).toEqual([]);
});

// ---------------------------------------------------------------------------
// AC1: no #1, a call button that explains, never a dead one.
// ---------------------------------------------------------------------------

describe('GRP-02-AC1: with no #1, the call button explains how to set one, and opens the setup', () => {
  test('GRP-02-AC1: a signed-in phone with no #1 shows the call button reading "Velg hvem du vil ringe", with "Du har ikke valgt en nummer 1-kontakt. Trykk for å velge." under it, and neither "Nummer 1: …" nor "Bytt nummer 1-kontakt"', async () => {
    await phoneHolding();
    const screen = await launch();

    await findCallButton(screen, NB.none);
    const order = texts(screen);

    expect(order.indexOf(NB.none)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(NB.noneHint)).toBeGreaterThan(order.indexOf(NB.none));
    expect(order.filter((text) => text.startsWith('Nummer 1:'))).toEqual([]);
    expect(
      [...order, ...hostNodes(screen).map((node) => labelOf(node) ?? '')].filter((text) =>
        text.includes(NB.change),
      ),
    ).toEqual([]);
  });

  test('GRP-02-AC1: the explaining button is the call button: the same component, the same size style, and the same place among the screen’s buttons as the call button with a #1 (CALL-01-AC1 holds for both)', async () => {
    /** The call button as it is drawn: its component, its size, and its place among the buttons. */
    const drawn = (screen: Screen) => {
      const button = callButton(screen);
      const fiber = (button as unknown as { unstable_fiber: FiberLike | null }).unstable_fiber;
      const components: string[] = [];
      for (let at = fiber?.return ?? null; at !== null; at = at.return) {
        if (typeof at.type !== 'string') {
          components.push(componentName(at.type));
        }
      }
      const style = flattenStyle(button.props['style']);
      const size = Object.fromEntries(
        Object.entries(style).filter(([key]) =>
          /^(min|max)?(height|width)$|^(alignSelf|flex|flexGrow|flexShrink|flexBasis)$|^(padding|margin)/i.test(
            key,
          ),
        ),
      );
      return {
        // The nearest component of the app's own above React Native's Pressable.
        component: components.find((name) => name !== '' && name !== 'Pressable') ?? '',
        size,
        place: buttons(screen).indexOf(button),
      };
    };
    await phoneHolding();
    const without = drawn(
      await launch().then(async (screen) => {
        await findCallButton(screen, NB.none);
        return screen;
      }),
    );
    await phoneHolding({ firstContact: FIRST });
    const screen = await launch();
    await findCallButton(screen, NB.call(FIRST.name));
    const withOne = drawn(screen);

    expect(without.component).not.toBe('');
    expect(Object.keys(without.size)).toContain('minHeight');
    expect(without).toEqual(withOne);
  });

  test('GRP-02-AC1: a tap on it opens the setup screen, and the phone module’s callNumber, openDialer and askCallPermission are not called', async () => {
    await phoneHolding();
    mockPhone.permission = 'notGranted';
    const screen = await launch();

    await press(await findCallButton(screen, NB.none));

    expect(await screen.findByText(NB.title)).toBeTruthy();
    expect(screen.getByLabelText(exactly(NB.nameLabel))).toBeTruthy();
    expect(screen.getByLabelText(exactly(NB.numberLabel))).toBeTruthy();
    expect(mockPhone.timesCalled('callNumber')).toBe(0);
    expect(mockPhone.timesCalled('openDialer')).toBe(0);
    expect(mockPhone.timesCalled('askCallPermission')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC2: chosen by name and number, kept, and shown.
// ---------------------------------------------------------------------------

describe('GRP-02-AC2: the walker chooses #1 by name and number, and the home screen shows who #1 is', () => {
  test('GRP-02-AC2: a usable name and number, saved: secure storage holds, under #1’s own key and readable after the first unlock on this phone only, exactly { name, number }, the name trimmed and the number normalised; the home screen shows "Nummer 1: {name}", the number under it, and the call button "Ring {name}"; and so after a restart', async () => {
    await phoneHolding();
    const screen = await launch();

    await chooseThroughTheApp(
      screen,
      { name: `  ${FIRST.name}  `, number: FIRST.number },
      spaced(FIRST.number),
    );
    await expectShown(screen, FIRST);

    const written = keysWritten();
    expect(written).toHaveLength(1);
    const key = written[0] ?? '';
    const [set, ...more] = mockStore.callsFor('set', key);
    expect(more).toEqual([]);
    expect(JSON.parse(set?.value ?? 'null')).toStrictEqual({
      name: FIRST.name,
      number: FIRST.number,
    });
    expect((set?.options as { keychainAccessible?: unknown } | undefined)?.keychainAccessible).toBe(
      mockStore.module.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    );

    const again = await launch();
    await expectShown(again, FIRST);
  });

  test('GRP-02-AC2: a foreign number with its country code is kept and shown with its +, normalised', async () => {
    await phoneHolding();
    const screen = await launch();

    await chooseThroughTheApp(
      screen,
      { name: FIRST.name, number: FOREIGN_NORMALISED },
      FOREIGN_TYPED,
    );

    await expectShown(screen, { name: FIRST.name, number: FOREIGN_NORMALISED });
  });
});

// ---------------------------------------------------------------------------
// AC3: any phone number, and only a phone number, on the setup screen.
// (The rule itself, table-driven, is first-contact.test.tsx.)
// ---------------------------------------------------------------------------

/** Numbers the rule refuses, as typed on the setup screen. Kept out of test.each, as HK-05's counter asks. */
const REFUSED_NUMBERS: [string, string][] = [
  ['an empty field', ''],
  ['only whitespace', '   '],
  ['a letter in it', `${MOBILE.slice(0, 4)}A${MOBILE.slice(5)}`],
  ['a star', `*${MOBILE}`],
  ['a hash', `${MOBILE}#`],
  ['a + after the first character', `${MOBILE.slice(0, 2)}+${MOBILE.slice(2)}`],
  ['two +', `++${MOBILE}`],
  ['two digits', TWO_DIGITS],
  ['sixteen digits', SIXTEEN_DIGITS],
];

describe('GRP-02-AC3: any phone number, and only a phone number, on the setup screen', () => {
  test.each(REFUSED_NUMBERS)(
    'GRP-02-AC3: a number with %s is refused on "Lagre": "Nummeret ser ikke riktig ut. Bruk bare sifre, gjerne med + og landskode først." shows, and secure storage’s setItemAsync is not called',
    async (_what, typed) => {
      await phoneHolding();
      const screen = await launch();
      await press(await findCallButton(screen, NB.none));
      await screen.findByText(NB.title);
      const before = mockStore.calls().length;

      await type(screen, NB.nameLabel, FIRST.name);
      await type(screen, NB.numberLabel, typed);
      await pressButton(screen, NB.save);

      expect(await screen.findByText(NB.numberNotUsable)).toBeTruthy();
      expect(
        mockStore
          .calls()
          .slice(before)
          .filter((call) => call.op === 'set'),
      ).toEqual([]);
      expect(screen.getByText(NB.title)).toBeTruthy();
    },
  );

  test('GRP-02-AC3: a number of exactly fifteen digits, with a + and a country code, is saved', async () => {
    await phoneHolding();
    const screen = await launch();

    await chooseThroughTheApp(screen, { name: FIRST.name, number: `+${FIFTEEN_DIGITS}` });

    await expectShown(screen, { name: FIRST.name, number: `+${FIFTEEN_DIGITS}` });
  });

  test('GRP-02-AC3: while a number is typed, checked, refused and saved, the app sends the server nothing', async () => {
    await phoneHolding();
    const screen = await launch();
    await findCallButton(screen, NB.none);
    await settle();
    api.forget();

    await press(callButton(screen));
    await screen.findByText(NB.title);
    await type(screen, NB.nameLabel, FIRST.name);
    await type(screen, NB.numberLabel, `${MOBILE}A`);
    await pressButton(screen, NB.save);
    await screen.findByText(NB.numberNotUsable);
    await type(screen, NB.numberLabel, `${NORWAY_PLUS} ${spaced(MOBILE)}`);
    await pressButton(screen, NB.save);
    await screen.findByText(NB.shown(FIRST.name));
    await settle();

    expect(api.sent()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC4: the name follows the contract's display-name rule.
// ---------------------------------------------------------------------------

const REFUSED_NAMES: [string, string][] = [
  ['empty', ''],
  ['only whitespace', '   '],
  ['41 characters after trimming', ` ${'Testkontakt'.repeat(4).slice(0, 41)} `],
  ['a right-to-left override in it', 'Test\u202ekontakt'],
  ['an isolate around it', '\u2068Testkontakt\u2069'],
];

const ACCEPTED_NAMES: string[] = ['Åse', "O'Brien", 'Anne-Marit'];

describe('GRP-02-AC4: #1’s name follows the contract’s display-name rule', () => {
  test.each(REFUSED_NAMES)(
    'GRP-02-AC4: a name %s is refused: "Navnet kan ikke brukes. Det må ha minst ett synlig tegn, og ingen skjulte tegn." shows, and secure storage’s setItemAsync is not called',
    async (_what, name) => {
      await phoneHolding();
      const screen = await launch();
      await press(await findCallButton(screen, NB.none));
      await screen.findByText(NB.title);
      const before = mockStore.calls().length;

      await type(screen, NB.nameLabel, name);
      await type(screen, NB.numberLabel, MOBILE);
      await pressButton(screen, NB.save);

      expect(await screen.findByText(NB.nameNotUsable)).toBeTruthy();
      expect(
        mockStore
          .calls()
          .slice(before)
          .filter((call) => call.op === 'set'),
      ).toEqual([]);
    },
  );

  test.each(ACCEPTED_NAMES)('GRP-02-AC4: the name %s is accepted and shown', async (name) => {
    await phoneHolding();
    const screen = await launch();

    await chooseThroughTheApp(screen, { name, number: MOBILE });

    await expectShown(screen, { name, number: MOBILE });
  });
});

// ---------------------------------------------------------------------------
// AC5: changed, or left as it was.
// ---------------------------------------------------------------------------

describe('GRP-02-AC5: the walker changes #1, or leaves it as it was', () => {
  test('GRP-02-AC5: "Bytt nummer 1-kontakt" opens the setup with the current name and number in its fields; saving a new one replaces #1 in secure storage, and the home screen and the call button show the new one', async () => {
    await phoneHolding({ firstContact: FIRST });
    const key = await firstContactKey();
    const screen = await launch();
    await expectShown(screen, FIRST);

    await pressButton(screen, NB.change);
    await screen.findByText(NB.title);
    expect(screen.getByLabelText(exactly(NB.nameLabel)).props['value']).toBe(FIRST.name);
    expect(screen.getByLabelText(exactly(NB.numberLabel)).props['value']).toBe(FIRST.number);
    await type(screen, NB.nameLabel, OTHER.name);
    await type(screen, NB.numberLabel, spaced(OTHER.number));
    await pressButton(screen, NB.save);

    await expectShown(screen, OTHER);
    expect(screen.queryByText(NB.shown(FIRST.name))).toBeNull();
    expect(JSON.parse(mockStore.items.get(key) ?? 'null')).toStrictEqual(OTHER);
    expect(keysWritten()).toEqual([key]);
  });

  test.each<[string, 'cancel' | 'back']>([
    ['"Avbryt"', 'cancel'],
    ['Android’s back', 'back'],
  ])(
    'GRP-02-AC5: %s on the setup screen returns to the home screen with secure storage’s value and the screen’s #1 unchanged',
    async (_what, how) => {
      await phoneHolding({ firstContact: FIRST });
      const key = await firstContactKey();
      const stored = mockStore.items.get(key);
      const screen = await launch();
      await expectShown(screen, FIRST);

      await pressButton(screen, NB.change);
      await screen.findByText(NB.title);
      await type(screen, NB.nameLabel, OTHER.name);
      await type(screen, NB.numberLabel, OTHER.number);
      if (how === 'cancel') {
        await pressButton(screen, NB.cancel);
      } else {
        await pressBack();
      }

      await expectShown(screen, FIRST);
      expect(screen.queryByText(NB.title)).toBeNull();
      expect(mockStore.items.get(key)).toBe(stored);
      expect(mockStore.callsFor('set', key)).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// AC6: #1 stays on the phone.
// ---------------------------------------------------------------------------

/** Jest's fake timers, with promises left to run as they do (as grp.test.tsx). */
const fakeTimers = () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
};

/** Moves the fake clock on, 10 ms at a time, until the app has sent a request to `route`; when it did. */
async function sentAt(route: string): Promise<number> {
  for (let step = 0; step < 1_000 && api.to(route).length === 0; step += 1) {
    await app().testing.act(async () => {
      jest.advanceTimersByTime(10);
      await Promise.resolve();
    });
    await settle();
  }
  const first = api.to(route)[0];
  if (first === undefined) {
    throw new Error(`the app sent nothing to ${route}`);
  }
  return first.at;
}

/** Moves the fake clock to exactly `ms` after `from`. */
async function advanceTo(from: number, ms: number): Promise<void> {
  await app().testing.act(async () => {
    jest.advanceTimersByTime(from + ms - Date.now());
    await Promise.resolve();
  });
  await settle();
}

/** The ways GET /v1/me fails without signing out, each set up and brought to its end. */
const FAILURES: [string, string][] = [
  ['no answer within 20 s', 'no answer'],
  ['a network error', 'network failure'],
  ['a 5xx', '503'],
];

/** Launches with GET /v1/me failing as `how`, and waits until the app has given up on it. */
async function launchWithMeFailing(how: string): Promise<Screen> {
  if (how === 'no answer') {
    api.reply(ME, 'no answer');
    fakeTimers();
    const screen = await launch();
    const sent = await sentAt(ME);
    await advanceTo(sent, 20_000);
    return screen;
  }
  api.reply(ME, how === 'network failure' ? 'network failure' : { status: Number(how) });
  const screen = await launch();
  await screen.findByText(NB.unreachable);
  return screen;
}

describe('GRP-02-AC6: #1 stays on the phone', () => {
  // Real timers are restored by the file's afterEach, after the app is unmounted.

  test('GRP-02-AC6: through choosing, changing and calling #1, no request the app makes to the server holds #1’s name or number, in its path, its headers or its body', async () => {
    await phoneHolding({ role: 'ADMIN' });
    const screen = await launch();
    await chooseThroughTheApp(screen, FIRST, spaced(FIRST.number));
    await expectShown(screen, FIRST);
    await pressButton(screen, NB.change);
    await type(screen, NB.nameLabel, OTHER.name);
    await type(screen, NB.numberLabel, `${NORWAY_PLUS} ${spaced(OTHER.number)}`);
    await pressButton(screen, NB.save);
    await screen.findByText(NB.shown(OTHER.name));
    await press(callButton(screen));
    await settle();

    const forms = [...formsOf(FIRST), ...formsOf(OTHER)];
    expect(api.sent().length).toBeGreaterThan(0);
    for (const request of api.sent()) {
      const whole = said({ path: request.path, headers: request.headers, body: request.body });
      expect({
        request: request.path,
        holds: forms.filter((form) => whole.includes(form)),
      }).toEqual({
        request: request.path,
        holds: [],
      });
    }
  });

  test('GRP-02-AC6: the secure-store fake records #1’s name and number under #1’s key alone', async () => {
    await phoneHolding();
    const screen = await launch();
    await chooseThroughTheApp(screen, FIRST);
    await expectShown(screen, FIRST);
    await pressButton(screen, NB.change);
    await type(screen, NB.nameLabel, OTHER.name);
    await type(screen, NB.numberLabel, OTHER.number);
    await pressButton(screen, NB.save);
    await screen.findByText(NB.shown(OTHER.name));
    const key = await firstContactKey();

    const forms = [...formsOf(FIRST), ...formsOf(OTHER)];
    const elsewhere = mockStore
      .calls()
      .filter((call) => call.key !== key)
      .filter((call) => forms.some((form) => said([call.key, call.value]).includes(form)));
    expect(elsewhere).toEqual([]);
    expect(
      [...mockStore.items].filter(
        ([stored, value]) => stored !== key && forms.some((form) => value.includes(form)),
      ),
    ).toEqual([]);
  });

  test('GRP-02-AC6: apps/mobile/package.json declares none of AsyncStorage, expo-file-system, expo-sqlite and react-native-mmkv, so the app has no other store #1 could be written to', () => {
    // A guard: it passes before task 2's code as after it, by design. It holds
    // that #1 has no second place to go (D-141, "Who decided").
    const manifest = JSON.parse(
      readFileSync(path.join(__dirname, '../../../package.json'), 'utf8'),
    ) as Partial<Record<string, Record<string, string>>>;
    const declared = [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ].flatMap((field) => Object.keys(manifest[field] ?? {}));

    expect(declared).toContain('expo-secure-store');
    expect(
      declared.filter((name) =>
        [
          '@react-native-async-storage/async-storage',
          'expo-file-system',
          'expo-sqlite',
          'react-native-mmkv',
        ].includes(name),
      ),
    ).toEqual([]);
  });

  test('GRP-02-AC6: a 401 deletes #1’s key with the credential, and the join screen shows with its line; after a new join, the home screen shows no #1', async () => {
    await phoneHolding({ firstContact: FIRST });
    const key = await firstContactKey();
    api.always(ME, { status: 401, body: { code: 'UNAUTHORIZED', status: 401 } });

    const screen = await launch();

    expect(await screen.findByText(NB.signedOut)).toBeTruthy();
    expect(mockStore.items.has(key)).toBe(false);
    expect(mockStore.items.has(CREDENTIAL_KEY)).toBe(false);
    expect(mockStore.callsFor('delete', key).length).toBeGreaterThan(0);

    api.reply(JOIN, {
      status: 201,
      body: { credential: CREDENTIAL, userId: MEMBER_ID, role: 'MEMBER' },
    });
    api.always(ME, meAnswer());
    await type(screen, NB.joinCode, 'ABCDE-FGHJK-MNPQR-STVWX');
    await type(screen, NB.joinName, MEMBER_NAME);
    await pressButton(screen, NB.joinSubmit);

    await findCallButton(screen, NB.none);
    expect(screen.queryByText(NB.shown(FIRST.name))).toBeNull();
    expect(texts(screen).filter((text) => text.startsWith('Nummer 1:'))).toEqual([]);
  });

  test.each(FAILURES)(
    'GRP-02-AC6: GET /v1/me with %s deletes nothing of #1, and the home screen shows #1',
    async (_what, how) => {
      await phoneHolding({ firstContact: FIRST });
      const key = await firstContactKey();

      const screen = await launchWithMeFailing(how);

      expect(mockStore.items.has(key)).toBe(true);
      expect(mockStore.callsFor('delete', key)).toEqual([]);
      expect(screen.getByText(NB.shown(FIRST.name))).toBeTruthy();
    },
  );
});

// ---------------------------------------------------------------------------
// AC7: shown without waiting for the server.
// ---------------------------------------------------------------------------

describe('GRP-02-AC7: the home screen shows who #1 is without waiting for the server', () => {
  // Real timers are restored by the file's afterEach, after the app is unmounted.

  test('GRP-02-AC7: while GET /v1/me has not answered, the home screen shows "Nummer 1: {name}", the number, and the call button "Ring {name}"', async () => {
    await phoneHolding({ firstContact: FIRST });
    const answer = api.held();
    api.reply(ME, answer.reply);

    const screen = await launch();

    await expectShown(screen, FIRST);
    expect(api.to(ME)).toHaveLength(1);
    answer.release(meAnswer());
  });

  test.each(FAILURES)(
    'GRP-02-AC7: once GET /v1/me has failed with %s, the home screen shows #1 and the call button, and "Vi fikk ikke kontakt med serveren. Prøv igjen om litt." and "Prøv igjen" with them',
    async (_what, how) => {
      await phoneHolding({ firstContact: FIRST });

      const screen = await launchWithMeFailing(how);

      expect(screen.getByText(NB.shown(FIRST.name))).toBeTruthy();
      expect(nameOf(callButton(screen))).toMatch(beginning(NB.call(FIRST.name)));
      expect(screen.getByText(NB.unreachable)).toBeTruthy();
      expect(screen.getByRole('button', { name: exactly(NB.retry) })).toBeTruthy();
    },
  );
});

// ---------------------------------------------------------------------------
// AC8: a #1 that cannot be saved or read is said.
// ---------------------------------------------------------------------------

/** Values under #1's key the app cannot read as a #1. */
const UNREADABLE: [string, string][] = [
  ['not JSON', '{"name": "Testkontakt'],
  ['JSON that is not an object', JSON.stringify(MOBILE)],
  ['an empty name', JSON.stringify({ name: '', number: MOBILE })],
  [
    'a name with a bidirectional control',
    JSON.stringify({ name: 'Test\u202ekontakt', number: MOBILE }),
  ],
  ['a number with a letter', JSON.stringify({ name: FIRST_CONTACT_NAME, number: `${MOBILE}A` })],
  [
    'a number of sixteen digits',
    JSON.stringify({ name: FIRST_CONTACT_NAME, number: SIXTEEN_DIGITS }),
  ],
  ['no number at all', JSON.stringify({ name: FIRST_CONTACT_NAME })],
];

describe('GRP-02-AC8: a #1 that cannot be saved or read is said, never hidden', () => {
  test.each<[string, Contact | null]>([
    ['the first #1', null],
    ['a change of #1', FIRST],
  ])(
    'GRP-02-AC8: when secure storage refuses to save %s, the setup screen says "Nummeret ble ikke lagret. Prøv igjen.", and the home screen, once returned to, shows the earlier #1, or none',
    async (_what, earlier) => {
      await phoneHolding(earlier === null ? {} : { firstContact: earlier });
      const key = await firstContactKey();
      mockStore.refuse('set', key, new Error('synthetic: the Keystore refused the write'));
      const screen = await launch();

      if (earlier === null) {
        await chooseThroughTheApp(screen, OTHER);
      } else {
        await expectShown(screen, earlier);
        await pressButton(screen, NB.change);
        await type(screen, NB.nameLabel, OTHER.name);
        await type(screen, NB.numberLabel, OTHER.number);
        await pressButton(screen, NB.save);
      }

      expect(await screen.findByText(NB.notSaved)).toBeTruthy();
      expect(screen.getByText(NB.title)).toBeTruthy();
      await pressButton(screen, NB.cancel);
      if (earlier === null) {
        await findCallButton(screen, NB.none);
        expect(texts(screen).filter((text) => text.startsWith('Nummer 1:'))).toEqual([]);
      } else {
        await expectShown(screen, earlier);
      }
      expect(screen.queryByText(NB.shown(OTHER.name))).toBeNull();
    },
  );

  test('GRP-02-AC8: when secure storage’s read of #1 rejects at start, the call button reads "Velg hvem du vil ringe" with "Vi fikk ikke lest hvem du skal ringe. Trykk for å velge igjen." under it, no "Nummer 1" line shows, and a tap opens the setup and calls neither callNumber nor openDialer', async () => {
    await phoneHolding({ firstContact: FIRST });
    const key = await firstContactKey();
    mockStore.refuse('get', key, new Error('synthetic: the Keystore refused the read'));

    const screen = await launch();

    await findCallButton(screen, NB.none);
    const order = texts(screen);
    expect(order.indexOf(NB.unreadable)).toBeGreaterThan(order.indexOf(NB.none));
    expect(order.indexOf(NB.none)).toBeGreaterThanOrEqual(0);
    expect(order.filter((text) => text.startsWith('Nummer 1:'))).toEqual([]);
    expect(screen.queryByText(NB.noneHint)).toBeNull();
    await press(callButton(screen));
    expect(await screen.findByText(NB.title)).toBeTruthy();
    expect(mockPhone.timesCalled('callNumber')).toBe(0);
    expect(mockPhone.timesCalled('openDialer')).toBe(0);
  });

  test.each(UNREADABLE)(
    'GRP-02-AC8: a stored #1 that is %s reads as unreadable: the call button reads "Velg hvem du vil ringe" with the unreadable line under it, no "Nummer 1" line and no stale name show, and a tap opens the setup and calls neither callNumber nor openDialer',
    async (_what, raw) => {
      await phoneHolding({ firstContact: { raw } });

      const screen = await launch();

      await findCallButton(screen, NB.none);
      const order = texts(screen);
      expect(order.indexOf(NB.unreadable)).toBeGreaterThan(order.indexOf(NB.none));
      expect(order.filter((text) => text.startsWith('Nummer 1:'))).toEqual([]);
      expect(order.filter((text) => text.includes(FIRST_CONTACT_NAME))).toEqual([]);
      await press(callButton(screen));
      expect(await screen.findByText(NB.title)).toBeTruthy();
      expect(mockPhone.timesCalled('callNumber')).toBe(0);
      expect(mockPhone.timesCalled('openDialer')).toBe(0);
    },
  );

  test('GRP-02-AC8: saving on the setup screen, opened from an unreadable #1, replaces the stored value, and the home screen shows the new #1', async () => {
    await phoneHolding({ firstContact: { raw: '{"name": "Testkontakt' } });
    const key = await firstContactKey();
    const screen = await launch();

    await chooseThroughTheApp(screen, OTHER);

    await expectShown(screen, OTHER);
    expect(JSON.parse(mockStore.items.get(key) ?? 'null')).toStrictEqual(OTHER);
  });
});

// ---------------------------------------------------------------------------
// AC9: no number or name in a log, or in an error that escapes.
// ---------------------------------------------------------------------------

describe('GRP-02-AC9: no phone number or name in a log or an escaping error (PRIV-07)', () => {
  /** An error whose message holds #1's name and number, as a failing platform's could. */
  const leaking = (contact: Contact) =>
    new Error(`synthetic: refused ${contact.name} ${contact.number} ${spaced(contact.number)}`);

  /** No console call the app made holds any form of `contacts`. */
  function expectNothingLogged(contacts: Contact[]): void {
    const forms = contacts.flatMap(formsOf);
    const holding = consoleCalls
      .map(({ method, args }) => ({ method, text: args.map(said).join(' ') }))
      .filter(({ text }) => forms.some((form) => text.includes(form)))
      .map(({ method, text }) => `${method}: ${text.slice(0, 200)}`);
    expect(holding).toEqual([]);
  }

  test('GRP-02-AC9: choosing #1, refusing a name and a number, failing to save, and changing #1, with the failures’ errors holding the number and name, puts neither in the console', async () => {
    await phoneHolding();
    const key = await firstContactKey();
    mockPhone.permission = 'notGranted';
    mockPhone.askAnswer = 'denied';
    const screen = await launch();

    await press(await findCallButton(screen, NB.none));
    await type(screen, NB.nameLabel, 'Test\u202ekontakt');
    await type(screen, NB.numberLabel, FIRST.number);
    await pressButton(screen, NB.save);
    await screen.findByText(NB.nameNotUsable);
    await type(screen, NB.nameLabel, FIRST.name);
    await type(screen, NB.numberLabel, `${FIRST.number}A`);
    await pressButton(screen, NB.save);
    await screen.findByText(NB.numberNotUsable);
    mockStore.refuse('set', key, leaking(FIRST));
    await type(screen, NB.numberLabel, spaced(FIRST.number));
    await pressButton(screen, NB.save);
    await screen.findByText(NB.notSaved);
    mockStore.allowAll();
    await pressButton(screen, NB.save);
    await expectShown(screen, FIRST);
    await pressButton(screen, NB.change);
    await type(screen, NB.nameLabel, OTHER.name);
    await type(screen, NB.numberLabel, OTHER.number);
    await pressButton(screen, NB.save);
    await expectShown(screen, OTHER);
    await settle();

    expectNothingLogged([FIRST, OTHER]);
  });

  test('GRP-02-AC9: reading #1 at start, and failing to read it with an error holding the number and name, puts neither in the console', async () => {
    await phoneHolding({ firstContact: FIRST });
    const key = await firstContactKey();
    const screen = await launch();
    await expectShown(screen, FIRST);

    mockStore.refuse('get', key, leaking(FIRST));
    const again = await launch();
    await findCallButton(again, NB.none);
    await again.findByText(NB.unreadable);
    await settle();

    expectNothingLogged([FIRST]);
  });

  test('GRP-02-AC9: calling #1 with the permission refused and both call paths failing, with errors holding the number and name, puts neither in the console, and no error escapes', async () => {
    await phoneHolding({ firstContact: FIRST });
    mockPhone.permission = 'notGranted';
    mockPhone.askAnswer = 'denied';
    mockPhone.fail('callNumber', leaking(FIRST));
    mockPhone.fail('openDialer', leaking(FIRST));
    const screen = await launch();
    await expectShown(screen, FIRST);

    await press(callButton(screen));
    await screen.findByText(NB.callFailed(FIRST.number));
    await press(callButton(screen));
    await settle();

    expect(mockPhone.timesCalled('callNumber') + mockPhone.timesCalled('openDialer')).toBe(2);
    expectNothingLogged([FIRST]);
  });
});

// ---------------------------------------------------------------------------
// AC10: every word translated, every field labelled.
// ---------------------------------------------------------------------------

/** Every leaf of a translation file, as [dotted key, text]. */
function leaves(tree: unknown, prefix = ''): [string, string][] {
  if (typeof tree === 'string') {
    return [[prefix, tree]];
  }
  if (typeof tree !== 'object' || tree === null) {
    return [];
  }
  return Object.entries(tree).flatMap(([key, value]) =>
    leaves(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

/** Whether `text` is a translation's text, its placeholders filled with anything. */
function translated(file: unknown, text: string): boolean {
  return leaves(file).some(([, template]) => {
    const pattern = template
      .split(/\{\{\w+\}\}/)
      .map((part) => part.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'))
      .join('.+');
    return new RegExp(`^${pattern}$`).test(text);
  });
}

describe('GRP-02-AC10: every word is translated, every field labelled', () => {
  test.each<[string, 'nb-NO' | 'en-GB', unknown, string, string]>([
    ['bokmål', 'nb-NO', nb, NB.title, NB.save],
    ['English', 'en-GB', en, EN.title, EN.save],
  ])(
    'GRP-02-AC10: in %s, every text on the setup screen, and the home screen’s #1 lines, is a text of the language’s translation file, and the keys of each are in both files',
    async (_language, language, file, title, save) => {
      await phoneHolding({ firstContact: FIRST });
      const screen = await launch({ language });
      // The whole "#1: {name}" line: /#1/ alone also matched the button to
      // change #1, "Change your #1 contact" in English (GRP-02's texts).
      await screen.findByText(exactly((language === 'nb-NO' ? NB : EN).shown(FIRST.name)));

      const home = texts(screen).filter(
        (text) => text !== '112' && text !== FIRST.number && text.includes(FIRST.name),
      );
      expect(home.length).toBeGreaterThan(0);
      for (const text of home) {
        expect({ text, translated: translated(file, text) }).toEqual({ text, translated: true });
      }

      // The button to change #1, by its own text in the language: the call
      // button and 112's are found by their bokmål names, so in English,
      // leaving them out found no call button at all.
      const words = language === 'nb-NO' ? NB : EN;
      await press(screen.getByRole('button', { name: exactly(words.change) }));
      await screen.findByText(title);
      const setup = texts(screen).filter((text) => text !== '112');
      expect(setup).toContain(title);
      expect(screen.getByRole('button', { name: exactly(save) })).toBeTruthy();
      for (const text of setup) {
        expect({ text, translated: translated(file, text) }).toEqual({ text, translated: true });
      }
      const nbKeys = new Set(leaves(nb).map(([key]) => key));
      const enKeys = new Set(leaves(en).map(([key]) => key));
      const used = leaves(file)
        .filter(([, value]) => setup.includes(value))
        .map(([key]) => key);
      expect(used.length).toBeGreaterThan(0);
      for (const key of used) {
        expect({ key, nb: nbKeys.has(key), en: enKeys.has(key) }).toEqual({
          key,
          nb: true,
          en: true,
        });
      }
    },
  );

  test('GRP-02-AC10: each field has a visible label, shown whether or not the field holds text, never a placeholder alone; the field’s screen-reader label is the same text; the number field opens the phone keypad', async () => {
    await phoneHolding();
    const screen = await launch();
    await press(await findCallButton(screen, NB.none));
    await screen.findByText(NB.title);

    const fields = () => hostNodes(screen).filter((node) => node.type === 'TextInput');
    expect(fields().map((field) => labelOf(field))).toEqual([NB.nameLabel, NB.numberLabel]);
    for (const label of [NB.nameLabel, NB.numberLabel]) {
      expect({ label, shown: texts(screen).includes(label) }).toEqual({ label, shown: true });
    }
    await type(screen, NB.nameLabel, FIRST.name);
    await type(screen, NB.numberLabel, FIRST.number);
    for (const label of [NB.nameLabel, NB.numberLabel]) {
      expect({ label, shownWhileTyped: texts(screen).includes(label) }).toEqual({
        label,
        shownWhileTyped: true,
      });
    }
    const number = fields().find((field) => labelOf(field) === NB.numberLabel);
    expect(number?.props['keyboardType']).toBe('phone-pad');
  });

  test('GRP-02-AC10: the number shown under "Nummer 1" has a screen-reader label of its characters separated by single spaces, so it is read digit by digit', async () => {
    await phoneHolding({ firstContact: { name: FIRST.name, number: FOREIGN_NORMALISED } });
    const screen = await launch();

    await screen.findByText(NB.shown(FIRST.name));
    const shown = shownTexts(hostNodes(screen)).find(({ text }) => text === FOREIGN_NORMALISED);
    if (shown === undefined) {
      throw new Error('the number is not shown');
    }
    const labelled = [shown.node, ...hostNodes(screen).filter((node) => node === shown.node.parent)]
      .map((node) => labelOf(node))
      .filter((label): label is string => label !== null);

    expect(labelled).toContain(spelled(FOREIGN_NORMALISED));
    expect(spelled(FOREIGN_NORMALISED)).toMatch(/^\+ 4 4 7 7 0 0 9 0 0 1 2 3$/);
  });
});
