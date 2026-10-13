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
//
// BUG-45 (D-129, the owner, 2026-10-13) splits the one CI job into one per
// group, under an aggregator still named `mutation`, and adds a local
// `--group`. Three entry points join `pnpm run mutation`, each tested here
// through the real script in a scratch repository, and the two pure functions
// behind them directly:
// - `--plan` makes the decision once, by today's rules, and writes it, with
//   the list of groups from the code that defines them, as job outputs;
// - `--group <name>` runs one group, judged as today, and writes a verdict
//   file beside its report;
// - `--aggregate <dir>` passes only when every group the code expects
//   reported and passed, judged again from the raw reports, and trusts
//   neither the plan's list nor GitHub's roll-up of the legs.
// Two new exports are imported below, `classifyRuns` and
// `aggregateMutationJobs`; until they exist, the tests that call them fail
// on that.
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import {
  MUTATION_GROUPS,
  MUTATION_TIMEOUT_MS,
  decideMutation,
  judgeMutationReport,
  mutationReportFile,
  mutationRuns,
} from './lib/gate-decisions.mjs';
import {
  aggregateMutationJobs,
  classifyRuns,
  hasSourceFiles,
  runMutationGroups,
  strykerRunner,
} from './mutation.mjs';

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

/**
 * Sample data: the whole-suite run as it was before LOST-02, when two safety
 * paths held no file yet. modules/alerts/ now has files and a group of its
 * own; the runner under test is handed these runs, so they still describe a
 * run whose paths hold nothing, which is what the tests below need.
 */
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
    // modules/alerts/ and safety-core/ before LOST-02 (sample data since:
    // the runs and the empty paths are handed in): safety paths with nothing
    // in them, which only the whole-suite run takes. Started anyway, Stryker 10
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

