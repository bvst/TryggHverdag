// req-coverage: fixtures-only — the test names below are sample data for the drill report.
//
// INF-10-AC12: `pnpm run gate:drills` turns the drill file's results into the
// roadmap's nine rows and a verdict, and can never pass vacuously.
//
// What these tests expect of scripts/lib/gate-drills.mjs:
//
//   drillReport(results, { oasdiff }) → { rows, exitCode, text }
//
//   results  every test the drill file ran, each as { name, status }: the name
//            in full (the describe titles, then the test's own), the status as
//            Vitest's JSON reporter gives it: 'passed', 'failed', 'skipped',
//            'todo' or 'pending'
//   oasdiff  whether oasdiff works on this machine, asked by running it, the
//            way gate:full asks whether Docker works
//   rows     nine { id, text, passed }, in the roadmap's order
//   text     what the command prints: the rows, then the verdict, and why when
//            it fails
//
// A test belongs to the drill whose ID it names in front of " drill", as
// `INF-10-AC1: RG-03 drill — …` does in scripts/drills.test.mjs.
//
// And of scripts/gate-drills.mjs, the command: run in a repository, it runs
// that repository's scripts/drills.test.mjs with the repository's own Vitest
// configuration, prints the report, and exits with its exitCode.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, test } from 'vitest';

const REPO = realpathSync(path.resolve(import.meta.dirname, '..', '..'));
const ENTRY = path.join(REPO, 'scripts', 'gate-drills.mjs');

/** The module under test, loaded when a test needs it, so that a missing one fails each test by name. */
const report = async (results, tools) =>
  (await import('./gate-drills.mjs')).drillReport(results, tools);

/** The roadmap's nine drills, in its order (docs/plan/10-roadmap.md). */
const ORDER = [
  'RG-03',
  'CI-03',
  'RG-01',
  'CI-06',
  'HK-02',
  'D-029',
  'HK-07',
  'CODEOWNERS',
  'CI-11',
];
/** The two only GitHub can enforce, which are not drilled here (D-082). */
const LIVE = ['D-029', 'CODEOWNERS'];
const OFFLINE = ORDER.filter((id) => !LIVE.includes(id));
/** The gate that blocks each offline drill, as its row names it. */
const GATES = {
  'RG-03': 'tests:changes',
  'CI-03': 'test:unit',
  'RG-01': 'req:coverage',
  'CI-06': 'api:diff',
  'HK-02': 'guard-paths',
  'HK-07': 'scan-sensitive',
  'CI-11': 'Enforce the verdict',
};
const NOT_RUN =
  'not run here — covered by gate:integrity reading the live rules (CI-01); live attempt not yet run';

/** A test result, named the way Vitest's JSON reporter names one in full. */
const result = (name, status = 'passed') => ({ name, status });

/** What a good run gives: two passing tests for each offline drill, and one check of the whole file. */
const goodRun = () => [
  ...OFFLINE.flatMap((id, at) => [
    result(`${id} drill INF-10-AC${String(at + 1)}: ${id} drill — refused in its own words`),
    result(`${id} drill INF-10-AC9: ${id} drill — can go red`),
  ]),
  result('every drill INF-10-AC11: every scratch folder is gone'),
];

/** `results` with every test of drill `id` given `status`. */
const drillAs = (results, id, status) =>
  results.map((each) => (each.name.includes(`${id} drill`) ? { ...each, status } : each));

/** The row of drill `id`. */
const rowOf = (built, id) =>
  built.rows.find((row) => row.id === id) ?? { id, text: '', passed: false };

