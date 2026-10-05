// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// These two gates spend milestone M0 with nothing to check. The tests are mostly
// about the difference between "checked, and it is fine" and "could not check" —
// which is the difference between a gate and a decoration.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  MUTATION_GROUPS,
  SAFETY_PATHS,
  WHOLE_SUITE,
  decideApiDiff,
  decideMutation,
  judgeMutationReport,
  judgeMutationRun,
  mutationRuns,
} from './gate-decisions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('decideApiDiff', () => {
  test('no released versions: nothing can break, and it says why', () => {
    const decision = decideApiDiff({ releasedSpecs: [], currentSpec: null, toolAvailable: false });
    expect(decision).toMatchObject({ ok: true, action: 'skip' });
    expect(decision.message).toContain('no released API versions yet');
  });

  test('released versions but no current description: refuses to pass', () => {
    const decision = decideApiDiff({
      releasedSpecs: ['v1-app-1.0.0.json'],
      currentSpec: null,
      toolAvailable: true,
    });
    expect(decision.ok).toBe(false);
  });

  test('released versions but no oasdiff: refuses to pass, rather than skipping quietly', () => {
    const decision = decideApiDiff({
      releasedSpecs: ['v1-app-1.0.0.json'],
      currentSpec: 'packages/contracts/openapi.json',
      toolAvailable: false,
    });
    expect(decision.ok).toBe(false);
    expect(decision.message).toContain('NOT checked');
  });

  test('everything present: compare', () => {
    const decision = decideApiDiff({
      releasedSpecs: ['v1-app-1.0.0.json', 'v1-app-1.1.0.json'],
      currentSpec: 'packages/contracts/openapi.json',
      toolAvailable: true,
    });
    expect(decision).toMatchObject({ ok: true, action: 'compare' });
    expect(decision.message).toContain('2 released version(s)');
  });
});

