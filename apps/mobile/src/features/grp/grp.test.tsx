// GRP-01-AC26 to AC30 (L5): joining by invitation, the admin's two screens,
// and a 401 that signs the phone out loudly, in the app as a person uses it.
//
// The whole app is rendered through Expo Router's own testing library from
// its route folder, src/app, as the app opens: so the tests hold what a person
// sees, not which file shows it, and they are found the way a screen reader
// finds them: headings, buttons and text fields by role and by their
// screen-reader label (AC30). Every word they look for is read from nb.json,
// through `nbText`, which fails loudly for a key that is not there, so a
// missing translation is never found as "anything at all".
//
// What stands in for the world outside the app, and nothing else:
//   - expo-secure-store: an in-memory store the test can read, kept across
//     launches of the app, as the Keystore keeps it across restarts (D-081:
//     allowBackup stays false); the only place the credential and the join key
//     may be (approach item 4);
//   - expo-crypto: random bytes, synthetic, for the join key;
//   - fetch: a fake API that answers each route of GRP-01's contract as a test
//     tells it, and records every request;
//   - expo-localization: a phone whose language is bokmål.
// A launch is a fresh module registry, so nothing the app kept in memory
// survives a restart; the secure store does.
//
// Test data is synthetic (RG-07): names and codes are made here, not anyone's.
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type * as ExpoRouterTesting from 'expo-router/testing-library';
import type * as ReactNative from 'react-native';

import en from '../../shared/translations/en.json';
import nb from '../../shared/translations/nb.json';

// ---------------------------------------------------------------------------
// The world outside the app.
// ---------------------------------------------------------------------------

/** The phone's secure storage, by key: kept across launches. */
const mockSecureItems = new Map<string, string>();
/** Every call the app made to secure storage, in order. */
const mockSecureCalls: string[] = [];

jest.mock(
  'expo-secure-store',
  () => {
    const set = (key: string, value: string) => {
      mockSecureCalls.push(`set ${key}`);
      mockSecureItems.set(key, value);
    };
    const get = (key: string) => {
      mockSecureCalls.push(`get ${key}`);
      return mockSecureItems.get(key) ?? null;
    };
    const remove = (key: string) => {
      mockSecureCalls.push(`delete ${key}`);
      mockSecureItems.delete(key);
    };
    return {
      setItemAsync: jest.fn((key: string, value: string) => {
        set(key, value);
        return Promise.resolve();
      }),
      getItemAsync: jest.fn((key: string) => Promise.resolve(get(key))),
      deleteItemAsync: jest.fn((key: string) => {
        remove(key);
        return Promise.resolve();
      }),
      setItem: jest.fn(set),
      getItem: jest.fn(get),
      deleteItem: jest.fn(remove),
      isAvailableAsync: jest.fn(() => Promise.resolve(true)),
      AFTER_FIRST_UNLOCK: 0,
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
      ALWAYS: 2,
      WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 3,
      ALWAYS_THIS_DEVICE_ONLY: 4,
      WHEN_UNLOCKED: 5,
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
    };
  },
  { virtual: true },
);

jest.mock(
  'expo-crypto',
  () => {
    const bytes = (size: number) =>
      Uint8Array.from({ length: size }, () => Math.floor(Math.random() * 256));
    return {
      getRandomBytes: jest.fn(bytes),
      getRandomBytesAsync: jest.fn((size: number) => Promise.resolve(bytes(size))),
      getRandomValues: jest.fn(<T extends ArrayBufferView>(array: T) => {
        const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        view.set(bytes(view.length));
        return array;
      }),
      randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000000'),
    };
  },
  { virtual: true },
);

