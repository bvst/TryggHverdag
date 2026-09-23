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
import { appendFileSync } from 'node:fs';
import { changedFiles } from './lib/git.mjs';
import { onlyInert, reasons } from './lib/affected.mjs';

const args = process.argv.slice(2);
const base = args[args.indexOf('--base') + 1] ?? 'origin/main';

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
