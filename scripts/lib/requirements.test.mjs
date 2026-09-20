// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// RG-01 is how this project measures progress, so the parsing has to match the
// plan as it is actually written — the samples below are copied from it.
import { describe, expect, test } from 'vitest';
import {
  collectRequirements,
  coverage,
  mentions,
  parseRules,
  parseStories,
  renderStatus,
  statusOf,
  uncoveredInChanges,
} from './requirements.mjs';

const SCOPE = `
## GRP — Group and setup

**GRP-01 · Join by invitation** (Must)
As an invited person, I can join the group from an invitation.

**JRN-07 · Automatic arrival** — ⛔ Parked (D-011). Journeys end with
"I'm home" (JRN-05).

**HELP-01 · What a responder should do** (Should)
`;

const RULES = `
| ID | Rule |
|----|------|
| SM-01 | One active journey per walker. Calling #1 during a journey adds #1 to it (CALL-03). |
| SM-05 | The 2-hour automatic stop never ends a journey that is in LOST_CONTACT. |
`;

describe('parseStories', () => {
  test('finds the ID, the title and whether it is in the MVP', () => {
    expect(parseStories(SCOPE)).toEqual([
      { id: 'GRP-01', title: 'Join by invitation', priority: 'must' },
      { id: 'JRN-07', title: 'Automatic arrival', priority: 'parked' },
      { id: 'HELP-01', title: 'What a responder should do', priority: 'should' },
    ]);
  });

  test('ignores ordinary prose that mentions an ID', () => {
    expect(parseStories('Sharing ends like any journey (JRN-05, JRN-06).')).toEqual([]);
  });
});

describe('parseRules', () => {
  test('reads a rule table and keeps the first sentence as the title', () => {
    const rules = parseRules(RULES, ['SM']);
    expect(rules.map((rule) => rule.id)).toEqual(['SM-01', 'SM-05']);
    expect(rules[0]?.title).toBe('One active journey per walker.');
  });

  test('skips the header row and repeated mentions', () => {
    expect(parseRules(RULES + RULES, ['SM']).length).toBe(2);
  });
});

describe('collectRequirements', () => {
  test('reads every source, and survives one that is missing', () => {
    const read = (file) =>
      file.includes('01b') ? SCOPE : file.includes('05-architecture') ? RULES : null;
    const ids = collectRequirements(read).map((requirement) => requirement.id);
    expect(ids).toContain('GRP-01');
    expect(ids).toContain('SM-01');
  });
});

describe('mentions', () => {
  test('matches a test that names the requirement', () => {
    expect(mentions("test('LOST-02-AC1: opens an alert')", 'LOST-02')).toBe(true);
  });

  test('does not confuse LOST-2 with LOST-20', () => {
    expect(mentions("test('LOST-20-AC1')", 'LOST-2')).toBe(false);
  });
});

describe('coverage and status', () => {
  const requirements = [
    { id: 'LOST-02', title: 'Lost contact', priority: 'must' },
    { id: 'LOST-05', title: 'Battery warning', priority: 'must' },
    { id: 'JRN-07', title: 'Automatic arrival', priority: 'parked' },
  ];
  const tests = [{ file: 'apps/server/src/lost.test.ts', text: "test('LOST-02-AC1: …')" }];
  const specs = [{ file: 'docs/specs/LOST-05.md', text: '# LOST-05' }];
  const rows = coverage(requirements, tests, specs);

  test('a requirement with a test is covered', () => {
    expect(statusOf(rows[0])).toBe('🟢');
    expect(rows[0]?.tests).toEqual(['apps/server/src/lost.test.ts']);
  });

  test('a requirement with only a spec is not', () => {
    expect(statusOf(rows[1])).toBe('📝');
  });

  test('a requirement with neither is plainly empty', () => {
    expect(statusOf(rows[2])).toBe('⚪');
  });

  test('the report counts live requirements, not parked ones', () => {
    const markdown = renderStatus(rows, { date: '2026-09-20' });
    expect(markdown).toContain('1 of 2 live requirements');
    expect(markdown).toContain('| LOST-02 | Lost contact | must | 🟢 | 1 |');
    expect(markdown).toContain('⛔ parked');
  });

  test('changed work on an untested requirement is what blocks CI', () => {
    const changed = 'export function batteryWarning() {} // LOST-05';
    expect(uncoveredInChanges(rows, changed).map((row) => row.id)).toEqual(['LOST-05']);
  });

  test('a parked requirement never blocks', () => {
    expect(uncoveredInChanges(rows, 'JRN-07 is parked')).toEqual([]);
  });

  test('a covered requirement never blocks', () => {
    expect(uncoveredInChanges(rows, 'LOST-02 handling')).toEqual([]);
  });
});
