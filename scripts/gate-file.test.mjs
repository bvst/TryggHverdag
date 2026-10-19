// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-04 runs after every single edit, so what it decides to check — and what it
// leaves alone — shapes how the whole project feels to work in.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { stripVTControlCharacters } from 'node:util';
import unitConfig from '../vitest.config.mjs';
import integrationConfig from '../vitest.integration.config.mjs';
import systemConfig from '../vitest.system.config.mjs';
import { availableFor, filesToCheck, main, report, runSteps, stepsFor } from './gate-file.mjs';
import { matchesAnyGlob } from './lib/glob.mjs';

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

// HK-04 (D-119), test-auditor's should-fix on #68: main() — filesToCheck, then
// stepsFor, runSteps and report, then stdout and process.exitCode — was held by
// no test. Each piece is tested above, but a main() that never wrote report's
// text, left the exit code at 0, or was never reached would make every edit
// look clean, and every test above would still pass. So these run the real
// script the way `pnpm run gate:file` does (`node scripts/gate-file.mjs <path>`
// from the repository root) on JSON files, whose only step is formatting (see
// stepsFor), so a run takes about a second. The files are written to a
// temporary directory outside the repository: Prettier finds no configuration
// there and checks them with its defaults, and the well-formatted file below is
// written to those (two-space JSON with a trailing newline). It passes the
// repository's own .prettierrc.json too (checked with prettier when written).
//
// These pass today. They are guards, not tests of new behaviour. Each break
// named above was planted in a scratch copy of the script, and each failed at
// least one of them: report's text not written, the exit code left at 0, and
// main() never called (or behind a check that is never true). One break no
// run can see: main() called without `await`. The process stays alive while
// its steps run, so it prints and exits the same; the two differ only if
// main() waits on a promise that never settles, which today's main() cannot.
describe('main(), run as the gate is run', () => {
  const ROOT = path.resolve(import.meta.dirname, '..');
  const dirs = [];
  function tempDir() {
    const dir = mkdtempSync(path.join(tmpdir(), 'gate-file-main-'));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop(), { recursive: true, force: true });
    }
  });

  /** Runs the per-edit gate on `file`, as a process of its own, from the repository root. */
  const gate = (file, { env = process.env, timeout = 30_000 } = {}) =>
    spawnSync(process.execPath, ['scripts/gate-file.mjs', file], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout,
    });

  /** Everything a failed expectation needs to say what the gate actually did. */
  const told = (run) =>
    [
      `exit code ${String(run.status)}, signal ${String(run.signal)}`,
      run.error ? `error: ${run.error.message}` : '',
      `stdout:\n${run.stdout ?? ''}`,
      `stderr:\n${run.stderr ?? ''}`,
    ].join('\n');

  test('HK-04: a badly formatted file fails the gate: exit code 1, the formatting block and the count are printed', () => {
    const file = path.join(tempDir(), 'unformatted.json');
    writeFileSync(file, '{"name":"synthetic",   "items":[1,2]}');

    const run = gate(file);

    expect(run.status, told(run)).toBe(1);
    const lines = run.stdout.split('\n');
    expect(lines, told(run)).toContain('--- formatting ---');
    expect(lines, told(run)).toContain(`1 check(s) failed for: ${file}`);
  });

  test('HK-04: a well-formatted file passes the gate: exit code 0 and nothing printed', () => {
    const file = path.join(tempDir(), 'formatted.json');
    writeFileSync(file, '{\n  "name": "synthetic",\n  "items": [1, 2]\n}\n');

    const run = gate(file);

    expect(run.status, told(run)).toBe(0);
    expect(run.stdout).toBe('');
  });

  test('HK-04: a file the gate does not check (.md) runs no step: exit code 0 and nothing printed', () => {
    // Such a run is quick because no step runs, and that cause is what this
    // checks, rather than timing the run: a fake pnpm, first on PATH, writes
    // down every call and fails. Every step is `pnpm …`, so a step started for
    // the .md would leave a record and fail the gate. A real `prettier --check`
    // would pass a tidy .md, so without the fake a gate that checked it anyway
    // would look the same from outside, only slower.
    const dir = tempDir();
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    const calls = path.join(bin, 'calls');
    writeFileSync(
      path.join(bin, 'pnpm'),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$(dirname "$0")/calls"\nexit 1\n',
      { mode: 0o755 },
    );
    const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` };
    const notes = path.join(dir, 'notes.md');
    writeFileSync(notes, '# Synthetic notes\n');

    const run = gate(notes, { env, timeout: 10_000 });

    expect(run.status, told(run)).toBe(0);
    expect(run.stdout).toBe('');
    expect(existsSync(calls), 'a step ran for a file the gate does not check').toBe(false);

    // The control: a file the gate does check reaches the fake pnpm, so its
    // silence above means no step ran, not that the fake was never on the path.
    const checked = path.join(dir, 'checked.json');
    writeFileSync(checked, '{}\n');
    const control = gate(checked, { env, timeout: 10_000 });
    expect(existsSync(calls), `the fake pnpm was never reached:\n${told(control)}`).toBe(true);
    expect(readFileSync(calls, 'utf8')).toContain('prettier');
  });
});

// BUG-52: an edited L6 or L3 test file was sent to `vitest run` with the unit
// config, whose `exclude` names both kinds, so Vitest found no test files and
// exited 1 ("No test files found, exiting with code 1": measured 2026-10-18 on
// the unchanged escalation.system.test.ts and alerts.integration.test.ts, and
// again 2026-10-19 on api.system.test.ts). The per-edit gate failed every edit
// to such a file while running none of its tests. An edited test file has to go
// to the config whose `include` names it and whose `exclude` does not: L6 to
// vitest.system.config.mjs, L3 to vitest.integration.config.mjs, every other
// test to the default config as before. L3 needs Docker; where Docker does not
// work, its step is reported as not possible here, with the reason, the way
// gate:full reports a step marked `needsTool: 'docker'` (scripts/lib/steps.mjs).
// It is not a failure, and it is not a pass either.
//
// Mixed edits. Today, once a source file is among the edited files, only
// `vitest related` runs, and `related` reads the unit config, so an L6 or L3
// test edited beside a source file is never run either. Decided here
// (test-author, D-031): every edited test file runs itself, whatever else was
// edited, and that includes unit tests. `related` reaches only the tests that
// import an edited source file, so an edited unit test that does not (a test of
// another module, or one whose import was just removed) would go unchecked.
describe('stepsFor, for each level of test (BUG-52)', () => {
  const SOURCE = 'apps/server/src/api.ts';
  const UNIT_TS = 'apps/server/src/config.test.ts';
  const UNIT_MJS = 'scripts/gate-file.test.mjs';
  const SYSTEM = 'apps/server/src/escalation.system.test.ts';
  const INTEGRATION = 'apps/server/src/alerts.integration.test.ts';

  /** The configs a step can name, as Vitest reads them. */
  const CONFIGS = new Map([
    ['vitest.config.mjs', unitConfig],
    ['vitest.system.config.mjs', systemConfig],
    ['vitest.integration.config.mjs', integrationConfig],
  ]);

  /** The config a Vitest step names (`--config`, `--config=` or `-c`); undefined for the default. */
  const configOf = (step) => {
    const { command } = step;
    const at = command.findIndex((arg) => arg === '--config' || arg === '-c');
    const given =
      at === -1
        ? command.find((arg) => arg.startsWith('--config='))?.slice('--config='.length)
        : command[at + 1];
    return given?.replace(/^\.\//, '');
  };

  /**
   * Whether the config this step runs Vitest with would find `file`: its
   * `include` names the file and its `exclude` does not. The bug is a step
   * whose config could not.
   */
  const configFinds = (step, file) => {
    const settings = CONFIGS.get(configOf(step) ?? 'vitest.config.mjs')?.test;
    if (settings === undefined) {
      return false;
    }
    const { include = [], exclude = [] } = settings;
    return matchesAnyGlob(file, include) && !matchesAnyGlob(file, exclude);
  };

  const vitestSteps = (files) => stepsFor(files).filter((step) => step.command.includes('vitest'));
  /** The Vitest steps that hand `file` to Vitest. */
  const stepsNaming = (files, file) =>
    vitestSteps(files).filter((step) => step.command.includes(file));
  /** What the step asks Vitest for: `run`, `related`, … */
  const subcommandOf = (step) => step.command[step.command.indexOf('vitest') + 1];
  const DEFAULT_CONFIG = [undefined, 'vitest.config.mjs'];

  test('BUG-52: an edited L6 test runs with vitest.system.config.mjs and names that file, not with the unit config that excludes it', () => {
    const steps = stepsNaming([SYSTEM], SYSTEM);

    expect(steps).toHaveLength(1);
    expect(configOf(steps[0])).toBe('vitest.system.config.mjs');
    expect(subcommandOf(steps[0])).toBe('run');
    // L6 has no database and no network (vitest.system.config.mjs), so it runs
    // on every machine. A step that waited for Docker would never run in a
    // cloud session, where the alert behaviour is tested.
    expect(steps[0]?.needsTool).toBeUndefined();
  });

  test('BUG-52: an edited L3 test runs with vitest.integration.config.mjs and names that file, and its step needs Docker', () => {
    const steps = stepsNaming([INTEGRATION], INTEGRATION);

    expect(steps).toHaveLength(1);
    expect(configOf(steps[0])).toBe('vitest.integration.config.mjs');
    expect(subcommandOf(steps[0])).toBe('run');
    // The field gate:full's L3 step carries (scripts/gate.mjs), so the same
    // rule decides both: run where `docker info` answers, and otherwise say
    // the step was not possible here.
    expect(steps[0]?.needsTool).toBe('docker');
  });

  test.each([
    ['a unit test (.test.ts) alone', [UNIT_TS], [UNIT_TS]],
    ['a unit test (.test.mjs) alone', [UNIT_MJS], [UNIT_MJS]],
    ['an L6 test alone', [SYSTEM], [SYSTEM]],
    ['an L3 test alone', [INTEGRATION], [INTEGRATION]],
    [
      'unit, L6 and L3 tests and a source file edited together',
      [SOURCE, UNIT_TS, UNIT_MJS, SYSTEM, INTEGRATION],
      [UNIT_TS, UNIT_MJS, SYSTEM, INTEGRATION],
    ],
  ])(
    'BUG-52: %s: each edited test goes to exactly one Vitest step, whose config would find it',
    (_, edited, tests) => {
      for (const file of tests) {
        const steps = stepsNaming(edited, file);

        expect(steps, `the Vitest steps that name ${file}`).toHaveLength(1);
        expect(
          configFinds(steps[0], file),
          `${file} goes to ${configOf(steps[0]) ?? 'the default config'}`,
        ).toBe(true);
      }
    },
  );

  test('BUG-52: an L6 test edited with a source file still gets its own L6 step, beside the tests related to the source file', () => {
    const edited = [SOURCE, SYSTEM];
    const related = vitestSteps(edited).filter((step) => subcommandOf(step) === 'related');
    const l6 = stepsNaming(edited, SYSTEM);

    expect(related).toHaveLength(1);
    expect(related[0]?.command).toContain(SOURCE);
    expect(related[0]?.command).not.toContain(SYSTEM);
    expect(l6).toHaveLength(1);
    expect(configOf(l6[0])).toBe('vitest.system.config.mjs');
    expect(subcommandOf(l6[0])).toBe('run');
  });

  test('BUG-52: an L3 test edited with a source file still gets its own L3 step, and it needs Docker', () => {
    const edited = [SOURCE, INTEGRATION];
    const l3 = stepsNaming(edited, INTEGRATION);

    expect(l3).toHaveLength(1);
    expect(configOf(l3[0])).toBe('vitest.integration.config.mjs');
    expect(l3[0]?.needsTool).toBe('docker');
  });

  test('BUG-52: a unit test edited with a source file runs itself too, with the default config, beside the tests related to the source file', () => {
    // The decision above. This test file does not import api.ts, so `related`
    // on api.ts would not run it.
    const edited = [SOURCE, UNIT_MJS];
    const own = stepsNaming(edited, UNIT_MJS);

    expect(own).toHaveLength(1);
    expect(subcommandOf(own[0])).toBe('run');
    expect(DEFAULT_CONFIG).toContain(configOf(own[0]));
    expect(vitestSteps(edited).filter((step) => subcommandOf(step) === 'related')).toHaveLength(1);
  });

  test.each([UNIT_TS, UNIT_MJS])(
    'BUG-52: an edited unit test %s, alone, still runs as before: `vitest run` on that file, with the default config and no tool',
    (file) => {
      const steps = vitestSteps([file]);

      expect(steps).toHaveLength(1);
      expect(steps[0]?.command.slice(0, 4)).toEqual(['pnpm', 'exec', 'vitest', 'run']);
      expect(steps[0]?.command).toContain(file);
      expect(DEFAULT_CONFIG).toContain(configOf(steps[0]));
      expect(steps[0]?.needsTool).toBeUndefined();
    },
  );

  test('BUG-52: an app test named like an L6 test stays on jest-expo, and Vitest is not asked', () => {
    // vitest.system.config.mjs includes apps/**/src/**/*.system.test.ts, the
    // app's folder too, so sending a file there by its name alone would hand
    // React Native code to a runner that cannot run it (INF-06).
    const file = 'apps/mobile/src/features/lost/journey.system.test.ts';

    expect(vitestSteps([file])).toEqual([]);
    expect(stepsFor([file]).filter((step) => step.command.includes('jest'))).toHaveLength(1);
  });
});

// BUG-52: what runSteps does with a step that needs a tool. The machine's tools
// are handed in as `available`, the map planSteps takes (scripts/lib/steps.mjs),
// so these run the same whether or not the machine running them has Docker.
// Each step is a small node script, as in the runSteps tests above; the L3 one
// leaves a file behind if it was started.
describe('runSteps, for a step that needs a tool (BUG-52)', () => {
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

  const nodeStep = (name, script) => ({ name, command: [process.execPath, '-e', script] });
  const L3 = 'the edited integration tests (L3)';
  /** An L3 step that writes `marker` when it starts. */
  const l3Step = (marker) => ({
    ...nodeStep(L3, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '');`),
    needsTool: 'docker',
    toolReason: 'a real PostgreSQL runs in a container (L3)',
  });

  test('BUG-52: where Docker does not work, the L3 step is not started, and comes back as not possible, with a reason that names Docker', async () => {
    const dir = tempDir();
    const marker = path.join(dir, 'l3.started');

    const results = await runSteps([nodeStep('formatting', "console.log('ok');"), l3Step(marker)], {
      cwd: dir,
      timeout: 30_000,
      available: { docker: false },
    });

    expect(existsSync(marker), 'the L3 step was started where Docker does not work').toBe(false);
    // `ok: false` as well as `notPossible: true`: anything that reads only `ok`
    // must never take a step that checked nothing for a pass.
    expect(results).toMatchObject([
      { name: 'formatting', ok: true },
      { name: L3, ok: false, notPossible: true, output: expect.stringMatching(/needs docker/i) },
    ]);
  });

  test('BUG-52: where Docker works, the same L3 step runs', async () => {
    const dir = tempDir();
    const marker = path.join(dir, 'l3.started');

    const results = await runSteps([l3Step(marker)], {
      cwd: dir,
      timeout: 30_000,
      available: { docker: true },
    });

    expect(existsSync(marker), 'the L3 step was not started where Docker works').toBe(true);
    expect(results).toMatchObject([{ name: L3, ok: true }]);
    expect(results[0]?.notPossible).not.toBe(true);
  });
});

