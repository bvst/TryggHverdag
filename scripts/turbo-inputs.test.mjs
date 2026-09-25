/**
 * The typecheck gate hashed fewer files than TypeScript actually reads.
 *
 * `turbo.json` gives the typecheck task `inputs: ["src/**", "tsconfig.json",
 * "package.json"]`, but what tsc reads is decided by each package's tsconfig,
 * and `apps/server` adds `drizzle.config.ts` at its root. That file was outside
 * the cache key, so editing it did not invalidate anything: with a genuine type
 * error in it (`telemetry: false`, which tsc rejects as TS2353),
 * `pnpm run typecheck` answered `FULL TURBO` and exit 0. A stop gate that
 * reports success on code that does not compile is the silent failure the
 * non-negotiables in CLAUDE.md are written against.
 *
 * This compares the two lists themselves rather than pinning the one file, so
 * the next root-level entry added to an `include` cannot bring the hole back.
 * `tsc --showConfig` is the authority for what is checked: it resolves
 * `extends` and the include globs into the actual file list, which reading the
 * tsconfig by hand would not.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { matchesAnyGlob } from './lib/glob.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const turbo = JSON.parse(readFileSync(path.join(root, 'turbo.json'), 'utf8'));
const inputs = turbo.tasks.typecheck.inputs;

/**
 * Packages whose typecheck actually runs tsc: the ones with a tsconfig.
 *
 * Found in the workspace folders rather than listed. The list used to name
 * three packages by hand, and the app would have had to be added to it by
 * hand too (INF-06-AC1); the package after that would have been missed the
 * same way the root-level drizzle.config.ts was.
 */
const packages = ['apps', 'packages']
  .flatMap((group) =>
    readdirSync(path.join(root, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${group}/${entry.name}`),
  )
  .filter((p) => existsSync(path.join(root, p, 'tsconfig.json')));

/** Every file tsc reads for this package, relative to the package directory. */
function checkedFiles(pkg) {
  const cwd = path.join(root, pkg);
  const out = execFileSync(
    path.join(cwd, 'node_modules/.bin/tsc'),
    ['--showConfig', '-p', 'tsconfig.json'],
    {
      cwd,
      encoding: 'utf8',
    },
  );
  return (JSON.parse(out).files ?? []).map((f) => f.replace(/^\.\//, ''));
}

describe('the typecheck cache key covers everything TypeScript reads', () => {
  test('there are packages to check, and each one reads files', () => {
    expect(packages.length).toBeGreaterThan(0);
    for (const pkg of packages) expect(checkedFiles(pkg).length).toBeGreaterThan(0);
  });

  test('INF-06-AC1: the app is among them, so its typecheck key covers every file tsc reads there', () => {
    // The packages found before INF-06 are still found: deriving the list
    // must not lose one it used to name.
    expect(packages).toEqual(
      expect.arrayContaining(['apps/server', 'packages/contracts', 'packages/test-kit']),
    );
    expect(packages).toContain('apps/mobile');
  });

  for (const pkg of packages) {
    test(`every file tsc reads in ${pkg} is hashed by turbo`, () => {
      const missed = checkedFiles(pkg).filter((f) => !matchesAnyGlob(f, inputs));
      expect(missed, `not in turbo.json typecheck inputs (${inputs.join(', ')})`).toEqual([]);
    });
  }
});
