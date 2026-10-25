// CALL-01-AC6 (L1; review loop 1, safety-reviewer 5): no file but
// features/call/phone.ts can place a call or open the dialer, because no other
// file may import what does: a no-restricted-imports rule in the repository's
// ESLint configuration (eslint.config.mjs, or the shared config it loads)
// refuses, in any file under apps/mobile/src/ but
// apps/mobile/src/features/call/phone.ts,
//   - `expo-intent-launcher`, which starts ACTION_CALL;
//   - `expo-linking`, an app dependency no file imports today, whose openURL
//     opens a `tel:` link as React Native's Linking does (Claude's choice
//     under D-031, after review loop 1); and
//   - `PermissionsAndroid` and `Linking` from 'react-native': the call
//     permission, and the dialer;
// and allows all four in phone.ts. CALL-01, approach 1: "the only file that
// imports expo-intent-launcher, PermissionsAndroid or Linking for calls" is
// enforced, not only intended.
//
// In the style of screen-imports.test.mjs (CALL-02-AC2) and LOST-02-AC25's
// fixture tests: ESLint is run, with the repository's own configuration, from
// the repository's root, on probe files placed where the rule must and must
// not apply. The probes exist only in memory, so type-aware parsing is
// switched off for them, and only the rule under test, in either of its two
// forms (ESLint's own, or typescript-eslint's with the same name), is
// reported, beside one control rule, no-debugger, which shows each probe was
// linted by the repository's configuration at all. ESLint's flat config
// gives a file one set of options for a rule, so the last tests hold that
// CALL-02-AC2's refusals still apply beside this rule's, in phone.ts and in
// the features alike. And, last, the repository's own app passes the rule.
//
// Review loop 2 (CALL-01.md, approach 1 and AC6; safety-reviewer note,
// privacy-security-reviewer N1): a rule's `paths` match a module's exact
// name, so the same refusal, allowed in phone.ts alone, covers the other ways
// to the same native code: a deep path into the calling packages;
// NativeModules and TurboModuleRegistry from react-native; requireNativeModule
// and requireOptionalNativeModule from expo-modules-core and from expo; a
// dynamic import() of any of them, or of a source the rule cannot read; and a
// namespace or default import of react-native, expo or expo-modules-core.
// Each is probed alone, in each of the four places the spec names, each a
// block of eslint.config.mjs with its own options: a feature folder outside
// call/, features/call/ but phone.ts, src/app/ and src/shared/ui/.
// no-restricted-imports does not see import() expressions, so the spec leaves
// to the implementer which rule carries that part (no-restricted-syntax, or
// another); these probes count a refusal from any rule of ESLint's
// no-restricted-* family (REFUSING), in either form, and from no other.
// The controls: a type query, `typeof import('react-native')`, a relative
// import(), and AppState, Platform, Pressable, Text and View stay open; in
// phone.ts no probe is refused by the calling rule; in safety-core/, the
// AR-03 clock rule still refuses Date.now() beside a refused dynamic import,
// so the calling rule's options did not replace the clock rule's; and the
// whole repository passes every rule of that family.
//
// This file is counted by req:coverage (no fixtures-only marker): CALL-01-AC6
// is a criterion of task 2.
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, test } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP = 'apps/mobile/src';

/** The one file allowed the calling imports. */
const PHONE = `${APP}/features/call/phone.ts`;

/** The rule, in either form. */
const RULES = ['no-restricted-imports', '@typescript-eslint/no-restricted-imports'];

/** The control: a rule the repository's configuration turns on everywhere. */
const CONTROL = 'no-debugger';

/** ESLint as `pnpm run lint` runs it, for probes that exist only in memory: no type-aware parsing. */
const probeLint = new ESLint({
  cwd: ROOT,
  overrideConfig: {
    languageOptions: { parserOptions: { projectService: false, project: null } },
  },
  ruleFilter: ({ ruleId }) => RULES.includes(ruleId) || ruleId === CONTROL,
});

/**
 * Lints `lines` as the file `file`, with a `debugger;` after them: the lines
 * the rule refused, and whether the control fired.
 */
