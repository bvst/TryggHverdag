// req-coverage: fixtures-only — the IDs below name the architecture rules the
// config enforces, not product requirements.
//
// The clock rules had no tests, although the comment beside them said they did.
// They are the static half of AR-03: if the selector stops matching, domain
// code can read the machine's clock and nothing goes red — the failure is a
// safety decision made against the wrong time, discovered in production.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ESLint, Linter } from 'eslint';
import { afterEach, describe, expect, test } from 'vitest';
import { CLOCK_FREE_PATHS, clockFreeRules } from './index.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');

const linter = new Linter();

/** @returns {string[]} the messages the clock rules produce for this source. */
const complaints = (code) =>
  linter
    .verify(code, [{ files: ['**/*.ts'], rules: clockFreeRules }], 'domain/thing.ts')
    .map((m) => m.message);

describe('AR-03: safety code must not read the clock', () => {
  test.each([
    ['new Date()', 'const t = new Date();'],
    ['Date.now()', 'const t = Date.now();'],
    ['performance.now()', 'const t = performance.now();'],
  ])('%s is refused', (_name, code) => {
    expect(complaints(code)).toEqual([expect.stringContaining('AR-03')]);
  });

  test.each([
    ['a string the caller supplied', 'const t = new Date(text);'],
    ['PostgreSQL text', "const t = new Date('2026-09-23T05:18:34.386Z');"],
    ['milliseconds', 'const t = new Date(ms);'],
  ])('parsing %s is allowed — it reads no clock', (_name, code) => {
    // This is not a loosening for convenience. Refusing it moved the one
    // conversion from what the database said into a Date out of domain/, and
    // so out of the mutation gate that guards exactly this kind of code (D-067).
    expect(complaints(code)).toEqual([]);
  });
});

describe('AR-06: safety code must not keep time in memory', () => {
  test.each([['setTimeout'], ['setInterval']])('%s is refused', (name) => {
    expect(complaints(`${name}(fn, 1000);`)).toEqual([expect.stringContaining('AR-06')]);
  });
});

/**
 * The messages the clock rules produce for `code` in a file at `file`, with the
 * rules applied the way the repository applies them: to CLOCK_FREE_PATHS, and
 * nowhere else. Every .ts and .tsx file is linted; only those paths get the
 * clock rules.
 */
const complaintsAt = (file, code) =>
  linter
    .verify(
      code,
      [
        {
          files: ['**/*.{ts,tsx}'],
          languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
        },
        { files: CLOCK_FREE_PATHS, rules: clockFreeRules },
      ],
      file,
    )
    .map((m) => m.message);

/** A screen in the safety core that reads the clock while it renders. */
const COMPONENT = 'export const Countdown = () => <Text>{Date.now()}</Text>;';

