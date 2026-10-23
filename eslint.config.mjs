// Repository-wide ESLint setup (L1 static gate). The rules live in
// packages/config so CI, the editor and the post-edit hook all use the same set.
import { trygghverdagEslintConfig } from '@trygghverdag/config/eslint/index.mjs';

/** The app's sources, and the two folders and the one file the rules below treat apart. */
const APP_SOURCES = 'apps/mobile/src/**/*.{ts,tsx}';
const SHARED_UI = 'apps/mobile/src/shared/ui/**';
const ROUTES = 'apps/mobile/src/app/**/*.{ts,tsx}';
const PHONE = 'apps/mobile/src/features/call/phone.ts';

/**
 * CALL-02-AC2: what could sit over the 112 bar, or build a screen without
 * it, is imported only by the shared UI kit, src/shared/ui/: a Modal or a
 * native Alert sits over the bar until it is dismissed, and a SafeAreaView
 * or a ScrollView is how a screen would build its own frame. `Screen` itself
 * draws the bar. Type-only imports draw nothing, so they stay open.
 */
const FRAME_PIECES = [
  {
    name: 'react-native',
    importNames: ['Modal', 'Alert', 'SafeAreaView', 'ScrollView'],
    allowTypeImports: true,
    message:
      'CALL-02-AC2: only src/shared/ui/ draws a Modal, an Alert, a SafeAreaView or a ScrollView, so nothing covers the 112 bar. Draw the screen inside the route’s Screen.',
  },
  {
    name: 'react-native-safe-area-context',
    importNames: ['SafeAreaView'],
    allowTypeImports: true,
    message:
      'CALL-02-AC2: only src/shared/ui/ draws a SafeAreaView: Screen does, with the 112 bar in it.',
  },
];

/**
 * CALL-01-AC6: only features/call/phone.ts places a call or opens the dialer,
 * because no other file may import what does: expo-intent-launcher, which
 * starts ACTION_CALL; expo-linking, whose openURL opens a `tel:` link as
 * React Native's Linking does; and PermissionsAndroid and Linking from
 * react-native, the call permission and the dialer. Type-only imports place
 * nothing, so they stay open.
 */
const CALLING_MESSAGE =
  'CALL-01-AC6: only src/features/call/phone.ts places a call or opens the dialer. Call it through features/call.';
const CALLING_PIECES = [
  { name: 'expo-intent-launcher', allowTypeImports: true, message: CALLING_MESSAGE },
  { name: 'expo-linking', allowTypeImports: true, message: CALLING_MESSAGE },
  {
    name: 'react-native',
    importNames: ['PermissionsAndroid', 'Linking'],
    allowTypeImports: true,
    message: CALLING_MESSAGE,
  },
];

/**
 * CALL-02-AC1 and AC2: the routes under src/app/ draw `Screen`, and with it
 * the 112 bar; nothing else outside the kit may. A relative import of the kit
 * (its folder, its index or screen.tsx), from anywhere: `…/shared/ui`, and,
 * inside src/shared/, `./ui` or `../ui`.
 */
const SCREEN = {
  regex: '^(?:\\.{1,2}/)+(?:(?:[^/]+/)*shared/)?ui(?:/(?:index|screen)(?:\\.tsx?)?)?$',
  importNames: ['Screen'],
  allowTypeImports: true,
  message:
    'CALL-02-AC1: only the routes in src/app/ draw Screen, so every view a feature draws sits inside the route’s Screen, below the 112 bar.',
};

/**
 * ESLint gives a file one set of options for a rule, so each block below
 * names every refusal that applies where it matches: the frame pieces outside
 * src/shared/ui/, `Screen` outside it and src/app/, and the calling pieces
 * everywhere but phone.ts.
 */
export default [
  ...trygghverdagEslintConfig({ rootDir: import.meta.dirname }),
  {
    files: [APP_SOURCES],
    ignores: [SHARED_UI, ROUTES, PHONE],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { paths: [...FRAME_PIECES, ...CALLING_PIECES], patterns: [SCREEN] },
      ],
    },
  },
  {
    files: [PHONE],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { paths: FRAME_PIECES, patterns: [SCREEN] },
      ],
    },
  },
  {
    files: [ROUTES],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { paths: [...FRAME_PIECES, ...CALLING_PIECES] },
      ],
    },
  },
  {
    files: [`${SHARED_UI}/*.{ts,tsx}`],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { paths: CALLING_PIECES }],
    },
  },
];
