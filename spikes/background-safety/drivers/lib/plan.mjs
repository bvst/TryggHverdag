// SPIKE-01-AC13: the runner's plan, shared by run-all.mjs (which runs it),
// summarize.mjs (which gives the go/no-go the planned cases, so that a case
// that never ran is never a pass) and rejudge.mjs (which reads the run
// folders' names). Data only: no I/O.

/**
 * The plan: the go/no-go scenarios first in each block (S1, S3, S4, S7, and the
 * AC12 capture), then the findings (S2, S5, S6, S8). `repeat` is the planned
 * run's number within its case; each case is run twice. One of each pair of
 * S1 and S8 runs on Android carries the network capture.
 */
export const BLOCKS = [
  {
    platform: 'android',
    runs: [
      { scenario: 's1', tcpdump: true, minutes: 50, timeout: 75 },
      { scenario: 's1', minutes: 49, timeout: 70 },
      ...twice({ scenario: 's3', case: 'exempt', minutes: 50, timeout: 70 }),
      ...twice({ scenario: 's3', case: 'not-exempt', minutes: 50, timeout: 70 }),
      ...twice({ scenario: 's4', minutes: 13, timeout: 25 }),
      ...twice({ scenario: 's7', case: 'background', minutes: 9, timeout: 20 }),
      ...twice({ scenario: 's7', case: 'fine', minutes: 9, timeout: 20 }),
      // S2 watches until 6.5 min after the last arrival, up to 15 min after the app was ended.
      ...twice({ scenario: 's2', case: 'swipe', minutes: 23, timeout: 35 }),
      ...twice({ scenario: 's2', case: 'lmk', minutes: 23, timeout: 35 }),
      ...twice({ scenario: 's2', case: 'forcestop', minutes: 15, timeout: 35 }),
      ...twice({ scenario: 's5', minutes: 2, timeout: 10 }),
      ...twice({ scenario: 's6', case: 'without', minutes: 1.5, timeout: 8 }),
      ...twice({ scenario: 's6', case: 'with', minutes: 1.5, timeout: 8 }),
      { scenario: 's8', tcpdump: true, minutes: 5, timeout: 15 },
      { scenario: 's8', minutes: 3, timeout: 12 },
    ],
  },
  {
    platform: 'ios',
    runs: [
      ...twice({ scenario: 's1', minutes: 50, timeout: 70 }),
      ...twice({ scenario: 's4', minutes: 14, timeout: 25 }),
      ...twice({ scenario: 's7', case: 'always-to-inuse', minutes: 9, timeout: 20 }),
      ...twice({ scenario: 's2', minutes: 15, timeout: 35 }),
      ...twice({ scenario: 's5', minutes: 3, timeout: 10 }),
      ...twice({ scenario: 's8', minutes: 3, timeout: 12 }),
    ],
  },
];

/**
 * Cases outside the night's plan, run only when asked for with --only: S1 on
 * Android with the battery-optimisation exemption granted (the owner's Q4,
 * 2026-10-01). The first carries the capture, as S1's first run does, so the
 * same runs can show whose Firebase lookup it is (with firebase-logcat.txt).
 */
export const EXTRAS = [
  {
    platform: 'android',
    runs: [
      { scenario: 's1', case: 'exempt', tcpdump: true, minutes: 50, timeout: 75 },
      { scenario: 's1', case: 'exempt', minutes: 50, timeout: 70 },
    ],
  },
];

function twice(run) {
  return [run, { ...run }];
}

export const caseKey = ({ platform, scenario, case: name }) =>
  `${scenario}/${platform}/${name ?? '-'}`;

/** Each planned run with its platform, its case key and its number within the case. */
export function planned(blocks = BLOCKS) {
  const slots = [];
  for (const { platform, runs } of blocks) {
    const seen = new Map();
    for (const run of runs) {
      const key = caseKey({ platform, scenario: run.scenario, case: run.case ?? null });
      const repeat = (seen.get(key) ?? 0) + 1;
      seen.set(key, repeat);
      slots.push({ platform, case: null, tcpdump: false, ...run, repeat, key });
    }
  }
  return slots;
}

/** S2's Force stop is recorded, not judged (AC6). */
export const isJudged = (slot) => !(slot.scenario === 's2' && slot.case === 'forcestop');

/**
 * The planned cases the go/no-go judges, as goNoGoInput takes them:
 * { scenario: { platform: [case or null, …] } }. Cases recorded and not judged
 * are left out.
 */
export function expectedCases(blocks = [...BLOCKS, ...EXTRAS]) {
  const expected = {};
  for (const slot of planned(blocks).filter(isJudged)) {
    const cases = ((expected[slot.scenario] ??= {})[slot.platform] ??= []);
    if (!cases.includes(slot.case)) cases.push(slot.case);
  }
  return expected;
}

/** A run folder's name after its night: `<scenario>-<platform>[-<case>]-<attempt>`. */
const RUN_FOLDER = /^(s\d)-(android|ios)(?:-(.+))?-(\d+)$/;

/**
 * A folder of `night`'s runs, read from its name, or null when the name is
 * not one: { scenario, platform, case, attempt, key }.
 */
export function runFolder(night, name) {
  if (!name.startsWith(`${night}-`)) return null;
  const parts = RUN_FOLDER.exec(name.slice(night.length + 1));
  if (parts === null) return null;
  const [, scenario, platform, runCase = null, attempt] = parts;
  return {
    scenario,
    platform,
    case: runCase,
    attempt: Number(attempt),
    key: caseKey({ platform, scenario, case: runCase }),
  };
}
