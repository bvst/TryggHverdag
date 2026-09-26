// INF-09, D-050: the daily-status workflow is what its header says it is.
//
// Test names carry no <ID>-ACn: prefix. INF- is not a tracked requirement, so
// these prove nothing req:coverage counts (D-074).
//
// Nothing can run this workflow before it is on main — GitHub runs scheduled
// and manual workflows only from the default branch — so its first real test is
// the first morning. What can be held before then is its shape: the job that
// reads other people's text cannot write, the job that writes still runs when
// the first one fails, and the lists that have to agree do.
//
// Read as text, like the rest of scripts/: the repository keeps no YAML parser,
// and the shapes asserted on are few and fixed.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  HEADLINES,
  LABELS,
  composeDashboard,
  composeFailureDashboard,
} from './lib/daily-status.mjs';

const WORKFLOW = readFileSync('.github/workflows/daily-status.yml', 'utf8');
const TEMPLATE = readFileSync('.github/ISSUE_TEMPLATE/owner-question.md', 'utf8');
const SKILL_PATH = '.claude/skills/status/SKILL.md';

/** A job's own lines: from `  <id>:` to the next job, comments dropped. */
function job(id) {
  const lines = WORKFLOW.split('\n');
  const start = lines.findIndex((line) => line === `  ${id}:`);
  if (start === -1) {
    throw new Error(`No job "${id}" in daily-status.yml.`);
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line) || /^\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end))
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

/** The job's `permissions:` block, as `name: level` pairs. */
function permissions(id) {
  const lines = job(id).split('\n');
  const start = lines.findIndex((line) => line === '    permissions:');
  if (start === -1) {
    throw new Error(
      `Job "${id}" sets no permissions, so it inherits whatever the workflow grants.`,
    );
  }
  const block = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^ {6}(?<name>[\w-]+):\s*(?<level>\S+)/.exec(line);
    if (match?.groups === undefined) break;
    block.push(`${match.groups.name}: ${match.groups.level}`);
  }
  return block;
}

/**
 * A job's steps, in order, each with its name, id, `if:` and shell script
 * (a one-line `run:` or a `run: |` block, dedented).
 */
function steps(id) {
  const found = [];
  let current = null;
  let inRun = false;
  for (const line of job(id).split('\n')) {
    if (line.startsWith('      - ')) {
      current = { name: '', id: '', if: '', run: [] };
      found.push(current);
      inRun = false;
    }
    if (current === null) continue;
    if (inRun && (line.startsWith('          ') || line === '')) {
      current.run.push(line.slice(10));
      continue;
    }
    inRun = false;
    const key = /^ {6}(?:- | {2})(?<key>name|id|if|run):\s*(?<value>.*)$/.exec(line);
    if (key?.groups === undefined) continue;
    if (key.groups.key === 'run' && key.groups.value === '|') {
      inRun = true;
    } else if (key.groups.key === 'run') {
      current.run.push(key.groups.value);
    } else {
      current[key.groups.key] = key.groups.value;
    }
  }
  return found.map((step) => ({ ...step, run: step.run.join('\n').trim() }));
}

/** The tools granted to Claude, from `--allowedTools "…"`. */
function allowedTools() {
  const match = /--allowedTools\s+"(?<tools>[^"]+)"/.exec(WORKFLOW);
  if (match?.groups === undefined) {
    throw new Error('Could not find --allowedTools in daily-status.yml.');
  }
  return match.groups.tools.split(',').map((tool) => tool.trim());
}

/** The JSON schema Claude's answer must match, from `--json-schema '…'`. */
function schema() {
  const match = /--json-schema\s+'(?<json>[^']+)'/.exec(WORKFLOW);
  if (match?.groups === undefined) {
    throw new Error('Could not find --json-schema in daily-status.yml.');
  }
  return JSON.parse(match.groups.json);
}

/**
 * Every schedule the workflow runs on: each `cron:` line's expression, with its
 * minute and hour fields. A `cron:` line this cannot read throws rather than
 * being skipped, so a schedule written in an unexpected shape fails the tests
 * that read these instead of passing them unread.
 */
