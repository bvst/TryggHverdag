// SPIKE-01-AC14: renders the summary and the numbers of the results document
// from the analysis's output. Pure.
//
// The repository is public, so the whole input is checked before anything is
// written: a number shaped like a coordinate or a phone number is refused, and
// the refusal names where it was, never what it was.

const NOT_SHOWN = 'not shown on simulators';
const VERDICTS = new Set(['passed', 'failed', NOT_SHOWN]);

/**
 * Coordinate-shaped: 4 or more decimals, with an absolute value of 180 or
 * less. Degrees are written like that; the analysis's own figures are rounded
 * to fewer decimals, and a share is written as a percentage.
 */
const DECIMAL = /(\d+)\.(\d+)/g;
/** Phone-shaped: 8 or more digits, with an optional plus and single spaces between. */
const PHONE = /\+?\d(?: ?\d){7,}/;

function coordinateShaped(text) {
  for (const [, whole, decimals] of text.matchAll(DECIMAL)) {
    if (decimals.length >= 4 && Number(whole) <= 180) return true;
  }
  return false;
}

/** Throws if any string or number anywhere in `value` looks like a coordinate or phone number. */
function checkForPersonalData(value, path) {
  if (typeof value === 'number' || typeof value === 'string') {
    // `String` of a number is how it would be written, so that is what is checked.
    const text = String(value);
    if (coordinateShaped(text)) {
      throw new Error(`refused: ${path} holds a number shaped like a coordinate`);
    }
    if (PHONE.test(text))
      throw new Error(`refused: ${path} holds a number shaped like a phone number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => checkForPersonalData(item, `${path}[${i}]`));
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) checkForPersonalData(item, `${path}.${key}`);
  }
}

/** Text for one table cell: no pipes or line breaks that would break the table. */
const cellText = (value) =>
  String(value)
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ');

const isCount = (value) => Number.isInteger(value) && value >= 0;

/** One platform's summary cell. `null` means the scenario does not apply there (S3 on iOS). */
function verdictCell(cell, where) {
  if (cell === null) return 'not applicable';
  if (!VERDICTS.has(cell?.verdict)) {
    throw new Error(`${where}: the verdict must be passed, failed or ${NOT_SHOWN}`);
  }
  if (!isCount(cell.valid) || !isCount(cell.invalid)) {
    throw new Error(`${where}: the counts of valid and invalid runs are missing`);
  }
  const runs = `${cell.valid} valid, ${cell.invalid} invalid`;
  if (cell.verdict === NOT_SHOWN) return `${NOT_SHOWN} (${runs}); to be shown at L9 (D-041)`;
  return `${cell.verdict} (${runs})`;
}

function numberRow(number, i) {
  const where = `numbers[${i}]`;
  for (const field of ['scenario', 'platform', 'run', 'name']) {
    if (typeof number?.[field] !== 'string' || number[field].trim() === '') {
      throw new Error(`${where}: every number needs its ${field}`);
    }
  }
  if (typeof number.value !== 'number' || !Number.isFinite(number.value)) {
    throw new Error(`${where}: the value must be a finite number`);
  }
  if (number.unit !== undefined && typeof number.unit !== 'string') {
    throw new Error(`${where}: the unit must be text`);
  }
  const value = number.unit ? `${number.value} ${number.unit}` : String(number.value);
  const cells = [number.scenario, number.platform, number.name, value, number.run];
  return `| ${cells.map(cellText).join(' | ')} |`;
}

/**
 * @param {{ summary: { scenario: string, outsideGoNoGo?: boolean,
 *   android: { verdict: string, valid: number, invalid: number } | null,
 *   ios: { verdict: string, valid: number, invalid: number } | null }[],
 *   numbers: { scenario: string, platform: string, run: string, name: string,
 *   value: number, unit?: string }[] }} input
 * @returns {string} Markdown: the summary table, then the numbers table.
 */
export function renderResults(input) {
  checkForPersonalData(input, 'input');
  const { summary, numbers } = input ?? {};
  if (!Array.isArray(summary) || !Array.isArray(numbers)) {
    throw new Error('the input needs a summary and a list of numbers');
  }
  const lines = [
    '## Summary',
    '',
    '| Scenario | Android emulator | iOS simulator | Notes |',
    '|----------|------------------|---------------|-------|',
  ];
  summary.forEach((row, i) => {
    if (typeof row?.scenario !== 'string' || row.scenario.trim() === '') {
      throw new Error(`summary[${i}]: the scenario is missing`);
    }
    const android = verdictCell(row.android, `${row.scenario} on Android`);
    const ios = verdictCell(row.ios, `${row.scenario} on iOS`);
    const notes = row.outsideGoNoGo === true ? 'Outside the go/no-go' : '';
    lines.push(`| ${[row.scenario, android, ios, notes].map(cellText).join(' | ')} |`);
  });
  lines.push(
    '',
    '## Numbers',
    '',
    '| Scenario | Platform | What | Value | Run |',
    '|----------|----------|------|-------|-----|',
    ...numbers.map(numberRow),
  );
  return `${lines.join('\n')}\n`;
}
