// CALL-02-AC1, AC2, AC7 and AC13 (L5): `Screen` is what puts the 112 button
// on every screen, and nothing can draw over it.
//
//   - AC1, the route pin: every route file under src/app/, listed from the
//     file system when this runs, a route added later included, is rendered
//     at its own path through Expo Router's testing library, inside the real
//     root layout (src/app/_layout.tsx, not a stand-in), with no credential
//     stored and with one stored and GET /v1/me held. Each time the tree holds
//     exactly one `Screen`, found by its component type, with the 112 button
//     inside it; and every host element is inside that `Screen`, or above it
//     (the wrappers Expo Router and the layout put around every screen), or is
//     on the allow-list below, with its reason. *Why L5:* whether a route
//     draws `Screen` is a property of what it renders, through every
//     component between the route file and the screen, which a render can
//     follow and a search of the source cannot (CALL-02.md, AC1).
//   - AC2: `Screen`, with each of its props set and unset, holds the 112
//     button; and a child of it positioned absolutely at full size, with a
//     high zIndex and elevation, lies inside one clipping container (its
//     ScrollView, never overflow: 'visible', or a View with overflow:
//     'hidden'), which the 112 button is not inside, and the bar and that
//     container are siblings: so nothing a screen draws can cover the bar.
//   - AC7: the root layout renders React Native's StatusBar with
//     barStyle="light-content", and the waiting indicator's colour is the
//     palette's.
//   - AC13: a route that throws while rendering, and the layout's own
//     GroupSessionProvider throwing, each still show 112, on `Screen`, through
//     the ErrorBoundary src/app/_layout.tsx exports; the fallback says
//     something went wrong, offers "Prøv igjen", and never shows the error's
//     message or the number in it (GRP-02-AC9's rule).
//
// This file sits in src/shared/ui/, an owned and safety-reviewed path
// (CALL-02-AC10), so loosening it needs the owner and safety-reviewer.
//
// `Screen` is read from src/shared/ui/index.ts, the kit's public face, in the
// same module registry the app is rendered from, so its type is the one the
// app draws. The fakes are the test kit's, as in features/call/call.test.tsx:
// secure storage, the phone module (mocked by its resolved path and virtual,
// so this file loads before it exists), the API behind fetch, the language.
//
// Test data is synthetic (RG-07): the number in the thrown errors is the test
// kit's fixture (HK-07).
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import type * as ExpoRouterTesting from 'expo-router/testing-library';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ComponentProps, ComponentType, ReactElement, ReactNode } from 'react';

import { fakeApi, parsedOrText } from '../../../../../packages/test-kit/src/fake-api.ts';
import { fakePhone } from '../../../../../packages/test-kit/src/fake-phone.ts';
import { fakeSecureStore } from '../../../../../packages/test-kit/src/fake-secure-store.ts';
import { MOBILE } from '../../../../../packages/test-kit/src/fixtures/phone-numbers.ts';
import {
  ancestorsOf,
  fiberWithin,
  fibersUnder,
  flattenStyle,
  holds,
  labelOf,
  rendersComponent,
  rootFiberOf,
  roleOf,
  shownTexts,
  type FiberLike,
  type HostNode,
} from '../../../../../packages/test-kit/src/rendered-tree.ts';
import type * as Ui from './index';

// ---------------------------------------------------------------------------
// The world outside the app.
// ---------------------------------------------------------------------------

const mockJournal: string[] = [];
const mockStore = fakeSecureStore({ journal: mockJournal });
const mockPhone = fakePhone({ journal: mockJournal });
const api = fakeApi();
/** What a faked module throws, when it is told to (AC13). */
const mockThrowing = { on: false };