describe('the drill report (INF-10-AC12)', () => {
  test("INF-10-AC12: the report has nine rows, in the roadmap's order, and prints them in that order", async () => {
    const built = await report(goodRun(), { oasdiff: true });

    expect(built.rows.map((row) => row.id)).toEqual(ORDER);
    let from = -1;
    for (const row of built.rows) {
      const at = built.text.indexOf(row.text, from + 1);

      expect(row.text, row.id).not.toBe('');
      expect(at, `${row.id}'s row is not printed after the one before it`).toBeGreaterThan(from);
      from = at;
    }
  });

  test('INF-10-AC12: every offline drill whose tests all passed shows ✓ blocked, with the gate that blocked it, and the command exits 0', async () => {
    const built = await report(goodRun(), { oasdiff: true });

    for (const id of OFFLINE) {
      const row = rowOf(built, id);

      expect(row.text, id).toContain('✓ blocked');
      expect(row.text, id).toContain(GATES[id]);
      expect(row.passed, id).toBe(true);
    }
    expect(built.exitCode).toBe(0);
  });

  test('INF-10-AC12: the push to main and the safety-path change without owner approval are not run here, and are never shown or counted as passed', async () => {
    const built = await report(
      [
        ...goodRun(),
        result('INF-10: D-029 drill — a push to main'),
        result('INF-10: CODEOWNERS drill — a merge without the owner'),
      ],
      { oasdiff: true },
    );

    for (const id of LIVE) {
      const row = rowOf(built, id);

      expect(row.text, id).toContain(NOT_RUN);
      expect(row.text, id).not.toMatch(/✓|blocked|passed/);
      expect(row.passed, id).toBe(false);
    }
    expect(built.rows.filter((row) => row.passed).map((row) => row.id)).toEqual(OFFLINE);
    expect(built.text).not.toMatch(/\b9 of 9\b/);
    expect(built.exitCode).toBe(0);
  });

  test('INF-10-AC12: a drill with a failing test shows ✗ got through, and the command exits non-zero, saying so', async () => {
    const results = goodRun().map((each) =>
      each.name.includes('HK-07 drill') && each.name.includes('INF-10-AC6')
        ? { ...each, status: 'failed' }
        : each,
    );
    const built = await report(results, { oasdiff: true });
    const row = rowOf(built, 'HK-07');

    expect(row.text).toContain('✗ got through');
    expect(row.text).not.toContain('✓');
    expect(row.passed).toBe(false);
    expect(built.exitCode).not.toBe(0);
    expect(built.text).toMatch(/HK-07[^\n]*got through|got through[^\n]*HK-07/);
  });

  test('INF-10-AC12: a drill with no test at all is missing, and the command exits non-zero, naming it', async () => {
    const built = await report(
      goodRun().filter((each) => !each.name.includes('RG-01 drill')),
      { oasdiff: true },
    );

    expect(rowOf(built, 'RG-01').passed).toBe(false);
    expect(rowOf(built, 'RG-01').text).not.toContain('✓');
    expect(built.exitCode).not.toBe(0);
    expect(built.text).toMatch(/RG-01[^\n]*missing|missing[^\n]*RG-01/i);
  });

  test.each(['skipped', 'todo', 'pending'])(
    'INF-10-AC12: a drill whose tests come back %s did not run, and the command exits non-zero, naming it',
    async (status) => {
      const built = await report(drillAs(goodRun(), 'CI-11', status), { oasdiff: true });

      expect(rowOf(built, 'CI-11').passed).toBe(false);
      expect(rowOf(built, 'CI-11').text).not.toContain('✓');
      expect(built.exitCode).not.toBe(0);
      expect(built.text).toMatch(
        /CI-11[^\n]*(skipped|todo|pending|did not run)|(skipped|todo|pending|did not run)[^\n]*CI-11/i,
      );
    },
  );

  test('INF-10-AC12: a failing test that belongs to no drill fails the command too, naming the test', async () => {
    const other = 'every drill INF-10-AC11: every scratch folder is gone';
    const built = await report(
      goodRun().map((each) => (each.name === other ? { ...each, status: 'failed' } : each)),
      { oasdiff: true },
    );

    expect(built.exitCode).not.toBe(0);
    expect(built.text).toContain('INF-10-AC11: every scratch folder is gone');
    for (const id of OFFLINE) expect(rowOf(built, id).passed, id).toBe(true);
  });

  test('INF-10-AC12: when nothing ran, nothing passed: no row passes, and the command exits non-zero, saying nothing ran', async () => {
    const built = await report([], { oasdiff: true });

    expect(built.rows.map((row) => row.id)).toEqual(ORDER);
    expect(built.rows.filter((row) => row.passed)).toEqual([]);
    expect(built.text).not.toContain('✓');
    expect(built.exitCode).not.toBe(0);
    expect(built.text).toMatch(/nothing ran/i);
  });

  test("INF-10-AC12: CI-06's row says it proved detection where oasdiff works, and fail-closed only where it does not, never blocked", async () => {
    const detected = rowOf(await report(goodRun(), { oasdiff: true }), 'CI-06');
    const without = await report(goodRun(), { oasdiff: false });

    expect(detected.text).toContain('✓ blocked');
    expect(detected.text).toContain('api:diff');
    expect(detected.text).not.toMatch(/fail-closed/);
    expect(rowOf(without, 'CI-06').text).toContain('fail-closed only');
    expect(rowOf(without, 'CI-06').text).not.toMatch(/blocked/);
    expect(without.exitCode).toBe(0);
  });
});

// The command itself, run once or so, each time in a scratch repository with a
// small drill file of its own: the repository's Vitest configuration as it is,
// node_modules linked entry by entry, and a stand-in oasdiff first on PATH.

/** Caches a runner writes under node_modules, which the scratch copy keeps for itself. */
const CACHES = new Set(['.cache', '.tmp', '.vite', '.vite-temp']);

const scratch = [];
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop() ?? '', { recursive: true, force: true });
});

/**
 * A scratch repository for the command. `drillFile` is its
 * scripts/drills.test.mjs, or none when null. `oasdiff` is the stand-in on
 * PATH: 'works' answers, 'broken' fails the way a missing tool does.
 */
