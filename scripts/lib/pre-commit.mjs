// HK-09: formatting should never be what turns CI red.
//
// post-edit.mjs already runs the per-file gate after Edit and Write, but it is
// a Claude Code hook and only sees those tools. Work done through Bash — a sed
// one-liner, a heredoc, a generator — never reaches it. That gap is not
// hypothetical: on #13 a test file was written with a heredoc, prettier was
// never run on it, and the formatting error survived until gate:quick happened
// to be run by hand before pushing. Without that habit it would have been a red
// CI round for whitespace.
//
// git sees every one of those paths, because they all end at a commit.
//
// What it does, and why it stops where it does (owner's decision):
//   formatting  rewritten in place and re-staged. Prettier is deterministic and
//               changes no behaviour, and "don't make me think about it" is the
//               whole point.
//   lint        reported, never fixed. A lint finding is a real defect, and
//               eslint --fix can change semantics — a commit must not contain a
//               change nobody reviewed. It blocks instead.
//
// A file that is only partly staged is checked, never rewritten. Rewriting it
// would re-stage work deliberately held back with `git add -p`, which is a way
// of losing someone's intent quietly.

// Which files are actually formatted is .prettierignore's decision, not this
// file's: it ignores `docs/` and all markdown, because prose here is wrapped by
// hand so diffs stay readable. Prettier honours that even when content is piped
// to it with --stdin-filepath (checked, not assumed). So this pattern only has
// to be wide enough not to miss anything; duplicating the ignore list here would
// give the repository two answers to the same question and let them drift.
const FORMATTABLE = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|ya?ml|md)$/;

/** What `eslint .` lints. */
const LINTABLE = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

/**
 * Split staged files by what may safely be done to them.
 *
 * A file with unstaged changes as well is "partial": its working copy holds
 * more than the commit does, so formatting it and running `git add` would pull
 * the rest in. Those are checked and reported, never written.
 *
 * @param {string[]} staged files in the index
 * @param {string[]} unstaged files with working-tree changes
 * @returns {{ writable: string[], partial: string[], lintable: string[] }}
 */
export function classify(staged, unstaged) {
  const held = new Set(unstaged);
  const formattable = staged.filter((file) => FORMATTABLE.test(file));
  return {
    writable: formattable.filter((file) => !held.has(file)),
    partial: formattable.filter((file) => held.has(file)),
    lintable: staged.filter((file) => LINTABLE.test(file)),
  };
}

/**
 * The decision the hook makes, with every effect passed in so the rules can be
 * tested without a repository, a commit or a copy of prettier.
 *
 * @param {object} io
 * @param {string[]} io.staged
 * @param {string[]} io.unstaged
 * @param {(files: string[]) => { ok: boolean, output: string }} io.format  prettier --write
 * @param {(files: string[]) => string[]} io.changed  which of those prettier really rewrote
 * @param {(files: string[]) => { ok: boolean, output: string }} io.check   prettier --check
 * @param {(files: string[]) => { ok: boolean, output: string }} io.lint    eslint
 * @param {(files: string[]) => void} io.stage                              git add
 * @returns {{ ok: boolean, formatted: string[], problems: string[] }}
 */
export function preCommit({ staged, unstaged, format, changed, check, lint, stage }) {
  const { writable, partial, lintable } = classify(staged, unstaged);
  const problems = [];
  const formatted = [];

  if (writable.length > 0) {
    const result = format(writable);
    if (!result.ok) {
      // Prettier failing to write is a parse error nine times out of ten, and
      // the file is the one thing it will name. Pass its words through rather
      // than summarising them away.
      problems.push(`Prettier could not format these files:\n${result.output.trim()}`);
    } else {
      // Only the files prettier actually rewrote. A writable file has no
      // working-tree changes by definition, so anything git now sees as
      // modified is prettier's doing and nothing else's. Staging the whole list
      // would work, but reporting it would claim credit for files .prettierignore
      // told prettier to leave alone — markdown, everything under docs/.
      const touched = changed(writable);
      if (touched.length > 0) stage(touched);
      formatted.push(...touched);
    }
  }

  if (partial.length > 0) {
    const result = check(partial);
    if (!result.ok) {
      problems.push(
        `These files are only partly staged, so they were checked and not rewritten — ` +
          `formatting them would have staged the changes you held back:\n` +
          `${partial.map((file) => `  ${file}`).join('\n')}\n` +
          `Run: pnpm run format`,
      );
    }
  }

  if (lintable.length > 0) {
    const result = lint(lintable);
    if (!result.ok) {
      problems.push(
        `ESLint found problems. These are not formatting, so they are not fixed ` +
          `for you — a commit should not carry a change nobody read:\n${result.output.trim()}`,
      );
    }
  }

  return { ok: problems.length === 0, formatted, problems };
}