function schedules() {
  return WORKFLOW.split('\n')
    .filter((line) => !line.trimStart().startsWith('#') && /\bcron:/.test(line))
    .map((line) => {
      const match =
        /^\s*(?:-\s+)?cron:\s*(?<quote>['"]?)(?<expression>[^'"#]+?)\k<quote>\s*(?:#.*)?$/.exec(
          line,
        );
      const fields = match?.groups?.expression.trim().split(/\s+/) ?? [];
      if (fields.length !== 5) {
        throw new Error(`Could not read this schedule in daily-status.yml: ${line.trim()}`);
      }
      return { expression: fields.join(' '), minute: fields[0], hour: fields[1] };
    });
}

/**
 * Whether a cron minute field fires at minute 0. Each comma-separated part is
 * `*` or a number, optionally a range `a-b`, optionally with a `/step`; a part
 * fires at minute 0 when it is `*`, with or without a step, or starts at 0.
 */
function firesAtMinuteZero(minute) {
  return minute.split(',').some((part) => {
    const match = /^(?:(?<every>\*)|(?<from>\d+)(?:-(?<to>\d+))?)(?:\/\d+)?$/.exec(part);
    if (match?.groups === undefined) {
      throw new Error(`Could not read the minute field "${minute}" in daily-status.yml.`);
    }
    const { every, from, to } = match.groups;
    if (to !== undefined && Number(to) < Number(from)) {
      throw new Error(`The minute range "${part}" runs backwards, which this test cannot read.`);
    }
    return every !== undefined || Number(from) === 0;
  });
}

/** A schedule's one time of day, as numbers. A schedule without one has none to state. */
function timeOfDay({ expression, minute, hour }) {
  const time = { hour: Number(hour), minute: Number(minute) };
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || time.hour > 23 || time.minute > 59) {
    throw new Error(`'${expression}' is not one time of day, so no one time can state it.`);
  }
  return time;
}