function scratchProject(drillFile, oasdiff) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'inf10-gate-drills-')));
  scratch.push(dir);
  for (const file of ['vitest.config.mjs', 'vitest.shared.mjs']) {
    copyFileSync(path.join(REPO, file), path.join(dir, file));
  }
  writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ name: 'drill-scratch', private: true, type: 'module' }, null, 2)}\n`,
  );
  mkdirSync(path.join(dir, 'node_modules'));
  for (const entry of readdirSync(path.join(REPO, 'node_modules'))) {
    if (!CACHES.has(entry)) {
      symlinkSync(path.join(REPO, 'node_modules', entry), path.join(dir, 'node_modules', entry));
    }
  }
  if (drillFile !== null) {
    mkdirSync(path.join(dir, 'scripts'));
    writeFileSync(path.join(dir, 'scripts', 'drills.test.mjs'), drillFile);
  }
  const bin = path.join(dir, '.stand-ins');
  const home = path.join(dir, '.home');
  mkdirSync(bin);
  mkdirSync(home);
  writeFileSync(
    path.join(bin, 'oasdiff'),
    oasdiff === 'works'
      ? '#!/bin/sh\necho "oasdiff version 1.32.1 (a stand-in for INF-10-AC12)"\n'
      : '#!/bin/sh\necho "oasdiff: not installed (a stand-in for INF-10-AC12)" >&2\nexit 127\n',
    { mode: 0o755 },
  );
  return { dir, bin, home };
}

/** Runs the command in `project`, with an environment of its own: no token, no GITHUB_ or CI. */
function runCommand({ dir, bin, home }) {
  const answer = spawnSync(process.execPath, [ENTRY], {
    cwd: dir,
    env: {
      PATH: [bin, ...(process.env.PATH ?? '').split(path.delimiter)].join(path.delimiter),
      HOME: home,
      LANG: 'C',
      LC_ALL: 'C',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return {
    status: answer.status,
    output: `${answer.stdout ?? ''}${answer.stderr ?? ''}${answer.error?.message ?? ''}`,
  };
}

/** A small drill file: a test for each offline drill, failing for those in `failing`, and one ordinary check. */
function drillFile(failing = []) {
  const [t, e] = [['te', 'st'].join(''), ['exp', 'ect'].join('')];
  return [
    `import { ${e}, ${t} } from 'vitest';`,
    '',
    ...OFFLINE.map(
      (id, at) =>
        `${t}('INF-10-AC${String(at + 1)}: ${id} drill — a stand-in', () => {\n  ${e}(1).toBe(${failing.includes(id) ? '2' : '1'});\n});\n`,
    ),
    `${t}('INF-10-AC11: an ordinary check', () => {\n  ${e}(1).toBe(1);\n});\n`,
  ].join('\n');
}

/** Whether a printed line names `id` and says `words`. */
const hasLine = (output, id, words) =>
  output.split('\n').some((line) => line.includes(id) && line.includes(words));

describe('the command, pnpm run gate:drills (INF-10-AC12)', () => {
  test('INF-10-AC12: it runs the drill file of the repository it runs in, prints the nine rows in order, and exits non-zero when a drill got through', () => {
    const { status, output } = runCommand(scratchProject(drillFile(['CI-11']), 'broken'));

    expect(status, output).not.toBe(0);
    expect(status, output).not.toBeNull();
    let from = -1;
    for (const id of ORDER) {
      const at = output.indexOf(id, from + 1);

      expect(at, `${id} is not printed after the row before it:\n${output}`).toBeGreaterThan(from);
      from = at;
    }
    expect(hasLine(output, 'CI-11', '✗ got through'), output).toBe(true);
    for (const id of ['RG-03', 'CI-03', 'RG-01', 'HK-02', 'HK-07']) {
      expect(hasLine(output, id, '✓ blocked'), `${id}:\n${output}`).toBe(true);
    }
    expect(hasLine(output, 'CI-06', 'fail-closed only'), output).toBe(true);
    expect(output.split(NOT_RUN).length - 1, output).toBe(2);
  }, 120_000);

  test('INF-10-AC12: with every drill blocked, and oasdiff answering when it is run, it exits 0 with CI-06 blocked too', () => {
    const { status, output } = runCommand(scratchProject(drillFile(), 'works'));

    expect(status, output).toBe(0);
    for (const id of OFFLINE) {
      expect(hasLine(output, id, '✓ blocked'), `${id}:\n${output}`).toBe(true);
    }
    expect(output.split(NOT_RUN).length - 1, output).toBe(2);
  }, 120_000);

  test('INF-10-AC12: with no drill file to run, it exits non-zero, saying nothing ran, and shows no drill as blocked', () => {
    const { status, output } = runCommand(scratchProject(null, 'works'));

    expect(status, output).not.toBe(0);
    expect(status, output).not.toBeNull();
    expect(output).toMatch(/nothing ran/i);
    expect(output).not.toContain('✓ blocked');
  }, 120_000);
});
