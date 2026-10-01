#!/usr/bin/env node
// SPIKE-01-AC13 and AC15: reads a night's manifest and prints each scenario's
// verdict per platform through judgeScenario, with its valid and invalid runs,
// then the go/no-go: its input computed by goNoGoInput, its rule applied by
// goNoGo. Thin glue over the tested analysis: it decides nothing itself.
//
//   node drivers/summarize.mjs --night night-YYYYMMDD
//   node drivers/summarize.mjs --manifest <path>
//   … --build-android passed --build-ios passed --licence passed
//
// The build (AC2) and the licence (AC15) are read by hand, so they are given
// here. Without all three, the verdicts are printed and the go/no-go is not.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { goNoGo } from '../analysis/go-no-go.mjs';
import { goNoGoInput } from '../analysis/manifest.mjs';
import { judgeScenario } from '../analysis/runs.mjs';
import { RUNS } from './lib/run.mjs';

const { values } = parseArgs({
  options: {
    night: { type: 'string' },
    manifest: { type: 'string' },
    'build-android': { type: 'string' },
    'build-ios': { type: 'string' },
    licence: { type: 'string' },
  },
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
    const counts = `(valid ${result.validRuns}, invalid ${result.invalidRuns})`;
    verdict =
      result.why === undefined
        ? `${result.verdict.toUpperCase()}  ${counts}`
        : `${result.verdict.toUpperCase()}: ${result.why}  ${counts}`;
  } catch (error) {
    verdict = `NOT JUDGED: ${error.message}`;
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

say();
const byHand = [values['build-android'], values['build-ios'], values.licence];
if (byHand.some((value) => value === undefined)) {
  say(
    'Go/no-go: not computed. Give --build-android, --build-ios and --licence, ' +
      'each as read by hand (passed, failed, or not shown on simulators).',
  );
} else {
  const verdicts = goNoGoInput({
    entries,
    build: { android: values['build-android'], ios: values['build-ios'] },
    licence: values.licence,
  });
  say('Go/no-go (goNoGoInput, then goNoGo):');
  say();
  say(goNoGo(verdicts).text);
}

/** The one or two facts about a run worth seeing next to its status. */
function highlight(run) {
  const d = run.details ?? {};
  const parts = [];
  if (Number.isFinite(d.largestGapMs))
    parts.push(`largest gap ${Math.round(d.largestGapMs / 1000)} s`);
  if (d.capture) {
    const problems = d.capture.problems?.length ?? 0;
    const clock = Number.isFinite(d.capture.clock?.offsetMs)
      ? `, pcap ${(d.capture.clock.offsetMs / 1000).toFixed(1)} s behind`
      : '';
    parts.push(`capture ${d.capture.status}${problems ? ` (${problems} problems)` : ''}${clock}`);
  }
  if (d.restrictions) parts.push(`in force: ${d.restrictions.inForce.join(', ') || 'none'}`);
  if (Number.isFinite(d.reportDelayMs))
    parts.push(`report after ${Math.round(d.reportDelayMs / 1000)} s`);
  if (typeof d.processEnded === 'boolean') {
    parts.push(`process ended: ${d.processEnded}, ${d.arrivalsAfterChange} arrival(s) after`);
  }
  if (Number.isFinite(d.reminderDelayMs))
    parts.push(`reminder after ${Math.round(d.reminderDelayMs / 1000)} s`);
  if (d.seen) parts.push(`seen ${d.seen}, heard ${d.heard}, text ${d.text}`);
  if (typeof d.callStarted === 'boolean') {
    parts.push(`call started on the tap: ${d.callStarted}, placed by ${d.placedBy ?? 'nobody'}`);
  }
  if ('presented' in d) parts.push(`presented ${d.presented}, text ${d.text}`);
  if (d.alignment) parts.push(`16 KB aligned: ${d.alignment.aligned16k}`);
  if (Array.isArray(d.missing) && d.missing.length > 0)
    parts.push(`${d.missing.length} held record(s) missing`);
  return parts.join('; ');
}
