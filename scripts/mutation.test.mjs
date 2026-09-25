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
import { describe, expect, test } from 'vitest';
import { runMutationGroups, strykerRunner } from './mutation.mjs';

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

const MINUTE = 60_000;

const lowScore = { ok: false, status: 1, output: 'Final mutation score of 71.43 is under break\n' };
const timedOut = { ok: false, status: null, output: 'spawnSync pnpm ETIMEDOUT' };

/**
 * Runs the loop against a fake Stryker. `takes` says how long each run lasts
 * and `results` what it returns; a run with no result passes and prints a
 * report naming itself.
 */
async function runGroups({ runs = RUNS, budgetMs = 25 * MINUTE, takes = {}, results = {} } = {}) {
  let clock = 1_758_000_000_000;
  const events = [];
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
      return results[name] ?? { ok: true, status: 0, output: `report of the ${name} run\n` };
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

  test('starts Stryker with STRYKER_RUN naming the run, in the time it was given', () => {
    const { calls, run } = recordingRun();
    const runStryker = strykerRunner({ run, cwd: '/repo', incremental: true });

    const result = runStryker({ name: 'healthchecks', timeout: 21 * MINUTE });

    expect(result).toEqual({ ok: true, status: 0, output: 'done' });
    expect(calls).toEqual([
      {
        command: 'pnpm',
        args: ['exec', 'stryker', 'run', '--incremental'],
        options: { cwd: '/repo', timeout: 21 * MINUTE, env: { STRYKER_RUN: 'healthchecks' } },
      },
    ]);
  });

  test('without --incremental, Stryker is not asked for it', () => {
    const { calls, run } = recordingRun();
    const runStryker = strykerRunner({ run, cwd: '/repo', incremental: false });

    runStryker({ name: 'domain', timeout: 25 * MINUTE });

    expect(calls.map((call) => call.args)).toEqual([['exec', 'stryker', 'run']]);
    expect(calls[0]?.options.env).toEqual({ STRYKER_RUN: 'domain' });
  });
});
