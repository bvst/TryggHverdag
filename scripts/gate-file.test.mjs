// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-04 runs after every single edit, so what it decides to check — and what it
// leaves alone — shapes how the whole project feels to work in.
import { afterEach, describe, expect, test } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { filesToCheck, runSteps, stepsFor } from './gate-file.mjs';

const names = (files) => stepsFor(files).map((step) => step.name);

describe('filesToCheck', () => {
  test('keeps our own code', () => {
    expect(filesToCheck(['apps/server/src/api.ts', 'packages/contracts/src/index.ts'])).toEqual([
      'apps/server/src/api.ts',
      'packages/contracts/src/index.ts',
    ]);
  });

  test('drops the separator pnpm passes through', () => {
    expect(filesToCheck(['--', 'apps/server/src/api.ts'])).toEqual(['apps/server/src/api.ts']);
  });

  test.each([
    'docs/progress.md',
    'docs/plan/decisions.md',
    'spikes/background/index.ts',
    'README.md',
    'coverage/coverage-summary.json',
  ])('leaves %s alone', (file) => {
    expect(filesToCheck([file])).toEqual([]);
  });
});

describe('stepsFor', () => {
  test('code gets formatting, lint, types, import rules and its tests', () => {
    expect(names(['apps/server/src/api.ts'])).toEqual([
      'formatting',
      'lint',
      'types',
      'import rules (AR-10)',
      'tests that cover this file',
    ]);
  });

  test('a configuration file is only formatted — there is nothing else to say about it', () => {
    expect(names(['turbo.json'])).toEqual(['formatting']);
  });

  test('editing a test runs that test, rather than looking for tests of a test', () => {
    const steps = names(['apps/server/src/journey.test.ts']);
    expect(steps).toContain('the edited tests');
    expect(steps).not.toContain('tests that cover this file');
  });

  test('the file being checked is passed to the tools, not the whole repository', () => {
    const [formatting] = stepsFor(['apps/server/src/api.ts']);
    expect(formatting?.command).toContain('apps/server/src/api.ts');
  });
});

