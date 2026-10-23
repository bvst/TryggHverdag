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
