// req-coverage: fixtures-only — the IDs below name decisions, not the product.
//
// PR #31's required mutation check was killed at its time limit, because every
// mutant in every safety file ran the whole suite: 13.2 s a mutant on two
// cores. The owner's fix, an amendment to D-066, runs the safety files in
// groups, each against only the tests that can kill its mutants, one after
// another inside the same budget.
//
// The loop that runs them has to keep four promises:
// - every run is reported, even after one of them fails;
// - the budget is shared, so each run gets only what is left of it, not a
//   fresh 25 minutes that the job around it does not have;
// - a run that never started is a failure, never a pass;
// - the verdict names the runs that failed.
//
// Stryker and the clock are fakes here. Time moves only when a fake run says
// it took some.
//
// BUG-12 adds two promises (D-098):
// - a run is judged from its JSON report, not only from Stryker's exit code.
//   On #53 Stryker exited 0 for a run in which 84 of 84 mutants timed out and
//   none was killed, because it counts a timeout as caught;
// - a run whose safety paths hold no source file yet is not started, and says
//   so by name. It neither fails nor passes the gate, and a gate in which no
//   run had anything to mutate measured nothing, so it fails.
// The fakes below therefore also stand in for the report each run writes and
// for the question "is there anything to mutate here".
//
// D-099 (owner, 2026-10-02) makes every run fresh. With the command runner
// Stryker has no coverage data, so its incremental mode reuses every earlier
// result in code that has not changed, whatever happened to the tests: a
// test file gutted to assert nothing scored 100 % incremental and 0 % fresh.
// So `pnpm run mutation --incremental` is refused before any Stryker run
// starts, and Stryker is never asked for incremental mode.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { judgeMutationReport, mutationRuns } from './lib/gate-decisions.mjs';
import { hasSourceFiles, runMutationGroups, strykerRunner } from './mutation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RUNS = [
  { name: 'domain', paths: ['apps/server/src/domain/'], tests: ['apps/server/src/domain'] },
  {
    name: 'healthchecks',
    paths: ['apps/server/src/adapters/healthchecks.ts'],
    tests: ['apps/server/src/adapters/healthchecks.test.ts', 'apps/server/src/worker.test.ts'],
  },
  {
    name: 'whole-suite',
    paths: ['apps/server/src/worker.ts', 'apps/server/src/process.ts'],
    tests: ['apps', 'packages'],
  },
];

/** The whole-suite run as it is today: the two safety paths that hold no file yet. */
const EMPTY_WHOLE_SUITE = {
  name: 'whole-suite',
  paths: ['apps/server/src/modules/alerts/', 'apps/mobile/src/safety-core/'],
  tests: ['apps', 'packages'],
};

const MINUTE = 60_000;

const lowScore = { ok: false, status: 1, output: 'Final mutation score of 71.43 is under break\n' };
const timedOut = { ok: false, status: null, output: 'spawnSync pnpm ETIMEDOUT' };

/**
 * A Stryker JSON report (mutation-testing-report-schema), from counts:
 * `{ 'a.ts': { Killed: 3, Timeout: 1 } }` gives a.ts four mutants with those
 * statuses.
 */
function reportOf(files) {
  let id = 0;
  return {
    schemaVersion: '1.0',
    thresholds: { high: 90, low: 80 },
    files: Object.fromEntries(
      Object.entries(files).map(([file, counts]) => [
        file,
        {
          language: 'typescript',
          source: '',
          mutants: Object.entries(counts).flatMap(([status, count]) =>
            Array.from({ length: count }, () => {
              id += 1;
              return {
                id: String(id),
                mutatorName: 'BlockStatement',
                replacement: '{}',
                status,
                location: { start: { line: id, column: 1 }, end: { line: id, column: 3 } },
              };
            }),
          ),
        },
      ]),
    ),
  };
}

/** The report of a run that went well: every mutant of a file of its own killed. */
const allKilled = (name) => reportOf({ [`apps/server/src/${name}.ts`]: { Killed: 10 } });

/**
 * Runs the loop against a fake Stryker. `takes` says how long each run lasts
 * and `results` what it returns; a run with no result passes and prints a
 * report naming itself. `empty` names the safety paths that hold no source
 * file.
 *
 * The reports live in a fake folder, as they do on disk: `leftover` is what
 * is in it before the gate starts, a report from an earlier run; a fake run
 * writes its report there; `clearReport` removes one; `readReport` reads
 * one, or gets null. `reports` says what each run writes, `null` for nothing;
 * a run with no entry writes one in which every mutant was killed.
 *
 * BUG-12 (RG-03): `reports`, `leftover`, `empty` and the folder are new, and
 * their defaults keep every test written before them asserting exactly what
 * it did: each run has something to mutate, nothing is left over, and each
 * run writes a report that passes.
 */
