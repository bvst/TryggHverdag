// CI-12: a gate with nothing to check should run, say so, and pass — never be
// skipped.
//
// The distinction is the whole point, and `ci.yml` already states it:
//
//   "a skipped job reports as a green tick, and a green tick for work nobody
//    did is the one thing this repository must not produce"
//
// So this does not gate jobs with `paths:` or a job-level `if:`. Either would
// leave a required check reporting green — or, worse, never reporting at all,
// which deadlocks the pull request: #16 sat unmergeable for half an hour for
// exactly that reason, and it was not obvious why.
//
// Instead each job still runs, asks this, and either does its work or prints
// what it decided and why. `mutation` has worked this way since INF-04
// (`--only-if-safety-paths-changed`); this generalises the same idea.
//
// What it buys: the install and the script, not the runner. A job that skips
// its work still costs a checkout — a few seconds against thirty or forty.
// That is the honest trade, and it is worth naming rather than claiming the
// jobs "do not run".

/**
 * Files that cannot change the outcome of a type check, a lint, a test or an
 * audit — so a diff made only of these leaves those gates nothing to do.
 *
 * Deliberately short. Anything not listed counts as code, because the cost of
 * being wrong is asymmetric: running a gate that had nothing to find wastes a
 * minute, and skipping one that did is a defect reaching `main` with a green
 * tick over it.
 *
 * Notably absent, and none of them by accident:
 *   .claude/hooks/    tested by test:hooks and linted by gate:static
 *   scripts/          the gates themselves
 *   .github/          the workflows, which scripts/gate.test.mjs asserts on
 *
 * Markdown and `docs/` are also exactly what `.prettierignore` excludes, for
 * the same underlying reason: prose here is wrapped by hand and no tool reads
 * it. That is agreement, not coupling — if `.prettierignore` changed, this
 * would need its own argument rather than inheriting one.
 */
export const INERT = [
  // Markdown, except under .claude/ — and that exception is the whole subtlety.
  // Most of .claude/ is markdown that is *configuration*: scripts/ai-review.test.mjs
  // reads .claude/agents/*.md and asserts on their contents, so editing a
  // reviewer brief really can fail `unit`. CLAUDE.md is the same kind of file.
  // A blanket "markdown is prose" rule was the first draft here and a test of
  // this module caught it.
  // CLAUDE.md is named alongside /.claude/ here for the reason CODEOWNERS
  // names it: it states the non-negotiables and is loaded into every session.
  // No test reads it today, so it would pass as prose on the letter of the
  // rule — which is an argument for excluding it, not for including it. The
  // cost of being wrong is one avoidable CI run on a file that changes rarely.
  (file) => file.endsWith('.md') && !file.startsWith('.claude/') && file !== 'CLAUDE.md',
  // Written by reviewers between runs, read by nobody else. CODEOWNERS exempts
  // it for the same reason.
  (file) => file.startsWith('.claude/agent-memory/'),
];

// Deliberately NOT "everything under docs/". docs/plan/main-ruleset.json is a
// real file that scripts/gate.test.mjs parses and asserts on, so a `docs/`
// rule would have marked a change to the merge rules as nothing to check.
// Restricting this to markdown excludes it for free — found by grepping the
// suite for what it actually reads, rather than by deciding which directories
// feel like documentation.

/**
 * True when every changed file is inert, so the code gates have nothing to
 * check on this diff.
 *
 * An empty diff answers true: there is genuinely nothing to check. It should
 * not happen on a pull request, and if it does, "nothing changed" is the
 * honest answer rather than a reason to run everything.
 *
 * @param {string[]} files paths, relative to the repository root
 * @returns {boolean}
 */
export function onlyInert(files) {
  return files.every((file) => INERT.some((isInert) => isInert(file)));
}

/**
 * The files that made a diff count as code, for the job log.
 *
 * A gate that decided to run should be able to say what made it decide —
 * otherwise the next person to wonder "why did the whole suite run for a typo
 * fix" has to reconstruct it from the diff.
 *
 * @param {string[]} files
 * @returns {string[]}
 */
export function reasons(files) {
  return files.filter((file) => !INERT.some((isInert) => isInert(file)));
}
