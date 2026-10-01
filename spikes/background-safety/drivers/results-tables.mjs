#!/usr/bin/env node
// SPIKE-01-AC14: prints the results document's tables, the summary and the
// numbers, through renderResults, which refuses anything shaped like a
// coordinate or a phone number (the repository is public). Glue only: every
// verdict comes from the analysis (goNoGoInput over the runner's plan, and
// judgeScenario for the counts); this only lays the rows out and rounds the
// figures. A refusal is printed and ends the script with exit code 1: the
// guard is never loosened here.
//
//   node drivers/results-tables.mjs --manifest <path> [--manifest <path> …]
//
// The summary: each scenario per platform, with its verdict and its valid and
// invalid runs. S1 is its plain case, and "S1 exempt" its own row; S3 is the
// case with the exemption, and "S3 not exempt" its own row; S5 is three rows,
// seen, heard and its text; S8 is outside the go/no-go. The numbers: each
// valid run's own figures, rounded to whole seconds or ms.
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { goNoGoInput } from '../analysis/manifest.mjs';
import { renderResults } from '../analysis/results.mjs';
import { judgeScenario } from '../analysis/runs.mjs';
import { expectedCases } from './lib/plan.mjs';

const PASSED = 'passed';
const NOT_SHOWN = 'not shown on simulators';
const NO_VERDICT = 'no verdict';

const { values } = parseArgs({ options: { manifest: { type: 'string', multiple: true } } });
const files = values.manifest ?? [];
if (files.length === 0 || files.some((file) => !existsSync(file))) {
  process.stderr.write('give --manifest <path> (once or more) of existing manifests\n');
  process.exit(2);
}
const entries = files.flatMap((file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line)),
);
const expected = expectedCases();
/** The verdicts as the go/no-go reads them; the build and the licence are not in these tables. */
const verdictsOf = (list) => goNoGoInput({ entries: list, expected, build: null, licence: null });
const verdicts = verdictsOf(entries);

/**
 * S5's seen and text lines, each from goNoGoInput's own S5 rule, given the
 * runs with only that result to read (the other set to passed). Invalid runs
 * stay invalid.
 */
const s5With = (pick) =>
  verdictsOf(
    entries.map((entry) =>
      entry.kind === 'run' && entry.scenario === 's5' && entry.status !== 'invalid'
        ? { ...entry, details: pick(entry) }
        : entry,
    ),
  ).S5;
const s5Seen = s5With(({ platform, details }) =>
  platform === 'android'
    ? { seen: details?.seen, text: PASSED }
    : { presented: details?.presented, text: PASSED },
);
const s5Text = s5With(({ platform, details }) =>
  platform === 'android'
    ? { seen: PASSED, text: details?.text }
    : { presented: true, text: details?.text },
);

/** The judged runs of a scenario's planned cases on a platform (`only`: one case). */
function runsOf(scenario, platform, only) {
  const cases = (expected[scenario]?.[platform] ?? []).filter(
    (name) => only === undefined || name === only,
  );
  return entries.filter(
    (entry) =>
      entry.kind === 'run' &&
      entry.judged !== false &&
      entry.scenario === scenario &&
      entry.platform === platform &&
      cases.includes(entry.case ?? null),
  );
}

/** A summary cell: the verdict, with the valid and invalid runs judgeScenario counts. */
function cell(verdict, scenario, platform, only) {
  const runs = runsOf(scenario, platform, only).map((entry) => ({
    id: entry.runId,
    case: entry.case ?? undefined,
    status: entry.status,
    evidence: entry.evidence,
  }));
  const { validRuns, invalidRuns } = judgeScenario({ scenario, platform, runs });
  return { verdict: verdict ?? NO_VERDICT, valid: validRuns, invalid: invalidRuns };
}
const both = (item, scenario, only) => ({
  android: cell(item.android, scenario, 'android', only),
  ios: cell(item.ios, scenario, 'ios', only),
});

