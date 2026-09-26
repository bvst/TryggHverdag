// INF-09, D-050: the half of the daily report that is not a language model.
//
// Test names carry no <ID>-ACn: prefix. INF- is not a tracked requirement —
// req:coverage does not collect the prefix — so these prove nothing it counts
// (D-074).
//
// Most of these are about the mornings that go wrong, because those are the
// ones this code exists for. A report that posts on a good day proves little; a
// bad day that posts nothing is the failure D-050 names.
//
// D-080 (2026-09-26) made the report the pinned issue's description, replaced
// on every run like Renovate's Dependency Dashboard, where it had been a new
// comment each morning. The tests of the three functions it removed —
// composeComment, composeFailure and issueBody — are carried over to the two
// that replace them, and every assertion that changed meaning says why, where
// it is (RG-03).
import { describe, expect, test } from 'vitest';
import {
  HEADLINES,
  ISSUE_TITLE,
  LABELS,
  composeDashboard,
  composeFailureDashboard,
  issueNumberFromUrl,
  parseReport,
  pickIssue,
  postDailyStatus,
} from './daily-status.mjs';

const RUN_URL = 'https://github.com/example/repo/actions/runs/1';
const WORKFLOW_URL = 'https://github.com/example/repo/actions/workflows/daily-status.yml';
const OWNER = 'example-owner';

const report = (value) => JSON.stringify(value);
const GOOD = report({ status: 'healthy', report: 'All quiet.' });

describe('parseReport', () => {
  test('a finished report with a known status is accepted, trimmed', () => {
    expect(
      parseReport({
        result: 'success',
        structured: report({ status: 'attention', report: '  Look at #9.\n' }),
      }),
    ).toEqual({
      ok: true,
      status: 'attention',
      report: 'Look at #9.',
    });
  });

  test('a report job that did not succeed is no report, whatever it left behind', () => {
    // A failed job's outputs are not evidence of anything, even when present.
    const parsed = parseReport({ result: 'failure', structured: GOOD });

    expect(parsed.ok).toBe(false);
    expect(parsed.why).toContain('"failure"');
  });

  test('no structured output is no report', () => {
    expect(parseReport({ result: 'success', structured: '' }).ok).toBe(false);
    expect(parseReport({ result: 'success', structured: '  \n' }).ok).toBe(false);
    expect(parseReport({ result: 'success', structured: undefined }).ok).toBe(false);
  });

  test('output that is not JSON is no report', () => {
    expect(parseReport({ result: 'success', structured: 'healthy' }).ok).toBe(false);
  });

  test('a status outside the three is refused, and named', () => {
    // A fourth headline would be the model inventing a middle answer — the
    // same thing D-073 refuses for review verdicts.
    const parsed = parseReport({
      result: 'success',
      structured: report({ status: 'mostly fine', report: 'x' }),
    });

    expect(parsed.ok).toBe(false);
    expect(parsed.why).toContain('"mostly fine"');
  });

  test('the emoji itself is not a status: the keys are what the schema offers', () => {
    expect(
      parseReport({ result: 'success', structured: report({ status: '✅', report: 'x' }) }).ok,
    ).toBe(false);
  });

  test('an inherited property name is not a status', () => {
    // `in` would have accepted it; Object.hasOwn does not.
    expect(
      parseReport({ result: 'success', structured: report({ status: 'toString', report: 'x' }) })
        .ok,
    ).toBe(false);
  });

  test('a status with an empty report is no report: a headline is not a report', () => {
    expect(
      parseReport({ result: 'success', structured: report({ status: 'healthy', report: '   ' }) })
        .ok,
    ).toBe(false);
    expect(parseReport({ result: 'success', structured: report({ status: 'healthy' }) }).ok).toBe(
      false,
    );
  });

  test('JSON that is not an object is no report', () => {
    expect(parseReport({ result: 'success', structured: 'null' }).ok).toBe(false);
    expect(parseReport({ result: 'success', structured: '[]' }).ok).toBe(false);
  });
});

