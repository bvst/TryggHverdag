#!/usr/bin/env node
// Refuses "done" while the quick gate fails (RG-01, RG-02).
// Fast path when nothing changed. During the red phase of /feature (tests
// intentionally failing), only static checks run. A gate that already passed
// on exactly this work does not run again (BUG-31, D-119).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { readInput, hasFlag, block, tail } from './lib.mjs';

// D-119: a CI review job changes no code, and CI's required checks run the
// same gates on the same commit. Both variables, so neither another CI job nor
// a local session can turn the gate off by accident.
if (process.env.GITHUB_ACTIONS === 'true' && process.env.TRYGGHVERDAG_REVIEW_JOB === '1') {
  process.exit(0);
}

const input = await readInput();
const cwd = input.cwd || process.cwd();
const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

// --no-renames: a moved file counts under the path it left too, so code moved
// to docs/ still runs the gate (BUG-7).
const changed = new Set();
for (const out of [
  git('diff', '--name-only', '--no-renames', 'HEAD').stdout,
  git('ls-files', '--others', '--exclude-standard').stdout,
  (() => {
    const mb = git('merge-base', 'HEAD', 'origin/main');
    return mb.status === 0
      ? git('diff', '--name-only', '--no-renames', mb.stdout.trim(), 'HEAD').stdout
      : '';
  })(),
])
  for (const f of (out || '').split('\n')) if (f.trim()) changed.add(f.trim());
const codeChanged = [...changed].some(
  (f) => !f.startsWith('docs/') && !f.startsWith('.claude/agent-memory/'),
);
if (!codeChanged || !existsSync(path.join(cwd, 'package.json'))) process.exit(0);

const phaseFile = path.join(cwd, '.claude/state/phase');
const red =
  !hasFlag('--subagent') &&
  existsSync(phaseFile) &&
  readFileSync(phaseFile, 'utf8').startsWith('red:');
const script = red ? 'gate:static' : 'gate:quick';

// The work as it is before the gate runs: the gate, the commit, the merge base,
// every tracked change and every untracked file with its contents. The hooks'
// own notes in .claude/state/ are not the work. Raw bytes, so no decoding can
// make two different contents look the same.
const WORK = [':/', ':(exclude).claude/state'];
const raw = (args, stdin) => {
  const r = spawnSync('git', args, { cwd, input: stdin, maxBuffer: Infinity });
  return r.status === 0 ? r.stdout : null;
};
function fingerprintOf(gate) {
  const untracked = raw(['ls-files', '-z', '--others', '--exclude-standard', '--', ...WORK]);
  const paths = untracked?.toString().replaceAll('\0', '\n');
  const parts = [
    raw(['rev-parse', 'HEAD']),
    raw(['merge-base', 'HEAD', 'origin/main']) ?? 'no merge base',
    raw(['diff', 'HEAD', '--binary', '--no-ext-diff', '--no-textconv', '--', ...WORK]),
    untracked,
    // Hashes the files' contents without writing them to git's object store.
    untracked && raw(['hash-object', '--no-filters', '--stdin-paths'], paths),
  ];
  // Something git could not read (an untracked nested repository, a dangling
  // link) is something the fingerprint cannot vouch for: run the gate.
  if (parts.includes(null)) return null;
  const hash = createHash('sha256').update(gate);
  for (const part of parts) hash.update('\0').update(part);
  return hash.digest('hex');
}

const fingerprint = fingerprintOf(script);
const passedFile = path.join(cwd, '.claude/state/gate-passed');
if (
  fingerprint &&
  existsSync(passedFile) &&
  readFileSync(passedFile, 'utf8').trim() === fingerprint
) {
  process.exit(0);
}

const r = spawnSync('pnpm', ['-s', script], { cwd, encoding: 'utf8', timeout: 590_000 });
const failedFile = path.join(cwd, '.claude/state/gate-failed');

if (r.status === 0 && !r.error) {
  rmSync(failedFile, { force: true });
  if (fingerprint) {
    mkdirSync(path.dirname(passedFile), { recursive: true });
    writeFileSync(passedFile, `${fingerprint}\n`);
  }
  process.exit(0);
}
// A failed run is never remembered.
rmSync(passedFile, { force: true });

const details = r.error ? r.error.message : tail((r.stdout ?? '') + (r.stderr ?? ''));
if (input.stop_hook_active) {
  // Already asked to continue once: record loudly instead of looping forever.
  // session-start and /status surface this file, and CI blocks the merge anyway.
  mkdirSync(path.dirname(failedFile), { recursive: true });
  writeFileSync(failedFile, `${new Date().toISOString()} ${script} failed\n${details}\n`);
  process.exit(0);
}
block(
  `Not done: "${script}" is failing (RG-01, RG-02).\n${details}\n` +
    'Fix the failures. If they were already failing on main, say so explicitly in your summary.',
);
