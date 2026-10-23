// CALL-02-AC2 (L1): nothing the app draws can sit over the 112 bar, so only
// the shared UI kit may import what could: a no-restricted-imports rule in
// the repository's ESLint configuration (eslint.config.mjs, or the shared
// config it loads) refuses, in any file under apps/mobile/src/ outside
// src/shared/ui/,
//   - `Modal`, `Alert`, `SafeAreaView` or `ScrollView` from 'react-native'
//     (a Modal or a native Alert sits over the bar until dismissed; a
//     SafeAreaView or ScrollView is how a screen would build its own frame,
//     without the bar), and
//   - `SafeAreaView` from 'react-native-safe-area-context', the one `Screen`
//     uses today;
// and refuses `Screen` itself in any file outside src/app/ and src/shared/ui/:
// the routes draw `Screen`, the features never do (CALL-02-AC1, approach 1).
//
// In the style of LOST-02-AC25's fixture tests: ESLint is run, with the
// repository's own configuration, from the repository's root, on probe files
// placed where the rule must and must not apply. The probes exist only in
// memory, so type-aware parsing is switched off for them, and only the rule
// under test, in either of its two forms (ESLint's own, or typescript-eslint's
// with the same name), is reported, beside one control rule, no-debugger,
// which shows each probe was linted by the repository's configuration at all.
// And, last, the repository's own app passes the rule.
//
// This file is counted by req:coverage (no fixtures-only marker): CALL-02-AC2
// is a criterion of task 2.
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, test } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP = 'apps/mobile/src';

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
 * Lints `lines` as the file `file`, with a `debugger;` after them: the
 * messages of the rule, by line, and whether the control fired.
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

/** The five imports only src/shared/ui/ may make, each on its own line. */
const FRAME_IMPORTS = [
  "import { Modal } from 'react-native';",
  "import { Alert } from 'react-native';",
  "import { SafeAreaView } from 'react-native';",
  "import { ScrollView } from 'react-native';",
  "import { SafeAreaView as SafeArea } from 'react-native-safe-area-context';",
];

/** `Screen`, imported from the kit by `file`, the ways a file could: the folder, its index, its file, renamed. */
const screenImports = (file) => {
  const kit = path.posix.relative(path.posix.dirname(file), `${APP}/shared/ui`);
  const from = kit.startsWith('.') ? kit : `./${kit}`;
  return [
    `import { Screen } from '${from}';`,
    `import { Screen as Frame } from '${from}/index';`,
    `import { Screen as Drawn } from '${from}/screen';`,
  ];
};

/** Line numbers 1 to n. */
const lines1to = (n) => Array.from({ length: n }, (_, at) => at + 1);

/** Files outside src/shared/ui/, where the five are refused. */
const OUTSIDE_SHARED_UI = [
  `${APP}/features/grp/probe-view.tsx`,
  `${APP}/features/call/probe-bar.tsx`,
  `${APP}/features/grp/nested/probe.ts`,
  `${APP}/app/probe-route.tsx`,
  `${APP}/shared/translations/probe.ts`,
  `${APP}/shared/probe-ui.tsx`,
  `${APP}/features/grp/probe.test.tsx`,
];

/** Files outside src/app/ and src/shared/ui/, where Screen is refused. */
const OUTSIDE_APP_AND_SHARED_UI = OUTSIDE_SHARED_UI.filter(
  (file) => !file.startsWith(`${APP}/app/`),
);

describe('CALL-02-AC2: only src/shared/ui/ may import Modal, Alert, SafeAreaView or ScrollView, and only src/app/ and src/shared/ui/ may import Screen', () => {
  test.each(OUTSIDE_SHARED_UI)(
    'CALL-02-AC2: in %s, each of the five imports, Modal, Alert, SafeAreaView and ScrollView from react-native and SafeAreaView from react-native-safe-area-context, is refused, each on its own line',
    async (file) => {
      const { refusedLines, controlFired } = await lintProbe(file, FRAME_IMPORTS);

      expect(controlFired).toBe(true);
      expect(refusedLines).toEqual(lines1to(FRAME_IMPORTS.length));
    },
  );

  test.each(OUTSIDE_APP_AND_SHARED_UI)(
    'CALL-02-AC2: in %s, Screen is refused, imported from the kit’s folder, its index or its own file, renamed or not',
    async (file) => {
      const imports = screenImports(file);
      const { refusedLines, controlFired } = await lintProbe(file, imports);

      expect(controlFired).toBe(true);
      expect(refusedLines).toEqual(lines1to(imports.length));
    },
  );

  test('CALL-02-AC2: a route in src/app/ may import Screen: no refusal', async () => {
    const file = `${APP}/app/probe-route.tsx`;
    const { refusedLines, controlFired } = await lintProbe(file, screenImports(file));

    expect(controlFired).toBe(true);
    expect(refusedLines).toEqual([]);
  });

  test.each([`${APP}/shared/ui/probe-screen.tsx`, `${APP}/shared/ui/nested/probe.ts`])(
    'CALL-02-AC2: inside src/shared/ui/, %s may import all five and Screen: no refusal',
    async (file) => {
      const { refusedLines, controlFired } = await lintProbe(file, [
        ...FRAME_IMPORTS,
        ...screenImports(file),
      ]);

      expect(controlFired).toBe(true);
      expect(refusedLines).toEqual([]);
    },
  );

  test.each(OUTSIDE_SHARED_UI)(
    'CALL-02-AC2: in %s, React Native’s other pieces stay open: View, Text, Pressable and ActivityIndicator are not refused',
    async (file) => {
      const { refusedLines, controlFired } = await lintProbe(file, [
        "import { ActivityIndicator, Pressable, Text, View } from 'react-native';",
        "import { useSafeAreaInsets } from 'react-native-safe-area-context';",
      ]);

      expect(controlFired).toBe(true);
      expect(refusedLines).toEqual([]);
    },
  );

  test('CALL-02-AC2: one import that names a refused piece among open ones is refused too', async () => {
    const { refusedLines } = await lintProbe(`${APP}/features/grp/probe-view.tsx`, [
      "import { Text, ScrollView, View } from 'react-native';",
    ]);

    expect(refusedLines).toEqual([1]);
  });
});

describe('CALL-02-AC2: the repository’s own app passes the rule, with the rule in place', () => {
  test('CALL-02-AC2: ESLint over apps/mobile/src, with the repository’s configuration as gate:static runs it, reports nothing against the rule; and the rule is there, firing on a probe', async () => {
    const probe = await lintProbe(`${APP}/features/grp/probe-view.tsx`, FRAME_IMPORTS);
    expect(probe.refusedLines).toEqual(lines1to(FRAME_IMPORTS.length));

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
