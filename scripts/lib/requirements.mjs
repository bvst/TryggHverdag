// RG-01: every requirement has at least one test that names it.
//
// The plan is the source of truth. Requirement IDs are parsed out of it rather
// than kept in a second list, because a second list is a list that goes stale.

/** Where the requirements live, and how they are written there. */
export const SOURCES = [
  { file: 'docs/plan/01b-mvp-scope.md', kind: 'story' },
  { file: 'docs/plan/03-safety-reliability-security.md', kind: 'rules', prefixes: ['REL', 'SEC'] },
  { file: 'docs/plan/02-norway-law-privacy.md', kind: 'rules', prefixes: ['PRIV'] },
  { file: 'docs/plan/05-architecture.md', kind: 'rules', prefixes: ['SM'] },
];

const STORY = /^\*\*(?<id>[A-Z]{3,5}-\d+)\s*·\s*(?<title>[^*]+?)\*\*(?<rest>.*)$/;

/** Stories from the MVP scope: `**LOST-02 · Lost contact** (Must)`. */
export function parseStories(markdown) {
  const found = [];
  for (const line of markdown.split('\n')) {
    const match = STORY.exec(line.trim());
    if (match?.groups === undefined) {
      continue;
    }
    const { id, title, rest } = match.groups;
    found.push({
      id,
      title: title.trim(),
      priority: priorityOf(rest),
    });
  }
  return found;
}