async function lintProbe(file, lines) {
  const [result] = await probeLint.lintText(`${[...lines, 'debugger;'].join('\n')}\n`, {
    filePath: path.join(ROOT, file),
  });
  if (result === undefined) {
    throw new Error(`ESLint returned nothing for ${file}`);
  }
  const fatal = result.messages.filter((message) => message.fatal === true);
  if (fatal.length > 0) {
    throw new Error(`${file} could not be parsed: ${fatal.map((m) => m.message).join('; ')}`);
  }
  return {
    refusedLines: [
      ...new Set(
        result.messages
          .filter((message) => RULES.includes(message.ruleId ?? ''))
          .map((message) => message.line),
      ),
    ].sort((a, b) => a - b),
    controlFired: result.messages.some((message) => message.ruleId === CONTROL),
  };
}

/** The four calling imports, each on its own line. */
const CALLING_IMPORTS = [
  "import { startActivityAsync } from 'expo-intent-launcher';",
  "import * as ExpoLinking from 'expo-linking';",
  "import { PermissionsAndroid } from 'react-native';",
  "import { Linking } from 'react-native';",
];

/** The same four, written the other ways a file could: a default, a named, renamed, side effect, among others. */
const OTHER_FORMS = [
  "import IntentLauncher from 'expo-intent-launcher';",
  "import 'expo-intent-launcher';",
  "import { openURL } from 'expo-linking';",
  "import { Linking as Dialer } from 'react-native';",
  "import { Text, PermissionsAndroid as Permissions, View } from 'react-native';",
];

/** CALL-02-AC2's refused pieces, which the same rule's options must keep refusing. */
const FRAME_IMPORTS = [
  "import { Modal } from 'react-native';",
  "import { ScrollView } from 'react-native';",
];

/** Line numbers 1 to n. */
const lines1to = (n) => Array.from({ length: n }, (_, at) => at + 1);

/** Files under apps/mobile/src/ other than phone.ts, where the four are refused. */
const NOT_PHONE = [
  `${APP}/features/call/call-button.tsx`,
  `${APP}/features/call/probe-dialer.tsx`,
  `${APP}/features/call/phone.tsx`,
  `${APP}/features/call/nested/phone.ts`,
  `${APP}/features/call/probe.test.tsx`,
  `${APP}/features/grp/home-screen.tsx`,
  `${APP}/features/grp/phone.ts`,
  `${APP}/app/probe-route.tsx`,
  `${APP}/shared/ui/probe-screen.tsx`,
  `${APP}/shared/probe.ts`,
];

describe('CALL-01-AC6: only features/call/phone.ts may import what places a call or opens the dialer', () => {
  test.each(NOT_PHONE)(
    'CALL-01-AC6: in %s, each of the four imports, expo-intent-launcher, expo-linking, and PermissionsAndroid and Linking from react-native, is refused, each on its own line',
    async (file) => {
      const { refusedLines, controlFired } = await lintProbe(file, CALLING_IMPORTS);

      expect(controlFired).toBe(true);
      expect(refusedLines).toEqual(lines1to(CALLING_IMPORTS.length));
    },
  );

  test.each([`${APP}/features/call/probe-dialer.tsx`, `${APP}/features/grp/home-screen.tsx`])(
    'CALL-01-AC6: in %s, the other ways of writing them are refused too: a default import, a side effect, a named import from expo-linking, Linking renamed, and PermissionsAndroid among open pieces',
    async (file) => {
      const { refusedLines, controlFired } = await lintProbe(file, OTHER_FORMS);

      expect(controlFired).toBe(true);
      expect(refusedLines).toEqual(lines1to(OTHER_FORMS.length));
    },
  );

  test(`CALL-01-AC6: in ${PHONE}, the four are allowed: no refusal`, async () => {
    const { refusedLines, controlFired } = await lintProbe(PHONE, CALLING_IMPORTS);

    expect(controlFired).toBe(true);
    expect(refusedLines).toEqual([]);
  });

  test.each(NOT_PHONE)(
    'CALL-01-AC6: in %s, React Native’s other pieces stay open: View, Text, Pressable, Platform and AppState are not refused',
    async (file) => {
      const { refusedLines, controlFired } = await lintProbe(file, [
        "import { AppState, Platform, Pressable, Text, View } from 'react-native';",
      ]);

      expect(controlFired).toBe(true);
      expect(refusedLines).toEqual([]);
    },
  );

  test.each([PHONE, `${APP}/features/grp/home-screen.tsx`, `${APP}/features/call/call-button.tsx`])(
    'CALL-02-AC2 beside CALL-01-AC6: in %s, Modal and ScrollView from react-native are still refused, so the calling rule’s options did not replace the frame rule’s',
    async (file) => {
      const { refusedLines, controlFired } = await lintProbe(file, FRAME_IMPORTS);

      expect(controlFired).toBe(true);
      expect(refusedLines).toEqual(lines1to(FRAME_IMPORTS.length));
    },
  );
});

