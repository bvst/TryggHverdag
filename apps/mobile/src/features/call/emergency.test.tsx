// CALL-02-AC1 to AC6, AC8 and AC9 (L5), and AC2's typed half (L1): 112 is
// always one tap away. A 112 button on every screen and in every state the app
// has, the join screen and the brief start included (Q4, D-141), never inside
// anything that scrolls, hides or covers it; opening the phone's own dialer
// with 112 in it and placing no call; needing nothing else; saying so when the
// dialer cannot open; saying what it is, in full, in bokmål and English; and a
// home screen that shows 112 and the call button at once, without waiting for
// the server.
//
// These assertions sit in an owned, safety-reviewed folder (CALL-01-AC9), so
// nb.json and en.json, which are not, cannot change what the 112 button says
// without failing here (CALL-02-AC6).
//
// The whole app is rendered through Expo Router's own testing library from its
// route folder, src/app, with the test kit's fakes for secure storage, the
// phone module (features/call/phone.ts, mocked by its resolved path and
// virtual, so this file loads before the module exists), the API behind fetch
// and the phone's language; as Android (Platform.OS), with AppState and
// Android's back driven by the test. See call.test.tsx for the harness's
// reasons; it is the same here.
//
// No test dials 112: the phone module is a fake, and phone.test.tsx holds what
// the real one does with it (SPIKE-01-AC10's rule). Test data is synthetic
// (RG-07): every number and name from the test kit's fixtures (HK-07).
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type * as ExpoRouterTesting from 'expo-router/testing-library';

import { fakeApi, parsedOrText } from '../../../../../packages/test-kit/src/fake-api.ts';
import { fakePhone } from '../../../../../packages/test-kit/src/fake-phone.ts';
import { fakeSecureStore } from '../../../../../packages/test-kit/src/fake-secure-store.ts';
import {
  FIRST_CONTACT_NAME,
  MOBILE,
  OTHER_FIRST_CONTACT_NAME,
} from '../../../../../packages/test-kit/src/fixtures/phone-numbers.ts';
import {
  ancestorsOf,
  flattenStyle,
  hintOf,
  holds,
  labelOf,
  nameOf,
  roleOf,
  shownTexts,
  textOf,
  type HostNode,
} from '../../../../../packages/test-kit/src/rendered-tree.ts';
import en from '../../shared/translations/en.json';
import nb from '../../shared/translations/nb.json';
import type { ComponentType } from 'react';
import type * as CallFeature from './index';

/**
 * What features/call/index.ts must export, as this file handles it at run
 * time: the component `EmergencyBar` (CALL-02, approach 1). Declared here
 * rather than read from the module, so every value the file handles has a type
 * before the module exists, and the file stays red only on the missing module.
 * Its props are still checked against the module's own type (CallFeature),
 * below.
 */