describe('decideMutation', () => {
  const safetyChange = ['apps/server/src/domain/journey.ts'];

  test('a change with no safety code in it has nothing to mutate', () => {
    const decision = decideMutation({
      changed: ['docs/progress.md', 'apps/mobile/src/features/help/Help.tsx'],
      onlyIfSafetyPathsChanged: true,
      configured: false,
    });
    expect(decision).toMatchObject({ ok: true, action: 'skip' });
  });

  test.each([
    ['apps/server/src/domain/journey.ts'],
    ['apps/server/src/modules/alerts/escalate.ts'],
    ['apps/server/src/worker.ts'],
    // Where a worker that stopped is made to exit with 1, so it is restarted.
    ['apps/server/src/bin/worker.ts'],
    ['apps/server/src/process.ts'],
    // The check-in that tells Healthchecks.io the worker is alive. The owner made it a safety path.
    ['apps/server/src/adapters/healthchecks.ts'],
    ['apps/mobile/src/safety-core/heartbeat.ts'],
  ])('%s counts as safety code', (file) => {
    const decision = decideMutation({
      changed: [file],
      onlyIfSafetyPathsChanged: true,
      configured: false,
    });
    expect(decision.ok).toBe(false);
  });

  test('safety code changed but Stryker missing: fails, and names the files', () => {
    const decision = decideMutation({
      changed: safetyChange,
      onlyIfSafetyPathsChanged: true,
      configured: false,
    });
    expect(decision.ok).toBe(false);
    expect(decision.message).toContain('apps/server/src/domain/journey.ts');
    expect(decision.message).toContain('D-036');
  });

  test('safety code changed and Stryker set up: run it', () => {
    const decision = decideMutation({
      changed: safetyChange,
      onlyIfSafetyPathsChanged: true,
      configured: true,
    });
    expect(decision).toMatchObject({ ok: true, action: 'run' });
  });

  test('asked for without the filter, with no setup: still refuses to pass', () => {
    const decision = decideMutation({
      changed: ['docs/progress.md'],
      onlyIfSafetyPathsChanged: false,
      configured: false,
    });
    expect(decision.ok).toBe(false);
  });

  // D-098: the run starts when its inputs change, not only its safety paths.
  // BUG-10's own pull request added the journeys group and its tests, touched
  // no safety file, and so never ran that group on CI. A score is only as
  // good as the tests and the settings it was measured with; a change to
  // either is a change to the score.
  const runsOnly = (file) =>
    decideMutation({ changed: [file], onlyIfSafetyPathsChanged: true, configured: true });

  test.each([
    // A group's tests: the journeys group's.
    ['apps/server/src/journeys.system.test.ts'],
    // A group's own Vitest configuration: the journeys group's.
    ['vitest.system.config.mjs'],
    // What builds and judges the runs.
    ['stryker.config.mjs'],
    ['scripts/lib/gate-decisions.mjs'],
    ['scripts/mutation.mjs'],
    // The root configuration, under which every group without its own runs.
    ['vitest.config.mjs'],
    ['vitest.shared.mjs'],
    // The test kit, whose fakes the groups' tests import: the api-process
    // group's tests talk to fake-postgres.ts, and the others use its fakes
    // too. A changed fake can change a score, so all of packages/test-kit/
    // is an input, its index included.
    ['packages/test-kit/src/fake-postgres.ts'],
    ['packages/test-kit/src/index.ts'],
  ])('BUG-12: a change to only %s starts the mutation run, and says so by name', (file) => {
    const decision = runsOnly(file);

    expect(decision).toMatchObject({ ok: true, action: 'run' });
    expect(decision.message).toContain(file);
  });

  test("BUG-12: a change to only one of any group's tests starts the mutation run", () => {
    // Every group, not only the ones named above: a group added later is a
    // trigger with nothing else to remember. A folder of tests is changed by
    // changing a test in it.
    const changes = MUTATION_GROUPS.flatMap((group) => [
      ...group.tests.map((test) => {
        const at = path.join(root, test);
        if (!existsSync(at) || !statSync(at).isDirectory()) return test;
        const inside = readdirSync(at, { recursive: true }).find((file) =>
          String(file).endsWith('.test.ts'),
        );
        return path.posix.join(test, String(inside));
      }),
      ...(group.config === undefined ? [] : [group.config]),
    ]);

    expect(changes.length).toBeGreaterThan(0);
    for (const file of changes) {
      expect(runsOnly(file), file).toMatchObject({ ok: true, action: 'run' });
    }
  });

  test.each([
    // A test in no group: not a test any mutation run starts.
    ['apps/server/src/config.test.ts'],
    ['docs/plan/README.md'],
    // D-098 leaves dependency updates out: the lockfile would run mutation
    // on every Dependabot pull request, a cost the owner has not chosen.
    ['pnpm-lock.yaml'],
    // Another package beside the test kit: only the test kit is an input.
    ['packages/contracts/src/journeys.ts'],
  ])('BUG-12: a change to only %s still has nothing to mutate', (file) => {
    // The whole-suite run's tests are `apps` and `packages`, every product
    // test. They are a catch-all, not a group's tests, so they are not
    // triggers: if they were, every change to the product would start the
    // mutation run.
    expect(runsOnly(file)).toMatchObject({ ok: true, action: 'skip' });
  });
});