// BUG-12 (RG-03): this block was "D-099: `pnpm run mutation --incremental` is
// refused". Test audit, test-auditor: main's own wiring of hasSourceFiles was
// tested nowhere, so the same harness now holds a second case, and the block
// is named for the harness. The D-099 cases are unchanged, and their names
// still say what they prove.
describe('`pnpm run mutation` itself, in a scratch repository', () => {
  // Through the real script, as `pnpm run mutation` starts it: the refusal
  // has to come from main, before any run starts, and only the script itself
  // can show that. It runs in a scratch repository where every run would
  // start, against a stand-in `pnpm` that records each call and starts
  // nothing. So the real Stryker never runs here, even while the refusal is
  // missing, and a Stryker run that did start is on record.
  //
  // The same holds for what main asks before each run: whether each of a
  // group's paths holds a source file. runMutationGroups is tested above
  // with a fake answer, so only the script itself shows that main asks the
  // real hasSourceFiles, about the real files.
  const made = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const script = realpathSync(path.join(root, 'scripts', 'mutation.mjs'));

  /**
   * A scratch repository in which `pnpm run mutation` would start every run:
   * a Stryker config, and a source file in each run's safety paths, untracked,
   * so that --only-if-safety-paths-changed finds them changed. Beside it, the
   * only `pnpm` on PATH, which logs each call to `started`. By default it
   * exits 1. With `stryker: 'passes'` it writes, where Stryker writes a run's
   * JSON report, one in which the run's only mutant was killed, and exits 0:
   * every run passes, so the gate can fail only for what the test changed.
   *
   * BUG-12 (RG-03): `stryker` is new, and its default keeps the stand-in the
   * D-099 cases had.
   */
  function scratchRepository({ stryker = 'fails' } = {}) {
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
    // BUG-46 (RG-03): origin/main at an empty first commit, so that the
    // `--base origin/main` these cases pass resolves, and every file above is
    // still untracked, so still changed. Without it the base resolved to
    // nothing, which D-131 makes `--only-if-safety-paths-changed` refuse:
    // these cases would then test that refusal, not theirs.
    git(repo, ['commit', '-q', '--allow-empty', '-m', 'synthetic base']);
    git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    mkdirSync(bin);
    // The report's path as the shell expands it, from the function the
    // script reads reports by, so the two cannot drift apart.
    const report = mutationReportFile('$STRYKER_RUN');
    const passing = JSON.stringify(reportOf({ 'planted.ts': { Killed: 1 } }));
    writeFileSync(
      path.join(bin, 'pnpm'),
      [
        '#!/bin/sh',
        `echo "STRYKER_RUN=$STRYKER_RUN pnpm $*" >> "${started}"`,
        ...(stryker === 'passes'
          ? [`mkdir -p "$(dirname "${report}")"`, `echo '${passing}' > "${report}"`, 'exit 0']
          : ['exit 1']),
        '',
      ].join('\n'),
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

  // Review loop 1, safety-reviewer: with bin/worker.ts renamed, the process
  // group was judged on the two files left, and the gate passed. Test audit,
  // test-auditor: main handing the loop `() => true` for hasSourceFiles
  // brought that back, and every test stayed green.
  test("BUG-12: a group's safety file gone from the repository fails the gate, and the verdict names the file and its group", () => {
    const gone = 'apps/server/src/bin/worker.ts';
    expect(
      mutationRuns().find((run) => run.name === 'process')?.paths,
      'the process group no longer claims the file this test removes',
    ).toContain(gone);
    const repository = scratchRepository({ stryker: 'passes' });
    // As ci.yml runs it.
    const args = ['--only-if-safety-paths-changed', '--base', 'origin/main'];

    // With every file there, every run passes and so does the gate. Without
    // this, the failure below could come from anything but the missing file.
    const whole = mutation(repository, args);
    expect(whole.error, whole.output).toBeUndefined();
    expect(whole.status, whole.output).toBe(0);
    expect(starts(repository.started), whole.output).toContain('STRYKER_RUN=process ');

    rmSync(path.join(repository.repo, gone));
    const missing = mutation(repository, args);

    expect(missing.error, missing.output).toBeUndefined();
    expect(missing.signal, missing.output).toBeNull();
    expect(missing.status, missing.output).not.toBe(0);
    // The verdict is the last line the script prints. Anywhere else, the
    // file is named even when the gate passes: in the line before the process
    // run that lists what it mutates. And "process" alone matches
    // "api-process".
    const verdict = missing.stdout.trim().split('\n').at(-1) ?? '';
    expect(verdict, missing.output).toContain(gone);
    expect(verdict, missing.output).toMatch(/(?<![\w-])process\b/);
    expect(verdict, missing.output).not.toContain('apps/server/src/process.ts');
  });
});

// ===========================================================================
// BUG-45 (D-129): one CI job per group, under an aggregator still named
// `mutation`, and a local `--group`.
// ===========================================================================

/** The name of the run that takes the safety paths no group claims. */
const WHOLE_SUITE_RUN_NAME = 'whole-suite';

/** This repository's runs that are groups, in order: every run but the whole-suite one. */
const GROUP_NAMES = mutationRuns()
  .filter((run) => run.name !== WHOLE_SUITE_RUN_NAME)
  .map((run) => run.name);

/** Where a run's verdict file is written beside its report (the spec's approach item 4). */
const verdictFile = (name) => `reports/mutation/${name}.verdict.json`;

/** Plants a source file in a safety path of `repo`: in a folder, or the file itself. */
function plant(repo, safetyPath) {
  const file = safetyPath.endsWith('/')
    ? path.join(repo, safetyPath, 'planted.ts')
    : path.join(repo, safetyPath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'export const planted = 1;\n');
}

/** git in a scratch repository, with a synthetic identity and nothing of the machine's own. */
function git(repo, args) {
  const result = spawnSync(
    'git',
    [
      '-c',
      'user.name=Synthetic Tester',
      '-c',
      'user.email=synthetic@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: repo, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } },
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
}

/** `name=value` lines, as GitHub reads a GITHUB_OUTPUT file: the lines in order, and the last value of each name. */
function outputsIn(text) {
  const lines = text.split('\n').filter((line) => line !== '');
  const values = {};
  for (const line of lines) {
    const at = line.indexOf('=');
    if (at > 0) values[line.slice(0, at)] = line.slice(at + 1);
  }
  return { lines, values };
}

describe('BUG-45: classifyRuns, the one list of the runs that have something to mutate (AC1)', () => {
  // The plan's `groups` output and the aggregator's own expected list both
  // come from this, so the list is generated from the code that defines the
  // groups, once, and never typed into ci.yml. The paths here are made up, so
  // these tests hold the rule; the last one holds this repository.
  const SAFETY = ['src/a/', 'src/b.ts', 'src/c/', 'src/unclaimed/'];
  const A = { name: 'a', paths: ['src/a/'], tests: ['src/a'] };
  const B = { name: 'b', paths: ['src/b.ts', 'src/c/'], tests: ['src/b.test.ts'] };

  /** hasSourceFiles as the runs see it: true when any of the paths asked about holds a file. */
  const holdingNothingIn = (empty) => (paths) => !paths.every((p) => empty.includes(p));

  test('BUG-45-AC1: the groups that have something to mutate, in order; the whole-suite run, with nothing to mutate, is left out', () => {
    const runs = mutationRuns(SAFETY, [A, B]);
    expect(runs.map((run) => run.name)).toEqual(['a', 'b', WHOLE_SUITE_RUN_NAME]);

    const { groups } = classifyRuns({ runs, hasSourceFiles: holdingNothingIn(['src/unclaimed/']) });

    expect(groups).toEqual(['a', 'b']);
  });

  test('BUG-45-AC1: a whole-suite run that has something to mutate goes in, last, as it runs last', () => {
    const runs = mutationRuns(SAFETY, [A, B]);

    expect(classifyRuns({ runs, hasSourceFiles: holdingNothingIn([]) }).groups).toEqual([
      'a',
      'b',
      WHOLE_SUITE_RUN_NAME,
    ]);
  });

  test('BUG-45-AC1: a group one of whose safety paths holds no source file stays in: its leg runs on its other paths and fails, naming the path, as the sequential run does', () => {
    const runs = mutationRuns(SAFETY, [A, B]);

    const { groups } = classifyRuns({
      runs,
      hasSourceFiles: holdingNothingIn(['src/c/', 'src/unclaimed/']),
    });

    expect(groups).toEqual(['a', 'b']);
  });

  test('BUG-45-AC1: the order is the order of the runs, not of their names', () => {
    const zeta = { ...B, name: 'zeta' };
    const alpha = { ...A, name: 'alpha' };
    const runs = mutationRuns(SAFETY, [zeta, alpha]);

    expect(
      classifyRuns({ runs, hasSourceFiles: holdingNothingIn(['src/unclaimed/']) }).groups,
    ).toEqual(['zeta', 'alpha']);
  });

  test('BUG-45-AC1: in this repository it is exactly the groups of MUTATION_GROUPS, the eight of them today, in order, and the whole-suite run, whose safety-core path holds no file yet, is left out', () => {
    const { groups } = classifyRuns({
      runs: mutationRuns(),
      hasSourceFiles: (paths) => hasSourceFiles(paths, root),
    });

    expect(groups).toEqual(MUTATION_GROUPS.map((group) => group.name));
    expect(groups).not.toContain(WHOLE_SUITE_RUN_NAME);
  });
});

describe('BUG-45: `pnpm run mutation --plan`, in a scratch repository (AC1, AC2)', () => {
  // The plan job's one step that decides: whether the groups run at all,
  // why, and which groups there are. Through the real script, as CI runs it,
  // in a repository whose groups' safety files are committed and whose
  // whole-suite path holds nothing, as this repository's does. A stand-in
  // `pnpm` first on PATH records any Stryker run, of which there must be
  // none: the plan only decides.
  const made = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const script = realpathSync(path.join(root, 'scripts', 'mutation.mjs'));
  const ARGS = ['--plan', '--only-if-safety-paths-changed', '--base', 'origin/main'];

  /** A committed scratch repository: every group's safety files, and the Stryker config unless `configured` is false. */
  function planRepository({ configured = true } = {}) {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'bug45-plan-')));
    made.push(dir);
    const repo = path.join(dir, 'repo');
    const bin = path.join(dir, 'bin');
    const started = path.join(dir, 'stryker-started.log');
    mkdirSync(repo);
    if (configured) writeFileSync(path.join(repo, 'stryker.config.mjs'), 'export default {};\n');
    for (const run of mutationRuns().filter((each) => each.name !== WHOLE_SUITE_RUN_NAME)) {
      for (const p of run.paths) plant(repo, p);
    }
    git(repo, ['init', '-q']);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', 'synthetic base']);
    // BUG-46 (RG-03): origin/main at the base commit, so that the plan's
    // `--base origin/main` resolves. Without it the base resolved to nothing,
    // which D-131 makes the plan refuse: these cases would then test that
    // refusal, not theirs. The diff each case makes is in the working tree,
    // as before.
    git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    mkdirSync(bin);
    writeFileSync(
      path.join(bin, 'pnpm'),
      ['#!/bin/sh', `echo "STRYKER_RUN=$STRYKER_RUN pnpm $*" >> "${started}"`, 'exit 1', ''].join(
        '\n',
      ),
    );
    chmodSync(path.join(bin, 'pnpm'), 0o755);
    return { dir, repo, bin, started };
  }

  /** The diff: a new file, or a line added to one the base commit holds. */
  function change(repo, file) {
    const at = path.join(repo, file);
    mkdirSync(path.dirname(at), { recursive: true });
    writeFileSync(
      at,
      `${existsSync(at) ? readFileSync(at, 'utf8') : ''}export const changed = 2;\n`,
    );
  }

  /** `node scripts/mutation.mjs --plan …` in `repo`, with only PATH, HOME and what `env` adds. */
  function plan({ repo, bin }, env = {}) {
    const result = spawnSync(process.execPath, [script, ...ARGS], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 60_000,
      env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: process.env.HOME, ...env },
    });
    return { ...result, output: `${result.stdout}${result.stderr}` };
  }

  const starts = (started) => (existsSync(started) ? readFileSync(started, 'utf8') : '');

  test.each([
    ['documentation only (CI-12)', 'docs/synthetic-notes.md', 'skip'],
    ['no safety code and nothing the score is measured with', 'apps/server/src/http.ts', 'skip'],
    ['a safety file', 'apps/server/src/worker.ts', 'run'],
    ['only what the score is measured with', 'packages/test-kit/src/synthetic-fake.ts', 'run'],
  ])(
    'BUG-45-AC2: a diff of %s: `decision` is today’s, `reason` is decideMutation’s message on one line, and `groups` is the full list, appended to GITHUB_OUTPUT as name=value',
    (_, file, expected) => {
      const today = decideMutation({
        changed: [file],
        onlyIfSafetyPathsChanged: true,
        configured: true,
      });
      // The case is what its name says, by today's rules.
      expect(today.action).toBe(expected);
      const repository = planRepository();
      change(repository.repo, file);
      const output = path.join(repository.dir, 'github-output');
      writeFileSync(output, 'code=true\n');

      const result = plan(repository, { GITHUB_OUTPUT: output });

      expect(result.error, result.output).toBeUndefined();
      expect(result.status, result.output).toBe(0);
      expect(starts(repository.started), 'a Stryker run started').toBe('');
      const { lines, values } = outputsIn(readFileSync(output, 'utf8'));
      // Appended: what the step's output file held is still there, first.
      expect(lines[0]).toBe('code=true');
      expect(values.decision, result.output).toBe(expected);
      expect(lines, result.output).toContain(`reason=${today.message}`);
      expect(
        lines.filter((line) => line.startsWith('groups=')),
        result.output,
      ).toHaveLength(1);
      expect(JSON.parse(values.groups ?? 'null'), result.output).toEqual(GROUP_NAMES);
    },
  );

  test('BUG-45-AC1: the plan names the run it leaves out for having nothing to mutate, and leaves it out of `groups`', () => {
    const repository = planRepository();
    change(repository.repo, 'apps/server/src/worker.ts');
    const output = path.join(repository.dir, 'github-output');

    const result = plan(repository, { GITHUB_OUTPUT: output });

    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toMatch(
      /whole-suite[^\n]*nothing to mutate|nothing to mutate[^\n]*whole-suite/i,
    );
    const groups = JSON.parse(outputsIn(readFileSync(output, 'utf8')).values.groups ?? 'null');
    expect(groups).toEqual(GROUP_NAMES);
    expect(groups).not.toContain(WHOLE_SUITE_RUN_NAME);
  });

  test('BUG-45-AC2: Stryker not set up, with a safety change: the plan exits 1 with today’s message, and starts nothing', () => {
    const repository = planRepository({ configured: false });
    change(repository.repo, 'apps/server/src/worker.ts');
    const today = decideMutation({
      changed: ['apps/server/src/worker.ts'],
      onlyIfSafetyPathsChanged: true,
      configured: false,
    });
    expect(today.ok).toBe(false);

    const result = plan(repository, { GITHUB_OUTPUT: path.join(repository.dir, 'github-output') });

    expect(result.error, result.output).toBeUndefined();
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain(today.message);
    expect(starts(repository.started), 'a Stryker run started').toBe('');
  });

  test('BUG-45-AC2: with no GITHUB_OUTPUT, the three outputs are printed instead', () => {
    const repository = planRepository();
    change(repository.repo, 'docs/synthetic-notes.md');

    const result = plan(repository);

    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toMatch(/\bdecision\s*[=:]\s*skip\b/);
    expect(result.stdout).toMatch(/\breason\s*[=:]/);
    expect(result.stdout).toContain(JSON.stringify(GROUP_NAMES));
    expect(starts(repository.started), 'a Stryker run started').toBe('');
  });

  test('BUG-45-AC2: a GITHUB_OUTPUT that cannot be written fails the plan, saying so: outputs nobody can read are a decision nobody made', () => {
    const repository = planRepository();
    change(repository.repo, 'apps/server/src/worker.ts');

    const result = plan(repository, {
      GITHUB_OUTPUT: path.join(repository.dir, 'no-such-folder', 'github-output'),
    });

    expect(result.error, result.output).toBeUndefined();
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain('GITHUB_OUTPUT');
    expect(starts(repository.started), 'a Stryker run started').toBe('');
  });
});

