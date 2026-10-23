// CALL-01-AC6 and CALL-02-AC13 (L1): two import rules that keep 112 and the
// call button from reaching what they must not need (AR-10, D-141).
//
// CALL-01-AC6: calling needs no server and no journey. The existing rules do
// not hold all of that: `no-cross-feature-internals` lets features/call reach
// another feature through its index, and `ui-cannot-reach-the-safety-core`
// lets it reach safety-core/index.ts (GRP-02.md, "The home screen task 2
// builds", item 1). So a new rule refuses any import from
// apps/mobile/src/features/call/ into apps/mobile/src/features/<another>/,
// its index included, or into apps/mobile/src/safety-core/, its index
// included; imports within call/ and into src/shared/ stay open.
//
// CALL-02-AC13: the error fallback, Screen and EmergencyBar must never reach
// the group session (useGroupSession), so a crash in it, or in the layout's
// providers, still shows 112. So a rule beside it refuses any import from
// apps/mobile/src/shared/ui/ into apps/mobile/src/features/ but
// features/call's index. With CALL-01-AC6's rule, nothing in shared/ui/ can
// reach features/grp/ at all.
//
// Run the way `pnpm run imports:check` runs them, as canary-imports.test.mjs
// and database-imports.test.mjs do: the real depcruise binary and the
// repository's .dependency-cruiser.cjs, over a small app written for each case
// into a temporary folder, every import's target written too, so each import
// resolves. The rules' names are the implementer's: the rules that hold each
// criterion are the ones whose comment cites it ('CALL-01-AC6',
// 'CALL-02-AC13'), and each refusal must name one of them. The refused cases
// are the control that each rule fires; the allowed ones, that it fires on
// nothing else. And, last, the repository's own app passes both.
//
// This file is counted by req:coverage (no fixtures-only marker): CALL-01-AC6
// and CALL-02-AC13 are criteria of task 2, and the traceability job needs a
// counted test to name them.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterAll, describe, expect, test } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DEPCRUISE = path.join(ROOT, 'node_modules', '.bin', 'depcruise');

const APP = 'apps/mobile/src';

const made = [];

afterAll(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A relative import of `to` from the file `from`; a folder's index as the folder itself when `asFolder`. */
function specifierFor(from, to, asFolder = false) {
  const target = asFolder ? path.posix.dirname(to) : to.replace(/\.tsx?$/, '');
  const relative = path.posix.relative(path.posix.dirname(from), target);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/** A case: a file, the file it imports, and whether it names a folder's index by the folder. */
const caseOf = (from, to, asFolder = false) => ({ from, to, asFolder });

/**
 * Writes each case's importing file, one static import per case, and every
 * target as a file of its own, into a fresh folder, and runs the import check
 * over its apps/.
 */
function importCheck(cases) {
  const dir = mkdtempSync(path.join(tmpdir(), 'call-imports-'));
  made.push(dir);
  const files = new Map(cases.map(({ to }) => [to, ['export const target = 1;']]));
  cases.forEach(({ from, to, asFolder }, n) => {
    const lines = files.get(from) ?? [];
    lines.push(
      `import * as imported${String(n)} from '${specifierFor(from, to, asFolder)}';`,
      `export const value${String(n)} = imported${String(n)};`,
    );
    files.set(from, lines);
  });
  for (const [file, lines] of files) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), `${lines.join('\n')}\n`);
  }
  const result = spawnSync(
    DEPCRUISE,
    ['--config', path.join(ROOT, '.dependency-cruiser.cjs'), 'apps'],
    { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } },
  );
  const output = `${result.stdout}${result.stderr}`;
  const violations = [...output.matchAll(/^\s*error (\S+): (\S+) → (\S+)$/gm)].map(
    ([, rule, from, to]) => ({ rule, from, to }),
  );
  return { status: result.status, output, violations };
}

/** The repository's rules that cite `id` in their comment. */
function rulesCiting(id) {
  return createRequire(import.meta.url)('./dependency-cruiser.cjs').forbidden.filter((rule) =>
    String(rule.comment ?? '').includes(id),
  );
}

/** The refusals, by a rule citing `id`, of the import from `from` to `to`. */
function refusalsOf(check, id, { from, to }) {
  const names = rulesCiting(id).map((rule) => rule.name);
  return check.violations.filter(
    (violation) => names.includes(violation.rule) && violation.from === from && violation.to === to,
  );
}

// ---------------------------------------------------------------------------
// CALL-01-AC6: features/call imports no other feature and not the safety core.
// ---------------------------------------------------------------------------

const CALL = `${APP}/features/call`;

/** Imports from features/call/ the rule refuses. */
const CALL_REFUSED = [
  caseOf(`${CALL}/call-button.tsx`, `${APP}/features/grp/index.ts`),
  caseOf(`${CALL}/emergency-bar.tsx`, `${APP}/features/grp/index.ts`, true),
  caseOf(`${CALL}/phone.ts`, `${APP}/features/grp/first-contact.ts`),
  caseOf(`${CALL}/nested/line.tsx`, `${APP}/features/grp/session.tsx`),
  caseOf(`${CALL}/index.ts`, `${APP}/features/jrn/index.ts`),
  caseOf(`${CALL}/call-button.tsx`, `${APP}/safety-core/index.ts`),
  caseOf(`${CALL}/permission.tsx`, `${APP}/safety-core/index.ts`, true),
  caseOf(`${CALL}/phone.ts`, `${APP}/safety-core/heartbeat.ts`),
];