jest.mock('expo-secure-store', () => mockStore.module, { virtual: true });
jest.mock('../../features/call/phone.ts', () => mockPhone.module, { virtual: true });
jest.mock(
  'expo-crypto',
  () => ({
    getRandomBytes: jest.fn((size: number) => new Uint8Array(size)),
    getRandomBytesAsync: jest.fn((size: number) => Promise.resolve(new Uint8Array(size))),
    randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000000'),
  }),
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

jest.setTimeout(90_000);

const unanswered: string[] = [];

async function fakeFetch(input: unknown, init?: unknown): Promise<Response> {
  const request = new Request(input as RequestInfo, init as RequestInit | undefined);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  let reply;
  try {
    reply = api.answer({
      method: request.method,
      path: new URL(request.url).pathname,
      headers,
      body: parsedOrText(await request.text()),
      at: Date.now(),
    });
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
// The words, in full (CALL-02.md's translations table).
// ---------------------------------------------------------------------------

// RG-03 (review loop 1; the owner's answer, D-141's fourth amendment): the 112
// button's label was "Ring 112, nødnummeret". The owner chose to spell the
// number for a screen reader; its visible text, "112", is unchanged. Every
// test here that finds the 112 button by its label now holds the new wording.
const EMERGENCY_LABEL = 'Ring 1 1 2, nødnummeret';
const ERROR_LINE = 'Noe gikk galt på denne skjermen.';
const RETRY = 'Prøv igjen';
const JOIN_TITLE = 'Bli med i gruppen';

// ---------------------------------------------------------------------------
// The app.
// ---------------------------------------------------------------------------

type ReactNative = typeof import('react-native');
type React = typeof import('react');
type Screen = typeof ExpoRouterTesting.screen;
/** Screen as shared/ui/index.ts types it: its props are read from here (ScreenProps). */
type ScreenComponent = typeof Ui.Screen;

/**
 * What shared/ui/index.ts must export, as this file handles it at run time:
 * the component `Screen` (CALL-02, approach 1). Declared here rather than read
 * from the module, so every value the file handles has a type before the
 * module exists, and the file stays red only on the missing module. Screen's
 * props are still the module's own (ScreenComponent).
 */
interface UiExports {
  Screen: ComponentType<{ children?: ReactNode }>;
}

interface Launched {
  testing: typeof ExpoRouterTesting;
  native: ReactNative;
  react: React;
}

let launched: Launched | undefined;

/** Loads the app afresh in a new registry, on Android, and runs `before` in it, before anything renders. */
async function fresh(before: () => void = () => undefined): Promise<Launched> {
  if (launched !== undefined) {
    await launched.testing.cleanup();
  }
  jest.resetModules();
  before();
  const native: ReactNative = jest.requireActual('react-native');
  (native.Platform as { OS: string }).OS = 'android';
  const react: React = jest.requireActual('react');
  const testing: typeof ExpoRouterTesting = jest.requireActual('expo-router/testing-library');
  launched = { testing, native, react };
  return launched;
}

/** Renders the route folder at `url`, through the real root layout. */
async function launch(url = '/', before?: () => void): Promise<Screen> {
  const { testing } = await fresh(before);
  await testing.renderRouter('src/app', { initialUrl: url });
  return testing.screen;
}

function app(): Launched {
  if (launched === undefined) {
    throw new Error('the app was never launched');
  }
  return launched;
}

/** The kit's `Screen`, from the registry the app was rendered from. */
function screenComponent(): UiExports['Screen'] {
  return jest.requireActual<UiExports>('./index').Screen;
}

const hostNodes = (screen: Screen): HostNode[] => screen.container.queryAll(() => true);
const texts = (screen: Screen): string[] => shownTexts(hostNodes(screen)).map(({ text }) => text);
const fiberOf = (node: HostNode): FiberLike | null =>
  (node as unknown as { unstable_fiber: FiberLike | null }).unstable_fiber;

/** Every fiber of the rendered tree, from its root. */
function allFibers(screen: Screen): FiberLike[] {
  for (const node of hostNodes(screen)) {
    const fiber = fiberOf(node);
    if (fiber !== null) {
      return fibersUnder(rootFiberOf(fiber));
    }
  }
  return [];
}

const emergencyButtons = (screen: Screen): HostNode[] =>
  hostNodes(screen).filter(
    (node) => labelOf(node) === EMERGENCY_LABEL && roleOf(node) === 'button',
  );

async function settle(): Promise<void> {
  await app().testing.act(async () => {
    for (let turn = 0; turn < 50; turn += 1) {
      await Promise.resolve();
    }
  });
}

/** Why an element would hide or cover what it holds (CALL-02-AC2's ancestor checks). */
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
  if (node.props['importantForAccessibility'] === 'no-hide-descendants') {
    reasons.push('importantForAccessibility="no-hide-descendants"');
  }
  return reasons;
}

const ME = 'GET /v1/me';
/** GET /v1/me's answer for a member, every value synthetic, as emergency.test.tsx's. */
const ME_ANSWER = {
  status: 200,
  body: {
    userId: 'b2b2b2b2-0000-4000-8000-00000000000b',
    displayName: 'Testmedlem ØKVAR',
    role: 'MEMBER',
  },
};
const CREDENTIAL_KEY = 'deviceCredential';
const CREDENTIAL = 'C'.repeat(20) + 'd'.repeat(13) + '-_0123456789';

beforeEach(() => {
  mockStore.reset();
  mockPhone.reset();
  mockPhone.permission = 'granted';
  api.reset();
  mockJournal.length = 0;
  unanswered.length = 0;
  mockThrowing.on = false;
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
// AC1: every route, through the real root layout, draws one Screen.
// ---------------------------------------------------------------------------

/** Where Expo Router finds the routes. */
const APP_DIR = path.join(__dirname, '..', '..', 'app');

/**
 * Files under src/app/ that Expo Router does not render as a screen, each with
 * the reason it is left out. Nothing else is: a route added later is listed
 * and rendered without a change here.
 */
const NOT_A_SCREEN: [RegExp, string][] = [
  [
    /\.(test|spec)\.tsx?$/,
    'a test file: tests stay out of src/app/ (src/app.test.tsx says why), and are not the app',
  ],
  [
    /(^|\/)_layout\.tsx?$/,
    'a layout: drawn around the routes, never as a screen; the root one is rendered around every route below',
  ],
  [/(^|\/)\+html\.tsx?$/, 'the web document, for a web build only'],
  [/(^|\/)\+native-intent\.tsx?$/, 'rewrites an incoming link, and draws nothing'],
  [/\+api\.tsx?$/, 'an API route, run on a server, never drawn'],
  [/(^|\/)\+middleware\.tsx?$/, 'server middleware, never drawn'],
  [/\.web\.tsx?$/, 'a route’s web variant: the app ships on Android'],
];

/** Every .ts and .tsx file under src/app/, at any depth, relative to it, with / between folders. */
function filesUnder(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    const relative = prefix === '' ? name : `${prefix}/${name}`;
    if (statSync(full).isDirectory()) {
      return filesUnder(full, relative);
    }
    return /\.tsx?$/.test(name) ? [relative] : [];
  });
}

/** The route files, listed when this runs. */
const ROUTES = filesUnder(APP_DIR).filter(
  (file) => !NOT_A_SCREEN.some(([pattern]) => pattern.test(file)),
);

/** A route file's own path, a dynamic segment given a synthetic value, a group left out. */
function urlOf(file: string): string {
  const segments = file
    .replace(/\.tsx?$/, '')
    .split('/')
    .filter((segment) => !/^\(.*\)$/.test(segment) && segment !== 'index')
    .map((segment) => {
      if (/^\[\.\.\..+\]$/.test(segment)) {
        return 'synthetic-a/synthetic-b';
      }
      if (/^\[.+\]$/.test(segment)) {
        return 'synthetic-value';
      }
      if (segment === '+not-found') {
        return 'synthetic-no-such-route';
      }
      return segment;
    });
  return `/${segments.join('/')}`;
}

/** The two ways each route is rendered. */
const CONDITIONS: [string, () => void][] = [
  ['with no credential stored', () => undefined],
  [
    'with a credential stored and GET /v1/me held unanswered',
    () => {
      mockStore.items.set(CREDENTIAL_KEY, CREDENTIAL);
      api.reply(ME, api.held().reply);
    },
  ],
];

/** What is wrong with the tree on screen, as CALL-02-AC1 reads it: nothing, or each problem. */
function routeProblems(screen: Screen, Screen: unknown, StatusBar: unknown): string[] {
  const fibers = allFibers(screen);
  const screens = fibers.filter((fiber) => rendersComponent(fiber, Screen));
  const problems: string[] = [];
  if (screens.length !== 1) {
    problems.push(`${String(screens.length)} Screens, not one`);
  }
  const [only] = screens;
  if (only === undefined) {
    return problems;
  }
  const emergency = emergencyButtons(screen);
  if (emergency.length !== 1) {
    problems.push(`${String(emergency.length)} 112 buttons, not one`);
  }
  for (const button of emergency) {
    const fiber = fiberOf(button);
    if (fiber === null || !fiberWithin(fiber, only)) {
      problems.push('the 112 button is not inside the Screen');
    }
  }
  for (const node of hostNodes(screen)) {
    const fiber = fiberOf(node);
    if (fiber === null) {
      continue;
    }
    const inside = fiberWithin(fiber, only);
    const above = fiberWithin(only, fiber);
    // Allowed: the root layout's StatusBar, which sets the system bar's
    // colours and draws nothing of the app's (approach 5).
    const statusBar = fibers.some(
      (each) => rendersComponent(each, StatusBar) && fiberWithin(fiber, each),
    );
    if (!inside && !above && !statusBar) {
      problems.push(`a ${node.type} drawn outside the Screen`);
    }
  }
  return problems;
}

describe('CALL-02-AC1: every route under src/app/ renders through Screen, inside the real root layout', () => {
  test('CALL-02-AC1: the route files are listed from src/app/ when this runs, and there is at least one, src/app/index.tsx among them', () => {
    expect(ROUTES.length).toBeGreaterThan(0);
    expect(ROUTES).toContain('index.tsx');
    expect(ROUTES.map(urlOf)).toContain('/');
  });

  test('CALL-02-AC1: src/app/_layout.tsx, the root layout every route is rendered inside, exports an ErrorBoundary', () => {
    const layout: Record<string, unknown> = jest.requireActual('../../app/_layout');

    expect(typeof layout['default']).toBe('function');
    expect(typeof layout['ErrorBoundary']).toBe('function');
  });

  test.each(CONDITIONS)(
    'CALL-02-AC1: %s, each route, at its own path, holds exactly one Screen, found by its type, with the one 112 button inside it, and nothing drawn outside it but what holds it and the root layout’s StatusBar',
    async (_condition, given) => {
      const found: { route: string; problems: string[] }[] = [];
      for (const route of ROUTES) {
        mockStore.reset();
        api.reset();
        given();
        const screen = await launch(urlOf(route));
        await settle();
        const Screen = screenComponent();
        found.push({
          route,
          problems: routeProblems(screen, Screen, app().native.StatusBar),
        });
      }

      expect(found.length).toBeGreaterThan(0);
      expect(found).toEqual(ROUTES.map((route) => ({ route, problems: [] })));
    },
  );
});

// ---------------------------------------------------------------------------
// AC2: Screen always holds 112, and clips what it is given below the bar.
// ---------------------------------------------------------------------------

/** Screen's props. */
type ScreenProps = ComponentProps<ScreenComponent>;

/**
 * A value to render each of Screen's props with, besides its children: the
 * compiler requires an entry for every one, so a prop added to Screen fails
 * the type check here until a test sets it and the 112 checks below run with
 * it set and unset. None today.
 */
const SCREEN_PROP_SAMPLES: {
  [K in Exclude<keyof ScreenProps, 'children'>]-?: readonly Exclude<ScreenProps[K], undefined>[];
} = {};

/** Every way Screen is rendered below: no props; each prop alone, at each sample; all of them at once. */
const SCREEN_PROPS: [string, Record<string, unknown>][] = [
  ['no props', {}],
  ...Object.entries(SCREEN_PROP_SAMPLES).flatMap(([name, samples]) =>
    (samples as readonly unknown[]).map((value): [string, Record<string, unknown>] => [
      `${name}=${JSON.stringify(value)}`,
      { [name]: value },
    ]),
  ),
  [
    'every prop set',
    Object.fromEntries(
      Object.entries(SCREEN_PROP_SAMPLES).map(([name, samples]) => [
        name,
        (samples as readonly unknown[])[0],
      ]),
    ),
  ],
];

/** A child that would cover the whole screen, the bar included, if nothing clipped it. */
const COVER_ID = 'covers-the-whole-screen';

/** Renders Screen alone, as a route draws it, with the translations and the safe area the app gives it. */
async function renderScreen(props: Record<string, unknown>, children?: ReactNode): Promise<Screen> {
  const { react } = await fresh();
  const Screen = screenComponent();
  const { I18nextProvider }: typeof import('react-i18next') = jest.requireActual('react-i18next');
  const { SafeAreaProvider }: typeof import('react-native-safe-area-context') = jest.requireActual(
    'react-native-safe-area-context',
  );
  const translations: { default: import('i18next').i18n } = jest.requireActual('../translations');
  const element: ReactElement = react.createElement(
    SafeAreaProvider,
    {
      initialMetrics: {
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      },
    },
    react.createElement(
      I18nextProvider,
      { i18n: translations.default },
      react.createElement(
        Screen as (props: Record<string, unknown>) => ReactElement,
        props,
        children,
      ),
    ),
  );
  const rntl: typeof import('@testing-library/react-native') = jest.requireActual(
    '@testing-library/react-native/pure',
  );
  await rntl.render(element);
  return rntl.screen;
}

/** The nearest element above `node` that clips what it holds: a ScrollView not set visible, or a View set hidden. */
function clippingContainer(node: HostNode): HostNode | undefined {
  return ancestorsOf(node).find((above) => {
    const overflow = flattenStyle(above.props['style'])['overflow'];
    return above.type.includes('ScrollView') ? overflow !== 'visible' : overflow === 'hidden';
  });
}

describe('CALL-02-AC2: Screen always holds the 112 button, and nothing it is given can cover it', () => {
  test.each(SCREEN_PROPS)(
    'CALL-02-AC2: Screen rendered with %s holds exactly one 112 button, and neither it nor anything above it hides it',
    async (_props, props) => {
      const screen = await renderScreen(props);

      const buttons = emergencyButtons(screen);
      expect(buttons).toHaveLength(1);
      const [button] = buttons;
      if (button === undefined) {
        return;
      }
      expect(
        [button, ...ancestorsOf(button)]
          .map((node) => ({ node: node.type, why: hiding(node) }))
          .filter(({ why }) => why.length > 0),
      ).toEqual([]);
    },
  );

  test.each(SCREEN_PROPS)(
    'CALL-02-AC2: Screen rendered with %s and given a child positioned absolutely at full size, with a high zIndex and elevation: the child lies inside a clipping container, the 112 button does not, and the bar and the container are siblings',
    async (_props, props) => {
      const { native } = await fresh();
      const cover = app().react.createElement(native.View, {
        nativeID: COVER_ID,
        style: {
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          zIndex: 10_000,
          elevation: 10_000,
        },
      });
      const screen = await renderScreen(props, cover);

      const child = hostNodes(screen).find((node) => node.props['nativeID'] === COVER_ID);
      const [button] = emergencyButtons(screen);
      expect(child).toBeDefined();
      expect(button).toBeDefined();
      if (child === undefined || button === undefined) {
        return;
      }
      const container = clippingContainer(child);
      expect(container).toBeDefined();
      if (container === undefined) {
        return;
      }
      expect(holds(container, button)).toBe(false);
      const bar = [button, ...ancestorsOf(button)].find(
        (node) => node.parent !== null && node.parent === container.parent,
      );
      expect(bar).toBeDefined();
      expect(bar).not.toBe(container);
    },
  );
});

// ---------------------------------------------------------------------------
// AC7: dark, from the root layout down.
// ---------------------------------------------------------------------------

/** Every string the palette module exports, at any depth: its colours. */
function paletteColours(): string[] {
  const palette: Record<string, unknown> = jest.requireActual('./palette');
  const out: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      out.push(value.toLowerCase());
    } else if (typeof value === 'object' && value !== null) {
      Object.values(value).forEach(walk);
    }
  };
  walk(palette);
  return out;
}

