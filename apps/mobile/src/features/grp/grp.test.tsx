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

/** A request the app made, as the fake API read it. */
interface Sent {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

/** How the fake API answers one request: a status and a body, or a network failure. */
type Reply = { status: number; body?: unknown } | 'network failure';

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
  });
  const route = routeOf(request.method, url.pathname);
  const queue = api.queued.get(route) ?? [];
  const reply = queue.shift() ?? api.defaults.get(route);
  if (reply === undefined) {
    throw new Error(`the fake API has no answer for ${route}`);
  }
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

    expect(await screen.findByText(new RegExp(CODE.replace(/-/g, '[- ]?')))).toBeTruthy();
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
    await fireEvent.press(screen.getByRole('button', { name: nbText('grp.members.confirm') }));

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
