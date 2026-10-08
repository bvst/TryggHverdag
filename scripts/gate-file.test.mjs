// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-04 runs after every single edit, so what it decides to check — and what it
// leaves alone — shapes how the whole project feels to work in.
import { afterEach, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { filesToCheck, report, runSteps, stepsFor } from './gate-file.mjs';

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

// HK-04 (D-119), review loop 1: every real step is `pnpm exec <tool>`, so the
// tool that hangs is the step's grandchild. Killing only the direct child at
// the timeout leaves the tool running, holding the step's output pipes, and
// runSteps waits until it lets go: a reviewer measured 8 s against a 1 s
// timeout. A timed-out step has to be stopped together with what it started.
describe('runSteps, when a step times out', () => {
  const dirs = [];
  const pidFiles = [];

  /** The pid a grandchild wrote to `file`, or undefined if it never did. */
  const pidIn = (file) => {
    try {
      const pid = Number(readFileSync(file, 'utf8').trim());
      return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    } catch {
      return undefined;
    }
  };

  /**
   * Whether `pid` is still running. A process that has ended but has not yet
   * been collected by its parent (a zombie) still answers signal 0. An orphaned
   * grandchild is collected by whichever process adopts it, which in a cloud
   * container took over a second (measured). A zombie runs nothing, so it counts
   * as stopped. If `ps` cannot be asked, the process counts as running, so a
   * test that cannot tell fails rather than passes.
   */
  const isRunning = (pid) => {
    try {
      process.kill(pid, 0);
    } catch (error) {
      return /** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH';
    }
    const ps = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
    if (ps.error) {
      return true;
    }
    const state = ps.stdout.trim();
    return state !== '' && !state.startsWith('Z');
  };

  /** True once `pid` has stopped, polling for up to about 3 s. */
  const stopsSoon = async (pid) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (!isRunning(pid)) {
        return true;
      }
      await delay(50);
    }
    return !isRunning(pid);
  };

  const stopIfRunning = (file) => {
    const pid = pidIn(file);
    if (pid !== undefined && isRunning(pid)) {
      process.kill(pid, 'SIGKILL');
    }
  };

  // For a test that timed out: its own `finally` runs only once runSteps
  // returns, which today is when the grandchild ends by itself, 20 s in.
  afterEach(() => {
    while (pidFiles.length > 0) {
      stopIfRunning(pidFiles.pop());
    }
    while (dirs.length > 0) {
      rmSync(dirs.pop(), { recursive: true, force: true });
    }
  });

  /** Single-quoted for sh. */
  const quoted = (text) => `'${text.replaceAll("'", `'\\''`)}'`;

  test('HK-04: a step still running at the timeout is stopped together with the tool it started', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gate-file-test-'));
    dirs.push(dir);
    const pidFile = path.join(dir, 'grandchild.pid');
    pidFiles.push(pidFile);
    // The step is a shell, the tool its child: it writes its own pid, then
    // would run for 20 s. The shell waits for it, as pnpm waits for a tool.
    const tool = [
      "require('node:fs').writeFileSync(process.argv[1], String(process.pid));",
      'setTimeout(() => {}, 20_000);',
    ].join(' ');
    const step = {
      name: 'hung tool',
      command: [
        'sh',
        '-c',
        `${quoted(process.execPath)} -e ${quoted(tool)} ${quoted(pidFile)} & wait`,
      ],
    };

    try {
      const results = await runSteps([step], { cwd: dir, timeout: 1_000 });

      expect(results).toMatchObject([{ name: 'hung tool', ok: false }]);
      const pid = pidIn(pidFile);
      expect(pid, 'the tool never wrote its pid, so nothing was checked').toBeDefined();
      expect(await stopsSoon(/** @type {number} */ (pid))).toBe(true);
    } finally {
      stopIfRunning(pidFile);
    }
  }, 15_000);
});

// HK-04 (D-119), review loop 1: what main() prints after the steps have run
// was not tested at all — a main() that dropped every failure would still pass
// every test here. `report` decides it, so it is tested without running a tool:
// the failures only, in the order of the steps, each with its output trimmed,
// then the count and the files.
describe('report', () => {
  const files = ['apps/server/src/api.ts', 'apps/server/src/journey.ts'];

  test('HK-04: when every step passes, nothing is printed and the exit code is 0', () => {
    expect(
      report(
        [
          { name: 'formatting', ok: true, output: 'All matched files use Prettier code style!\n' },
          { name: 'lint', ok: true, output: '' },
          { name: 'types', ok: true, output: 'Tasks: 6 successful, 6 total\n' },
        ],
        files,
      ),
    ).toEqual({ text: '', exitCode: 0 });
  });

  test('HK-04: one failing step among passing ones is the only one reported, with its output trimmed, and the count is 1', () => {
    const results = [
      { name: 'formatting', ok: true, output: 'All matched files use Prettier code style!\n' },
      {
        name: 'lint',
        ok: false,
        output: '\n  apps/server/src/api.ts\n    3:7  error  no-unused-vars\n\n',
      },
      { name: 'types', ok: true, output: 'Tasks: 6 successful, 6 total\n' },
    ];

    expect(report(results, ['apps/server/src/api.ts'])).toEqual({
      text:
        '\n--- lint ---\napps/server/src/api.ts\n    3:7  error  no-unused-vars\n' +
        '\n1 check(s) failed for: apps/server/src/api.ts\n' +
        'Fix them before moving on — CI runs exactly the same checks.\n',
      exitCode: 1,
    });
  });

  test('HK-04: two failing steps are both reported, in the order of the steps, and the count is 2', () => {
    // `types` comes before `import rules (AR-10)` in the steps, but after it
    // alphabetically: the report keeps the steps' order.
    const results = [
      { name: 'formatting', ok: true, output: '' },
      { name: 'types', ok: false, output: "src/api.ts(3,7): error TS2322: Type 'string'.\n" },
      { name: 'import rules (AR-10)', ok: false, output: '  error no-domain-io: api.ts\n' },
      { name: 'tests that cover this file', ok: true, output: '1 passed\n' },
    ];

    expect(report(results, files)).toEqual({
      text:
        "\n--- types ---\nsrc/api.ts(3,7): error TS2322: Type 'string'.\n" +
        '\n--- import rules (AR-10) ---\nerror no-domain-io: api.ts\n' +
        '\n2 check(s) failed for: apps/server/src/api.ts, apps/server/src/journey.ts\n' +
        'Fix them before moving on — CI runs exactly the same checks.\n',
      exitCode: 1,
    });
  });
});
