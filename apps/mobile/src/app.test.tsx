// INF-06-AC2 and AC3: the app opens on its index route, under the root layout,
// in the device's language. Rendered through Expo Router's own testing library
// and found the way a screen reader finds it: by role and by name.
//
// This file sits beside src/app/, not inside it. Expo Router takes every .ts
// and .tsx file under src/app/ as a route, test files included: a test there
// becomes a screen at /index.test, and Metro bundles it and @jest/globals into
// the release build. That was checked, not assumed, with `expo export`.
//
// The device's preferred languages come from expo-localization, which a device
// chosen by each describe block stands in for. The language is settled when
// the translations are set up, so each language loads the app into a registry
// of its own: jest.resetModules, then the device, then the app, in beforeAll,
// so everything a test loads afterwards comes from that same registry. Loading
// it with jest.isolateModules instead mixes two copies of React. React Native
// Testing Library's usual entry point registers hooks when it is first loaded,
// which Jest refuses once tests have started, so its hook-free "pure" entry
// point stands in for it and each test is cleaned up here.
//
// The expected text is read from nb.json and en.json rather than copied, so
// these tests hold the screen to the translation files, not to a second copy
// of the words.
import { afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import type * as ExpoRouterTesting from 'expo-router/testing-library';
import type { ReactElement } from 'react';

import en from './shared/translations/en.json';
import nb from './shared/translations/nb.json';

type DeviceLanguage = 'nb-NO' | 'en-GB';

// Read by the expo-localization stand-in when a fresh registry first loads it.
// Jest's hoisting accepts this reference only because of the "mock" prefix.
let mockDeviceLanguages: readonly DeviceLanguage[] = [];

jest.mock('expo-localization', () => {
  const regional = {
    'nb-NO': { languageCode: 'nb', regionCode: 'NO', currencyCode: 'NOK', currencySymbol: 'kr' },
    'en-GB': { languageCode: 'en', regionCode: 'GB', currencyCode: 'GBP', currencySymbol: '£' },
  } as const;
  const locales = mockDeviceLanguages.map((languageTag) => ({
    ...regional[languageTag],
    languageTag,
    languageScriptCode: null,
    languageRegionCode: regional[languageTag].regionCode,
    languageCurrencyCode: regional[languageTag].currencyCode,
    languageCurrencySymbol: regional[languageTag].currencySymbol,
    textDirection: 'ltr',
    decimalSeparator: ',',
    digitGroupingSeparator: ' ',
    measurementSystem: 'metric',
    temperatureUnit: 'celsius',
  }));
  return {
    ...jest.requireActual<object>('expo-localization'),
    getLocales: () => locales,
    useLocales: () => locales,
  };
});

jest.mock('@testing-library/react-native', () =>
  jest.requireActual<object>('@testing-library/react-native/pure'),
);

/** A route file as Expo Router loads it: the whole module, not just its component. */
type RouteModule = Record<string, unknown> & { default: () => ReactElement | null };

interface LoadedApp {
  testing: typeof ExpoRouterTesting;
  rootLayout: RouteModule;
  indexRoute: RouteModule;
}

/**
 * The app as a device with these preferred languages, in this order, loads it.
 *
 * The types come from LoadedApp, never from `requireActual<…>('./app/index')`:
 * Jest finds a test's dependencies by reading its source, and a type argument
 * between the name and the parenthesis hides the route from it. HK-04 would
 * then find no test related to an edited route (INF-06-AC7).
 */
function loadAppOn(languages: readonly DeviceLanguage[]): LoadedApp {
  jest.resetModules();
  mockDeviceLanguages = languages;
  return {
    testing: jest.requireActual('expo-router/testing-library'),
    rootLayout: jest.requireActual('./app/_layout'),
    indexRoute: jest.requireActual('./app/index'),
  };
}

/** Renders the initial route, "/", under the root layout: what the app shows when it opens. */
async function openApp({ testing, rootLayout, indexRoute }: LoadedApp) {
  await testing.renderRouter({ _layout: rootLayout, index: indexRoute });
  return testing.screen;
}

/**
 * A heading, however it is marked: React Native's accessibilityRole="header"
 * or the ARIA role="heading". TalkBack announces both as a heading, and
 * Testing Library reports them under different names.
 */
const HEADING = /^(header|heading)$/;

/** What i18next shows for a key it cannot find: the key itself, dotted. */
const LOOKS_LIKE_A_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;

/** Every leaf key of a nested translation file, such as "placeholder.title". */
function keysOf(tree: unknown, prefix = ''): string[] {
  if (typeof tree !== 'object' || tree === null) {
    return [prefix];
  }
  return Object.entries(tree).flatMap(([key, value]) =>
    keysOf(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('on a device whose preferred language is Norwegian bokmål', () => {
  let app: LoadedApp;
  beforeAll(() => {
    app = loadAppOn(['nb-NO']);
  });
  afterEach(async () => {
    await app.testing.cleanup();
  });

  test('INF-06-AC2: the index route shows the bokmål title as a heading', async () => {
    const screen = await openApp(app);

    expect(screen.getAllByRole(HEADING, { name: nb.placeholder.title }).length).toBeGreaterThan(0);
  });

  test('INF-06-AC2: the index route shows the bokmål status line', async () => {
    const screen = await openApp(app);

    expect(screen.getByText(nb.placeholder.status)).toBeTruthy();
  });

  test('INF-06-AC2: no text on the screen is a raw translation key', async () => {
    const screen = await openApp(app);

    for (const key of keysOf(nb)) {
      expect(screen.queryByText(key)).toBeNull();
    }
    expect(screen.queryAllByText(LOOKS_LIKE_A_KEY).map((node) => node.props)).toEqual([]);
  });
});

describe('on a device whose preferred language is English', () => {
  let app: LoadedApp;
  beforeAll(() => {
    app = loadAppOn(['en-GB']);
  });
  afterEach(async () => {
    await app.testing.cleanup();
  });

  test('INF-06-AC3: the same route shows the English title as a heading and the English status line', async () => {
    const screen = await openApp(app);

    expect(screen.getAllByRole(HEADING, { name: en.placeholder.title }).length).toBeGreaterThan(0);
    expect(screen.getByText(en.placeholder.status)).toBeTruthy();
  });

  test('INF-06-AC3: a visible string differs between the files, and the bokmål one is not shown', async () => {
    // Without a difference, this file could not tell which translation was used.
    const shown = [
      ['placeholder.title', nb.placeholder.title, en.placeholder.title],
      ['placeholder.status', nb.placeholder.status, en.placeholder.status],
    ] as const;
    const differing = shown.filter(([, bokmål, english]) => bokmål !== english);
    const screen = await openApp(app);

    expect(differing.map(([key]) => key).length).toBeGreaterThan(0);
    for (const [, bokmål] of differing) {
      expect(screen.queryByText(bokmål)).toBeNull();
    }
  });
});