/** Imports from features/call/ the rule allows: within call/, and into src/shared/. */
const CALL_ALLOWED = [
  caseOf(`${CALL}/call-button.tsx`, `${CALL}/phone.ts`),
  caseOf(`${CALL}/nested/line.tsx`, `${CALL}/index.ts`),
  caseOf(`${CALL}/emergency-bar.tsx`, `${APP}/shared/translations/index.ts`),
  caseOf(`${CALL}/emergency-bar.tsx`, `${APP}/shared/ui/palette.ts`),
  caseOf(`${CALL}/permission.tsx`, `${APP}/shared/ui/index.ts`, true),
];

describe('CALL-01-AC6: features/call imports no other feature and not the safety core', () => {
  const check = importCheck([...CALL_REFUSED, ...CALL_ALLOWED]);

  test('CALL-01-AC6: the repository has a rule citing CALL-01-AC6 in its comment', () => {
    expect(rulesCiting('CALL-01-AC6').map((rule) => rule.name)).not.toEqual([]);
  });

  test.each(CALL_REFUSED)(
    'CALL-01-AC6: $from importing $to is refused by a rule citing CALL-01-AC6',
    (each) => {
      expect(refusalsOf(check, 'CALL-01-AC6', each), check.output).not.toEqual([]);
    },
  );

  test.each(CALL_ALLOWED)(
    'CALL-01-AC6: $from importing $to, within call/ or into src/shared/, is not refused by it',
    (each) => {
      expect(refusalsOf(check, 'CALL-01-AC6', each)).toEqual([]);
    },
  );

  test('CALL-01-AC6: the rule is about features/call alone: features/grp importing call’s index is not refused by it', () => {
    const other = importCheck([
      caseOf(`${APP}/features/grp/home-screen.tsx`, `${CALL}/index.ts`),
      caseOf(`${APP}/features/grp/first-contact-screen.tsx`, `${CALL}/index.ts`, true),
    ]);

    expect(
      other.violations.filter((violation) =>
        rulesCiting('CALL-01-AC6').some((rule) => rule.name === violation.rule),
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CALL-02-AC13: shared/ui imports nothing of features/ but call's index.
// ---------------------------------------------------------------------------

const SHARED_UI = `${APP}/shared/ui`;

/** Imports from shared/ui/ the rule refuses. */
const UI_REFUSED = [
  caseOf(`${SHARED_UI}/screen.tsx`, `${APP}/features/grp/index.ts`),
  caseOf(`${SHARED_UI}/error-fallback.tsx`, `${APP}/features/grp/index.ts`, true),
  caseOf(`${SHARED_UI}/error-fallback.tsx`, `${APP}/features/grp/session.tsx`),
  caseOf(`${SHARED_UI}/nested/kit.tsx`, `${APP}/features/call/emergency-bar.tsx`),
  caseOf(`${SHARED_UI}/screen.tsx`, `${APP}/features/call/phone.ts`),
  caseOf(`${SHARED_UI}/index.ts`, `${APP}/features/jrn/index.ts`),
];

/** Imports from shared/ui/ the rule allows: call's index, and src/shared/. */
const UI_ALLOWED = [
  caseOf(`${SHARED_UI}/screen.tsx`, `${APP}/features/call/index.ts`),
  caseOf(`${SHARED_UI}/error-fallback.tsx`, `${APP}/features/call/index.ts`, true),
  caseOf(`${SHARED_UI}/error-fallback.tsx`, `${APP}/shared/translations/index.ts`),
  caseOf(`${SHARED_UI}/screen.tsx`, `${SHARED_UI}/palette.ts`),
];

describe('CALL-02-AC13: shared/ui imports nothing of features/ but features/call’s index', () => {
  const check = importCheck([...UI_REFUSED, ...UI_ALLOWED]);

  test('CALL-02-AC13: the repository has a rule citing CALL-02-AC13 in its comment', () => {
    expect(rulesCiting('CALL-02-AC13').map((rule) => rule.name)).not.toEqual([]);
  });

  test.each(UI_REFUSED)(
    'CALL-02-AC13: $from importing $to is refused by a rule citing CALL-02-AC13',
    (each) => {
      expect(refusalsOf(check, 'CALL-02-AC13', each), check.output).not.toEqual([]);
    },
  );

  test.each(UI_ALLOWED)(
    'CALL-02-AC13: $from importing $to, call’s index or src/shared/, is not refused by it',
    (each) => {
      expect(refusalsOf(check, 'CALL-02-AC13', each)).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------
// The repository itself passes both.
// ---------------------------------------------------------------------------

describe('CALL-01-AC6 and CALL-02-AC13: the repository’s own app passes the import check with both rules in place', () => {
  test('CALL-01-AC6 and CALL-02-AC13: depcruise over apps/mobile/src, as gate:static runs it, finds nothing against either rule, and both rules are there to find it', () => {
    const names = [...rulesCiting('CALL-01-AC6'), ...rulesCiting('CALL-02-AC13')].map(
      (rule) => rule.name,
    );
    const result = spawnSync(
      DEPCRUISE,
      ['--config', path.join(ROOT, '.dependency-cruiser.cjs'), APP],
      { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } },
    );
    const output = `${result.stdout}${result.stderr}`;
    const against = [...output.matchAll(/^\s*error (\S+): (\S+) → (\S+)$/gm)]
      .filter(([, rule]) => names.includes(rule))
      .map(([line]) => line.trim());

    expect(rulesCiting('CALL-01-AC6').length).toBeGreaterThan(0);
    expect(rulesCiting('CALL-02-AC13').length).toBeGreaterThan(0);
    expect(against).toEqual([]);
    expect(output).toMatch(/modules?, \d+ dependenc/);
  });
});