/** A schedule's time of day as the issue states it, "HH:MM UTC", zero-padded. */
function utcTime(schedule) {
  const { hour, minute } = timeOfDay(schedule);
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(hour)}:${pad(minute)} UTC`;
}

/**
 * A schedule's time on Oslo's clocks, "HH:MM", on a fixed day of 2026. Fixed,
 * never today: the test must not read the clock, and must check summer and
 * winter time whichever season it runs in. `month` counts from 0, as Date.UTC's
 * does.
 *
 * The formatter is built here rather than once for the file: without Oslo's
 * time zone data it throws, and that should fail this test, not every test in
 * the file.
 */
function osloTime(schedule, month, day) {
  const { hour, minute } = timeOfDay(schedule);
  const oslo = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Oslo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return oslo.format(Date.UTC(2026, month, day, hour, minute));
}

/**
 * The times a text gives beside a word: each "HH:MM" followed by that word
 * within a few characters and no other number, as in "06:47 in Oslo in
 * summer". Beside it, not anywhere in the text, so a summer time and a winter
 * time that have swapped places read as swapped.
 */
function timesBeside(text, word) {
  const pattern = new RegExp(String.raw`\b(?<time>\d{2}:\d{2})\b\D{0,20}\b${word}\b`, 'gi');
  return [...text.matchAll(pattern)].map((match) => match.groups?.time ?? '');
}

describe('when it runs', () => {
  test('every night at 01:07 UTC (D-050, amended by D-078 and D-080), and by hand for the first report', () => {
    // This asserted '0 5 * * *' until D-078, and '47 4 * * *' until D-080. The
    // expected value moved because the spec did, not to make a test pass
    // (RG-03). The first scheduled run, 35983876995, fired at 09:52 UTC on
    // 2026-09-24 for the 05:00 slot — 4 h 52 min late — and GitHub names the
    // start of every hour as a time it delays scheduled runs (the next test
    // quotes it), so the owner moved the report to 04:47 UTC (D-078). That
    // slot came late as well: run 36233069263 fired at 09:32 UTC on
    // 2026-09-26, 4 h 45 min after it. The owner then said "Make it 3AM",
    // read as Oslo time: 01:07 UTC is 03:07 in Oslo in summer and 02:07 in
    // winter, and still off the top of the hour (D-080).
    const found = schedules()
      .map((s) => `'${s.expression}'`)
      .join(', ');

    expect(WORKFLOW, `The workflow is scheduled at ${found || 'no time at all'}`).toMatch(
      /^ {4}- cron: '7 1 \* \* \*'/m,
    );
    expect(WORKFLOW).toMatch(/^ {2}workflow_dispatch:/m);
  });

  test('never at the start of an hour, which GitHub names as a time it delays scheduled runs', () => {
    // GitHub's docs for the `schedule` event, fetched on 2026-09-25: "The
    // `schedule` event can be delayed during periods of high loads of GitHub
    // Actions workflow runs. High load times include the start of every hour."
    // Their advice: "schedule your workflow to run at a different time of the
    // hour." A report hours late is a morning the owner starts without it.
    //
    // 01:07 is D-080's choice; this is D-078's rule under it. A schedule moved back
    // to :00, or to `*`, or to a list or a step that passes through minute 0,
    // fails here whatever the exact time says.
    const found = schedules();

    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((s) => firesAtMinuteZero(s.minute)).map((s) => s.expression)).toEqual([]);
  });

  /**
   * What the post job writes as the "Daily status" issue's description, on a
   * morning with a report and on one without (D-080). A function, so the text
   * is made inside the tests that read it.
   */
  const descriptions = () => ({
    'with a report': composeDashboard({
      status: 'healthy',
      report: 'All quiet.',
      runUrl: 'https://github.com/example/repo/actions/runs/1',
      workflowUrl: 'https://github.com/example/repo/actions/workflows/daily-status.yml',
    }),
    'without one': composeFailureDashboard({
      why: 'The token expired.',
      runUrl: 'https://github.com/example/repo/actions/runs/1',
      workflowUrl: 'https://github.com/example/repo/actions/workflows/daily-status.yml',
    }),
  });

  test('the description tells the owner the same time the workflow runs at, with a report or without', () => {
    // Two copies of one fact: the cron line, and the sentence in the footer of
    // the "Daily status" issue's description. Until D-080 that sentence was
    // written once, when the post job created the issue (issueBody); now it is
    // rewritten on every run, whether or not there is a report. If they drift,
    // the issue promises the report at a time it never comes.
    const found = schedules();

    expect(found.length).toBeGreaterThan(0);
    for (const [morning, text] of Object.entries(descriptions())) {
      const stated = text.match(/\b\d{2}:\d{2} UTC\b/g) ?? [];

      for (const schedule of found) {
        expect(stated, `The description ${morning}`).toContain(utcTime(schedule));
      }
    }
  });

  test("the description's Oslo times are the ones the workflow runs at, in summer and in winter", () => {
    // The same fact again, on the clock the owner lives by — and the copy a
    // search-and-replace of the UTC time leaves behind. Each time is read
    // beside its own word, so a summer and a winter time that swap places fail
    // too. 1 July is summer time in Oslo (CEST, UTC+2); 15 January is winter
    // time (CET, UTC+1).
    const found = schedules();
    const summer = found.map((s) => osloTime(s, 6, 1));
    const winter = found.map((s) => osloTime(s, 0, 15));

    expect(found.length).toBeGreaterThan(0);
    // Without Oslo's rules, a formatter that fell back to UTC rather than
    // throwing would give one time for both seasons, and a text stating that
    // one time twice would pass the two checks below. This one stops it.
    expect(summer, 'Oslo summer and winter time came out the same.').not.toEqual(winter);
    for (const [morning, text] of Object.entries(descriptions())) {
      expect(timesBeside(text, 'summer'), `The description ${morning}`).toEqual(summer);
      expect(timesBeside(text, 'winter'), `The description ${morning}`).toEqual(winter);
    }
  });

  test('a second run queues behind the first rather than cancelling it', () => {
    // A cancelled report is a morning with nothing posted.
    expect(WORKFLOW).toMatch(/cancel-in-progress: false/);
    expect(WORKFLOW).not.toMatch(/cancel-in-progress: true/);
  });
});

describe('the job that reads', () => {
  test('holds no write permission of any kind', () => {
    // It reads issue and pull request text, which other people wrote. A job
    // that can be talked into something should have nothing to do it with.
    const granted = permissions('report');

    expect(granted.length).toBeGreaterThan(0);
    expect(granted.filter((p) => !p.endsWith(': read'))).toEqual([]);
  });

  test("gives Claude this job's own token, so the action never mints its app token", () => {
    // Without github_token the action exchanges an OIDC token for the Claude
    // app's token, which can write. With it, and with no id-token permission,
    // that exchange cannot happen.
    expect(job('report')).toMatch(/^ {10}github_token: \$\{\{ secrets\.GITHUB_TOKEN \}\}$/m);
    expect(permissions('report').some((p) => p.startsWith('id-token'))).toBe(false);
  });

  test('grants Claude reading tools only, and never unrestricted Bash', () => {
    const tools = allowedTools();
    const writing = tools.filter(
      (tool) =>
        /^(Write|Edit|MultiEdit|NotebookEdit|Task|Agent|WebFetch)$/.test(tool) ||
        tool.startsWith('mcp__') ||
        tool === 'Bash',
    );

    expect(tools).toContain('Read');
    expect(writing).toEqual([]);
  });

  test('every Bash grant is a read-only command', () => {
    const allowed =
      /^Bash\((git (log|show)|gh (run|pr|issue) (list|view|checks)|pnpm run req:coverage)\b/;
    const other = allowedTools().filter((tool) => tool.startsWith('Bash(') && !allowed.test(tool));

    expect(other).toEqual([]);
  });

  test("the schema's statuses are exactly the headlines the post job knows", () => {
    // Two copies of one list. If they drift, a status the schema allows turns
    // into "none of healthy, attention, action" and a 🛑 no-report morning —
    // loud, but for a reason nobody changed on purpose.
    const parsed = schema();

    expect(parsed.properties.status.enum).toEqual(Object.keys(HEADLINES));
    expect(parsed.required).toEqual(expect.arrayContaining(['status', 'report']));
  });

  test('the job hands the report on as an output, and nothing else writes it down', () => {
    expect(job('report')).toContain('structured: ${{ steps.status.outputs.structured_output }}');
  });

  test('the prompt forbids a placeholder, and names what an empty answer leads to', () => {
    // A placeholder PASS turned a blocking gate green on #15. Here the same
    // mistake would be a ✅ over a report nobody wrote.
    expect(job('report')).toContain('Do not return');
    expect(job('report')).toContain('a placeholder');
  });
});

describe('the job that posts', () => {
  test('runs after the report job even when that failed, but not when a person cancelled', () => {
    const post = job('post');

    expect(post).toMatch(/^ {4}needs: report$/m);
    expect(post).toMatch(/^ {4}if: \$\{\{ !cancelled\(\) \}\}$/m);
  });

  test('can write issues and nothing else', () => {
    const writes = permissions('post').filter((p) => !p.endsWith(': read'));

    expect(writes).toEqual(['issues: write']);
  });

  test('runs the repository script, which exists', () => {
    expect(job('post')).toMatch(/^ {8}run: node scripts\/daily-status\.mjs$/m);
    expect(existsSync('scripts/daily-status.mjs')).toBe(true);
  });

  test('receives the report through the environment, never inside the shell script', () => {
    // It is text a model wrote after reading other people's text. Interpolated
    // into `run:`, a backtick in it would be a command.
    const post = job('post');
    const scripts = steps('post').map((step) => step.run);

    expect(post).toMatch(/^ {10}STRUCTURED: \$\{\{ needs\.report\.outputs\.structured \}\}$/m);
    expect(scripts.filter((script) => script !== '').length).toBeGreaterThan(1);
    expect(scripts.filter((script) => script.includes('${{'))).toEqual([]);
  });

  test('passes everything the script refuses to run without', () => {
    const post = job('post');

    for (const name of [
      'REPORT_RESULT',
      'STRUCTURED',
      'OWNER_LOGIN',
      'RUN_URL',
      'WORKFLOW_URL',
      'GH_TOKEN',
      'GH_REPO',
      'PING_CONFIGURED',
    ]) {
      expect({ name, set: new RegExp(`^ {10}${name}: `, 'm').test(post) }).toEqual({
        name,
        set: true,
      });
    }
  });
});

describe('the Healthchecks.io ping (A-16)', () => {
  const PING = 'Tell Healthchecks.io this run happened';
  const ping = () => {
    const step = steps('post').find((s) => s.name === PING);
    if (step === undefined) throw new Error(`No step "${PING}" in the post job.`);
    return step;
  };

  /**
   * Runs the step's own script the way GitHub does, with a stand-in `curl`
   * that records what it was asked to fetch.
   */
  function runPing(env, { curlFails = false } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'daily-status-ping-'));
    try {
      const log = join(dir, 'curl.log');
      writeFileSync(
        join(dir, 'curl'),
        // Like real curl on an HTTP error: exit 22 only when asked to --fail,
        // and 0 otherwise — which is how a ping that never landed passes.
        [
          '#!/bin/sh',
          'fail=0',
          'for a in "$@"; do last="$a"; [ "$a" = "--fail" ] && fail=1; done',
          `echo "$last" >> "${log}"`,
          `if [ "$fail" = 1 ] && [ "${curlFails ? 'yes' : 'no'}" = yes ]; then exit 22; fi`,
          'exit 0',
          '',
        ].join('\n'),
      );
      chmodSync(join(dir, 'curl'), 0o755);
      const result = spawnSync(
        'bash',
        ['--noprofile', '--norc', '-eo', 'pipefail', '-c', ping().run],
        {
          encoding: 'utf8',
          env: { PATH: `${dir}:${process.env.PATH ?? ''}`, ...env },
        },
      );
      return {
        code: result.status,
        output: `${result.stdout}${result.stderr}`,
        fetched: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [],
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const URL = 'https://hc-ping.example/00000000-0000-0000-0000-000000000000';

  test('runs last, and always — a failed or crashed post is what it must still report', () => {
    const names = steps('post').map((s) => s.name);

    expect(names.at(-1)).toBe(PING);
    expect(ping().if).toBe('always()');
  });

  test('reads the URL from the secret, through the environment', () => {
    expect(job('post')).toMatch(
      /^ {10}PING_URL: \$\{\{ secrets\.HEALTHCHECKS_DAILY_STATUS_URL \}\}$/m,
    );
    expect(job('post')).toMatch(/^ {10}POSTED: \$\{\{ steps\.post\.outcome \}\}$/m);
  });

  test('POSTED names a step that exists, so a good morning is not paged as a bad one', () => {
    // steps.<id>.outcome of an id nothing carries is empty, and empty pings 1:
    // every run would page the owner, and the page would be believed less
    // each day it was wrong.
    const referenced = /^ {10}POSTED: \$\{\{ steps\.(?<id>[\w-]+)\.outcome \}\}$/m.exec(job('post'))
      ?.groups?.id;
    const poster = steps('post').find((s) => s.run === 'node scripts/daily-status.mjs');

    expect(referenced).toBeDefined();
    expect(poster?.id).toBe(referenced);
  });

  test('tells the post script only whether the secret exists, never its value', () => {
    expect(job('post')).toMatch(
      /^ {10}PING_CONFIGURED: \$\{\{ secrets\.HEALTHCHECKS_DAILY_STATUS_URL != '' \}\}$/m,
    );
  });

  test('a posted report pings exit status 0', () => {
    const { code, fetched } = runPing({ PING_URL: URL, POSTED: 'success' });

    expect(code).toBe(0);
    expect(fetched).toEqual([`${URL}/0`]);
  });

  test('anything else pings 1, which pages the owner now rather than tomorrow', () => {
    for (const outcome of ['failure', 'cancelled', 'skipped', '']) {
      const { code, fetched } = runPing({ PING_URL: URL, POSTED: outcome });

      expect({ outcome, code, fetched }).toEqual({ outcome, code: 0, fetched: [`${URL}/1`] });
    }
  });

  test('a trailing slash on the URL does not become a double one', () => {
    expect(runPing({ PING_URL: `${URL}/`, POSTED: 'success' }).fetched).toEqual([`${URL}/0`]);
  });

  test('no secret fails the step, names the owner to-do, and fetches nothing', () => {
    const { code, output, fetched } = runPing({ PING_URL: '', POSTED: 'success' });

    expect(code).not.toBe(0);
    expect(output).toContain('::error::');
    expect(output).toContain('A-16');
    expect(fetched).toEqual([]);
  });

  test('a ping the server refuses fails the step rather than passing quietly', () => {
    expect(runPing({ PING_URL: URL, POSTED: 'success' }, { curlFails: true }).code).not.toBe(0);
  });
});

describe('the script the post job runs', () => {
  /** Runs `node scripts/daily-status.mjs` against a stand-in `gh` on PATH. */
  function runScript(env) {
    const dir = mkdtempSync(join(tmpdir(), 'daily-status-gh-'));
    try {
      const log = join(dir, 'gh.log');
      writeFileSync(
        join(dir, 'gh'),
        [
          '#!/bin/sh',
          `echo "$*" >> "${log}"`,
          'if [ "$1 $2" = "issue list" ]; then echo \'[{"number":9,"title":"Daily status"}]\'; fi',
          // What the real gh prints after an edit: the issue's URL.
          'if [ "$1 $2" = "issue edit" ]; then echo "https://github.com/example/repo/issues/$3"; fi',
          'exit 0',
          '',
        ].join('\n'),
      );
      chmodSync(join(dir, 'gh'), 0o755);
      const result = spawnSync(process.execPath, ['scripts/daily-status.mjs'], {
        encoding: 'utf8',
        env: { PATH: `${dir}:${process.env.PATH ?? ''}`, ...env },
      });
      return {
        code: result.status,
        output: `${result.stdout}${result.stderr}`,
        calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [],
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const WIRED = {
    REPORT_RESULT: 'success',
    STRUCTURED: JSON.stringify({ status: 'healthy', report: 'All quiet.' }),
    OWNER_LOGIN: 'example-owner',
    RUN_URL: 'https://github.com/example/repo/actions/runs/1',
    WORKFLOW_URL: 'https://github.com/example/repo/actions/workflows/daily-status.yml',
    PING_CONFIGURED: 'true',
  };

  /**
   * The first line of each call that writes to an issue. The log keeps a
   * multi-line description on several lines, and its first is the headline.
   */
  const issueWrites = (calls) =>
    calls.filter((call) => /^issue (?:edit|comment|create) /.test(call));

  test('replaces the description through the real gh command line, and exits 0 on a good morning', () => {
    // D-080: this expected `issue comment 9 --body ### ✅ Healthy`. The
    // report now replaces the issue's description, and nothing comments.
    const { code, calls } = runScript(WIRED);

    expect(issueWrites(calls)).toEqual([`issue edit 9 --body ### ${HEADLINES.healthy}`]);
    expect(code).toBe(0);
  });

  test('a failed report makes the process exit non-zero, so the run is red too', () => {
    // D-080: this expected `issue comment 9 --body ### 🛑`, for the same reason.
    const { code, calls } = runScript({ ...WIRED, REPORT_RESULT: 'failure' });

    expect(issueWrites(calls)).toEqual([
      `issue edit 9 --body ### ${HEADLINES.action} — no report today`,
    ]);
    expect(code).toBe(1);
  });
});

