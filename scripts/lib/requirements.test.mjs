// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// RG-01 is how this project measures progress, so the parsing has to match the
// plan as it is actually written — the samples below are copied from it.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FIXTURES_MARKER,
  collectRequirements,
  coverage,
  mentions,
  notAutomatedLines,
  notAutomatedNotices,
  parseRules,
  parseStories,
  renderStatus,
  rg01Message,
  rg01Refusals,
  statusOf,
  uncoveredCriteria,
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
    const markdown = renderStatus(rows);
    expect(markdown).toContain('1 of 2 live requirements');
    expect(markdown).toContain('| LOST-02 | Lost contact | must | 🟢 | 1 |');
    expect(markdown).toContain('⛔ parked');
  });

  test('the same repository always renders the same report (AR-03)', () => {
    // CI regenerates this file and fails if the committed copy differs. If the
    // report carried the date it was generated on, that check would go red at
    // midnight every night, for a reason nobody changed — and a gate that cries
    // wolf daily is a gate that stops being read. Git already records when the
    // file last changed.
    expect(renderStatus(rows)).toBe(renderStatus(rows));
    expect(renderStatus(rows)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
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

// INF-10-AC15 (D-082): with --fail-on-uncovered-changed, req:coverage checks
// each acceptance criterion a changed spec names, not only its requirement: a
// requirement that already has one test no longer carries a new criterion
// through. The IDs below are synthetic. DEMO-01 to DEMO-03 stand for tracked
// stories; INF-99, CI-99 and HK-99 carry untracked prefixes, as INF, CI and HK
// are (D-074).
//
// What these tests expect of requirements.mjs:
//
//   uncoveredCriteria(rows, changedFiles, testFiles) → [{ criterion, file }]
//     each criterion (`<ID>-ACn`) that a changed file under docs/specs/ names,
//     for a requirement in `rows` that is not parked, which no counted test
//     names exactly, and which no not-automated line with a reason, in that
//     same spec, lets through. Listed once each, with the spec it is in.
//   notAutomatedLines(specFiles) → [{ file, criterion, reason }]
//     every `req-coverage: not automated <ID>-ACn: <reason>` line, the reason
//     trimmed, and '' when there is none.

/** How a spec writes the way out for a criterion that cannot be automated. */
const NOT_AUTOMATED = 'req-coverage: not automated';
const REASON = 'needs a person to hold the phone';

describe('INF-10-AC15: each criterion a changed spec names', () => {
  const rows = coverage(
    [
      { id: 'DEMO-01', title: 'A synthetic story', priority: 'must' },
      { id: 'DEMO-02', title: 'Another synthetic story', priority: 'should' },
      { id: 'DEMO-03', title: 'A parked synthetic story', priority: 'parked' },
    ],
    [],
  );
  const spec = (text, file = 'docs/specs/DEMO-01.md') => ({ file, text });
  const tests = (text, file = 'apps/server/src/demo.test.ts') => ({ file, text });
  const uncovered = (changed, testFiles) =>
    uncoveredCriteria(rows, changed, testFiles).map((each) => each.criterion);

  test('INF-10-AC15: a criterion a changed spec names, and no counted test names, blocks, with the spec it is in', () => {
    const changed = [spec('**DEMO-01-AC1** — one.\n**DEMO-01-AC2** — two.\n')];
    const found = uncoveredCriteria(rows, changed, [tests('names DEMO-01-AC1')]);

    expect(found.map((each) => each.criterion)).toEqual(['DEMO-01-AC2']);
    expect(found[0]?.file).toBe('docs/specs/DEMO-01.md');
  });

  test('INF-10-AC15: AC1 is not AC10, either way round', () => {
    const changed = [spec('DEMO-01-AC1 and DEMO-01-AC10')];

    expect(uncovered(changed, [tests('names DEMO-01-AC10')])).toEqual(['DEMO-01-AC1']);
    expect(uncovered(changed, [tests('names DEMO-01-AC1')])).toEqual(['DEMO-01-AC10']);
  });

  test('INF-10-AC15: a fixtures-only test that names the criterion does not count', () => {
    const changed = [spec('DEMO-01-AC2')];

    expect(uncovered(changed, [tests(`// ${FIXTURES_MARKER}\nnames DEMO-01-AC2`)])).toEqual([
      'DEMO-01-AC2',
    ]);
  });

  test('INF-10-AC15: each criterion is listed once, however often its spec names it', () => {
    expect(uncovered([spec('DEMO-01-AC2, then DEMO-01-AC2 again')], [])).toEqual(['DEMO-01-AC2']);
  });

  test('INF-10-AC15: criteria of untracked IDs never block (D-074)', () => {
    const changed = [spec('INF-99-AC1, CI-99-AC2 and HK-99-AC3', 'docs/specs/INF-99.md')];

    expect(uncovered(changed, [])).toEqual([]);
  });

  test("INF-10-AC15: a parked requirement's criteria never block", () => {
    expect(uncovered([spec('DEMO-03-AC1', 'docs/specs/DEMO-03.md')], [])).toEqual([]);
  });

  test('INF-10-AC15: only specs are read for criteria: the same criterion in changed code or plans blocks nothing', () => {
    const changed = [
      { file: 'apps/server/src/demo.ts', text: '// DEMO-01-AC5' },
      { file: 'docs/plan/10-roadmap.md', text: 'DEMO-01-AC6' },
    ];

    expect(uncovered(changed, [])).toEqual([]);
  });

  test('INF-10-AC15: the requirement report does not change: criteria in specs and tests leave it as it was', () => {
    const requirements = [{ id: 'DEMO-01', title: 'A synthetic story', priority: 'must' }];
    const testFiles = [tests('names DEMO-01-AC1')];
    const plain = renderStatus(coverage(requirements, testFiles, [spec('# DEMO-01')]));
    const named = renderStatus(
      coverage(requirements, testFiles, [spec('# DEMO-01\n**DEMO-01-AC1**\n**DEMO-01-AC2**\n')]),
    );

    expect(named).toBe(plain);
    expect(named).not.toMatch(/-AC\d/);
  });

  test('INF-10-AC15: the not-automated line lets its criterion through, and is read with its reason', () => {
    const text = `**DEMO-01-AC2** — two.\n\n${NOT_AUTOMATED} DEMO-01-AC2: ${REASON}\n`;

    expect(uncovered([spec(text)], [])).toEqual([]);
    expect(notAutomatedLines([spec(text)])).toEqual([
      { file: 'docs/specs/DEMO-01.md', criterion: 'DEMO-01-AC2', reason: REASON },
    ]);
  });

  test('INF-10-AC15: the not-automated line lets through only the criterion it names', () => {
    const text = `DEMO-01-AC2 and DEMO-01-AC3\n${NOT_AUTOMATED} DEMO-01-AC2: ${REASON}\n`;

    expect(uncovered([spec(text)], [])).toEqual(['DEMO-01-AC3']);
  });

  test('INF-10-AC15: a not-automated line with an empty reason lets nothing through, and is read as having none', () => {
    for (const blank of ['', '   ']) {
      const text = `DEMO-01-AC2\n${NOT_AUTOMATED} DEMO-01-AC2:${blank}\n`;

      expect(uncovered([spec(text)], []), JSON.stringify(blank)).toEqual(['DEMO-01-AC2']);
      expect(notAutomatedLines([spec(text)]).map((each) => each.reason)).toEqual(['']);
    }
  });

  test('INF-10-AC15: the form written with placeholders, as a spec explains it, is not a line', () => {
    const prose = `The form is \`${NOT_AUTOMATED} <ID>-ACn: <reason>\`, in plain sight.`;

    expect(notAutomatedLines([spec(prose)])).toEqual([]);
  });

  test('INF-10-AC15: a not-automated line counts only at the start of a line: prose naming a real criterion in that form mid-line excuses nothing', () => {
    const text = [
      '**DEMO-01-AC2** — two.',
      `A spec may write ${NOT_AUTOMATED} DEMO-01-AC2: ${REASON}, and mean it only as an example.`,
      `See \`${NOT_AUTOMATED} DEMO-01-AC2: ${REASON}\` for the form.`,
      '',
    ].join('\n');

    expect(uncovered([spec(text)], [])).toEqual(['DEMO-01-AC2']);
    expect(notAutomatedLines([spec(text)])).toEqual([]);
  });

  test("INF-10-AC15: a not-automated line counts only in the spec that names its criterion: one spec's line never excuses another spec's", () => {
    const excusing = spec(
      `**DEMO-01-AC2** — two.\n${NOT_AUTOMATED} DEMO-02-AC1: ${REASON}\n`,
      'docs/specs/DEMO-01.md',
    );
    const naming = spec('**DEMO-02-AC1** — one.\n', 'docs/specs/DEMO-02.md');

    for (const changed of [
      [excusing, naming],
      [naming, excusing],
    ]) {
      const found = uncoveredCriteria(rows, changed, []);

      expect(
        found.map((each) => `${each.criterion} in ${each.file}`).sort(),
        changed.map((each) => each.file).join(', then '),
      ).toEqual(['DEMO-01-AC2 in docs/specs/DEMO-01.md', 'DEMO-02-AC1 in docs/specs/DEMO-02.md']);
    }
  });
});

// The same, through the entry script, as the traceability job runs it: in a
// scratch repository, never this one, since req:coverage rewrites the report
// wherever it runs.

const ENTRY = path.join(import.meta.dirname, '..', 'req-coverage.mjs');
const repos = [];

afterEach(() => {
  while (repos.length > 0) rmSync(repos.pop() ?? '', { recursive: true, force: true });
});

/** An environment of the scratch repository's own: no token, no GITHUB_ or CI, no user git config. */
const scratchEnv = (dir) => ({
  PATH: process.env.PATH ?? '',
  HOME: dir,
  LANG: 'C',
  LC_ALL: 'C',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
});

/** Writes `files` (path → text) under `dir`. */
function writeInto(dir, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
}

/** A scratch repository: `base` committed with origin/main at it, and `head` committed on top. */
function repoWith(base, head) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'inf10-req-coverage-')));
  repos.push(dir);
  const git = (...args) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: dir,
      env: scratchEnv(dir),
      stdio: 'pipe',
    });
  git('init', '-q');
  git('symbolic-ref', 'HEAD', 'refs/heads/main');
  writeInto(dir, base);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeInto(dir, head);
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', 'head');
  return dir;
}

