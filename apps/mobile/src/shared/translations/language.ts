/** A language the app has text for. Bokmål comes first (D-014). */
export type AppLanguage = 'nb' | 'en';

/** What the app speaks when the device asks for nothing it has (D-014). */
export const FALLBACK_LANGUAGE: AppLanguage = 'nb';

/**
 * The primary language subtags the app answers to. Nynorsk and plain "no"
 * get bokmål: the app ships in bokmål, and nynorsk readers read it (D-014).
 * A Map, not an object literal, so a tag such as "constructor" finds nothing.
 */
const SPOKEN = new Map<string, AppLanguage>([
  ['nb', 'nb'],
  ['nn', 'nb'],
  ['no', 'nb'],
  ['en', 'en'],
]);

/**
 * Which of the app's languages to speak, from the device's preferred
 * languages in the order the device lists them: the first one the app has
 * wins, and bokmål when there is none.
 *
 * @param deviceLanguages BCP 47 tags such as "nb-NO" or "en-GB"
 */
export function chooseLanguage(deviceLanguages: readonly string[]): AppLanguage {
  for (const tag of deviceLanguages) {
    // "nb-NO" and "nb_NO" both mean "nb": the primary subtag, before any region.
    const primary = tag.toLowerCase().replace(/[-_].*/, '');
    const language = SPOKEN.get(primary);
    if (language !== undefined) {
      return language;
    }
  }
  return FALLBACK_LANGUAGE;
}