// BUG-52: what report says about a step that was not possible here. It is not a
// failure, so the exit code is decided by the other steps alone; and it is not
// silence either: it is named, with its reason, so that a clean run never
// quietly means "did not check" (the rule gate:full follows).
describe('report, for a step that was not possible here (BUG-52)', () => {
  const files = ['apps/server/src/alerts.integration.test.ts'];
  const notPossible = {
    name: 'the edited integration tests (L3)',
    ok: false,
    notPossible: true,
    output:
      'needs docker, which is not working on this machine — a real PostgreSQL runs in a container (L3)',
  };

  test('BUG-52: beside passing steps, the exit code is 0, and the step is named as not possible here, with its reason', () => {
    const { text, exitCode } = report(
      [
        { name: 'formatting', ok: true, output: '' },
        notPossible,
        { name: 'lint', ok: true, output: '' },
      ],
      files,
    );

    expect(exitCode).toBe(0);
    expect(text).toMatch(/not possible here/i);
    expect(text).toContain(notPossible.name);
    expect(text).toMatch(/needs docker/i);
    expect(text).not.toContain('check(s) failed');
  });

  test('BUG-52: beside a failing step, the exit code is 1 from that step alone: the count is 1, and the step is named as not possible, not as a failure', () => {
    const { text, exitCode } = report(
      [
        { name: 'formatting', ok: true, output: '' },
        { name: 'lint', ok: false, output: 'alerts.integration.test.ts:3:7 no-unused-vars\n' },
        notPossible,
      ],
      files,
    );

    expect(exitCode).toBe(1);
    expect(text).toContain('\n--- lint ---\n');
    expect(text).toContain(`\n1 check(s) failed for: ${files.join(', ')}\n`);
    expect(text).not.toContain(`--- ${notPossible.name} ---`);
    expect(text).toMatch(/not possible here/i);
    expect(text).toMatch(/needs docker/i);
  });
});

