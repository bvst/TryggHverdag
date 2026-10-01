#!/usr/bin/env node
// SPIKE-01-AC13: re-judges a night from its saved run folders with today's
// per-run judge (analysis/judge-run.mjs), without repeating any device run.
//
//   node drivers/rejudge.mjs --night night-YYYYMMDD
//
// It reads ~/spike-runs/<night>/manifest.jsonl and each run's folder, and
// writes ~/spike-runs/<night>/manifest.rejudged.jsonl: every line as it was,
// each run's status, evidence and details replaced by the re-judge's, and the
// original kept under `rejudged.before`, with the commit that judged it and
// whether its tree was dirty (the code review, loop 2). Each run is judged with
// the exit its driver had (the manifest's exitCode).
//
// The original manifest and the run folders are only read: the manifest's
// sha256 is checked after writing, and an earlier re-judge is kept under its
// own time, never overwritten. Run folders of the night with no line in the
// manifest are found by the runner's own folder pattern (lib/plan.mjs) and
// listed, not added. Then it prints every run whose status changed.
//
// Thin glue: every rule is in the analysis.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { judgeRunFolder } from './lib/judge.mjs';
import { runFolder } from './lib/plan.mjs';
import { REPOSITORY, RUNS } from './lib/run.mjs';

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
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const git = (...args) =>
  execFileSync('git', ['-C', REPOSITORY, ...args], { encoding: 'utf8' }).trim();

/** The commit that judges, and whether the tree differs from it. */
const judgedBy = { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '' };
const sourceHash = sha256(source);

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
  const before = entry.rejudged?.before ?? {
    status: entry.status,
    evidence: entry.evidence,
    details: entry.details,
  };
  return {
    ...entry,
    status: result.status,
    evidence: result.evidence,
    details: result.details,
    rejudged: { at: rejudgedAt, ...judgedBy, before },
  };
});

// Run folders of the night that the manifest never recorded: listed, not added.
const recorded = new Set(entries.filter((e) => e.kind === 'run').map((e) => e.runId));
const unrecorded = readdirSync(RUNS).filter(
  (name) => runFolder(night, name) !== null && !recorded.has(name),
);

/** The earlier re-judge's status of each run, to say what changed since it. */
const earlier = new Map();
if (existsSync(target)) {
  for (const line of readFileSync(target, 'utf8').split('\n').filter(Boolean)) {
    const entry = JSON.parse(line);
    if (entry.kind === 'run') earlier.set(entry.runId, entry.status);
  }
  const stamp = new Date(rejudgedAt)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const kept = join(dir, `manifest.rejudged.${stamp}.jsonl`);
  renameSync(target, kept);
  say(`the earlier re-judge is kept as ${kept}`);
}
const temporary = `${target}.partial`;
writeFileSync(temporary, lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
renameSync(temporary, target);

if (sha256(source) !== sourceHash) {
  process.stderr.write(`the original manifest ${source} changed while it was re-judged\n`);
  process.exit(1);
}
say(`re-judged ${recorded.size} run(s) of ${night} into ${target}`);
say(
  `judged by ${judgedBy.commit}${judgedBy.dirty ? ' (the tree was dirty)' : ''}; ` +
    `the original manifest, ${source}, was only read (sha256 unchanged)`,
);
if (unrecorded.length > 0) {
  say(`run folders with no line in the manifest (not added): ${unrecorded.join(', ')}`);
}
say();
if (changes.length === 0) {
  say('no run changed its status from the original manifest');
} else {
  say(`${changes.length} run(s) changed from the original manifest:`);
  for (const { runId, from, to, result } of changes) {
    say(`- ${runId}: ${from} -> ${to}`);
    for (const line of result.evidence.slice(0, 4)) say(`    ${line}`);
  }
}
if (earlier.size > 0) {
  const since = lines.filter(
    (line) =>
      line.kind === 'run' && earlier.has(line.runId) && earlier.get(line.runId) !== line.status,
  );
  say(
    since.length === 0
      ? 'no run changed its status since the earlier re-judge'
      : `${since.length} run(s) changed since the earlier re-judge: ` +
          since
            .map((line) => `${line.runId} ${earlier.get(line.runId)} -> ${line.status}`)
            .join('; '),
  );
}