async function runGroups({
  runs = RUNS,
  budgetMs = 25 * MINUTE,
  takes = {},
  results = {},
  reports = {},
  leftover = {},
  empty = [],
} = {}) {
  let clock = 1_758_000_000_000;
  const events = [];
  const folder = new Map(Object.entries(leftover));
  const outcome = await runMutationGroups({
    runs,
    budgetMs,
    now: () => clock,
    write: (text) => {
      events.push({ wrote: String(text) });
    },
    runStryker: ({ name, timeout }) => {
      events.push({ started: name, timeout });
      clock += takes[name] ?? 0;
      const report = name in reports ? reports[name] : allKilled(name);
      if (report !== null) folder.set(name, report);
      return results[name] ?? { ok: true, status: 0, output: `report of the ${name} run\n` };
    },
    clearReport: (name) => {
      events.push({ cleared: name });
      folder.delete(name);
    },
    readReport: (name) => {
      events.push({ read: name });
      return folder.get(name) ?? null;
    },
    hasSourceFiles: (paths) => {
      events.push({ looked: [...paths] });
      return !paths.every((p) => empty.includes(p));
    },
  });
  const started = events.filter((event) => 'started' in event);
  const written = events
    .filter((event) => 'wrote' in event)
    .map((event) => event.wrote)
    .join('');
  return { outcome, events, started, written };
}