interface CallFeatureExports {
  EmergencyBar: ComponentType;
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
// The words, in full: CALL-02.md's translations table.
// ---------------------------------------------------------------------------

/** The 112 button's words, in both languages. */
const EMERGENCY = {
  text: '112',
  nb: {
    label: 'Ring 112, nødnummeret',
    hint: 'Åpner telefonappen med 112. Trykk ring der.',
    failed: 'Telefonen kunne ikke åpne 112. Ring 112 selv.',
  },
  en: {
    label: 'Call 112, the emergency number',
    hint: 'Opens your phone app with 112. Tap call there.',
    failed: 'Your phone could not open 112. Dial 112 yourself.',
  },
} as const;

const NB = {
  call: (name: string) => `Ring ${name}`,
  none: 'Velg hvem du vil ringe',
  shown: (name: string) => `Nummer 1: ${name}`,
  change: 'Bytt nummer 1-kontakt',
  title: 'Hvem vil du ringe først?',
  nameLabel: 'Navn',
  numberLabel: 'Telefonnummer',
  unreachable: 'Vi fikk ikke kontakt med serveren. Prøv igjen om litt.',
  retry: 'Prøv igjen',
  memberTitle: 'Du er med i gruppen',
  memberStatus: 'Denne telefonen er logget inn i gruppen.',
  invite: 'Inviter noen',
  members: 'Se medlemmene',
  joinTitle: 'Bli med i gruppen',
  signedOut: 'Denne telefonen er ikke lenger logget inn i gruppen.',
  createInvitation: 'Lag en invitasjon',
  share: 'Del koden',
  membersTitle: 'Medlemmer',
  remove: (name: string) => `Fjern ${name}`,
  confirm: (name: string) => `Ja, fjern ${name}`,
} as const;

/** Every row of CALL-02.md's translations table that is a key: its bokmål and its English, in full. */
const TABLE: [string, string, string][] = [
  ['call.emergency.label', EMERGENCY.nb.label, EMERGENCY.en.label],
  ['call.emergency.hint', EMERGENCY.nb.hint, EMERGENCY.en.hint],
  ['call.emergency.failed', EMERGENCY.nb.failed, EMERGENCY.en.failed],
  ['call.button.call', 'Ring {{name}}', 'Call {{name}}'],
  ['call.button.hint', 'Ringer {{number}}', 'Calls {{number}}'],
  [
    'call.button.failed',
    'Telefonen kunne ikke starte samtalen. Ring {{number}} selv.',
    'Your phone could not start the call. Dial {{number}} yourself.',
  ],
  [
    'call.permission.why',
    'Tillat telefonsamtaler, så ringer knappen med ett trykk.',
    'Allow phone calls, so the button calls with one tap.',
  ],
  [
    'call.permission.missing',
    'Knappen åpner telefonappen, og du må trykke ring der.',
    'The button opens your phone app, where you tap call.',
  ],
  ['call.permission.allow', 'Tillat telefonsamtaler', 'Allow phone calls'],
  ['call.permission.settings', 'Åpne innstillinger', 'Open settings'],
  ['grp.firstContact.none', 'Velg hvem du vil ringe', 'Choose who to call'],
  [
    'grp.firstContact.noneHint',
    'Du har ikke valgt en nummer 1-kontakt. Trykk for å velge.',
    'You have not chosen a #1 contact. Tap to choose.',
  ],
  [
    'grp.firstContact.unreadable',
    'Vi fikk ikke lest hvem du skal ringe. Trykk for å velge igjen.',
    'We could not read who to call. Tap to choose again.',
  ],
  ['grp.firstContact.shown', 'Nummer 1: {{name}}', '#1: {{name}}'],
  ['grp.firstContact.change', 'Bytt nummer 1-kontakt', 'Change your #1 contact'],
  ['grp.firstContact.title', 'Hvem vil du ringe først?', 'Who do you call first?'],
  [
    'grp.firstContact.intro',
    'Den store knappen ringer denne personen. Det kan være hvem som helst du stoler på.',
    'The big button calls this person. It can be anyone you trust.',
  ],
  ['grp.firstContact.nameLabel', 'Navn', 'Name'],
  ['grp.firstContact.numberLabel', 'Telefonnummer', 'Phone number'],
  ['grp.firstContact.save', 'Lagre', 'Save'],
  ['grp.firstContact.cancel', 'Avbryt', 'Cancel'],
  [
    'grp.firstContact.numberNotUsable',
    'Nummeret ser ikke riktig ut. Bruk bare sifre, gjerne med + og landskode først.',
    "That number doesn't look right. Use digits only, with + and the country code first if needed.",
  ],
  [
    'grp.firstContact.nameNotUsable',
    'Navnet kan ikke brukes. Det må ha minst ett synlig tegn, og ingen skjulte tegn.',
    "That name can't be used. It needs at least one visible character, and no hidden ones.",
  ],
  [
    'grp.firstContact.notSaved',
    'Nummeret ble ikke lagret. Prøv igjen.',
    'The number was not saved. Try again.',
  ],
  [
    'grp.member.unreachable',
    'Vi fikk ikke kontakt med serveren. Prøv igjen om litt.',
    'The server could not be reached. Try again in a moment.',
  ],
  ['app.error.screen', 'Noe gikk galt på denne skjermen.', 'Something went wrong on this screen.'],
];

/** CALL-01-AC7's words, which none of the 112 button's texts may hold (CALL-02-AC6). */
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

interface Launched {
  testing: typeof ExpoRouterTesting;
  native: ReactNative;
  back: BackListener[];
  appState: AppStateListener[];
}

let launched: Launched | undefined;

/**
 * Launches the app afresh, on Android, in the phone's language, at "/". The
 * fakes stay as they were. `waitForFirstFrame: false` returns as soon as the
 * route folder is rendered, for the brief start while storage is read.
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

const hostNodes = (screen: Screen): HostNode[] => screen.container.queryAll(() => true);
const texts = (screen: Screen): string[] => shownTexts(hostNodes(screen)).map(({ text }) => text);
const buttons = (screen: Screen): HostNode[] =>
  hostNodes(screen).filter((node) => roleOf(node) === 'button');

/** Every element on screen with the 112 button's label and the role "button". */
const emergencyButtons = (screen: Screen, label: string = EMERGENCY.nb.label): HostNode[] =>
  hostNodes(screen).filter((node) => labelOf(node) === label && roleOf(node) === 'button');

/** The one 112 button, waited for. */
async function findEmergencyButton(
  screen: Screen,
  label: string = EMERGENCY.nb.label,
): Promise<HostNode> {
  await app().testing.waitFor(() => {
    expect(emergencyButtons(screen, label)).toHaveLength(1);
  });
  const [only] = emergencyButtons(screen, label);
  if (only === undefined) {
    throw new Error('no 112 button');
  }
  return only;
}

function callButton(screen: Screen): HostNode {
  const found = buttons(screen).filter(
    (node) =>
      labelOf(node) !== EMERGENCY.nb.label &&
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
const INVITE = 'POST /v1/group/invitations';
const LIST = 'GET /v1/group/members';
const CREDENTIAL_KEY = 'deviceCredential';
const JOIN_KEY = 'joinKey';
const CREDENTIAL = 'C'.repeat(20) + 'd'.repeat(13) + '-_0123456789';
const ADMIN_ID = 'a1a1a1a1-0000-4000-8000-00000000000a';
const MEMBER_ID = 'b2b2b2b2-0000-4000-8000-00000000000b';
const ADMIN_NAME = 'Testmedlem ØKVAR';
const OTHER_MEMBER = {
  userId: 'c3c3c3c3-0000-4000-8000-00000000000c',
  displayName: 'Testmedlem ÅPENT',
  role: 'MEMBER',
};

const meAnswer = (role: 'MEMBER' | 'ADMIN' = 'MEMBER') => ({
  status: 200,
  body: { userId: role === 'ADMIN' ? ADMIN_ID : MEMBER_ID, displayName: ADMIN_NAME, role },
});

/** A synthetic invitation code, made at run time (gitleaks reads every committed line). */
const CODE = Array.from({ length: 4 }, () =>
  Array.from({ length: 5 }, () =>
    '0123456789ABCDEFGHJKMNPQRSTVWXYZ'.charAt(Math.floor(Math.random() * 32)),
  ).join(''),
).join('-');

interface Contact {
  name: string;
  number: string;
}

const FIRST: Contact = { name: FIRST_CONTACT_NAME, number: MOBILE };

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

async function chooseThroughTheApp(screen: Screen, contact: Contact): Promise<void> {
  await press(await findCallButton(screen, NB.none));
  await screen.findByText(NB.title);
  await type(screen, NB.nameLabel, contact.name);
  await type(screen, NB.numberLabel, contact.number);
  await pressButton(screen, 'Lagre');
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

/** #1 as stored: set, none, or a value the app cannot read. */
type FirstContactState = 'set' | 'none' | 'unreadable';

async function withFirstContact(state: FirstContactState): Promise<void> {
  if (state === 'none') {
    return;
  }
  const key = await firstContactKey();
  mockStore.items.set(key, state === 'set' ? JSON.stringify(FIRST) : '{"name": "Testkontakt');
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
// Every screen and state the app shows (AC1, AC2).
// ---------------------------------------------------------------------------

/**
 * Each screen and state of CALL-02-AC1, and how to reach it. Each returns the
 * screen once the state shows, and a function that lets go of whatever the
 * state holds (a read or an answer), for after the checks.
 */
const STATES: Record<string, () => Promise<{ screen: Screen; release: () => void }>> = {
  'the brief start, while secure storage is read': async () => {
    signedIn();
    const release = mockStore.holdReads();
    const screen = await launch();
    return { screen, release };
  },
  'the join screen, fresh': async () => {
    const screen = await launch();
    await screen.findByText(NB.joinTitle);
    return { screen, release: () => undefined };
  },
  'the join screen, after a sign-out': async () => {
    mockStore.items.set(CREDENTIAL_KEY, CREDENTIAL);
    api.always(ME, { status: 401, body: { code: 'UNAUTHORIZED', status: 401 } });
    const screen = await launch();
    await screen.findByText(NB.signedOut);
    return { screen, release: () => undefined };
  },
  'the home screen, waiting for GET /v1/me': async () => {
    signedIn();
    const answer = api.held();
    api.reply(ME, answer.reply);
    const screen = await launch();
    await findCallButton(screen, NB.none);
    return {
      screen,
      release: () => {
        answer.release(meAnswer());
      },
    };
  },
  'the home screen, after a member’s answer': async () => {
    signedIn('MEMBER');
    const screen = await launch();
    await screen.findByText(NB.memberTitle);
    return { screen, release: () => undefined };
  },
  'the home screen, after an admin’s answer': async () => {
    signedIn('ADMIN');
    const screen = await launch();
    await screen.findByRole('button', { name: exactly(NB.invite) });
    return { screen, release: () => undefined };
  },
  'the home screen, with the server unreachable': async () => {
    signedIn();
    api.reply(ME, 'network failure');
    const screen = await launch();
    await screen.findByText(NB.unreachable);
    return { screen, release: () => undefined };
  },
  'the home screen, with #1': async () => {
    await withFirstContact('set');
    signedIn();
    const screen = await launch();
    await findCallButton(screen, NB.call(FIRST.name));
    return { screen, release: () => undefined };
  },
  'the home screen, without #1': async () => {
    signedIn();
    const screen = await launch();
    await findCallButton(screen, NB.none);
    return { screen, release: () => undefined };
  },
  'the home screen, with #1 unreadable': async () => {
    await withFirstContact('unreadable');
    signedIn();
    const screen = await launch();
    await findCallButton(screen, NB.none);
    return { screen, release: () => undefined };
  },
  '#1’s setup screen, choosing': async () => {
    signedIn();
    const screen = await launch();
    await press(await findCallButton(screen, NB.none));
    await screen.findByText(NB.title);
    return { screen, release: () => undefined };
  },
  '#1’s setup screen, changing': async () => {
    await withFirstContact('set');
    signedIn();
    const screen = await launch();
    await findCallButton(screen, NB.call(FIRST.name));
    await pressButton(screen, NB.change);
    await screen.findByText(NB.title);
    await type(screen, NB.nameLabel, OTHER_FIRST_CONTACT_NAME);
    return { screen, release: () => undefined };
  },
  'the admin’s invite screen, before a code is made': async () => {
    signedIn('ADMIN');
    const screen = await launch();
    await pressButton(screen, NB.invite);
    await screen.findByRole('button', { name: exactly(NB.createInvitation) });
    return { screen, release: () => undefined };
  },
  'the admin’s invite screen, after a code is made': async () => {
    signedIn('ADMIN');
    api.reply(INVITE, {
      status: 201,
      body: { invitationCode: CODE, expiresAt: '2026-10-27T12:00:00.000Z' },
    });
    const screen = await launch();
    await pressButton(screen, NB.invite);
    await pressButton(screen, NB.createInvitation);
    await screen.findByRole('button', { name: exactly(NB.share) });
    return { screen, release: () => undefined };
  },
  'the members screen, with the removal’s confirmation open': async () => {
    signedIn('ADMIN');
    api.always(LIST, {
      status: 200,
      body: {
        members: [{ userId: ADMIN_ID, displayName: ADMIN_NAME, role: 'ADMIN' }, OTHER_MEMBER],
      },
    });
    const screen = await launch();
    await pressButton(screen, NB.members);
    await pressButton(screen, NB.remove(OTHER_MEMBER.displayName));
    await screen.findByRole('button', { name: exactly(NB.confirm(OTHER_MEMBER.displayName)) });
    return { screen, release: () => undefined };
  },
};

/** The states, as test.each takes them. */
const STATE_NAMES: string[] = Object.keys(STATES);

/** Reaches a state by its name. */
async function reach(name: string): Promise<{ screen: Screen; release: () => void }> {
  const go = STATES[name];
  if (go === undefined) {
    throw new Error(`no state named ${name}`);
  }
  return go();
}

/** Why each element, from the 112 button up, would hide or cover it: none, or what. */
function hiding(node: HostNode): string[] {
  const style = flattenStyle(node.props['style']);
  const reasons: string[] = [];
  if (node.type.includes('ScrollView')) reasons.push(`a ${node.type}`);
  if (node.type.includes('Modal')) reasons.push(`a ${node.type}`);
  if (style['display'] === 'none') reasons.push('display: none');
  if (style['opacity'] === 0) reasons.push('opacity: 0');
  if (style['height'] === 0) reasons.push('height: 0');
  if (style['maxHeight'] === 0) reasons.push('maxHeight: 0');
  if (node.props['accessibilityElementsHidden'] === true)
    reasons.push('accessibilityElementsHidden');
  if (node.props['aria-hidden'] === true) reasons.push('aria-hidden');
  if (node.props['importantForAccessibility'] === 'no-hide-descendants') {
    reasons.push('importantForAccessibility="no-hide-descendants"');
  }
  return reasons;
}

describe('CALL-02-AC1: the 112 button is on every screen the app shows', () => {
  test.each(STATE_NAMES)(
    'CALL-02-AC1: %s shows exactly one element with the label "Ring 112, nødnummeret" and the role "button"',
    async (name) => {
      const { screen, release } = await reach(name);

      expect(emergencyButtons(screen)).toHaveLength(1);
      release();
    },
  );
});

describe('CALL-02-AC2: the 112 button is never hidden', () => {
  test.each(STATE_NAMES)(
    'CALL-02-AC2: on %s, neither the 112 button nor any element above it is a ScrollView or a Modal, or has display: none, opacity: 0, a height or maxHeight of 0, accessibilityElementsHidden or importantForAccessibility="no-hide-descendants"',
    async (name) => {
      const { screen, release } = await reach(name);
      const [button] = emergencyButtons(screen);
      if (button === undefined) {
        throw new Error(`${name} shows no 112 button`);
      }

      const hidden = [button, ...ancestorsOf(button)]
        .map((node) => ({ node: node.type, why: hiding(node) }))
        .filter(({ why }) => why.length > 0);

      expect(hidden).toEqual([]);
      release();
    },
  );

  test.each(STATE_NAMES)(
    'CALL-02-AC2: on %s, the 112 button’s text is "112" and sets no numberOfLines and no allowFontScaling={false}, so it grows with the phone’s font size',
    async (name) => {
      const { screen, release } = await reach(name);
      const [button] = emergencyButtons(screen);
      if (button === undefined) {
        throw new Error(`${name} shows no 112 button`);
      }
      const inside = hostNodes(screen).filter(
        (node) => node.type === 'Text' && holds(button, node),
      );

      expect(inside.map(textOf)).toContain(EMERGENCY.text);
      for (const text of inside) {
        expect({
          text: textOf(text),
          numberOfLines: text.props['numberOfLines'],
          scales: text.props['allowFontScaling'] !== false,
        }).toEqual({ text: textOf(text), numberOfLines: undefined, scales: true });
      }
      release();
    },
  );

  test('CALL-02-AC2: EmergencyBar accepts no props: one passed to it is a type error (L1, checked by tsc)', () => {
    const { EmergencyBar } = jest.requireActual<CallFeatureExports>('./index');
    /**
     * The element `<EmergencyBar hidden />`, with the component typed as the
     * module itself types it: tsc reads `Bar`'s props from
     * features/call/index.ts, not from CallFeatureExports, which declares none.
     */
    const withAProp = (Bar: typeof CallFeature.EmergencyBar) => (
      // @ts-expect-error -- EmergencyBar takes no props, so nothing can turn 112 off (CALL-02, reading 5). If it ever accepts one, this line stops being an error and tsc fails here.
      <Bar hidden />
    );
    const element = withAProp(EmergencyBar);

    expect(element.type).toBe(EmergencyBar);
  });
});

// ---------------------------------------------------------------------------
// AC3: the phone's own dialer, with 112, and no call.
// ---------------------------------------------------------------------------

describe('CALL-02-AC3: it opens the phone’s own dialer with 112, and places no call', () => {
  test.each([
    ['granted', 'granted'],
    ['not granted', 'notGranted'],
  ] as [string, 'granted' | 'notGranted'][])(
    'CALL-02-AC3: with the call permission %s, a tap on 112 records exactly one openDialer("112") and no callNumber',
    async (_what, permission) => {
      await withFirstContact('set');
      signedIn();
      mockPhone.permission = permission;
      const screen = await launch();

      await press(await findEmergencyButton(screen));
      await settle();

      expect(mockPhone.numbersGivenTo('openDialer')).toEqual(['112']);
      expect(mockPhone.timesCalled('callNumber')).toBe(0);
      expect(mockPhone.timesCalled('askCallPermission')).toBe(0);
    },
  );
});

// ---------------------------------------------------------------------------
// AC4: 112 needs nothing else.
// ---------------------------------------------------------------------------

/** Each thing 112 must not need, taken away in turn, and how. */
const WITHOUT: Record<string, () => Promise<Screen>> = {
  'no #1': async () => {
    signedIn();
    const screen = await launch();
    await findCallButton(screen, NB.none);
    return screen;
  },
  'the call permission not granted': async () => {
    await withFirstContact('set');
    signedIn();
    mockPhone.permission = 'notGranted';
    const screen = await launch();
    await findCallButton(screen, NB.call(FIRST.name));
    return screen;
  },
  'no credential, on the join screen': async () => {
    const screen = await launch();
    await screen.findByText(NB.joinTitle);
    return screen;
  },
  'GET /v1/me unanswered': async () => {
    signedIn();
    api.reply(ME, api.held().reply);
    const screen = await launch();
    await findCallButton(screen, NB.none);
    return screen;
  },
  'the server unreachable': async () => {
    signedIn();
    api.always(ME, 'network failure');
    const screen = await launch();
    await screen.findByText(NB.unreachable);
    return screen;
  },
  'secure storage unreadable': async () => {
    mockStore.items.set(CREDENTIAL_KEY, CREDENTIAL);
    mockStore.refuse('get', '*', new Error('synthetic: the Keystore refused every read'));
    api.always(ME, meAnswer());
    const screen = await launch();
    await settle();
    return screen;
  },
};

describe('CALL-02-AC4: 112 needs nothing else', () => {
  test.each(Object.keys(WITHOUT))(
    'CALL-02-AC4: with %s, a tap on 112 records exactly one openDialer("112") and no callNumber, and the app makes no request between the tap and openDialer',
    async (name) => {
      const go = WITHOUT[name];
      if (go === undefined) {
        throw new Error(`no case named ${name}`);
      }
      const screen = await go();
      const button = await findEmergencyButton(screen);
      await settle();
      const tapped = mockJournal.length;

      await press(button);
      await settle();

      const after = mockJournal.slice(tapped);
      const dialled = after.indexOf('phone openDialer');
      expect(dialled).toBeGreaterThanOrEqual(0);
      expect(after.slice(0, dialled).filter((entry) => entry.startsWith('api '))).toEqual([]);
      expect(mockPhone.numbersGivenTo('openDialer')).toEqual(['112']);
      expect(mockPhone.timesCalled('callNumber')).toBe(0);
    },
  );
});

// ---------------------------------------------------------------------------
// AC5: a dialer that cannot open is said.
// ---------------------------------------------------------------------------

describe('CALL-02-AC5: a dialer that cannot open is said', () => {
  test('CALL-02-AC5: when openDialer rejects, "Telefonen kunne ikke åpne 112. Ring 112 selv." shows in an element read out at once, assertive; the 112 button stays, and a later tap calls openDialer("112") again', async () => {
    signedIn();
    mockPhone.fail('openDialer', new Error('synthetic: no activity found for the dialer'));
    const screen = await launch();

    await press(await findEmergencyButton(screen));
    const message = await screen.findByText(EMERGENCY.nb.failed);

    const live: HostNode[] = [message, ...ancestorsOf(message)];
    expect(
      live.some(
        (node) =>
          node.props['accessibilityLiveRegion'] === 'assertive' ||
          node.props['aria-live'] === 'assertive',
      ),
    ).toBe(true);
    mockPhone.recover('openDialer');
    await press(await findEmergencyButton(screen));
    await settle();
    expect(mockPhone.numbersGivenTo('openDialer')).toEqual(['112', '112']);
    expect(mockPhone.timesCalled('callNumber')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC6: what it says, in full, and its size.
// ---------------------------------------------------------------------------

/** The text at a dotted key of a translation file, or undefined. */
const textAt = (file: unknown, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (at, part) =>
        typeof at === 'object' && at !== null ? (at as Record<string, unknown>)[part] : undefined,
      file,
    );

/** Every [dotted key, text] of a translation file. */
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

/** Every key of nb.json whose text is `text`: the table's keys may be renamed, its texts may not. */
const keysOf = (text: string): string[] =>
  leaves(nb)
    .filter(([, value]) => value === text)
    .map(([key]) => key);

describe('CALL-02-AC6: the 112 button says what it is, and nothing more', () => {
  test('CALL-02-AC6: its visible text is "112", its role "button", its label "Ring 112, nødnummeret" and its hint "Åpner telefonappen med 112. Trykk ring der."', async () => {
    signedIn();
    const screen = await launch();
    const button = await findEmergencyButton(screen);

    expect(roleOf(button)).toBe('button');
    expect(labelOf(button)).toBe(EMERGENCY.nb.label);
    expect(hintOf(button)).toBe(EMERGENCY.nb.hint);
    expect(textOf(button)).toBe(EMERGENCY.text);
  });

  test('CALL-02-AC6: the English is in en.json under the same keys as the bokmål: the label, the hint and the line when the dialer cannot open, each in full', () => {
    for (const [bokmål, english] of [
      [EMERGENCY.nb.label, EMERGENCY.en.label],
      [EMERGENCY.nb.hint, EMERGENCY.en.hint],
      [EMERGENCY.nb.failed, EMERGENCY.en.failed],
    ] as const) {
      const keys = keysOf(bokmål);
      expect({ bokmål, keys: keys.length > 0 }).toEqual({ bokmål, keys: true });
      for (const key of keys) {
        expect({ key, english: textAt(en, key) }).toEqual({ key, english });
      }
    }
  });

  test('CALL-02-AC6: with the app’s language set to English, the label reads "Call 112, the emergency number", the hint "Opens your phone app with 112. Tap call there.", and a dialer that cannot open says "Your phone could not open 112. Dial 112 yourself."', async () => {
    signedIn();
    mockPhone.fail('openDialer', new Error('synthetic: no activity found for the dialer'));
    const screen = await launch({ language: 'en-GB' });

    const button = await findEmergencyButton(screen, EMERGENCY.en.label);
    expect(labelOf(button)).toBe(EMERGENCY.en.label);
    expect(hintOf(button)).toBe(EMERGENCY.en.hint);
    expect(textOf(button)).toBe(EMERGENCY.text);
    await press(button);
    expect(await screen.findByText(EMERGENCY.en.failed)).toBeTruthy();
  });

  test('CALL-02-AC6: its flattened style has a minHeight of at least 64 and a minWidth of at least 96 (Q6)', async () => {
    signedIn();
    const screen = await launch();
    const style = flattenStyle((await findEmergencyButton(screen)).props['style']);

    expect(style['minHeight']).toEqual(expect.any(Number));
    expect(style['minWidth']).toEqual(expect.any(Number));
    expect(style['minHeight'] as number).toBeGreaterThanOrEqual(64);
    expect(style['minWidth'] as number).toBeGreaterThanOrEqual(96);
  });

  test('CALL-02-AC6: none of its texts, in either language, holds a word that says pressing 112 tells the group, shares a location or starts a journey', () => {
    const all = [EMERGENCY.text, ...Object.values(EMERGENCY.nb), ...Object.values(EMERGENCY.en)];

    expect(
      all.flatMap((text) =>
        NOT_SAID.filter((word) => text.toLowerCase().includes(word)).map(
          (word) => `${word} in ${text}`,
        ),
      ),
    ).toEqual([]);
    for (const [bokmål, english] of [
      [EMERGENCY.nb.label, EMERGENCY.en.label],
      [EMERGENCY.nb.hint, EMERGENCY.en.hint],
      [EMERGENCY.nb.failed, EMERGENCY.en.failed],
    ] as const) {
      expect(keysOf(bokmål).length).toBeGreaterThan(0);
      expect(keysOf(bokmål).map((key) => textAt(en, key))).toEqual(
        keysOf(bokmål).map(() => english),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// AC8: 112 and the call button at once, without waiting for the server.
// ---------------------------------------------------------------------------

describe('CALL-02-AC8: the home screen shows 112 and the call button at once, without waiting for the server', () => {
  // Real timers are restored by the file's afterEach, after the app is unmounted.

  test('CALL-02-AC8: with a credential stored and GET /v1/me held unanswered, once secure storage is read the home screen shows the 112 button and the call button, and nothing of the group: not "Du er med i gruppen", not "Denne telefonen er logget inn i gruppen.", not the admin’s choices', async () => {
    signedIn('ADMIN');
    const answer = api.held();
    api.reply(ME, answer.reply);
    const screen = await launch();

    await findEmergencyButton(screen);
    await findCallButton(screen, NB.none);
    await settle();

    expect(api.to(ME)).toHaveLength(1);
    const said = [...texts(screen), ...hostNodes(screen).map((node) => labelOf(node) ?? '')];
    expect(
      said.filter((text) =>
        [NB.memberTitle, NB.memberStatus, NB.invite, NB.members].includes(text as never),
      ),
    ).toEqual([]);
    answer.release(meAnswer('ADMIN'));
  });

  test.each([
    ['a member', 'MEMBER'],
    ['the admin', 'ADMIN'],
  ] as [string, 'MEMBER' | 'ADMIN'][])(
    'CALL-02-AC8: an answer naming %s then adds the heading and the status line, and for the admin "Inviter noen" and "Se medlemmene"; 112 and the call button stay',
    async (_who, role) => {
      signedIn(role);
      const answer = api.held();
      api.reply(ME, answer.reply);
      const screen = await launch();
      await findCallButton(screen, NB.none);

      answer.release(meAnswer(role));

      expect(await screen.findByText(NB.memberTitle)).toBeTruthy();
      expect(screen.getByText(NB.memberStatus)).toBeTruthy();
      const admin = [NB.invite, NB.members].map(
        (name) => screen.queryByRole('button', { name: exactly(name) }) !== null,
      );
      expect(admin).toEqual(role === 'ADMIN' ? [true, true] : [false, false]);
      expect(emergencyButtons(screen)).toHaveLength(1);
      expect(nameOf(callButton(screen))).toMatch(beginning(NB.none));
    },
  );

  test('CALL-02-AC8: a 401 signs out to the join screen, with its line, and 112 on it', async () => {
    signedIn();
    const answer = api.held();
    api.reply(ME, answer.reply);
    const screen = await launch();
    await findCallButton(screen, NB.none);

    answer.release({ status: 401, body: { code: 'UNAUTHORIZED', status: 401 } });

    expect(await screen.findByText(NB.signedOut)).toBeTruthy();
    expect(screen.getByText(NB.joinTitle)).toBeTruthy();
    expect(emergencyButtons(screen)).toHaveLength(1);
    expect(mockStore.items.has(CREDENTIAL_KEY)).toBe(false);
  });

  test.each([
    ['a network error', 'network failure'],
    ['a 5xx', '500'],
    ['no answer within 20 s', 'no answer'],
  ] as [string, string][])(
    'CALL-02-AC8: %s leaves the home screen, with "Vi fikk ikke kontakt med serveren. Prøv igjen om litt." and "Prøv igjen", 112 and the call button, and the credential kept (GRP-01-AC29 unchanged)',
    async (_what, how) => {
      signedIn();
      let screen: Screen;
      if (how === 'no answer') {
        api.reply(ME, 'no answer');
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
        screen = await launch();
        for (let step = 0; step < 1_000 && api.to(ME).length === 0; step += 1) {
          await app().testing.act(async () => {
            jest.advanceTimersByTime(10);
            await Promise.resolve();
          });
        }
        await findCallButton(screen, NB.none);
        await app().testing.act(async () => {
          jest.advanceTimersByTime(20_000);
          await Promise.resolve();
        });
        await settle();
      } else {
        api.reply(ME, how === 'network failure' ? 'network failure' : { status: Number(how) });
        screen = await launch();
      }

      expect(await screen.findByText(NB.unreachable)).toBeTruthy();
      expect(screen.getByRole('button', { name: exactly(NB.retry) })).toBeTruthy();
      expect(emergencyButtons(screen)).toHaveLength(1);
      expect(nameOf(callButton(screen))).toMatch(beginning(NB.none));
      expect(mockStore.items.get(CREDENTIAL_KEY)).toBe(CREDENTIAL);
      expect(screen.queryByText(NB.joinTitle)).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// AC9: every word translated, bokmål first. (The raw-text check over the
// source is shared/ui/source.test.ts, L1.)
// ---------------------------------------------------------------------------

describe('CALL-02-AC9: every word is translated, bokmål first', () => {
  test.each(TABLE)(
    'CALL-02-AC9: %s: its bokmål, "%s", is a text of nb.json, and en.json holds text under the same key',
    (_key, bokmål) => {
      const keys = keysOf(bokmål);

      expect({ bokmål, keys: keys.length > 0 }).toEqual({ bokmål, keys: true });
      for (const key of keys) {
        const english = textAt(en, key);
        expect({ key, english: typeof english === 'string' && english.trim() !== '' }).toEqual({
          key,
          english: true,
        });
      }
    },
  );
});
