// INF-06-AC5: every text key exists in both languages (L5, D-014).
//
// A key that is in one file and not the other reaches the screen as the key
// itself, "placeholder.title", which is how an app looks broken to the person
// holding it. So the two files are held to exactly the same keys, every value
// is real text, and bokmål is what i18next falls back to when a key is missing.
import { describe, expect, test } from '@jest/globals';

import en from './en.json';
import i18n from './index';
import nb from './nb.json';

/** Every leaf of a nested translation file, as [dotted key, value] pairs. */
function leaves(tree: unknown, prefix = ''): [string, unknown][] {
  if (typeof tree !== 'object' || tree === null || Array.isArray(tree)) {
    return [[prefix, tree]];
  }
  return Object.entries(tree).flatMap(([key, value]) =>
    leaves(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

const keysOf = (tree: unknown): string[] => leaves(tree).map(([key]) => key);

describe('the translation files', () => {
  test('INF-06-AC5: there is text to translate at all', () => {
    // An empty pair of files has "the same keys" and would pass the test below.
    expect(keysOf(nb).length).toBeGreaterThan(0);
  });

  test('INF-06-AC5: nb.json and en.json have exactly the same keys', () => {
    expect(keysOf(en).sort()).toEqual(keysOf(nb).sort());
  });

  test.each([
    { language: 'nb', file: nb },
    { language: 'en', file: en },
  ])('INF-06-AC5: every value in $language is a non-empty string', ({ file }) => {
    for (const [key, value] of leaves(file)) {
      expect({ key, type: typeof value }).toEqual({ key, type: 'string' });
      expect({ key, empty: String(value).trim() === '' }).toEqual({ key, empty: false });
    }
  });

  test('INF-06-AC5: bokmål is the language i18next falls back to', () => {
    const fallback = i18n.options.fallbackLng;

    expect(typeof fallback === 'string' ? [fallback] : fallback).toEqual(['nb']);
  });

  test('INF-06-AC5: a key missing from nb.json is a type error, not text on a screen', () => {
    // The keys are typed from nb.json, so a misspelt key fails `tsc` (L1)
    // before any test runs. If that typing is ever lost, the directive below
    // becomes unused and the type check fails on this line instead.
    const missing = 'placeholder.missing';

    expect(i18n.exists(missing)).toBe(false);
    // @ts-expect-error -- not a key in nb.json, and the compiler has to say so
    i18n.t(missing);
  });
});
