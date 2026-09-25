import type { ExpoConfig } from 'expo/config';

/**
 * The app's configuration: the one place its native settings live, because
 * `expo prebuild` generates the Android project from this file.
 *
 * Only what Expo requires so far. The rest follows its tests (INF-06).
 */
const config: ExpoConfig = {
  name: 'TryggHverdag',
  slug: 'trygghverdag',
};

export default config;