describe('CALL-02-AC7: every screen is dark', () => {
  test('CALL-02-AC7: the root layout renders React Native’s StatusBar with barStyle="light-content"', async () => {
    const screen = await launch('/');
    await screen.findByText(JOIN_TITLE);
    const { StatusBar } = app().native;

    const bars = allFibers(screen).filter((fiber) => rendersComponent(fiber, StatusBar));

    expect(bars.length).toBeGreaterThan(0);
    expect(
      bars.map((fiber) => (fiber.memoizedProps as { barStyle?: unknown } | null)?.barStyle),
    ).toContain('light-content');
  });

  test('CALL-02-AC7: the waiting indicator, shown while secure storage is read at start, takes its colour from the palette', async () => {
    mockStore.items.set(CREDENTIAL_KEY, CREDENTIAL);
    // Once the read is released below, the home screen asks GET /v1/me at once
    // (CALL-02, approach 2), so it gets an answer, as emergency.test.tsx's
    // brief start does, and the file's afterEach finds nothing unanswered.
    api.always(ME, ME_ANSWER);
    const release = mockStore.holdReads();
    const screen = await launch('/');
    await settle();

    const indicators = hostNodes(screen).filter(
      (node) =>
        node.type === 'ActivityIndicator' ||
        node.type === 'AndroidProgressBar' ||
        node.props['accessibilityRole'] === 'progressbar',
    );
    expect(indicators.length).toBeGreaterThan(0);
    const colours = paletteColours();
    for (const indicator of indicators) {
      const colour = indicator.props['color'];
      expect({
        colour,
        fromThePalette: typeof colour === 'string' && colours.includes(colour.toLowerCase()),
      }).toEqual({
        colour,
        fromThePalette: true,
      });
    }
    release();
  });
});

