// BUG-39: agents are sent to docs/plan/decisions.md, over 4,400 lines, to read
// one decision. `pnpm run decision D-119 [D-068 ...]` prints each decision's
// section in full instead: from its `## D-NNN — …` heading up to the next
// `## ` heading, amendments and `### ` sub-headings included, in the order
// asked. An ID with no section fails loudly; the ones found are still printed.
//
// A section, exactly: its lines from the heading to the line before the next
// `## ` heading (or the end of the file), without the blank lines that
// separate it from what follows. `decisionSections(text, ids)` returns
// `{ sections, missing }`: the sections in the order asked, and the IDs that
// have none. A number two decisions share (D-060 is one) brings back both, in
// file order: printing one of two would hide the other.
//
// The pure function is tested on a synthetic log; main() is run as
// `pnpm run decision` runs it, from the repository root, on the real one.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'decision.mjs');
const DECISIONS = readFileSync(path.join(ROOT, 'docs', 'plan', 'decisions.md'), 'utf8');

/** The module, loaded when a test asks, so a missing one fails that test and says so. */
async function load() {
  expect(existsSync(SCRIPT), 'scripts/decision.mjs does not exist').toBe(true);
  return import(pathToFileURL(SCRIPT).href);
}

/** Runs the script as `pnpm run decision` does, from the repository root. */
const run = (args) =>
  spawnSync(process.execPath, ['scripts/decision.mjs', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  });

/** Everything a failed expectation needs to say what the script did. */
const told = (result) =>
  [
    `exit code ${String(result.status)}`,
    `stdout:\n${result.stdout ?? ''}`,
    `stderr:\n${result.stderr ?? ''}`,
  ].join('\n');

// ---------------------------------------------------------------------------
// A synthetic log: three decisions, one amended and with a sub-heading, then a
// `## ` heading that is not a decision
// ---------------------------------------------------------------------------

const FIRST = [
  '## D-901 — The first synthetic decision',
  '- **Date:** 2026-01-01 · **Status:** Accepted',
  '- **Decision:** One thing.',
].join('\n');
const SECOND = [
  '## D-902 — The second synthetic decision, amended',
  '- **Date:** 2026-01-02 · **Status:** Accepted',
  '- **Decision:** Another thing. Supersedes D-905.',
  '- **Amended 2026-01-03 (owner):** The amendment belongs to D-902.',
  '',
  '### A sub-heading inside D-902',
  'Still part of D-902: only a `## ` heading ends a section.',
].join('\n');
const THIRD = ['## D-903 — The third synthetic decision', '- **Decision:** The last one.'].join(
  '\n',
);
const LOG = [
  '# Decision log (synthetic)',
  '',
  'Accepted decisions are binding.',
  '',
  '---',
  '',
  FIRST,
  '',
  SECOND,
  '',
  THIRD,
  '',
  '## Notes that are not a decision',
  'Not part of D-903.',
  '',
].join('\n');

describe('BUG-39: decisionSections(text, ids), the pure half', () => {
  test('BUG-39: returns each section exactly, amendment and sub-heading included, in the order asked', async () => {
    const { decisionSections } = await load();

    expect(decisionSections(LOG, ['D-903', 'D-901', 'D-902'])).toEqual({
      sections: [THIRD, FIRST, SECOND],
      missing: [],
    });
  });

  test('BUG-39: an ID with no heading is missing, even when another decision mentions it; the ones found still come back', async () => {
    const { decisionSections } = await load();

    expect(decisionSections(LOG, ['D-902', 'D-999', 'D-905'])).toEqual({
      sections: [SECOND],
      missing: ['D-999', 'D-905'],
    });
  });

  test('BUG-39: a number two decisions share brings back both sections, in file order', async () => {
    const { decisionSections } = await load();
    const once = ['## D-904 — One number, first use', 'First.'].join('\n');
    const again = ['## D-904 — One number, second use', 'Second.'].join('\n');

    expect(decisionSections([once, '', again, ''].join('\n'), ['D-904'])).toEqual({
      sections: [once, again],
      missing: [],
    });
  });
});

// ---------------------------------------------------------------------------
// The real log
// ---------------------------------------------------------------------------

/**
 * The real log's decision sections, worked out here without the script: each
 * `## D-NNN` heading up to the next `## ` heading, trailing blank lines dropped.
 */