describe('the paths these rules cover', () => {
  test('the server domain and the app safety core, which is where decisions are made', () => {
    // The safety core's .tsx files too, amended 2026-09-26: .tsx is normal in
    // the app, and a component in the safety core is safety code like any other.
    //
    // And the server's modules, amended for BUG-10 (D-092, D-095): the
    // journey service decides when a journey started, and every module is
    // handed its clock, so none of them may read one.
    expect(CLOCK_FREE_PATHS).toEqual([
      'apps/server/src/domain/**/*.ts',
      'apps/server/src/modules/**/*.ts',
      'apps/mobile/src/safety-core/**/*.{ts,tsx}',
    ]);
  });

  test.each([
    'apps/mobile/src/safety-core/countdown.tsx',
    'apps/mobile/src/safety-core/journey/check-in-view.tsx',
  ])('AR-03: a .tsx file in the app safety core may not read the clock either: %s', (file) => {
    expect(complaintsAt(file, COMPONENT)).toEqual([expect.stringContaining('AR-03')]);
  });

  test.each([
    'apps/server/src/modules/journeys/service.ts',
    'apps/server/src/modules/health/service.ts',
  ])('BUG-10: AR-03: a .ts file in the server modules may not read the clock: %s', (file) => {
    expect(complaintsAt(file, 'const t = Date.now();')).toEqual([expect.stringContaining('AR-03')]);
  });

  // REL-10 (the spec's AC5, its lint clause): the staging canary decides
  // everything on the database's times, so its domain file and its module
  // read no clock and keep no timer of their own; the module is handed a
  // Wait. Both sit under paths the rules already cover, so this passes before
  // the files exist, and holds the day a path list is narrowed.
  test.each(['apps/server/src/domain/canary.ts', 'apps/server/src/modules/canary/run.ts'])(
    'REL-10-AC5: AR-03: the canary’s %s may not read the clock, nor keep time in memory',
    (file) => {
      expect(complaintsAt(file, 'const t = Date.now();')).toEqual([
        expect.stringContaining('AR-03'),
      ]);
      expect(complaintsAt(file, 'const d = new Date();')).toEqual([
        expect.stringContaining('AR-03'),
      ]);
      expect(complaintsAt(file, 'setTimeout(check, 2000);')).toEqual([
        expect.stringContaining('AR-06'),
      ]);
    },
  );

  test('AR-06: nor keep time in memory there', () => {
    expect(
      complaintsAt('apps/mobile/src/safety-core/countdown.tsx', 'setInterval(tick, 1000);'),
    ).toEqual([expect.stringContaining('AR-06')]);
  });

  test('a .ts file in the app safety core is still covered', () => {
    expect(complaintsAt('apps/mobile/src/safety-core/journey.ts', 'const t = Date.now();')).toEqual(
      [expect.stringContaining('AR-03')],
    );
  });

  test('a .tsx file outside the safety core is not these rules to judge', () => {
    // Not vacuous the other way either: the same component elsewhere passes,
    // so the complaints above come from the path, not from the harness.
    expect(complaintsAt('apps/mobile/src/app/index.tsx', COMPONENT)).toEqual([]);
  });
});

