import type { ExpoConfig } from 'expo/config';

/**
 * SPIKE-01's throwaway app. Debug builds only, with no licence key: the SDK is
 * free in debug builds (its licence, 3.5). Nothing here may be copied into
 * apps/mobile without re-reading the README's "Never copy into the product".
 */
const APP_ID = 'org.example.spike.backgroundsafety';

const config: ExpoConfig = {
  name: 'SPIKE-01',
  slug: 'spike-background-safety',
  // The Expo account and project that build the iOS simulator app on EAS
  // (spec, Q2). Neither is a secret.
  owner: 'urso-as',
  extra: { eas: { projectId: '87782d47-6415-4076-9bee-351fbf42ab74' } },
  version: '0.0.0',
  orientation: 'portrait',
  platforms: ['android', 'ios'],
  android: {
    package: APP_ID,
    allowBackup: false,
    permissions: [
      // S6: ACTION_CALL starts the call on the tap only with this, granted by the driver.
      'android.permission.CALL_PHONE',
      // The reminder rule: an exact alarm, granted by the S2 driver as a setup step.
      // Without the grant, expo-notifications falls back to an inexact alarm.
      'android.permission.SCHEDULE_EXACT_ALARM',
      // S5: lets the driver grant the alert channel's Do Not Disturb override.
      'android.permission.ACCESS_NOTIFICATION_POLICY',
    ],
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
  },
  ios: {
    bundleIdentifier: APP_ID,
    supportsTablet: false,
    infoPlist: {
      // The SDK's own plugin writes nothing for iOS, so its keys are here (the
      // vendor's Expo setup), without "audio": that mode only serves the SDK's
      // debug sounds, which are off.
      UIBackgroundModes: ['location', 'fetch', 'processing'],
      BGTaskSchedulerPermittedIdentifiers: ['com.transistorsoft.fetch'],
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'SPIKE-01 shares a synthetic journey with a receiver on this Mac.',
      NSLocationWhenInUseUsageDescription:
        'SPIKE-01 shares a synthetic journey with a receiver on this Mac.',
      NSMotionUsageDescription: 'SPIKE-01 lets the location SDK detect stops.',
      // Cleartext HTTP to the loopback receiver only.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true },
    },
    entitlements: {
      // S5: the Time Sensitive interruption level.
      'com.apple.developer.usernotifications.time-sensitive': true,
    },
  },
  plugins: [
    // No licence key: the plugin then writes "UNDEFINED", and debug builds run without one.
    'react-native-background-geolocation',
    // The native engine is pinned exactly here; the package's own default is a range (4.6.+).
    [
      'expo-gradle-ext-vars',
      { tslocationmanagerVersion: '4.6.1', playServicesLocationVersion: '21.3.0' },
    ],
    '@maplibre/maplibre-react-native',
    ['expo-notifications', { enableBackgroundRemoteNotifications: false }],
    './plugins/with-spike-android',
    './plugins/with-spike-ios-bundling',
  ],
};

export default config;
