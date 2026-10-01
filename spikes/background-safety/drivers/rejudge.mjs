#!/usr/bin/env node
// SPIKE-01-AC13: re-judges a night from its saved run folders with today's
// per-run judge (analysis/judge-run.mjs), without repeating any device run.
//
//   node drivers/rejudge.mjs --night night-YYYYMMDD
//
// It reads ~/spike-runs/<night>/manifest.jsonl and each run's folder, and
// writes ~/spike-runs/<night>/manifest.rejudged.jsonl: every line as it was,
// each run's status, evidence and details replaced by the re-judge's, and the
// original kept under `before`. The original manifest and the run folders are
// only read, never written. Each run is judged with the exit its driver had
// (the manifest's exitCode). Then it prints every run whose status changed.
//
// Thin glue: every rule is in the analysis.
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { judgeRunFolder } from './lib/judge.mjs';
import { RUNS } from './lib/run.mjs';

const { values } = parseArgs({ options: { night: { type: 'string' } } });
const night = values.night;
if (!night || !/^(night|smoke)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(night)) {
  process.stderr.write('give --night night-YYYYMMDD\n');
  process.exit(2);
}
const dir = join(RUNS, night);
const source = join(dir, 'manifest.jsonl');
if (!existsSync(source)) {
  process.stderr.write(`no manifest at ${source}\n`);
  process.exit(2);
}
const target = join(dir, 'manifest.rejudged.jsonl');
const say = (line = '') => process.stdout.write(`${line}\n`);

const entries = readFileSync(source, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const rejudgedAt = Date.now();
const changes = [];
const lines = entries.map((entry) => {
  if (entry.kind !== 'run') return entry;
  const exit = { code: entry.exitCode ?? null, signal: entry.signal ?? null };
  const result = judgeRunFolder(join(RUNS, entry.runId), exit);
  if (result.status !== entry.status) {
    changes.push({ runId: entry.runId, from: entry.status, to: result.status, result });
  }
  return {
    ...entry,
    status: result.status,
    evidence: result.evidence,
    details: result.details,
    rejudged: {
      at: rejudgedAt,
      before: { status: entry.status, evidence: entry.evidence, details: entry.details },
    },
  };
});

// Run folders of the night that the manifest never recorded: said, not added.
const recorded = new Set(entries.filter((e) => e.kind === 'run').map((e) => e.runId));
const unrecorded = readdirSync(RUNS).filter(
  (name) => name.startsWith(`${night}-`) && !recorded.has(name),
);

const temporary = `${target}.partial`;
writeFileSync(temporary, lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
renameSync(temporary, target);

say(`re-judged ${recorded.size} run(s) of ${night} into ${target}`);
say(`the original manifest, ${source}, was only read`);
if (unrecorded.length > 0) {
  say(`run folders with no line in the manifest (not added): ${unrecorded.join(', ')}`);
}
say();
if (changes.length === 0) {
  say('no run changed its status');
} else {
  say(`${changes.length} run(s) changed:`);
  for (const { runId, from, to, result } of changes) {
    say(`- ${runId}: ${from} -> ${to}`);
    for (const line of result.evidence.slice(0, 4)) say(`    ${line}`);
  }
}
