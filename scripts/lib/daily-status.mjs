// INF-09, D-050: the daily status report, from what Claude returned to a
// comment on the owner's phone.
//
// Two jobs, and the split is the design. Claude writes the report and holds a
// token that can only read. This module posts it, holds the token that can
// write, and is not a language model. So the part that has to happen every
// morning — a comment appears, and it starts with ✅, ⚠️ or 🛑 — does not
// depend on a model remembering to do it. In this repository that has gone
// wrong: a reviewer posted its review and skipped the file the gate read
// (D-073), and another returned a placeholder instead of an answer (#15).
//
// And when the report cannot be written, the owner hears about that too, in the
// same place, at the same time. D-050 says a failed report must show rather
// than be silently missing; a red run in the Actions tab shows only to someone
// already looking there.
//
// What this cannot cover: a morning when the workflow does not run at all — an
// exhausted Actions budget, an outage, a scheduled run GitHub dropped. Nothing
// here runs then, so nothing here can say so. That is Healthchecks.io's job:
// the workflow's last step pings it every run, and it pages the owner when a
// day passes without one. The issue body says so too.

export const ISSUE_TITLE = 'Daily status';

/**
 * What `status` may be, and the line each one turns into. The workflow's JSON
 * schema offers exactly these keys; a test holds the two together.
 *
 * Plain keys rather than the emoji themselves: ⚠️ is two code points, and a
 * comparison a variation selector can break is not one to hand to a model.
 */
export const HEADLINES = {
  healthy: '✅ Healthy',
  attention: '⚠️ Needs attention',
  action: '🛑 Action required',
};

/**
 * Labels the report depends on, created if missing.
 *
 * `owner-question` is here because the report counts those issues, and the
 * issue template applies the label only if it exists. Without it a question
 * filed from the template carries no label, the report finds none, and says
 * "no open questions" — a true-looking answer to a question nobody could see.
 */
export const LABELS = [
  {
    name: 'daily-status',
    color: '0e8a16',
    description: 'The pinned issue the daily report is posted to (D-050)',
  },
  {
    name: 'owner-question',
    color: 'd93f0b',
    description: 'A decision Claude needs from the owner (D-051)',
  },
];

/**
 * What the report job handed over, checked before anything is posted.
 *
 * @param {{ result: string | undefined, structured: string | undefined }} input
 *   `result` is the report job's outcome; `structured` is Claude's structured
 *   output, as text.
 * @returns {{ ok: true, status: keyof typeof HEADLINES, report: string } | { ok: false, why: string }}
 */
