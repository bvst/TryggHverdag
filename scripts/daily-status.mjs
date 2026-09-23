#!/usr/bin/env node
/**
 * INF-09, D-050: post the daily status report to the pinned "Daily status"
 * issue — or, when there is no report, post that instead.
 *
 * Runs in the second job of .github/workflows/daily-status.yml, after Claude
 * has written the report in the first. Everything it decides is in
 * scripts/lib/daily-status.mjs; this file only connects it to `gh`.
 *
 * Environment:
 *   REPORT_RESULT  the report job's outcome (success, failure, …)
 *   STRUCTURED     Claude's structured output: {"status": …, "report": …}
 *   OWNER_LOGIN    who the report is for, mentioned and assigned
 *   RUN_URL        this run, linked from every comment
 *   WORKFLOW_URL   the workflow's run list, linked from the issue
 *   GH_TOKEN       a token that can write issues; GH_REPO names the repository
 *
 * Usage: node scripts/daily-status.mjs
 */
import process from 'node:process';
import { postDailyStatus } from './lib/daily-status.mjs';
import { run } from './lib/proc.mjs';

process.exitCode = postDailyStatus({
  env: process.env,
  gh: (args) => run('gh', args, { timeout: 60_000 }),
  log: (line) => {
    console.log(line);
  },
});
