// CALL-01-AC1 to AC8 (L5): the call button, in the app as a person uses it:
// the largest thing on the home screen, a call to #1 on one tap with the call
// permission, the dialer and a plain line without it, the permission asked
// for once, a failure said with the number, and nothing that says the call
// does more than call.
//
// The whole app is rendered through Expo Router's own testing library from its
// route folder, src/app, as features/grp/grp.test.tsx does. The phone module,
// features/call/phone.ts, is faked with the test kit's recording fakePhone,
// whose answers each test sets (CALL-01's test plan); phone.test.tsx holds
// what phone.ts itself does with a number. The fake is mocked by the module's
// resolved path, `./phone.ts`, and virtual, so this file loads before the
// module exists (the red phase) and the same mock stands in once it does:
// jest keys a mock by the path it resolves to. AppState is driven by the test
// for the foreground check; Android's back too.
//
// Also faked, from the test kit: secure storage (fakeSecureStore), the API
// behind fetch (fakeApi), the phone's language and expo-crypto's random bytes.
// The fakes share one journal, and the fake fetch writes each request into
// it, so a test can say what happened between a tap and the call (AC6).
//
// The app runs as Android (Platform.OS), the one platform it ships on until
// task 12 (D-134): "the call starts on the tap" is Android's (reading 1).
//
// The words are the bokmål of CALL-02.md's translations table, in full; the
// English is read for AC7's word list. #1's key in secure storage is learned
// from the app, the first time #1 is saved through it (see home.test.tsx).
//
// Test data is synthetic (RG-07): every number and name from the test kit's
// fixtures (HK-07).
//
// Review loop 1 (CALL-01.md, "Review loop 1"):
//   - Added: AC4, the call button's hint while CALL_PHONE is not granted is
//     the "permission missing" line (a11y-i18n-reviewer 3), and
//     CallPermissionLine renders nothing when the platform is not Android
//     (code-reviewer 4); AC5, the failed-call message's screen-reader label
//     spells the number (a11y-i18n-reviewer 4).
//   - RG-03, the owner's answer for the 112 button (D-141's fourth
//     amendment): its label is "Ring 1 1 2, nødnummeret", no longer "Ring
//     112, nødnummeret" (NB.emergencyLabel). Two helpers told the 112 button
//     from the call button by that label: callButton, which takes buttons
//     whose names begin "Ring ", and AC7's search for the call button, which
//     left out any name holding "112". The new label begins "Ring " and holds
//     no "112", so each now also leaves out the button whose visible text is
//     "112", the text the owner kept. What each test asserts is unchanged.
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type * as ExpoRouterTesting from 'expo-router/testing-library';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ComponentType } from 'react';

import { fakeApi, parsedOrText } from '../../../../../packages/test-kit/src/fake-api.ts';
import { fakePhone } from '../../../../../packages/test-kit/src/fake-phone.ts';
import { fakeSecureStore } from '../../../../../packages/test-kit/src/fake-secure-store.ts';
import {
  FIRST_CONTACT_NAME,
  FOREIGN_NORMALISED,
  OTHER_FIRST_CONTACT_NAME,
  OTHER_MOBILE,
} from '../../../../../packages/test-kit/src/fixtures/phone-numbers.ts';
import {
  ancestorsOf,
  flattenStyle,
  hintOf,
  holds,
  isPressable,
  labelOf,
  marginOn,
  nameOf,
  paddingOn,
  roleOf,
  shownTexts,
  spelled,
  textOf,
  type HostNode,
} from '../../../../../packages/test-kit/src/rendered-tree.ts';
import en from '../../shared/translations/en.json';
import nb from '../../shared/translations/nb.json';

/** CallPermissionLine's props, as permission.tsx types them: CALL_PHONE as read, the settings-only state, and the ask. */
interface PermissionLineProps {
  permission: {
    permission: 'granted' | 'notGranted' | null;
    settingsOnly: boolean;
    ask: () => Promise<'granted' | 'denied' | 'neverAskAgain'>;
  };
}

/**
 * What features/call/index.ts exports that this file renders on its own:
 * CallPermissionLine (CALL-01, approach 4). Declared here, so the file
 * handles a typed value however the module types it.
 */
interface CallFeatureExports {
  CallPermissionLine: ComponentType<PermissionLineProps>;
}

// ---------------------------------------------------------------------------
// The world outside the app.
// ---------------------------------------------------------------------------

const mockJournal: string[] = [];
const mockStore = fakeSecureStore({ journal: mockJournal });
const mockPhone = fakePhone({ journal: mockJournal });
const api = fakeApi();
let mockLanguage: 'nb-NO' | 'en-GB' = 'nb-NO';

jest.mock('expo-secure-store', () => mockStore.module, { virtual: true });
jest.mock('./phone.ts', () => mockPhone.module, { virtual: true });
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

jest.setTimeout(90_000);

/** Requests the fake API had no answer for: each fails the test it was sent in. */
const unanswered: string[] = [];

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
  mockJournal.push(`api ${read.method} ${read.path}`);
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

Object.defineProperty(globalThis, 'fetch', {
  value: fakeFetch,
  writable: false,
  configurable: false,
  enumerable: true,
});
const EXPO_LEAVES_FETCH = 'Failed to set polyfill. fetch is not configurable.';
const consoleError = console.error.bind(console);
jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (args[0] !== EXPO_LEAVES_FETCH) {
    consoleError(...args);
  }
});

// ---------------------------------------------------------------------------
// The words, as CALL-02.md's translations table writes them (bokmål).
// ---------------------------------------------------------------------------

