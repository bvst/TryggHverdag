// INF-09, D-050: the half of the daily report that is not a language model.
//
// Test names carry no <ID>-ACn: prefix. INF- is not a tracked requirement —
// req:coverage does not collect the prefix — so these prove nothing it counts
// (D-074).
//
// Most of these are about the mornings that go wrong, because those are the
// ones this code exists for. A report that posts on a good day proves little; a
// bad day that posts nothing is the failure D-050 names.
import { describe, expect, test } from 'vitest';
import {
  HEADLINES,
  ISSUE_TITLE,
  LABELS,
  composeComment,
  composeFailure,
  issueBody,
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
  test('every report starts with its headline, which is ✅, ⚠️ or 🛑 (D-050)', () => {
    for (const status of /** @type {(keyof typeof HEADLINES)[]} */ (Object.keys(HEADLINES))) {
      const first = composeComment({ status, report: 'x', owner: OWNER, runUrl: RUN_URL }).split(
        '\n',
      )[0];

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

  test('a report carries its body, mentions the owner and links its run', () => {
    const body = composeComment({
      status: 'healthy',
      report: 'All quiet.',
      owner: OWNER,
      runUrl: RUN_URL,
    });

    expect(body).toContain('All quiet.');
    expect(body).toContain(`@${OWNER}`);
    expect(body).toContain(RUN_URL);
  });

  test('a morning without a report is 🛑, says why, and says nothing was checked', () => {
    const body = composeFailure({ why: 'The token expired.', owner: OWNER, runUrl: RUN_URL });

    expect(body.split('\n')[0]).toMatch(/^### 🛑 /u);
    expect(body).toContain('The token expired.');
    expect(body).toContain('none of it was checked');
    expect(body).toContain(`@${OWNER}`);
    expect(body).toContain(RUN_URL);
  });

  test('the issue tells the owner that silence means the workflow did not run', () => {
    // The one failure nothing in the workflow can report, so it is stated
    // where the owner will read it, once.
    const body = issueBody({ workflowUrl: WORKFLOW_URL });

    expect(body).toContain('no comment at all means the workflow did not run');
    expect(body).toContain('Healthchecks.io');
    expect(body).toContain(WORKFLOW_URL);
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
  const comments = calls.filter((c) => c[0] === 'issue' && c[1] === 'comment');
  const first = comments[0] ?? [];
  return { code, calls, lines, comments, body: first[first.indexOf('--body') + 1] };
}

describe('postDailyStatus', () => {
  test('a good morning: one comment on the existing issue, exit 0', () => {
    const { code, comments, body } = runPost();

    expect(code).toBe(0);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.[2]).toBe('9');
    expect(body?.split('\n')[0]).toBe(`### ${HEADLINES.healthy}`);
  });

  test('a failed report job still reaches the owner, as 🛑, and the run goes red', () => {
    // The morning D-050 is written for. Posting nothing here would be a
    // silently missing report; exiting 0 would be a green run over it.
    const { code, comments, body } = runPost({ env: { REPORT_RESULT: 'failure' } });

    expect(comments).toHaveLength(1);
    expect(body?.split('\n')[0]).toMatch(/^### 🛑 /u);
    expect(body).toContain('"failure"');
    expect(code).toBe(1);
  });

  test('a report job that succeeded without a report is treated the same way', () => {
    const { code, body } = runPost({ env: { STRUCTURED: '' } });

    expect(body?.split('\n')[0]).toMatch(/^### 🛑 /u);
    expect(code).toBe(1);
  });

  test('no issue yet: it is created, labelled, assigned to the owner, pinned, then posted to', () => {
    const { code, calls } = runPost({ responses: { 'issue list': { ok: true, output: '[]' } } });
    const create = calls.find((c) => c[0] === 'issue' && c[1] === 'create') ?? [];
    const flag = (name) => create[create.indexOf(name) + 1];

    expect(flag('--title')).toBe(ISSUE_TITLE);
    expect(flag('--label')).toBe('daily-status');
    expect(flag('--assignee')).toBe(OWNER);
    expect(calls).toContainEqual(['issue', 'pin', '11']);
    expect(calls.find((c) => c[1] === 'comment')?.[2]).toBe('11');
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
    const { code, body } = runPost({
      responses: {
        'issue list': { ok: true, output: '[]' },
        'issue pin': { ok: false, output: 'HTTP 403' },
      },
    });

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

  test('with it, the report says nothing about Healthchecks.io', () => {
    expect(runPost().body).not.toContain('Healthchecks');
  });

  test('if the comment cannot be posted, the run fails and says where it tried', () => {
    const { code, lines } = runPost({
      responses: { 'issue comment': { ok: false, output: 'HTTP 502' } },
    });

    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/::error::Could not post to issue #9: HTTP 502/);
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
    const { code, comments } = runPost({
      responses: {
        'issue list': { ok: true, output: '[]' },
        'issue create': { ok: false, output: 'HTTP 422' },
      },
    });

    expect(code).toBe(1);
    expect(comments).toHaveLength(0);
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
});
