// The git questions the gates ask: what changed, and what did it look like before.
import { run } from './proc.mjs';

const git = (args, cwd) => run('git', args, { cwd, timeout: 60_000 });

/** The merge base with `base`, or null when there is no such branch (a fresh clone, a local repo). */
export function mergeBase(base, cwd = process.cwd()) {
  const result = git(['merge-base', 'HEAD', base], cwd);
  return result.ok ? result.output.trim() : null;
}

/**
 * Every file this branch touches: committed since the merge base, changed in the
 * working tree, or not yet added. Paths are relative to the repository root.
 *
 * @param {{ base?: string, cwd?: string }} options
 */
export function changedFiles({ base = 'origin/main', cwd = process.cwd() } = {}) {
  const outputs = [
    git(['diff', '--name-only', 'HEAD'], cwd),
    git(['ls-files', '--others', '--exclude-standard'], cwd),
  ];
  const since = mergeBase(base, cwd);
  if (since !== null) {
    outputs.push(git(['diff', '--name-only', since, 'HEAD'], cwd));
  }
  const files = new Set();
  for (const result of outputs) {
    if (!result.ok) {
      continue;
    }
    for (const line of result.output.split('\n')) {
      if (line.trim() !== '') {
        files.add(line.trim());
      }
    }
  }
  return [...files].sort();
}

/** A file's contents at a git ref, or null when it did not exist there. */
export function fileAt(ref, file, cwd = process.cwd()) {
  const result = git(['show', `${ref}:${file}`], cwd);
  return result.ok ? result.output : null;
}
