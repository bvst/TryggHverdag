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
