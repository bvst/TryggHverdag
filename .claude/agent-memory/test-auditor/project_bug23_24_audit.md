---
name: bug23-24-audit
description: BUG-23/BUG-24 (source-map-js and shell-quote fixed by pnpm.overrides, pinned by lockfile tests) audit, PASS at 68b675c/8b71374; RG-02 replays exact; 49 in-memory faults, survivors are an equivalent, the regex anchors and two by-design cases
metadata:
  type: project
---

Audited 2026-10-06 (cloud), branch fix/BUG-23-source-map-js from main 5cd5d24; head 68b675c, then 8b71374 (memory only). PASS.
- The pattern: an advisory with a patched version is fixed by a root `pnpm.overrides` entry and pinned by a lockfile test
  (`unfixedVersions(lock, {name, fixedAt, advisory})` over `againstFix(version, fixedAt)`), not by an ignore. Each BUG has a
  reproduction (real lockfile, plus a "vitest is in both sections" reader sanity check) and a control on a synthetic v9 lockfile.
- RG-02 replay (tests and files from `git show <rev>`): ba49e8a against its own lockfile is red only on the BUG-23 reproduction,
  naming 1.2.1; 7b8c814 is red only on BUG-24's, naming 1.10.0; both green at their fixes (fef12e4, 68b675c).
- Faults: scratchpad/ta-bug23/ta-harness.mjs + faults.mjs (`{id, rev, testRev, test(text, rep), lock(text, rep)}`, `read`
  overridden for package.json/lockfile/decisions.md). Killed: string compare (per part and whole), parts left as strings,
  pre-release counted as fixed or inverted, build metadata read as a pre-release, major or patch ignored, unplaced read as
  fixed or below, fixedAt or name ignored, a section dropped in lockedVersions/readLockfile, overrides keys read as packages,
  and real-lockfile reverts, a second version, quoted, peer-suffixed, tarball, git, pre-release, 1.9.9, CRLF, v10.
  Survived: `<` to `<=` (equivalent at the first differing part); regex `^` dropped, so a `file:vendor/x-1.2.2` key reads
  as fixed (Should fix: add that row to each control's unplaced list); `$` dropped (near-equivalent in v9 once `(...)` is
  stripped); overrides section removed and package gone (both declared Not pinned).
- RG-03: the helper refactor touched only code new on the branch; against main, only two comment lines changed. To prove
  "test bodies byte-identical", slice from `  test('<name>` to `\n  });\n` at both revs; old vs new comparison fuzzed with
  `new Function(block + 'return fn')` (6567 versions, 0 differences).
- No network, proved: `unshare -n -- ./node_modules/.bin/vitest run <file>` works as root in the cloud sandbox (DNS fails, 21/21).
- `gh api /advisories/<GHSA>` gives 403 (the session is bound to repo-scoped endpoints). `pnpm audit --audit-level high`
  (seconds) is the substitute check that fixedAt is right.
- The planned merge into #64's branch: code, test and lockfile apply cleanly (`GIT_INDEX_FILE=<scratch> git read-tree` +
  `git apply --cached --check`); docs/progress.md and m2.md conflict (both add rows after BUG-20, both bump "next BUG-n").
Related: [[config-pinning-tests]], [[bug15-audit]], [[in-memory-mutation]], [[gate-integrity-local]], [[allowlist-anchor-tz]]

**Delta re-audit (2026-10-06), PASS at c7975fe; HEAD moved to 6524611 (docs + memory only).** e40265e merged the helpers into one
`PATCHED` table + `placeAgainst`/`shortOfFix`, reproductions as `test.each(PATCHED)` rows, controls into one loop test + one
boundary test; c7975fe made the overrides floors (`^1.2.2`, `^1.11.0`, selector `source-map-js@>=1.0.0 <1.2.2`).
- Count drop explained by runtime numbers, not regex: the harness appends `afterEach((ctx) => { ctx.task.meta.taCount =
  expect.getState().assertionCalls })` (imports hoist, so appending an `import` works) and reads `t.meta.taCount`. BUG-23/24
  `expect` calls went 32 to 57 while the regex count fell 138 to 128; 21 runtime tests both sides. `tests:changes --base
  <old head>` flags "went down" (the loop view); `--base origin/main` (what CI runs) says none weakened.
- One loosened expectation: source-map-js 0.6.2 went red to green ("before range"). Justified: npm's bulk endpoint
  (`curl -X POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk -d '{"pkg":["v",...]}'`, works through the proxy
  when `gh api /advisories` is 403) gives GHSA-68fv `>=1.0.0 <1.2.2` and no other source-map-js advisory; shell-quote's four
  advisories cover all of <1.11.0, so its `vulnerableFrom: null` is right.
- "Floors change nothing the tests read": parse both lockfiles with the test's own `readLockfile` (sliced from
  `const DEPENDENCY_FIELDS` to `/** The package name of a`) and compare; diff package.json minus `pnpm.overrides`.
- 51 faults: all killed except `<=` (equivalent), SEMVER `$` (near-equivalent), and T08 `test.each(fixes.slice(0, 1))`, which
  silently drops BUG-24's reproduction (20/20 green). PATCHED rows are pinned by `PATCHED.map(rangeOf)` and
  `controls.map(c => c.fix)`, but a filter between PATCHED and the table is not: a test.each table moves RG-03 protection
  from the detector's count to a human reading the diff.
