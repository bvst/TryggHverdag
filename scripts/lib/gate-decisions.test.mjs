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
  // three keep the whole suite. Narrowing their tests needs a decision of its own.
  test.each([
    ['apps/server/src/worker.ts'],
    ['apps/server/src/bin/worker.ts'],
    ['apps/server/src/process.ts'],
  ])('%s stays in the whole-suite run', (file) => {
    const runs = mutationRuns().filter((run) => run.paths.includes(file));

    expect(runs).toEqual([
      expect.objectContaining({ name: 'whole-suite', tests: ['apps', 'packages'] }),
    ]);
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

  test.each([['apps/server/src/modules/journeys/service.ts'], ['apps/server/src/api-process.ts']])(
    'BUG-10: %s counts as safety code: its tests run in-process, so its mutants can be killed',
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