// INF-06-AC7: the app's tests run on jest-expo, the server's on Vitest, and a
// file is sent to the runner that can run its tests. Vitest's `related` run
// against React Native code would fail on every edit for a reason that has
// nothing to do with the edit, and a gate that is always red is soon ignored.
describe('stepsFor, for the app', () => {
  const runs = (files, runner) =>
    stepsFor(files).filter((step) => step.command.some((arg) => arg === runner));
  // The file may be handed over relative to the repository, relative to the
  // app (jest runs there), or absolute: any of the three names it, and only at
  // a path boundary.
  const namesFile = (arg, file) => {
    const given = arg.replace(/^\.\//, '');
    return given === file || file.endsWith(`/${given}`) || given.endsWith(`/${file}`);
  };
  const passes = (step, file) =>
    step !== undefined && step.command.some((arg) => namesFile(arg, file));

  test.each([
    'apps/mobile/src/app/index.tsx',
    'apps/mobile/src/shared/translations/language.ts',
    'apps/mobile/app.config.ts',
  ])('INF-06-AC7: an edited app file %s runs the jest-expo tests related to it', (file) => {
    const jest = runs([file], 'jest');

    expect(jest).toHaveLength(1);
    expect(jest[0]?.command).toContain('--findRelatedTests');
    expect(passes(jest[0], file)).toBe(true);
    expect(runs([file], 'vitest')).toEqual([]);
  });

  test('INF-06-AC7: an edited app test runs on jest-expo too, never on Vitest', () => {
    const file = 'apps/mobile/src/shared/translations/language.test.ts';
    const jest = runs([file], 'jest');

    expect(jest).toHaveLength(1);
    expect(passes(jest[0], file)).toBe(true);
    expect(runs([file], 'vitest')).toEqual([]);
  });

  test('INF-06-AC7: an edited server file still gets Vitest’s related tests, and jest is not asked', () => {
    const vitest = runs(['apps/server/src/api.ts'], 'vitest');

    expect(vitest).toHaveLength(1);
    expect(vitest[0]?.command).toEqual(
      expect.arrayContaining(['related', '--run', 'apps/server/src/api.ts']),
    );
    expect(runs(['apps/server/src/api.ts'], 'jest')).toEqual([]);
  });

  test('INF-06-AC7: an edit to both sends each file to its own runner and to no other', () => {
    const app = 'apps/mobile/src/app/index.tsx';
    const server = 'apps/server/src/api.ts';
    const jestSteps = runs([app, server], 'jest');
    const vitestSteps = runs([app, server], 'vitest');
    const [jest] = jestSteps;
    const [vitest] = vitestSteps;

    expect(jestSteps).toHaveLength(1);
    expect(vitestSteps).toHaveLength(1);
    expect(passes(jest, app)).toBe(true);
    expect(passes(jest, server)).toBe(false);
    expect(vitest?.command).toContain(server);
    expect(vitest?.command).not.toContain(app);
  });

  test('INF-06-AC7: app files still get formatting, lint, types and the import rules', () => {
    expect(names(['apps/mobile/src/app/index.tsx'])).toEqual(
      expect.arrayContaining(['formatting', 'lint', 'types', 'import rules (AR-10)']),
    );
  });
});

// HK-04 (D-119): the per-edit gate ran its steps one after another — 18.6 s
// after one edit to a domain file, measured, most of it one step waiting for
// the one before. runSteps starts every step at once and waits for all of
// them. Each step here is a small node script in place of a real tool, so the
// tests pin what runSteps does with processes, not what prettier or eslint
// print. None of them reads a clock in the test: the timing that matters is
// decided inside the steps, by which files exist.
describe('runSteps', () => {
  const dirs = [];
  function tempDir() {
    const dir = mkdtempSync(path.join(tmpdir(), 'gate-file-test-'));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop(), { recursive: true, force: true });
    }
  });

  /** A step whose command is a node script, in the shape stepsFor returns. */
  const nodeStep = (name, script) => ({ name, command: [process.execPath, '-e', script] });

  /**
   * Step `index` of `count`: it says it has started, then waits up to 5 s for
   * every other step to have said so too. It passes only if they all did.
   */
  const rendezvous = (dir, index, count) =>
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      `const dir = ${JSON.stringify(dir)};`,
      `fs.writeFileSync(path.join(dir, '${String(index)}.started'), '');`,
      `const all = () => [...Array(${String(count)}).keys()].every((i) => fs.existsSync(path.join(dir, i + '.started')));`,
      'const giveUp = Date.now() + 5000;',
      'const wait = () => {',
      '  if (all()) process.exit(0);',
      `  if (Date.now() > giveUp) { console.log('step ${String(index)} gave up: not every step had started'); process.exit(1); }`,
      '  setTimeout(wait, 20);',
      '};',
      'wait();',
    ].join('\n');

  test('HK-04: the steps run at the same time, not one after another', async () => {
    // A rendezvous, so the test needs no stopwatch. Run one after another,
    // the first step waits alone for the other two, gives up and fails; run
    // together, all three meet and pass.
    const dir = tempDir();
    const steps = [0, 1, 2].map((index) =>
      nodeStep(`step ${String(index)}`, rendezvous(dir, index, 3)),
    );

    const results = await runSteps(steps, { cwd: dir, timeout: 30_000 });

    expect(results).toMatchObject([
      { name: 'step 0', ok: true },
      { name: 'step 1', ok: true },
      { name: 'step 2', ok: true },
    ]);
  });

  test('HK-04: results come back in the order of the steps, whichever finishes first', async () => {
    // The report lists failures in the order of stepsFor, as it did when the
    // steps ran one by one; the order they happen to finish in must not
    // reshuffle it from one edit to the next.
    const dir = tempDir();

    const results = await runSteps(
      [
        nodeStep('slow', "setTimeout(() => console.log('slow finished'), 300);"),
        nodeStep('fast', "console.log('fast finished');"),
      ],
      { cwd: dir, timeout: 30_000 },
    );

    expect(results).toMatchObject([
      { name: 'slow', ok: true, output: expect.stringContaining('slow finished') },
      { name: 'fast', ok: true, output: expect.stringContaining('fast finished') },
    ]);
  });

  test('HK-04: a failing step is reported with its output, and the other steps still run to the end', async () => {
    // Every failing check is reported after an edit, not only the first one:
    // a gate that stopped the others at the first failure would hide the
    // second problem until the first was fixed. The output is stdout and
    // stderr both, because tools disagree about which one they complain on.
    const dir = tempDir();
    const finished = path.join(dir, 'tests.finished');

    const results = await runSteps(
      [
        nodeStep(
          'lint',
          "console.log('lint said no'); console.error('api.ts:3 no-unused-vars'); process.exit(1);",
        ),
        nodeStep(
          'tests',
          `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(finished)}, 'done'), 500);`,
        ),
      ],
      { cwd: dir, timeout: 30_000 },
    );

    expect(existsSync(finished)).toBe(true);
    expect(results).toMatchObject([
      { name: 'lint', ok: false, output: expect.stringContaining('lint said no') },
      { name: 'tests', ok: true },
    ]);
    expect(results[0]?.output).toContain('no-unused-vars');
  });

  test('HK-04: a command that cannot start is a failure, not a pass', async () => {
    // A tool that is missing checked nothing. Reported as a pass, every edit
    // would look clean while no check ran at all.
    const dir = tempDir();
    const missing = 'trygghverdag-no-such-program';

    const results = await runSteps(
      [
        { name: 'missing tool', command: [missing, '--check'] },
        nodeStep('fine', "console.log('fine');"),
      ],
      { cwd: dir, timeout: 30_000 },
    );

    expect(results).toMatchObject([
      { name: 'missing tool', ok: false, output: expect.stringContaining(missing) },
      { name: 'fine', ok: true },
    ]);
  });

  test('HK-04: a step that ends without an exit code — killed by a signal — is a failure', async () => {
    // `ok` is true for exit code 0 and nothing else. A process killed by a
    // signal has no exit code at all, and a check like `!code` would read
    // that as a pass.
    const dir = tempDir();

    const results = await runSteps([nodeStep('killed', "process.kill(process.pid, 'SIGKILL');")], {
      cwd: dir,
      timeout: 30_000,
    });

    expect(results).toMatchObject([{ name: 'killed', ok: false }]);
  });

  test('HK-04: a step still running when the timeout ends is a failure', async () => {
    // A hung tool must not hold the edit up for ever, and must not pass
    // either. The step would exit 0 after 20 s; the timeout is 1 s.
    const dir = tempDir();

    const results = await runSteps(
      [nodeStep('hung', 'setTimeout(() => process.exit(0), 20_000);')],
      { cwd: dir, timeout: 1_000 },
    );

    expect(results).toMatchObject([{ name: 'hung', ok: false }]);
  });
});
