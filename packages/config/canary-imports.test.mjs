// REL-10-AC10: only the worker may reach the staging canary's adapter (AR-10;
// D-091 as D-128 amends it).
//
// apps/server/src/adapters/canary.ts holds the one insert of a device
// credential before the login task: the worker's registration of the
// canary's three fixed identities (D-128). D-091's "no route, seed or insert
// function creates a credential" keeps one narrow exception, held by an
// import rule beside D-108's:
//   - only apps/server/src/worker.ts, and tests, import adapters/canary.ts;
//   - the API's two files, api.ts and api-process.ts, cannot reach it at all,
//     through worker.ts or any other file, so no route can register a device.
//
// Run the way `pnpm run imports:check` runs them, as database-imports.test.mjs
// does: the real depcruise binary and the repository's
// .dependency-cruiser.cjs, over a small server written for each case into a
// temporary folder. The rule's name is the implementer's: the rules that hold
// this are the ones whose comment cites D-128, and each refusal must name one
// of them.
//
// This file is counted by req:coverage (no fixtures-only marker): REL-10-AC10
// is a criterion of its task, and the traceability job needs a counted test to
// name it. It names no other tracked requirement.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterAll, describe, expect, test } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DEPCRUISE = path.join(ROOT, 'node_modules', '.bin', 'depcruise');

/** The canary's adapter, where the fixtures put it. */
const ADAPTER = 'apps/server/src/adapters/canary.ts';

const made = [];

afterAll(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A relative import of `to` from the file `from`, as the server writes one. */
function specifierFor(from, to) {
  const relative = path.posix.relative(path.posix.dirname(from), to);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/** A file that imports each of `targets`, statically. */
function importing(from, targets) {
  return targets
    .map(
      (to, n) =>
        `import * as imported${String(n)} from '${specifierFor(from, to)}';\n` +
        `export const value${String(n)} = imported${String(n)};\n`,
    )
    .join('');
}

/** Writes `files` into a fresh folder, beside the canary's adapter, and runs the import check over it. */
function importCheck(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'canary-imports-'));
  made.push(dir);
  const all = { [ADAPTER]: "export const registerCanary = 'the canary';\n", ...files };
  for (const [file, text] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  const result = spawnSync(
    DEPCRUISE,
    ['--config', path.join(ROOT, '.dependency-cruiser.cjs'), 'apps'],
    {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    },
  );
  const output = `${result.stdout}${result.stderr}`;
  const violations = [...output.matchAll(/^\s*error (\S+): (\S+) → (\S+)$/gm)].map(
    ([, rule, from, to]) => ({ rule, from, to }),
  );
  return { status: result.status, output, violations };
}

/** The repository's rules that hold the canary's exception narrow: those whose comment cites D-128. */
function canaryRules() {
  return createRequire(import.meta.url)('./dependency-cruiser.cjs').forbidden.filter((rule) =>
    String(rule.comment ?? '').includes('D-128'),
  );
}

/** The violations of a canary rule from `from`. */
function refusalsFrom(check, from) {
  const names = canaryRules().map((rule) => rule.name);
  return check.violations.filter(
    (violation) => names.includes(violation.rule) && violation.from === from,
  );
}

/** Production files that may not import the canary's adapter, each importing it directly. */
const REFUSED = [
  'apps/server/src/api.ts',
  'apps/server/src/api-process.ts',
  'apps/server/src/bin/worker.ts',
  'apps/server/src/bin/api.ts',
  'apps/server/src/modules/canary/run.ts',
  'apps/server/src/modules/journeys/service.ts',
  'apps/server/src/domain/canary.ts',
  'apps/server/src/adapters/journeys.ts',
  'apps/server/src/adapters/device-credentials.ts',
  // Only named like the worker, in another folder.
  'apps/server/src/modules/worker.ts',
  'apps/server/src/adapters/worker.ts',
];

/** The one production importer, and test files of every kind. */
const ALLOWED = [
  'apps/server/src/worker.ts',
  'apps/server/src/canary.system.test.ts',
  'apps/server/src/canary.integration.test.ts',
  'apps/server/src/adapters/canary.test.ts',
  'apps/server/src/worker.test.ts',
];

describe('REL-10-AC10: only the worker imports the canary’s adapter, and the API cannot reach it', () => {
  test('REL-10-AC10: the rules exist, each an error, each saying why: AR-10 and D-128', () => {
    const rules = canaryRules();

    expect(rules.length, 'no import rule cites D-128').toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.severity, rule.name).toBe('error');
      expect(rule.comment, rule.name).toContain('AR-10');
    }
  });

  test.each(REFUSED)(
    'REL-10-AC10: %s importing adapters/canary.ts is refused, naming a rule that cites D-128',
    (from) => {
      const check = importCheck({ [from]: importing(from, [ADAPTER]) });

      // One rule or more: a file of the API's breaks the import rule and the
      // reachability rule alike, if both cite D-128.
      const refusals = refusalsFrom(check, from);
      expect(refusals.length, check.output).toBeGreaterThanOrEqual(1);
      expect(
        refusals.map(({ to }) => to),
        check.output,
      ).toEqual(refusals.map(() => ADAPTER));
      expect(check.status, check.output).not.toBe(0);
    },
  );

  test.each(ALLOWED)('REL-10-AC10: %s importing adapters/canary.ts is not refused', (from) => {
    const check = importCheck({ [from]: importing(from, [ADAPTER]) });

    expect(refusalsFrom(check, from), check.output).toEqual([]);
  });

  test.each(['apps/server/src/api.ts', 'apps/server/src/api-process.ts'])(
    'REL-10-AC10: %s cannot reach adapters/canary.ts through worker.ts either: refused, naming a rule that cites D-128',
    (from) => {
      const worker = 'apps/server/src/worker.ts';
      const check = importCheck({
        [worker]: importing(worker, [ADAPTER]),
        [from]: importing(from, [worker]),
      });

      expect(refusalsFrom(check, from), check.output).not.toEqual([]);
      expect(refusalsFrom(check, worker), check.output).toEqual([]);
      expect(check.status, check.output).not.toBe(0);
    },
  );

  test.each(['apps/server/src/api.ts', 'apps/server/src/api-process.ts'])(
    'REL-10-AC10: %s cannot reach adapters/canary.ts through a module of its own either',
    (from) => {
      const between = 'apps/server/src/modules/health/service.ts';
      const check = importCheck({
        [between]: importing(between, [ADAPTER]),
        [from]: importing(from, [between]),
      });

      expect(refusalsFrom(check, from), check.output).not.toEqual([]);
      expect(check.status, check.output).not.toBe(0);
    },
  );

  test('REL-10-AC10: (control) the API reaching neither, and the worker importing the adapter, pass: the refusals above are the imports’ doing', () => {
    const worker = 'apps/server/src/worker.ts';
    const check = importCheck({
      [worker]: importing(worker, [ADAPTER]),
      'apps/server/src/api.ts': "export const api = 'the API';\n",
      'apps/server/src/api-process.ts': importing('apps/server/src/api-process.ts', [
        'apps/server/src/api.ts',
      ]),
    });

    expect(check.violations, check.output).toEqual([]);
    expect(check.status, check.output).toBe(0);
  });
});
