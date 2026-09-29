// INF-10: the gate drills' verdict (D-082).
//
// scripts/drills.test.mjs holds the drills: each is a bad change that its gate
// must refuse. This turns what Vitest reported for that file into the roadmap's
// nine rows and one verdict. It decides and runs nothing: scripts/gate-drills.mjs
// runs the file and asks whether oasdiff works.
//
// The rule that matters: the verdict cannot pass vacuously. A drill passes only
// when its attempt passed and every other test of it passed too. One whose
// attempt is not there is missing, not passed. The two drills only GitHub can
// enforce are never counted as passed, whatever the file holds. And a run that
// Vitest itself failed, or did not finish, is not trusted.

/** The drill file, relative to the repository it runs in. */
export const DRILL_FILE = 'scripts/drills.test.mjs';

/**
 * The roadmap's nine drills, in its order (docs/plan/10-roadmap.md): the bad
 * change each tries, the criterion its attempt is named from, and the gate that
 * must refuse it. A test belongs to the drill whose ID its name puts in front
 * of " drill". `live` drills only GitHub can enforce: gate:integrity reads
 * their rules, and a live attempt at them is a later task, with the owner
 * watching.
 */
const DRILLS = [
  {
    id: 'RG-03',
    change: 'a skip added to a test in a pull request',
    attempt: 'INF-10-AC1',
    gate: 'tests:changes',
  },
  { id: 'CI-03', change: 'a failing test', attempt: 'INF-10-AC2', gate: 'test:unit' },
  {
    id: 'RG-01',
    change: 'a new acceptance criterion without a test',
    attempt: 'INF-10-AC3',
    gate: 'req:coverage',
  },
  // Without oasdiff, api:diff can only refuse to pass unchecked: that is shown,
  // and finding the break is not.
  {
    id: 'CI-06',
    change: 'a breaking API change',
    attempt: 'INF-10-AC4',
    gate: 'api:diff',
    needsOasdiff: true,
  },
  {
    id: 'HK-02',
    change: 'implementer editing a test file',
    attempt: 'INF-10-AC5',
    gate: 'guard-paths and guard-bash',
  },
  { id: 'D-029', change: 'a push to main', live: true },
  {
    id: 'HK-07',
    change: 'a hard-coded secret or a real-looking phone number',
    attempt: 'INF-10-AC6',
    gate: 'scan-sensitive',
  },
  { id: 'CODEOWNERS', change: 'a safety-path change without owner approval', live: true },
  {
    id: 'CI-11',
    change: 'a blocking AI review verdict',
    attempt: 'INF-10-AC7',
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
  // The row stands on the attempt itself, not on whatever else of the drill
  // passed. `INF-10-AC1:` is not `INF-10-AC10:`, hence the colon.
  if (!tests.some((test) => test.title.startsWith(`${drill.attempt}:`))) {
    return {
      mark: '✗ missing',
      passed: false,
      why: `${drill.id}: missing — no passed test's own name starts with its attempt, ${drill.attempt}:`,
    };
  }
  if (drill.needsOasdiff && !oasdiff) {
    return { mark: `✓ ${FAIL_CLOSED}`, passed: true, why: '' };
  }
  return { mark: `✓ blocked by ${drill.gate}`, passed: true, why: '' };
}

/**
 * The verdict line, or lines, and whether the run held. A run Vitest did not
 * finish is not trusted, whatever results it left; nor is one it failed with
 * every test passed.
 */
function verdictOf({ results, problems, oasdiff, status, signal }) {
  if (signal) {
    return {
      held: false,
      lines: [
        `gate:drills: Vitest was stopped by ${signal} before it finished, as a timeout stops it, so the run is not trusted.`,
      ],
    };
  }
  if (results.length === 0) {
    return {
      held: false,
      lines: [
        `gate:drills: nothing ran, so nothing was checked. That is not a pass. ${DRILL_FILE} gave no results.`,
      ],
    };
  }
  if (problems.length > 0) {
    return {
      held: false,
      lines: [
        'gate:drills: FAILED. What did not hold:',
        ...problems.map((problem) => `  ${problem}`),
      ],
    };
  }
  if (status !== 0) {
    const exit =
      typeof status === 'number' ? `exited with ${String(status)}` : 'gave no exit status';
    return {
      held: false,
      lines: [
        `gate:drills: Vitest ${exit} although every test passed, so the run is not trusted. Its own output says why.`,
      ],
    };
  }
  const offline = DRILLS.filter((drill) => drill.live !== true);
  const failClosed = offline.filter((drill) => drill.needsOasdiff && !oasdiff).length;
  return {
    held: true,
    lines: [
      `gate:drills: ${String(offline.length - failClosed)} of ${String(offline.length)} offline drills blocked` +
        (failClosed === 0
          ? '.'
          : `, and ${String(failClosed)} fail-closed only, for want of oasdiff here.`) +
        ` The ${String(DRILLS.length - offline.length)} live ones are not run here (D-082).`,
    ],
  };
}

/**
 * The nine rows, in the roadmap's order, and the verdict: what the command
 * prints, and the exit code it ends with.
 *
 * @param {{ name: string, title: string, status: string }[]} results every test
 *   the drill file ran: its name in full, its own name (`title`), and its status
 *   as Vitest's JSON reporter gives them
 * @param {{ oasdiff: boolean, status?: number | null, signal?: string | null }} run
 *   whether oasdiff works on this machine, asked by running it; and Vitest's
 *   exit status and the signal that stopped it, if one did
 * @returns {{ rows: { id: string, text: string, passed: boolean }[], exitCode: number, text: string }}
 */
export function drillReport(results, { oasdiff, status, signal }) {
  const idWidth = Math.max(...DRILLS.map((drill) => drill.id.length));
  const changeWidth = Math.max(...DRILLS.map((drill) => drill.change.length));
  const label = (drill) => `${drill.id.padEnd(idWidth)}  ${drill.change.padEnd(changeWidth)}  `;

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

  const verdict = verdictOf({ results, problems, oasdiff, status, signal });
  const text = [
    `Gate drills (INF-10): each is a bad change that its gate must refuse (${DRILL_FILE}).`,
    '',
    ...rows.map((row) => row.text),
    '',
    ...verdict.lines,
    '',
  ].join('\n');
  return { rows, exitCode: verdict.held ? 0 : 1, text };
}