describe('BUG-45: `pnpm run mutation --group <name>`, in a scratch repository (AC3, AC4)', () => {
  // What each CI leg runs, and what a session runs before it pushes. Through
  // the real script, with spawnSync replaced (loaded with --import, as
  // gate.test.mjs does for gate:full) by a stand-in Stryker that records each
  // start, with its STRYKER_RUN and the timeout it was given, writes the
  // report it is told to, and exits with the status it is told to. git is
  // left to the real spawnSync.
  const made = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const script = realpathSync(path.join(root, 'scripts', 'mutation.mjs'));

  const FAKE_STRYKER = [
    "import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';",
    "import path from 'node:path';",
    "import childProcess from 'node:child_process';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const original = childProcess.spawnSync;',
    'childProcess.spawnSync = (command, args = [], options = {}) => {',
    "  if (command !== 'pnpm') return original(command, args, options);",
    '  const env = options.env ?? {};',
    '  const name = env.STRYKER_RUN ?? null;',
    '  appendFileSync(',
    '    env.FAKE_STRYKER_LOG,',
    "    JSON.stringify({ args, timeout: options.timeout ?? null, name }) + '\\n',",
    '  );',
    "  if (env.FAKE_STRYKER_REPORT !== 'none' && name !== null) {",
    "    const file = path.join(options.cwd ?? process.cwd(), env.FAKE_STRYKER_REPORT_FILE.replace('NAME', name));",
    '    mkdirSync(path.dirname(file), { recursive: true });',
    '    writeFileSync(file, env.FAKE_STRYKER_REPORT);',
    '  }',
    "  const stdout = 'the stand-in Stryker ran ' + String(name) + '\\n';",
    "  return { pid: 0, output: [null, stdout, ''], stdout, stderr: '', status: Number(env.FAKE_STRYKER_STATUS), signal: null };",
    '};',
    'syncBuiltinESMExports();',
    '',
  ].join('\n');

  const PASSING = reportOf({ 'apps/server/src/domain/planted.ts': { Killed: 10 } });
  const FAILING = reportOf({ 'apps/server/src/domain/planted.ts': { Killed: 5, Survived: 3 } });

  /** A scratch repository with every run's safety files and a Stryker config, and the stand-in beside it. */
  function groupRepository() {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'bug45-group-')));
    made.push(dir);
    const repo = path.join(dir, 'repo');
    mkdirSync(repo);
    writeFileSync(path.join(repo, 'stryker.config.mjs'), 'export default {};\n');
    for (const run of mutationRuns()) for (const p of run.paths) plant(repo, p);
    git(repo, ['init', '-q']);
    const fake = path.join(dir, 'fake-stryker.mjs');
    writeFileSync(fake, FAKE_STRYKER);
    return { dir, repo, fake, log: path.join(dir, 'stryker-calls.jsonl') };
  }

  /** `node scripts/mutation.mjs …args` in `repo`, the stand-in writing `report` (null for none) and exiting with `status`. */
  function mutation({ repo, fake, log }, args, { report = PASSING, status = 0 } = {}) {
    const result = spawnSync(
      process.execPath,
      ['--import', pathToFileURL(fake).href, script, ...args],
      {
        cwd: repo,
        encoding: 'utf8',
        timeout: 60_000,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          FAKE_STRYKER_LOG: log,
          FAKE_STRYKER_REPORT: report === null ? 'none' : JSON.stringify(report),
          FAKE_STRYKER_REPORT_FILE: mutationReportFile('NAME'),
          FAKE_STRYKER_STATUS: String(status),
        },
      },
    );
    return { ...result, output: `${result.stdout}${result.stderr}` };
  }

  /** Every Stryker start the stand-in recorded. */
  const startsIn = (log) =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => JSON.parse(line))
      : [];

  /** The verdict file a run wrote, parsed, or null. */
  const verdictIn = (repo, name) => {
    const file = path.join(repo, verdictFile(name));
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  };

  /** The last line the script printed. */
  const lastLine = (stdout) => stdout.trim().split('\n').at(-1) ?? '';

  test('BUG-45-AC3: `--group domain` starts Stryker once, for domain alone, named in STRYKER_RUN, with the whole budget as its timeout; a report that passes exits 0', () => {
    const repository = groupRepository();

    const result = mutation(repository, ['--group', 'domain']);

    expect(result.error, result.output).toBeUndefined();
    expect(result.status, result.output).toBe(0);
    const calls = startsIn(repository.log);
    expect(calls.map((call) => call.name)).toEqual(['domain']);
    expect(calls[0]?.args).toEqual(['exec', 'stryker', 'run']);
    // The whole budget, less what starting took: never a share of it.
    expect(calls[0]?.timeout).toBeGreaterThan(MUTATION_TIMEOUT_MS - 60_000);
    expect(calls[0]?.timeout).toBeLessThanOrEqual(MUTATION_TIMEOUT_MS);
    expect(result.output).toContain(judgeMutationReport(PASSING).message.trim());
  });

  test('BUG-45-AC3: it writes a verdict file beside the report: the run’s name, Stryker’s exit status, and the verdict', () => {
    const repository = groupRepository();

    mutation(repository, ['--group', 'domain']);

    expect(verdictIn(repository.repo, 'domain')).toMatchObject({
      name: 'domain',
      status: 0,
      ok: true,
    });
    expect(existsSync(path.join(repository.repo, mutationReportFile('domain')))).toBe(true);
    expect(verdictIn(repository.repo, 'healthchecks')).toBeNull();
  });

  test.each([
    ['passes', PASSING, 0],
    ['fails', FAILING, 1],
  ])(
    'BUG-45-AC3: when the run %s, its last line says that only this group ran and that this is not the mutation gate',
    (_, report, exitCode) => {
      const repository = groupRepository();

      const result = mutation(repository, ['--group', 'domain'], { report });

      expect(result.status, result.output).toBe(exitCode);
      const last = lastLine(result.stdout);
      expect(last, result.output).toMatch(/(?<![\w-])domain(?![\w-])/);
      expect(last, result.output).toMatch(/\bonly\b/i);
      expect(last, result.output).toMatch(/\bnot the mutation gate\b/i);
    },
  );

  test('BUG-45-AC3: a report with a file below 80 % exits 1, judged by judgeMutationReport, and its verdict file says it failed', () => {
    const repository = groupRepository();

    const result = mutation(repository, ['--group', 'domain'], { report: FAILING });

    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('apps/server/src/domain/planted.ts');
    expect(result.output).toMatch(/62\.5 ?%/);
    expect(verdictIn(repository.repo, 'domain')).toMatchObject({
      name: 'domain',
      status: 0,
      ok: false,
    });
  });

  test('BUG-45-AC3: Stryker exiting 1 exits 1, judged by judgeMutationRun, and its verdict file holds that status', () => {
    const repository = groupRepository();

    const result = mutation(repository, ['--group', 'domain'], { status: 1 });

    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain('Stryker exited with 1');
    expect(verdictIn(repository.repo, 'domain')).toMatchObject({
      name: 'domain',
      status: 1,
      ok: false,
    });
  });

  test('BUG-45-AC3: the report is cleared first: one left from an earlier run never stands in for this one, which wrote none', () => {
    const repository = groupRepository();
    const leftover = path.join(repository.repo, mutationReportFile('domain'));
    mkdirSync(path.dirname(leftover), { recursive: true });
    writeFileSync(leftover, JSON.stringify(PASSING));

    const result = mutation(repository, ['--group', 'domain'], { report: null });

    expect(result.status, result.output).toBe(1);
    expect(result.output).toMatch(/no (json )?report/i);
    expect(verdictIn(repository.repo, 'domain')).toMatchObject({ name: 'domain', ok: false });
  });

  test.each([
    ['an unknown name', ['--group', 'no-such-group'], /no-such-group/],
    ['no name at all', ['--group'], /--group/],
    ['another flag where the name goes', ['--group', '--only-if-safety-paths-changed'], /--group/],
    ['two groups', ['--group', 'domain', '--group', 'alerts'], /--group/],
    [
      'the CI filter, since a group asked for by name always runs',
      ['--group', 'domain', '--only-if-safety-paths-changed'],
      /--only-if-safety-paths-changed/,
    ],
    ['--plan', ['--group', 'domain', '--plan'], /--plan/],
    ['--aggregate', ['--group', 'domain', '--aggregate', 'artifacts'], /--aggregate/],
    ['--incremental (D-099)', ['--group', 'domain', '--incremental'], /--incremental/],
  ])(
    'BUG-45-AC4: `--group` with %s is refused before anything starts: exit 1, no Stryker run, no report, and the reason',
    (_, args, names) => {
      const repository = groupRepository();
      // In this repository `--group domain` alone starts Stryker. Without
      // this, "nothing started" below could hold only because nothing would.
      const fine = mutation(repository, ['--group', 'domain']);
      expect(
        startsIn(repository.log).map((call) => call.name),
        fine.output,
      ).toEqual(['domain']);
      rmSync(repository.log);
      rmSync(path.join(repository.repo, 'reports'), { recursive: true, force: true });

      const refused = mutation(repository, args);

      expect(refused.error, refused.output).toBeUndefined();
      expect(refused.signal, refused.output).toBeNull();
      expect(refused.status, refused.output).toBe(1);
      expect(startsIn(repository.log), 'a Stryker run started').toEqual([]);
      expect(existsSync(path.join(repository.repo, 'reports')), 'a report was written').toBe(false);
      expect(refused.output).toMatch(names);
    },
  );

  test('BUG-45-AC4: an unknown name is refused with every run’s name, so the right one can be read off the message', () => {
    const repository = groupRepository();

    const refused = mutation(repository, ['--group', 'no-such-group']);

    expect(refused.status, refused.output).toBe(1);
    for (const run of mutationRuns()) {
      expect(refused.output).toContain(run.name);
    }
  });
});