// ---------------------------------------------------------------------------
// AC13: a screen that crashes still shows 112.
// ---------------------------------------------------------------------------

/** A synthetic #1's number, in the message of each thrown error: it must never reach the screen. */
const THROWN = `synthetic render failure for ${MOBILE}`;

const HOME_SCREEN = '../../features/grp/home-screen';
const SESSION = '../../features/grp/session';

describe('CALL-02-AC13: a screen that crashes still shows 112', () => {
  afterEach(() => {
    jest.dontMock(HOME_SCREEN);
    jest.dontMock(SESSION);
  });

  /** Fakes the module the index route renders: it throws while `mockThrowing.on`, and renders the real screen otherwise. */
  const throwingHomeScreen = () => {
    jest.doMock(HOME_SCREEN, () => {
      const actual: { HomeScreen: () => ReactElement | null } = jest.requireActual(HOME_SCREEN);
      const react: React = jest.requireActual('react');
      return {
        ...actual,
        HomeScreen: () => {
          if (mockThrowing.on) {
            throw new Error(THROWN);
          }
          return react.createElement(actual.HomeScreen);
        },
      };
    });
  };

  /** Fakes the layout's GroupSessionProvider: it throws while rendering. */
  const throwingSession = () => {
    jest.doMock(SESSION, () => {
      const actual: Record<string, unknown> = jest.requireActual(SESSION);
      return {
        ...actual,
        GroupSessionProvider: () => {
          throw new Error(THROWN);
        },
      };
    });
  };

  /** What CALL-02-AC13 holds of the fallback, whichever throw brought it. */
  async function expectFallback(screen: Screen): Promise<void> {
    expect(await screen.findByText(ERROR_LINE)).toBeTruthy();
    const buttons = emergencyButtons(screen);
    expect(buttons).toHaveLength(1);
    const [button] = buttons;
    if (button === undefined) {
      return;
    }
    expect(
      [button, ...ancestorsOf(button)]
        .map((node) => ({ node: node.type, why: hiding(node) }))
        .filter(({ why }) => why.length > 0),
    ).toEqual([]);
    const Screen = screenComponent();
    const screens = allFibers(screen).filter((fiber) => rendersComponent(fiber, Screen));
    expect(screens).toHaveLength(1);
    const fiber = fiberOf(button);
    expect(fiber !== null && screens[0] !== undefined && fiberWithin(fiber, screens[0])).toBe(true);
    const shown = [...texts(screen), ...hostNodes(screen).map((node) => labelOf(node) ?? '')];
    expect(shown.filter((text) => text.includes(MOBILE) || text.includes(THROWN))).toEqual([]);
    await app().testing.fireEvent.press(button as never);
    await settle();
    expect(mockPhone.numbersGivenTo('openDialer')).toContain('112');
  }

  test('CALL-02-AC13: when the index route throws while rendering, with an error whose message holds a synthetic #1 number, the fallback shows on Screen: one 112 button, labelled in full, that opens the dialer; "Noe gikk galt på denne skjermen." and "Prøv igjen"; nothing of the error’s message or the number; and "Prøv igjen", once the module no longer throws, renders the route again', async () => {
    mockThrowing.on = true;
    const screen = await launch('/', throwingHomeScreen);

    expect(await screen.findByText(ERROR_LINE)).toBeTruthy();
    const [button] = emergencyButtons(screen);
    expect(emergencyButtons(screen)).toHaveLength(1);
    expect(
      [...(button === undefined ? [] : [button, ...ancestorsOf(button)])]
        .map((node) => ({ node: node.type, why: hiding(node) }))
        .filter(({ why }) => why.length > 0),
    ).toEqual([]);
    const Screen = screenComponent();
    const screens = allFibers(screen).filter((fiber) => rendersComponent(fiber, Screen));
    expect(screens).toHaveLength(1);
    const fiber = button === undefined ? null : fiberOf(button);
    expect(fiber !== null && screens[0] !== undefined && fiberWithin(fiber, screens[0])).toBe(true);
    const shown = [...texts(screen), ...hostNodes(screen).map((node) => labelOf(node) ?? '')];
    expect(shown.filter((text) => text.includes(MOBILE) || text.includes(THROWN))).toEqual([]);
    expect(await screen.findByRole('button', { name: RETRY })).toBeTruthy();

    if (button !== undefined) {
      await app().testing.fireEvent.press(button as never);
    }
    await settle();
    expect(mockPhone.numbersGivenTo('openDialer')).toEqual(['112']);
    expect(mockPhone.timesCalled('callNumber')).toBe(0);

    mockThrowing.on = false;
    await app().testing.fireEvent.press(await screen.findByRole('button', { name: RETRY }));
    expect(await screen.findByText(JOIN_TITLE)).toBeTruthy();
    expect(screen.queryByText(ERROR_LINE)).toBeNull();
    expect(emergencyButtons(screen)).toHaveLength(1);
  });

  // RG-03 (review loop 1): the label quoted here was "Ring 112, nødnummeret".
  test('CALL-02-AC13: when the layout’s own GroupSessionProvider throws while rendering, the fallback, outside the providers, shows one 112 button labelled "Ring 1 1 2, nødnummeret" in full, not a raw key, and "Noe gikk galt på denne skjermen." in full; pressing the button opens the dialer with 112', async () => {
    const screen = await launch('/', throwingSession);

    expect(await screen.findByText(ERROR_LINE)).toBeTruthy();
    const buttons = emergencyButtons(screen);
    expect(buttons).toHaveLength(1);
    const shown = [...texts(screen), ...hostNodes(screen).map((node) => labelOf(node) ?? '')];
    expect(shown.filter((text) => /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(text))).toEqual([]);
    expect(shown.filter((text) => text.includes(MOBILE) || text.includes(THROWN))).toEqual([]);
    const [button] = buttons;
    if (button !== undefined) {
      await app().testing.fireEvent.press(button as never);
    }
    await settle();

    expect(mockPhone.numbersGivenTo('openDialer')).toEqual(['112']);
    expect(mockPhone.timesCalled('callNumber')).toBe(0);
  });

  test('CALL-02-AC13: the fallback’s checks hold whichever throw brought it: drawn on Screen, 112 unhidden, nothing of the error shown', async () => {
    mockThrowing.on = true;
    await expectFallback(await launch('/', throwingHomeScreen));
    await expectFallback(await launch('/', throwingSession));
  });

  // Review loop 1 (a11y-i18n-reviewer 5): a screen that crashes changes under
  // the walker's thumb, so its line is read out when it appears, as the
  // app's other messages after an action are (accessibilityLiveRegion,
  // Android; iOS is task 12's).
  test.each([
    ['the index route', 'route'],
    ['the layout’s GroupSessionProvider', 'session'],
  ] as [string, 'route' | 'session'][])(
    'CALL-02-AC13: when %s throws, "Noe gikk galt på denne skjermen." is in an element with accessibilityLiveRegion="assertive", so it is read out when it appears',
    async (_what, which) => {
      mockThrowing.on = true;
      const screen = await launch('/', which === 'route' ? throwingHomeScreen : throwingSession);

      const line = await screen.findByText(ERROR_LINE);

      expect(
        [line, ...ancestorsOf(line)].some(
          (node) =>
            node.props['accessibilityLiveRegion'] === 'assertive' ||
            node.props['aria-live'] === 'assertive',
        ),
      ).toBe(true);
    },
  );
});