describe('judgeMutationRun', () => {
  // What a finished, failed or unfinished Stryker run means for the gate. The
  // result has the shape scripts/lib/proc.mjs `run` returns.
  test('Stryker finished and exited 0: the score met the threshold', () => {
    expect(judgeMutationRun({ ok: true, status: 0, output: '' }).ok).toBe(true);
  });

  test('Stryker exited non-zero: fails, and says how to tell a low score from a crash', () => {
    const verdict = judgeMutationRun({ ok: false, status: 1, output: 'the report' });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('exited with 1');
    expect(verdict.message).toContain('below 80 %');
  });

  test('Stryker did not finish: fails, and never calls that a low score', () => {
    // INF-07's first CI run was killed at the time limit, and the gate then
    // reported "the mutation score on safety code is below 80 %" for a score
    // nobody had measured. A loud failure with the wrong reason sends the next
    // person to strengthen tests that were never the problem.
    const verdict = judgeMutationRun({
      ok: false,
      status: null,
      output: 'spawnSync pnpm ETIMEDOUT',
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('did not finish');
    expect(verdict.message).toContain('spawnSync pnpm ETIMEDOUT');
    expect(verdict.message).toContain('no mutation score was measured');
    expect(verdict.message).not.toContain('below 80');
  });
});

/**
 * A Stryker JSON report (mutation-testing-report-schema), from counts:
 * `{ 'a.ts': { Killed: 3, Timeout: 1 } }` gives a.ts four mutants with those
 * statuses. The fields a mutant must have are filled in; the judge reads only
 * where it is and what became of it.
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

describe('BUG-12: judgeMutationReport, a run judged file by file from its report (D-098)', () => {
  // On #53 the required mutation check passed a run in which 84 of 84
  // mutants timed out and none was killed: Stryker counts a timeout as
  // detected, so it scored 100 % (job 110739523389). Its exit code says
  // nothing about that, so the gate reads the report. Only a killed mutant is
  // caught, and each file must reach 80 % (D-036) of
  // killed ÷ (killed + survived + timed out + no coverage) on its own.
  const PROCESS = 'apps/server/src/process.ts';
  const API_PROCESS = 'apps/server/src/api-process.ts';
  const JOURNEY = 'apps/server/src/domain/journey.ts';

  test('BUG-12: 84 mutants timed out and none killed, the #53 run, fails, and says a timeout is not caught', () => {
    const verdict = judgeMutationReport(reportOf({ [PROCESS]: { Timeout: 84 } }));

    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain(PROCESS);
    expect(verdict.message).toContain('0 killed');
    expect(verdict.message).toContain('84 timed out');
    expect(verdict.message).toMatch(/not[^.]*caught/i);
    expect(verdict.message).toContain('D-098');
  });

  test('BUG-12: one file below 80 % fails the run even when the pooled score passes, and only that file is named', () => {
    // api-process.ts sat at 62.5 % inside a run that passed. Pooled, these
    // two files score 45 of 48, 93.75 %.
    const verdict = judgeMutationReport(
      reportOf({ [JOURNEY]: { Killed: 40 }, [API_PROCESS]: { Killed: 5, Survived: 3 } }),
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain(API_PROCESS);
    expect(verdict.message).toMatch(/62\.5 ?%/);
    expect(verdict.message).toContain('5 killed');
    expect(verdict.message).toContain('3 survived');
    // The message lists what failed. A passing file in that list would send
    // the reader to tests that were never the problem.
    expect(verdict.message).not.toContain(JOURNEY);
  });

  test('BUG-12: a timed-out mutant counts against its file: 8 killed and 2 timed out is exactly 80 %, and passes', () => {
    expect(judgeMutationReport(reportOf({ [PROCESS]: { Killed: 8, Timeout: 2 } })).ok).toBe(true);
  });

  test('BUG-12: a timed-out mutant counts against its file: 7 killed and 3 timed out is 70 %, and fails', () => {
    const verdict = judgeMutationReport(reportOf({ [PROCESS]: { Killed: 7, Timeout: 3 } }));

    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain(PROCESS);
    expect(verdict.message).toMatch(/70 ?%/);
    expect(verdict.message).toContain('3 timed out');
  });

  test('BUG-12: a mutant no test ran counts against its file', () => {
    expect(judgeMutationReport(reportOf({ [PROCESS]: { Killed: 8, NoCoverage: 2 } })).ok).toBe(
      true,
    );

    const verdict = judgeMutationReport(reportOf({ [PROCESS]: { Killed: 7, NoCoverage: 3 } }));
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain(PROCESS);
    expect(verdict.message).toMatch(/70 ?%/);
  });

  test('BUG-12: compile errors and ignored mutants are left out of the score, neither caught nor missed', () => {
    // Review loop 1: this test also left RuntimeError out. It now counts
    // against its file, in the test after this one.
    //
    // Counted against, these would make 8 of 19: a failure.
    expect(
      judgeMutationReport(
        reportOf({ [PROCESS]: { Killed: 8, Survived: 2, CompileError: 5, Ignored: 4 } }),
      ).ok,
    ).toBe(true);

    // Counted as caught, these would make 27 of 30: a pass.
    const verdict = judgeMutationReport(
      reportOf({ [PROCESS]: { Killed: 7, Survived: 3, CompileError: 10, Ignored: 10 } }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/70 ?%/);
  });

  test('BUG-12: a runtime error counts against its file, and is named: the tests never ran', () => {
    // With the command runner, a RuntimeError means the command did not run
    // the tests: the shell could not start them, or a Stryker worker
    // crashed. Nothing was tested against that mutant, so it is not caught.
    // Left out, this would be 8 of 9, 88.88 %: a pass.
    const verdict = judgeMutationReport(
      reportOf({ [PROCESS]: { Killed: 8, Survived: 1, RuntimeError: 2 } }),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain(PROCESS);
    expect(verdict.message).toMatch(/72\.7\d? ?%/);
    expect(verdict.message).toMatch(/\b2 runtime errors?\b/i);

    // Named when its file passes too, so a crash is never silent.
    const passing = judgeMutationReport(reportOf({ [PROCESS]: { Killed: 9, RuntimeError: 1 } }));
    expect(passing.ok).toBe(true);
    expect(passing.message).toMatch(/\b1 runtime errors?\b/i);
  });

  test('BUG-12: for each file, the output names how many of its mutants were left out', () => {
    // Left out of the score is not the same as unseen: a file with many
    // compile errors or exclusions has a score that rests on few mutants.
    const lineOf = (message, file) => message.split('\n').find((line) => line.includes(file));

    const passing = judgeMutationReport(
      reportOf({
        [JOURNEY]: { Killed: 10, CompileError: 3 },
        [API_PROCESS]: { Killed: 8, Ignored: 2 },
      }),
    );
    expect(passing.ok).toBe(true);
    expect(lineOf(passing.message, JOURNEY)).toMatch(/\b3 (left out|compile errors?)\b/i);
    expect(lineOf(passing.message, API_PROCESS)).toMatch(/\b2 (left out|ignored)\b/i);

    const failing = judgeMutationReport(
      reportOf({ [PROCESS]: { Killed: 7, Survived: 3, CompileError: 4 } }),
    );
    expect(failing.ok).toBe(false);
    expect(lineOf(failing.message, PROCESS)).toMatch(/\b4 (left out|compile errors?)\b/i);
  });

  test('BUG-12: a file with no mutants at all, such as one of types alone, is left out beside one that was measured', () => {
    // Review loop 1: this test also left out a file whose every mutant was
    // left out. That file now fails, in the test after this one. A file with
    // no mutant at all has nothing to mutate, can never reach 80 %, and
    // failing it would block for good.
    const verdict = judgeMutationReport(
      reportOf({ [JOURNEY]: { Killed: 10 }, 'apps/server/src/domain/types.ts': {} }),
    );

    expect(verdict.ok).toBe(true);
  });

  test('BUG-12: a file whose every mutant was left out fails, and is named: nothing was measured in it', () => {
    // It had mutants, and none of them was tested: every one failed to
    // compile or was excluded. A score that leaves the file out would say
    // nothing about it, beside a file that passed.
    const verdict = judgeMutationReport(
      reportOf({ [JOURNEY]: { Killed: 10 }, [PROCESS]: { CompileError: 2, Ignored: 1 } }),
    );

    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain(PROCESS);
    expect(verdict.message).toMatch(/measured nothing|nothing (was )?measured/i);
    expect(verdict.message).not.toContain(JOURNEY);
  });

  // Built here, not in the table below: HK-05 reads a test.each table only
  // up to its first closing parenthesis.
  const NO_FILES = { files: {} };
  const NO_MUTANTS = reportOf({ [PROCESS]: {} });
  const ONLY_LEFT_OUT = reportOf({ [PROCESS]: { CompileError: 3, Ignored: 2 } });

  test.each([
    ['no files at all', NO_FILES],
    ['files with no mutants', NO_MUTANTS],
    ['only compile errors or ignored mutants', ONLY_LEFT_OUT],
  ])('BUG-12: a report with %s fails: it measured nothing', (_, report) => {
    const verdict = judgeMutationReport(report);

    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/measured nothing|nothing (was )?measured|no mutants/i);
  });

  test('BUG-12: every mutant killed, in every file, passes', () => {
    const verdict = judgeMutationReport(
      reportOf({ [JOURNEY]: { Killed: 39 }, [API_PROCESS]: { Killed: 8 } }),
    );

    expect(verdict.ok).toBe(true);
  });
});

describe('mutationRuns', () => {
  // The owner's decision of 2026-09-25, an amendment to D-066. PR #31's
  // mutation check was killed at its time limit because every mutant in every
  // safety file ran the whole suite. Now each group of safety files runs only
  // the tests that can kill its mutants, and whatever no group claims runs the
  // whole suite, as before.
  //
  // A test set that is too narrow can only lower the score: a mutant no test
  // ran survives. So grouping can make this gate stricter, never laxer. What it
  // must never do is mutate less than every safety path, widen what is
  // mutated, or mutate one path in two runs. The paths here are made up, so
  // these tests hold the rule rather than today's lists.
  const safety = ['src/domain/', 'src/alerts/', 'src/worker.ts', 'src/adapters/hc.ts'];
  const domain = { name: 'domain', paths: ['src/domain/'], tests: ['src/domain'] };
  const hc = {
    name: 'hc',
    paths: ['src/adapters/hc.ts'],
    tests: ['src/adapters/hc.test.ts', 'src/worker.test.ts'],
  };

  test('the groups run first, in order, then one whole-suite run takes every safety path left', () => {
    expect(mutationRuns(safety, [domain, hc])).toEqual([
      domain,
      hc,
      { name: 'whole-suite', paths: ['src/alerts/', 'src/worker.ts'], tests: ['apps', 'packages'] },
    ]);
  });

  test('with no groups, one whole-suite run mutates every safety path, as before the grouping', () => {
    expect(mutationRuns(safety, [])).toEqual([
      { name: 'whole-suite', paths: safety, tests: ['apps', 'packages'] },
    ]);
  });

  test('when the groups claim every safety path, there is no whole-suite run', () => {
    expect(mutationRuns(['src/domain/', 'src/adapters/hc.ts'], [domain, hc])).toEqual([domain, hc]);
  });

  test('a group that names a path outside the safety paths throws, naming the group and the path', () => {
    // A group must never widen what is mutated: the score has to mean "the
    // safety rules are protected", not be diluted by code protected some other way.
    const wider = { name: 'wider', paths: ['src/api.ts'], tests: ['src'] };

    expect(() => mutationRuns(safety, [domain, wider])).toThrow(/wider/);
    expect(() => mutationRuns(safety, [domain, wider])).toThrow(/src\/api\.ts/);
  });

  test('a file inside a safety folder is not a safety path of its own, so a group cannot claim it', () => {
    // Otherwise the folder would still go to the whole-suite run and the file
    // would be mutated twice, once against each set of tests.
    const oneFile = { name: 'one-file', paths: ['src/domain/journey.ts'], tests: ['src/domain'] };

    expect(() => mutationRuns(safety, [oneFile])).toThrow(/src\/domain\/journey\.ts/);
  });

  test('two groups that claim the same path throw, naming the path', () => {
    const again = { name: 'domain-again', paths: ['src/domain/'], tests: ['src'] };

    expect(() => mutationRuns(safety, [domain, again])).toThrow(/src\/domain\//);
  });
});

describe('the mutation runs of this repository', () => {
  test('domain code runs the domain tests; the Healthchecks.io adapter runs its own and the worker tests', () => {
    // The owner's grouping, pinned: measured on two cores, the domain tests
    // take 1.1 s and the adapter's tests plus the worker's 3.7 s, against 13.2 s
    // for the whole suite each mutant ran before.
    //
    // The journeys group came with BUG-10 (D-095). Its run also says which
    // Vitest configuration it uses, the system tests' one, and how it says
    // so is the implementer's to choose: stryker-config.test.mjs pins what
    // the run does with it.
    //
    // BUG-12 (RG-03): two groups were added to this pin, and nothing in it
    // was loosened. D-098 gives every safety file that exists a group, which
    // removes the whole-suite run whose 84 mutants all timed out on #53.
    // `process` takes the three files that run had: bin.test.ts is the only
    // test that runs the real worker process, so it goes with them (D-066's
    // amendment). `api-process` runs its own tests, which now kill every
    // mutant of it in-process.
    expect(MUTATION_GROUPS).toEqual([
      { name: 'domain', paths: ['apps/server/src/domain/'], tests: ['apps/server/src/domain'] },
      {
        name: 'healthchecks',
        paths: ['apps/server/src/adapters/healthchecks.ts'],
        tests: ['apps/server/src/adapters/healthchecks.test.ts', 'apps/server/src/worker.test.ts'],
      },
      expect.objectContaining({
        name: 'journeys',
        paths: ['apps/server/src/modules/journeys/'],
        tests: ['apps/server/src/journeys.system.test.ts'],
      }),
      // LOST-02 (RG-03): modules/alerts/ gets its first files, the watchdog
      // and the sender, and with them a group of its own (D-098), as the test
      // below asks the day a safety path holds a file. Its tests are one
      // file, kept apart from the journeys group's so each alerts mutant
      // stays cheap, under the system tests' configuration (the spec's
      // Mutation section). Nothing above or below changed.
      expect.objectContaining({
        name: 'alerts',
        paths: ['apps/server/src/modules/alerts/'],
        tests: ['apps/server/src/alerts.system.test.ts'],
      }),
      {
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
      },
      {
        name: 'api-process',
        paths: ['apps/server/src/api-process.ts'],
        tests: ['apps/server/src/api-process.test.ts'],
      },
    ]);
    expect(WHOLE_SUITE).toEqual(['apps', 'packages']);
  });

  test('every safety path is mutated in exactly one run', () => {
    const mutated = mutationRuns().flatMap((run) => run.paths);

    expect(SAFETY_PATHS.length).toBeGreaterThan(0);
    expect(mutated.toSorted()).toEqual([...SAFETY_PATHS].toSorted());
  });

  test('every test path a group runs exists, and a folder of them holds tests', () => {
    // A rename must not leave a group running no tests. Vitest given a path that
    // matches nothing finds no test files, and a group whose tests all vanished
    // would score 0 %, loudly but for a reason nobody would guess from the log.
    const tests = MUTATION_GROUPS.flatMap((group) => group.tests);
    const missing = tests.filter((test) => !existsSync(path.join(root, test)));
    const empty = tests
      .filter((test) => !missing.includes(test))
      .filter((test) => statSync(path.join(root, test)).isDirectory())
      .filter(
        (test) =>
          !readdirSync(path.join(root, test), { recursive: true }).some((file) =>
            String(file).endsWith('.test.ts'),
          ),
      );

    expect(tests.length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
    expect(empty).toEqual([]);
  });

  // bin.test.ts is the only test that runs the real worker process, so these
  // three keep it, whichever run they are in. Narrowing their tests needed a
  // decision of its own, and D-098 is that decision.
  //
  // BUG-12 (RG-03): this test said "%s stays in the whole-suite run". On #53
  // that run's 84 mutants all timed out and none was killed, and it passed.
  // D-098 moves these three files to a group of their own, so the pin moved
  // with it: one run each still, now against the three tests that can kill
  // their mutants, bin.test.ts first among them.
  test.each([
    ['apps/server/src/worker.ts'],
    ['apps/server/src/bin/worker.ts'],
    ['apps/server/src/process.ts'],
  ])(
    'BUG-12: %s is mutated in the process run, against bin.test.ts and the worker and process tests',
    (file) => {
      const runs = mutationRuns().filter((run) => run.paths.includes(file));

      expect(runs).toEqual([
        expect.objectContaining({
          name: 'process',
          tests: [
            'apps/server/src/bin/bin.test.ts',
            'apps/server/src/worker.test.ts',
            'apps/server/src/process.test.ts',
          ],
        }),
      ]);
    },
  );

  test('BUG-12: api-process.ts is mutated in a run of its own, against its own tests', () => {
    // At 62.5 % it sat inside a pooled run that passed. Its own run, judged
    // file by file, can no longer hide it (D-098).
    const runs = mutationRuns().filter((run) =>
      run.paths.includes('apps/server/src/api-process.ts'),
    );

    expect(runs).toEqual([
      {
        name: 'api-process',
        paths: ['apps/server/src/api-process.ts'],
        tests: ['apps/server/src/api-process.test.ts'],
      },
    ]);
  });

  test('BUG-12: no safety file that exists today falls to the whole-suite run; each has a group (D-098)', () => {
    // The whole-suite run is what timed out on #53. It stays only for safety
    // paths that hold no file yet, such as modules/alerts/ and safety-core/.
    // The day one of them gets its first file, this fails and asks for a group
    // with the tests that can kill its mutants.
    const claimed = MUTATION_GROUPS.flatMap((group) => group.paths);
    const unclaimed = SAFETY_PATHS.filter((p) => !claimed.includes(p));
    const sourceFiles = (p) => {
      const at = path.join(root, p);
      if (!existsSync(at)) return [];
      if (!statSync(at).isDirectory()) return [p];
      return readdirSync(at, { recursive: true })
        .map((file) => path.posix.join(p, String(file).split(path.sep).join('/')))
        .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.test.ts'))
        .filter((file) => statSync(path.join(root, file)).isFile());
    };

    expect(
      unclaimed.flatMap(sourceFiles),
      'these safety files have no mutation group; give each one, with the tests that can kill its mutants (D-098)',
    ).toEqual([]);
  });

  // Review loop 1, safety-reviewer: it renamed bin/worker.ts. Stryker only
  // warned that a glob matched nothing, the judge listed the two files that
  // were left, and the gate passed. A check of a group as a whole, "it has
  // something to mutate", let the one missing file through, so these check
  // path by path. modules/alerts/ and safety-core/ are claimed by no group
  // and may be absent: the whole-suite run takes them, and has nothing to
  // mutate until they hold a file.
  const at = (p) => path.join(root, p);
  const holdsSource = (folder) =>
    readdirSync(at(folder), { recursive: true, withFileTypes: true }).some(
      (entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'),
    );

  test('BUG-12: every safety path that names a file exists, as a file', () => {
    const missing = SAFETY_PATHS.filter((p) => !p.endsWith('/')).filter(
      (p) => !existsSync(at(p)) || !statSync(at(p)).isFile(),
    );

    expect(
      missing,
      'these safety paths name no file: a rename must move the safety path with it',
    ).toEqual([]);
  });

  test('BUG-12: every safety path that is a folder ends in /', () => {
    // Without it, the config would mutate the folder as one file, and the
    // check above would read it as a file that is missing.
    const unmarked = SAFETY_PATHS.filter((p) => !p.endsWith('/')).filter(
      (p) => existsSync(at(p)) && statSync(at(p)).isDirectory(),
    );

    expect(unmarked, 'these safety paths are folders, and need a trailing /').toEqual([]);
  });

  test('BUG-12: every path a group claims exists, path by path: a file, or a folder holding a non-test .ts file', () => {
    const missing = MUTATION_GROUPS.flatMap((group) =>
      group.paths
        .filter((p) =>
          p.endsWith('/')
            ? !existsSync(at(p)) || !statSync(at(p)).isDirectory() || !holdsSource(p)
            : !existsSync(at(p)) || !statSync(at(p)).isFile(),
        )
        .map((p) => `${group.name}: ${p}`),
    );

    expect(
      missing,
      'these group paths hold nothing to mutate, so their group would pass without them',
    ).toEqual([]);
  });
});

describe('BUG-10: the journey files, split by test level (D-095)', () => {
  // SM-01 put journey guarantees in files no safety list named. D-095 makes
  // all six need the owner's approval and the safety review; gate.test.mjs
  // pins that. Here is the other half: mutation on every pull request, and
  // the 95 % branch floor, only where the tests run in-process. The database
  // files are proved by their L3 tests alone, which Stryker's runs do not
  // start, so every mutant in them would survive and turn mutation red.
  const safety = (file) =>
    decideMutation({ changed: [file], onlyIfSafetyPathsChanged: true, configured: false });

  // What these two cases hold is that each is a safety path, so a pull request
  // that changes it must be mutation-tested: with no mutation run possible,
  // the gate refuses. They do not show that every mutant can be killed
  // in-process, and for api-process.ts that is not so: 3 of its 8 mutants
  // wire its services empty and are killed only at L3, 62.5 % on its own,
  // measured locally. BUG-12 closes them.
  test.each([['apps/server/src/modules/journeys/service.ts'], ['apps/server/src/api-process.ts']])(
    'BUG-10: %s is a safety path, so every pull request that changes it is mutation-tested',
    (file) => {
      expect(safety(file).ok).toBe(false);
    },
  );

  test.each([
    ['apps/server/src/adapters/journeys.ts'],
    ['apps/server/src/adapters/device-credentials.ts'],
    ['apps/server/src/db/schema.ts'],
    ['apps/server/src/db/migrations/0001_lying_ares.sql'],
  ])(
    'BUG-10: %s is not safety code for mutation: only its L3 tests can kill its mutants',
    (file) => {
      // The same question as the cases above, so this passing is not the
      // harness passing everything: a safety path that covered this file,
      // such as adapters/ or db/ whole, would turn it red.
      expect(safety(file)).toMatchObject({ ok: true, action: 'skip' });
    },
  );

  // D-097: api.ts, the database clock, and the two files that say where the
  // migrations are read from and written to need the owner and the safety
  // review, which gate.test.mjs pins. No mutation run for them is decided, so
  // none of them is a safety path: one that covered any of them, such as
  // adapters/ or apps/server/ whole, would start a run no decision asked for.
  test.each([
    ['apps/server/src/api.ts'],
    ['apps/server/src/adapters/clock.ts'],
    ['apps/server/src/adapters/migrations.ts'],
    ['apps/server/drizzle.config.ts'],
  ])(
    'BUG-10: %s is not safety code for mutation: D-097 makes it need the owner, and decides no mutation run for it',
    (file) => {
      expect(safety(file)).toMatchObject({ ok: true, action: 'skip' });
    },
  );

  test('BUG-10: modules/journeys/ is mutated in one run, its own, against the journey system tests', () => {
    // Those are the tests that drive the module through the API in-process.
    // Which Vitest configuration the run uses is pinned in
    // stryker-config.test.mjs, where the command is built.
    const runs = mutationRuns().filter((run) =>
      run.paths.includes('apps/server/src/modules/journeys/'),
    );

    expect(runs).toEqual([
      expect.objectContaining({
        name: 'journeys',
        paths: ['apps/server/src/modules/journeys/'],
        tests: ['apps/server/src/journeys.system.test.ts'],
      }),
    ]);
  });
});