// BUG-52, through main(): the real script, run the way `pnpm run gate:file`
// runs it, as in the main() describe above. Every step is `pnpm …`, so a fake
// pnpm first on PATH writes each call down and passes it; a fake docker answers
// `docker info` the way a machine with or without a working daemon does. So
// these need no Docker, and do not wait for prettier, eslint, turbo or
// dependency-cruiser, which have nothing to do with this bug and run for real
// after every edit anyway.
//
// One test hands the L6 step on to the real pnpm, so Vitest really runs the
// file. It is apps/server/src/api.system.test.ts: the smallest of the ten L6
// files (233 lines, 15 tests; about 7.5 s on its own, measured 2026-10-19,
// most of it transforming the server's modules), and a real one, so the run
// shows the system config finding a real L6 file with the server's imports,
// which is the case the bug is about. A fixture made for this test would have
// to be written under apps/**/src/ for that config to find it, where a
// concurrent test:system would pick it up and a killed run would leave it
// behind. The price: if api.system.test.ts fails, this test fails too, beside
// test:system, with Vitest's output in its message.
describe('main(), on an edited L6 or L3 test (BUG-52)', () => {
  const ROOT = path.resolve(import.meta.dirname, '..');
  const SYSTEM = 'apps/server/src/api.system.test.ts';
  const INTEGRATION = 'apps/server/src/alerts.integration.test.ts';
  const dirs = [];

  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop(), { recursive: true, force: true });
    }
  });

  /** Single-quoted for sh. */
  const quoted = (text) => `'${text.replaceAll("'", `'\\''`)}'`;

  /** The real pnpm, looked up before any fake is put in front of it. */
  const realPnpm = () => {
    const found = spawnSync('sh', ['-c', 'command -v pnpm'], { encoding: 'utf8' }).stdout.trim();
    expect(found, 'no pnpm on PATH to hand the L6 step to').not.toBe('');
    return found;
  };

  /**
   * A bin directory, first on PATH. Its pnpm writes down every call and
   * passes it, except a call containing `failOn`, which it fails; with
   * `vitest: <real pnpm>`, it hands `exec vitest …` on to the real pnpm and
   * keeps what that printed. With `docker` given, its docker writes down every
   * call and exits 0 (a daemon that answers) or 1 (one that does not).
   *
   * @param {{ docker?: boolean, vitest?: string, failOn?: string }} options
   */
  function fakeTools({ docker, vitest, failOn } = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), 'gate-file-bug52-'));
    dirs.push(dir);
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    const pnpm = [
      '#!/bin/sh',
      'here="$(dirname "$0")"',
      `printf '%s\\n' "$*" >> "$here/pnpm-calls"`,
      ...(failOn === undefined
        ? []
        : [`case "$*" in *${failOn}*) echo '${failOn} said no'; exit 1 ;; esac`]),
      ...(vitest === undefined
        ? []
        : [
            'if [ "$1" = exec ] && [ "$2" = vitest ]; then',
            `  ${quoted(vitest)} "$@" > "$here/vitest-$$.out" 2>&1`,
            '  status=$?',
            '  cat "$here/vitest-$$.out"',
            '  exit $status',
            'fi',
          ]),
      'exit 0',
    ];
    writeFileSync(path.join(bin, 'pnpm'), `${pnpm.join('\n')}\n`, { mode: 0o755 });
    if (docker !== undefined) {
      writeFileSync(
        path.join(bin, 'docker'),
        `#!/bin/sh\nprintf '%s\\n' "$*" >> "$(dirname "$0")/docker-calls"\nexit ${docker ? '0' : '1'}\n`,
        { mode: 0o755 },
      );
    }
    const readIn = (name) => {
      const file = path.join(bin, name);
      return existsSync(file) ? readFileSync(file, 'utf8') : '';
    };
    return {
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
      pnpmCalls: () => readIn('pnpm-calls'),
      dockerAsked: () => existsSync(path.join(bin, 'docker-calls')),
      dockerCalls: () => readIn('docker-calls'),
      vitestOutput: () =>
        readdirSync(bin)
          .filter((name) => name.startsWith('vitest-'))
          .map(readIn)
          .join('\n'),
    };
  }

  /** Runs the per-edit gate on `file`, as a process of its own, from the repository root. */
  const gate = (file, env, timeout) =>
    spawnSync(process.execPath, ['scripts/gate-file.mjs', file], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout,
    });

  const told = (run) =>
    [
      `exit code ${String(run.status)}, signal ${String(run.signal)}`,
      run.error ? `error: ${run.error.message}` : '',
      `stdout:\n${run.stdout ?? ''}`,
      `stderr:\n${run.stderr ?? ''}`,
    ].join('\n');

  test('BUG-52: an edited L6 test file passes the gate, exit code 0, because its tests really ran under vitest.system.config.mjs', () => {
    const tools = fakeTools({ vitest: realPnpm() });

    const run = gate(SYSTEM, tools.env, 120_000);

    expect(run.status, told(run)).toBe(0);
    const l6 = tools
      .pnpmCalls()
      .split('\n')
      .filter((call) => call.includes('vitest'));
    expect(l6, tools.pnpmCalls()).toHaveLength(1);
    expect(l6[0]).toContain('vitest.system.config.mjs');
    expect(l6[0]).toContain(SYSTEM);
    // What Vitest printed: one file found, the one named above, and its tests
    // passed, so exit code 0 means checked, not skipped. Writing to a pipe, the
    // default reporter prints only the summary for files that pass, without
    // their names (seen 2026-10-19), so the call above is what names the file.
    const printed = stripVTControlCharacters(tools.vitestOutput());
    expect(printed, tools.vitestOutput()).toMatch(/Test Files\s+1 passed \(1\)/);
    expect(printed).toMatch(/Tests\s+[1-9]\d* passed/);
  }, 150_000);

  test('BUG-52: an edited L3 test file where Docker does not work: exit code 0, the step did not run, and the gate says it was not possible here, naming Docker', () => {
    const tools = fakeTools({ docker: false });

    const run = gate(INTEGRATION, tools.env, 30_000);

    expect(run.status, told(run)).toBe(0);
    expect(run.stdout, told(run)).toMatch(/not possible here/i);
    expect(run.stdout, told(run)).toMatch(/needs docker/i);
    expect(tools.pnpmCalls(), 'the L3 step ran where Docker does not work').not.toContain('vitest');
    // The control: the gate asked this machine's docker, as gate:full does,
    // so the answer above came from the machine and not from a guess.
    expect(tools.dockerCalls()).toContain('info');
  });

  test('BUG-52: an edited L3 test file where Docker works: the L3 step runs, with vitest.integration.config.mjs', () => {
    const tools = fakeTools({ docker: true });

    const run = gate(INTEGRATION, tools.env, 30_000);

    expect(run.status, told(run)).toBe(0);
    const l3 = tools
      .pnpmCalls()
      .split('\n')
      .filter((call) => call.includes('vitest'));
    expect(l3, tools.pnpmCalls()).toHaveLength(1);
    expect(l3[0]).toContain('vitest.integration.config.mjs');
    expect(l3[0]).toContain(INTEGRATION);
    expect(run.stdout, told(run)).not.toMatch(/not possible/i);
  });

  test('BUG-52: an edited L3 test file where Docker does not work and another step fails: exit code 1 from that step alone, and the L3 step is still named as not possible', () => {
    const tools = fakeTools({ docker: false, failOn: 'prettier' });

    const run = gate(INTEGRATION, tools.env, 30_000);

    expect(run.status, told(run)).toBe(1);
    const lines = run.stdout.split('\n');
    expect(lines, told(run)).toContain('--- formatting ---');
    expect(lines, told(run)).toContain(`1 check(s) failed for: ${INTEGRATION}`);
    expect(run.stdout, told(run)).toMatch(/not possible here/i);
  });

  test('BUG-52: an edit with no step that needs a tool does not ask for Docker, because `docker info` can take seconds and this gate runs after every edit', () => {
    const tools = fakeTools({ docker: true });

    const run = gate('apps/server/src/config.test.ts', tools.env, 30_000);

    expect(run.status, told(run)).toBe(0);
    // The control: the fake tools were on the path and reached.
    expect(tools.pnpmCalls()).toContain('vitest');
    expect(tools.dockerAsked(), 'docker was asked, though no step needs it').toBe(false);
  });
});