function sectionsOf(text) {
  const lines = text.split('\n');
  const headings = lines.flatMap((line, at) => (line.startsWith('## ') ? [at] : []));
  return headings
    .filter((at) => /^## D-\d{3}\b/.test(lines[at] ?? ''))
    .map((at) => {
      const next = headings.find((later) => later > at) ?? lines.length;
      return {
        id: /^## (?<id>D-\d{3})/.exec(lines[at] ?? '')?.groups?.id ?? '',
        heading: lines[at] ?? '',
        text: lines.slice(at, next).join('\n').trimEnd(),
      };
    });
}

const REAL = sectionsOf(DECISIONS);
const FIRST_REAL = REAL[0];
const LAST_REAL = REAL.at(-1);

describe('BUG-39: the real docs/plan/decisions.md', () => {
  test('BUG-39: every `## D-` heading in the file is found, and each section comes back exactly', async () => {
    const { decisionSections } = await load();
    const ids = [...new Set(REAL.map((section) => section.id))];

    expect(REAL.length).toBeGreaterThan(100);
    expect(decisionSections(DECISIONS, ids)).toEqual({
      sections: REAL.map((section) => section.text),
      missing: [],
    });
  });

  test('BUG-39: `decision D-001` prints D-001 in full, starting with its own heading, and exits 0', () => {
    const result = run(['D-001']);

    expect(FIRST_REAL?.id).toBe('D-001');
    expect(result.status, told(result)).toBe(0);
    expect(result.stdout.startsWith(`${FIRST_REAL?.heading ?? ''}\n`), told(result)).toBe(true);
    expect(result.stdout.trim(), told(result)).toBe(FIRST_REAL?.text);
  });

  test('BUG-39: the last decision and D-001, asked in that order, are printed in that order, each in full', () => {
    const result = run([LAST_REAL?.id ?? '', 'D-001']);
    const last = result.stdout.indexOf(LAST_REAL?.text ?? '');
    const first = result.stdout.indexOf(FIRST_REAL?.text ?? '');

    expect(result.status, told(result)).toBe(0);
    expect(result.stdout.startsWith(`${LAST_REAL?.heading ?? ''}\n`), told(result)).toBe(true);
    expect({ last, first }, told(result)).toEqual({
      last: 0,
      first: expect.any(Number),
    });
    expect(first, told(result)).toBeGreaterThan(last);
  });
});

// ---------------------------------------------------------------------------
// main(): failing loudly, and pnpm's argv
// ---------------------------------------------------------------------------

const NOT_AN_ID = ['D-1', '119', 'd-119', 'D-0119', 'D-119x', '--all'];

describe('BUG-39: main(), run as `pnpm run decision` runs it', () => {
  test('BUG-39: an unknown ID fails loudly: exit 1, the ID named on stderr, and the decision that exists still printed', () => {
    const result = run(['D-001', 'D-999']);

    expect(result.status, told(result)).toBe(1);
    expect(result.stderr, told(result)).toContain('D-999');
    expect(result.stdout, told(result)).toContain(FIRST_REAL?.text ?? '');
  });

  test('BUG-39: no ID at all: exit 1 with a usage line, and nothing printed', () => {
    const result = run([]);

    expect(result.stderr, told(result)).toMatch(/usage/i);
    expect(result.stdout, told(result)).toBe('');
    expect(result.status, told(result)).toBe(1);
  });

  test.each(NOT_AN_ID)(
    'BUG-39: an argument that is not D- and three digits, %s: exit 1 with a usage line, and nothing printed',
    (arg) => {
      const result = run([arg]);

      expect(result.stderr, told(result)).toMatch(/usage/i);
      expect(result.stdout, told(result)).toBe('');
      expect(result.status, told(result)).toBe(1);
    },
  );

  test('BUG-39: a literal -- in argv, which pnpm 10 passes through, is ignored', () => {
    const result = run(['--', 'D-001']);

    expect(result.status, told(result)).toBe(0);
    expect(result.stderr, told(result)).toBe('');
    expect(result.stdout.trim(), told(result)).toBe(FIRST_REAL?.text);
  });
});

describe('BUG-39: how agents reach it', () => {
  test('BUG-39: package.json has a decision script that runs scripts/decision.mjs', () => {
    const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;

    expect(scripts.decision).toBe('node scripts/decision.mjs');
  });

  test('BUG-39: CLAUDE.md names pnpm run decision', () => {
    const claude = readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');

    expect(claude.includes('pnpm run decision'), 'CLAUDE.md does not name it').toBe(true);
  });
});
