#!/usr/bin/env node
// HK-08: work that is not written down is work the next session cannot continue.
//
// Sessions here are short and there are many of them, so the progress log is the
// handover. This checks that a session which changed code also said what it did.
//
// The log is two files: docs/progress.md carries the current state and is kept
// short, because every session is told to read it first; docs/progress/m0.md
// carries the narrative. Writing to either counts. Requiring the short one
// specifically would force a decorative edit whenever a change moves no task
// status — which is the churn that splitting it was meant to remove.
//
//   (no flag)      refuses "done" once, the way the stop gate does
//   --warn-only    says so and records it, for session end and compaction,
//                  where blocking would only lose work
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { changedFiles } from '../../scripts/lib/git.mjs';
import { block, hasFlag, readInput } from './lib.mjs';

const PROGRESS = ['docs/progress.md', 'docs/progress/m0.md'];

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

if (unlogged.length === 0 || PROGRESS.some((file) => changed.includes(file))) {
  rmSync(marker, { force: true });
  process.exit(0);
}

const message =
  `HK-08: this branch changes ${String(unlogged.length)} file(s) outside docs/, but neither ` +
  `${PROGRESS.join(' nor ')} has been updated. The next session starts by reading them, so ` +
  'write the narrative — what was built, what was verified, what is left — to the second, and ' +
  'correct the first if a task status changed. Then finish.';

if (hasFlag('--warn-only') || input.stop_hook_active) {
  mkdirSync(path.dirname(marker), { recursive: true });
  writeFileSync(marker, `${new Date().toISOString()} ${message}\n`);
  process.stdout.write(message + '\n');
  process.exit(0);
}

block(message);
