#!/usr/bin/env node
// Prints a short orientation at session start (added to Claude's context).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const lines = [];
const readme = path.join(cwd, 'docs/plan/README.md');
if (existsSync(readme)) {
  const txt = readFileSync(readme, 'utf8');
  const cur = txt.match(/\*\*Current section:\*\*[^\n]*/);
  if (cur) lines.push(cur[0]);
  const todos = txt.split('\n').filter((l) => /^\| A-\d+/.test(l) && l.includes('⬜'));
  if (todos.length) lines.push('Owner to-dos open:', ...todos.map((l) => '  ' + l.split('|')[1].trim() + ' ' + l.split('|')[2].trim().slice(0, 90)));
}
const br = spawnSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' });
if (br.status === 0) lines.push(`Branch: ${br.stdout.trim()}`);
const phase = path.join(cwd, '.claude/state/phase');
if (existsSync(phase)) lines.push(`⚠ Red-phase marker present since ${statSync(phase).mtime.toISOString()}: ${readFileSync(phase, 'utf8').trim()}`);
const failed = path.join(cwd, '.claude/state/gate-failed');
if (existsSync(failed)) lines.push('⚠ The last stop gate FAILED and was not resolved:', readFileSync(failed, 'utf8').slice(0, 600));
const pr = spawnSync('gh', ['pr', 'list', '--limit', '5'], { cwd, encoding: 'utf8', timeout: 10_000 });
if (pr.status === 0 && pr.stdout.trim()) lines.push('Open pull requests:', pr.stdout.trim());
process.stdout.write(lines.join('\n') + '\n');
