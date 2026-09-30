#!/usr/bin/env node
// SPIKE-01-AC13: reads a night's manifest and prints each scenario's verdict
// per platform through judgeScenario, with its valid and invalid runs. Thin
// glue over the tested analysis: it decides nothing itself.
//
//   node drivers/summarize.mjs --night night-YYYYMMDD
//   node drivers/summarize.mjs --manifest <path>
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { judgeScenario } from '../analysis/runs.mjs';
import { RUNS } from './lib/run.mjs';

const { values } = parseArgs({
  options: { night: { type: 'string' }, manifest: { type: 'string' } },
});
const file = values.manifest ?? (values.night ? join(RUNS, values.night, 'manifest.jsonl') : null);
if (file === null || !existsSync(file)) {
  process.stderr.write(
    'give --night night-YYYYMMDD or --manifest <path> of an existing manifest\n',
  );
  process.exit(2);
}
const entries = readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const runs = entries.filter((entry) => entry.kind === 'run');
const say = (line = '') => process.stdout.write(`${line}\n`);

const runner = entries.filter((entry) => entry.kind === 'runner');
const time = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
for (const entry of runner) say(`runner ${entry.event} at ${time(entry.at)}`);
say(`${runs.length} run(s) in ${file}`);
say();

/** Each scenario and platform, in the order they first ran. */
const groups = new Map();
for (const run of runs) {
  const key = `${run.scenario} ${run.platform}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(run);
}

for (const [key, group] of groups) {
  const [scenario, platform] = key.split(' ');
  const judged = group.filter((run) => run.judged !== false);
  const recorded = group.filter((run) => run.judged === false);
  let verdict;
  try {
    const result = judgeScenario({
      scenario,
      platform,
      runs: judged.map((run) => ({
        id: run.runId,
        status: run.status,
        case: run.case ?? undefined,
        evidence: run.evidence,
      })),
    });
    verdict = `${result.verdict.toUpperCase()}  (valid ${result.validRuns}, invalid ${result.invalidRuns})`;
  } catch (error) {
    const valid = judged.filter((run) => run.status !== 'invalid').length;
    verdict = `NO VERDICT: ${error.message}  (valid ${valid}, invalid ${judged.length - valid})`;
  }
  say(`${scenario.toUpperCase()} ${platform}: ${verdict}`);
  for (const run of group) {
    const note = run.judged === false ? ' [recorded, not judged]' : '';
    const detail = highlight(run);
    say(`  ${run.status.padEnd(8)} ${run.runId}${note}${detail ? `  ${detail}` : ''}`);
    for (const line of run.status === 'passed' ? [] : run.evidence.slice(0, 3))
      say(`           - ${line}`);
  }
  if (recorded.length > 0) say(`  (${recorded.length} run(s) recorded, not judged)`);
}

const stopped = entries.filter((entry) => entry.kind === 'case-stopped');
if (stopped.length > 0) {
  say();
  for (const entry of stopped) say(`case stopped: ${entry.key}: ${entry.reason}`);
}

/** The one or two facts about a run worth seeing next to its status. */
function highlight(run) {
  const d = run.details ?? {};
  const parts = [];
  if (Number.isFinite(d.largestGapMs))
    parts.push(`largest gap ${Math.round(d.largestGapMs / 1000)} s`);
  if (d.capture)
    parts.push(
      `capture ${d.capture.status}${d.capture.problems.length ? ` (${d.capture.problems.length} problems)` : ''}`,
    );
  if (d.restrictions) parts.push(`in force: ${d.restrictions.inForce.join(', ') || 'none'}`);
  if (Number.isFinite(d.reportDelayMs))
    parts.push(`report after ${Math.round(d.reportDelayMs / 1000)} s`);
  if (Number.isFinite(d.reminderDelayMs))
    parts.push(`reminder after ${Math.round(d.reminderDelayMs / 1000)} s`);
  if (d.shown) parts.push(`shown ${d.shown}, heard ${d.heard}`);
  if (typeof d.callStarted === 'boolean') parts.push(`call started on the tap: ${d.callStarted}`);
  if (typeof d.presented === 'boolean') parts.push(`presented ${d.presented}`);
  if (Array.isArray(d.missing) && d.missing.length > 0)
    parts.push(`${d.missing.length} held record(s) missing`);
  return parts.join('; ');
}