const NB = {
  // RG-03 (review loop 1; the owner's answer, D-141's fourth amendment): was
  // "Ring 112, nødnummeret".
  emergencyLabel: 'Ring 1 1 2, nødnummeret',
  call: (name: string) => `Ring ${name}`,
  callHint: (number: string) => `Ringer ${spelled(number)}`,
  callFailed: (number: string) => `Telefonen kunne ikke starte samtalen. Ring ${number} selv.`,
  permissionWhy: 'Tillat telefonsamtaler, så ringer knappen med ett trykk.',
  permissionMissing: 'Knappen åpner telefonappen, og du må trykke ring der.',
  permissionAllow: 'Tillat telefonsamtaler',
  permissionSettings: 'Åpne innstillinger',
  none: 'Velg hvem du vil ringe',
  shown: (name: string) => `Nummer 1: ${name}`,
  change: 'Bytt nummer 1-kontakt',
  title: 'Hvem vil du ringe først?',
  nameLabel: 'Navn',
  numberLabel: 'Telefonnummer',
  save: 'Lagre',
  unreachable: 'Vi fikk ikke kontakt med serveren. Prøv igjen om litt.',
} as const;

/**
 * CALL-01-AC7's words: none of them may appear, in any case, in what the home
 * screen or the setup screen shows or says, or in the texts under call. and
 * grp.firstContact.: nothing says the call shares a location, alerts anyone,
 * or has anyone following the walker.
 */
const NOT_SAID = [
  'posisjon',
  'plassering',
  'deler',
  'varsl',
  'følger',
  'sporer',
  'location',
  'share',
  'alert',
  'notif',
  'follow',
  'track',
];

const exactly = (text: string): RegExp =>
  new RegExp(`^${text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}$`);
const beginning = (text: string): RegExp =>
  new RegExp(`^${text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`);

// ---------------------------------------------------------------------------
// The app.
// ---------------------------------------------------------------------------

type ReactNative = typeof import('react-native');
type Screen = typeof ExpoRouterTesting.screen;
type BackListener = Parameters<ReactNative['BackHandler']['addEventListener']>[1];
type AppStateListener = Parameters<ReactNative['AppState']['addEventListener']>[1];
type AppStateStatus = Parameters<AppStateListener>[0];

interface Launched {
  testing: typeof ExpoRouterTesting;
  native: ReactNative;
  back: BackListener[];
  appState: AppStateListener[];
}

let launched: Launched | undefined;

/** Launches the app afresh, on Android, in the phone's language, at "/". The fakes stay as they were. */
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
  const back: BackListener[] = [];
  jest.spyOn(native.BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    back.push(handler);
    return {
      remove: () => {
        back.splice(back.indexOf(handler), 1);
      },
    };
  });
  const appState: AppStateListener[] = [];
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

/** AppState changes to `state`, as Android reports it: every listener hears it. */
async function appStateBecomes(state: AppStateStatus): Promise<void> {
  await app().testing.act(async () => {
    (app().native.AppState as { currentState: string }).currentState = state;
    for (const listener of [...app().appState]) {
      listener(state);
    }
    await Promise.resolve();
  });
  await settle();
}

/** The app goes to the background, as it does behind the call screen or Android's settings, and comes back. */
async function backToTheForeground(): Promise<void> {
  await appStateBecomes('background');
  await appStateBecomes('active');
}

const hostNodes = (screen: Screen): HostNode[] => screen.container.queryAll(() => true);
const texts = (screen: Screen): string[] => shownTexts(hostNodes(screen)).map(({ text }) => text);
const buttons = (screen: Screen): HostNode[] =>
  hostNodes(screen).filter((node) => roleOf(node) === 'button');

/** The 112 button's visible text, which the owner kept when its label changed (D-141's fourth amendment). */
const EMERGENCY_TEXT = '112';

/** Whether a button is the 112 button, by its label or by its visible text, "112". */
const isEmergencyButton = (node: HostNode): boolean =>
  labelOf(node) === NB.emergencyLabel || textOf(node) === EMERGENCY_TEXT;

/**
 * The 112 button: exactly one, or it throws.
 *
 * RG-03 (review loop 1): found by its label or its visible text
 * (isEmergencyButton), no longer by its label alone. This file measures the
 * 112 button's size and place beside the call button (CALL-01-AC1), not its
 * words; those are CALL-02's, asserted in full in emergency.test.tsx on every
 * screen (CALL-02-AC1, AC6), where the owner's new label is held. Still
 * exactly one button, or the test fails.
 */
function emergencyButton(screen: Screen): HostNode {
  const found = buttons(screen).filter(isEmergencyButton);
  const [only] = found;
  if (found.length !== 1 || only === undefined) {
    throw new Error(`expected one 112 button, found ${String(found.length)}`);
  }
  return only;
}

/**
 * The screen-reader labels a message is read by: its own, and those of the
 * elements above it up to the one that announces it (its live region), each
 * once. A label on any of them is what TalkBack reads for the message.
 */
function labelsReadFor(message: HostNode): string[] {
  const chain: HostNode[] = [];
  for (const node of [message, ...ancestorsOf(message)]) {
    chain.push(node);
    if (
      node.props['accessibilityLiveRegion'] === 'assertive' ||
      node.props['aria-live'] === 'assertive'
    ) {
      break;
    }
  }
  return [
    ...new Set(chain.map((node) => labelOf(node)).filter((label) => label !== null)),
  ] as string[];
}