/**
 * The runs the aggregator's tests derive their expected list from: two
 * groups, and a whole-suite run whose path holds nothing. Made up, so that
 * every name a message must hold is one no other word in it holds.
 */
const AGGREGATED_RUNS = [
  { name: 'alpha', paths: ['src/alpha/'], tests: ['src/alpha'] },
  { name: 'beta', paths: ['src/beta.ts', 'src/beta-more/'], tests: ['src/beta.test.ts'] },
  { name: WHOLE_SUITE_RUN_NAME, paths: ['src/unclaimed/'], tests: ['apps', 'packages'] },
];

/** A group's report, raw, as the leg uploaded it: every mutant of its one file killed. */
const passingReportText = (name) =>
  JSON.stringify(reportOf({ [`src/${name}/${name}.ts`]: { Killed: 10 } }));

/** A group's verdict file, raw, as `--group` writes it. */
const verdictText = (name, { status = 0, ok = true } = {}) =>
  JSON.stringify({ name, status, ok, message: '' });

/**
 * What the aggregator is handed when everything went well: the plan's result
 * and its three outputs as GitHub hands them, strings; the group job's
 * result; and, by run name, the raw text of each report and verdict file
 * found in the downloaded folder. `change` edits a copy before it is judged.
 */
function aggregate(change = () => undefined) {
  const input = {
    runs: AGGREGATED_RUNS.map((run) => ({ ...run })),
    nothingIn: ['src/unclaimed/'],
    plan: {
      result: 'success',
      decision: 'run',
      reason: 'mutation: running on 1 changed safety file(s).',
      groups: JSON.stringify(['alpha', 'beta']),
    },
    groupResult: 'success',
    reports: { alpha: passingReportText('alpha'), beta: passingReportText('beta') },
    verdicts: { alpha: verdictText('alpha'), beta: verdictText('beta') },
  };
  change(input);
  const { nothingIn, ...rest } = input;
  return aggregateMutationJobs({
    ...rest,
    hasSourceFiles: (paths) => !paths.every((p) => nothingIn.includes(p)),
  });
}