/** Runs req:coverage in `dir` with `args`. */
function reqCoverage(dir, ...args) {
  const result = spawnSync(process.execPath, [ENTRY, ...args], {
    cwd: dir,
    env: scratchEnv(dir),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** A synthetic spec for DEMO-01, with these lines. */
const demoSpec = (...lines) => `# DEMO-01 · a synthetic spec\n\n${lines.join('\n')}\n`;

/** A test file naming these criteria: it counts, with no fixtures-only marker. */
const namingTests = (...criteria) =>
  criteria
    .map((id) => `${['te', 'st'].join('')}('${id}: a synthetic check', () => {});`)
    .join('\n');

describe('INF-10-AC15: req:coverage, run as the traceability job runs it', () => {
  const base = {
    'docs/plan/01b-mvp-scope.md': '**DEMO-01 · A synthetic story** (Must)\n',
    'docs/specs/DEMO-01.md': demoSpec('**DEMO-01-AC1** — one.'),
    'apps/server/src/demo.test.ts': namingTests('DEMO-01-AC1'),
  };

  test('INF-10-AC15: with --fail-on-uncovered-changed it exits non-zero, listing each criterion no test names under its RG-01 line', () => {
    const dir = repoWith(base, {
      'docs/specs/DEMO-01.md': demoSpec(
        '**DEMO-01-AC1** — one.',
        '**DEMO-01-AC2** — two.',
        '**DEMO-01-AC3** — three.',
      ),
    });
    const { status, output } = reqCoverage(dir, '--fail-on-uncovered-changed');
    const listed = output.slice(output.indexOf('RG-01:'));

    expect(status, output).not.toBe(0);
    expect(status, output).not.toBeNull();
    expect(output).toContain('RG-01:');
    expect(listed).toContain('DEMO-01-AC2');
    expect(listed).toContain('DEMO-01-AC3');
    expect(listed).not.toContain('DEMO-01-AC1');
  });

  test('INF-10-AC15: it prints every not-automated criterion and its reason on every run, whether or not that spec changed', () => {
    const dir = repoWith(
      {
        ...base,
        'docs/specs/DEMO-01.md': demoSpec(
          '**DEMO-01-AC1** — one.',
          '**DEMO-01-AC4** — four.',
          '',
          `${NOT_AUTOMATED} DEMO-01-AC4: ${REASON}`,
        ),
      },
      { 'apps/server/src/demo.test.ts': `${namingTests('DEMO-01-AC1')}\n// another look, later\n` },
    );

    for (const args of [[], ['--fail-on-uncovered-changed']]) {
      const { status, output } = reqCoverage(dir, ...args);

      expect(status, output).toBe(0);
      expect(output, `run with [${args.join(' ')}]`).toMatch(
        new RegExp(`DEMO-01-AC4[^\\n]*${REASON}`),
      );
    }
  });

  test('INF-10-AC15: it refuses a not-automated line with an empty reason, naming its criterion, even one a test names', () => {
    const dir = repoWith(base, {
      'docs/specs/DEMO-01.md': demoSpec(
        '**DEMO-01-AC1** — one.',
        '',
        `${NOT_AUTOMATED} DEMO-01-AC1:`,
      ),
    });
    const { status, output } = reqCoverage(dir, '--fail-on-uncovered-changed');

    expect(status, output).not.toBe(0);
    expect(status, output).not.toBeNull();
    expect(output).toContain('DEMO-01-AC1');
    expect(output).toMatch(/reason/i);
  });

  test('INF-10-AC15: the report it writes is the same whether a spec names criteria or not', () => {
    const plain = repoWith(
      { ...base, 'docs/specs/DEMO-01.md': demoSpec('A spec for DEMO-01.') },
      {},
    );
    const named = repoWith(base, {
      'docs/specs/DEMO-01.md': demoSpec(
        '**DEMO-01-AC1** — one.',
        '**DEMO-01-AC2** — two.',
        '',
        `${NOT_AUTOMATED} DEMO-01-AC2: ${REASON}`,
      ),
    });
    const report = (dir) => {
      reqCoverage(dir);
      return readFileSync(path.join(dir, 'docs', 'requirements-status.md'), 'utf8');
    };

    expect(report(named)).toBe(report(plain));
  });
});

// INF-10-AC15, in process (RG-04). What RG-01 refuses, the message it prints
// when it does, and the notice for each criterion a spec lets through, decided
// by pure functions here rather than inside req-coverage.mjs's main(): what a
// spawned process runs, the coverage run cannot see. The texts are copied from
// that main() as it printed them when these tests were written.
//
// What these tests expect of requirements.mjs:
//
//   rg01Refusals({ rows, changed, testFiles, notAutomated }) → string[]
//     one line per refusal: each requirement the change touches that no test
//     names, then each criterion a changed spec names that no test names, then
//     each not-automated line with no reason. [] when nothing is refused.
//   rg01Message(refusals) → the text req:coverage prints when RG-01 refuses
//   notAutomatedNotices(notAutomated) → string[], one line per entry, with no
//     trailing newline

/**
 * How RG-01 tells the author to make it pass, copied from req-coverage.mjs's
 * main(). The literal is split in front of "(RG-02)" only so that this file's
 * text holds no "it" followed by a parenthesis, which RG-03 would count as a
 * test; the text itself is the same, character for character.
 */
const RG01_CLOSING =
  '\n\nWrite the failing test first, naming it ' +
  '(RG-02). If one truly cannot be tested ' +
  'automatically, say why: for a requirement, in the pull request; for a criterion, in its ' +
  'spec, on a line of its own: "req-coverage: not automated <ID>-ACn: <reason>".\n';

describe('INF-10-AC15: what RG-01 refuses, and what it says, decided in process', () => {
  const SPEC = 'docs/specs/DEMO-01.md';
  const requirements = [
    { id: 'DEMO-01', title: 'A synthetic story', priority: 'must' },
    { id: 'DEMO-02', title: 'Another synthetic story', priority: 'should' },
    { id: 'DEMO-03', title: 'A parked synthetic story', priority: 'parked' },
  ];
  /** One counted test file, naming DEMO-01's first criterion, and so DEMO-01. */
  const testFiles = [{ file: 'apps/server/src/demo.test.ts', text: 'names DEMO-01-AC1' }];
  const rows = coverage(requirements, testFiles, []);
  const REQUIREMENT_REFUSED = 'DEMO-02 — Another synthetic story: no test names it';
  const CRITERION_REFUSED = `DEMO-01-AC2, in ${SPEC}: no test names it`;

  test('INF-10-AC15: rg01Refusals refuses nothing when every requirement and criterion a change names has a test, and every not-automated line a reason', () => {
    const refusals = rg01Refusals({
      rows,
      changed: [
        { file: SPEC, text: '**DEMO-01-AC1** — one.' },
        { file: 'apps/server/src/parked.ts', text: '// DEMO-03 is parked' },
      ],
      testFiles,
      notAutomated: [{ file: SPEC, criterion: 'DEMO-01-AC4', reason: REASON }],
    });

    expect(refusals).toEqual([]);
  });

  test('INF-10-AC15: rg01Refusals names a requirement the change touches that no test names, with its title', () => {
    const refusals = rg01Refusals({
      rows,
      changed: [{ file: 'apps/server/src/demo.ts', text: '// the DEMO-02 handler' }],
      testFiles,
      notAutomated: [],
    });

    expect(refusals).toEqual([REQUIREMENT_REFUSED]);
  });

  test('INF-10-AC15: rg01Refusals names a criterion a changed spec names that no test names, with the spec it is in', () => {
    const refusals = rg01Refusals({
      rows,
      changed: [{ file: SPEC, text: '**DEMO-01-AC1** — one.\n**DEMO-01-AC2** — two.' }],
      testFiles,
      notAutomated: [],
    });

    expect(refusals).toEqual([CRITERION_REFUSED]);
  });

  test('INF-10-AC15: rg01Refusals refuses a not-automated line that gives no reason, naming its criterion and spec, and lets one with a reason be', () => {
    const refusals = rg01Refusals({
      rows,
      changed: [],
      testFiles,
      notAutomated: [
        { file: SPEC, criterion: 'DEMO-01-AC4', reason: '' },
        { file: 'docs/specs/DEMO-02.md', criterion: 'DEMO-02-AC1', reason: REASON },
      ],
    });

    expect(refusals).toEqual([`DEMO-01-AC4, in ${SPEC}: its not-automated line gives no reason`]);
  });

  test('INF-10-AC15: rg01Refusals lists requirements, then criteria, then not-automated lines with no reason, in that order', () => {
    const refusals = rg01Refusals({
      rows,
      changed: [
        { file: 'apps/server/src/demo.ts', text: '// the DEMO-02 handler' },
        { file: SPEC, text: '**DEMO-01-AC1** — one.\n**DEMO-01-AC2** — two.' },
      ],
      testFiles,
      notAutomated: [{ file: SPEC, criterion: 'DEMO-01-AC1', reason: '' }],
    });

    expect(refusals).toEqual([
      REQUIREMENT_REFUSED,
      CRITERION_REFUSED,
      `DEMO-01-AC1, in ${SPEC}: its not-automated line gives no reason`,
    ]);
  });

  test('INF-10-AC15: rg01Message is the text req:coverage prints when RG-01 refuses: the count, each refusal indented by two spaces, and how to make it pass', () => {
    expect(rg01Message([REQUIREMENT_REFUSED, CRITERION_REFUSED])).toBe(
      '\nRG-01: this branch leaves 2 requirement(s) or acceptance criteria uncovered:\n' +
        '  DEMO-02 — Another synthetic story: no test names it\n' +
        '  DEMO-01-AC2, in docs/specs/DEMO-01.md: no test names it' +
        RG01_CLOSING,
    );
  });

  test('INF-10-AC15: rg01Message counts one refusal, or three, the same way, keeping their order', () => {
    const three = rg01Message(['first refusal', 'second refusal', 'third refusal']);

    expect(rg01Message([REQUIREMENT_REFUSED])).toBe(
      '\nRG-01: this branch leaves 1 requirement(s) or acceptance criteria uncovered:\n' +
        '  DEMO-02 — Another synthetic story: no test names it' +
        RG01_CLOSING,
    );
    expect(three.startsWith('\nRG-01: this branch leaves 3 requirement(s) or')).toBe(true);
    expect(three.split('\n').filter((line) => line.startsWith('  '))).toEqual([
      '  first refusal',
      '  second refusal',
      '  third refusal',
    ]);
    expect(three.endsWith(RG01_CLOSING)).toBe(true);
  });

  test('INF-10-AC15: notAutomatedNotices gives one line per not-automated criterion, with its spec and its reason quoted, and no newline', () => {
    const notices = notAutomatedNotices([
      { file: SPEC, criterion: 'DEMO-01-AC4', reason: REASON },
      {
        file: 'docs/specs/DEMO-02.md',
        criterion: 'DEMO-02-AC1',
        reason: 'needs the owner at the door',
      },
    ]);

    expect(notices).toEqual([
      'req:coverage: DEMO-01-AC4 is not automated (docs/specs/DEMO-01.md): "needs a person to hold the phone"',
      'req:coverage: DEMO-02-AC1 is not automated (docs/specs/DEMO-02.md): "needs the owner at the door"',
    ]);
    expect(notAutomatedNotices([])).toEqual([]);
  });

  test('INF-10-AC15: notAutomatedNotices shows an empty reason as "", so the missing reason is in plain sight', () => {
    expect(notAutomatedNotices([{ file: SPEC, criterion: 'DEMO-01-AC4', reason: '' }])).toEqual([
      'req:coverage: DEMO-01-AC4 is not automated (docs/specs/DEMO-01.md): ""',
    ]);
  });
});

// ===========================================================================
// BUG-46 (D-131, as amended): req:coverage --fail-on-uncovered-changed read
// the diff against an origin/main git could not resolve, and passed.
// ===========================================================================

describe('BUG-46: req:coverage with an origin/main git cannot resolve, in a scratch repository (D-131)', () => {
  // With refs/remotes/origin/main removed, changedFiles() dropped the
  // committed diff, so `--fail-on-uncovered-changed` saw no changed spec and
  // passed a commit that adds a criterion no test names (exit 0). With
  // origin/main at the commit before, the same commit failed under RG-01,
  // naming the criterion (exit 1). safety-reviewer found it reading BUG-46's
  // fix, and it was reproduced in a scratch clone on 2026-10-13. D-131, as
  // amended by the owner ("Yes, add it to BUG-46"): it refuses as the other
  // three gates do, exiting 1, naming the base and saying it could not tell.
  //
  // Without the flag, req:coverage reads no diff: it lists files with
  // `git ls-files --cached --others --exclude-standard`, which no base
  // changes, and returns before changedFiles(). Its answer does not depend on
  // the base, so D-131 leaves it as it is, and the last test here pins that.
  // req:coverage takes no --base: the base is changedFiles()'s default.
  const BASE = 'origin/main';
  /** "Could not tell", in D-131's words or close to them. */
  const COULD_NOT_TELL = /\b(could not|cannot|can not|can't) tell\b/i;
  const base = {
    'docs/plan/01b-mvp-scope.md': '**DEMO-01 · A synthetic story** (Must)\n',
    'docs/specs/DEMO-01.md': demoSpec('**DEMO-01-AC1** — one.'),
    'apps/server/src/demo.test.ts': namingTests('DEMO-01-AC1'),
  };
  /** The reproduction's commit: a criterion added to the spec, and no test naming it. */
  const UNCOVERED = {
    'docs/specs/DEMO-01.md': demoSpec('**DEMO-01-AC1** — one.', '**DEMO-01-AC99** — ninety-nine.'),
  };
  /** The same criterion, with a test naming it: nothing for RG-01 to refuse. */
  const COVERED = {
    ...UNCOVERED,
    'apps/server/src/demo.test.ts': namingTests('DEMO-01-AC1', 'DEMO-01-AC99'),
  };

  /** git in a scratch repository, with its own environment. */
  const gitIn = (dir, ...args) =>
    execFileSync('git', args, { cwd: dir, env: scratchEnv(dir), stdio: 'pipe' });

  /** The condition the controls rest on: git finds the merge base with origin/main. */
  function expectResolvable(dir) {
    expect(() => gitIn(dir, 'merge-base', 'HEAD', BASE)).not.toThrow();
  }

  /** Removes origin/main, as in a clone that never fetched it, and checks git can no longer find a merge base with it. */
  function removeOriginMain(dir) {
    gitIn(dir, 'update-ref', '-d', 'refs/remotes/origin/main');
    expect(() => gitIn(dir, 'merge-base', 'HEAD', BASE)).toThrow();
  }

  test('BUG-46: with origin/main resolvable, a committed criterion no test names is refused under RG-01, naming it, as today', () => {
    const dir = repoWith(base, UNCOVERED);
    expectResolvable(dir);

    const { status, output } = reqCoverage(dir, '--fail-on-uncovered-changed');

    expect(status, output).toBe(1);
    expect(output).toContain('RG-01:');
    expect(output.slice(output.indexOf('RG-01:'))).toContain('DEMO-01-AC99');
    expect(output).not.toMatch(COULD_NOT_TELL);
  });

  test('BUG-46: with origin/main resolvable, a committed criterion a test names passes, as today', () => {
    const dir = repoWith(base, COVERED);
    expectResolvable(dir);

    const { status, output } = reqCoverage(dir, '--fail-on-uncovered-changed');

    expect(status, output).toBe(0);
    expect(output).not.toContain('RG-01:');
    expect(output).not.toMatch(COULD_NOT_TELL);
  });

  test('BUG-46: with origin/main gone, the same commit is refused: exit 1, naming origin/main and saying it could not tell, never passing', () => {
    const dir = repoWith(base, UNCOVERED);
    removeOriginMain(dir);

    const { status, output } = reqCoverage(dir, '--fail-on-uncovered-changed');

    expect(status, output).toBe(1);
    expect(output).toContain(BASE);
    expect(output).toMatch(COULD_NOT_TELL);
  });

  test('BUG-46: with origin/main gone, a commit with nothing uncovered is refused as well: it could not tell what the branch changes, so it does not pass', () => {
    // The refusal is about the base, not about what the branch holds: a
    // clone with no origin/main fails loudly instead of passing (D-131's
    // consequences), whatever its commits say.
    const dir = repoWith(base, COVERED);
    removeOriginMain(dir);

    const { status, output } = reqCoverage(dir, '--fail-on-uncovered-changed');

    expect(status, output).toBe(1);
    expect(output).toContain(BASE);
    expect(output).toMatch(COULD_NOT_TELL);
  });

  test('BUG-46: without --fail-on-uncovered-changed it reads no diff, so with origin/main gone it prints the same, writes the same report and exits 0, as D-131 leaves it', () => {
    const dir = repoWith(base, UNCOVERED);
    const report = () => readFileSync(path.join(dir, 'docs', 'requirements-status.md'), 'utf8');
    expectResolvable(dir);
    const resolvable = reqCoverage(dir);
    const resolvableReport = report();
    removeOriginMain(dir);

    const gone = reqCoverage(dir);

    expect(resolvable.status, resolvable.output).toBe(0);
    expect(gone.status, gone.output).toBe(0);
    expect(gone.output).not.toMatch(COULD_NOT_TELL);
    expect(gone.output).toBe(resolvable.output);
    expect(report()).toBe(resolvableReport);
  });
});

// ===========================================================================
// BUG-47: which changed files req:coverage --fail-on-uncovered-changed reads
// for requirement IDs. The list is IMPLEMENTING_DIRS in req-coverage.mjs:
// product code under apps/ and packages/, and specs under docs/specs/.
// ===========================================================================

describe('BUG-47: which committed files req:coverage --fail-on-uncovered-changed reads for a requirement no test names, in a scratch repository (RG-01)', () => {
  // test-auditor found, in BUG-46's loop-1 audit, that no test committed a
  // product file naming an ID with no test, or a tooling file mentioning one.
  // So the list could lose apps/ or packages/, letting product work on an
  // untested requirement through RG-01, or gain scripts/, making the gate
  // refuse the comments tooling writes to explain a guard, with every test
  // green. The behaviour is right today; these pin it.
  //
  // Each case commits one file holding the same text. The apps/ and packages/
  // cases and the scripts/ control share the path below their top folder, so
  // the folder list is the one thing that decides; the other controls are
  // chosen by where the check could go wrong (below). DEMO-02 is a synthetic
  // live story that no counted test names; DEMO-01 has one, so the repository
  // has a counted test that names something else. Nothing under docs/specs/ changes, so no
  // criterion is read and no not-automated line is involved.
  const UNCOVERED_ID = 'DEMO-02';
  const base = {
    'docs/plan/01b-mvp-scope.md':
      '**DEMO-01 · A synthetic story** (Must)\n' + '**DEMO-02 · Another synthetic story** (Must)\n',
    'apps/server/src/demo.test.ts': namingTests('DEMO-01-AC1'),
  };
  /** The file a case commits: the same path under each top folder. */
  const fileUnder = (top) => `${top}/demo/src/demo.ts`;
  /** The same text in every case: one line naming DEMO-02, as a comment would. */
  const NAMING_TEXT = `// ${UNCOVERED_ID}: why this exists.\nexport const demo = true;\n`;

  /** A scratch repository whose branch commits only `file`, with NAMING_TEXT. */
  function branchCommitting(file) {
    const dir = repoWith(base, { [file]: NAMING_TEXT });
    // The condition every case rests on: origin/main resolves, and the branch
    // changes that one file and nothing else.
    const diff = execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
      cwd: dir,
      env: scratchEnv(dir),
      encoding: 'utf8',
    });
    expect(diff.split('\n').filter((line) => line !== '')).toEqual([file]);
    return dir;
  }

  test('BUG-47: a committed apps/ file naming a live requirement no test names is refused under RG-01, naming it', () => {
    const dir = branchCommitting(fileUnder('apps'));

    const { status, output } = reqCoverage(dir, '--fail-on-uncovered-changed');

    expect(status, output).toBe(1);
    expect(output).toContain('RG-01:');
    expect(output.slice(output.indexOf('RG-01:'))).toContain(UNCOVERED_ID);
  });

  test('BUG-47: a committed packages/ file naming a live requirement no test names is refused under RG-01, naming it', () => {
    const dir = branchCommitting(fileUnder('packages'));

    const { status, output } = reqCoverage(dir, '--fail-on-uncovered-changed');

    expect(status, output).toBe(1);
    expect(output).toContain('RG-01:');
    expect(output.slice(output.indexOf('RG-01:'))).toContain(UNCOVERED_ID);
  });

  // The files the folder check must let through: tooling, and paths that only
  // look like product code. test-auditor found, in BUG-47's audit, that the
  // check could gain .github/, match apps/ anywhere in a path rather than at
  // its start, or lose the trailing slash on apps or packages, with every test
  // green. Each row is chosen so one of those, or gaining scripts/, refuses it.
  const NOT_PRODUCT_CODE = [
    { file: fileUnder('scripts'), what: 'tooling' },
    { file: '.github/demo/demo.ts', what: 'CI configuration' },
    { file: '.claude/hooks/demo.mjs', what: 'a hook, tooling' },
    { file: fileUnder('appsettings'), what: 'starts with apps, not apps/' },
    { file: fileUnder('tools/apps'), what: 'apps/ below the top folder' },
    { file: fileUnder('packagesmeta'), what: 'starts with packages, not packages/' },
  ];

  test.each(NOT_PRODUCT_CODE)(
    'BUG-47: the same requirement named only in a committed $file, $what, is not refused',
    ({ file }) => {
      const dir = branchCommitting(file);

      const { status, output } = reqCoverage(dir, '--fail-on-uncovered-changed');

      expect(status, output).toBe(0);
      expect(output).not.toContain('RG-01:');
    },
  );
});