function priorityOf(rest) {
  if (/⛔|\bParked\b/.test(rest)) {
    return 'parked';
  }
  if (/\(Must/.test(rest)) {
    return 'must';
  }
  if (/\(Should/.test(rest)) {
    return 'should';
  }
  return 'unstated';
}

/** Rules from a table: `| SM-01 | One active journey per walker. |`. */
export function parseRules(markdown, prefixes) {
  const pattern = new RegExp(
    `^\\|\\s*(?<id>(?:${prefixes.join('|')})-\\d+)\\s*\\|\\s*(?<title>[^|]+?)\\s*\\|`,
  );
  const found = [];
  const seen = new Set();
  for (const line of markdown.split('\n')) {
    const match = pattern.exec(line.trim());
    if (match?.groups === undefined || seen.has(match.groups.id)) {
      continue;
    }
    seen.add(match.groups.id);
    found.push({ id: match.groups.id, title: firstSentence(match.groups.title), priority: 'must' });
  }
  return found;
}

function firstSentence(text, max = 110) {
  const sentence = text.split(/(?<=\.)\s/)[0] ?? text;
  return sentence.length > max ? sentence.slice(0, max - 1).trimEnd() + '…' : sentence;
}

/** Every requirement, from every source. `read` returns a file's text or null. */
export function collectRequirements(read, sources = SOURCES) {
  const all = [];
  for (const source of sources) {
    const markdown = read(source.file);
    if (markdown === null) {
      continue;
    }
    const found =
      source.kind === 'story' ? parseStories(markdown) : parseRules(markdown, source.prefixes);
    all.push(...found.map((requirement) => ({ ...requirement, source: source.file })));
  }
  return all;
}

/**
 * A test file that only *quotes* requirement IDs — the tests of the gates
 * themselves use real IDs as sample data — says so with this marker, so the
 * report never counts sample data as coverage. Over-reporting coverage is worse
 * than under-reporting it: it is the kind of quiet false confidence this
 * project exists to avoid.
 */
export const FIXTURES_MARKER = 'req-coverage: fixtures-only';

export function isFixturesOnly(text) {
  return text.includes(FIXTURES_MARKER);
}

/** True when the text names this requirement (and not a longer ID that contains it). */
export function mentions(text, id) {
  return new RegExp(`(?<![A-Z0-9-])${id}(?![0-9])`).test(text);
}

/**
 * Which tests name which requirement.
 *
 * @param {{id: string}[]} requirements
 * @param {{file: string, text: string}[]} testFiles
 * @param {{file: string, text: string}[]} specFiles
 */
export function coverage(requirements, testFiles, specFiles = []) {
  const counted = testFiles.filter((f) => !isFixturesOnly(f.text));
  return requirements.map((requirement) => ({
    ...requirement,
    tests: counted.filter((f) => mentions(f.text, requirement.id)).map((f) => f.file),
    specs: specFiles.filter((f) => mentions(f.text, requirement.id)).map((f) => f.file),
  }));
}

/** ⚪ nothing yet · 📝 a spec but no test · 🟢 at least one test names it. */
export function statusOf(row) {
  if (row.tests.length > 0) {
    return '🟢';
  }
  return row.specs.length > 0 ? '📝' : '⚪';
}

/**
 * Requirements that this branch touches but no test names. `changedText` is the
 * content of the changed files that are not tests.
 */
export function uncoveredInChanges(rows, changedText) {
  return rows.filter(
    (row) => row.priority !== 'parked' && row.tests.length === 0 && mentions(changedText, row.id),
  );
}

/** Where acceptance criteria are written: one spec per requirement. */
export const SPECS_DIR = 'docs/specs/';

/**
 * The written way out for a criterion that truly cannot be automated (D-082):
 * a spec line `req-coverage: not automated <ID>-ACn: <reason>`. Only a real
 * criterion makes it a line, so a spec can describe the form with placeholders.
 */
const NOT_AUTOMATED = /^req-coverage: not automated ([A-Z][A-Z0-9]*-\d+-AC\d+):(.*)$/;

/**
 * Every not-automated line in these specs, with its reason trimmed: '' when
 * there is none, which lets nothing through.
 *
 * @param {{file: string, text: string}[]} specFiles
 * @returns {{file: string, criterion: string, reason: string}[]}
 */
export function notAutomatedLines(specFiles) {
  return specFiles.flatMap(({ file, text }) =>
    text.split('\n').flatMap((line) => {
      const match = NOT_AUTOMATED.exec(line.trim());
      return match === null ? [] : [{ file, criterion: match[1], reason: match[2].trim() }];
    }),
  );
}

/**
 * Acceptance criteria (`<ID>-ACn`) that a changed spec names, for a live
 * requirement, and no counted test names exactly (D-082). A requirement that
 * already has a test does not carry a new criterion through; that spec's own
 * not-automated line, with a reason, does. Each criterion is listed once, with
 * the spec it was found in.
 *
 * @param {{id: string, priority: string}[]} rows
 * @param {{file: string, text: string}[]} changedFiles
 * @param {{file: string, text: string}[]} testFiles
 * @returns {{criterion: string, file: string}[]}
 */
export function uncoveredCriteria(rows, changedFiles, testFiles) {
  const live = rows.filter((row) => row.priority !== 'parked');
  const counted = testFiles.filter((f) => !isFixturesOnly(f.text));
  const found = new Map();
  for (const spec of changedFiles.filter((f) => f.file.startsWith(SPECS_DIR))) {
    const excused = notAutomatedLines([spec])
      .filter((line) => line.reason !== '')
      .map((line) => line.criterion);
    for (const row of live) {
      for (const [criterion] of spec.text.matchAll(
        new RegExp(`(?<![A-Z0-9-])${row.id}-AC\\d+`, 'g'),
      )) {
        if (
          !found.has(criterion) &&
          !excused.includes(criterion) &&
          !counted.some((f) => mentions(f.text, criterion))
        ) {
          found.set(criterion, spec.file);
        }
      }
    }
  }
  return [...found].map(([criterion, file]) => ({ criterion, file }));
}

/**
 * What RG-01 refuses in a change, one line each, in this order: a requirement
 * the change touches that no test names; a criterion a changed spec names that
 * no test names, since a requirement with a test does not carry a new
 * criterion through; and a not-automated line with no reason, which lets
 * nothing through (D-082). Empty when nothing is refused.
 *
 * @param {{
 *   rows: ReturnType<typeof coverage>,
 *   changed: {file: string, text: string}[],
 *   testFiles: {file: string, text: string}[],
 *   notAutomated: ReturnType<typeof notAutomatedLines>,
 * }} change `changed`: the changed files that can implement a requirement, read
 * @returns {string[]}
 */
export function rg01Refusals({ rows, changed, testFiles, notAutomated }) {
  return [
    ...uncoveredInChanges(rows, changed.map((f) => f.text).join('\n')).map(
      (row) => `${row.id} — ${row.title}: no test names it`,
    ),
    ...uncoveredCriteria(rows, changed, testFiles).map(
      ({ criterion, file }) => `${criterion}, in ${file}: no test names it`,
    ),
    ...notAutomated
      .filter((line) => line.reason === '')
      .map(
        ({ criterion, file }) => `${criterion}, in ${file}: its not-automated line gives no reason`,
      ),
  ];
}

/** What req:coverage prints when RG-01 refuses: how many, each one, and how to make it pass. */
export function rg01Message(refusals) {
  return (
    `\nRG-01: this branch leaves ${String(refusals.length)} requirement(s) or acceptance criteria uncovered:\n` +
    refusals.map((line) => `  ${line}`).join('\n') +
    '\n\nWrite the failing test first, naming it (RG-02). If one truly cannot be tested ' +
    'automatically, say why: for a requirement, in the pull request; for a criterion, in its ' +
    'spec, on a line of its own: "req-coverage: not automated <ID>-ACn: <reason>".\n'
  );
}

/**
 * One line per criterion a spec lets through untested, with its reason
 * quoted, so an empty one shows as "" (D-082). req:coverage prints them on
 * every run, changed or not.
 *
 * @param {ReturnType<typeof notAutomatedLines>} notAutomated
 * @returns {string[]}
 */
export function notAutomatedNotices(notAutomated) {
  return notAutomated.map(
    ({ file, criterion, reason }) =>
      `req:coverage: ${criterion} is not automated (${file}): "${reason}"`,
  );
}

/**
 * The generated report. Nobody edits it by hand; `pnpm run req:coverage` writes
 * it, and CI regenerates it and fails if the committed copy differs.
 *
 * Deliberately a pure function of the rows: no date, no clock (AR-03). Stamping
 * the generation date in here would make that CI check go red at midnight every
 * night, for a reason nobody changed — and the fix would last until the next
 * midnight. Git already records when the file last changed.
 */
export function renderStatus(rows) {
  const covered = rows.filter((row) => row.tests.length > 0).length;
  const live = rows.filter((row) => row.priority !== 'parked');
  const lines = [
    '# Requirement status',
    '',
    'Generated by `pnpm run req:coverage` — do not edit by hand.',
    '',
    `${String(covered)} of ${String(live.length)} live requirements have at least one test that names them (RG-01).`,
    '',
    'Status: ⚪ no spec and no test · 📝 a spec, no test yet · 🟢 at least one test names it.',
    "Whether those tests pass is CI's answer, not this file's (INF-04 adds it).",
    '',
    '| ID | Requirement | Priority | Status | Tests |',
    '|----|-------------|----------|--------|-------|',
  ];
  for (const row of rows) {
    const priority = row.priority === 'parked' ? '⛔ parked' : row.priority;
    lines.push(
      `| ${row.id} | ${row.title} | ${priority} | ${statusOf(row)} | ${String(row.tests.length)} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