// BUG-52, RG-04: the coverage ratchet measures this file in-process, and the
// main() tests above run the script as a child process, which coverage does not
// see. So `availableFor` — which tools the steps need that work here — is tested
// here, in this process, against a fake `docker` put first on this process's
// PATH for the length of one test and taken off again in a `finally`. `run`
// (scripts/lib/proc.mjs) hands the child this process's environment, so the
// fake is what answers `docker info`, and it writes down every call.
describe('availableFor, in this process (BUG-52)', () => {
  const dirs = [];
  function tempDir() {
    const dir = mkdtempSync(path.join(tmpdir(), 'gate-file-available-'));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop(), { recursive: true, force: true });
    }
  });

  /**
   * A bin directory holding a `docker` that writes down its arguments and exits
   * with `exitCode`: 0 for a daemon that answers, 1 for a binary with no daemon.
   * Without `exitCode`, the directory has no docker at all.
   */
  function fakeDocker(exitCode) {
    const bin = path.join(tempDir(), 'bin');
    mkdirSync(bin);
    const calls = path.join(bin, 'docker-calls');
    if (exitCode !== undefined) {
      writeFileSync(
        path.join(bin, 'docker'),
        `#!/bin/sh\nprintf '%s\\n' "$*" >> "$(dirname "$0")/docker-calls"\nexit ${String(exitCode)}\n`,
        { mode: 0o755 },
      );
    }
    return { bin, asked: () => existsSync(calls), calls: () => readFileSync(calls, 'utf8') };
  }

  /** Runs `body` with `PATH` set to `pathValue`, and puts the old PATH back whatever happens. */
  function withPath(pathValue, body) {
    const before = process.env.PATH;
    process.env.PATH = pathValue;
    try {
      return body();
    } finally {
      process.env.PATH = before;
    }
  }
  const first = (bin) => `${bin}${path.delimiter}${process.env.PATH ?? ''}`;

  test.each([
    ['a unit test', 'apps/server/src/config.test.ts'],
    ['an L6 test, which needs no database', 'apps/server/src/escalation.system.test.ts'],
    ['a source file', 'apps/server/src/api.ts'],
    ['a configuration file', 'turbo.json'],
  ])(
    'BUG-52: availableFor, for %s, where no step needs a tool, returns {} and never asks docker',
    (_, file) => {
      const docker = fakeDocker(0);
      const cwd = tempDir();

      const available = withPath(first(docker.bin), () => availableFor(stepsFor([file]), cwd));

      expect(available).toEqual({});
      expect(docker.asked(), 'docker was asked, though no step needs it').toBe(false);
      // The control: the fake was on the PATH and answers, so its silence above
      // means it was never asked, not that it could not be reached.
      withPath(first(docker.bin), () => spawnSync('docker', ['info'], { env: process.env }));
      expect(docker.asked(), 'the fake docker could not be reached').toBe(true);
    },
  );

  test('BUG-52: availableFor, with an L3 step and a docker daemon that answers, asks `docker info` and returns { docker: true }', () => {
    const docker = fakeDocker(0);

    const available = withPath(first(docker.bin), () =>
      availableFor(stepsFor(['apps/server/src/alerts.integration.test.ts']), tempDir()),
    );

    expect(available).toEqual({ docker: true });
    expect(docker.calls().trim().split('\n')).toEqual(['info']);
  });

  test('BUG-52: availableFor, with an L3 step and a docker binary whose daemon does not answer (exit 1), returns { docker: false }', () => {
    const docker = fakeDocker(1);

    const available = withPath(first(docker.bin), () =>
      availableFor(stepsFor(['apps/server/src/alerts.integration.test.ts']), tempDir()),
    );

    expect(available).toEqual({ docker: false });
    expect(docker.calls().trim().split('\n')).toEqual(['info']);
  });

  test('BUG-52: availableFor, with an L3 step on a machine with no docker at all, returns { docker: false } rather than throwing', () => {
    // A PATH holding one empty folder: no docker anywhere on it.
    const empty = fakeDocker();

    const available = withPath(empty.bin, () =>
      availableFor(stepsFor(['apps/server/src/alerts.integration.test.ts']), tempDir()),
    );

    expect(available).toEqual({ docker: false });
  });
});

