---
name: matcher-helper-changes
description: How to audit an RG-03 claim that a hand-written glob/CODEOWNERS reader in a test got "stricter, never looser"; fuzz old vs new for superset, diff today's verdicts, check self-check pairs against the real engine, plant faults per new branch
metadata:
  type: feedback
---

BUG-18 loop 1 (2026-10-04): gate.test.mjs's `matches` (CODEOWNERS last-match) and `globCovers` (paths-filter) were changed to read
`?`, `/**/` and a leading `**/` as GitHub/picomatch do, with RG-03 reasons saying "stricter, never looser, except a later owned
line matching more". All three parts of that claim can be checked in seconds, no repo writes:
1. **Superset:** load both helper versions with `new Function(block + 'return {matches, globCovers}')` from `git show <rev>:file`
   (slice from `const matches = (` to the next `\n  };\n`), then fuzz ~400k random pattern/path pairs from tokens
   [a, b, ., /, *, **, ?, /**/, **/, /**]. Any old-true/new-false pair disproves it. (0 found.)
2. **Today's verdicts unmoved:** last-match owners for every `git ls-tree -r` file under both helpers; globCovers for every
   quoted ai-review.yml entry x file. A diff outside the safety filter (a `ui` entry) is irrelevant if only safety entries are read.
3. **Self-check pairs real:** regex the `expect(matches(p, f)).toBe(x)` pairs out of the test and run each through
   `git -c core.excludesFile=<scratch> check-ignore --no-index -q <path>` (gitignore engine) and
   `require(node_modules/.pnpm/picomatch@V/node_modules/picomatch).isMatch(f, g, {dot: true})`.
Then plant one fault per new branch of the helper. A condition the self-checks never exercise survives: here `anchored = !leading &&`
(only `**/x` with no slash after was self-checked, never `/**/x` or `**/a/b`).
Why: test-strength.mjs counts tests and assertions, so a helper rewrite at constant count is invisible to tests:changes; the
helper is shared by every last-match test, so a loosening there loosens all of them at once.
Folder entries in a per-file pin loop: `git ls-files -- <dir>` != `[dir]`, and `ownersOf('<dir>/')` passes against the folder
string while a later ownerless line for a file inside goes unseen. Pin folders as BUG-10's journey test does (every tracked file).
Related: [[bug18-audit]], [[config-pinning-tests]], [[in-memory-mutation]]
Folder pins verified (BUG-18 loop 2): the BUG-10 shape (MR toContain + `git ls-files` non-empty + every file last-match owned) killed
all 19 later un-owning line forms and a scratch-index removal (`cp .git/index X; GIT_INDEX_FILE=X git rm --cached -q <file>`).
