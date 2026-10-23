// Repository-wide ESLint setup (L1 static gate). The rules live in
// packages/config so CI, the editor and the post-edit hook all use the same set.
import {
  CLOCK_FREE_PATHS,
  clockFreeRules,
  trygghverdagEslintConfig,
} from '@trygghverdag/config/eslint/index.mjs';

/** The app's sources, and the two folders and the one file the rules below treat apart. */
const APP_SOURCES = 'apps/mobile/src/**/*.{ts,tsx}';
const SHARED_UI = 'apps/mobile/src/shared/ui/**';
const ROUTES = 'apps/mobile/src/app/**/*.{ts,tsx}';
const PHONE = 'apps/mobile/src/features/call/phone.ts';
/** The app's clock-free code (AR-03), where no-restricted-syntax already holds the clock rule. */
const APP_CLOCK_FREE = CLOCK_FREE_PATHS.filter((glob) => glob.startsWith('apps/mobile/src/'));

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
 *
 * A path matches a module's exact name, so the other ways to the same native
 * code are refused too (review loop 2):
 *   - NativeModules and TurboModuleRegistry from react-native, and
 *     requireNativeModule and requireOptionalNativeModule from
 *     expo-modules-core and expo: they reach the native modules the others
 *     wrap;
 *   - a default import of react-native, expo or expo-modules-core, and a
 *     namespace import, which no-restricted-imports refuses as a whole for a
 *     module whose names it restricts: it cannot see `RN.Linking`;
 *   - a deep path into the calling packages (CALLING_DEEP_PATHS);
 *   - an import() of any of them, or of a source the rule cannot read
 *     (CALLING_SYNTAX).
 */
const CALLING_MESSAGE =
  'CALL-01-AC6: only src/features/call/phone.ts places a call or opens the dialer. Call it through features/call.';
const NATIVE_MODULE_LOADERS = ['requireNativeModule', 'requireOptionalNativeModule'];
const CALLING_PIECES = [
  { name: 'expo-intent-launcher', allowTypeImports: true, message: CALLING_MESSAGE },
  { name: 'expo-linking', allowTypeImports: true, message: CALLING_MESSAGE },
  {
    name: 'react-native',
    importNames: [
      'PermissionsAndroid',
      'Linking',
      'NativeModules',
      'TurboModuleRegistry',
      'default',
    ],
    allowTypeImports: true,
    message: CALLING_MESSAGE,
  },
  ...['expo-modules-core', 'expo'].map((name) => ({
    name,
    importNames: [...NATIVE_MODULE_LOADERS, 'default'],
    allowTypeImports: true,
    message: CALLING_MESSAGE,
  })),
];

/** The packages whose insides place a call or reach a native module: no deep path into them. */
const CALLING_PACKAGES = [
  'expo-intent-launcher',
  'expo-linking',
  'expo-modules-core',
  'react-native',
];
const CALLING_DEEP_PATHS = {
  regex: `^(?:${CALLING_PACKAGES.join('|')})/`,
  allowTypeImports: true,
  message: CALLING_MESSAGE,
};

/**
 * no-restricted-imports does not see an import() expression, so
 * no-restricted-syntax refuses one that loads a module CALLING_PIECES names,
 * or a path inside one, written as a string or as a template with no
 * expressions; and one whose source is neither, because what it loads cannot
 * be checked. A type query, `typeof import('…')`, is not an import()
 * expression, and stays open.
 */
const CALLING_SOURCE = `/^(?:${CALLING_PIECES.map(({ name }) => name).join('|')})(?:\\/|$)/`;
const CALLING_SYNTAX = [
  { selector: `ImportExpression[source.value=${CALLING_SOURCE}]`, message: CALLING_MESSAGE },
  {
    selector: `ImportExpression[source.expressions.length=0][source.quasis.0.value.cooked=${CALLING_SOURCE}]`,
    message: CALLING_MESSAGE,
  },
  {
    selector:
      "ImportExpression:not([source.type='Literal'], [source.type='TemplateLiteral'][source.expressions.length=0])",
    message:
      'CALL-01-AC6: name the module an import() loads in a plain string, so the rule can check it is not one only src/features/call/phone.ts may load.',
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
 * everywhere but phone.ts. The app's clock-free code keeps the AR-03 clock
 * rule's selectors beside the calling ones, in the last block.
 */
export default [
  ...trygghverdagEslintConfig({ rootDir: import.meta.dirname }),
  {
    files: [APP_SOURCES],
    ignores: [SHARED_UI, ROUTES, PHONE],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { paths: [...FRAME_PIECES, ...CALLING_PIECES], patterns: [SCREEN, CALLING_DEEP_PATHS] },
      ],
      'no-restricted-syntax': ['error', ...CALLING_SYNTAX],
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
        { paths: [...FRAME_PIECES, ...CALLING_PIECES], patterns: [CALLING_DEEP_PATHS] },
      ],
      'no-restricted-syntax': ['error', ...CALLING_SYNTAX],
    },
  },
  {
    files: [`${SHARED_UI}/*.{ts,tsx}`],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { paths: CALLING_PIECES, patterns: [CALLING_DEEP_PATHS] },
      ],
      'no-restricted-syntax': ['error', ...CALLING_SYNTAX],
    },
  },
  {
    // AR-03 beside CALL-01-AC6: the APP_SOURCES block put the calling
    // selectors in place of the clock rule's here, so both are given again.
    files: APP_CLOCK_FREE,
    rules: {
      'no-restricted-syntax': [...clockFreeRules['no-restricted-syntax'], ...CALLING_SYNTAX],
    },
  },
];