export function parseReport({ result, structured }) {
  if (result !== 'success') {
    return {
      ok: false,
      why: `The job that writes the report ended as "${String(result)}", not "success".`,
    };
  }
  if (structured === undefined || structured.trim() === '') {
    return {
      ok: false,
      why: 'The report job finished but returned no report. Claude produced no structured output.',
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(structured);
  } catch {
    return { ok: false, why: 'The report job returned something that is not JSON.' };
  }

  const status = parsed?.status;
  if (typeof status !== 'string' || !Object.hasOwn(HEADLINES, status)) {
    return {
      ok: false,
      why: `The report's status was "${String(status)}", which is none of ${Object.keys(HEADLINES).join(', ')}.`,
    };
  }
  const report = typeof parsed.report === 'string' ? parsed.report.trim() : '';
  if (report === '') {
    return {
      ok: false,
      why: `The report's status was "${status}", but the report itself was empty.`,
    };
  }
  return { ok: true, status: /** @type {keyof typeof HEADLINES} */ (status), report };
}

/** The last line of every comment: who it is for, and how it was made. */
function footer({ owner, runUrl }) {
  return `<sub>@${owner} · [how this was made](${runUrl})</sub>`;
}

/**
 * The comment for a report that was written.
 *
 * The headline comes from `status`, not from the model's prose, so "starts
 * with ✅, ⚠️ or 🛑" holds by construction rather than by instruction. The
 * owner is mentioned because a mention is the notification GitHub Mobile pushes
 * by default, and reaching the phone is what D-050 is for.
 *
 * @param {{ status: keyof typeof HEADLINES, report: string, owner: string, runUrl: string }} input
 */
export function composeComment({ status, report, owner, runUrl }) {
  return [`### ${HEADLINES[status]}`, '', report, '', footer({ owner, runUrl })].join('\n');
}

/**
 * The comment for a morning with no report. Always 🛑: the owner is being told
 * that nothing was checked, and that is not a ⚠️.
 *
 * @param {{ why: string, owner: string, runUrl: string }} input
 */
export function composeFailure({ why, owner, runUrl }) {
  return [
    `### ${HEADLINES.action} — no report today`,
    '',
    'The daily report could not be written, so none of it was checked today.',
    'That is not the same as nothing being wrong.',
    '',
    `**Why:** ${why}`,
    '',
    footer({ owner, runUrl }),
  ].join('\n');
}

/**
 * The body of the issue, written once when it is created.
 *
 * @param {{ workflowUrl: string }} input
 */
export function issueBody({ workflowUrl }) {
  return [
    'The daily status report (D-050) is posted here as a comment every morning at',
    '05:00 UTC — 07:00 in Oslo in summer, 06:00 in winter. Each one starts with',
    '✅ healthy, ⚠️ needs attention or 🛑 action required.',
    '',
    'If the report cannot be written, a 🛑 comment says so instead.',
    '',
    '**A morning with no comment at all means the workflow did not run.**',
    'Healthchecks.io watches for exactly that and pages you when a day passes',
    `without a run. The runs themselves are here: ${workflowUrl}`,
    '',
    'Keep this issue open. If it is closed, the next run opens a new one.',
  ].join('\n');
}

/**
 * The open issue to post to: titled exactly "Daily status". The oldest wins if
 * there are several, so the report keeps landing where the owner already looks.
 *
 * @param {{ number: number, title: string }[]} issues open issues
 * @returns {number | null}
 */
export function pickIssue(issues) {
  const matching = issues
    .filter((issue) => issue.title === ISSUE_TITLE)
    .map((issue) => issue.number)
    .sort((a, b) => a - b);
  return matching[0] ?? null;
}

/** The issue number at the end of the URL `gh issue create` prints. */
export function issueNumberFromUrl(output) {
  const match = /\/issues\/(?<number>\d+)\s*$/.exec(output.trim());
  return match?.groups === undefined ? null : Number(match.groups.number);
}

/**
 * Posts today's report, or today's failure, and says what it did.
 *
 * Every GitHub call goes through `gh`, injected so tests can play GitHub.
 * Returns the exit code: 0 only when a report was written and posted. A posted
 * failure notice still exits 1, so the run is red as well as the comment.
 *
 * @param {{
 *   env: Record<string, string | undefined>,
 *   gh: (args: string[]) => { ok: boolean, output: string },
 *   log: (line: string) => void,
 * }} deps
 * @returns {number}
 */
export function postDailyStatus({ env, gh, log }) {
  const owner = env.OWNER_LOGIN ?? '';
  const runUrl = env.RUN_URL ?? '';
  const workflowUrl = env.WORKFLOW_URL ?? '';
  if (owner === '' || runUrl === '' || workflowUrl === '') {
    log('::error::OWNER_LOGIN, RUN_URL and WORKFLOW_URL must all be set. Nothing was posted.');
    return 1;
  }

  // Problems that do not stop the report from being posted, but must not pass
  // quietly either. They are appended to the comment and turn the run red.
  const problems = [];

  // The workflow's last step pings Healthchecks.io, which pages the owner when
  // a morning passes with no ping — the one failure nothing in this workflow
  // can report itself. Without its secret that protection is absent, and the
  // owner should read that where they read everything else, not in a log.
  // Anything but "true" counts as absent: a dropped env line must not pass.
  if (env.PING_CONFIGURED !== 'true') {
    problems.push(
      'The Healthchecks.io ping is not set up (repository secret `HEALTHCHECKS_DAILY_STATUS_URL`, owner to-do A-16), so a morning when this workflow does not run at all will go unnoticed.',
    );
    log('::error::HEALTHCHECKS_DAILY_STATUS_URL is not set; the report says so.');
  }

  for (const label of LABELS) {
    const created = gh([
      'label',
      'create',
      label.name,
      '--color',
      label.color,
      '--description',
      label.description,
      '--force',
    ]);
    if (!created.ok) {
      problems.push(`The label \`${label.name}\` could not be created or updated.`);
      log(`::error::Could not create the label ${label.name}: ${created.output}`);
    }
  }

  const listed = gh([
    'issue',
    'list',
    '--state',
    'open',
    '--limit',
    '1000',
    '--json',
    'number,title',
  ]);
  if (!listed.ok) {
    log(`::error::Could not list the open issues, so there is nowhere to post: ${listed.output}`);
    return 1;
  }
  let issue;
  try {
    issue = pickIssue(JSON.parse(listed.output));
  } catch {
    log(
      `::error::gh issue list did not return JSON, so there is nowhere to post: ${listed.output}`,
    );
    return 1;
  }

  if (issue === null) {
    const created = gh([
      'issue',
      'create',
      '--title',
      ISSUE_TITLE,
      '--body',
      issueBody({ workflowUrl }),
      '--label',
      'daily-status',
      // Assigning subscribes the owner, so the comments reach their inbox even
      // on a day the mention below does not push.
      '--assignee',
      owner,
    ]);
    issue = created.ok ? issueNumberFromUrl(created.output) : null;
    if (issue === null) {
      log(`::error::Could not create the "${ISSUE_TITLE}" issue: ${created.output}`);
      return 1;
    }
    log(`Created issue #${String(issue)} for the daily report.`);
    const pinned = gh(['issue', 'pin', String(issue)]);
    if (!pinned.ok) {
      problems.push(`Issue #${String(issue)} could not be pinned.`);
      log(`::error::Could not pin issue #${String(issue)}: ${pinned.output}`);
    }
  }

  const parsed = parseReport({ result: env.REPORT_RESULT, structured: env.STRUCTURED });
  let body = parsed.ok
    ? composeComment({ status: parsed.status, report: parsed.report, owner, runUrl })
    : composeFailure({ why: parsed.why, owner, runUrl });
  if (problems.length > 0) {
    body = `${body}\n\n**Also wrong this morning:** ${problems.join(' ')}`;
  }

  const posted = gh(['issue', 'comment', String(issue), '--body', body]);
  if (!posted.ok) {
    log(`::error::Could not post to issue #${String(issue)}: ${posted.output}`);
    return 1;
  }

  if (!parsed.ok) {
    log(
      `::error::No report today, and the owner has been told so on #${String(issue)}. ${parsed.why}`,
    );
    return 1;
  }
  if (problems.length > 0) {
    log(
      `::error::The report was posted to #${String(issue)}, with problems: ${problems.join(' ')}`,
    );
    return 1;
  }
  log(`Posted the daily report (${parsed.status}) to #${String(issue)}.`);
  return 0;
}
