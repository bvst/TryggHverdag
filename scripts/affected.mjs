#!/usr/bin/env node
// CI-12: tell the workflow whether this diff has anything for the code gates.
//
// Prints a GitHub Actions output line, and prints to the log what it decided
// and why. The "why" is not decoration: without it, the next person wondering
// "why did the whole suite run for a typo fix" has to reconstruct the answer
// from the diff.
//
//   node scripts/affected.mjs --base origin/main
//
// It never says "skip this job". It says whether there is work, and each job
// decides what to do with that — because a skipped job reports as a green tick
// and a green tick for work nobody did is what this repository must not produce.
//
// This runs BEFORE actions/setup-node in every job, on whatever Node the runner
// ships rather than the version .nvmrc pins. That is deliberate: setting up Node
// is most of what a job pays for on an inert diff, so asking the question after
// paying for the answer would give most of the saving back. The price is a
// standing constraint on this file — it must import only stable Node built-ins
// and repository-local modules, never a dependency and never a recent-version
// API. It imports node:fs and two local modules, and should stay that way.
// (test-auditor noted the version gap on #17; it is a trade, not an oversight.)
import { appendFileSync } from 'node:fs';
import { changedFiles, mergeBase } from './lib/git.mjs';
import { onlyInert, reasons } from './lib/affected.mjs';

const args = process.argv.slice(2);
const base = args[args.indexOf('--base') + 1] ?? 'origin/main';

// "Nothing changed" and "could not tell" must not be the same answer (D-045).
//
// changedFiles() swallows a git call that fails — `if (!result.ok) continue` —
// and drops the committed-diff source entirely when the merge base will not
// resolve. On a clean CI checkout there is nothing in the working tree either,
// so the answer comes back as an empty list. onlyInert([]) is true, and every
// guarded step in every job would then sit out and report success: the whole
// suite green on a question nobody answered.
//
// That is precisely the silent pass CI-12 exists to prevent, so it would be a
// poor place to have one. code-reviewer flagged the risk on #17 as pre-existing
// and out of scope; it is in scope for the script that depends on it.
if (mergeBase(base) === null) {
  console.error(`affected: the merge base with ${base} will not resolve, so what`);
  console.error('this diff changes cannot be established.');
  console.error('');
  console.error('Refusing to answer "nothing to check": every gate would pass on that,');
  console.error('and not knowing is not the same as having nothing to check.');
  process.exit(1);
}

const changed = changedFiles({ base });
const inert = onlyInert(changed);
const why = reasons(changed);

if (inert) {
  console.log(
    `affected: ${String(changed.length)} changed file(s), all documentation or reviewer memory.`,
  );
  console.log('The code gates have nothing to check on this diff, and will say so.');
} else {
  console.log(`affected: ${String(why.length)} changed file(s) the code gates care about:`);
  for (const file of why.slice(0, 20)) console.log(`  ${file}`);
  if (why.length > 20) console.log(`  … and ${String(why.length - 20)} more`);
}

const line = `code=${inert ? 'false' : 'true'}`;
console.log(line);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