describe('BUG-45: aggregateMutationJobs, the verdict of the required `mutation` check (AC5–AC7)', () => {
  // The aggregator is the only job GitHub reads as the check. It passes only
  // when every group its own code expects reported and passed, judged again
  // from the raw reports; it trusts neither the plan's list nor GitHub's
  // roll-up of the legs. Anything less fails, naming the cause.

  test('BUG-45-AC5: the plan succeeded and said run, its groups are the expected ones, the legs succeeded, and every group’s verdict and report pass: it passes, printing each group’s per-file lines', () => {
    const verdict = aggregate();

    expect(verdict.ok, verdict.message).toBe(true);
    for (const name of ['alpha', 'beta']) {
      expect(verdict.message).toContain(name);
      expect(verdict.message).toContain(`src/${name}/${name}.ts: 100 %`);
    }
  });

  test('BUG-45-AC5: it derives the groups it expects itself, from the runs and the paths at this commit: a plan and legs that both left a group out do not pass', () => {
    // If the aggregator took the plan's word, this would pass: the plan, the
    // legs and the artifacts agree with each other, and leave beta unmeasured.
    const verdict = aggregate((input) => {
      input.plan.groups = JSON.stringify(['alpha']);
      delete input.reports.beta;
      delete input.verdicts.beta;
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/(?<![\w-])beta(?![\w-])/);
  });

  // Built here, not in the table below: HK-05 reads a test.each table only up
  // to its first closing parenthesis.
  const BELOW_80 = JSON.stringify(reportOf({ 'src/beta/beta.ts': { Killed: 5, Survived: 3 } }));
  const AC6 = [
    [
      'the plan job failed',
      (i) => Object.assign(i.plan, { result: 'failure' }),
      [/mutation-plan/, /failure/],
    ],
    [
      'the plan job was cancelled',
      (i) => Object.assign(i.plan, { result: 'cancelled' }),
      [/mutation-plan/, /cancelled/],
    ],
    [
      'the plan job was skipped',
      (i) => Object.assign(i.plan, { result: 'skipped' }),
      [/mutation-plan/, /skipped/],
    ],
    ['the decision is empty', (i) => Object.assign(i.plan, { decision: '' }), [/decision/]],
    ['the decision is missing', (i) => delete i.plan.decision, [/decision/]],
    [
      'the decision is neither run nor skip',
      (i) => Object.assign(i.plan, { decision: 'maybe' }),
      [/decision/, /maybe/],
    ],
    ['the groups are not JSON', (i) => Object.assign(i.plan, { groups: 'alpha,beta' }), [/groups/]],
    [
      'a group is listed twice',
      (i) => Object.assign(i.plan, { groups: '["alpha","alpha","beta"]' }),
      [/(?<![\w-])alpha(?![\w-])/, /twice|duplicate|more than once/i],
    ],
    [
      'an expected group is missing from the groups',
      (i) => Object.assign(i.plan, { groups: '["alpha"]' }),
      [/(?<![\w-])beta(?![\w-])/],
    ],
    [
      'the groups name one not expected',
      (i) => Object.assign(i.plan, { groups: '["alpha","beta","gamma"]' }),
      [/gamma/],
    ],
    [
      'the group job failed',
      (i) => Object.assign(i, { groupResult: 'failure' }),
      [/mutation-group/, /failure/],
    ],
    [
      'the group job was cancelled',
      (i) => Object.assign(i, { groupResult: 'cancelled' }),
      [/mutation-group/, /cancelled/],
    ],
    [
      'the group job was skipped',
      (i) => Object.assign(i, { groupResult: 'skipped' }),
      [/mutation-group/, /skipped/],
    ],
    [
      'a group’s report is missing',
      (i) => delete i.reports.beta,
      [/(?<![\w-])beta(?![\w-])/, /report/i],
    ],
    [
      'a group’s verdict file is missing',
      (i) => delete i.verdicts.beta,
      [/(?<![\w-])beta(?![\w-])/, /verdict/i],
    ],
    [
      'a report does not parse',
      (i) => Object.assign(i.reports, { beta: '{"files": ' }),
      [/(?<![\w-])beta(?![\w-])/, /pars|JSON/i],
    ],
    // BUG-45 review loop 1 (test-auditor S1): a row added, none changed. Its
    // report passes, so only the verdict file can fail the group, and the
    // line that says so names the group, the verdict file and the parse.
    [
      'a verdict file does not parse',
      (i) => Object.assign(i.verdicts, { beta: '{"name": ' }),
      [/(?<![\w-])beta(?![\w-])[^\n]*verdict[^\n]*(?:pars|JSON)/i],
    ],
    [
      'a verdict file holds a non-zero exit',
      (i) => Object.assign(i.verdicts, { beta: verdictText('beta', { status: 1 }) }),
      [/(?<![\w-])beta(?![\w-])/],
    ],
    [
      'a verdict file holds a failed verdict',
      (i) => Object.assign(i.verdicts, { beta: verdictText('beta', { ok: false }) }),
      [/(?<![\w-])beta(?![\w-])/],
    ],
    [
      'a report has a file below 80 %, with the group job a success',
      (i) => Object.assign(i.reports, { beta: BELOW_80 }),
      [/(?<![\w-])beta(?![\w-])/, /src\/beta\/beta\.ts/, /62\.5 ?%/],
    ],
    [
      'a report is for a group not expected',
      (i) => Object.assign(i.reports, { gamma: passingReportText('gamma') }),
      [/gamma/],
    ],
    [
      'a group’s safety path holds no source file',
      (i) => i.nothingIn.push('src/beta-more/'),
      [/src\/beta-more\//],
    ],
    [
      'no run has anything to mutate',
      (i) =>
        Object.assign(
          i,
          { runs: [AGGREGATED_RUNS[2]], reports: {}, verdicts: {} },
          { plan: { ...i.plan, groups: '[]' } },
        ),
      [/nothing/i],
    ],
  ];

  test.each(AC6)('BUG-45-AC6: %s: it fails, naming the cause', (_, change, names) => {
    const verdict = aggregate(change);

    expect(verdict.ok, verdict.message).toBe(false);
    for (const name of names) {
      expect(verdict.message).toMatch(name);
    }
  });

  test('BUG-45-AC6: when several causes hold, every one is named', () => {
    const verdict = aggregate((input) => {
      input.plan.groups = JSON.stringify(['alpha']);
      input.verdicts.alpha = verdictText('alpha', { status: 1 });
      input.reports.gamma = passingReportText('gamma');
      input.groupResult = 'failure';
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/(?<![\w-])beta(?![\w-])/);
    expect(verdict.message).toMatch(/(?<![\w-])alpha(?![\w-])/);
    expect(verdict.message).toMatch(/gamma/);
    expect(verdict.message).toMatch(/mutation-group/);
  });

  test('BUG-45-AC7: the plan said skip and the group job was skipped: it passes, printing the plan’s reason', () => {
    const reason =
      'mutation: this change touches no safety code, and nothing the score is measured with, so there is nothing to mutate (D-036, D-098).';

    const verdict = aggregate((input) => {
      Object.assign(input.plan, { decision: 'skip', reason });
      Object.assign(input, { groupResult: 'skipped', reports: {}, verdicts: {} });
    });

    expect(verdict.ok, verdict.message).toBe(true);
    expect(verdict.message).toContain(reason);
  });

  test.each([['success'], ['failure'], ['cancelled']])(
    'BUG-45-AC7: the plan said skip but the group job’s result is %s: it fails as inconsistent',
    (result) => {
      const verdict = aggregate((input) => {
        input.plan.decision = 'skip';
        input.groupResult = result;
      });

      expect(verdict.ok).toBe(false);
      expect(verdict.message).toMatch(/inconsistent/i);
      expect(verdict.message).toContain(result);
    },
  );
});

describe('BUG-45: `pnpm run mutation --aggregate <dir>`, in a scratch repository (AC5–AC7)', () => {
  // The required check's one step, through the real script, as ci.yml runs
  // it: the plan's outputs and both jobs' results in its environment, and the
  // legs' artifacts downloaded, merged, into one folder: each group's
  // `<name>.json` report and `<name>.verdict.json` beside it. The expected
  // groups are derived from this repository's runs and the scratch
  // repository's files, where every group's safety files are and the
  // whole-suite path holds nothing.
  const made = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const script = realpathSync(path.join(root, 'scripts', 'mutation.mjs'));

  /**
   * The scratch repository, the folder the legs' artifacts were downloaded
   * into, and, first on PATH, a stand-in `pnpm` that records any Stryker run
   * and exits 1. The aggregator mutates nothing: it only reads what the legs
   * left, so any start it makes is a failure.
   */
  function aggregateRepository() {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'bug45-aggregate-')));
    made.push(dir);
    const repo = path.join(dir, 'repo');
    const artifacts = path.join(dir, 'artifacts');
    const bin = path.join(dir, 'bin');
    const started = path.join(dir, 'stryker-started.log');
    mkdirSync(repo);
    mkdirSync(artifacts);
    mkdirSync(bin);
    writeFileSync(
      path.join(bin, 'pnpm'),
      ['#!/bin/sh', `echo "STRYKER_RUN=$STRYKER_RUN pnpm $*" >> "${started}"`, 'exit 1', ''].join(
        '\n',
      ),
    );
    chmodSync(path.join(bin, 'pnpm'), 0o755);
    writeFileSync(path.join(repo, 'stryker.config.mjs'), 'export default {};\n');
    for (const run of mutationRuns().filter((each) => each.name !== WHOLE_SUITE_RUN_NAME)) {
      for (const p of run.paths) plant(repo, p);
      writeFileSync(
        path.join(artifacts, `${run.name}.json`),
        JSON.stringify(reportOf({ [`${run.name}.ts`]: { Killed: 1 } })),
      );
      writeFileSync(path.join(artifacts, `${run.name}.verdict.json`), verdictText(run.name));
    }
    git(repo, ['init', '-q']);
    return { dir, repo, artifacts, bin, started };
  }

  /** `node scripts/mutation.mjs --aggregate <folder>` in `repo`, with `env` and nothing else of this machine's but PATH and HOME. */
  function aggregateIn({ repo, bin, started }, folder, env) {
    const result = spawnSync(process.execPath, [script, '--aggregate', folder], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 60_000,
      env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: process.env.HOME, ...env },
    });
    return {
      ...result,
      output: `${result.stdout}${result.stderr}`,
      starts: existsSync(started) ? readFileSync(started, 'utf8') : '',
    };
  }

  const RAN = {
    MUTATION_PLAN_RESULT: 'success',
    MUTATION_PLAN_DECISION: 'run',
    MUTATION_PLAN_REASON: 'mutation: running on 1 changed safety file(s).',
    MUTATION_PLAN_GROUPS: JSON.stringify(GROUP_NAMES),
    MUTATION_GROUP_RESULT: 'success',
  };

  test('BUG-45-AC5: every group reported and passed: it exits 0 and prints every group’s per-file lines', () => {
    const repository = aggregateRepository();

    const result = aggregateIn(repository, repository.artifacts, RAN);

    expect(result.error, result.output).toBeUndefined();
    expect(result.starts, 'the aggregator started a Stryker run').toBe('');
    expect(result.status, result.output).toBe(0);
    for (const name of GROUP_NAMES) {
      expect(result.stdout).toContain(`${name}.ts: 100 %`);
    }
  });

  test('BUG-45-AC6: one group’s report missing from the folder: it exits 1, naming that group', () => {
    const repository = aggregateRepository();
    rmSync(path.join(repository.artifacts, 'canary.json'));

    const result = aggregateIn(repository, repository.artifacts, RAN);

    expect(result.error, result.output).toBeUndefined();
    expect(result.starts, 'the aggregator started a Stryker run').toBe('');
    expect(result.status, result.output).toBe(1);
    expect(result.output).toMatch(
      /(?<![\w-])canary(?![\w-])[^\n]*report|report[^\n]*(?<![\w-])canary(?![\w-])/i,
    );
  });

  test('BUG-45-AC6: the plan job’s result failure, with every report, verdict and other value passing: it exits 1, naming mutation-plan and its failure', () => {
    // BUG-45 review loop 1 (test-auditor S2): the one value of the plan's
    // environment that, read wrongly or not at all, leaves every other input
    // passing. A failed plan's outputs cannot be relied on, whatever the legs
    // left.
    const repository = aggregateRepository();

    const result = aggregateIn(repository, repository.artifacts, {
      ...RAN,
      MUTATION_PLAN_RESULT: 'failure',
    });

    expect(result.error, result.output).toBeUndefined();
    expect(result.starts, 'the aggregator started a Stryker run').toBe('');
    expect(result.status, result.output).toBe(1);
    expect(result.output).toMatch(/(?<![\w-])mutation-plan(?![\w-])[^\n]*failure/);
  });

  test('BUG-45-AC6: the plan’s environment missing altogether is a wiring fault, and fails', () => {
    const repository = aggregateRepository();

    const result = aggregateIn(repository, repository.artifacts, {});

    expect(result.error, result.output).toBeUndefined();
    expect(result.starts, 'the aggregator started a Stryker run').toBe('');
    expect(result.status, result.output).toBe(1);
    expect(result.output).toMatch(/decision/);
  });

  test('BUG-45-AC7: the plan said skip and the group job was skipped, with no folder downloaded: it exits 0, printing the plan’s reason', () => {
    const repository = aggregateRepository();
    const reason =
      'mutation: this change touches no safety code, and nothing the score is measured with, so there is nothing to mutate (D-036, D-098).';

    const result = aggregateIn(repository, path.join(repository.dir, 'never-downloaded'), {
      ...RAN,
      MUTATION_PLAN_DECISION: 'skip',
      MUTATION_PLAN_REASON: reason,
      MUTATION_GROUP_RESULT: 'skipped',
    });

    expect(result.error, result.output).toBeUndefined();
    expect(result.starts, 'the aggregator started a Stryker run').toBe('');
    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toContain(reason);
  });
});

