import i18next from 'i18next';

import type nb from './nb.json';

// The keys are typed from nb.json, so a key that is not in it is a type error
// when `tsc` runs, rather than a raw key on someone's screen.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof nb };
  }
}

/**
 * The app's own i18next instance.
 *
 * Not set up yet: no languages, no fallback. Its tests come first (INF-06).
 */
const i18n = i18next.createInstance();

export default i18n;
