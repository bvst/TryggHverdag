// INF-06-AC17: no over-the-air updates (D-023). A build whose JavaScript can be
// replaced from a server after it was tested is a build nobody tested, so
// expo-updates is not declared and the app config names no update URL.
//
// What Android actually links is checked as well, in scripts/mobile-app.test.mjs:
// a dependency can arrive through another package without being declared here.
//
// INF-06-AC10 needs one thing from this file too: the application ID is defined
// here, once, because the e2e script reads it from here and hands it to Maestro.
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { AndroidConfig, XML, compileModsAsync } from 'expo/config-plugins';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
    // What Expo writes is checked in scripts/mobile-app.test.mjs.
    expect(resolvedConfig().android?.allowBackup).toBe(false);
  });
});

// GRP-01: the e2e build's cleartext rule. The spec fixes the API's address at
// build time (EXPO_PUBLIC_API_URL, D-046) and asks for this test: the L7 build
// talks to a server that CI's android-e2e job starts beside the emulator, at
// http://10.0.2.2:8080, so cleartext is allowed to the emulator's host address
// alone and in that build alone, and the release configuration allows none. An
// http address at any other host stops the build: no build may send a
// credential in the clear across a network. No acceptance criterion states
// this, so these tests carry the requirement's ID alone.
//
// app.config.ts reads the address once, when it is loaded, so each case loads
// a copy of its own with the variable set, and puts the variable back. What a
// build gets is read from Expo's own mod compiler, the one `expo prebuild`
// runs, applied to the smallest Android project it accepts, in a temporary
// folder: the manifest and the network security file as a build would see
// them. The ratchet's figure for app.config.ts (RG-04) is measured here, by
// jest-expo, which is why these tests are here and not in a child process.

/** Where the build's API address comes from (D-046). */
const API_URL = 'EXPO_PUBLIC_API_URL';

/** The Android emulator's address for the machine it runs on: the one host cleartext may reach. */
const EMULATOR_HOST = '10.0.2.2';

/** The smallest manifest Expo's manifest mods accept: one that holds the main application. */
const BARE_MANIFEST =
  '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n' +
  '  <application android:name=".MainApplication"/>\n' +
  '</manifest>\n';

/** Builds that must permit no cleartext at all. */
const NO_CLEARTEXT: [string, string | undefined][] = [
  ['with the address unset', undefined],
  ['with the address empty', ''],
  ['with an https address, as every release build has', 'https://api.example.invalid'],
  ['with an https address at the emulator’s host', `https://${EMULATOR_HOST}:8443`],
];

/** http addresses at any host but the emulator's, several spelled to look like it. */
const REFUSED: [string, string][] = [
  ['a machine on the local network', 'http://192.168.1.5:8080'],
  ['this machine, by name', 'http://localhost:8080'],
  ['an address that starts like the emulator’s', 'http://10.0.2.20:8080'],
  [
    'a host name that starts with the emulator’s address',
    `http://${EMULATOR_HOST}.example.invalid:8080`,
  ],
  [
    'another host, with the emulator’s address in the path',
    `http://api.example.invalid/${EMULATOR_HOST}`,
  ],
  [
    'another host, with the emulator’s address as the user name',
    `http://${EMULATOR_HOST}@api.example.invalid:8080`,
  ],
];

function setApiUrl(value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, API_URL);
  } else {
    process.env[API_URL] = value;
  }
}

/**
 * The config app.config.ts exports for a build whose API address is `apiUrl`
 * (undefined: the variable unset). A fresh copy of the module each time, so
 * what it read when it was loaded is this address and no earlier one.
 */
function configBuiltWith(apiUrl: string | undefined): ExpoConfig {
  const before = process.env[API_URL] as string | undefined;
  setApiUrl(apiUrl);
  try {
    let loaded: ExpoConfig | undefined;
    jest.isolateModules(() => {
      loaded = jest.requireActual<{ default: ExpoConfig }>('./app.config').default;
    });
    if (loaded === undefined) {
      throw new Error('app.config.ts exported no config.');
    }
    return loaded;
  } finally {
    setApiUrl(before);
  }
}

interface AndroidBuild {
  /** The main application's attributes in the generated manifest. */
  application: Record<string, string | undefined>;
  /** The generated project's resource folder. */
  resources: string;
  /** The files in its res/xml folder. */
  xmlFiles: string[];
}

describe('GRP-01: the e2e build’s cleartext rule, in app.config.ts', () => {
  const projects: string[] = [];

  afterEach(() => {
    for (const project of projects.splice(0)) {
      rmSync(project, { recursive: true, force: true });
    }
  });

  /** What Expo's mod compiler makes of the config for a build with this API address, in a fresh project. */
  async function androidBuiltWith(apiUrl: string | undefined): Promise<AndroidBuild> {
    const config = configBuiltWith(apiUrl);
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'app-config-cleartext-'));
    projects.push(projectRoot);
    const main = path.join(projectRoot, 'android', 'app', 'src', 'main');
    mkdirSync(main, { recursive: true });
    writeFileSync(path.join(main, 'AndroidManifest.xml'), BARE_MANIFEST);

    await compileModsAsync(config, { projectRoot, platforms: ['android'] });

    const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(
      path.join(main, 'AndroidManifest.xml'),
    );
    const resources = path.join(main, 'res');
    const xml = path.join(resources, 'xml');
    return {
      application: AndroidConfig.Manifest.getMainApplicationOrThrow(manifest).$,
      resources,
      xmlFiles: existsSync(xml) ? readdirSync(xml) : [],
    };
  }

  test('GRP-01: the e2e build, at http://10.0.2.2:8080, permits cleartext to 10.0.2.2 alone, its subdomains excluded, through the network security config its manifest names', async () => {
    const build = await androidBuiltWith(`http://${EMULATOR_HOST}:8080`);

    expect(build.application['android:networkSecurityConfig']).toBe('@xml/network_security_config');
    // Not the manifest's switch for the whole app, which would permit
    // cleartext to every host.
    expect(build.application['android:usesCleartextTraffic']).not.toBe('true');
    // The file the manifest names is written, and nothing else beside it.
    expect(build.xmlFiles).toEqual(['network_security_config.xml']);
    // Exactly this: a base-config, a second domain, another host, or
    // subdomains included would each permit cleartext somewhere else.
    expect(
      await XML.readXMLAsync({
        path: path.join(build.resources, 'xml', 'network_security_config.xml'),
      }),
    ).toEqual({
      'network-security-config': {
        'domain-config': [
          {
            $: { cleartextTrafficPermitted: 'true' },
            domain: [{ $: { includeSubdomains: 'false' }, _: EMULATOR_HOST }],
          },
        ],
      },
    });
  });

  test.each(NO_CLEARTEXT)(
    'GRP-01: no cleartext in a build %s: its manifest names no network security config and does not switch cleartext on, and no such file is written',
    async (_what, apiUrl) => {
      const build = await androidBuiltWith(apiUrl);

      expect(build.application['android:networkSecurityConfig']).toBeUndefined();
      expect(build.application['android:usesCleartextTraffic']).not.toBe('true');
      expect(build.xmlFiles).toEqual([]);
    },
  );

  test.each(REFUSED)(
    'GRP-01: the build stops, naming EXPO_PUBLIC_API_URL, for an http address at %s: %s',
    (_what, apiUrl) => {
      expect(() => configBuiltWith(apiUrl)).toThrow(/EXPO_PUBLIC_API_URL/);
    },
  );
});
