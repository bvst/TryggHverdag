import type { ExpoConfig } from 'expo/config';
import { AndroidConfig, XML, withAndroidManifest, withDangerousMod } from 'expo/config-plugins';

/**
 * The Android application ID, defined here and nowhere else: the e2e script
 * reads it from this config and hands it to Maestro.
 *
 * A PLACEHOLDER. It costs nothing to change until the first store upload, when
 * the owner fixes it together with the public name (D-057).
 */
const APPLICATION_ID = 'no.trygghverdag.placeholder';

/**
 * The app's configuration: the one place its native settings live, because
 * `expo prebuild` generates the Android project from this file (continuous
 * native generation, so no android/ folder is committed).
 *
 * Deliberately absent:
 * - `updates` and the expo-updates plugin. No over-the-air updates (D-023): a
 *   build whose JavaScript a server can replace after testing is a build
 *   nobody tested.
 * - `scheme`. Deep links are an attack surface, and they arrive with the first
 *   feature that needs one. GRP-01's invitation is a code the person types,
 *   not a link (D-013, D-136 answer 3).
 * - `ios`. Android only for now; iOS is its own later task.
 */
const config: ExpoConfig = {
  name: 'TryggHverdag',
  slug: 'trygghverdag',
  version: '0.0.0',
  orientation: 'portrait',
  android: {
    package: APPLICATION_ID,
    // Auto Backup would copy what the app stores, such as a session token or a
    // journey, to Google Drive, outside the providers chosen for the EEA, and a
    // restore would move a login bound to one phone onto another (D-081).
    allowBackup: false,
    // Expo's template asks for these by default. The skeleton needs the network
    // and nothing else, and drawing over other apps or reading shared storage
    // is not something a safety app should hold without a reason. Debug builds
    // keep SYSTEM_ALERT_WINDOW from their own manifest, for the developer menu.
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.VIBRATE',
    ],
  },
  plugins: [
    'expo-router',
    // The development client would otherwise register an `exp+trygghverdag://`
    // link in the main manifest, so release builds too could be opened from
    // any web page. No scheme until a feature needs one (see `scheme` above).
    ['expo-dev-client', { addGeneratedScheme: false }],
  ],
};

/** The Android emulator's address for the machine it runs on. */
const EMULATOR_HOST = '10.0.2.2';

/**
 * The one host this build may reach over plain HTTP (GRP-01, approach item
 * 14), from the API address the build fixes (EXPO_PUBLIC_API_URL, D-046).
 *
 * None for an https address, or for none at all, as every release build has.
 * The emulator's host for an http address naming it: CI's android-e2e job
 * builds with http://10.0.2.2:8080, the API it starts beside the emulator.
 * Any other address stops the build, because no build may send a credential
 * in the clear across a network.
 */
function cleartextHost(apiUrl: string | undefined): string | null {
  if (apiUrl === undefined || apiUrl === '') {
    return null;
  }
  const url = new URL(apiUrl);
  if (url.protocol === 'https:') {
    return null;
  }
  if (url.protocol === 'http:' && url.hostname === EMULATOR_HOST) {
    return EMULATOR_HOST;
  }
  throw new Error(
    "EXPO_PUBLIC_API_URL must be an https address, or plain http to the Android emulator's host " +
      `address, ${EMULATOR_HOST}, for the e2e build alone.`,
  );
}

/**
 * The config with cleartext permitted to `host` and nowhere else: a network
 * security configuration naming that one domain, its subdomains excluded,
 * which leaves Android's refusal of cleartext everywhere else in place.
 */
function withCleartextTo(base: ExpoConfig, host: string): ExpoConfig {
  const named = withAndroidManifest(base, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    application.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    return mod;
  });
  return withDangerousMod(named, [
    'android',
    async (mod) => {
      const resources = await AndroidConfig.Paths.getResourceFolderAsync(
        mod.modRequest.projectRoot,
      );
      await XML.writeXMLAsync({
        path: `${resources}/xml/network_security_config.xml`,
        xml: {
          'network-security-config': {
            'domain-config': [
              {
                $: { cleartextTrafficPermitted: 'true' },
                domain: [{ $: { includeSubdomains: 'false' }, _: host }],
              },
            ],
          },
        },
      });
      return mod;
    },
  ]);
}

const host = cleartextHost(process.env['EXPO_PUBLIC_API_URL'] as string | undefined);

// Unchanged for every release build. The e2e build alone gains cleartext to
// the emulator's host.
export default host === null ? config : withCleartextTo(config, host);
