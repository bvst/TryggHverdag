import type { ExpoConfig } from 'expo/config';

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
 *   feature that needs one.
 * - `ios`. Android only for now; iOS is its own later task.
 */
const config: ExpoConfig = {
  name: 'TryggHverdag',
  slug: 'trygghverdag',
  version: '0.0.0',
  orientation: 'portrait',
  android: {
    package: APPLICATION_ID,
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

export default config;