describe('the owner-question template (D-051)', () => {
  test('applies only labels the daily report creates', () => {
    // GitHub applies a template's label only if it exists. A missing one means
    // questions filed without it, and a report that finds none of them.
    const match = /^labels:\s*(?<labels>.+)$/m.exec(TEMPLATE);
    const labels = (match?.groups?.labels ?? '').split(',').map((label) => label.trim());

    expect(labels).toEqual(['owner-question']);
    for (const label of labels) {
      expect(LABELS.map((l) => l.name)).toContain(label);
    }
  });

  test('asks for what D-051 names: question, options, recommendation, what it blocks', () => {
    for (const part of ['**Question:**', '**Options:**', '**Recommendation', '**Blocks:**']) {
      expect(TEMPLATE).toContain(part);
    }
  });
});

describe('the /status skill the report follows', () => {
  /**
   * Whether the skill on disk is the committed one. Inside an AI reviewer's
   * sandbox `.claude/**` is reverted to its pre-pull-request text, so a test
   * that reads it can fail for a reason that has nothing to do with the code
   * (see scripts/ai-review.test.mjs). The failure should say so.
   */
  const note = (() => {
    try {
      execFileSync('git', ['diff', '--quiet', 'HEAD', '--', SKILL_PATH], { stdio: 'ignore' });
      return '';
    } catch {
      return ` NOTE: ${SKILL_PATH} on disk differs from HEAD, so this read something other than the committed skill.`;
    }
  })();

  test('every command it tells Claude to run is one the workflow grants', () => {
    // Otherwise the report job refuses it, and a section of every report says
    // "not checked" because two files stopped agreeing.
    const skill = readFileSync(SKILL_PATH, 'utf8');
    const commands = [...skill.matchAll(/`(?<command>(?:gh|pnpm|git) [^`]+)`/g)].map(
      (match) => match.groups?.command ?? '',
    );
    const grants = allowedTools()
      .filter((tool) => tool.startsWith('Bash('))
      .map((tool) => tool.slice('Bash('.length, -1).replace(/:\*$/, ''));
    const refused = commands.filter(
      (command) => !grants.some((grant) => command.startsWith(grant)),
    );

    expect(commands.length, `No commands found in the skill.${note}`).toBeGreaterThan(0);
    expect(refused, `Commands the workflow would refuse.${note}`).toEqual([]);
  });
});
