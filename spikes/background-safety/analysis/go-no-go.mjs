// SPIKE-01-AC15: the go/no-go rule, applied item by item. Pure.
//
// - GO needs every deciding item passed wherever the device can show it.
// - "Not shown on simulators" never passes an item and never gives NO-GO: it is
//   listed as open until L9 (D-041).
// - S2, S5, S6 and S8 do not decide the SDK; a failure there is a finding.
// - S7 failing where the platform ended the app's process is a finding too: a
//   platform that ends the process does so for any SDK.
// The owner decides; this only prints what the rule gives.

const PASSED = 'passed';
const FAILED = 'failed';
const NOT_SHOWN = 'not shown on simulators';
const VERDICTS = new Set([PASSED, FAILED, NOT_SHOWN]);

/** Each item, the platforms it is judged on (null: no platform), and whether it decides. */
const ITEMS = [
  { item: 'build', platforms: ['android', 'ios'], deciding: true },
  { item: 'S1', platforms: ['android', 'ios'], deciding: true },
  { item: 'S2', platforms: ['android', 'ios'], deciding: false },
  { item: 'S3', platforms: ['android'], deciding: true },
  { item: 'S4', platforms: ['android', 'ios'], deciding: true },
  { item: 'S5', platforms: ['android', 'ios'], deciding: false },
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
    throw new Error(`${where}: the verdict must be passed, failed or ${NOT_SHOWN}`);
  }
  return value;
}

/** Whether the platform ended the app's process when S7 changed its permission. */
function processEnded(verdicts, platform) {
  const ended = verdicts.S7?.processEnded?.[platform];
  if (typeof ended !== 'boolean') {
    throw new Error(`S7 on ${platform} failed, but whether the process ended is not recorded`);
  }
  return ended;
}

const label = ({ item, platform }) => (platform === null ? item : `${item} ${platform}`);

/**
 * @param {object} verdicts `{ build: { android, ios }, S1: …, S3: { android }, …,
 *   S7: { android, ios, processEnded: { android, ios } }, capture: …, licence }`
 * @returns {{ recommendation: 'GO' | 'NO-GO', items: object[], findings: object[],
 *   open: object[], text: string }}
 */
export function goNoGo(verdicts) {
  const items = [];
  const findings = [];
  const open = [];
  let noGo = false;
  for (const { item, platforms, deciding } of ITEMS) {
    for (const platform of platforms) {
      const verdict = verdictOf(verdicts, item, platform);
      const entry = { item, platform, verdict, deciding };
      items.push(entry);
      if (verdict === NOT_SHOWN) {
        open.push({ item, platform });
      } else if (verdict === FAILED) {
        if (!deciding) {
          findings.push({ item, platform, why: 'failed; it does not decide the SDK' });
        } else if (item === 'S7' && processEnded(verdicts, platform)) {
          findings.push({ item, platform, why: 'failed because the platform ended the process' });
        } else {
          noGo = true;
        }
      }
    }
  }
  const recommendation = noGo ? 'NO-GO' : 'GO';

  const lines = [`Recommendation: ${recommendation}`, '', 'Items:'];
  for (const entry of items) {
    const role = entry.deciding ? 'decides' : 'finding only';
    lines.push(`- ${label(entry)}: ${entry.verdict} (${role})`);
  }
  if (findings.length > 0) {
    lines.push('', 'Findings for the owner:');
    for (const finding of findings) lines.push(`- ${label(finding)}: ${finding.why}`);
  }
  if (open.length > 0) {
    lines.push('', 'Open until L9, the real-device suite (D-041):');
    for (const entry of open) lines.push(`- ${label(entry)}`);
  }
  if (!noGo) lines.push('', 'GO rests on emulator and simulator evidence only.');
  return { recommendation, items, findings, open, text: lines.join('\n') };
}