// BUG-52, RG-04: main() itself, in this process, so the ratchet sees its lines
// (the main() tests above run it as a child, and coverage does not follow a
// child). This needs one change to the script: `main` exported, as it is
// declared today (no arguments). The test sets what main() reads and writes —
// process.argv, PATH, process.stdout.write and process.exitCode — for its own
// length only and puts each back in a `finally`, so the run that hosts it is
// left exactly as it was. Every step is `pnpm …`, so a fake pnpm first on PATH
// passes them all at once, and a fake docker answers `docker info` with exit 1.
describe('main(), in this process (BUG-52)', () => {
  const ROOT = path.resolve(import.meta.dirname, '..');
  const INTEGRATION = 'apps/server/src/alerts.integration.test.ts';
  const dirs = [];

  afterEach(() => {
    while (dirs.length > 0) {
      rmSync(dirs.pop(), { recursive: true, force: true });
    }
  });

  test('BUG-52: main() on an edited L3 test where Docker does not work prints that the step was not possible here and sets exit code 0', async () => {
    const bin = path.join(mkdtempSync(path.join(tmpdir(), 'gate-file-main-in-process-')), 'bin');
    dirs.push(path.dirname(bin));
    mkdirSync(bin);
    writeFileSync(
      path.join(bin, 'pnpm'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$(dirname "$0")/pnpm-calls"\nexit 0\n`,
      { mode: 0o755 },
    );
    writeFileSync(
      path.join(bin, 'docker'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$(dirname "$0")/docker-calls"\nexit 1\n`,
      { mode: 0o755 },
    );
    const before = { argv: process.argv, path: process.env.PATH, exitCode: process.exitCode };
    let written = '';
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written += String(chunk);
      return true;
    });
    let exitCode;
    try {
      process.argv = [process.execPath, path.join(ROOT, 'scripts/gate-file.mjs'), INTEGRATION];
      process.env.PATH = `${bin}${path.delimiter}${before.path ?? ''}`;
      await main();
      exitCode = process.exitCode;
    } finally {
      write.mockRestore();
      process.argv = before.argv;
      process.env.PATH = before.path;
      process.exitCode = before.exitCode;
    }

    expect(exitCode, written).toBe(0);
    expect(written).toMatch(/not possible here/i);
    expect(written).toMatch(/needs docker/i);
    expect(readFileSync(path.join(bin, 'docker-calls'), 'utf8')).toContain('info');
    const calls = readFileSync(path.join(bin, 'pnpm-calls'), 'utf8');
    expect(calls).toContain('prettier');
    expect(calls, 'the L3 step ran where Docker does not work').not.toContain('vitest');
  });
});
