// The git questions the gates ask: what changed, and what did it look like before.
import { run } from './proc.mjs';

const git = (args, cwd) => run('git', args, { cwd, timeout: 60_000 });

/** The merge base with `base`, or null when there is no such branch (a fresh clone, a local repo). */
export function mergeBase(base, cwd = process.cwd()) {
  const result = git(['merge-base', 'HEAD', base], cwd);
  return result.ok ? result.output.trim() : null;
}

/**
 * The merge base with `base`, or a refusal when git cannot resolve it (D-131).
 *
 * Every gate that reads what this branch changes asks this first. Without a
 * merge base, changedFiles() drops the committed diff, so "could not tell" and
 * "nothing changed" would arrive as the same empty list, and the gate would
 * pass on a question nobody answered (BUG-46). The message names the base and
 * says that it could not tell; the caller prefixes its own name and exits 1.
 *
 * @returns {{ ok: true, mergeBase: string } | { ok: false, message: string }}
 */
export function requireMergeBase(base, cwd = process.cwd()) {
  const since = mergeBase(base, cwd);
  if (since !== null) {
    return { ok: true, mergeBase: since };
  }
  return {
    ok: false,
    message:
      `git found no merge base with ${base} (no such branch, no history shared with HEAD, ` +
      'or no repository here), so this gate could not tell what this branch changes. ' +
      'Refusing to answer "nothing to check": not knowing is not the same as having ' +
      'nothing to check (D-131). Fetch it (git fetch origin), or run the gate against a ' +
      'base that exists.',
  };
}

/**
 * Every file this branch touches: committed since the merge base, changed in the
 * working tree, or not yet added. Paths are relative to the repository root.
 *
 * A moved file is listed under both paths: the one it left and the one it went
 * to. With git's default rename detection, `git diff --name-only` names only the
 * new path, so a move out of code (say to docs/) would look like a docs-only
 * change and every gate that reads this list would skip it (BUG-7). With
 * `--no-renames`, git reports a move as a deletion plus an addition.
 *
 * @param {{ base?: string, cwd?: string }} options
 */
export function changedFiles({ base = 'origin/main', cwd = process.cwd() } = {}) {
  const outputs = [
    git(['diff', '--name-only', '--no-renames', 'HEAD'], cwd),
    git(['ls-files', '--others', '--exclude-standard'], cwd),
  ];
  const since = mergeBase(base, cwd);
  if (since !== null) {
    outputs.push(git(['diff', '--name-only', '--no-renames', since, 'HEAD'], cwd));
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