const summary = [
  { scenario: 'S1', ...both(verdicts.S1, 's1', null) },
  {
    scenario: 'S1 exempt',
    android: cell(verdicts['S1 exempt']?.android, 's1', 'android', 'exempt'),
    ios: null,
  },
  { scenario: 'S2', ...both(verdicts.S2, 's2') },
  { scenario: 'S3', android: cell(verdicts.S3.android, 's3', 'android', 'exempt'), ios: null },
  {
    scenario: 'S3 not exempt',
    android: cell(verdicts['S3 not exempt'].android, 's3', 'android', 'not-exempt'),
    ios: null,
  },
  { scenario: 'S4', ...both(verdicts.S4, 's4') },
  { scenario: 'S5 seen', ...both(s5Seen, 's5') },
  { scenario: 'S5 heard', ...both(verdicts['S5 heard'], 's5') },
  { scenario: 'S5 text', ...both(s5Text, 's5') },
  {
    scenario: 'S6',
    android: cell(verdicts.S6.android, 's6', 'android'),
    ios: { verdict: NOT_SHOWN, valid: 0, invalid: 0 },
  },
  { scenario: 'S7', ...both(verdicts.S7, 's7') },
  { scenario: 'S8', outsideGoNoGo: true, ...both(verdicts.S8, 's8') },
];

const seconds = (ms) => Math.round(ms / 1000);
const isMs = (value) => Number.isFinite(value);

/** Each valid run's own figures, rounded, with its run. */
function numbersOf(entry) {
  const d = entry.details ?? {};
  const scenario =
    entry.scenario === 's1' && entry.case === 'exempt' ? 'S1 exempt' : entry.scenario.toUpperCase();
  const number = (name, value, unit) => ({
    scenario,
    platform: entry.platform,
    run: entry.runId,
    name,
    value,
    unit,
  });
  const list = [];
  if (entry.scenario === 's1' || entry.scenario === 's3') {
    if (isMs(d.largestGapMs)) list.push(number('largest gap', seconds(d.largestGapMs), 's'));
    if (Number.isInteger(d.gapsOver60s)) list.push(number('gaps over 60 s', d.gapsOver60s, ''));
    if (Number.isInteger(d.gapsOver120s)) list.push(number('gaps over 120 s', d.gapsOver120s, ''));
  } else if (entry.scenario === 's2') {
    if (d.arrivalsStopped === false && isMs(d.largestGapMs)) {
      list.push(
        number(
          'arrivals continued after the app was ended; largest gap',
          seconds(d.largestGapMs),
          's',
        ),
      );
    } else if (isMs(d.reminderDelayMs)) {
      list.push(number('reminder after the last arrival', seconds(d.reminderDelayMs), 's'));
    } else if (d.arrivalsStopped === true) {
      list.push(number('reminders after the last arrival', 0, ''));
    }
  } else if (entry.scenario === 's4') {
    if (Array.isArray(d.missing)) list.push(number('held records missing', d.missing.length, ''));
    if (isMs(d.firstArrivalAfterReconnectMs)) {
      const first = Math.round(d.firstArrivalAfterReconnectMs);
      list.push(number('first held record after reconnecting', first, 'ms'));
    }
    if (isMs(d.lastArrivalAfterReconnectMs)) {
      const last = Math.round(d.lastArrivalAfterReconnectMs);
      list.push(number('last held record after reconnecting', last, 'ms'));
    }
  } else if (entry.scenario === 's6') {
    if (typeof d.callStarted === 'boolean') {
      list.push(number('call started on the tap (1 yes, 0 no)', d.callStarted ? 1 : 0, ''));
    }
  } else if (entry.scenario === 's7') {
    if (isMs(d.reportDelayMs)) {
      list.push(number('report after the change', Math.round(d.reportDelayMs), 'ms'));
    } else if (Number.isInteger(d.arrivalsAfterChange)) {
      list.push(number('no report of the change; arrivals after it', d.arrivalsAfterChange, ''));
    }
  }
  return list;
}

const numbers = entries
  .filter((entry) => entry.kind === 'run' && entry.status !== 'invalid')
  .flatMap(numbersOf);

try {
  process.stdout.write(renderResults({ summary, numbers }));
} catch (error) {
  process.stderr.write(`renderResults refused the tables: ${error.message}\n`);
  process.exit(1);
}
