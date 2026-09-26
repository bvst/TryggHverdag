// INF-09, D-050, D-080: the daily status report, from what Claude returned to
// the description of the pinned "Daily status" issue.
//
// Two jobs, and the split is the design. Claude writes the report and holds a
// token that can only read. This module publishes it, holds the token that can
// write, and is not a language model. So the part that has to happen every
// morning — the description is replaced, and it starts with ✅, ⚠️ or 🛑 —
// does not depend on a model remembering to do it. In this repository that has
// gone wrong: a reviewer posted its review and skipped the file the gate read
// (D-073), and another returned a placeholder instead of an answer (#15).
//
// A dashboard, not a diary (D-080). Like Renovate's Dependency Dashboard, each
// run replaces the description with the current state and appends nothing, so
// the issue stays one screen long. The price is that an edit notifies nobody.
// That is why a failure is carried by the exit code as well as the text: a
// failed run exits 1, and the workflow's last step then pings Healthchecks.io
// with /1, which pages the owner.
//
// What this cannot cover: a morning when the workflow does not run at all — an
// exhausted Actions budget, an outage, a scheduled run GitHub dropped. Nothing
// here runs then, so nothing here can say so. That is Healthchecks.io's job:
// the workflow's last step pings it every run, and it pages the owner when a
// day passes without one. The description's footer says so too.

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

/**
 * When the workflow runs, as the issue states it. The cron in
 * .github/workflows/daily-status.yml is the source; a test holds this sentence
 * to it, in UTC and on both of Oslo's clocks (D-080).
 */
const SCHEDULE = '01:07 UTC — 03:07 in Oslo in summer, 02:07 in winter';

/**
 * What every description ends with: what it is, when it changes, what an old
 * one means, and how it was made. No @mention: an edited description notifies
 * nobody, so a mention would only be noise (D-080).
 */
function footer({ runUrl, workflowUrl }) {
  // One line: the phrases the owner reads by are held by tests, and a line
  // break inside one would split it. "A day and a half" rather than "a day":
  // GitHub starts this run hours late by varying amounts, so two runs that both
  // happened can be more than a day apart, and Healthchecks.io pages only after
  // its grace time. At a day and a half, both halves of the sentence are true.
  return [
    '---',
    `<sub>The current state, replaced on every run: every morning at ${SCHEDULE}, though GitHub often starts it hours late. It is not a history. If it stays unchanged for more than a day and a half, the workflow did not run, and Healthchecks.io will already have paged you. [This run](${runUrl}) · [All runs](${workflowUrl})</sub>`,
  ].join('\n');
}

/** Problems found on the way, above the footer so they are read. */
function problemLines(problems) {
  return problems.length > 0 ? [`**Also wrong this morning:** ${problems.join(' ')}`, ''] : [];
}

/**
 * The whole description for a report that was written — the whole of it, since
 * each run replaces the last (D-080).
 *
 * The headline comes from `status`, not from the model's prose, so "starts with
 * ✅, ⚠️ or 🛑" holds by construction rather than by instruction.
 *
 * @param {{ status: keyof typeof HEADLINES, report: string, runUrl: string, workflowUrl: string, problems?: string[] }} input
 */
export function composeDashboard({ status, report, runUrl, workflowUrl, problems = [] }) {
  return [
    `### ${HEADLINES[status]}`,
    '',
    report,
    '',
    ...problemLines(problems),
    footer({ runUrl, workflowUrl }),
  ].join('\n');
}

/**
 * The description for a morning with no report. Always 🛑: the owner is being
 * told that nothing was checked, and that is not a ⚠️.
 *
 * @param {{ why: string, runUrl: string, workflowUrl: string, problems?: string[] }} input
 */
export function composeFailureDashboard({ why, runUrl, workflowUrl, problems = [] }) {
  return [
    `### ${HEADLINES.action} — no report today`,
    '',
    'The daily report could not be written, so none of it was checked today.',
    'That is not the same as nothing being wrong.',
    '',
    `**Why:** ${why}`,
    '',
    ...problemLines(problems),
    footer({ runUrl, workflowUrl }),
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
 * Makes today's report, or today's failure, the description of the pinned
 * "Daily status" issue, and says what it did. Never a comment (D-080).
 *
 * Every GitHub call goes through `gh`, injected so tests can play GitHub.
 * Returns the exit code: 0 only when a report was written and published. A
 * published failure notice still exits 1, so the run is red and the workflow's
 * ping tells Healthchecks.io to page — an edited description notifies nobody.
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

  // Problems that do not stop the report from being published, but must not
  // pass quietly either. They go into the description and turn the run red.
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

  const parsed = parseReport({ result: env.REPORT_RESULT, structured: env.STRUCTURED });
  const describe = () =>
    parsed.ok
      ? composeDashboard({
          status: parsed.status,
          report: parsed.report,
          runUrl,
          workflowUrl,
          problems,
        })
      : composeFailureDashboard({ why: parsed.why, runUrl, workflowUrl, problems });
  const rewrite = (number) => {
    const edited = gh(['issue', 'edit', String(number), '--body', describe()]);
    if (!edited.ok) {
      log(
        `::error::Could not update the description of issue #${String(number)}: ${edited.output}`,
      );
    }
    return edited.ok;
  };

  if (issue === null) {
    const created = gh([
      'issue',
      'create',
      '--title',
      ISSUE_TITLE,
      '--body',
      describe(),
      '--label',
      'daily-status',
      // Assigning subscribes the owner and puts the dashboard in their list of
      // assigned issues, which is where GitHub Mobile shows it.
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
      // Into the description too. If that fails, rewrite() says so, and the run
      // exits 1 below either way: `problems` is no longer empty.
      rewrite(issue);
    }
  } else if (!rewrite(issue)) {
    return 1;
  }

  if (!parsed.ok) {
    log(`::error::No report today, and #${String(issue)}'s description says so. ${parsed.why}`);
    return 1;
  }
  if (problems.length > 0) {
    log(
      `::error::The report is in #${String(issue)}'s description, with problems: ${problems.join(' ')}`,
    );
    return 1;
  }
  log(`Put the daily report (${parsed.status}) in #${String(issue)}'s description.`);
  return 0;
}