/** The call button, "Ring {name}" with a #1, "Velg hvem du vil ringe" without: exactly one, or it throws. */
function callButton(screen: Screen): HostNode {
  // RG-03 (review loop 1): the 112 button is left out by its visible text as
  // well as by its label (isEmergencyButton); see the file's header.
  const found = buttons(screen).filter(
    (node) =>
      !isEmergencyButton(node) &&
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
const CREDENTIAL_KEY = 'deviceCredential';
const JOIN_KEY = 'joinKey';
const CREDENTIAL = 'C'.repeat(20) + 'd'.repeat(13) + '-_0123456789';
const MEMBER_ID = 'b2b2b2b2-0000-4000-8000-00000000000b';

const meAnswer = (role: 'MEMBER' | 'ADMIN' = 'MEMBER') => ({
  status: 200,
  body: { userId: MEMBER_ID, displayName: 'Testmedlem ØKVAR', role },
});

interface Contact {
  name: string;
  number: string;
}

const FIRST: Contact = { name: FIRST_CONTACT_NAME, number: FOREIGN_NORMALISED };
const OTHER: Contact = { name: OTHER_FIRST_CONTACT_NAME, number: OTHER_MOBILE };

let learnedKey: string | null = null;

const keysWritten = (): string[] => [
  ...new Set(
    mockStore
      .calls()
      .filter(
        (call) =>
          call.op === 'set' && !call.refused && ![CREDENTIAL_KEY, JOIN_KEY].includes(call.key),
      )
      .map((call) => call.key),
  ),
];

function signedIn(role: 'MEMBER' | 'ADMIN' = 'MEMBER'): void {
  mockStore.items.set(CREDENTIAL_KEY, CREDENTIAL);
  api.always(ME, meAnswer(role));
}

/** On the home screen with no #1: the setup opened from the call button, `contact` typed, and saved. */
async function chooseThroughTheApp(screen: Screen, contact: Contact): Promise<void> {
  await press(await findCallButton(screen, NB.none));
  await screen.findByText(NB.title);
  await type(screen, NB.nameLabel, contact.name);
  await type(screen, NB.numberLabel, contact.number);
  await pressButton(screen, NB.save);
}

/** The key #1 is kept under, learned once by choosing a #1 through the app; then everything is forgotten. */
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
  const [key, ...more] = keysWritten();
  if (key === undefined || more.length > 0) {
    throw new Error(`saving #1 wrote ${JSON.stringify(keysWritten())}, not one key of its own`);
  }
  learnedKey = key;
  await app().testing.cleanup();
  launched = undefined;
  mockStore.reset();
  mockPhone.reset();
  api.reset();
  mockJournal.length = 0;
  return key;
}

/** What #1's key holds, in each of AC1's three cases. */
type FirstContactState = 'set' | 'none' | 'unreadable';

/** A signed-in phone, with #1 as `state` says. */
async function phoneWith(
  state: FirstContactState,
  role: 'MEMBER' | 'ADMIN' = 'MEMBER',
): Promise<void> {
  const key = state === 'none' ? null : await firstContactKey();
  signedIn(role);
  if (key !== null) {
    mockStore.items.set(key, state === 'set' ? JSON.stringify(FIRST) : '{"name": "Testkontakt');
  }
}

/** The home screen with #1 shown, its call button reading "Ring {name}". */
async function homeWithFirstContact(): Promise<Screen> {
  await phoneWith('set');
  const screen = await launch();
  await findCallButton(screen, NB.call(FIRST.name));
  return screen;
}

beforeEach(() => {
  mockStore.reset();
  mockPhone.reset();
  mockPhone.permission = 'granted';
  api.reset();
  mockJournal.length = 0;
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
// AC1: the largest element on the home screen.
// ---------------------------------------------------------------------------

/** How GET /v1/me stands when the home screen is measured. */
type Server = 'unanswered' | 'member' | 'admin' | 'unreachable';

/** Every state of AC1: #1 set, not set, unreadable; as a member and the admin; the server unanswered and unreachable. */
const HOME_STATES: [FirstContactState, Server][] = (['set', 'none', 'unreadable'] as const).flatMap(
  (firstContact) =>
    (['unanswered', 'member', 'admin', 'unreachable'] as const).map(
      (server): [FirstContactState, Server] => [firstContact, server],
    ),
);

/** The home screen in one of AC1's states, settled. */
async function homeIn(
  firstContact: FirstContactState,
  server: Server,
  language: 'nb-NO' | 'en-GB' = 'nb-NO',
): Promise<Screen> {
  await phoneWith(firstContact, server === 'admin' ? 'ADMIN' : 'MEMBER');
  if (server === 'unanswered') {
    api.reply(ME, api.held().reply);
  } else if (server === 'unreachable') {
    api.reply(ME, 'network failure');
  }
  const screen = await launch({ language });
  if (language === 'nb-NO') {
    await findCallButton(screen, firstContact === 'set' ? NB.call(FIRST.name) : NB.none);
  }
  if (server === 'admin') {
    await screen.findByRole('button', {
      name: exactly(language === 'nb-NO' ? 'Inviter noen' : 'Invite someone'),
    });
  }
  if (server === 'unreachable' && language === 'nb-NO') {
    await screen.findByText(NB.unreachable);
  }
  await settle();
  return screen;
}

/** A style's minimum height, or 0 when it sets none. */
const minHeightOf = (node: HostNode): number => {
  const value = flattenStyle(node.props['style'])['minHeight'];
  return typeof value === 'number' ? value : 0;
};

describe('CALL-01-AC1: the call button is the largest element on the home screen', () => {
  test.each(HOME_STATES)(
    'CALL-01-AC1: with #1 %s and the server %s: the call button’s minHeight is at least 120 and greater than every other pressable’s, the 112 button’s included, and every other pressable’s is at least 56',
    async (firstContact, server) => {
      const screen = await homeIn(firstContact, server);
      const call = callButton(screen);
      const others = hostNodes(screen).filter((node) => isPressable(node) && node !== call);

      expect(minHeightOf(call)).toBeGreaterThanOrEqual(120);
      expect(others).toContain(emergencyButton(screen));
      for (const other of others) {
        expect({ other: nameOf(other), smaller: minHeightOf(other) < minHeightOf(call) }).toEqual({
          other: nameOf(other),
          smaller: true,
        });
        expect({ other: nameOf(other), atLeast56: minHeightOf(other) >= 56 }).toEqual({
          other: nameOf(other),
          atLeast56: true,
        });
      }
    },
  );

  test.each(HOME_STATES)(
    'CALL-01-AC1: with #1 %s and the server %s: the call button spans the content’s width: it sets no width or maxWidth, its alignSelf is unset or stretch, and no container between it and the scrolling content narrows it',
    async (firstContact, server) => {
      const screen = await homeIn(firstContact, server);
      const call = callButton(screen);
      const style = flattenStyle(call.props['style']);
      const scroll = ancestorsOf(call).find((node) => node.type === 'RCTScrollView');

      expect(style['width']).toBeUndefined();
      expect(style['maxWidth']).toBeUndefined();
      expect([undefined, 'stretch', 'auto']).toContain(style['alignSelf']);
      expect(scroll).toBeDefined();
      for (const container of ancestorsOf(call)) {
        if (container === scroll) {
          break;
        }
        const held = flattenStyle(container.props['style']);
        expect({ alignItems: held['alignItems'] ?? 'unset' }).toEqual({
          alignItems: expect.stringMatching(/^(unset|stretch)$/),
        });
        expect({ width: held['width'], maxWidth: held['maxWidth'] }).toEqual({
          width: undefined,
          maxWidth: undefined,
        });
        if (container.parent !== scroll) {
          expect([undefined, 'stretch', 'auto']).toContain(held['alignSelf']);
        }
      }
    },
  );

  test.each(HOME_STATES)(
    'CALL-01-AC1: with #1 %s and the server %s: between the 112 button’s lower edge and the top of the scrolling area, which no scroll can reduce, there are at least 24 points: the bar’s bottom padding plus any margin and gap between the bar and the scrolling area',
    async (firstContact, server) => {
      const screen = await homeIn(firstContact, server);
      const emergency = emergencyButton(screen);
      const call = callButton(screen);
      const shared = ancestorsOf(emergency).find((node) => holds(node, call));
      if (shared === undefined) {
        throw new Error('the 112 button and the call button share no container');
      }
      const below = (node: HostNode, under: HostNode): HostNode[] => {
        const chain = [node, ...ancestorsOf(node)];
        return chain.slice(0, chain.indexOf(under));
      };
      const bar = below(emergency, shared);
      const scrollSide = below(call, shared);
      const scroll = scrollSide.findIndex((node) => node.type === 'RCTScrollView');
      const aboveScroll = scrollSide.slice(scroll === -1 ? scrollSide.length : scroll).reverse();

      const barBottom = bar.reduce(
        (sum, node, at) =>
          sum +
          marginOn(flattenStyle(node.props['style']), 'Bottom') +
          (at === 0 ? 0 : paddingOn(flattenStyle(node.props['style']), 'Bottom')),
        0,
      );
      const scrollTop = aboveScroll.reduce(
        (sum, node) =>
          sum +
          marginOn(flattenStyle(node.props['style']), 'Top') +
          (node.type === 'RCTScrollView' ? 0 : paddingOn(flattenStyle(node.props['style']), 'Top')),
        0,
      );
      const sharedStyle = flattenStyle(shared.props['style']);
      const gap = sharedStyle['rowGap'] ?? sharedStyle['gap'];

      expect(barBottom + scrollTop + (typeof gap === 'number' ? gap : 0)).toBeGreaterThanOrEqual(
        24,
      );
    },
  );
});

// ---------------------------------------------------------------------------
// AC2: one tap, one call, to #1.
// ---------------------------------------------------------------------------

describe('CALL-01-AC2: with the call permission, the tap starts the call to #1', () => {
  test('CALL-01-AC2: with #1 set and the permission granted, one tap records exactly one callNumber with #1’s normalised number, and no openDialer', async () => {
    const screen = await homeWithFirstContact();

    await press(callButton(screen));
    await settle();

    expect(mockPhone.numbersGivenTo('callNumber')).toEqual([FIRST.number]);
    expect(mockPhone.timesCalled('openDialer')).toBe(0);
    expect(mockPhone.timesCalled('askCallPermission')).toBe(0);
  });

  test('CALL-01-AC2: a second tap before the first call has settled, and before the app has come back to the foreground, places no second call; once the first settles, a tap calls again', async () => {
    const screen = await homeWithFirstContact();
    const hold = mockPhone.holdCalls();

    await press(callButton(screen));
    await settle();
    await press(callButton(screen));
    await settle();
    expect(mockPhone.timesCalled('callNumber')).toBe(1);

    hold.release();
    await settle();
    await press(callButton(screen));
    await settle();

    expect(mockPhone.numbersGivenTo('callNumber')).toEqual([FIRST.number, FIRST.number]);
  });

  test('CALL-01-AC2: a call that never settles does not leave the button dead: once the app comes back to the foreground, a tap calls again', async () => {
    const screen = await homeWithFirstContact();
    mockPhone.holdCalls();

    await press(callButton(screen));
    await settle();
    await press(callButton(screen));
    await settle();
    expect(mockPhone.timesCalled('callNumber')).toBe(1);

    await backToTheForeground();
    await press(callButton(screen));
    await settle();

    expect(mockPhone.numbersGivenTo('callNumber')).toEqual([FIRST.number, FIRST.number]);
  });

  test('CALL-01-AC2: the calling path is features/call/phone.ts, the one module the screens’ fake stands in for', () => {
    // The fake above is mocked at this path. A phone module under another
    // name would leave the screens calling the real one, and these tests
    // would fail on what the fake did not record, not pass on it.
    expect(existsSync(path.join(__dirname, 'phone.ts'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC3: asked for when the first #1 is saved, and only then.
// ---------------------------------------------------------------------------

describe('CALL-01-AC3: the app asks for the call permission when the first #1 is saved, and only then', () => {
  test('CALL-01-AC3: with no #1 and the permission not granted, the setup screen shows "Tillat telefonsamtaler, så ringer knappen med ett trykk."; saving a usable #1 saves it first, then asks once', async () => {
    await phoneWith('none');
    mockPhone.permission = 'notGranted';
    mockPhone.askAnswer = 'granted';
    const screen = await launch();

    await press(await findCallButton(screen, NB.none));
    expect(await screen.findByText(NB.permissionWhy)).toBeTruthy();
    expect(mockPhone.timesCalled('askCallPermission')).toBe(0);
    await type(screen, NB.nameLabel, FIRST.name);
    await type(screen, NB.numberLabel, FIRST.number);
    await pressButton(screen, NB.save);
    await screen.findByText(NB.shown(FIRST.name));
    await settle();

    const key = await firstContactKey();
    const saved = mockJournal.indexOf(`secure-store set ${key}`);
    const asked = mockJournal.indexOf('phone askCallPermission');
    expect(saved).toBeGreaterThanOrEqual(0);
    expect(asked).toBeGreaterThan(saved);
    expect(mockPhone.timesCalled('askCallPermission')).toBe(1);
  });

  test('CALL-01-AC3: the app does not ask at start, with #1 set and the permission not granted', async () => {
    await phoneWith('set');
    mockPhone.permission = 'notGranted';
    const screen = await launch();
    await findCallButton(screen, NB.call(FIRST.name));
    await settle();

    expect(mockPhone.timesCalled('askCallPermission')).toBe(0);
  });

  test('CALL-01-AC3: the app does not ask when #1 is changed, the permission not granted', async () => {
    await phoneWith('set');
    mockPhone.permission = 'notGranted';
    const screen = await launch();

    await pressButton(screen, NB.change);
    await type(screen, NB.nameLabel, OTHER.name);
    await type(screen, NB.numberLabel, OTHER.number);
    await pressButton(screen, NB.save);
    await screen.findByText(NB.shown(OTHER.name));
    await settle();

    expect(mockPhone.timesCalled('askCallPermission')).toBe(0);
  });

  test('CALL-01-AC3: the app does not ask when the first #1 is saved with the permission already granted', async () => {
    await phoneWith('none');
    mockPhone.permission = 'granted';
    const screen = await launch();

    await chooseThroughTheApp(screen, FIRST);
    await screen.findByText(NB.shown(FIRST.name));
    await settle();

    expect(mockPhone.timesCalled('askCallPermission')).toBe(0);
  });

  test('CALL-01-AC3: the app does not ask on a tap of the call button, the permission not granted', async () => {
    await phoneWith('set');
    mockPhone.permission = 'notGranted';
    const screen = await launch();

    await press(await findCallButton(screen, NB.call(FIRST.name)));
    await settle();

    expect(mockPhone.timesCalled('askCallPermission')).toBe(0);
  });

  test('CALL-01-AC3: when the request answers neverAskAgain, the save completes, the app’s settings are not opened, and the home screen shows the line that a second tap is needed', async () => {
    await phoneWith('none');
    mockPhone.permission = 'notGranted';
    mockPhone.askAnswer = 'neverAskAgain';
    const screen = await launch();

    await chooseThroughTheApp(screen, FIRST);
    await screen.findByText(NB.shown(FIRST.name));
    await settle();

    expect(mockPhone.timesCalled('askCallPermission')).toBe(1);
    expect(mockPhone.timesCalled('openAppSettings')).toBe(0);
    expect(await screen.findByText(NB.permissionMissing)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AC4: without the permission, the button still calls, and says so.
// ---------------------------------------------------------------------------

describe('CALL-01-AC4: without the permission, the button still calls, and the home screen says a second tap is needed', () => {
  test('CALL-01-AC4: at start, with #1 set and the permission not granted, the home screen shows "Knappen åpner telefonappen, og du må trykke ring der." and "Tillat telefonsamtaler"', async () => {
    await phoneWith('set');
    mockPhone.permission = 'notGranted';

    const screen = await launch();

    expect(await screen.findByText(NB.permissionMissing)).toBeTruthy();
    expect(await screen.findByRole('button', { name: exactly(NB.permissionAllow) })).toBeTruthy();
  });

  test('CALL-01-AC4: the permission revoked in Android’s settings while the app was in the background: when AppState next becomes active, the line and its button show', async () => {
    const screen = await homeWithFirstContact();
    await settle();
    expect(screen.queryByText(NB.permissionMissing)).toBeNull();

    mockPhone.permission = 'notGranted';
    await backToTheForeground();

    expect(await screen.findByText(NB.permissionMissing)).toBeTruthy();
    expect(screen.getByRole('button', { name: exactly(NB.permissionAllow) })).toBeTruthy();
  });

  test('CALL-01-AC4: a tap of the call button without the permission reaches #1’s number once, through the phone module, and asks for nothing', async () => {
    await phoneWith('set');
    mockPhone.permission = 'notGranted';
    const screen = await launch();

    await press(await findCallButton(screen, NB.call(FIRST.name)));
    await settle();

    expect([
      ...mockPhone.numbersGivenTo('callNumber'),
      ...mockPhone.numbersGivenTo('openDialer'),
    ]).toEqual([FIRST.number]);
    expect(mockPhone.timesCalled('askCallPermission')).toBe(0);
  });

  test('CALL-01-AC4: "Tillat telefonsamtaler" asks for the permission; answered neverAskAgain, the same tap opens the app’s settings, and from then the button reads "Åpne innstillinger" and opens them alone, until the app restarts', async () => {
    await phoneWith('set');
    mockPhone.permission = 'notGranted';
    mockPhone.askAnswer = 'neverAskAgain';
    const screen = await launch();

    await pressButton(screen, NB.permissionAllow);
    await settle();
    expect(mockPhone.timesCalled('askCallPermission')).toBe(1);
    expect(mockPhone.timesCalled('openAppSettings')).toBe(1);
    expect(screen.queryByRole('button', { name: exactly(NB.permissionAllow) })).toBeNull();

    await pressButton(screen, NB.permissionSettings);
    await settle();
    expect(mockPhone.timesCalled('askCallPermission')).toBe(1);
    expect(mockPhone.timesCalled('openAppSettings')).toBe(2);

    const again = await launch();
    expect(await again.findByRole('button', { name: exactly(NB.permissionAllow) })).toBeTruthy();
    expect(again.queryByRole('button', { name: exactly(NB.permissionSettings) })).toBeNull();
  });

  test('CALL-01-AC4: once the dialog grants the permission, the line and its button are gone, and a tap calls as with the permission', async () => {
    await phoneWith('set');
    mockPhone.permission = 'notGranted';
    mockPhone.askAnswer = 'granted';
    const screen = await launch();

    await pressButton(screen, NB.permissionAllow);
    await app().testing.waitFor(() => {
      expect(screen.queryByText(NB.permissionMissing)).toBeNull();
    });
    expect(screen.queryByRole('button', { name: exactly(NB.permissionAllow) })).toBeNull();
    await press(callButton(screen));
    await settle();

    expect(mockPhone.numbersGivenTo('callNumber')).toEqual([FIRST.number]);
    expect(mockPhone.timesCalled('openDialer')).toBe(0);
  });

  test('CALL-01-AC4: once the permission is granted in the settings and AppState becomes active, the line and "Åpne innstillinger" are gone, and a tap calls as with the permission', async () => {
    await phoneWith('set');
    mockPhone.permission = 'notGranted';
    mockPhone.askAnswer = 'neverAskAgain';
    const screen = await launch();
    await pressButton(screen, NB.permissionAllow);
    await screen.findByRole('button', { name: exactly(NB.permissionSettings) });

    mockPhone.permission = 'granted';
    await backToTheForeground();

    await app().testing.waitFor(() => {
      expect(screen.queryByText(NB.permissionMissing)).toBeNull();
    });
    expect(screen.queryByRole('button', { name: exactly(NB.permissionSettings) })).toBeNull();
    await press(callButton(screen));
    await settle();
    expect(mockPhone.numbersGivenTo('callNumber')).toEqual([FIRST.number]);
  });

  test('CALL-01-AC4: with no #1 set, the line does not show, the permission not granted', async () => {
    await phoneWith('none');
    mockPhone.permission = 'notGranted';
    const screen = await launch();

    await findCallButton(screen, NB.none);
    await settle();

    expect(screen.queryByText(NB.permissionMissing)).toBeNull();
    expect(screen.queryByRole('button', { name: exactly(NB.permissionAllow) })).toBeNull();
  });

  // Review loop 1 (a11y-i18n-reviewer 3): without CALL_PHONE a tap opens the
  // dialer and places no call, so the hint must not promise one ("Ringer …").
  test('CALL-01-AC4: while the permission is not granted, the call button’s hint is "Knappen åpner telefonappen, og du må trykke ring der.", not "Ringer …"; once it is granted and AppState becomes active, "Ringer " and the number spelled return', async () => {
    await phoneWith('set');
    mockPhone.permission = 'notGranted';
    const screen = await launch();
    await screen.findByText(NB.permissionMissing);

    expect(hintOf(callButton(screen))).toBe(NB.permissionMissing);

    mockPhone.permission = 'granted';
    await backToTheForeground();
    await app().testing.waitFor(() => {
      expect(screen.queryByText(NB.permissionMissing)).toBeNull();
    });
    expect(hintOf(callButton(screen))).toBe(NB.callHint(FIRST.number));
  });

  test('CALL-01-AC4: the permission revoked while the app was in the background: when AppState next becomes active, the call button’s hint becomes "Knappen åpner telefonappen, og du må trykke ring der."', async () => {
    const screen = await homeWithFirstContact();
    await settle();
    expect(hintOf(callButton(screen))).toBe(NB.callHint(FIRST.number));

    mockPhone.permission = 'notGranted';
    await backToTheForeground();

    await screen.findByText(NB.permissionMissing);
    expect(hintOf(callButton(screen))).toBe(NB.permissionMissing);
  });
});

// Review loop 1 (code-reviewer 4): iOS is task 12's. The line speaks of
// Android's permission and its dialog, so on any other platform it renders
// nothing, whatever it is given.

/** Every permission state the line can be given: CALL_PHONE as read, and the settings-only state. */
const PERMISSION_STATES: [string, PermissionLineProps['permission']][] = [
  [
    'not granted',
    { permission: 'notGranted', settingsOnly: false, ask: () => Promise.resolve('denied') },
  ],
  [
    'not granted, Android asking no more',
    { permission: 'notGranted', settingsOnly: true, ask: () => Promise.resolve('neverAskAgain') },
  ],
  [
    'granted',
    { permission: 'granted', settingsOnly: false, ask: () => Promise.resolve('granted') },
  ],
  ['not read yet', { permission: null, settingsOnly: false, ask: () => Promise.resolve('denied') }],
];

/** CallPermissionLine alone, on `os`, with the app's own translations, in a fresh module registry. */
async function renderPermissionLine(
  os: 'ios' | 'android',
  permission: PermissionLineProps['permission'],
): Promise<Screen> {
  if (launched !== undefined) {
    await launched.testing.cleanup();
    launched = undefined;
  }
  jest.resetModules();
  mockLanguage = 'nb-NO';
  const native: ReactNative = jest.requireActual('react-native');
  (native.Platform as { OS: string }).OS = os;
  const testing: typeof ExpoRouterTesting = jest.requireActual('expo-router/testing-library');
  // React Native Testing Library's own render, from the `pure` entry this file
  // mocks in its place above: the one expo-router/testing-library re-exports,
  // whose types leave `render` out. Its cleanup is the file's afterEach.
  const rntl: typeof import('@testing-library/react-native/pure') = jest.requireActual(
    '@testing-library/react-native/pure',
  );
  const react: typeof import('react') = jest.requireActual('react');
  const { I18nextProvider }: typeof import('react-i18next') = jest.requireActual('react-i18next');
  const i18n: { default: Parameters<typeof I18nextProvider>[0]['i18n'] } = jest.requireActual(
    '../../shared/translations',
  );
  const { CallPermissionLine } = jest.requireActual<CallFeatureExports>('./index');
  launched = { testing, native, back: [], appState: [] };
  await rntl.render(
    react.createElement(
      I18nextProvider,
      { i18n: i18n.default },
      react.createElement(CallPermissionLine, { permission }),
    ),
  );
  return testing.screen;
}

describe('CALL-01-AC4: the line about the call permission is Android’s alone', () => {
  test.each(PERMISSION_STATES)(
    'CALL-01-AC4: with the platform faked as iOS, CallPermissionLine renders nothing, given the permission %s',
    async (_what, permission) => {
      const screen = await renderPermissionLine('ios', permission);

      expect(screen.toJSON()).toBeNull();
      expect(texts(screen)).toEqual([]);
      expect(buttons(screen)).toEqual([]);
    },
  );

  test('CALL-01-AC4: the control: on Android, given the permission not granted, it renders the line and "Tillat telefonsamtaler"', async () => {
    const [, notGranted] = PERMISSION_STATES[0] ?? [];
    if (notGranted === undefined) {
      throw new Error('no permission state to render');
    }
    const screen = await renderPermissionLine('android', notGranted);

    expect(screen.getByText(NB.permissionMissing)).toBeTruthy();
    expect(screen.getByRole('button', { name: exactly(NB.permissionAllow) })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AC5: a call the phone cannot start is said, with the number.
// ---------------------------------------------------------------------------

describe('CALL-01-AC5: a call the phone cannot start is said, with the number', () => {
  test.each([
    ['with the permission', 'granted'],
    ['without it', 'notGranted'],
  ] as ['with the permission' | 'without it', 'granted' | 'notGranted'][])(
    'CALL-01-AC5: %s, when callNumber rejects, "Telefonen kunne ikke starte samtalen. Ring {number} selv." shows with #1’s normalised number, in an element read out at once, assertive; the call button stays, and a later tap calls again',
    async (_what, permission) => {
      await phoneWith('set');
      mockPhone.permission = permission;
      mockPhone.fail('callNumber', new Error('synthetic: neither path started the call'));
      mockPhone.fail('openDialer', new Error('synthetic: no dialer'));
      const screen = await launch();

      await press(await findCallButton(screen, NB.call(FIRST.name)));
      const message = await screen.findByText(NB.callFailed(FIRST.number));

      const live: HostNode[] = [message, ...ancestorsOf(message)];
      expect(
        live.some(
          (node) =>
            node.props['accessibilityLiveRegion'] === 'assertive' ||
            node.props['aria-live'] === 'assertive',
        ),
      ).toBe(true);
      const before = mockPhone.timesCalled('callNumber') + mockPhone.timesCalled('openDialer');
      expect(before).toBe(1);
      mockPhone.recover('callNumber');
      mockPhone.recover('openDialer');
      await press(await findCallButton(screen, NB.call(FIRST.name)));
      await settle();
      expect(mockPhone.timesCalled('callNumber') + mockPhone.timesCalled('openDialer')).toBe(2);
    },
  );

  // Review loop 1 (a11y-i18n-reviewer 4): read as written, the number is a
  // figure ("forty-four million …"); spelled, it can be dialled by ear, as
  // #1's number is read (GRP-02-AC10).
  test.each([
    ['with the permission', 'granted'],
    ['without it', 'notGranted'],
  ] as ['with the permission' | 'without it', 'granted' | 'notGranted'][])(
    'CALL-01-AC5: %s, the message’s screen-reader label is the same sentence with the number’s characters separated by single spaces, "Telefonen kunne ikke starte samtalen. Ring + d d … selv.", and its visible text is unchanged',
    async (_what, permission) => {
      await phoneWith('set');
      mockPhone.permission = permission;
      mockPhone.fail('callNumber', new Error('synthetic: neither path started the call'));
      mockPhone.fail('openDialer', new Error('synthetic: no dialer'));
      const screen = await launch();

      await press(await findCallButton(screen, NB.call(FIRST.name)));
      const message = await screen.findByText(NB.callFailed(FIRST.number));

      expect(textOf(message)).toBe(NB.callFailed(FIRST.number));
      expect(labelsReadFor(message)).toEqual([NB.callFailed(spelled(FIRST.number))]);
      expect(spelled(FIRST.number)).toBe(Array.from(FIRST.number).join(' '));
    },
  );
});

// ---------------------------------------------------------------------------
// AC6: no server, no journey.
// ---------------------------------------------------------------------------

/** GET /v1/me as AC6 lists it. Kept out of test.each, as HK-05's counter asks. */
const SERVER_DOWN: [string, string][] = [
  ['unanswered', 'held'],
  ['failed with a network error', 'network failure'],
  ['answered with a 5xx', '502'],
];

describe('CALL-01-AC6: calling needs no server and no journey', () => {
  // Real timers are restored by the file's afterEach, after the app is unmounted.

  test.each(SERVER_DOWN)(
    'CALL-01-AC6: with GET /v1/me %s, a tap starts the call to #1, and no request is made between the tap and the call',
    async (_what, how) => {
      await phoneWith('set');
      api.reset();
      if (how === 'held') {
        api.reply(ME, api.held().reply);
      } else if (how === 'network failure') {
        api.always(ME, 'network failure');
      } else {
        api.always(ME, { status: Number(how) });
      }
      const screen = await launch();
      await findCallButton(screen, NB.call(FIRST.name));
      await settle();
      const tapped = mockJournal.length;

      await press(callButton(screen));
      await settle();

      const after = mockJournal.slice(tapped);
      const called = after.indexOf('phone callNumber');
      expect(called).toBeGreaterThanOrEqual(0);
      expect(after.slice(0, called).filter((entry) => entry.startsWith('api '))).toEqual([]);
      expect(mockPhone.numbersGivenTo('callNumber')).toEqual([FIRST.number]);
    },
  );

  test('CALL-01-AC6: with GET /v1/me given no answer within 20 s, a tap after the app has given up starts the call to #1, and no request is made between the tap and the call', async () => {
    await phoneWith('set');
    api.reset();
    api.reply(ME, 'no answer');
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    const screen = await launch();
    for (let step = 0; step < 1_000 && api.to(ME).length === 0; step += 1) {
      await app().testing.act(async () => {
        jest.advanceTimersByTime(10);
        await Promise.resolve();
      });
    }
    await app().testing.act(async () => {
      jest.advanceTimersByTime(20_000);
      await Promise.resolve();
    });
    await settle();
    expect(screen.getByText(NB.unreachable)).toBeTruthy();
    const tapped = mockJournal.length;

    await press(callButton(screen));
    await settle();

    const after = mockJournal.slice(tapped);
    const called = after.indexOf('phone callNumber');
    expect(called).toBeGreaterThanOrEqual(0);
    expect(after.slice(0, called).filter((entry) => entry.startsWith('api '))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AC7: nothing says the call does more than call.
// ---------------------------------------------------------------------------

/** Every text a screen shows or says: its text, its labels and its hints. */
const everythingSaid = (screen: Screen): string[] => [
  ...texts(screen),
  ...hostNodes(screen).flatMap((node) => [labelOf(node) ?? '', hintOf(node) ?? '']),
];

/** The words of NOT_SAID that `text` holds. */
const forbiddenIn = (text: string): string[] =>
  NOT_SAID.filter((word) => text.toLowerCase().includes(word));

/** Every text under `prefix` in a translation file. */
function textsUnder(file: unknown, prefix: string): string[] {
  const node = prefix
    .split('.')
    .reduce<unknown>(
      (at, part) =>
        typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[part] : undefined,
      file,
    );
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      out.push(value);
    } else if (typeof value === 'object' && value !== null) {
      Object.values(value).forEach(walk);
    }
  };
  walk(node);
  return out;
}

describe('CALL-01-AC7: nothing says the call does more than call', () => {
  test.each(
    HOME_STATES.flatMap(([firstContact, server]) =>
      (['nb-NO', 'en-GB'] as const).map(
        (language): [FirstContactState, Server, 'nb-NO' | 'en-GB'] => [
          firstContact,
          server,
          language,
        ],
      ),
    ),
  )(
    'CALL-01-AC7: with #1 %s and the server %s, in %s, nothing the home screen or the setup screen shows or says holds a word that suggests sharing, alerting, following or tracking',
    async (firstContact, server, language) => {
      const screen = await homeIn(firstContact, server, language);
      await app().testing.waitFor(() => {
        expect(buttons(screen).length).toBeGreaterThanOrEqual(2);
      });
      const home = everythingSaid(screen);
      // RG-03 (review loop 1): the 112 button is also left out by its visible
      // text, "112" (isEmergencyButton): its new label, "Ring 1 1 2, …", holds
      // no "112", and without this the search would press it first, and the
      // setup screen's texts would go unread. See the file's header.
      const call = buttons(screen).find(
        (node) =>
          !isEmergencyButton(node) &&
          !nameOf(node).includes('112') &&
          !/^(Inviter|Se |Invite|See )/.test(nameOf(node)),
      );
      if (call === undefined) {
        throw new Error('the home screen has no call button');
      }
      await press(call);
      await settle();
      const setup = everythingSaid(screen);

      expect(home.length).toBeGreaterThan(0);
      expect(
        [...home, ...setup].flatMap((text) =>
          forbiddenIn(text).map((word) => `${word} in ${JSON.stringify(text)}`),
        ),
      ).toEqual([]);
    },
  );

  test.each([
    ['nb.json', nb],
    ['en.json', en],
  ] as [string, unknown][])(
    'CALL-01-AC7: no text under call. or grp.firstContact. in %s holds one of those words, and there are texts under each to read',
    (_file, file) => {
      const call = textsUnder(file, 'call');
      const firstContact = textsUnder(file, 'grp.firstContact');

      expect(call.length).toBeGreaterThan(0);
      expect(firstContact.length).toBeGreaterThan(0);
      expect(
        [...call, ...firstContact].flatMap((text) =>
          forbiddenIn(text).map((word) => `${word} in ${JSON.stringify(text)}`),
        ),
      ).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// AC8: found and read as what it is, at any text size.
// ---------------------------------------------------------------------------

describe('CALL-01-AC8: the button is found and read as what it is, at any text size', () => {
  test('CALL-01-AC8: it has the role "button", the label "Ring {name}" and the hint "Ringer " followed by #1’s number, its characters separated by single spaces', async () => {
    const screen = await homeWithFirstContact();
    const call = callButton(screen);

    expect(roleOf(call)).toBe('button');
    expect(labelOf(call)).toBe(NB.call(FIRST.name));
    expect(hintOf(call)).toBe(NB.callHint(FIRST.number));
    expect(NB.callHint(FIRST.number)).toBe(`Ringer ${Array.from(FIRST.number).join(' ')}`);
    expect(texts(screen)).toContain(NB.call(FIRST.name));
  });

  test.each([
    ['with #1', 'set'],
    ['without', 'none'],
  ] as [string, FirstContactState][])(
    'CALL-01-AC8: %s, the call button’s text sets no numberOfLines and no allowFontScaling={false}, so it grows with the phone’s font size and wraps',
    async (_what, state) => {
      await phoneWith(state);
      const screen = await launch();
      const call = await findCallButton(screen, state === 'set' ? NB.call(FIRST.name) : NB.none);
      const inside = hostNodes(screen).filter((node) => node.type === 'Text' && holds(call, node));

      expect(inside.length).toBeGreaterThan(0);
      for (const text of inside) {
        expect({ text: nameOf(text), numberOfLines: text.props['numberOfLines'] }).toEqual({
          text: nameOf(text),
          numberOfLines: undefined,
        });
        expect({ text: nameOf(text), scales: text.props['allowFontScaling'] !== false }).toEqual({
          text: nameOf(text),
          scales: true,
        });
      }
    },
  );
});
