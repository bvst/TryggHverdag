// SPIKE-01-AC15: the go/no-go rule, applied item by item. Pure.
//
// - GO needs every deciding item passed wherever the device can show it.
// - "Not shown on simulators" never passes an item and never gives NO-GO: it is
//   listed as open until L9 (D-041).
// - "No verdict" (too few valid runs: the harness broke, the safety review's
//   B3) never passes an item either. While a deciding item has no verdict, the
//   rule gives no recommendation, unless a deciding item already failed: a
//   failure shown is final (D-060), so that is NO-GO whatever the rest shows.
// - S2, S3 without the exemption, S5, S5's "heard", S6, S8 and S1 with the
//   exemption do not decide the SDK; a failure there is a finding.
// - S7 is judged per run: a failed run is a finding only where the platform
//   ended that run's own process and nothing arrived after the change. A
//   platform that ends the process does so for any SDK; an SDK that kept
//   running, or came back, and still failed, decides.
// - The SDK's documented settings (the spec: "NO-GO follows when any item
//   fails and none of the SDK's documented settings fixes it. Every setting
//   tried is recorded"; review loop 2): a failed deciding item whose setting,
//   tried on its own platform, passed is "passed with <setting>", a condition
//   of the GO, not NO-GO. A setting that failed or has no verdict leaves its
//   item as it was. Every setting tried is printed.
// The owner decides; this only prints what the rule gives.

const PASSED = 'passed';
const FAILED = 'failed';
const NOT_SHOWN = 'not shown on simulators';
const NO_VERDICT = 'no verdict';
const VERDICTS = new Set([PASSED, FAILED, NOT_SHOWN, NO_VERDICT]);

/**
 * Each item, the platforms it is judged on (null: no platform), whether it
 * decides, and whether it may be left out (S1 with the exemption, when it was
 * not planned).
 */
const ITEMS = [
  { item: 'build', platforms: ['android', 'ios'], deciding: true },
  { item: 'S1', platforms: ['android', 'ios'], deciding: true },
  { item: 'S1 exempt', platforms: ['android'], deciding: false, optional: true },
  { item: 'S2', platforms: ['android', 'ios'], deciding: false },
  { item: 'S3', platforms: ['android'], deciding: true },
  { item: 'S3 not exempt', platforms: ['android'], deciding: false },
  { item: 'S4', platforms: ['android', 'ios'], deciding: true },
  { item: 'S5', platforms: ['android', 'ios'], deciding: false },
  { item: 'S5 heard', platforms: ['android', 'ios'], deciding: false },
  { item: 'S6', platforms: ['android', 'ios'], deciding: false },
  { item: 'S7', platforms: ['android', 'ios'], deciding: true },
  { item: 'S8', platforms: ['android', 'ios'], deciding: false },
  { item: 'capture', platforms: ['android', 'ios'], deciding: true },
  { item: 'licence', platforms: [null], deciding: true },
];

function verdictOf(verdicts, item, platform) {
  const where = platform === null ? item : `${item} on ${platform}`;
  const value = platform === null ? verdicts?.[item] : verdicts?.[item]?.[platform];
  if (!VERDICTS.has(value)) {
    throw new Error(`${where}: the verdict must be passed, failed, ${NOT_SHOWN} or ${NO_VERDICT}`);
  }
  return value;
}

/**
 * S7 failed on `platform`: whether every failed run is excused, because the
 * platform ended that run's process and nothing arrived after the change. With
 * no failed run listed, nothing excuses the failure. A failed run that does not
 * say both is refused.
 * @returns {{ excused: boolean, runs: string[] }}
 */
function s7Excuse(verdicts, platform) {
  const runs = verdicts.S7?.runs;
  if (!Array.isArray(runs)) {
    throw new Error(`S7 on ${platform} failed, but its runs are not listed`);
  }
  const failed = runs.filter((run) => run?.platform === platform && run?.status === FAILED);
  for (const run of failed) {
    if (typeof run.processEnded !== 'boolean' || !Number.isInteger(run.arrivalsAfterChange)) {
      throw new Error(
        `S7 run ${String(run.id)} failed, but whether its process ended, ` +
          'or how many arrivals came after the change, is not recorded',
      );
    }
  }
  const excused =
    failed.length > 0 &&
    failed.every((run) => run.processEnded === true && run.arrivalsAfterChange === 0);
  return { excused, runs: failed.map((run) => run.id) };
}

/** The findings given with the verdicts, such as S2's: { item, platform, run, why }. */
function givenFindings(verdicts) {
  const given = verdicts.findings ?? [];
  const ok = (finding) =>
    typeof finding?.item === 'string' &&
    (finding.platform === null || typeof finding.platform === 'string') &&
    typeof finding.run === 'string' &&
    typeof finding.why === 'string' &&
    finding.why !== '';
  if (!Array.isArray(given) || !given.every(ok)) {
    throw new Error('findings must be a list of { item, platform, run, why }');
  }
  return given.map(({ item, platform, run, why }) => ({ item, platform, run, why }));
}