jest.mock('expo-localization', () => {
  const locale = {
    languageTag: 'nb-NO',
    languageCode: 'nb',
    regionCode: 'NO',
    currencyCode: 'NOK',
    currencySymbol: 'kr',
    languageScriptCode: null,
    languageRegionCode: 'NO',
    languageCurrencyCode: 'NOK',
    languageCurrencySymbol: 'kr',
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

// A launch loads the app afresh, Expo Router and all, in a new module
// registry: the first takes several seconds on a cold cache, past jest's
// five. Time enough, so a slow machine is never read as a broken app.
jest.setTimeout(60_000);

/** A request the app made, as the fake API read it, and when, by the clock the test runs on. */
interface Sent {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
  at: number;
}

/** An answer the fake API gives: a status and a body, or a network failure. */
type Answered = { status: number; body?: unknown } | 'network failure';

/**
 * How the fake API answers one request: an answer at once; no answer at all,
 * ever, as a server that hangs (GRP-01-AC29's 20 s); or an answer held until
 * the test lets it go (`held`), so a test can look at the screen while the
 * request is in flight (AC30).
 */
type Reply = Answered | 'no answer' | { held: Promise<Answered> };

/** A reply the test lets go of: the reply to queue, and the way to answer it. */
function held(): { reply: Reply; release: (answer: Answered) => void } {
  let release: (answer: Answered) => void = () => undefined;
  const answer = new Promise<Answered>((resolve) => {
    release = resolve;
  });
  return {
    reply: { held: answer },
    release: (given) => {
      release(given);
    },
  };
}

/** The fake API: what the app sent, and how each route answers. */
const api = {
  sent: [] as Sent[],
  /** The answers, by `METHOD /path` with path parameters as `:id`; a queue first, then the default. */
  queued: new Map<string, Reply[]>(),
  defaults: new Map<string, Reply>(),
  reply(route: string, ...replies: Reply[]) {
    this.queued.set(route, [...(this.queued.get(route) ?? []), ...replies]);
  },
  always(route: string, reply: Reply) {
    this.defaults.set(route, reply);
  },
  reset() {
    this.sent = [];
    this.queued.clear();
    this.defaults.clear();
  },
  to(route: string): Sent[] {
    return this.sent.filter((request) => routeOf(request.method, request.path) === route);
  },
};

/** A request's route, as the fake API keys it: the method, and the path under /v1 with IDs as `:id`. */
function routeOf(method: string, path: string): string {
  const under = path.replace(/^.*?\/v1\//, '/v1/');
  return `${method} ${under.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')}`;
}

const JOIN = 'POST /v1/group/members';
const ME = 'GET /v1/me';
const INVITE = 'POST /v1/group/invitations';
const LIST = 'GET /v1/group/members';
const REMOVE = 'DELETE /v1/group/members/:id';

/** A body as JSON, or as the text it is, or null when there is none. */
function parsedOrText(text: string): unknown {
  if (text === '') {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fakeFetch(input: unknown, init?: unknown): Promise<Response> {
  const request = new Request(input as RequestInfo, init as RequestInit | undefined);
  const url = new URL(request.url);
  const text = await request.text();
  const body = parsedOrText(text);
  api.sent.push({
    method: request.method,
    path: url.pathname,
    authorization: request.headers.get('authorization'),
    body,
    at: Date.now(),
  });
  const route = routeOf(request.method, url.pathname);
  const queue = api.queued.get(route) ?? [];
  const given = queue.shift() ?? api.defaults.get(route);
  if (given === undefined) {
    throw new Error(`the fake API has no answer for ${route}`);
  }
  if (given === 'no answer') {
    return new Promise<Response>(() => undefined);
  }
  const reply = typeof given === 'object' && 'held' in given ? await given.held : given;
  if (reply === 'network failure') {
    throw new TypeError('Network request failed');
  }
  return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
    status: reply.status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The fake API is every fetch the app makes, fixed in place for the file.
 * Expo's runtime puts its own fetch on the global whenever it is loaded
 * afresh, as each launch loads it, unless the global cannot be changed; so it
 * is defined once, not configurable, and Expo leaves it, saying so in one
 * console error, which is the only one dropped below. Every other console
 * error is written as it is.
 */
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

/** An error body as the API writes one: its code, its status and a message. */
const refusal = (status: number, code: string) => ({
  status,
  body: { defined: true, code, status, message: code },
});

// ---------------------------------------------------------------------------
// Words, from nb.json, failing loudly when a key is missing.
// ---------------------------------------------------------------------------

function lookup(tree: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      tree,
    );
}

/** The bokmål text of a key, which must be there and not empty. */
function nbText(key: string): string {
  const value = lookup(nb, key);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`nb.json has no text for ${key}`);
  }
  return value;
}

/** The text of a key with a placeholder in it, filled as the app's own i18next fills it. */
function nbFilled(key: string, values: Record<string, string>): string {
  nbText(key);
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
    nbText(key),
  );
}

/** Every key GRP-01's screens read: what AC30 holds to both files. */
const GRP_KEYS = [
  'grp.join.title',
  'grp.join.intro',
  'grp.join.codeLabel',
  'grp.join.nameLabel',
  'grp.join.submit',
  'grp.join.notValid',
  'grp.join.notSaved',
  'grp.join.retry',
  'grp.join.signedOut',
  'grp.member.title',
  'grp.member.status',
  'grp.member.invite',
  'grp.member.members',
  'grp.member.unreachable',
  'grp.member.retry',
  'grp.invite.title',
  'grp.invite.create',
  'grp.invite.expires',
  'grp.invite.share',
  'grp.members.title',
  'grp.members.admin',
  'grp.members.member',
  'grp.members.remove',
  'grp.members.confirmText',
  'grp.members.confirm',
  'grp.members.cancel',
  // GRP-01, review loop 1: the name that cannot be used (AC31), the removal
  // said once it is done (AC28), and a removal refused (AC28).
  'grp.join.nameNotUsable',
  'grp.members.removed',
  'grp.members.refused',
];

// ---------------------------------------------------------------------------
// The app.
// ---------------------------------------------------------------------------

/** A heading, however it is marked (see app.test.tsx). */
const HEADING = /^(header|heading)$/;
/** What i18next shows for a key it cannot find: the key itself, dotted. */
const LOOKS_LIKE_A_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;

interface Launched {
  testing: typeof ExpoRouterTesting;
  native: typeof ReactNative;
}

let launched: Launched | undefined;

/**
 * Launches the app: a fresh module registry, so nothing kept in memory
 * survives, and the route folder rendered from "/", as the app opens. The
 * secure store and the fake API stay as they were.
 */
async function launch(): Promise<typeof ExpoRouterTesting.screen> {
  if (launched !== undefined) {
    await launched.testing.cleanup();
  }
  jest.resetModules();
  const testing: typeof ExpoRouterTesting = jest.requireActual('expo-router/testing-library');
  const native: typeof ReactNative = jest.requireActual('react-native');
  launched = { testing, native };
  await testing.renderRouter('src/app', { initialUrl: '/' });
  return testing.screen;
}

function testing(): typeof ExpoRouterTesting {
  if (launched === undefined) {
    throw new Error('the app was never launched');
  }
  return launched.testing;
}

/** React Native as the launched app has it: the same module the app's screens use. */
function native(): typeof ReactNative {
  if (launched === undefined) {
    throw new Error('the app was never launched');
  }
  return launched.native;
}

/** A synthetic code as the admin's app shows one, and a synthetic name. */
const CODE = 'K7Q2M-9TRVX-4HNPA-62WZE';
const NAME = 'Testmedlem ØKVAR';

/** The join screen's two fields and its button, as a screen reader finds them. */
async function fillAndSend(
  screen: typeof ExpoRouterTesting.screen,
  { code = CODE, name = NAME }: { code?: string; name?: string } = {},
) {
  const { fireEvent } = testing();
  await fireEvent.changeText(await screen.findByLabelText(nbText('grp.join.codeLabel')), code);
  await fireEvent.changeText(screen.getByLabelText(nbText('grp.join.nameLabel')), name);
  await fireEvent.press(screen.getByRole('button', { name: nbText('grp.join.submit') }));
}

/** The credential and the user a successful join hands the app, synthetic. */
function joined(role: 'ADMIN' | 'MEMBER') {
  const credential = 'A'.repeat(20) + 'b'.repeat(13) + '-_0123456789';
  const userId =
    role === 'ADMIN'
      ? 'a1a1a1a1-0000-4000-8000-00000000000a'
      : 'b2b2b2b2-0000-4000-8000-00000000000b';
  api.reply(JOIN, { status: 201, body: { credential, userId, role } });
  api.always(ME, { status: 200, body: { userId, displayName: NAME, role } });
  return { credential, userId };
}

/** A fresh install that joins, as `role`, and comes to the member screen. */
async function signedIn(role: 'ADMIN' | 'MEMBER') {
  const who = joined(role);
  const screen = await launch();
  await fillAndSend(screen);
  await screen.findByRole(HEADING, { name: nbText('grp.member.title') });
  return { screen, ...who };
}

/** Every value secure storage holds. */
const stored = (): string[] => [...mockSecureItems.values()];

/** A rendered host element, as the test renderer hands one out. */
interface HostNode {
  type: string;
  props: Record<string, unknown>;
  parent: HostNode | null;
  children: (HostNode | string)[];
}

/** Every host element on screen, in the order a screen reader meets them. */
function hostNodes(screen: typeof ExpoRouterTesting.screen): HostNode[] {
  return screen.container.queryAll(() => true);
}

/** The text an element holds, its children's included. */
function textOf(node: HostNode): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}

/** Whether an element sits inside a Text, which lays it out inline, as part of its own lines. */
function insideText(node: HostNode): boolean {
  for (let up = node.parent; up !== null; up = up.parent) {
    if (up.type === 'Text') {
      return true;
    }
  }
  return false;
}

/** Whether `ancestor` holds `node`. */
function holds(ancestor: HostNode, node: HostNode): boolean {
  for (let up = node.parent; up !== null; up = up.parent) {
    if (up === ancestor) {
      return true;
    }
  }
  return false;
}

/** Every Text on screen that sits inside no other Text: what a person reads, in order. */
function shownTexts(screen: typeof ExpoRouterTesting.screen): { node: HostNode; text: string }[] {
  return hostNodes(screen)
    .filter((node) => node.type === 'Text' && !insideText(node))
    .map((node) => ({ node, text: textOf(node) }));
}

/** All the text on screen, in order. */
const shownText = (screen: typeof ExpoRouterTesting.screen): string =>
  shownTexts(screen)
    .map(({ text }) => text)
    .join(' ');

/** An element's screen-reader label, if it has one. */
function labelOf(node: HostNode): string | null {
  const label = node.props['accessibilityLabel'] ?? node.props['aria-label'];
  return typeof label === 'string' && label.trim() !== '' ? label : null;
}

beforeEach(() => {
  mockSecureItems.clear();
  mockSecureCalls.length = 0;
  api.reset();
});

afterEach(async () => {
  if (launched !== undefined) {
    await launched.testing.cleanup();
    launched = undefined;
  }
});

// ---------------------------------------------------------------------------
// AC26: a new install joins.
// ---------------------------------------------------------------------------

describe('GRP-01-AC26: a new install joins with an invitation', () => {
  test('GRP-01-AC26: a fresh install, nothing stored, opens on the join screen in bokmål, with its title as a heading, a field for the code and one for the person’s own name; it asks the server nothing', async () => {
    const screen = await launch();

    expect(
      (await screen.findAllByRole(HEADING, { name: nbText('grp.join.title') })).length,
    ).toBeGreaterThan(0);
    expect(screen.getByLabelText(nbText('grp.join.codeLabel'))).toBeTruthy();
    expect(screen.getByLabelText(nbText('grp.join.nameLabel'))).toBeTruthy();
    expect(screen.getByRole('button', { name: nbText('grp.join.submit') })).toBeTruthy();
    expect(screen.queryAllByText(LOOKS_LIKE_A_KEY).map((node) => node.props)).toEqual([]);
    expect(api.sent).toEqual([]);
  });

  test('GRP-01-AC26: a valid code and the person’s own name, sent: the join carries the code, a join key of 43 base64url characters and the name, and no credential; then the credential and that join key are in secure storage, and the member screen shows', async () => {
    const { credential } = joined('MEMBER');
    const screen = await launch();

    await fillAndSend(screen);

    expect(
      (await screen.findAllByRole(HEADING, { name: nbText('grp.member.title') })).length,
    ).toBeGreaterThan(0);
    const [join, ...more] = api.to(JOIN);
    expect(more).toEqual([]);
    expect(join?.authorization).toBeNull();
    const body = join?.body as {
      invitationCode?: unknown;
      joinKey?: unknown;
      displayName?: unknown;
    };
    expect(Object.keys(body).sort()).toEqual(['displayName', 'invitationCode', 'joinKey']);
    expect(String(body.invitationCode).replace(/[- ]/g, '').toUpperCase()).toBe(
      CODE.replace(/-/g, ''),
    );
    expect(body.displayName).toBe(NAME);
    expect(body.joinKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored()).toEqual(expect.arrayContaining([credential, body.joinKey]));
    expect(screen.queryByText(credential)).toBeNull();
    for (const sent of api.sent.filter(({ authorization }) => authorization !== null)) {
      expect(sent.authorization).toBe(`Bearer ${credential}`);
    }
  });

  test('GRP-01-AC26: the credential and the join key are kept in secure storage and nowhere else: not in the module registry’s other storage, not on screen', async () => {
    const { credential } = joined('MEMBER');
    const screen = await launch();
    await fillAndSend(screen);
    await screen.findAllByRole(HEADING, { name: nbText('grp.member.title') });

    // A restart: nothing in memory survives; the app finds the credential in
    // secure storage and asks GET /v1/me with it.
    api.sent = [];
    const again = await launch();

    expect(
      (await again.findAllByRole(HEADING, { name: nbText('grp.member.title') })).length,
    ).toBeGreaterThan(0);
    expect(api.to(ME).map(({ authorization }) => authorization)).toContain(`Bearer ${credential}`);
    expect(api.to(JOIN)).toEqual([]);
    expect(mockSecureCalls.some((call) => call.startsWith('get '))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC27: a failed join, said plainly, and never looking joined.
// ---------------------------------------------------------------------------

describe('GRP-01-AC27: the app says plainly when joining fails, and never looks joined', () => {
  test.each([
    ['404 INVITATION_NOT_VALID', refusal(404, 'INVITATION_NOT_VALID')],
    ['the fixed 400', refusal(400, 'BAD_REQUEST')],
  ] satisfies [string, Reply][])(
    'GRP-01-AC27: a join answered %s shows the one message, ask the admin for a new invitation; nothing is stored, and the member screen is never shown',
    async (_what, reply) => {
      api.reply(JOIN, reply);
      const screen = await launch();

      await fillAndSend(screen);

      expect(await screen.findByText(nbText('grp.join.notValid'))).toBeTruthy();
      expect(screen.queryAllByRole(HEADING, { name: nbText('grp.member.title') })).toEqual([]);
      expect(screen.getByLabelText(nbText('grp.join.codeLabel'))).toBeTruthy();
      // Nothing that signs the phone in: secure storage may hold the join key
      // the app made and sent, which a later join reuses, and nothing else of
      // a credential's length.
      const { joinKey } = (api.to(JOIN)[0]?.body ?? {}) as { joinKey?: string };
      expect(stored().filter((value) => value !== joinKey && value.length >= 40)).toEqual([]);
    },
  );

  test.each([
    ['500', { status: 500, body: { code: 'INTERNAL_SERVER_ERROR', status: 500 } }],
    ['a network failure', 'network failure'],
  ] satisfies [string, Reply][])(
    'GRP-01-AC27: a join answered with %s says nothing was saved and offers a retry, which sends the same join key; the member screen is not shown until a join is 201',
    async (_what, failure) => {
      api.reply(JOIN, failure);
      const { credential } = joined('MEMBER');
      const screen = await launch();

      await fillAndSend(screen);

      expect(await screen.findByText(nbText('grp.join.notSaved'))).toBeTruthy();
      expect(screen.queryAllByRole(HEADING, { name: nbText('grp.member.title') })).toEqual([]);
      expect(stored()).not.toContain(credential);
      await testing().fireEvent.press(
        screen.getByRole('button', { name: nbText('grp.join.retry') }),
      );

      expect(
        (await screen.findAllByRole(HEADING, { name: nbText('grp.member.title') })).length,
      ).toBeGreaterThan(0);
      const [first, second, ...more] = api.to(JOIN).map(({ body }) => body as { joinKey: string });
      expect(more).toEqual([]);
      expect(second?.joinKey).toBe(first?.joinKey);
      expect(second).toEqual(first);
      expect(stored()).toContain(credential);
    },
  );
});

// ---------------------------------------------------------------------------
// AC28: the admin invites and removes.
// ---------------------------------------------------------------------------

describe('GRP-01-AC28: the admin invites and removes in the app', () => {
  test('GRP-01-AC28: signed in as the admin, the member screen offers both choices: invite, and the members', async () => {
    const { screen } = await signedIn('ADMIN');

    expect(screen.getByRole('button', { name: nbText('grp.member.invite') })).toBeTruthy();
    expect(screen.getByRole('button', { name: nbText('grp.member.members') })).toBeTruthy();
  });

  test('GRP-01-AC28: a member who is not the admin sees neither choice', async () => {
    const { screen } = await signedIn('MEMBER');

    expect(screen.queryByRole('button', { name: nbText('grp.member.invite') })).toBeNull();
    expect(screen.queryByRole('button', { name: nbText('grp.member.members') })).toBeNull();
  });

  test('GRP-01-AC28: the invite screen creates an invitation with the admin’s credential and shows its code, its expiry date and a share action, which hands the code to the system’s share sheet', async () => {
    const { screen, credential } = await signedIn('ADMIN');
    api.reply(INVITE, {
      status: 201,
      body: { invitationCode: CODE, expiresAt: '2026-10-27T12:00:00.000Z' },
    });
    const share = jest.spyOn(native().Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    const { fireEvent } = testing();

    await fireEvent.press(screen.getByRole('button', { name: nbText('grp.member.invite') }));
    await fireEvent.press(await screen.findByRole('button', { name: nbText('grp.invite.create') }));

    // RG-03 (GRP-01-AC28, review loop 1): the code was found as one Text
    // holding all of it. Since loop 1 it shows in four groups, each kept
    // whole when the line wraps (the tests under "the invitation code, as it
    // is shown and read" hold how), so no one Text holds it all. What is
    // held here is unchanged: the code is on screen, its groups in order,
    // read from the screen's text as a person reads it, however it is split.
    await screen.findByRole('button', { name: nbText('grp.invite.share') });
    expect(shownText(screen).replace(/[\s-]/g, '')).toContain(CODE.replace(/-/g, ''));
    expect(api.to(INVITE).map(({ authorization }) => authorization)).toEqual([
      `Bearer ${credential}`,
    ]);
    expect(
      screen.queryAllByText(/27/).some((node) => String(node.props['children']).includes('2026')),
    ).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: nbText('grp.invite.share') }));
    expect(share).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(share.mock.calls[0]?.[0])).toContain(CODE);
  });

  test('GRP-01-AC28: the members screen lists names and roles; removing a member asks first, saying it takes effect at once, then removes with the admin’s credential and shows the list without them', async () => {
    const { screen, credential, userId } = await signedIn('ADMIN');
    const other = {
      userId: 'c3c3c3c3-0000-4000-8000-00000000000c',
      displayName: 'Testmedlem ÅPENT',
      role: 'MEMBER',
    };
    const everyone = [{ userId, displayName: NAME, role: 'ADMIN' }, other];
    api.reply(LIST, { status: 200, body: { members: everyone } });
    api.always(LIST, { status: 200, body: { members: everyone.slice(0, 1) } });
    api.reply(REMOVE, { status: 200, body: { outcome: 'REMOVED' } });
    const { fireEvent } = testing();

    await fireEvent.press(screen.getByRole('button', { name: nbText('grp.member.members') }));

    expect(await screen.findByText(other.displayName)).toBeTruthy();
    expect(screen.getByText(NAME)).toBeTruthy();
    expect(screen.getAllByText(nbText('grp.members.admin')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(nbText('grp.members.member')).length).toBeGreaterThan(0);
    await fireEvent.press(
      screen.getByRole('button', {
        name: nbFilled('grp.members.remove', { name: other.displayName }),
      }),
    );
    expect(api.to(REMOVE)).toEqual([]);
    expect(
      await screen.findByText(nbFilled('grp.members.confirmText', { name: other.displayName })),
    ).toBeTruthy();
    // RG-03 (GRP-01-AC28, review loop 1, a11y-i18n-reviewer): the confirm
    // button's label names the member ("Fjern Kari"), so it is found by the
    // key filled with their name, where it was found by the key alone.
    await fireEvent.press(
      screen.getByRole('button', {
        name: nbFilled('grp.members.confirm', { name: other.displayName }),
      }),
    );

    await testing().waitFor(() => {
      expect(screen.queryByText(other.displayName)).toBeNull();
    });
    expect(api.to(REMOVE).map(({ path, authorization }) => ({ path, authorization }))).toEqual([
      { path: `/v1/group/members/${other.userId}`, authorization: `Bearer ${credential}` },
    ]);
  });

  test('GRP-01-AC28: the confirmation says the removal takes effect at once, in both languages', () => {
    expect(nbText('grp.members.confirmText')).toMatch(
      /umiddelbart|med en gang|med én gang|straks|med det samme/i,
    );
    expect(String(lookup(en, 'grp.members.confirmText'))).toMatch(
      /immediately|at once|right away/i,
    );
  });
});

// ---------------------------------------------------------------------------
// AC29: a 401 signs the phone out, loudly; nothing else does.
// ---------------------------------------------------------------------------

describe('GRP-01-AC29: a 401 signs the phone out loudly; nothing else does', () => {
  test('GRP-01-AC29: at start, GET /v1/me answered 401: the stored credential is deleted, and the join screen shows with a line that this phone is no longer signed in to the group', async () => {
    const { credential } = await signedIn('MEMBER');
    api.always(ME, refusal(401, 'UNAUTHORIZED'));

    const screen = await launch();

    expect(await screen.findByText(nbText('grp.join.signedOut'))).toBeTruthy();
    expect(
      (await screen.findAllByRole(HEADING, { name: nbText('grp.join.title') })).length,
    ).toBeGreaterThan(0);
    expect(stored()).not.toContain(credential);
  });

  test('GRP-01-AC29: any call answered 401, the invitation’s too, signs the phone out the same way', async () => {
    const { screen, credential } = await signedIn('ADMIN');
    api.reply(INVITE, refusal(401, 'UNAUTHORIZED'));
    const { fireEvent } = testing();

    await fireEvent.press(screen.getByRole('button', { name: nbText('grp.member.invite') }));
    await fireEvent.press(await screen.findByRole('button', { name: nbText('grp.invite.create') }));

    expect(await screen.findByText(nbText('grp.join.signedOut'))).toBeTruthy();
    expect(stored()).not.toContain(credential);
  });

  test.each([
    ['500', { status: 500, body: { code: 'INTERNAL_SERVER_ERROR', status: 500 } }],
    ['a network failure', 'network failure'],
  ] satisfies [string, Reply][])(
    'GRP-01-AC29: at start, GET /v1/me answered with %s keeps the credential, says the server could not be reached, and offers a retry, which then shows the member screen; it never shows the join screen',
    async (_what, failure) => {
      const { credential } = await signedIn('MEMBER');
      api.reply(ME, failure);

      const screen = await launch();

      expect(await screen.findByText(nbText('grp.member.unreachable'))).toBeTruthy();
      expect(stored()).toContain(credential);
      expect(screen.queryAllByRole(HEADING, { name: nbText('grp.join.title') })).toEqual([]);
      expect(screen.queryByText(nbText('grp.join.signedOut'))).toBeNull();
      await testing().fireEvent.press(
        screen.getByRole('button', { name: nbText('grp.member.retry') }),
      );
      expect(
        (await screen.findAllByRole(HEADING, { name: nbText('grp.member.title') })).length,
      ).toBeGreaterThan(0);
      expect(stored()).toContain(credential);
    },
  );
});

// ---------------------------------------------------------------------------
// AC30: every word translated, every control labelled, nothing that promises
// protection.
// ---------------------------------------------------------------------------

describe('GRP-01-AC30: every word is translated, every control labelled', () => {
  test.each(GRP_KEYS)('GRP-01-AC30: %s has text in nb.json and in en.json', (key) => {
    expect(typeof lookup(nb, key)).toBe('string');
    expect(String(lookup(nb, key)).trim()).not.toBe('');
    expect(typeof lookup(en, key)).toBe('string');
    expect(String(lookup(en, key)).trim()).not.toBe('');
  });

  test('GRP-01-AC30: the placeholder’s keys are gone: the app opens on the join screen now', () => {
    expect(lookup(nb, 'placeholder')).toBeUndefined();
    expect(lookup(en, 'placeholder')).toBeUndefined();
  });

  test('GRP-01-AC30: no text of GRP-01’s screens says or implies the person is protected, looked after or watched over', () => {
    const texts = (tree: unknown) => JSON.stringify(lookup(tree, 'grp') ?? {});
    // Not vacuous: both files hold GRP-01's words.
    expect(GRP_KEYS.map((key) => typeof lookup(nb, key))).toEqual(GRP_KEYS.map(() => 'string'));
    expect(GRP_KEYS.map((key) => typeof lookup(en, key))).toEqual(GRP_KEYS.map(() => 'string'));

    expect(texts(nb)).not.toMatch(
      /beskytt|passer på|ivaretatt|overvåk|følger med på deg|du er trygg|i trygge hender/i,
    );
    expect(texts(en)).not.toMatch(
      /protect|look(s|ed|ing)? after|watch(es|ed|ing)? over|monitor|you are safe|safe hands/i,
    );
  });

  /**
   * Every text field has a screen-reader label; everything that can be
   * pressed says what it is, a button, and has a name a screen reader reads.
   */
  function expectLabelled(screen: typeof ExpoRouterTesting.screen, where: string) {
    const fields = screen.container.queryAll((node) => node.type === 'TextInput');
    for (const field of fields) {
      const label: unknown = field.props['accessibilityLabel'] ?? field.props['aria-label'];
      expect({ where, labelled: typeof label === 'string' && label.trim() !== '' }).toEqual({
        where,
        labelled: true,
      });
    }
    const pressables = screen.container.queryAll(
      (node) =>
        node.type !== 'TextInput' &&
        (typeof node.props['onClick'] === 'function' ||
          typeof node.props['onPress'] === 'function'),
    );
    expect({ where, pressables: pressables.length > 0 }).toEqual({ where, pressables: true });
    for (const node of pressables) {
      const role: unknown = node.props['accessibilityRole'] ?? node.props['role'];
      expect({ where, role }).toEqual({ where, role: 'button' });
    }
    const buttons = screen.queryAllByRole('button');
    for (const button of buttons) {
      const label: unknown = button.props['accessibilityLabel'] ?? button.props['aria-label'];
      const text = testing()
        .within(button)
        .queryAllByText(/\S/)
        .map((node) => String(node.props['children']))
        .join(' ');
      const name = typeof label === 'string' && label.trim() !== '' ? label : text;
      expect({ where, named: name.trim() !== '' }).toEqual({ where, named: true });
    }
  }

  test('GRP-01-AC30: on the join screen, the member screen, the invite screen and the members screen, every control has a screen-reader label', async () => {
    const { screen } = await signedIn('ADMIN');
    expectLabelled(screen, 'the member screen');
    // The admin and one member: so the members screen has a member the admin
    // can remove, and its removal control is among those checked.
    api.reply(LIST, {
      status: 200,
      body: {
        members: [
          { userId: 'a1a1a1a1-0000-4000-8000-00000000000a', displayName: NAME, role: 'ADMIN' },
          {
            userId: 'c3c3c3c3-0000-4000-8000-00000000000c',
            displayName: 'Testmedlem ÅPENT',
            role: 'MEMBER',
          },
        ],
      },
    });
    const { fireEvent } = testing();

    await fireEvent.press(screen.getByRole('button', { name: nbText('grp.member.invite') }));
    await screen.findByRole('button', { name: nbText('grp.invite.create') });
    expectLabelled(screen, 'the invite screen');

    // A launch is a new module registry, so its fireEvent is the new one's.
    const fresh = await launch();
    await testing().fireEvent.press(
      await fresh.findByRole('button', { name: nbText('grp.member.members') }),
    );
    await fresh.findByText(NAME);
    expectLabelled(fresh, 'the members screen');

    mockSecureItems.clear();
    const joinScreen = await launch();
    await joinScreen.findByLabelText(nbText('grp.join.codeLabel'));
    expectLabelled(joinScreen, 'the join screen');
  });
});

// ---------------------------------------------------------------------------
// Review loop 1 (2026-10-20): from the reviews of a5fd8cf. The a11y-i18n
// reviewer's S2 to S6 (AC28, AC30), code-reviewer S4 (a refusal on removal is
// a refusal), privacy-security-reviewer N4 (AC31, the display name), and the
// test-auditor's two unpinned behaviours: the join key a retried join sends,
// and the 20 s the app waits for an answer (AC27, AC29).
// ---------------------------------------------------------------------------

/** Every bokmål text under grp, the values a screen-reader label may take. */
function grpTexts(tree: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      out.push(node);
    } else if (typeof node === 'object' && node !== null) {
      Object.values(node).forEach(walk);
    }
  };
  walk(lookup(tree, 'grp'));
  return out;
}

/** Every key under grp, dotted, whose text is a string. */
function grpKeys(tree: unknown, prefix = 'grp'): string[] {
  const node = lookup(tree, prefix);
  if (typeof node === 'string') {
    return [prefix];
  }
  if (typeof node !== 'object' || node === null) {
    return [];
  }
  return Object.keys(node).flatMap((key) => grpKeys(tree, `${prefix}.${key}`));
}

/**
 * What a screen reader is told without moving to it: the text and the label
 * of everything in a live region on screen now, and everything the app asked
 * AccessibilityInfo to announce since this launch.
 */
function announcements(screen: typeof ExpoRouterTesting.screen): string[] {
  const live = hostNodes(screen).filter((node) =>
    ['polite', 'assertive'].includes(
      String(node.props['accessibilityLiveRegion'] ?? node.props['aria-live']),
    ),
  );
  const { AccessibilityInfo } = native();
  const calls = [
    ...(AccessibilityInfo.announceForAccessibility as unknown as jest.Mock).mock.calls,
    ...(AccessibilityInfo.announceForAccessibilityWithOptions as unknown as jest.Mock).mock.calls,
  ];
  return [
    ...live.flatMap((node) => [textOf(node), labelOf(node) ?? '']),
    ...calls.map(([text]) => String(text)),
  ].filter((text) => text.trim() !== '');
}

/** The waiting indicators on screen: an ActivityIndicator, or anything with the role progressbar. */
function waitingIndicators(screen: typeof ExpoRouterTesting.screen): HostNode[] {
  return hostNodes(screen).filter(
    (node) =>
      node.type === 'ActivityIndicator' ||
      node.props['accessibilityRole'] === 'progressbar' ||
      node.props['role'] === 'progressbar',
  );
}

/**
 * A request in flight shows a waiting indicator a screen reader can name,
 * with words from the translations, beside the dimmed button (AC30).
 */
function expectWaiting(screen: typeof ExpoRouterTesting.screen, what: string) {
  const indicators = waitingIndicators(screen);
  expect({ what, indicators: indicators.length > 0 }).toEqual({ what, indicators: true });
  const texts = grpTexts(nb);
  for (const indicator of indicators) {
    const label = labelOf(indicator);
    expect({ what, label, translated: label !== null && texts.includes(label) }).toEqual({
      what,
      label,
      translated: true,
    });
  }
}

/** The admin, on the members screen, with three members besides themself. */
const MEMBERS = [
  {
    userId: 'c3c3c3c3-0000-4000-8000-00000000000c',
    displayName: 'Testmedlem ÅPENT',
    role: 'MEMBER',
  },
  {
    userId: 'd4d4d4d4-0000-4000-8000-00000000000d',
    displayName: 'Testmedlem BRATT',
    role: 'MEMBER',
  },
  {
    userId: 'e5e5e5e5-0000-4000-8000-00000000000e',
    displayName: 'Testmedlem CIRKA',
    role: 'MEMBER',
  },
];
const [FIRST, SECOND, THIRD] = MEMBERS as [
  (typeof MEMBERS)[number],
  (typeof MEMBERS)[number],
  (typeof MEMBERS)[number],
];

/** Signed in as the admin and on the members screen, the list showing everyone; later lists as `after`. */
async function onTheMembersScreen(after: typeof MEMBERS = MEMBERS) {
  const { screen, userId, credential } = await signedIn('ADMIN');
  const everyone = [{ userId, displayName: NAME, role: 'ADMIN' }, ...MEMBERS];
  api.reply(LIST, { status: 200, body: { members: everyone } });
  api.always(LIST, {
    status: 200,
    body: { members: [{ userId, displayName: NAME, role: 'ADMIN' }, ...after] },
  });
  await testing().fireEvent.press(
    screen.getByRole('button', { name: nbText('grp.member.members') }),
  );
  await screen.findByText(THIRD.displayName);
  return { screen, credential };
}

/** Presses the first member's remove button: the confirmation shows. */
async function askToRemoveFirst(screen: typeof ExpoRouterTesting.screen) {
  await testing().fireEvent.press(
    screen.getByRole('button', {
      name: nbFilled('grp.members.remove', { name: FIRST.displayName }),
    }),
  );
  await screen.findByText(nbFilled('grp.members.confirmText', { name: FIRST.displayName }));
}

/** The confirm button, found by its label, which names the member (AC28, review loop 1). */
const confirmButton = (screen: typeof ExpoRouterTesting.screen) =>
  screen.getByRole('button', {
    name: nbFilled('grp.members.confirm', { name: FIRST.displayName }),
  });

/** The code's four groups of five, as the admin's app shows them. */
const GROUPS = CODE.split('-');

/**
 * The code as a screen reader must read it: each group's characters apart,
 * and a pause, a comma, full stop or semicolon, between groups. For the
 * synthetic code: "K 7 Q 2 M, 9 T R V X, 4 H N P A, 6 2 W Z E".
 */
const SPELLED = new RegExp(
  GROUPS.map((group) => Array.from(group).join('\\s+')).join('\\s*[,.;]\\s*'),
);

/** The admin creates an invitation, and its code shows. */
async function invitationShown() {
  const { screen } = await signedIn('ADMIN');
  api.reply(INVITE, {
    status: 201,
    body: { invitationCode: CODE, expiresAt: '2026-10-27T12:00:00.000Z' },
  });
  const { fireEvent } = testing();
  await fireEvent.press(screen.getByRole('button', { name: nbText('grp.member.invite') }));
  await fireEvent.press(await screen.findByRole('button', { name: nbText('grp.invite.create') }));
  await screen.findByRole('button', { name: nbText('grp.invite.share') });
  return screen;
}

describe('GRP-01-AC28: the invitation code, as it is shown and read (review loop 1)', () => {
  // a11y-i18n-reviewer: a hyphen before a digit is no line-break opportunity,
  // so one Text holding "K7Q2M-9TRVX-…" could break inside a group when the
  // line wraps. Five letters and digits with nothing between them have no
  // break opportunity at all, so a Text holding one group, and only it, laid
  // out on its own (inside no other Text, which would make it part of its
  // lines), cannot break.
  test('GRP-01-AC28: the code shows as four groups of five, in order, each in a Text of its own holding those five characters and nothing else, inside no other Text, so no group breaks when the line wraps', async () => {
    const screen = await invitationShown();

    const holding = shownTexts(screen).filter(({ text }) =>
      GROUPS.some((group) => text.includes(group)),
    );

    expect(holding.map(({ text }) => text)).toEqual(GROUPS);
  });

  test('GRP-01-AC28: a screen reader reads the code as one element whose label spells it character by character, group by group, with a pause between groups', async () => {
    const screen = await invitationShown();
    const groupTexts = shownTexts(screen).filter(({ text }) => GROUPS.includes(text));

    const spelled = hostNodes(screen).filter((node) => SPELLED.test(labelOf(node) ?? ''));

    expect(spelled.map((node) => labelOf(node))).toEqual([expect.stringMatching(SPELLED)]);
    const [element] = spelled;
    expect(element?.props['accessible'] ?? element?.type === 'Text').toBe(true);
    expect(groupTexts).toHaveLength(4);
    for (const { node } of groupTexts) {
      expect(element !== undefined && holds(element, node)).toBe(true);
    }
  });

  test('GRP-01-AC28: the code is announced when it appears: it is in a live region, or announced, spelled as the screen reader reads it', async () => {
    const screen = await invitationShown();

    expect(announcements(screen).some((text) => SPELLED.test(text))).toBe(true);
  });
});

describe('GRP-01-AC28: the removal, confirmed in place and announced (review loop 1)', () => {
  test('GRP-01-AC28: the confirmation shows in that member’s own place in the list: after their name, and before the next member’s', async () => {
    const { screen } = await onTheMembersScreen();

    await askToRemoveFirst(screen);

    const order = shownTexts(screen).map(({ text }) => text);
    const confirmText = nbFilled('grp.members.confirmText', { name: FIRST.displayName });
    const at = {
      member: order.indexOf(FIRST.displayName),
      confirmation: order.indexOf(confirmText),
      next: order.indexOf(SECOND.displayName),
    };
    expect(at.member).toBeGreaterThanOrEqual(0);
    expect(at.confirmation).toBeGreaterThan(at.member);
    expect(at.confirmation).toBeLessThan(at.next);
  });

  test('GRP-01-AC28: the confirm button’s screen-reader label names the member, in both languages, and pressing it removes that member and nobody else', async () => {
    expect(nbText('grp.members.confirm')).toContain('{{name}}');
    expect(String(lookup(en, 'grp.members.confirm'))).toContain('{{name}}');
    api.reply(REMOVE, { status: 200, body: { outcome: 'REMOVED' } });
    const { screen } = await onTheMembersScreen(MEMBERS.slice(1));
    await askToRemoveFirst(screen);

    await testing().fireEvent.press(confirmButton(screen));

    await testing().waitFor(() => {
      expect(screen.queryByText(FIRST.displayName)).toBeNull();
    });
    expect(api.to(REMOVE).map(({ path }) => path)).toEqual([`/v1/group/members/${FIRST.userId}`]);
  });

  test('GRP-01-AC28: the confirmation names the member and says they get no more alerts and need a new invitation to join again, in both languages; it says neither that their phone is signed out at once nor "deres"', () => {
    const nbConfirm = nbText('grp.members.confirmText');
    const enConfirm = String(lookup(en, 'grp.members.confirmText'));

    expect(nbConfirm).toContain('{{name}}');
    expect(enConfirm).toContain('{{name}}');
    expect(nbConfirm).toMatch(
      /(ikke|ingen) (flere|lenger|mer) varsl|ikke varsler lenger|slutter å få varsl/i,
    );
    expect(enConfirm).toMatch(
      /no more alerts|no longer (get|receive)s? alerts|not (get|receive) any more alerts|stops? (getting|receiving) alerts/i,
    );
    expect(nbConfirm).toMatch(/ny invitasjon/i);
    expect(enConfirm).toMatch(/new invitation/i);
    expect(nbConfirm).not.toMatch(/logges ut|logget ut|logge ut|utlogget/i);
    expect(enConfirm).not.toMatch(/signed out|signs? (them )?out|logged out|logs? (them )?out/i);
    expect(nbConfirm).not.toMatch(/\bderes\b/i);
  });

  test('GRP-01-AC28: once the list shows without them, the removal is announced, naming them', async () => {
    api.reply(REMOVE, { status: 200, body: { outcome: 'REMOVED' } });
    const { screen } = await onTheMembersScreen(MEMBERS.slice(1));
    await askToRemoveFirst(screen);

    await testing().fireEvent.press(confirmButton(screen));
    await testing().waitFor(() => {
      expect(screen.queryByText(FIRST.displayName)).toBeNull();
    });

    await testing().waitFor(() => {
      expect(announcements(screen).length).toBeGreaterThan(0);
    });
    expect(announcements(screen)).toContain(
      nbFilled('grp.members.removed', { name: FIRST.displayName }),
    );
    expect(screen.queryByText(FIRST.displayName)).toBeNull();
    expect(nbText('grp.members.removed')).toContain('{{name}}');
    expect(String(lookup(en, 'grp.members.removed'))).toContain('{{name}}');
  });
});

describe('GRP-01-AC28: a removal refused is said as a refusal (review loop 1, code-reviewer S4)', () => {
  test.each([
    ['403 NOT_THE_ADMIN', refusal(403, 'NOT_THE_ADMIN')],
    ['409 CANNOT_REMOVE_ADMIN', refusal(409, 'CANNOT_REMOVE_ADMIN')],
  ] satisfies [string, Reply][])(
    'GRP-01-AC28: a removal answered %s says the removal was refused, never that the server could not be reached; the member stays in the list',
    async (_what, reply) => {
      api.reply(REMOVE, reply);
      const { screen } = await onTheMembersScreen();
      await askToRemoveFirst(screen);
      const refused = lookup(nb, 'grp.members.refused');
      const unreachable = nbText('grp.member.unreachable');

      await testing().fireEvent.press(confirmButton(screen));
      await testing().waitFor(() => {
        expect(
          screen.queryByText(unreachable) ??
            (typeof refused === 'string' ? screen.queryByText(refused) : null),
        ).not.toBeNull();
      });

      expect(screen.queryByText(unreachable)).toBeNull();
      expect(screen.getByText(nbText('grp.members.refused'))).toBeTruthy();
      expect(screen.getByText(FIRST.displayName)).toBeTruthy();
      expect(api.to(REMOVE)).toHaveLength(1);
    },
  );

  test('GRP-01-AC28: the refusal’s words say the removal was refused, not that the server could not be reached, in both languages', () => {
    const nbRefused = nbText('grp.members.refused');
    const enRefused = String(lookup(en, 'grp.members.refused'));

    expect(nbRefused).not.toBe(nbText('grp.member.unreachable'));
    expect(nbRefused).not.toMatch(/kontakt med serveren/i);
    expect(enRefused).not.toMatch(/could not be reached/i);
    expect(enRefused.trim()).not.toBe('');
  });

  test('GRP-01-AC28: a removal answered 404 MEMBER_NOT_FOUND is a done removal: the list shows without them, nothing says it was refused or unreachable, and the removal is announced', async () => {
    api.reply(REMOVE, refusal(404, 'MEMBER_NOT_FOUND'));
    const { screen } = await onTheMembersScreen(MEMBERS.slice(1));
    await askToRemoveFirst(screen);

    await testing().fireEvent.press(confirmButton(screen));
    await testing().waitFor(() => {
      expect(screen.queryByText(FIRST.displayName)).toBeNull();
    });

    expect(screen.queryByText(nbText('grp.member.unreachable'))).toBeNull();
    const refused = lookup(nb, 'grp.members.refused');
    if (typeof refused === 'string') {
      expect(screen.queryByText(refused)).toBeNull();
    }
    await testing().waitFor(() => {
      expect(announcements(screen).length).toBeGreaterThan(0);
    });
    expect(announcements(screen)).toContain(
      nbFilled('grp.members.removed', { name: FIRST.displayName }),
    );
  });
});

describe('GRP-01-AC30: labels that stay, a waiting indicator, one "try again" (review loop 1)', () => {
  test('GRP-01-AC30: every text field has a visible label, a Text on screen with the field’s own label, which stays while text is typed: a placeholder is never the only label', async () => {
    const screen = await launch();
    await screen.findByLabelText(nbText('grp.join.codeLabel'));
    const fields = () => hostNodes(screen).filter((node) => node.type === 'TextInput');
    const labels = fields().map((field) => labelOf(field) ?? '');
    expect(labels).toEqual([nbText('grp.join.codeLabel'), nbText('grp.join.nameLabel')]);

    const visible = () => shownTexts(screen).map(({ text }) => text);
    for (const label of labels) {
      expect({ label, shown: visible().includes(label) }).toEqual({ label, shown: true });
    }
    await testing().fireEvent.changeText(screen.getByLabelText(labels[0] ?? ''), CODE);
    await testing().fireEvent.changeText(screen.getByLabelText(labels[1] ?? ''), NAME);
    for (const label of labels) {
      expect({ label, shownWhileTyped: visible().includes(label) }).toEqual({
        label,
        shownWhileTyped: true,
      });
    }
  });

  test('GRP-01-AC30: while the join is in flight, a waiting indicator with a translated screen-reader label shows; it goes with the answer', async () => {
    const answer = held();
    api.reply(JOIN, answer.reply);
    const screen = await launch();

    await fillAndSend(screen);
    await testing().waitFor(() => {
      expect(api.to(JOIN)).toHaveLength(1);
    });

    expectWaiting(screen, 'the join');
    answer.release(refusal(404, 'INVITATION_NOT_VALID'));
    await screen.findByText(nbText('grp.join.notValid'));
    expect(waitingIndicators(screen)).toEqual([]);
  });

  test('GRP-01-AC30: while the app asks who it is at start (GET /v1/me), a waiting indicator with a translated screen-reader label shows; it goes with the answer', async () => {
    await signedIn('MEMBER');
    const answer = held();
    api.reply(ME, answer.reply);

    const screen = await launch();
    await testing().waitFor(() => {
      expect(api.to(ME).length).toBeGreaterThanOrEqual(1);
    });

    expectWaiting(screen, 'the start');
    answer.release({
      status: 200,
      body: { userId: 'b2b2b2b2-0000-4000-8000-00000000000b', displayName: NAME, role: 'MEMBER' },
    });
    await screen.findByRole(HEADING, { name: nbText('grp.member.title') });
    expect(waitingIndicators(screen)).toEqual([]);
  });

  test('GRP-01-AC30: while an invitation is being made, a waiting indicator with a translated screen-reader label shows; it goes with the answer', async () => {
    const { screen } = await signedIn('ADMIN');
    const answer = held();
    api.reply(INVITE, answer.reply);
    const { fireEvent } = testing();
    await fireEvent.press(screen.getByRole('button', { name: nbText('grp.member.invite') }));

    await fireEvent.press(await screen.findByRole('button', { name: nbText('grp.invite.create') }));
    await testing().waitFor(() => {
      expect(api.to(INVITE)).toHaveLength(1);
    });

    expectWaiting(screen, 'the invitation');
    answer.release({
      status: 201,
      body: { invitationCode: CODE, expiresAt: '2026-10-27T12:00:00.000Z' },
    });
    await screen.findByRole('button', { name: nbText('grp.invite.share') });
    expect(waitingIndicators(screen)).toEqual([]);
  });

  test('GRP-01-AC30: while the member list is loading, a waiting indicator with a translated screen-reader label shows; it goes with the answer', async () => {
    const { screen, userId } = await signedIn('ADMIN');
    const answer = held();
    api.reply(LIST, answer.reply);

    await testing().fireEvent.press(
      screen.getByRole('button', { name: nbText('grp.member.members') }),
    );
    await testing().waitFor(() => {
      expect(api.to(LIST)).toHaveLength(1);
    });

    expectWaiting(screen, 'the member list');
    answer.release({
      status: 200,
      body: { members: [{ userId, displayName: NAME, role: 'ADMIN' }, ...MEMBERS] },
    });
    await screen.findByText(THIRD.displayName);
    expect(waitingIndicators(screen)).toEqual([]);
  });

  test('GRP-01-AC30: while a removal is in flight, a waiting indicator with a translated screen-reader label shows; it goes with the answer', async () => {
    const answer = held();
    api.reply(REMOVE, answer.reply);
    const { screen } = await onTheMembersScreen(MEMBERS.slice(1));
    await askToRemoveFirst(screen);

    await testing().fireEvent.press(confirmButton(screen));
    await testing().waitFor(() => {
      expect(api.to(REMOVE)).toHaveLength(1);
    });

    expectWaiting(screen, 'the removal');
    answer.release({ status: 200, body: { outcome: 'REMOVED' } });
    await testing().waitFor(() => {
      expect(screen.queryByText(FIRST.displayName)).toBeNull();
    });
    await testing().waitFor(() => {
      expect(waitingIndicators(screen)).toEqual([]);
    });
  });

  test('GRP-01-AC30: every "try again" reads "Prøv igjen" in bokmål and "Try again" in English: each retry key, and no other wording for it anywhere in the screens’ text', () => {
    const retryKeys = grpKeys(nb).filter((key) =>
      /retry|tryAgain/i.test(key.split('.').at(-1) ?? ''),
    );

    expect(retryKeys).toEqual(expect.arrayContaining(['grp.join.retry', 'grp.member.retry']));
    for (const key of retryKeys) {
      expect({ key, nb: lookup(nb, key), en: lookup(en, key) }).toEqual({
        key,
        nb: 'Prøv igjen',
        en: 'Try again',
      });
    }
    expect(grpTexts(nb).filter((text) => /på nytt/i.test(text))).toEqual([]);
    expect(grpTexts(en).filter((text) => /once more/i.test(text))).toEqual([]);
  });

  test.each([
    ['the join that saved nothing', 'join'],
    ['the start that could not reach the server', 'start'],
    ['the member list that could not be loaded', 'list'],
  ] satisfies [string, 'join' | 'start' | 'list'][])(
    'GRP-01-AC30: on %s, every control that offers to try again is named "Prøv igjen"',
    async (_where, where) => {
      let screen: typeof ExpoRouterTesting.screen;
      if (where === 'join') {
        api.reply(JOIN, 'network failure');
        screen = await launch();
        await fillAndSend(screen);
        await screen.findByText(nbText('grp.join.notSaved'));
      } else if (where === 'start') {
        await signedIn('MEMBER');
        api.reply(ME, 'network failure');
        screen = await launch();
        await screen.findByText(nbText('grp.member.unreachable'));
      } else {
        ({ screen } = await signedIn('ADMIN'));
        api.reply(LIST, { status: 500, body: { code: 'INTERNAL_SERVER_ERROR', status: 500 } });
        await testing().fireEvent.press(
          screen.getByRole('button', { name: nbText('grp.member.members') }),
        );
        await screen.findByText(nbText('grp.member.unreachable'));
      }

      const named = screen
        .queryAllByRole('button')
        .map((button) => labelOf(button as unknown as HostNode) ?? '')
        .filter((label) => /prøv|try/i.test(label));
      expect(named.length).toBeGreaterThan(0);
      expect(named).toEqual(named.map(() => 'Prøv igjen'));
    },
  );
});

describe('GRP-01-AC31: the app checks the name with the contract’s rule before it sends (review loop 1)', () => {
  test.each([
    ['a right-to-left override in it', 'Test‮medlem'],
    ['an isolate around it', '⁨Testmedlem⁩'],
    ['a zero-width space alone', '​'],
    ['a zero-width no-break space in it', 'Test﻿medlem'],
    ['ZWNJ and ZWJ only', '‌‍'],
    ['a Hangul filler alone', 'ㅤ'],
  ])(
    'GRP-01-AC31: a name with %s is not sent: no join reaches the server, and the screen says plainly that the name cannot be used, never that the invitation does not work',
    async (_what, name) => {
      api.reply(JOIN, refusal(400, 'BAD_REQUEST'));
      const screen = await launch();
      const nameNotUsable = lookup(nb, 'grp.join.nameNotUsable');

      await fillAndSend(screen, { name });
      await testing().waitFor(() => {
        expect(
          screen.queryByText(nbText('grp.join.notValid')) ??
            (typeof nameNotUsable === 'string' ? screen.queryByText(nameNotUsable) : null),
        ).not.toBeNull();
      });

      expect(api.to(JOIN)).toEqual([]);
      expect(screen.queryByText(nbText('grp.join.notValid'))).toBeNull();
      expect(screen.getByText(nbText('grp.join.nameNotUsable'))).toBeTruthy();
      expect(screen.queryAllByRole(HEADING, { name: nbText('grp.member.title') })).toEqual([]);
    },
  );

  test.each([
    ['a Norwegian letter', 'Åse'],
    ['an apostrophe', "O'Brien"],
    ['a hyphen', 'Anne-Marit'],
    ['ZWNJ between two letters', 'Test‌medlem'],
    ['an emoji joined with ZWJ', 'Testmedlem \u{1F469}‍\u{1F4BB}'],
    ['a non-Latin script', 'Тестовый'],
  ])(
    'GRP-01-AC31: a name with %s, which the rule accepts, is sent as typed',
    async (_what, name) => {
      joined('MEMBER');
      const screen = await launch();

      await fillAndSend(screen, { name });

      await screen.findByRole(HEADING, { name: nbText('grp.member.title') });
      expect(
        api.to(JOIN).map(({ body }) => (body as { displayName?: unknown }).displayName),
      ).toEqual([name]);
    },
  );

  test('GRP-01-AC31: the words for a name that cannot be used are about the name, in both languages, and say nothing of the invitation or its code', () => {
    const nbWords = nbText('grp.join.nameNotUsable');
    const enWords = String(lookup(en, 'grp.join.nameNotUsable'));

    expect(nbWords).toMatch(/navn/i);
    expect(enWords).toMatch(/name/i);
    expect(nbWords).not.toMatch(/invitasjon|kode/i);
    expect(enWords).not.toMatch(/invitation|code/i);
  });
});

describe('GRP-01-AC27: a join sent again carries the join key of the first (review loop 1, test-auditor)', () => {
  test.each([
    ['500', { status: 500, body: { code: 'INTERNAL_SERVER_ERROR', status: 500 } }],
    ['a network failure', 'network failure'],
  ] satisfies [string, Reply][])(
    'GRP-01-AC27: after a join answered with %s, the join sent again from the join screen, after the app restarts and the code and name are typed again, carries the same join key as the first, the one kept in secure storage',
    async (_what, failure) => {
      api.reply(JOIN, failure);
      const first = await launch();
      await fillAndSend(first);
      await first.findByText(nbText('grp.join.notSaved'));

      // The person gives up, closes the app and opens it again: nothing kept
      // in memory survives; secure storage does.
      joined('MEMBER');
      const again = await launch();
      await fillAndSend(again);
      await again.findByRole(HEADING, { name: nbText('grp.member.title') });

      const keys = api.to(JOIN).map(({ body }) => (body as { joinKey?: unknown }).joinKey);
      expect(keys).toHaveLength(2);
      expect(keys[1]).toBe(keys[0]);
      expect(stored()).toContain(keys[0]);
    },
  );

  test.each([
    ['500', { status: 500, body: { code: 'INTERNAL_SERVER_ERROR', status: 500 } }],
    ['a network failure', 'network failure'],
  ] satisfies [string, Reply][])(
    'GRP-01-AC27: after a join answered with %s, the join button pressed again, not the retry, sends the same join key',
    async (_what, failure) => {
      api.reply(JOIN, failure);
      joined('MEMBER');
      const screen = await launch();
      await fillAndSend(screen);
      await screen.findByText(nbText('grp.join.notSaved'));

      await testing().fireEvent.press(
        screen.getByRole('button', { name: nbText('grp.join.submit') }),
      );
      await screen.findByRole(HEADING, { name: nbText('grp.member.title') });

      const keys = api.to(JOIN).map(({ body }) => (body as { joinKey?: unknown }).joinKey);
      expect(keys).toHaveLength(2);
      expect(keys[1]).toBe(keys[0]);
    },
  );
});

describe('GRP-01-AC29: the app waits 20 s for an answer, and no longer (review loop 1, test-auditor)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  /** Jest's fake timers, with promises left to run as they do. */
  const fakeTimers = () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  };

  /** Lets every promise that can settle settle, and React render what it set, with no time passing. */
  async function settle() {
    await testing().act(async () => {
      for (let turn = 0; turn < 50; turn += 1) {
        await Promise.resolve();
      }
    });
  }

  /** Moves the fake clock on, 10 ms at a time, until the app has sent a request to `route`; resolves to when it did. */
  async function sentAt(route: string): Promise<number> {
    for (let step = 0; step < 1_000 && api.to(route).length === 0; step += 1) {
      await testing().act(async () => {
        jest.advanceTimersByTime(10);
        await Promise.resolve();
      });
      await settle();
    }
    const [first, ...more] = api.to(route);
    expect(more).toEqual([]);
    if (first === undefined) {
      throw new Error(`the app sent nothing to ${route}`);
    }
    return first.at;
  }

  /** Moves the fake clock to exactly `ms` after `from`, and lets the app answer to it. */
  async function advanceTo(from: number, ms: number) {
    await testing().act(async () => {
      jest.advanceTimersByTime(from + ms - Date.now());
      await Promise.resolve();
    });
    await settle();
  }

  test('GRP-01-AC29 and AC27: a join the server never answers is given up 20 s after it was sent, and not before: at 19.9 s nothing is said yet; at 20 s the screen says nothing was saved and offers a retry; no credential is stored, and the member screen never shows', async () => {
    api.reply(JOIN, 'no answer');
    const screen = await launch();
    const { fireEvent } = testing();
    await fireEvent.changeText(await screen.findByLabelText(nbText('grp.join.codeLabel')), CODE);
    await fireEvent.changeText(screen.getByLabelText(nbText('grp.join.nameLabel')), NAME);
    fakeTimers();

    await fireEvent.press(screen.getByRole('button', { name: nbText('grp.join.submit') }));
    const sent = await sentAt(JOIN);
    await advanceTo(sent, 19_900);
    expect(screen.queryByText(nbText('grp.join.notSaved'))).toBeNull();
    await advanceTo(sent, 20_000);

    expect(screen.getByText(nbText('grp.join.notSaved'))).toBeTruthy();
    expect(screen.getByRole('button', { name: nbText('grp.join.retry') })).toBeTruthy();
    const { joinKey } = (api.to(JOIN)[0]?.body ?? {}) as { joinKey?: string };
    expect(stored().filter((value) => value !== joinKey)).toEqual([]);
    expect(screen.queryAllByRole(HEADING, { name: nbText('grp.member.title') })).toEqual([]);
  });

  test('GRP-01-AC29: GET /v1/me at start that the server never answers is given up 20 s after it was sent, and not before: then the server could not be reached, with a retry, and the credential is kept', async () => {
    const { credential } = await signedIn('MEMBER');
    api.reply(ME, 'no answer');
    fakeTimers();

    const screen = await launch();
    const sent = await sentAt(ME);
    await advanceTo(sent, 19_900);
    expect(screen.queryByText(nbText('grp.member.unreachable'))).toBeNull();
    await advanceTo(sent, 20_000);

    expect(screen.getByText(nbText('grp.member.unreachable'))).toBeTruthy();
    expect(screen.getByRole('button', { name: nbText('grp.member.retry') })).toBeTruthy();
    expect(stored()).toContain(credential);
  });
});

// ---------------------------------------------------------------------------
// Review loop 2 (2026-10-20): from the delta reviews of 3fac8fb. The
// a11y-i18n reviewer's S1 (the code's label and its announcement say what the
// characters are before reading them), S2 and S3 (the waiting indicator where
// the admin acted, and an accessibility element), and code-reviewer's (any
// other 4xx on a removal is a refusal).
// ---------------------------------------------------------------------------

/** `text` as a regular expression that matches exactly that text. */
const asPattern = (text: string): string => text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/** How the code's label and its announcement begin (AC28, review loop 2): the code field's own name and a colon. */
const codeLabelStart = (): string => `${nbText('grp.join.codeLabel')}:`;

/**
 * The code's label and its announcement as a whole (AC28, review loop 2): the
 * code field's own name, a colon, then the code spelled as SPELLED reads it,
 * and nothing after. For the synthetic code: "Invitasjonskode: K 7 Q 2 M,
 * 9 T R V X, 4 H N P A, 6 2 W Z E". Anchored at both ends, as the L7 flow's
 * pattern is a whole-text match, so this and that flow hold the same label.
 */
const labelledCode = (): RegExp =>
  new RegExp(`^${asPattern(nbText('grp.join.codeLabel'))}:\\s*${SPELLED.source}$`);

/**
 * A removal answered with a 4xx that is neither a 401 nor a done removal: a
 * 404 without MEMBER_NOT_FOUND among them. Kept out of the test.each call, as
 * a table holding a bracket is (HK-05's test counter).
 */
const OTHER_REFUSALS: [string, Reply][] = [
  ['404 with no body, so no code', { status: 404 }],
  ['404 with a code that is not MEMBER_NOT_FOUND', refusal(404, 'NOT_FOUND')],
  ['400 BAD_REQUEST', refusal(400, 'BAD_REQUEST')],
  ['422 with a code the app does not know', refusal(422, 'UNPROCESSABLE_CONTENT')],
];

/** The lowest element that holds both `a` and `b`, or null. */
function lowestHolding(a: HostNode, b: HostNode): HostNode | null {
  const aboveA = new Set<HostNode>();
  for (let up = a.parent; up !== null; up = up.parent) {
    aboveA.add(up);
  }
  for (let up = b.parent; up !== null; up = up.parent) {
    if (aboveA.has(up)) {
      return up;
    }
  }
  return null;
}

/** The Text on screen, inside no other, whose whole text is `text`; it must be there. */
function shownTextNode(screen: typeof ExpoRouterTesting.screen, text: string): HostNode {
  const found = shownTexts(screen).find((shown) => shown.text === text);
  if (found === undefined) {
    throw new Error(`no Text on screen reads ${JSON.stringify(text)}`);
  }
  return found.node;
}

/** Each request a screen waits on (AC30). */
type InFlight = 'join' | 'start' | 'invitation' | 'list' | 'removal';

/**
 * The app with `what` sent and its answer held, so the screen is looked at
 * while the request is in flight. Each as the review-loop-1 tests above set
 * it up. A test that lets the answer go passes the held reply in; the others
 * leave it held.
 */
async function whileInFlight(
  what: InFlight,
  answer: ReturnType<typeof held> = held(),
): Promise<typeof ExpoRouterTesting.screen> {
  if (what === 'join') {
    api.reply(JOIN, answer.reply);
    const screen = await launch();
    await fillAndSend(screen);
    await testing().waitFor(() => {
      expect(api.to(JOIN)).toHaveLength(1);
    });
    return screen;
  }
  if (what === 'start') {
    await signedIn('MEMBER');
    const before = api.to(ME).length;
    api.reply(ME, answer.reply);
    const screen = await launch();
    await testing().waitFor(() => {
      expect(api.to(ME).length).toBeGreaterThan(before);
    });
    return screen;
  }
  if (what === 'invitation') {
    const { screen } = await signedIn('ADMIN');
    api.reply(INVITE, answer.reply);
    const { fireEvent } = testing();
    await fireEvent.press(screen.getByRole('button', { name: nbText('grp.member.invite') }));
    await fireEvent.press(await screen.findByRole('button', { name: nbText('grp.invite.create') }));
    await testing().waitFor(() => {
      expect(api.to(INVITE)).toHaveLength(1);
    });
    return screen;
  }
  if (what === 'list') {
    const { screen } = await signedIn('ADMIN');
    api.reply(LIST, answer.reply);
    await testing().fireEvent.press(
      screen.getByRole('button', { name: nbText('grp.member.members') }),
    );
    await testing().waitFor(() => {
      expect(api.to(LIST)).toHaveLength(1);
    });
    return screen;
  }
  api.reply(REMOVE, answer.reply);
  const { screen } = await onTheMembersScreen(MEMBERS.slice(1));
  await askToRemoveFirst(screen);
  await testing().fireEvent.press(confirmButton(screen));
  await testing().waitFor(() => {
    expect(api.to(REMOVE)).toHaveLength(1);
  });
  return screen;
}

describe('GRP-01-AC28: the code is read with its name first (review loop 2, a11y-i18n-reviewer S1)', () => {
  test('GRP-01-AC28: the code’s screen-reader label begins with the code field’s own name, grp.join.codeLabel, and a colon, then spells the code, and holds nothing more: "Invitasjonskode: K 7 Q 2 M, 9 T R V X, …"', async () => {
    const screen = await invitationShown();

    const spelled = hostNodes(screen)
      .map((node) => labelOf(node))
      .filter((label): label is string => label !== null && SPELLED.test(label));

    expect(spelled).toHaveLength(1);
    expect({ label: spelled[0], start: spelled[0]?.startsWith(codeLabelStart()) }).toEqual({
      label: spelled[0],
      start: true,
    });
    expect(spelled).toEqual([expect.stringMatching(labelledCode())]);
  });

  test('GRP-01-AC28: every announcement that spells the code begins the same way, with the code field’s own name and a colon, so the characters are never read without saying what they are', async () => {
    const screen = await invitationShown();

    const spelled = announcements(screen).filter((text) => SPELLED.test(text));

    expect(spelled.length).toBeGreaterThan(0);
    for (const text of spelled) {
      expect({ text, start: text.startsWith(codeLabelStart()) }).toEqual({ text, start: true });
      expect(text).toMatch(labelledCode());
    }
  });
});

describe('GRP-01-AC28: any other 4xx on a removal is a refusal (review loop 2, code-reviewer)', () => {
  test.each(OTHER_REFUSALS)(
    'GRP-01-AC28: a removal answered %s says the removal was refused, never that the server could not be reached and never that it was done; the member stays in the list',
    async (_what, reply) => {
      api.reply(REMOVE, reply);
      const { screen } = await onTheMembersScreen();
      await askToRemoveFirst(screen);
      const refused = nbText('grp.members.refused');
      const unreachable = nbText('grp.member.unreachable');
      const removed = nbFilled('grp.members.removed', { name: FIRST.displayName });

      await testing().fireEvent.press(confirmButton(screen));
      await testing().waitFor(() => {
        expect(
          screen.queryByText(unreachable) ??
            screen.queryByText(refused) ??
            screen.queryByText(removed),
        ).not.toBeNull();
      });

      expect(screen.queryByText(unreachable)).toBeNull();
      expect(screen.queryByText(removed)).toBeNull();
      expect(announcements(screen)).not.toContain(removed);
      expect(screen.getByText(refused)).toBeTruthy();
      expect(screen.getByText(FIRST.displayName)).toBeTruthy();
      expect(api.to(REMOVE)).toHaveLength(1);
    },
  );
});

describe('GRP-01-AC30: the waiting indicator where the admin acted, an accessibility element (review loop 2, a11y-i18n-reviewer S2, S3)', () => {
  test('GRP-01-AC30: while a removal is in flight, a waiting indicator shows inside the confirmation, next to its buttons: in the element that holds the confirmation’s text and its confirm button, after the member’s name and before the next member’s', async () => {
    const screen = await whileInFlight('removal');
    const confirmText = shownTextNode(
      screen,
      nbFilled('grp.members.confirmText', { name: FIRST.displayName }),
    );
    const confirm = confirmButton(screen) as unknown as HostNode;

    const confirmation = lowestHolding(confirmText, confirm);
    const inside = waitingIndicators(screen).filter(
      (indicator) => confirmation !== null && holds(confirmation, indicator),
    );

    expect(confirmation).not.toBeNull();
    expect(inside).toHaveLength(1);
    const order = hostNodes(screen);
    const at = {
      member: order.indexOf(shownTextNode(screen, FIRST.displayName)),
      indicator: inside[0] === undefined ? -1 : order.indexOf(inside[0]),
      next: order.indexOf(shownTextNode(screen, SECOND.displayName)),
    };
    expect(at.member).toBeGreaterThanOrEqual(0);
    expect(at.indicator).toBeGreaterThan(at.member);
    expect(at.indicator).toBeLessThan(at.next);
  });

  test.each([
    ['the join', 'join'],
    ['the start, GET /v1/me', 'start'],
    ['an invitation', 'invitation'],
    ['the member list', 'list'],
    ['a removal', 'removal'],
  ] satisfies [string, InFlight][])(
    'GRP-01-AC30: while %s is in flight, every waiting indicator is an accessibility element, accessible set, carrying its translated screen-reader label',
    async (what, inFlight) => {
      const screen = await whileInFlight(inFlight);

      const indicators = waitingIndicators(screen);

      expect({ what, indicators: indicators.length > 0 }).toEqual({ what, indicators: true });
      const texts = grpTexts(nb);
      for (const indicator of indicators) {
        const label = labelOf(indicator);
        expect({
          what,
          accessible: indicator.props['accessible'],
          label,
          translated: label !== null && texts.includes(label),
        }).toEqual({ what, accessible: true, label, translated: true });
      }
    },
  );
});

describe('GRP-01-AC30: the confirmation holds while a removal is in flight (review loop 2, a11y-i18n-reviewer)', () => {
  // The waiting indicator inside the confirmation (the test above) shows the
  // admin the removal is on its way only while the confirmation stays. If
  // cancel worked mid-flight, the confirmation and its indicator would go
  // while the DELETE is still out; if confirm did, a second DELETE would go.
  // So both buttons stay on screen, disabled, until the answer comes.

  /** Lets every promise that can settle settle, and React render what it set. */
  async function settle() {
    await testing().act(async () => {
      for (let turn = 0; turn < 50; turn += 1) {
        await Promise.resolve();
      }
    });
  }

  /** What a button's accessibility state says of `disabled`, or "not on screen". */
  const disabledOf = (button: unknown): unknown =>
    button === null
      ? 'not on screen'
      : ((button as HostNode).props['accessibilityState'] as { disabled?: unknown } | undefined)
          ?.disabled;

  /** The confirm and cancel buttons as a screen reader finds them now: each disabled, or not. */
  const buttonsNow = (screen: typeof ExpoRouterTesting.screen) => ({
    confirm: disabledOf(
      screen.queryByRole('button', {
        name: nbFilled('grp.members.confirm', { name: FIRST.displayName }),
      }),
    ),
    cancel: disabledOf(screen.queryByRole('button', { name: nbText('grp.members.cancel') })),
  });

  /** The waiting indicators inside the confirmation now: none when it is gone. */
  function indicatorsInConfirmation(screen: typeof ExpoRouterTesting.screen): HostNode[] {
    const text = shownTexts(screen).find(
      (shown) => shown.text === nbFilled('grp.members.confirmText', { name: FIRST.displayName }),
    );
    const confirm = screen.queryByRole('button', {
      name: nbFilled('grp.members.confirm', { name: FIRST.displayName }),
    }) as unknown as HostNode | null;
    const confirmation =
      text === undefined || confirm === null ? null : lowestHolding(text.node, confirm);
    return confirmation === null
      ? []
      : waitingIndicators(screen).filter((indicator) => holds(confirmation, indicator));
  }

  test('GRP-01-AC30: while a removal is in flight, its confirm and cancel buttons stay on screen, each disabled (accessibilityState.disabled true); pressing confirm again sends no second DELETE, and pressing cancel takes away neither the confirmation nor its waiting indicator; once the answer comes, the removal completes', async () => {
    const answer = held();
    const screen = await whileInFlight('removal', answer);
    const { fireEvent } = testing();
    const confirmText = nbFilled('grp.members.confirmText', { name: FIRST.displayName });

    expect(buttonsNow(screen)).toEqual({ confirm: true, cancel: true });
    expect(indicatorsInConfirmation(screen)).toHaveLength(1);

    await fireEvent.press(confirmButton(screen));
    await settle();
    expect(api.to(REMOVE)).toHaveLength(1);

    await fireEvent.press(screen.getByRole('button', { name: nbText('grp.members.cancel') }));
    await settle();
    expect({
      confirmation: screen.queryByText(confirmText) !== null,
      indicators: indicatorsInConfirmation(screen).length,
      buttons: buttonsNow(screen),
      removals: api.to(REMOVE).length,
    }).toEqual({
      confirmation: true,
      indicators: 1,
      buttons: { confirm: true, cancel: true },
      removals: 1,
    });

    answer.release({ status: 200, body: { outcome: 'REMOVED' } });
    await testing().waitFor(() => {
      expect(screen.queryByText(FIRST.displayName)).toBeNull();
    });
    await testing().waitFor(() => {
      expect(waitingIndicators(screen)).toEqual([]);
    });
    await testing().waitFor(() => {
      expect(announcements(screen)).toContain(
        nbFilled('grp.members.removed', { name: FIRST.displayName }),
      );
    });
    expect(screen.queryByText(confirmText)).toBeNull();
    expect(screen.queryByText(nbText('grp.member.unreachable'))).toBeNull();
    expect(screen.queryByText(nbText('grp.members.refused'))).toBeNull();
    expect(screen.getByText(SECOND.displayName)).toBeTruthy();
    expect(api.to(REMOVE).map(({ path }) => path)).toEqual([`/v1/group/members/${FIRST.userId}`]);
  });
});
