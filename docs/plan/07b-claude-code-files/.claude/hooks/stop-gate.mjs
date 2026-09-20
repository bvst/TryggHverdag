#!/usr/bin/env node
// Refuses "done" while the quick gate fails (RG-01, RG-02).
// Fast path when nothing changed. During the red phase of /feature (tests
// intentionally failing), only static checks run.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { readInput, hasFlag, block, tail } from './lib.mjs';

const input = await readInput();
const cwd = input.cwd || process.cwd();
const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

const changed = new Set();
for (const out of [
  git('diff', '--name-only', 'HEAD').stdout,
  git('ls-files', '--others', '--exclude-standard').stdout,
  (() => { const mb = git('merge-base', 'HEAD', 'origin/main'); return mb.status === 0 ? git('diff', '--name-only', mb.stdout.trim(), 'HEAD').stdout : ''; })(),
]) for (const f of (out || '').split('\n')) if (f.trim()) changed.add(f.trim());
const codeChanged = [...changed].some((f) => !f.startsWith('docs/') && !f.startsWith('.claude/agent-memory/'));
if (!codeChanged || !existsSync(path.join(cwd, 'package.json'))) process.exit(0);

const phaseFile = path.join(cwd, '.claude/state/phase');
const red = !hasFlag('--subagent') && existsSync(phaseFile) && readFileSync(phaseFile, 'utf8').startsWith('red:');
const script = red ? 'gate:static' : 'gate:quick';
const r = spawnSync('pnpm', ['-s', script], { cwd, encoding: 'utf8', timeout: 590_000 });
const failedFile = path.join(cwd, '.claude/state/gate-failed');

if (r.status === 0 && !r.error) { rmSync(failedFile, { force: true }); process.exit(0); }

const details = r.error ? r.error.message : tail((r.stdout ?? '') + (r.stderr ?? ''));
if (input.stop_hook_active) {
  // Already asked to continue once: record loudly instead of looping forever.
  // session-start and /status surface this file, and CI blocks the merge anyway.
  mkdirSync(path.dirname(failedFile), { recursive: true });
  writeFileSync(failedFile, `${new Date().toISOString()} ${script} failed\n${details}\n`);
  process.exit(0);
}
block(`Not done: "${script}" is failing (RG-01, RG-02).\n${details}\n` +
      'Fix the failures. If they were already failing on main, say so explicitly in your summary.');