/** The settings tried: { item, platform, setting, verdict }, the verdict one of the four. */
function settingsTried(verdicts) {
  const tried = verdicts.settings ?? [];
  const ok = (entry) =>
    typeof entry?.item === 'string' &&
    entry.item !== '' &&
    (entry.platform === null || typeof entry.platform === 'string') &&
    typeof entry.setting === 'string' &&
    entry.setting.trim() !== '' &&
    VERDICTS.has(entry.verdict);
  if (!Array.isArray(tried) || !tried.every(ok)) {
    throw new Error(
      'settings must be a list of { item, platform, setting, verdict }, ' +
        `the verdict passed, failed, ${NOT_SHOWN} or ${NO_VERDICT}`,
    );
  }
  return tried.map(({ item, platform, setting, verdict }) => ({
    item,
    platform,
    setting,
    verdict,
  }));
}

const label = ({ item, platform }) => (platform === null ? item : `${item} ${platform}`);

/**
 * @param {object} verdicts `{ build: { android, ios }, S1: …, 'S1 exempt'?: { android },
 *   S3: { android }, 'S3 not exempt': { android }, …, 'S5 heard': { android, ios }, …,
 *   S7: { android, ios, runs: [{ id, platform, case, status, processEnded,
 *   arrivalsAfterChange }] }, capture: …, licence, findings?: [{ item, platform,
 *   run, why }], settings?: [{ item, platform, setting, verdict }] }`; each
 *   verdict passed, failed, not shown on simulators or no verdict
 * @returns {{ recommendation: 'GO' | 'NO-GO' | null, items: object[], findings: object[],
 *   conditions: object[], settings: object[], open: object[], noVerdict: object[],
 *   text: string }}
 */
export function goNoGo(verdicts) {
  const settings = settingsTried(verdicts);
  const items = [];
  const findings = [];
  const conditions = [];
  const open = [];
  const noVerdict = [];
  let noGo = false;
  for (const { item, platforms, deciding, optional } of ITEMS) {
    if (optional && verdicts?.[item] === undefined) continue;
    for (const platform of platforms) {
      const verdict = verdictOf(verdicts, item, platform);
      const entry = { item, platform, verdict, deciding };
      items.push(entry);
      if (verdict === NOT_SHOWN) {
        open.push({ item, platform });
      } else if (verdict === NO_VERDICT) {
        noVerdict.push({ item, platform, deciding });
      } else if (verdict === FAILED) {
        const fixedBy = settings.find(
          (entry) => entry.item === item && entry.platform === platform && entry.verdict === PASSED,
        );
        if (!deciding) {
          const why =
            item === 'S1 exempt' && verdicts.S1?.[platform] === PASSED
              ? 'failed with the exemption, while S1 without it passed; it does not decide the SDK'
              : 'failed; it does not decide the SDK';
          findings.push({ item, platform, why });
        } else if (fixedBy !== undefined) {
          entry.passedWith = fixedBy.setting;
          conditions.push({ item, platform, setting: fixedBy.setting });
        } else if (item === 'S7') {
          const { excused, runs } = s7Excuse(verdicts, platform);
          if (excused) {
            findings.push({
              item,
              platform,
              run: runs.join(', '),
              why: 'failed because the platform ended the process, and nothing arrived after the change',
            });
          } else {
            noGo = true;
          }
        } else {
          noGo = true;
        }
      }
    }
  }
  findings.push(...givenFindings(verdicts));
  const undecided = noVerdict.filter((entry) => entry.deciding);
  let recommendation = 'GO';
  if (noGo) recommendation = 'NO-GO';
  else if (undecided.length > 0) recommendation = null;

  const headline =
    recommendation === null
      ? `No recommendation: no verdict on ${undecided.map(label).join(', ')}, which decide the SDK`
      : `Recommendation: ${recommendation}`;
  const lines = [headline, '', 'Items:'];
  for (const entry of items) {
    const role = entry.deciding ? 'decides' : 'finding only';
    const verdict =
      entry.passedWith === undefined ? entry.verdict : `failed; passed with ${entry.passedWith}`;
    lines.push(`- ${label(entry)}: ${verdict} (${role})`);
  }
  if (conditions.length > 0) {
    lines.push('', 'Conditions (items that passed only with these settings):');
    for (const entry of conditions) lines.push(`- ${label(entry)}: passed with ${entry.setting}`);
  }
  if (settings.length > 0) {
    lines.push('', 'Settings tried:');
    for (const entry of settings)
      lines.push(`- ${label(entry)}: ${entry.setting}: ${entry.verdict}`);
  }
  if (findings.length > 0) {
    lines.push('', 'Findings for the owner:');
    for (const finding of findings) {
      const run = finding.run === undefined ? '' : ` (${finding.run})`;
      lines.push(`- ${label(finding)}: ${finding.why}${run}`);
    }
  }
  if (noVerdict.length > 0) {
    lines.push(
      '',
      'No verdict (a planned case with fewer than two valid runs, or none: the harness, not the device):',
    );
    for (const entry of noVerdict) {
      lines.push(`- ${label(entry)}: no verdict${entry.deciding ? ' (decides)' : ''}`);
    }
  }
  if (open.length > 0) {
    lines.push('', 'Open until L9, the real-device suite (D-041):');
    for (const entry of open) lines.push(`- ${label(entry)}`);
  }
  if (recommendation === 'GO') lines.push('', 'GO rests on emulator and simulator evidence only.');
  return {
    recommendation,
    items,
    findings,
    conditions,
    settings,
    open,
    noVerdict,
    text: lines.join('\n'),
  };
}
