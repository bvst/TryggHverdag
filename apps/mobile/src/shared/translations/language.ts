/** A language the app has text for. Bokmål comes first (D-014). */
export type AppLanguage = 'nb' | 'en';

/**
 * Which of the app's languages to speak, from the device's preferred
 * languages in the order the device lists them.
 *
 * Not written yet: its tests come first (INF-06).
 */
export function chooseLanguage(deviceLanguages: readonly string[]): AppLanguage {
  throw new Error(`not implemented: chooseLanguage([${deviceLanguages.join(', ')}])`);
}
