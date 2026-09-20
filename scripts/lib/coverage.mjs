// RG-04: coverage on changed files may not go down, and safety code has a floor.
//
// Two different questions, kept apart on purpose:
//   the ratchet  — "is this change making things worse than they were?"
//   the floors   — "is this code well enough tested to be trusted at all?"

/** ⚙️ placeholders from docs/plan/06-testing-strategy.md, RG-04. */
export const FLOORS = {
  safetyBranches: 95,
  overallLines: 80,
};

/** Code where a missed branch is a missed alert (AR-02, AR-09). */
export const SAFETY_PATHS = [
  'apps/server/src/domain/',
  'apps/server/src/modules/alerts/',
  'apps/mobile/src/safety-core/',
];

/** Code that ships to people, as opposed to the repository's own tooling. */
export const PRODUCT_PATHS = ['apps/', 'packages/'];

const startsWithAny = (file, prefixes) => prefixes.some((prefix) => file.startsWith(prefix));

export const isSafetyPath = (file) => startsWithAny(file, SAFETY_PATHS);
export const isProductPath = (file) => startsWithAny(file, PRODUCT_PATHS);

/**
 * Turns a coverage-summary.json into plain per-file percentages, with paths
 * relative to the repository root.
 *
 * @param {object} summary the parsed coverage-summary.json
 * @param {string} root absolute path of the repository
 */
export function summarize(summary, root) {
  const files = {};
  for (const [key, value] of Object.entries(summary)) {
    if (key === 'total') {
      continue;
    }
    const file = key.startsWith(root) ? key.slice(root.length).replace(/^\//, '') : key;
    files[file] = {
      lines: value.lines?.pct ?? 0,
      branches: value.branches?.pct ?? 0,
      coveredLines: value.lines?.covered ?? 0,
      totalLines: value.lines?.total ?? 0,
    };
  }
  return files;
}

/**
 * Where a changed file covers less than it used to. New files have nothing to
 * compare against, which the floors handle instead.
 */
export function ratchetDrops({ current, baseline, changed }) {
  const drops = [];
  for (const file of changed) {
    const now = current[file];
    const was = baseline[file];
    if (now === undefined || was === undefined) {
      continue;
    }
    for (const metric of ['lines', 'branches']) {
      if (now[metric] + 0.01 < was[metric]) {
        drops.push({ file, metric, was: was[metric], now: now[metric] });
      }
    }
  }
  return drops;
}

/** Weighted line coverage over a set of files, or null when there are none. */
export function linesAcross(current, predicate) {
  const files = Object.entries(current).filter(([file]) => predicate(file));
  const totals = files.reduce(
    (sum, [, value]) => ({
      covered: sum.covered + value.coveredLines,
      total: sum.total + value.totalLines,
    }),
    { covered: 0, total: 0 },
  );
  if (files.length === 0 || totals.total === 0) {
    return null;
  }
  return (totals.covered / totals.total) * 100;
}

/**
 * Floor breaches, plus what could not be judged because that code does not
 * exist yet. A floor that quietly passes because there is nothing to measure is
 * exactly the false confidence this project is built to avoid.
 */
export function floorBreaches(current, floors = FLOORS) {
  const breaches = [];
  const notApplicable = [];

  const safetyFiles = Object.entries(current).filter(([file]) => isSafetyPath(file));
  if (safetyFiles.length === 0) {
    notApplicable.push('safety code: none exists yet (INF-05 and M2 add it)');
  } else {
    for (const [file, value] of safetyFiles) {
      if (value.branches < floors.safetyBranches) {
        breaches.push({
          scope: file,
          metric: 'branches',
          value: value.branches,
          floor: floors.safetyBranches,
        });
      }
    }
  }

  const productLines = linesAcross(current, isProductPath);
  if (productLines === null) {
    notApplicable.push('product code: none exists yet (INF-05 and INF-06 add it)');
  } else if (productLines < floors.overallLines) {
    breaches.push({
      scope: 'all product code',
      metric: 'lines',
      value: Number(productLines.toFixed(2)),
      floor: floors.overallLines,
    });
  }

  return { breaches, notApplicable };
}