// BUG-42 (BUG-26 is the same finding, logged earlier). The stop gate's lint is
// `pnpm run lint`, which is `eslint .` from the repository root. ESLint walks
// dot-folders and does not read .gitignore, so it walks into Stryker's
// sandbox, .stryker-tmp/sandbox-*. That sandbox is a copy of the checkout in
// which every file Stryker mutates carries `// @ts-nocheck`. While a mutation
// run is going, and after one is killed at its limit and leaves its sandbox
// behind, the gate then fails on Stryker's copies rather than on the branch.
// On 2026-10-10 it reported 272 problems, one of them:
//   .stryker-tmp/sandbox-Pvtahg/packages/test-kit/src/fake-push.ts
//     24:1  error  Do not use "@ts-nocheck" because it alters compilation
//                  errors  @typescript-eslint/ban-ts-comment
// The ignore has to cover that folder and nothing beside it. A wider one would
// stop the gate reading part of the branch, and the gate would then pass for
// code it never read.
//
// Prettier needs no change. `prettier --check .` reads the root .gitignore,
// which lists .stryker-tmp/, so the format check already skips the sandbox.
describe('BUG-42: lint reads the branch, and never the Stryker sandbox in .stryker-tmp/', () => {
  const made = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A file Stryker has instrumented: `@ts-nocheck` comes first, as in every file it mutates. */
  const INSTRUMENTED = '// @ts-nocheck\nexport const pushed: string[] = [];\n';

  /** Where the failing line of 2026-10-10 came from. */
  const SANDBOX = '.stryker-tmp/sandbox-Pvtahg';

  /**
   * A checkout in miniature, outside the repository, with a Stryker sandbox in
   * it as Stryker leaves one. Its eslint.config.mjs and .gitignore are this
   * repository's, word for word, and it reaches the repository's node_modules,
   * so it is linted by the same rules and ignores as `pnpm run lint`.
   *
   * The sandbox is what Stryker makes: a copy of the checkout, with its own
   * eslint.config.mjs and with node_modules linked in, and its mutated files
   * instrumented. Its config copy matters. ESLint 10 lints each file with the
   * config nearest to it, so the root config can keep these files out only by
   * not walking into .stryker-tmp/ in the first place. Ignoring the files
   * alone is not enough.
   *
   * Beside the sandbox are two things the lint must still read: the branch's
   * own copy of the same file, which carries the same comment and so must be
   * reported, and a folder whose name only begins like Stryker's.
   */
  function checkout() {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'bug42-lint-')));
    made.push(dir);
    const put = (file, text) => {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), text);
    };
    const copy = (from, to = from) => {
      put(to, readFileSync(path.join(ROOT, from), 'utf8'));
    };
    const linkNodeModules = (into) => {
      symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, into, 'node_modules'));
    };

    copy('eslint.config.mjs');
    copy('.gitignore');
    linkNodeModules('.');
    copy('packages/test-kit/tsconfig.json');
    put('packages/test-kit/src/fake-push.ts', INSTRUMENTED);

    copy('eslint.config.mjs', `${SANDBOX}/eslint.config.mjs`);
    copy('.gitignore', `${SANDBOX}/.gitignore`);
    linkNodeModules(SANDBOX);
    copy('packages/test-kit/tsconfig.json', `${SANDBOX}/packages/test-kit/tsconfig.json`);
    put(`${SANDBOX}/packages/test-kit/src/fake-push.ts`, INSTRUMENTED);

    put('.stryker-tmp-old/notes.mjs', 'debugger;\n');
    return dir;
  }

  test('BUG-42: `eslint .`, the gate’s lint, reports nothing from a Stryker sandbox in .stryker-tmp/, and still reports the branch’s own @ts-nocheck', async () => {
    // The lint step of the gate, so the walk below is the one the gate does.
    // If the gate stops linting this way, this says so, rather than passing
    // about a walk the gate no longer does.
    const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
    expect(scripts['gate:static']).toContain('pnpm run lint');
    expect(scripts.lint).toBe('eslint .');

    const dir = checkout();
    const results = await new ESLint({ cwd: dir }).lintFiles(['.']);
    const relative = (file) => path.relative(dir, file).split(path.sep).join('/');
    const linted = results.map((result) => relative(result.filePath));
    const problems = Object.fromEntries(
      results
        .filter((result) => result.messages.length > 0)
        .map((result) => [
          relative(result.filePath),
          result.messages.map((message) => message.ruleId ?? message.message),
        ]),
    );

    expect(
      linted.filter((file) => file.startsWith('.stryker-tmp/')),
      'files in Stryker’s sandbox were linted',
    ).toEqual([]);
    // The control. The branch's own @ts-nocheck is still an error. A folder
    // named like Stryker's, but not Stryker's, is still read. So the
    // empty list above comes from the ignore and not from a walk that read
    // nothing.
    expect(problems).toEqual({
      'packages/test-kit/src/fake-push.ts': ['@typescript-eslint/ban-ts-comment'],
      '.stryker-tmp-old/notes.mjs': ['no-debugger'],
    });
  });

  test('BUG-42: in this repository, every path under .stryker-tmp/ is ignored by lint, and nothing beside it is', async () => {
    // Asked of the repository's own config, from its root, as
    // scripts/mobile-app.test.mjs asks it about the app. The paths need not
    // exist for ESLint to answer.
    const eslint = new ESLint({ cwd: ROOT });
    const ignored = async (file) => ({
      file,
      ignored: await eslint.isPathIgnored(path.join(ROOT, file)),
    });

    for (const file of [
      `${SANDBOX}/packages/test-kit/src/fake-push.ts`,
      `${SANDBOX}/apps/server/src/domain/journey.ts`,
      `${SANDBOX}/scripts/mutation.mjs`,
      `${SANDBOX}/eslint.config.mjs`,
    ]) {
      expect(await ignored(file)).toEqual({ file, ignored: true });
    }
    // The files those are copies of, the files around Stryker, and a folder
    // whose name only begins like Stryker's: none of them is Stryker's.
    for (const file of [
      'packages/test-kit/src/fake-push.ts',
      'apps/server/src/domain/journey.ts',
      'scripts/mutation.mjs',
      'stryker.config.mjs',
      'eslint.config.mjs',
      '.stryker-tmp-old/sandbox-Pvtahg/packages/test-kit/src/fake-push.ts',
    ]) {
      expect(await ignored(file)).toEqual({ file, ignored: false });
    }
  });
});
