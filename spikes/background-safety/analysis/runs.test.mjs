// SPIKE-01: every run counts (analysis/runs.mjs). A scenario's verdict on one
// platform comes from all of its runs: a failed run is never replaced by a
// re-run, and an invalid run (the harness broke) is listed with its evidence
// but never counted as passed.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const judgeScenario = async (input) => (await import('./runs.mjs')).judgeScenario(input);

const passed = (id, extra = {}) => ({ id, status: 'passed', ...extra });
const failed = (id, extra = {}) => ({ id, status: 'failed', ...extra });
const invalid = (id, evidence = ['the receiver stopped ticking at 31 min']) => ({
  id,
  status: 'invalid',
  evidence,
});
const judge = (runs, scenario = 'S1') => judgeScenario({ scenario, platform: 'android', runs });

const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError];
/** Rejects on purpose: not a missing module, and not a programming error. */
async function refuses(promise, why) {
  await assert.rejects(
    promise,
    (error) => {
      assert.ok(
        error?.code !== 'ERR_MODULE_NOT_FOUND' &&
          !PROGRAMMING_ERRORS.some((type) => error instanceof type),
        `${why}: it broke instead of refusing (${error?.name}: ${error?.message})`,
      );
      return true;
    },
    why,
  );
}

test('SPIKE-01-AC13: two runs with one failed give failed, in either order, and a lone failed run is already failed', async () => {
  assert.equal((await judge([passed('r1'), failed('r2')])).verdict, 'failed');
  assert.equal((await judge([failed('r1'), passed('r2')])).verdict, 'failed');
  assert.equal((await judge([failed('r1')])).verdict, 'failed');
});

test('SPIKE-01-AC13: a failed run is never replaced by re-runs that pass', async () => {
  const result = await judge([failed('r1'), passed('r2'), passed('r3')]);
  assert.equal(result.verdict, 'failed');
  assert.deepEqual(
    result.runs.map((run) => run.id),
    ['r1', 'r2', 'r3'],
  );
});

test('SPIKE-01-AC13: an invalid run is listed with its evidence and never counted as passed', async () => {
  const result = await judge([passed('r1'), invalid('r2'), passed('r3')]);
  assert.equal(result.verdict, 'passed');
  assert.equal(result.validRuns, 2);
  assert.equal(result.invalidRuns, 1);
  assert.deepEqual(
    result.runs.map((run) => [run.id, run.status]),
    [
      ['r1', 'passed'],
      ['r2', 'invalid'],
      ['r3', 'passed'],
    ],
  );
  assert.deepEqual(result.runs[1].evidence, ['the receiver stopped ticking at 31 min']);
});

test('SPIKE-01-AC13: fewer than two valid runs give no verdict', async () => {
  await refuses(judge([passed('r1'), invalid('r2')]), 'one valid run was enough to pass');
  await refuses(judge([invalid('r1'), invalid('r2')]), 'no valid run, yet a verdict');
  await refuses(judge([passed('r1')]), 'one run was enough to pass');
  await refuses(judge([]), 'no run at all, yet a verdict');
});

test('SPIKE-01-AC13: each case of a scenario needs two valid runs of its own', async () => {
  const swipe = (id) => passed(id, { case: 'swipe' });
  const kill = (id) => passed(id, { case: 'kill' });
  await refuses(
    judge([swipe('r1'), swipe('r2'), kill('r3')], 'S2'),
    'the kill case ran once, yet S2 passed',
  );
  assert.equal(
    (await judge([swipe('r1'), swipe('r2'), kill('r3'), kill('r4')], 'S2')).verdict,
    'passed',
  );
});

test('SPIKE-01-AC13: an invalid run without its evidence is refused', async () => {
  await refuses(judge([passed('r1'), passed('r2'), invalid('r3', [])]), 'empty evidence');
  await refuses(
    judge([passed('r1'), passed('r2'), { id: 'r3', status: 'invalid' }]),
    'no evidence at all',
  );
});

test('SPIKE-01-AC13: a run status other than passed, failed or invalid is refused', async () => {
  for (const status of ['flaky', 'skipped', 'retried', 'not shown on simulators', undefined]) {
    await refuses(
      judge([passed('r1'), passed('r2'), { id: 'r3', status }]),
      `a run with status ${status} was accepted`,
    );
  }
});