describe('runMutationGroups', () => {
  test('runs every group once, in order, naming each so the config can find it', async () => {
    const { started } = await runGroups();

    expect(started.map((run) => run.started)).toEqual(['domain', 'healthchecks', 'whole-suite']);
  });

  test('every run passing passes the gate', async () => {
    const { outcome } = await runGroups();

    expect(outcome.ok).toBe(true);
  });

  test('each run gets what is left of one shared budget, not a budget of its own', async () => {
    const { started } = await runGroups({
      budgetMs: 25 * MINUTE,
      takes: { domain: 4 * MINUTE, healthchecks: 6 * MINUTE },
    });

    expect(started.map((run) => run.timeout)).toEqual([25 * MINUTE, 21 * MINUTE, 15 * MINUTE]);
  });

  test('before each run, it says which run, which files it mutates and which tests it runs', async () => {
    // A red mutation check is explained by its log. With several runs in one
    // log, the reader has to be able to tell which run a report belongs to.
    const { events } = await runGroups();

    let since = 0;
    for (const run of RUNS) {
      const at = events.findIndex((event) => event.started === run.name);
      const before = events
        .slice(since, at)
        .filter((event) => 'wrote' in event)
        .map((event) => event.wrote)
        .join('');

      expect(at).toBeGreaterThan(since);
      for (const expected of [run.name, ...run.paths, ...run.tests]) {
        expect(before).toContain(expected);
      }
      since = at + 1;
    }
  });

  test('prints what each Stryker run printed, so a surviving mutant is named in the log', async () => {
    const { written } = await runGroups();

    for (const run of RUNS) {
      expect(written).toContain(`report of the ${run.name} run`);
    }
  });

  test('a low score fails the gate, and the runs after it still run and report', async () => {
    const { outcome, started, written } = await runGroups({ results: { healthchecks: lowScore } });

    expect(started.map((run) => run.started)).toEqual(['domain', 'healthchecks', 'whole-suite']);
    expect(written).toContain('Final mutation score of 71.43 is under break');
    expect(written).toContain('Stryker exited with 1');
    expect(written).toContain('report of the whole-suite run');
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('healthchecks');
  });

  test('the verdict names every run that failed', async () => {
    const { outcome } = await runGroups({ results: { domain: lowScore, 'whole-suite': lowScore } });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('domain');
    expect(outcome.message).toContain('whole-suite');
  });

  test('a run that did not finish is reported as unfinished, never as a low score', async () => {
    // Killed with time still left in the budget, say by the runner: the next
    // runs still get their turn.
    const { outcome, started, written } = await runGroups({
      takes: { domain: 3 * MINUTE },
      results: { domain: timedOut },
    });

    expect(written).toContain('did not finish');
    expect(written).toContain('no mutation score was measured');
    expect(written).not.toContain('below 80');
    expect(started.map((run) => run.started)).toEqual(['domain', 'healthchecks', 'whole-suite']);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('domain');
  });

  test('once the budget is spent, no run starts, and the verdict names the runs that were not run', async () => {
    const { outcome, started } = await runGroups({
      budgetMs: 25 * MINUTE,
      takes: { domain: 25 * MINUTE },
      results: { domain: timedOut },
    });

    expect(started.map((run) => run.started)).toEqual(['domain']);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('healthchecks');
    expect(outcome.message).toContain('whole-suite');
    expect(outcome.message).toMatch(/not run/i);
  });

  // A run that passed but used the whole budget still leaves the others unrun.
  // Starting the next one anyway would be worse than stopping: spawnSync reads
  // a timeout of 0 as no limit at all, and throws on a negative one.
  test.each([
    ['exactly spent', 25 * MINUTE],
    ['overspent', 26 * MINUTE],
  ])('a budget %s starts no further run, and the gate fails', async (_, took) => {
    const { outcome, started } = await runGroups({
      budgetMs: 25 * MINUTE,
      takes: { domain: took },
    });

    expect(started.map((run) => run.started)).toEqual(['domain']);
    expect(started.every((run) => run.timeout > 0)).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('healthchecks');
  });

  test('with no runs at all, nothing was measured, and that is a failure', async () => {
    const { outcome, started } = await runGroups({ runs: [] });

    expect(started).toEqual([]);
    expect(outcome.ok).toBe(false);
  });

  test('BUG-12: Stryker exits 0 for a run in which every mutant timed out, and the gate fails, naming the run', async () => {
    // The reproduction of #53, job 110739523389: 84 timed out, 0 killed,
    // "Ran 0.00 tests per mutant", score 100 %, exit 0, required check green.
    const { outcome, started } = await runGroups({
      reports: { 'whole-suite': reportOf({ 'apps/server/src/process.ts': { Timeout: 84 } }) },
    });

    expect(started.map((run) => run.started)).toEqual(['domain', 'healthchecks', 'whole-suite']);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('whole-suite');
    expect(outcome.message).not.toContain('domain');
  });

  test('BUG-12: each run clears its report, then runs, then reads the report it wrote', async () => {
    // Cleared first, so that what is read can only be what this run wrote.
    // Up front for every run would be as safe; what matters is that a run's
    // clear comes before its Stryker starts.
    const { events } = await runGroups();

    const order = events
      .filter((event) => 'started' in event || 'read' in event)
      .map((event) => ('started' in event ? `ran ${event.started}` : `read ${event.read}`));
    expect(order).toEqual([
      'ran domain',
      'read domain',
      'ran healthchecks',
      'read healthchecks',
      'ran whole-suite',
      'read whole-suite',
    ]);
    for (const run of RUNS) {
      const cleared = events.findIndex((event) => event.cleared === run.name);
      const ran = events.findIndex((event) => event.started === run.name);
      expect(cleared, `${run.name} was never cleared`).toBeGreaterThanOrEqual(0);
      expect(cleared, `${run.name} was cleared after its Stryker started`).toBeLessThan(ran);
    }
  });

  test('BUG-12: a report left over from an earlier run never stands in for this one: Stryker writes none, and the run fails, saying so', async () => {
    // Locally, reports/mutation/ keeps the last run's files. Here the
    // leftover passes, and this Stryker exits 0 having written nothing.
    // Read without clearing, the old report would pass the run.
    const { outcome, written } = await runGroups({
      leftover: { healthchecks: allKilled('healthchecks') },
      reports: { healthchecks: null },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('healthchecks');
    expect(`${written}\n${outcome.message}`).toMatch(/no (json )?report/i);
  });

  test('BUG-12: Stryker exits 0 but wrote no report: the run fails, saying it wrote none', async () => {
    // D-098: a run with no report measured nothing that the gate can see.
    const { outcome, written } = await runGroups({ reports: { healthchecks: null } });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('healthchecks');
    expect(`${written}\n${outcome.message}`).toMatch(/no (json )?report/i);
  });

  test("BUG-12: a report with one file below 80 % fails its run, and the judge's message is in the output", async () => {
    // Pooled, this run's score is 45 of 48, 93.75 %, and Stryker exits 0. The
    // file at 62.5 % is api-process.ts's measured score before BUG-12.
    const report = reportOf({
      'apps/server/src/domain/journey.ts': { Killed: 40 },
      'apps/server/src/api-process.ts': { Killed: 5, Survived: 3 },
    });
    const { outcome, written } = await runGroups({ reports: { domain: report } });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('domain');
    expect(written).toContain('apps/server/src/api-process.ts');
    expect(written).toMatch(/62\.5 ?%/);
    expect(written).toContain(judgeMutationReport(report).message);
  });

  test('BUG-12: a run whose paths hold no source file yet is not started, says so by name, and does not decide the gate', async () => {
    // modules/alerts/ and safety-core/ today: safety paths with nothing in
    // them, which only the whole-suite run takes. Started anyway, Stryker 10
    // finds no file to mutate, scores NaN, and exits 0, since NaN is not
    // below the break threshold; the judge then fails the run as having
    // measured nothing, which would block every pull request for code that
    // does not exist. Passing it would claim a score for that code. So
    // neither.
    const runs = [
      ...RUNS.slice(0, 2),
      {
        name: 'whole-suite',
        paths: ['apps/server/src/modules/alerts/', 'apps/mobile/src/safety-core/'],
        tests: ['apps', 'packages'],
      },
    ];
    const { outcome, started, written, events } = await runGroups({
      runs,
      empty: ['apps/server/src/modules/alerts/', 'apps/mobile/src/safety-core/'],
    });

    // Asked about each of its paths, whether one at a time or together.
    const looked = events.filter((event) => 'looked' in event).flatMap((event) => event.looked);
    expect(looked).toEqual(
      expect.arrayContaining(['apps/server/src/modules/alerts/', 'apps/mobile/src/safety-core/']),
    );
    expect(started.map((run) => run.started)).toEqual(['domain', 'healthchecks']);
    expect(written).toMatch(
      /whole-suite[^\n]*nothing to mutate|nothing to mutate[^\n]*whole-suite/i,
    );
    expect(outcome.ok).toBe(true);
    // Not counted among the runs that passed: wherever the verdict names it,
    // it says there was nothing to mutate.
    for (const sentence of outcome.message.split(/(?<=\.)\s+/)) {
      if (sentence.includes('whole-suite')) {
        expect(sentence).toMatch(/nothing to mutate/i);
      }
    }
  });

  test('BUG-12: a run with nothing to mutate does not save a gate another run failed', async () => {
    const { outcome } = await runGroups({
      runs: [
        RUNS[0],
        {
          name: 'whole-suite',
          paths: ['apps/mobile/src/safety-core/'],
          tests: ['apps', 'packages'],
        },
      ],
      empty: ['apps/mobile/src/safety-core/'],
      results: { domain: lowScore },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('domain');
  });

  test('BUG-12: when no run had anything to mutate, nothing was measured, and the gate fails', async () => {
    // Review loop 1: this made every run's paths empty, groups included. A
    // group with an empty path now fails on its own, in the tests below, so
    // this keeps to the case it is about: the one run that may have nothing
    // to mutate had nothing, and there was no other.
    const { outcome, started } = await runGroups({
      runs: [EMPTY_WHOLE_SUITE],
      empty: EMPTY_WHOLE_SUITE.paths,
    });

    expect(started).toEqual([]);
    expect(outcome.ok).toBe(false);
  });

  // Review loop 1, safety-reviewer: it renamed bin/worker.ts. Stryker only
  // warned that a glob matched nothing, the judge listed the two files left,
  // and the gate passed. A group exists because its files exist, so a group
  // path with no source file is a safety file gone missing, never "nothing to
  // mutate yet". Only the whole-suite run, which takes the safety paths no
  // group claims, may wait for its first file.
  //
  // The fake's hasSourceFiles answers for the paths it is given, true when
  // any of them holds a source file, as the real one does. The loop may ask
  // one path at a time; what is pinned is that a group's paths are judged
  // one by one.
  const PROCESS_GROUP = {
    name: 'process',
    paths: [
      'apps/server/src/worker.ts',
      'apps/server/src/bin/worker.ts',
      'apps/server/src/process.ts',
    ],
    tests: [
      'apps/server/src/bin/bin.test.ts',
      'apps/server/src/worker.test.ts',
      'apps/server/src/process.test.ts',
    ],
  };

  test('BUG-12: a group with one path that holds no source file fails the gate, naming that path', async () => {
    const { outcome } = await runGroups({
      runs: [RUNS[0], PROCESS_GROUP],
      empty: ['apps/server/src/bin/worker.ts'],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('process');
    expect(outcome.message).toContain('apps/server/src/bin/worker.ts');
    expect(outcome.message).not.toContain('apps/server/src/process.ts');
  });

  test('BUG-12: a group none of whose paths holds a source file fails the gate, naming them: only the whole-suite run may have nothing to mutate yet', async () => {
    const { outcome } = await runGroups({
      runs: [RUNS[0], RUNS[1], EMPTY_WHOLE_SUITE],
      empty: ['apps/server/src/adapters/healthchecks.ts', ...EMPTY_WHOLE_SUITE.paths],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('healthchecks');
    expect(outcome.message).toContain('apps/server/src/adapters/healthchecks.ts');
  });
});

describe('BUG-12: hasSourceFiles, what main asks before it starts a run', () => {
  // The loop above trusts this answer: false means the run is not started and
  // says it had nothing to mutate. A wrong false for a group that has files,
  // such as a single-file path read as an empty folder, would skip that group
  // and let the gate pass without it: the silent pass BUG-12 is about. So the
  // real one is tested here, on folders made for it and on this repository.
  // It answers for a run's paths together, from `cwd`, by the rule the
  // Stryker config mutates by: a folder means every .ts file under it but its
  // tests, and a file means itself.
  const made = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function scratch() {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'bug12-sources-')));
    made.push(dir);
    for (const [file, text] of [
      ['code/one.ts', 'export const one = 1;\n'],
      ['code/deeper/two.ts', 'export const two = 2;\n'],
      ['code/one.test.ts', '\n'],
      ['tests-only/only.test.ts', '\n'],
      ['tests-only/only.system.test.ts', '\n'],
      ['single.ts', 'export const single = 1;\n'],
    ]) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), text);
    }
    mkdirSync(path.join(dir, 'empty'));
    return dir;
  }

  test.each([
    ['a folder with source files', ['code/'], true],
    ['a single file that exists', ['single.ts'], true],
    ['a folder holding only tests', ['tests-only/'], false],
    ['an empty folder', ['empty/'], false],
    ['a folder that does not exist', ['missing/'], false],
    ['a file that does not exist', ['missing.ts'], false],
    ['paths of which one has a source file', ['empty/', 'missing/', 'single.ts'], true],
  ])('BUG-12: %s: %j gives %s', (_, paths, expected) => {
    expect(hasSourceFiles(paths, scratch())).toBe(expected);
  });

  test('BUG-12: in this repository, every group has something to mutate', () => {
    // Every run but the whole-suite one is a group, and D-098 gives a group
    // only to safety files that exist.
    for (const run of mutationRuns().filter((candidate) => candidate.name !== 'whole-suite')) {
      expect(hasSourceFiles(run.paths, root), run.name).toBe(true);
    }
  });
});

describe('strykerRunner', () => {
  // How main starts each run. The config picks the run from STRYKER_RUN, so a
  // name that does not reach it would quietly run the whole config each time.
  function recordingRun() {
    const calls = [];
    const run = (command, args, options) => {
      calls.push({ command, args, options });
      return { ok: true, status: 0, output: 'done' };
    };
    return { calls, run };
  }

  // BUG-12 (RG-03), for this test and the next, both on main: each passed
  // strykerRunner an `incremental` option, and this one expected
  // `--incremental` among Stryker's arguments when it was true. The owner's
  // D-099 (2026-10-02) makes every run fresh: with the command runner Stryker
  // has no coverage data, so an incremental run reuses earlier results
  // whatever happened to the tests, and a gutted test file scored 100 %. The
  // change only removes that reuse, so the run these tests pin is stricter.
  // This one still pins the name, the time, the directory and the exact
  // arguments; the next now pins that no caller can ask for reuse.
  test('starts Stryker with STRYKER_RUN naming the run, in the time it was given', () => {
    const { calls, run } = recordingRun();
    const runStryker = strykerRunner({ run, cwd: '/repo' });

    const result = runStryker({ name: 'healthchecks', timeout: 21 * MINUTE });

    expect(result).toEqual({ ok: true, status: 0, output: 'done' });
    expect(calls).toEqual([
      {
        command: 'pnpm',
        args: ['exec', 'stryker', 'run'],
        options: { cwd: '/repo', timeout: 21 * MINUTE, env: { STRYKER_RUN: 'healthchecks' } },
      },
    ]);
  });

  // BUG-12 (RG-03): was "without --incremental, Stryker is not asked for it",
  // with `incremental: false` only. That case is still here, with the two a
  // caller could still write after D-099: no option at all, and a stale
  // `incremental: true`, which must not bring the reuse back.
  test('BUG-12: Stryker is never asked for incremental mode, whatever the caller passes (D-099)', () => {
    for (const asked of [{}, { incremental: false }, { incremental: true }]) {
      const { calls, run } = recordingRun();
      const runStryker = strykerRunner({ run, cwd: '/repo', ...asked });

      runStryker({ name: 'domain', timeout: 25 * MINUTE });

      expect(
        calls.map((call) => call.args),
        JSON.stringify(asked),
      ).toEqual([['exec', 'stryker', 'run']]);
      expect(calls[0]?.options.env).toEqual({ STRYKER_RUN: 'domain' });
    }
  });
});

describe('D-099: `pnpm run mutation --incremental` is refused', () => {
  // Through the real script, as `pnpm run mutation` starts it: the refusal
  // has to come from main, before any run starts, and only the script itself
  // can show that. It runs in a scratch repository where every run would
  // start, against a stand-in `pnpm` that records each call and starts
  // nothing. So the real Stryker never runs here, even while the refusal is
  // missing, and a Stryker run that did start is on record.
  const made = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const script = realpathSync(path.join(root, 'scripts', 'mutation.mjs'));

  /**
   * A scratch repository in which `pnpm run mutation` would start every run:
   * a Stryker config, and a source file in each run's safety paths, untracked,
   * so that --only-if-safety-paths-changed finds them changed. Beside it, the
   * only `pnpm` on PATH, which logs each call to `started` and exits 1.
   */
  function scratchRepository() {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'd099-incremental-')));
    made.push(dir);
    const repo = path.join(dir, 'repo');
    const bin = path.join(dir, 'bin');
    const started = path.join(dir, 'stryker-started.log');
    mkdirSync(repo);
    writeFileSync(path.join(repo, 'stryker.config.mjs'), 'export default {};\n');
    for (const run of mutationRuns()) {
      for (const p of run.paths) {
        const file = p.endsWith('/') ? path.join(repo, p, 'planted.ts') : path.join(repo, p);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, 'export const planted = 1;\n');
      }
    }
    const init = spawnSync('git', ['init', '-q'], {
      cwd: repo,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    if (init.status !== 0) throw new Error(`git init failed:\n${init.stderr}`);
    mkdirSync(bin);
    writeFileSync(
      path.join(bin, 'pnpm'),
      ['#!/bin/sh', `echo "STRYKER_RUN=$STRYKER_RUN pnpm $*" >> "${started}"`, 'exit 1', ''].join(
        '\n',
      ),
    );
    chmodSync(path.join(bin, 'pnpm'), 0o755);
    return { repo, bin, started };
  }

  /** `node scripts/mutation.mjs ...args` in `repo`, with the stand-in first on PATH. */
  function mutation({ repo, bin }, args) {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 60_000,
      env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: process.env.HOME },
    });
    return { ...result, output: `${result.stdout}${result.stderr}` };
  }

  /** What the stand-in recorded: every Stryker run that started, one line each. */
  const starts = (started) => (existsSync(started) ? readFileSync(started, 'utf8') : '');

  test.each([
    ['--incremental'],
    // As gate:full and ci.yml passed it before D-099.
    ['--incremental --only-if-safety-paths-changed --base origin/main'],
    ['--only-if-safety-paths-changed --base origin/main --incremental'],
  ])(
    'D-099: `pnpm run mutation %s` exits non-zero before any Stryker run starts, naming D-099 and why',
    (line) => {
      const args = line.split(' ');
      const repository = scratchRepository();

      // The scratch repository is one in which the same line without
      // --incremental starts Stryker, through the stand-in. Without this, "no
      // run started" below could hold only because nothing would have.
      const fresh = mutation(
        repository,
        args.filter((arg) => arg !== '--incremental'),
      );
      expect(fresh.error, fresh.output).toBeUndefined();
      expect(starts(repository.started), fresh.output).toContain('pnpm exec stryker run');
      rmSync(repository.started);

      const refused = mutation(repository, args);

      expect(refused.error, refused.output).toBeUndefined();
      expect(refused.signal, refused.output).toBeNull();
      expect(refused.status, refused.output).not.toBe(0);
      expect(starts(repository.started), 'a Stryker run started').toBe('');
      expect(refused.output).toContain('D-099');
      expect(refused.output).toContain('--incremental');
      // Why: results reused without coverage can hide a gutted test.
      expect(refused.output).toMatch(/reus/i);
      expect(refused.output).toMatch(/coverage/i);
    },
  );
});
