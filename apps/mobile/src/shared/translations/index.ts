import { getLocales } from 'expo-localization';
import i18next from 'i18next';

import en from './en.json';
import { FALLBACK_LANGUAGE, chooseLanguage } from './language';
import nb from './nb.json';

// The keys are typed from nb.json, so a key that is not in it is a type error
// when `tsc` runs, rather than a raw key on someone's screen.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof nb };
  }
}

/**
 * The app's own i18next instance, ready before anything renders.
 *
 * Both languages are bundled and `initAsync: false` makes `init` finish before
 * it returns, so the first frame already has its text: no flash of raw keys,
 * and no loading state to get wrong. The language is chosen once, from the
 * device's ordered list, when this module is first loaded (D-014).
 */
const i18n = i18next.createInstance();

void i18n.init({
  resources: {
    nb: { translation: nb },
    en: { translation: en },
  },
  lng: chooseLanguage(getLocales().map((locale) => locale.languageTag)),
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: ['nb', 'en'],
  initAsync: false,
  // React escapes what it renders; escaping here as well would show entities.
  interpolation: { escapeValue: false },
});

export default i18n;
