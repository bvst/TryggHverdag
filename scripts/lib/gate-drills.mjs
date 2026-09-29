// INF-10: the gate drills' verdict (D-082).
//
// scripts/drills.test.mjs holds the drills: each is a bad change that its gate
// must refuse. This turns what Vitest reported for that file into the roadmap's
// nine rows and one verdict. It decides and runs nothing: scripts/gate-drills.mjs
// runs the file and asks whether oasdiff works.
//
// The rule that matters: the verdict cannot pass vacuously. A drill passes only
// when it ran and every one of its tests passed. One with no test is missing,
// not passed. The two drills only GitHub can enforce are never counted as
// passed, whatever the file holds.

/** The drill file, relative to the repository it runs in. */
export const DRILL_FILE = 'scripts/drills.test.mjs';

/**
 * The roadmap's nine drills, in its order (docs/plan/10-roadmap.md): the bad
 * change each tries, and the gate that must refuse it. A test belongs to the
 * drill whose ID its name puts in front of " drill". `live` drills only GitHub
 * can enforce: gate:integrity reads their rules, and a live attempt at them is
 * a later task, with the owner watching.
 */
const DRILLS = [
  { id: 'RG-03', attempt: 'a skip added to a test in a pull request', gate: 'tests:changes' },
  { id: 'CI-03', attempt: 'a failing test', gate: 'test:unit' },
  { id: 'RG-01', attempt: 'a new acceptance criterion without a test', gate: 'req:coverage' },
  // Without oasdiff, api:diff can only refuse to pass unchecked: that is shown,
  // and finding the break is not.
  { id: 'CI-06', attempt: 'a breaking API change', gate: 'api:diff', needsOasdiff: true },
  { id: 'HK-02', attempt: 'implementer editing a test file', gate: 'guard-paths and guard-bash' },
  { id: 'D-029', attempt: 'a push to main', live: true },
  {
    id: 'HK-07',
    attempt: 'a hard-coded secret or a real-looking phone number',
    gate: 'scan-sensitive',
  },
  { id: 'CODEOWNERS', attempt: 'a safety-path change without owner approval', live: true },
  {
    id: 'CI-11',
    attempt: 'a blocking AI review verdict',
    gate: '"Enforce the verdict" in ai-review.yml',
  },
];

const NOT_RUN =
  'not run here — covered by gate:integrity reading the live rules (CI-01); live attempt not yet run';

const FAIL_CLOSED =
  'fail-closed only — no oasdiff here, so api:diff refused to pass unchecked; CI installs oasdiff, and the drill proves detection there';

/** Whether a test belongs to `drill`: its name puts the drill's ID in front of " drill". */
const belongs = (result, drill) => result.name.includes(`${drill.id} drill`);

/** A list of test names, for a line of the verdict. */
const named = (results) => results.map((result) => `"${result.name}"`).join(', ');

/**
 * What one offline drill's tests say: its mark in the table, whether it held,
 * and, when it did not, why, for the verdict.
 */
function outcome(drill, tests, oasdiff) {
  if (tests.length === 0) {
    return {
      mark: '✗ missing',
      passed: false,
      why: `${drill.id}: missing — no test in ${DRILL_FILE} is named "${drill.id} drill"`,
    };
  }
  const failed = tests.filter((test) => test.status === 'failed');
  if (failed.length > 0) {
    return {
      mark: '✗ got through',
      passed: false,
      why: `${drill.id}: got through — failed: ${named(failed)}`,
    };
  }
  const idle = tests.filter((test) => test.status !== 'passed');
  if (idle.length > 0) {
    const statuses = [...new Set(idle.map((test) => test.status))].join(', ');
    return {
      mark: `✗ did not run (${statuses})`,
      passed: false,
      why: `${drill.id}: did not run — came back ${statuses}: ${named(idle)}`,
    };
  }
  if (drill.needsOasdiff && !oasdiff) {
    return { mark: `✓ ${FAIL_CLOSED}`, passed: true, why: '' };
  }
  return { mark: `✓ blocked by ${drill.gate}`, passed: true, why: '' };
}

/**
 * The nine rows, in the roadmap's order, and the verdict: what the command
 * prints, and the exit code it ends with.
 *
 * @param {{ name: string, status: string }[]} results every test the drill file
 *   ran: its name in full, and its status as Vitest's JSON reporter gives it
 * @param {{ oasdiff: boolean }} tools whether oasdiff works on this machine,
 *   asked by running it
 * @returns {{ rows: { id: string, text: string, passed: boolean }[], exitCode: number, text: string }}
 */
export function drillReport(results, { oasdiff }) {
  const idWidth = Math.max(...DRILLS.map((drill) => drill.id.length));
  const attemptWidth = Math.max(...DRILLS.map((drill) => drill.attempt.length));
  const label = (drill) => `${drill.id.padEnd(idWidth)}  ${drill.attempt.padEnd(attemptWidth)}  `;

  const problems = [];
  const rows = DRILLS.map((drill) => {
    if (drill.live === true) {
      return { id: drill.id, text: `${label(drill)}· ${NOT_RUN}`, passed: false };
    }
    const tests = results.filter((result) => belongs(result, drill));
    const { mark, passed, why } = outcome(drill, tests, oasdiff);
    if (!passed) problems.push(why);
    return { id: drill.id, text: `${label(drill)}${mark}`, passed };
  });

  // A test outside the offline drills still has to pass: the file is one run,
  // and a red test anywhere in it is a red run.
  const offline = DRILLS.filter((drill) => drill.live !== true);
  for (const other of results.filter(
    (result) => result.status !== 'passed' && !offline.some((drill) => belongs(result, drill)),
  )) {
    problems.push(`a test outside the drills came back ${other.status}: "${other.name}"`);
  }

  const lines = [
    `Gate drills (INF-10): each is a bad change that its gate must refuse (${DRILL_FILE}).`,
    '',
    ...rows.map((row) => row.text),
    '',
  ];
  if (results.length === 0) {
    lines.push(
      `gate:drills: nothing ran, so nothing was checked. That is not a pass. ${DRILL_FILE} gave no results.`,
    );
  } else if (problems.length > 0) {
    lines.push(
      'gate:drills: FAILED. While a drill gets through, M0 is not done (INF-10):',
      ...problems.map((problem) => `  ${problem}`),
    );
  } else {
    const failClosed = offline.filter((drill) => drill.needsOasdiff && !oasdiff).length;
    lines.push(
      `gate:drills: ${String(offline.length - failClosed)} of ${String(offline.length)} offline drills blocked` +
        (failClosed === 0
          ? '.'
          : `, and ${String(failClosed)} fail-closed only, for want of oasdiff here.`) +
        ` The ${String(DRILLS.length - offline.length)} live ones are not run here (D-082).`,
    );
  }
  lines.push('');

  const exitCode = results.length > 0 && problems.length === 0 ? 0 : 1;
  return { rows, exitCode, text: lines.join('\n') };
}