// ===========================================================================
// BUG-46 (D-131): a --base git cannot resolve made the diff look empty.
// ===========================================================================

describe('BUG-46: `pnpm run mutation` with a --base git cannot resolve, in a scratch repository (D-131)', () => {
  // With `--base origin/no-such-branch`, changedFiles() dropped the committed
  // diff, so `--plan --only-if-safety-paths-changed` printed decision=skip,
  // `--only-if-safety-paths-changed` printed "nothing to mutate", and both
  // exited 0: a safety change committed on the branch was never mutated.
  // Reproduced on 2026-10-13. D-131, the owner's answer: where the decision
  // reads the diff, the script exits 1, naming the base and saying it could
  // not tell, and starts nothing. A plain `pnpm run mutation` runs every group
  // whatever changed, and is unchanged. The shared helper behind the refusal,
  // requireMergeBase, is tested in scripts/lib/git.test.mjs.
  const made = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const script = realpathSync(path.join(root, 'scripts', 'mutation.mjs'));
  const UNKNOWN_BASE = 'origin/no-such-branch';
  /** "Could not tell", in D-131's words or close to them. */
  const COULD_NOT_TELL = /\b(could not|cannot|can not|can't) tell\b/i;
  const SAFETY_FILE = 'apps/server/src/worker.ts';

  /**
   * A pull request as CI checks it out: origin/main at a base commit holding
   * every group's safety files and a Stryker config, and the branch one
   * commit on top of it that changes a safety file. The working tree is
   * clean, so the change shows only in the committed diff. Beside it, first
   * on PATH, a stand-in `pnpm` that logs each Stryker start to `started`,
   * writes a report in which the run's one mutant was killed, and exits 0:
   * every run that starts passes.
   */
  function pullRequestRepository() {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'bug46-mutation-')));
    made.push(dir);
    const repo = path.join(dir, 'repo');
    const bin = path.join(dir, 'bin');
    const started = path.join(dir, 'stryker-started.log');
    mkdirSync(repo);
    writeFileSync(path.join(repo, 'stryker.config.mjs'), 'export default {};\n');
    for (const run of mutationRuns().filter((each) => each.name !== WHOLE_SUITE_RUN_NAME)) {
      for (const p of run.paths) plant(repo, p);
    }
    git(repo, ['init', '-q']);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', 'synthetic base']);
    git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    git(repo, ['checkout', '-q', '-b', 'the-pull-request']);
    writeFileSync(path.join(repo, SAFETY_FILE), 'export const planted = 2;\n');
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', 'the pull request']);
    mkdirSync(bin);
    const report = mutationReportFile('$STRYKER_RUN');
    const passing = JSON.stringify(reportOf({ 'planted.ts': { Killed: 1 } }));
    writeFileSync(
      path.join(bin, 'pnpm'),
      [
        '#!/bin/sh',
        `echo "STRYKER_RUN=$STRYKER_RUN pnpm $*" >> "${started}"`,
        `mkdir -p "$(dirname "${report}")"`,
        `echo '${passing}' > "${report}"`,
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(path.join(bin, 'pnpm'), 0o755);
    return { dir, repo, bin, started };
  }

  /** `node scripts/mutation.mjs …args` in `repo`, with only PATH, HOME and what `env` adds. */
  function mutation({ repo, bin }, args, env = {}) {
    const result = spawnSync(process.execPath, [script, ...args], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 60_000,
      env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: process.env.HOME, ...env },
    });
    return { ...result, output: `${result.stdout}${result.stderr}` };
  }

  const starts = (started) => (existsSync(started) ? readFileSync(started, 'utf8') : '');

  /** The condition the refusals below rest on: git finds no merge base with UNKNOWN_BASE. */
  function expectUnresolvable(repo) {
    expect(() => git(repo, ['merge-base', 'HEAD', UNKNOWN_BASE])).toThrow();
  }

  test('BUG-46: `--plan --only-if-safety-paths-changed` with a base that resolves reads the committed diff, as today: decision=run', () => {
    const repository = pullRequestRepository();
    const output = path.join(repository.dir, 'github-output');

    const result = mutation(
      repository,
      ['--plan', '--only-if-safety-paths-changed', '--base', 'origin/main'],
      { GITHUB_OUTPUT: output },
    );

    expect(result.error, result.output).toBeUndefined();
    expect(result.status, result.output).toBe(0);
    expect(outputsIn(readFileSync(output, 'utf8')).values.decision, result.output).toBe('run');
    expect(starts(repository.started), 'a Stryker run started').toBe('');
  });

  test('BUG-46: `--plan --only-if-safety-paths-changed` with a base git cannot resolve exits 1, naming the base and saying it could not tell, and writes no decision', () => {
    const repository = pullRequestRepository();
    expectUnresolvable(repository.repo);
    const output = path.join(repository.dir, 'github-output');
    writeFileSync(output, 'code=true\n');

    const result = mutation(
      repository,
      ['--plan', '--only-if-safety-paths-changed', '--base', UNKNOWN_BASE],
      { GITHUB_OUTPUT: output },
    );

    expect(result.error, result.output).toBeUndefined();
    expect(result.output).not.toContain('decision=skip');
    expect(result.output).not.toContain('touches no safety code');
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain(UNKNOWN_BASE);
    expect(result.output).toMatch(COULD_NOT_TELL);
    // A plan that could not tell decides nothing for the legs to act on.
    expect(outputsIn(readFileSync(output, 'utf8')).values.decision, result.output).toBeUndefined();
    expect(starts(repository.started), 'a Stryker run started').toBe('');
  });

  test('BUG-46: `--only-if-safety-paths-changed` with a base that resolves starts Stryker on the committed safety change, as today', () => {
    const repository = pullRequestRepository();

    const result = mutation(repository, [
      '--only-if-safety-paths-changed',
      '--base',
      'origin/main',
    ]);

    expect(result.error, result.output).toBeUndefined();
    expect(result.status, result.output).toBe(0);
    expect(starts(repository.started), result.output).toContain('pnpm exec stryker run');
  });

  test('BUG-46: `--only-if-safety-paths-changed` with a base git cannot resolve exits 1, naming the base and saying it could not tell, and starts no Stryker run', () => {
    const repository = pullRequestRepository();
    expectUnresolvable(repository.repo);

    const result = mutation(repository, ['--only-if-safety-paths-changed', '--base', UNKNOWN_BASE]);

    expect(result.error, result.output).toBeUndefined();
    expect(result.output).not.toContain('touches no safety code');
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain(UNKNOWN_BASE);
    expect(result.output).toMatch(COULD_NOT_TELL);
    expect(starts(repository.started), 'a Stryker run started').toBe('');
  });

  test('BUG-46: a plain `pnpm run mutation` with a base git cannot resolve is not refused: it runs every group, whatever changed, as D-131 leaves it', () => {
    const repository = pullRequestRepository();
    expectUnresolvable(repository.repo);

    const result = mutation(repository, ['--base', UNKNOWN_BASE]);

    expect(result.error, result.output).toBeUndefined();
    expect(result.output).not.toMatch(COULD_NOT_TELL);
    expect(result.status, result.output).toBe(0);
    for (const name of GROUP_NAMES) {
      expect(starts(repository.started), result.output).toContain(
        `STRYKER_RUN=${name} pnpm exec stryker run`,
      );
    }
  });

  test('BUG-46: `--plan` without `--only-if-safety-paths-changed`, with a base git cannot resolve, is not refused: it prints decision=run and exits 0, as D-131 leaves it', () => {
    // --plan alone plans every group whatever changed, so its decision reads
    // no diff, and D-131 refuses only where the decision does. safety-reviewer
    // and test-auditor each noted that nothing pinned this: a refusal on the
    // --plan step itself would have passed every other test here.
    const repository = pullRequestRepository();
    expectUnresolvable(repository.repo);
    const output = path.join(repository.dir, 'github-output');

    const result = mutation(repository, ['--plan', '--base', UNKNOWN_BASE], {
      GITHUB_OUTPUT: output,
    });

    expect(result.error, result.output).toBeUndefined();
    expect(result.output).not.toMatch(COULD_NOT_TELL);
    expect(result.status, result.output).toBe(0);
    expect(result.stdout).toContain('decision=run');
    expect(outputsIn(readFileSync(output, 'utf8')).values.decision, result.output).toBe('run');
    expect(starts(repository.started), 'a Stryker run started').toBe('');
  });
});
