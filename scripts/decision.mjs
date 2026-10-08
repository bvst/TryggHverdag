#!/usr/bin/env node
/**
 * BUG-39: prints the decisions asked for, each in full, from
 * docs/plan/decisions.md. The file is over 4,400 lines; an agent should read
 * the decision it needs, not the file.
 *
 * A decision's section runs from its `## D-NNN — …` heading to the line before
 * the next `## ` heading, so its amendments and `### ` sub-headings come with
 * it. Sections are printed in the order asked. An ID with no section fails
 * loudly (exit 1, named on stderr); the ones found are still printed.
 *
 * Usage: pnpm run decision D-NNN [D-NNN ...]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DECISIONS = path.join(import.meta.dirname, '..', 'docs', 'plan', 'decisions.md');
const USAGE =
  'Usage: pnpm run decision D-NNN [D-NNN ...]  prints each decision from docs/plan/decisions.md in full';

/**
 * Each asked-for decision's section, in the order asked, and the IDs that have
 * none. A number two decisions share brings back both, in file order: printing
 * one of two would hide the other.
 *
 * @param {string} text the decision log
 * @param {string[]} ids e.g. ['D-119', 'D-068']
 * @returns {{ sections: string[], missing: string[] }}
 */
export function decisionSections(text, ids) {
  const lines = text.split('\n');
  const headings = lines.flatMap((line, at) => (line.startsWith('## ') ? [at] : []));
  const all = headings.flatMap((at, index) => {
    const id = /^## (?<id>D-\d{3})\b/.exec(lines[at] ?? '')?.groups?.id;
    if (id === undefined) return [];
    const end = headings[index + 1] ?? lines.length;
    return [{ id, text: lines.slice(at, end).join('\n').trimEnd() }];
  });
  const sections = [];
  const missing = [];
  for (const id of ids) {
    const found = all.filter((section) => section.id === id);
    if (found.length === 0) missing.push(id);
    sections.push(...found.map((section) => section.text));
  }
  return { sections, missing };
}

function main() {
  // pnpm passes a literal `--` through to the script.
  const ids = process.argv.slice(2).filter((arg) => arg !== '--');
  if (ids.length === 0 || !ids.every((id) => /^D-\d{3}$/.test(id))) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 1;
    return;
  }
  const { sections, missing } = decisionSections(readFileSync(DECISIONS, 'utf8'), ids);
  if (sections.length > 0) process.stdout.write(`${sections.join('\n\n')}\n`);
  if (missing.length > 0) {
    process.stderr.write(`No section in docs/plan/decisions.md for ${missing.join(', ')}.\n`);
    process.exitCode = 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  main();
}