describe('CALL-01-AC6: the repository’s own app passes the rule, with the rule in place', () => {
  test('CALL-01-AC6: ESLint over apps/mobile/src, with the repository’s configuration as gate:static runs it, reports nothing against the rule; and the rule is there, firing on a probe outside phone.ts', async () => {
    const probe = await lintProbe(`${APP}/features/grp/home-screen.tsx`, CALLING_IMPORTS);
    expect(probe.refusedLines).toEqual(lines1to(CALLING_IMPORTS.length));

    const repository = new ESLint({
      cwd: ROOT,
      ruleFilter: ({ ruleId }) => RULES.includes(ruleId),
    });
    const results = await repository.lintFiles([`${APP}/**/*.{ts,tsx}`]);
    const against = results.flatMap((result) =>
      result.messages
        .filter((message) => RULES.includes(message.ruleId ?? ''))
        .map(
          (message) =>
            `${path.relative(ROOT, result.filePath)}:${String(message.line)} ${message.message}`,
        ),
    );

    expect(results.length).toBeGreaterThan(0);
    expect(against).toEqual([]);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// Review loop 2: the other ways to the same native code.
// ---------------------------------------------------------------------------

/** A rule a refusal may come from: ESLint's no-restricted-* family, in any plugin's form. */
const REFUSING = /(?:^|\/)no-restricted-[a-z-]+$/;

/** ESLint as probeLint, reporting every rule of the no-restricted-* family. */
const refusalLint = new ESLint({
  cwd: ROOT,
  overrideConfig: {
    languageOptions: { parserOptions: { projectService: false, project: null } },
  },
  ruleFilter: ({ ruleId }) => REFUSING.test(ruleId) || ruleId === CONTROL,
});

/**
 * Lints `lines` as the file `file`, with a `debugger;` after them: every
 * refusal from the no-restricted-* family, with its line, rule and message,
 * the lines refused, and whether the control fired.
 */
async function refusalsOf(file, lines) {
  const [result] = await refusalLint.lintText(`${[...lines, 'debugger;'].join('\n')}\n`, {
    filePath: path.join(ROOT, file),
  });
  if (result === undefined) {
    throw new Error(`ESLint returned nothing for ${file}`);
  }
  const fatal = result.messages.filter((message) => message.fatal === true);
  if (fatal.length > 0) {
    throw new Error(`${file} could not be parsed: ${fatal.map((m) => m.message).join('; ')}`);
  }
  const refusals = result.messages
    .filter((message) => REFUSING.test(message.ruleId ?? ''))
    .map(({ line, ruleId, message }) => ({ line, rule: ruleId, message }));
  return {
    refusals,
    refusedLines: [...new Set(refusals.map(({ line }) => line))].sort((a, b) => a - b),
    controlFired: result.messages.some((message) => message.ruleId === CONTROL),
  };
}

/**
 * Each other way in, as [what it is, its lines, the line that must be
 * refused]. CALL-01-AC6's list (review loop 2), with Claude's additions under
 * D-031 that the spec names, and an import() whose source is a template with
 * an expression beside the one whose source is a variable.
 */
const OTHER_WAYS = [
  [
    'a deep path into expo-intent-launcher',
    ["import { startActivityAsync } from 'expo-intent-launcher/build/IntentLauncher';"],
    1,
  ],
  ['a deep path into expo-linking', ["import { openURL } from 'expo-linking/build/Linking';"], 1],
  [
    'a deep path to react-native’s Linking',
    ["import Linking from 'react-native/Libraries/Linking/Linking';"],
    1,
  ],
  [
    'a deep path to react-native’s PermissionsAndroid',
    [
      "import PermissionsAndroid from 'react-native/Libraries/PermissionsAndroid/PermissionsAndroid';",
    ],
    1,
  ],
  [
    'a deep path into expo-modules-core',
    ["import { requireNativeModule } from 'expo-modules-core/build/requireNativeModule';"],
    1,
  ],
  ['NativeModules from react-native', ["import { NativeModules } from 'react-native';"], 1],
  [
    'TurboModuleRegistry from react-native',
    ["import { TurboModuleRegistry } from 'react-native';"],
    1,
  ],
  [
    'requireNativeModule from expo-modules-core',
    ["import { requireNativeModule } from 'expo-modules-core';"],
    1,
  ],
  [
    'requireOptionalNativeModule from expo-modules-core',
    ["import { requireOptionalNativeModule } from 'expo-modules-core';"],
    1,
  ],
  ['requireNativeModule from expo', ["import { requireNativeModule } from 'expo';"], 1],
  [
    'requireOptionalNativeModule from expo',
    ["import { requireOptionalNativeModule } from 'expo';"],
    1,
  ],
  ['a dynamic import of expo-linking', ["void import('expo-linking');"], 1],
  [
    'a dynamic import of expo-intent-launcher, as a template with no expressions',
    ['void import(`expo-intent-launcher`);'],
    1,
  ],
  ['a dynamic import of react-native', ["void import('react-native');"], 1],
  [
    'a dynamic import of react-native’s Linking by its deep path',
    ["void import('react-native/Libraries/Linking/Linking');"],
    1,
  ],
  [
    'a dynamic import whose source is a variable',
    ["const source = 'expo-linking';", 'void import(source);'],
    2,
  ],
  [
    'a dynamic import whose source is a template with an expression',
    ["const name = 'linking';", 'void import(`expo-${name}`);'],
    2,
  ],
  [
    'a namespace import of react-native, then RN.Linking',
    ["import * as RN from 'react-native';", "void RN.Linking.openURL('tel:');"],
    1,
  ],
  [
    'a namespace import of expo, then a native module',
    ["import * as Expo from 'expo';", "Expo.requireNativeModule('ExpoIntentLauncher');"],
    1,
  ],
  [
    'a namespace import of expo-modules-core, then a native module',
    [
      "import * as Core from 'expo-modules-core';",
      "Core.requireNativeModule('ExpoIntentLauncher');",
    ],
    1,
  ],
  [
    'a default import of react-native',
    ["import RN from 'react-native';", "void RN.Linking.openURL('tel:');"],
    1,
  ],
  [
    'a default import of expo',
    ["import Expo from 'expo';", "Expo.requireNativeModule('ExpoIntentLauncher');"],
    1,
  ],
  [
    'a default import of expo-modules-core',
    ["import Core from 'expo-modules-core';", "Core.requireNativeModule('ExpoIntentLauncher');"],
    1,
  ],
];

/** The four places the spec names, each a block of eslint.config.mjs with its own options. */
const FOUR_PLACES = [
  `${APP}/features/grp/home-screen.tsx`,
  `${APP}/features/call/call-button.tsx`,
  `${APP}/app/probe-route.tsx`,
  `${APP}/shared/ui/probe-screen.tsx`,
];

/** Every other way in, in every one of the four places: [place, what, lines, line]. */
const OTHER_WAYS_IN_EACH_PLACE = FOUR_PLACES.flatMap((place) =>
  OTHER_WAYS.map(([what, lines, line]) => [place, what, lines, line]),
);

/** What stays open in the same files: a type query, a relative import(), and React Native's other pieces. */
const STILL_OPEN = [
  "type RN = typeof import('react-native');",
  "void import('./local-module');",
  "import { AppState, Platform, Pressable, Text, View } from 'react-native';",
];

describe('CALL-01-AC6 (review loop 2): the other ways to what places a call are refused outside phone.ts', () => {
  test.each(OTHER_WAYS_IN_EACH_PLACE)(
    'CALL-01-AC6: in %s, %s is refused, on its line',
    async (place, _what, lines, line) => {
      const { refusedLines, controlFired } = await refusalsOf(place, lines);

      expect(controlFired).toBe(true);
      expect(refusedLines).toContain(line);
    },
  );

  test.each(FOUR_PLACES)(
    'CALL-01-AC6: in %s, the controls stay open: typeof import(’react-native’), import(’./local-module’), and AppState, Platform, Pressable, Text and View from react-native',
    async (place) => {
      const { refusals, controlFired } = await refusalsOf(place, STILL_OPEN);

      expect(controlFired).toBe(true);
      expect(refusals).toEqual([]);
    },
  );

  // The spec says none of the probes is refused in phone.ts. One is, today,
  // and not by the calling rule: CALL-02-AC2's frame rule names react-native
  // with importNames in phone.ts too (Modal, Alert, SafeAreaView,
  // ScrollView), and no-restricted-imports refuses a namespace import of a
  // module whose importNames it restricts, as approach 1 says. That refusal
  // is the frame rule's, by design, and stays; what is held here is that the
  // calling rule refuses nothing in phone.ts, so every refusal there must be
  // the frame rule's, by its message.
  test.each(OTHER_WAYS)(
    `CALL-01-AC6: in ${PHONE}, %s is not refused by the calling rule: any refusal there is CALL-02-AC2’s frame rule’s`,
    async (_what, lines) => {
      const { refusals, controlFired } = await refusalsOf(PHONE, lines);

      expect(controlFired).toBe(true);
      expect(refusals.filter(({ message }) => !message.includes('CALL-02-AC2:'))).toEqual([]);
    },
  );

  test('CALL-01-AC6 beside AR-03: in a probe under apps/mobile/src/safety-core/, a dynamic import of expo-linking is refused, and Date.now() is still refused by the AR-03 clock rule, so the calling rule’s options did not replace the clock rule’s', async () => {
    const { refusals, controlFired } = await refusalsOf(`${APP}/safety-core/probe.ts`, [
      "void import('expo-linking');",
      'export const now = Date.now();',
    ]);

    expect(controlFired).toBe(true);
    expect(refusals.filter(({ line }) => line === 1)).not.toEqual([]);
    expect(
      refusals.filter(({ line, message }) => line === 2 && message.startsWith('AR-03:')),
    ).not.toEqual([]);
  });

  test('CALL-01-AC6: the whole repository, linted with its own configuration, passes every rule of the no-restricted-* family, the widened calling rule among them', async () => {
    const repository = new ESLint({
      cwd: ROOT,
      // The family reads no types, so type-aware parsing is left out: the
      // same refusals as gate:static's lint, in a fraction of the time.
      overrideConfig: {
        languageOptions: { parserOptions: { projectService: false, project: null } },
      },
      ruleFilter: ({ ruleId }) => REFUSING.test(ruleId),
    });
    const results = await repository.lintFiles(['.']);
    const against = results.flatMap((result) =>
      result.messages.map(
        (message) =>
          `${path.relative(ROOT, result.filePath)}:${String(message.line)} ${String(message.ruleId)} ${message.message}`,
      ),
    );

    // Not vacuous: the lint reached the app, phone.ts and the test files
    // that write `typeof import('react-native')` among it.
    expect(results.some((result) => result.filePath === path.join(ROOT, PHONE))).toBe(true);
    expect(
      results.some((result) =>
        result.filePath.endsWith(path.join('features', 'grp', 'home.test.tsx')),
      ),
    ).toBe(true);
    expect(against).toEqual([]);
  }, 300_000);
});
