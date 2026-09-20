#!/usr/bin/env node
// HK-08: work that is not written down is work the next session cannot continue.
//
// Sessions here are short and there are many of them, so docs/progress.md is the
// handover. This checks that a session which changed code also said what it did.
//
//   (no flag)      refuses "done" once, the way the stop gate does
//   --warn-only    says so and records it, for session end and compaction,
//                  where blocking would only lose work
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { changedFiles } from '../../scripts/lib/git.mjs';
import { block, hasFlag, readInput } from './lib.mjs';

const PROGRESS = 'docs/progress.md';

/** Changes that need a line in the progress log: everything but documents and reviewer notes. */
export function needsLogging(files) {
  return files.filter(
    (file) => !file.startsWith('docs/') && !file.startsWith('.claude/agent-memory/'),
  );
}

const input = await readInput();
const cwd = input.cwd || process.cwd();
const marker = path.join(cwd, '.claude/state/progress-missing');

const changed = changedFiles({ cwd });
const unlogged = needsLogging(changed);

if (unlogged.length === 0 || changed.includes(PROGRESS)) {
  rmSync(marker, { force: true });
  process.exit(0);
}

const message =
  `HK-08: this branch changes ${String(unlogged.length)} file(s) outside docs/, but ${PROGRESS} ` +
  'has not been updated. The next session starts by reading it, so write down what was built, ' +
  'what was verified and what is left — then finish.';

if (hasFlag('--warn-only') || input.stop_hook_active) {
  mkdirSync(path.dirname(marker), { recursive: true });
  writeFileSync(marker, `${new Date().toISOString()} ${message}\n`);
  process.stdout.write(message + '\n');
  process.exit(0);
}

block(message);