describe('what the owner reads', () => {
  // The pinned issue's description, whole: composeDashboard for a morning with
  // a report, composeFailureDashboard for one without (D-080).

  test('every dashboard starts with its headline, which is ✅, ⚠️ or 🛑 (D-050)', () => {
    for (const status of /** @type {(keyof typeof HEADLINES)[]} */ (Object.keys(HEADLINES))) {
      const first = composeDashboard({
        status,
        report: 'x',
        runUrl: RUN_URL,
        workflowUrl: WORKFLOW_URL,
      }).split('\n')[0];

      expect(first).toBe(`### ${HEADLINES[status]}`);
      expect(first).toMatch(/^### (✅|⚠️|🛑) /u);
    }
  });

  test('the three headlines are exactly the three D-050 names', () => {
    expect(Object.values(HEADLINES)).toEqual([
      '✅ Healthy',
      '⚠️ Needs attention',
      '🛑 Action required',
    ]);
  });

  test('a dashboard carries the report, links its run and the runs, and mentions nobody', () => {
    const body = composeDashboard({
      status: 'healthy',
      report: 'All quiet.',
      runUrl: RUN_URL,
      workflowUrl: WORKFLOW_URL,
    });

    expect(body).toContain('All quiet.');
    // Inverted on purpose (D-080, RG-03). This asserted that the body mentioned
    // `@${OWNER}`: on a comment, a mention is what GitHub Mobile pushes. An
    // edited description notifies nobody, so a mention in it is only noise.
    // What pages the owner now is Healthchecks.io, pinged /1 by a red run.
    expect(body).not.toContain('@');
    expect(body).toContain(RUN_URL);
    expect(body).toContain(WORKFLOW_URL);
  });

  test('a morning without a report is 🛑, says why, and says nothing was checked', () => {
    const body = composeFailureDashboard({
      why: 'The token expired.',
      runUrl: RUN_URL,
      workflowUrl: WORKFLOW_URL,
    });

    expect(body.split('\n')[0]).toBe(`### ${HEADLINES.action} — no report today`);
    expect(body).toContain('The token expired.');
    expect(body).toContain('none of it was checked');
    // Inverted on purpose, for the reason above (D-080, RG-03): this asserted
    // `@${OWNER}` in the body.
    expect(body).not.toContain('@');
    expect(body).toContain(RUN_URL);
    expect(body).toContain(WORKFLOW_URL);
  });

  test('each ends with a footer: when it runs, that it is the current state, what a stale one means, and the links', () => {
    // Carries the test of issueBody, which D-080 removes. The one failure
    // nothing in the workflow can report — the workflow not running at all —
    // is still stated where the owner reads, now on every run rather than
    // once. Read from after the report, so the footer is where it says it is:
    // at the end. The times themselves are checked against the cron in
    // scripts/daily-status.test.mjs; here, that they are stated, and how.
    const dashboards = [
      {
        name: 'the dashboard for a report',
        last: 'Look at #9.',
        text: composeDashboard({
          status: 'attention',
          report: 'Look at #9.',
          runUrl: RUN_URL,
          workflowUrl: WORKFLOW_URL,
        }),
      },
      {
        name: 'the dashboard for no report',
        last: 'The token expired.',
        text: composeFailureDashboard({
          why: 'The token expired.',
          runUrl: RUN_URL,
          workflowUrl: WORKFLOW_URL,
        }),
      },
    ];

    for (const { name, last, text } of dashboards) {
      const footer = text.includes(last) ? text.slice(text.indexOf(last) + last.length) : '';

      expect(text, name).toContain(last);
      expect(footer, name).toMatch(
        /\b\d{2}:\d{2} UTC — \d{2}:\d{2} in Oslo in summer, \d{2}:\d{2} in winter\b/u,
      );
      expect(footer, name).toMatch(/\breplaced (?:on )?every run\b/i);
      expect(footer, name).toMatch(/\bcurrent state\b/i);
      expect(footer, name).toMatch(/\bnot a history\b/i);
      expect(footer, name).toMatch(/\bunchanged for more than a day\b/i);
      expect(footer, name).toMatch(/\bthe workflow did not run\b/i);
      expect(footer, name).toContain('Healthchecks.io');
      expect(footer, name).toMatch(/\balready (?:have )?paged\b/i);
      expect(footer, name).toContain(RUN_URL);
      expect(footer, name).toContain(WORKFLOW_URL);
    }
  });

  test('the functions that wrote comments are gone, and the old issue body with its old time', async () => {
    // D-080 removes composeComment, composeFailure and issueBody. Left behind
    // unused, issueBody would still say the report is "posted here as a
    // comment every morning at 04:47 UTC", and no test would read that
    // sentence any more: the schedule tests now read the dashboards.
    const exported = Object.keys(await import('./daily-status.mjs'));

    expect(
      exported.filter((name) => ['composeComment', 'composeFailure', 'issueBody'].includes(name)),
    ).toEqual([]);
  });
});

describe('pickIssue', () => {
  test('finds the open issue titled exactly "Daily status"', () => {
    expect(
      pickIssue([
        { number: 3, title: 'Something else' },
        { number: 7, title: ISSUE_TITLE },
      ]),
    ).toBe(7);
  });

  test('a similar title is not the issue', () => {
    expect(
      pickIssue([
        { number: 3, title: 'Daily status (old)' },
        { number: 4, title: 'daily status' },
      ]),
    ).toBeNull();
  });

  test('with several, the oldest wins, so the report stays where the owner looks', () => {
    expect(
      pickIssue([
        { number: 12, title: ISSUE_TITLE },
        { number: 5, title: ISSUE_TITLE },
      ]),
    ).toBe(5);
  });

  test('none is null, not a guess', () => {
    expect(pickIssue([])).toBeNull();
  });
});

describe('issueNumberFromUrl', () => {
  test('reads the number gh prints after creating an issue', () => {
    expect(issueNumberFromUrl('https://github.com/example/repo/issues/42\n')).toBe(42);
  });

  test('anything else is null', () => {
    expect(issueNumberFromUrl('could not create issue')).toBeNull();
  });
});

describe('the label the owner-question template applies', () => {
  test('is one the report creates, so a question filed from it is never unlabelled', () => {
    expect(LABELS.map((label) => label.name)).toContain('owner-question');
  });
});

/**
 * A stand-in for GitHub, driven by `gh` arguments. Records every call, and
 * answers from `responses` keyed by the first two arguments.
 */
function fakeGh(responses = {}) {
  const calls = [];
  const defaults = {
    'label create': { ok: true, output: '' },
    'issue list': { ok: true, output: JSON.stringify([{ number: 9, title: ISSUE_TITLE }]) },
    'issue create': { ok: true, output: 'https://github.com/example/repo/issues/11\n' },
    'issue pin': { ok: true, output: '' },
    // What gh prints after an edit: the issue's URL.
    'issue edit': (args) => ({
      ok: true,
      output: `https://github.com/example/repo/issues/${String(args[2])}\n`,
    }),
    // Nothing should comment since D-080. A comment is still answered rather
    // than thrown on, so a stray one is recorded and fails the tests that
    // forbid it by name, instead of every test at once as an unexpected call.
    'issue comment': {
      ok: true,
      output: 'https://github.com/example/repo/issues/9#issuecomment-1\n',
    },
  };
  const gh = (args) => {
    calls.push(args);
    const key = `${args[0]} ${args[1]}`;
    const answer = responses[key] ?? defaults[key];
    if (answer === undefined) {
      throw new Error(`fakeGh: nothing expected "gh ${args.join(' ')}"`);
    }
    return typeof answer === 'function' ? answer(args) : answer;
  };
  return { gh, calls };
}

function runPost({ env = {}, responses } = {}) {
  const { gh, calls } = fakeGh(responses);
  const lines = [];
  const code = postDailyStatus({
    env: {
      REPORT_RESULT: 'success',
      STRUCTURED: GOOD,
      OWNER_LOGIN: OWNER,
      RUN_URL,
      WORKFLOW_URL,
      PING_CONFIGURED: 'true',
      ...env,
    },
    gh,
    log: (line) => lines.push(line),
  });
  const issueCalls = (verb) => calls.filter((c) => c[0] === 'issue' && c[1] === verb);
  // The description the owner reads: the --body of the last call that wrote
  // one — the edit, or the create when nothing followed it.
  const described = calls.filter((c) => c[0] === 'issue' && (c[1] === 'create' || c[1] === 'edit'));
  const last = described.at(-1) ?? [];
  return {
    code,
    calls,
    lines,
    edits: issueCalls('edit'),
    comments: issueCalls('comment'),
    // Every call that changes the issue, in order. Listing issues is not one.
    writes: calls.filter((c) => c[0] === 'issue' && c[1] !== 'list').map((c) => `issue ${c[1]}`),
    body: last.includes('--body') ? last[last.indexOf('--body') + 1] : undefined,
  };
}

describe('postDailyStatus', () => {
  test('a good morning: the existing issue gets the dashboard as its description, and exit 0', () => {
    // D-080: this asserted one comment on issue #9. What changes now is the
    // issue's description, replaced whole, and nothing is added below it.
    const { code, comments, edits, body } = runPost();

    expect(code).toBe(0);
    expect(comments).toEqual([]);
    expect(edits).toEqual([
      [
        'issue',
        'edit',
        '9',
        '--body',
        composeDashboard({
          status: 'healthy',
          report: 'All quiet.',
          runUrl: RUN_URL,
          workflowUrl: WORKFLOW_URL,
        }),
      ],
    ]);
    expect(body?.split('\n')[0]).toBe(`### ${HEADLINES.healthy}`);
  });

  test('a failed report job still reaches the owner, as 🛑, and the run goes red', () => {
    // The morning D-050 is written for. Writing nothing here would be a
    // silently missing report; exiting 0 would be a green run over it. Since
    // D-080 the red run is also what reaches the owner: an edited description
    // notifies nobody, and exit 1 is what makes the workflow's last step ping
    // Healthchecks.io with /1, which pages them.
    const { code, edits, body } = runPost({ env: { REPORT_RESULT: 'failure' } });

    expect(edits).toHaveLength(1);
    expect(body?.split('\n')[0]).toBe(`### ${HEADLINES.action} — no report today`);
    expect(body).toContain('"failure"');
    expect(body).toBe(
      composeFailureDashboard({
        why: parseReport({ result: 'failure', structured: GOOD }).why,
        runUrl: RUN_URL,
        workflowUrl: WORKFLOW_URL,
      }),
    );
    expect(code).toBe(1);
  });

  test('a report job that succeeded without a report is treated the same way', () => {
    const { code, body } = runPost({ env: { STRUCTURED: '' } });

    expect(body?.split('\n')[0]).toMatch(/^### 🛑 /u);
    expect(code).toBe(1);
  });

  test('no issue yet: it is created with the dashboard as its description, labelled, assigned to the owner, and pinned', () => {
    const { code, calls, writes } = runPost({
      responses: { 'issue list': { ok: true, output: '[]' } },
    });
    const create = calls.find((c) => c[0] === 'issue' && c[1] === 'create') ?? [];
    const flag = (name) => create[create.indexOf(name) + 1];

    expect(flag('--title')).toBe(ISSUE_TITLE);
    expect(flag('--label')).toBe('daily-status');
    expect(flag('--assignee')).toBe(OWNER);
    expect(flag('--body')).toBe(
      composeDashboard({
        status: 'healthy',
        report: 'All quiet.',
        runUrl: RUN_URL,
        workflowUrl: WORKFLOW_URL,
      }),
    );
    expect(calls).toContainEqual(['issue', 'pin', '11']);
    // D-080: this asserted a comment on #11 after the pin. The description is
    // the report from the moment the issue exists, so nothing follows the pin.
    expect(writes).toEqual(['issue create', 'issue pin']);
    expect(code).toBe(0);
  });

  test('an issue that exists is not created again, and not re-pinned', () => {
    const { calls } = runPost();

    expect(calls.some((c) => c[1] === 'create' && c[0] === 'issue')).toBe(false);
    expect(calls.some((c) => c[1] === 'pin')).toBe(false);
  });

  test('both labels are made sure of on every run, idempotently', () => {
    const { calls } = runPost();
    const created = calls.filter((c) => c[0] === 'label' && c[1] === 'create');

    expect(created.map((c) => c[2])).toEqual(LABELS.map((label) => label.name));
    for (const call of created) {
      expect(call).toContain('--force');
    }
  });

  test('a label that cannot be made still lets the report through, says so in it, and goes red', () => {
    const { code, body } = runPost({
      responses: {
        'label create': (a) =>
          a[2] === 'owner-question' ? { ok: false, output: 'HTTP 403' } : { ok: true, output: '' },
      },
    });

    expect(body?.split('\n')[0]).toBe(`### ${HEADLINES.healthy}`);
    expect(body).toContain('`owner-question` could not be created');
    expect(code).toBe(1);
  });

  test('a pin that fails still lets the report through, says so in it, and goes red', () => {
    const { code, writes, edits, body } = runPost({
      responses: {
        'issue list': { ok: true, output: '[]' },
        'issue pin': { ok: false, output: 'HTTP 403' },
      },
    });

    // D-080: the issue is created with the report as its description, so a
    // problem found after that is written by replacing the description once
    // more — the one morning the issue gets a second write.
    expect(writes).toEqual(['issue create', 'issue pin', 'issue edit']);
    expect(edits).toEqual([['issue', 'edit', '11', '--body', expect.any(String)]]);
    expect(body?.split('\n')[0]).toBe(`### ${HEADLINES.healthy}`);
    expect(body).toContain('All quiet.');
    expect(body).toContain('could not be pinned');
    expect(code).toBe(1);
  });

  test('without the Healthchecks.io secret the report still goes out, says so, and goes red', () => {
    // Until A-16 is done, a morning when the workflow does not run at all goes
    // unnoticed. The owner reads that in the report, not only in a run log.
    // Anything but "true" is absent: a dropped env line must not read as set.
    for (const value of ['false', '', undefined]) {
      const { code, body } = runPost({ env: { PING_CONFIGURED: value } });

      expect(body?.split('\n')[0]).toBe(`### ${HEADLINES.healthy}`);
      expect(body).toContain('HEALTHCHECKS_DAILY_STATUS_URL');
      expect({ value, code }).toEqual({ value, code: 1 });
    }
  });

  test('with it, the description raises no Healthchecks.io problem', () => {
    // Re-aimed on purpose (D-080, RG-03). This was "with it, the report says
    // nothing about Healthchecks.io", and asserted that the body lacked the
    // word "Healthchecks". Since D-080 the footer names Healthchecks.io on
    // every run, on purpose: it is what pages the owner when the description
    // stops changing. What the assertion meant is that a configured ping
    // raises no problem, so that is what it holds now: the line naming the
    // missing secret is absent, and the run is green.
    const { code, body } = runPost();

    expect(body?.split('\n')[0]).toBe(`### ${HEADLINES.healthy}`);
    expect(body).not.toContain('HEALTHCHECKS_DAILY_STATUS_URL');
    expect(code).toBe(0);
  });

  test('if the description cannot be replaced, the run fails and says where it tried', () => {
    const { code, lines } = runPost({
      responses: { 'issue edit': { ok: false, output: 'HTTP 502' } },
    });

    expect(code).toBe(1);
    // D-080: this matched "::error::Could not post to issue #9: HTTP 502". The
    // call is an edit now, so the wording may change; what must stay is an
    // error line that names the issue and says what GitHub answered.
    expect(lines.join('\n')).toMatch(/::error::[^\n]*#9\b[^\n]*HTTP 502/);
  });

  test('if the issues cannot be listed, nothing is created blind and the run fails', () => {
    // Creating an issue without knowing whether one exists would open a new
    // one every morning GitHub's list call failed.
    const { code, calls } = runPost({
      responses: { 'issue list': { ok: false, output: 'HTTP 500' } },
    });

    expect(code).toBe(1);
    expect(calls.some((c) => c[0] === 'issue' && c[1] === 'create')).toBe(false);
  });

  test('a list that is not JSON fails the same way', () => {
    const { code, calls } = runPost({
      responses: { 'issue list': { ok: true, output: 'rate limited' } },
    });

    expect(code).toBe(1);
    expect(calls.some((c) => c[0] === 'issue' && c[1] === 'create')).toBe(false);
  });

  test('if the issue cannot be created, the run fails rather than posting nowhere', () => {
    const { code, comments, edits, lines } = runPost({
      responses: {
        'issue list': { ok: true, output: '[]' },
        'issue create': { ok: false, output: 'HTTP 422' },
      },
    });

    expect(code).toBe(1);
    expect(comments).toHaveLength(0);
    expect(edits).toHaveLength(0);
    expect(lines.join('\n')).toMatch(/::error::[^\n]*"Daily status"[^\n]*HTTP 422/);
  });

  test('missing wiring fails before touching GitHub', () => {
    // Empty and absent both: a workflow edit that drops a line leaves it
    // absent, and one that mistypes a context leaves it empty.
    for (const name of ['OWNER_LOGIN', 'RUN_URL', 'WORKFLOW_URL']) {
      for (const value of ['', undefined]) {
        const { code, calls } = runPost({ env: { [name]: value } });

        expect({ name, value, code }).toEqual({ name, value, code: 1 });
        expect(calls).toEqual([]);
      }
    }
  });

  /** Every kind of morning the poster meets, as runPost's input. */
  const MORNINGS = {
    'a good report': {},
    'a report job that failed': { env: { REPORT_RESULT: 'failure' } },
    'a report job that returned nothing': { env: { STRUCTURED: '' } },
    'labels that cannot be made': {
      responses: { 'label create': { ok: false, output: 'HTTP 403' } },
    },
    'no Healthchecks.io secret': { env: { PING_CONFIGURED: 'false' } },
    'an edit GitHub refuses': { responses: { 'issue edit': { ok: false, output: 'HTTP 502' } } },
    'no issue yet': { responses: { 'issue list': { ok: true, output: '[]' } } },
    'no issue yet, and no report': {
      env: { REPORT_RESULT: 'failure' },
      responses: { 'issue list': { ok: true, output: '[]' } },
    },
    'no issue yet, and a pin that fails': {
      responses: {
        'issue list': { ok: true, output: '[]' },
        'issue pin': { ok: false, output: 'HTTP 403' },
      },
    },
    'an issue GitHub will not create': {
      responses: {
        'issue list': { ok: true, output: '[]' },
        'issue create': { ok: false, output: 'HTTP 422' },
      },
    },
  };

  test('never comments, on any morning: since D-080 the description is the report', () => {
    // Each comment made the issue longer, a log of mornings the owner did not
    // want to read (D-080). Held on every path, the failing ones above all: a
    // fallback that comments when something else went wrong is the easiest
    // way for one to come back.
    for (const [morning, setup] of Object.entries(MORNINGS)) {
      const { comments } = runPost(setup);

      expect({ morning, comments }).toEqual({ morning, comments: [] });
    }
  });

  test('an issue that exists gets exactly one write, whatever the morning: its description, replaced', () => {
    // D-080: `gh issue edit <n> --body <description>`, and nothing else — not
    // a comment, not a second edit, not a new issue.
    const existing = [
      'a good report',
      'a report job that failed',
      'a report job that returned nothing',
      'labels that cannot be made',
      'no Healthchecks.io secret',
    ];

    for (const morning of existing) {
      const { writes, edits } = runPost(MORNINGS[morning]);

      expect({ morning, writes }).toEqual({ morning, writes: ['issue edit'] });
      expect({ morning, edits }).toEqual({
        morning,
        edits: [['issue', 'edit', '9', '--body', expect.any(String)]],
      });
    }
  });

  test('no description it writes mentions anyone, on any morning', () => {
    // D-080: editing a description notifies nobody, so an @mention in one is
    // noise. What reaches the owner now is Healthchecks.io: a red run pings it
    // with /1, and a run that never happens misses its ping.
    for (const [morning, setup] of Object.entries(MORNINGS)) {
      const { calls } = runPost(setup);
      const mentioning = calls
        .filter((c) => c[0] === 'issue' && c.includes('--body'))
        .map((c) => c[c.indexOf('--body') + 1])
        .filter((body) => body.includes('@'));

      expect({ morning, mentioning }).toEqual({ morning, mentioning: [] });
    }
  });

  /**
   * What the footer says, as the footer test above holds it. Every description
   * ends with the footer (D-080), so all of this must follow any problem the
   * description reports: a problem written after the footer leaves none of it
   * to find.
   */
  const FOOTER_SAYS = [
    /\b\d{2}:\d{2} UTC — \d{2}:\d{2} in Oslo in summer, \d{2}:\d{2} in winter\b/u,
    /\breplaced (?:on )?every run\b/i,
    /\bcurrent state\b/i,
    /\bnot a history\b/i,
    /\bunchanged for more than a day\b/i,
    /\bthe workflow did not run\b/i,
    /\bHealthchecks\.io\b/,
    /\balready (?:have )?paged\b/i,
    RUN_URL,
    WORKFLOW_URL,
  ];

  /** What a text says after its last mention of `part`; empty if there is none. */
  const textAfter = (text, part) =>
    text.includes(part) ? text.slice(text.lastIndexOf(part) + part.length) : '';

  /**
   * Problems that do not stop the description from being written, as runPost's
   * input, each with what the description says about it and the writes the
   * issue gets that morning.
   */
  const PROBLEMS = {
    'no Healthchecks.io secret': {
      setup: { env: { PING_CONFIGURED: 'false' } },
      says: 'HEALTHCHECKS_DAILY_STATUS_URL',
      writes: ['issue edit'],
    },
    'a label that cannot be made': {
      setup: { responses: { 'label create': { ok: false, output: 'HTTP 403' } } },
      says: '`owner-question` could not be created',
      writes: ['issue edit'],
    },
    'a new issue that cannot be pinned': {
      setup: {
        responses: {
          'issue list': { ok: true, output: '[]' },
          'issue pin': { ok: false, output: 'HTTP 403' },
        },
      },
      says: 'could not be pinned',
      writes: ['issue create', 'issue pin', 'issue edit'],
    },
  };

  /** The two ways a morning has no report, as runPost's env. */
  const NO_REPORT = {
    'a report job that failed': { REPORT_RESULT: 'failure' },
    'a report job that returned nothing': { STRUCTURED: '' },
  };

  test('no report and a problem: one 🛑 description, with the why and the problem, and the footer still last', () => {
    // Found by mutation after the green step: the no-report description,
    // composed without `problems`, passed every test above, because none of
    // them put a missing report and a problem on the same morning — nor did
    // the comment-era tests. The owner must read both, that nothing was
    // checked and what else went wrong, and the problem sits above the footer,
    // where it is read. The run is red either way: exit 1 is what pages the
    // owner (D-080).
    for (const [missing, env] of Object.entries(NO_REPORT)) {
      const { why } = parseReport({
        result: env.REPORT_RESULT ?? 'success',
        structured: env.STRUCTURED ?? GOOD,
      });

      for (const [problem, { setup, says, writes: expected }] of Object.entries(PROBLEMS)) {
        const morning = `${missing}, and ${problem}`;
        const run = runPost({ env: { ...env, ...setup.env }, responses: setup.responses });
        const { code, writes, body = '' } = run;
        const also = body.indexOf('Also wrong this morning');

        expect({ morning, writes }).toEqual({ morning, writes: expected });
        expect(body.split('\n')[0], morning).toBe(`### ${HEADLINES.action} — no report today`);
        expect(body, morning).toContain(why);
        expect(also, `${morning}: "Also wrong this morning" is missing`).toBeGreaterThan(-1);
        expect(body.slice(also), morning).toContain(says);
        for (const said of FOOTER_SAYS) {
          expect(textAfter(body, says), morning).toMatch(said);
        }
        expect({ morning, code }).toEqual({ morning, code: 1 });
      }
    }
  });

  test('a report and a problem: the problem sits above the footer too', () => {
    // The same rule on a morning with a report, which nothing held either:
    // problems appended after the footer passed every test above.
    for (const [problem, { setup, says }] of Object.entries(PROBLEMS)) {
      const { code, body = '' } = runPost(setup);
      const also = body.indexOf('Also wrong this morning');

      expect(body.split('\n')[0], problem).toBe(`### ${HEADLINES.healthy}`);
      expect(body, problem).toContain('All quiet.');
      expect(also, `${problem}: "Also wrong this morning" is missing`).toBeGreaterThan(-1);
      expect(body.slice(also), problem).toContain(says);
      for (const said of FOOTER_SAYS) {
        expect(textAfter(body, says), problem).toMatch(said);
      }
      expect({ problem, code }).toEqual({ problem, code: 1 });
    }
  });
});
