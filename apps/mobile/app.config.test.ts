// INF-06-AC17: no over-the-air updates (D-023). A build whose JavaScript can be
// replaced from a server after it was tested is a build nobody tested, so
// expo-updates is not declared and the app config names no update URL.
//
// What Android actually links is checked as well, in scripts/mobile-app.test.mjs:
// a dependency can arrive through another package without being declared here.
//
// INF-06-AC10 needs one thing from this file too: the application ID is defined
// here, once, because the e2e script reads it from here and hands it to Maestro.
import { describe, expect, test } from '@jest/globals';
import type { ConfigContext, ExpoConfig } from 'expo/config';

import appConfig from './app.config';
import manifest from './package.json';

/** The config as Expo would resolve it, whether the file exports an object or a function. */
function resolvedConfig(): ExpoConfig {
  const exported: unknown = appConfig;
  const context: ConfigContext = {
    projectRoot: '.',
    staticConfigPath: null,
    packageJsonPath: null,
    config: {},
  };
  return (
    typeof exported === 'function'
      ? (exported as (context: ConfigContext) => ExpoConfig)(context)
      : exported
  ) as ExpoConfig;
}

type DependencyFields = Partial<
  Record<
    'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies',
    Record<string, string>
  >
>;

describe('the app config', () => {
  test('INF-06-AC17: expo-updates is not among the declared dependencies of any kind', () => {
    const fields: DependencyFields = manifest;
    const declared = [
      fields.dependencies,
      fields.devDependencies,
      fields.optionalDependencies,
      fields.peerDependencies,
    ].flatMap((field) => Object.keys(field ?? {}));

    // Not vacuous: the app declares something, expo among it.
    expect(declared).toContain('expo');
    expect(declared).not.toContain('expo-updates');
  });

  test('INF-06-AC17: the app config sets no update URL and no updates plugin', () => {
    const config = resolvedConfig();
    const plugins = (config.plugins ?? []).map((plugin) =>
      Array.isArray(plugin) ? String(plugin[0]) : plugin,
    );

    expect(config.updates?.url).toBeUndefined();
    expect(plugins).not.toContain('expo-updates');
  });

  test('INF-06-AC10: the Android application ID is defined here, in reverse-domain form', () => {
    expect(resolvedConfig().android?.package).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
  });

  test("INF-06-AC19: the release app keeps nothing in Android's cloud backup", () => {
    // Auto Backup would copy what the app stores, such as a session token or a
    // journey, to Google Drive, outside the providers chosen for the EEA
    // (D-016). A restore would also move a login bound to one phone onto
    // another. Expo writes this setting into the generated manifest as
    // android:allowBackup, and Android's default, when it is left out, is true.
    expect(resolvedConfig().android?.allowBackup).toBe(false);
  });
});
