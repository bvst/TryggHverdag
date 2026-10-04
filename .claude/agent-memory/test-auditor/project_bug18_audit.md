---
name: bug18-audit
description: BUG-18 / D-105 (adapters/db.ts owned + safety filter + brief line) test audit, PASS scoped to db.ts at 3fdca02 and de724d8; 57 in-memory faults per rev, 47 killed, identical verdicts; CODEOWNERS matcher treats `?` literally (since BUG-8); HEAD moved mid-audit with D-105 amended (worker-heartbeats.ts) and no lines/tests yet
metadata:
  type: project
---

Audited 2026-10-04 (cloud session), branch fix/BUG-18-db-owned, base origin/main fe384c5. Commits: 01103e7 D-105 (docs only),
02defe9 four BUG-18 tests (3 in gate.test.mjs, 1 in ai-review.test.mjs, pure insertions), 3fdca02 fix (MR, CODEOWNERS,
ai-review.yml, safety-reviewer.md; no test). **HEAD moved to de724d8 mid-audit**: wording loop 1 (brief rewritten, CODEOWNERS line
moved next to healthchecks.ts, comments) plus D-105 amended 2026-10-04: worker-heartbeats.ts joins the three lists and the brief
"in BUG-18 too"; its lines and tests were NOT on the branch at de724d8 ("follow"). PASS covered db.ts only; worker-heartbeats needs
its own replay + fault run when it lands.

- RG-02 replay (tests 02defe9 == HEAD's, production at 01103e7): exactly the 4 BUG-18 tests red, each on a message naming db.ts or
  D-105; 264 others green (gate, ai-review, merge-rules, gate-integrity test files = 268). One edit undone at a time: MR -> test 1 +
  BUG-10 reverse; CODEOWNERS -> test 2 + 7 siblings via reviewCodeowners (message `[ { …(2) } ]`, path hidden); filter -> test 3 +
  generic filter test; brief -> test 4 only.
- 57 faults per rev, verdicts identical at 3fdca02 and de724d8: 47 killed, 10 survived. ONLY a BUG-18 test catches: every later
  un-owning CODEOWNERS line for db.ts (exact, `**/db.ts`, bare `db.ts`, `*/db.ts`, `/apps/**/db.ts`, one owner, other owner, extra third
  owner, inserted right after), all three lists broadened consistently to adapters/ (G4), removed from all three (X1) or MR+filter
  (X6), git index without db.ts (GIT_INDEX_FILE scratch index, T1), brief without D-105 / path.
- SURVIVED, real: a later `/apps/server/src/adapters/d?.ts` (or `??.ts`) with no owners. The shared `matches` helper in gate.test.mjs
  (from BUG-8, ba94a45) escapes `?`; GitHub CODEOWNERS excludes only `\#`, `!` and `[ ]` from gitignore syntax (docs fetched), so `?`
  is a one-char wildcard there. gate:integrity's reviewCodeowners does not model last-match at all, so nothing else catches it.
  Affects every last-match test. Backstop: /.github/ is owned. Should fix: escape set without `?`, then `?` -> `[^/]` (verified inline).
- SURVIVED by design: brief bullet in an HTML comment, inverted ("may loosen"), or D-105 + path moved to another bullet (test pins
  citation and path only, as BUG-14's). Correct survivors: dir-only `db.ts/`, `DB.ts`, `db.t[s]`, line moved, entry moved within list.
- False reds (harmless, loud): owners swapped, CODEOWNERS line without leading slash, trailing YAML comment on the filter entry.
- RG-05: decideMutation skip (no safety path, no mutation input; db.ts not in SAFETY_PATHS, D-105 says so). Pushed (3fdca02, then
  de724d8), no PR, check-runs total_count 0. gate:integrity 3 of 5; gh api: 13 contexts, code-owner review true, bypass [] / never.
- IDs: D-105 and BUG-18 free on main; LOST-02's branch (claude/busy-faraday-40n2zl, da808ef) reserves them and starts at D-106. Its
  progress.md still says "next one is BUG-18": trivial conflict with this branch's BUG-19 line.
- Harness: scratchpad/ta-bug18/ta-harness2.mjs <mutants.mjs> <rev|DISK> [ids]; serves MR, CODEOWNERS, ai-review.yml,
  safety-reviewer.md and both tests from `git show <rev>` so a moving HEAD cannot change results mid-run (v1 read disk and got
  NOT APPLIED rows when de724d8 landed). mutants3.mjs finds targets in the text it is given, so one list works across revisions.
  ~7 s per fault; two revs in parallel on 4 cores. Do not `pkill -f` a pattern that also appears in your own Bash command line.
Related: [[bug14-audit]], [[in-memory-mutation]], [[gate-integrity-local]], [[config-pinning-tests]]

**Loop-1 re-audit (2026-10-04, briefed at 25589a5; HEAD moved to 2482f64 then 0136951, memory/docs only). PASS, scoped.**
- Should-fixes closed: worker-heartbeats.ts in CODEOWNERS/MR/filter/brief (e7d0ddc) and pinned via D105_FILES (9ef8c0b); `?` read as
  `[^/]` in `matches` (9ef8c0b) and in `globCovers` (25589a5), plus `/**/` = zero or more folders and leading `**/` at the root.
- RG-02 replay (tests 9ef8c0b, config de724d8): exactly 3 red, each on worker-heartbeats.ts (MR, last-match [], brief). One file at a
  time: MR -> test 1 + BUG-10 reverse; CO -> 8 (reviewCodeowners siblings, path hidden as before); filter -> general filter test only
  (names the file); brief -> brief test. Tests de724d8 (with the per-file filter test) on HEAD config: green.
- Helpers: fuzz 400k pairs, new is a superset of old for both readers (0 old-true/new-false); today's owners identical for all 536
  paths; 18 matches pairs agree with git check-ignore 2.43, 10 globCovers pairs with picomatch 2.3.2 and 4.0.7 (dot: true).
- 158 faults at 25589a5 (scratchpad ta-bug18/loop1/mutants4.mjs via ../ta-harness2.mjs): 135 killed, 23 survived, 0 not applied.
  db.ts and worker-heartbeats.ts identical row for row (59 each). Every filter fault (comment, ui:, removed, slash, typo, space, !,
  broadened, ?) is killed by the general filter test without the removed per-file test. Survivors: 3 controls, 17 by design (dir-only,
  case, moved, [ ], duplicate, HTML comment, moved bullet), and 3 real: H4h (`anchored = !leading &&` unpinned: no `/**/x` or
  `**/a/b` self-check), H4i (never-anchored, pre-existing), K6 (ownerless `/?ackage.json` last: no last-match test covers
  /package.json; last-match pins are per file family since BUG-8, a general "every OWNER_APPROVAL_PATH file" test would close it).
- 0136951 amends D-105 AGAIN: /apps/server/src/modules/health/ (one file, service.ts) joins in BUG-18. Not in any list or test at
  0136951; PASS excludes it. D105_FILES's loop cannot take a folder (ls-files exact equality; ownersOf on the folder string passes
  vacuously) - pin it like BUG-10's journey test (every tracked file under it).
- gate:integrity 3 of 5 locally; gh api: 13 contexts, code-owner review true, bypass [] / never. No PR, check-runs total_count 0.
  decideMutation: skip. coverage-baseline.json untouched. tests:changes none weakened (count-based: blind to the per-file test's
  removal vs de724d8, net +5 tests). req:coverage 13 of 63, report unchanged.
- Waiting on a background harness: `timeout N tail --pid=<pid> -f /dev/null` blocks without `sleep`.

**Loop-2 re-audit (2026-10-04, briefed at 06fc91c; HEAD moved to 9d6dc53, docs only). PASS.**
- modules/health/ pinned the BUG-10 way (2ec8256 tests, 06fc91c config): MR entry + tracked file + every `git ls-files` file
  last-match owned. Brief test requires `apps/server/src/modules/health/`. H4h self-checks `/**/db.ts`, `**/adapters/db.ts` (both
  match in git check-ignore 2.43).
- RG-02 (loop2/mutants5.mjs via ../ta-harness2.mjs 06fc91c): tests HEAD + config 87fca3c -> exactly 3 BUG-18 red, each naming
  modules/health/ (MR toContain, last-match Array(1), brief); 271 green. One file at a time: MR -> test 1 + BUG-10 reverse; CO ->
  test 2 + reviewCodeowners siblings (9); filter -> general filter test only; brief -> brief test. Old tests on new config: 272 green.
- 64 faults: 56 killed, 8 survived (3 controls; filter moved; brief in HTML comment, file path instead of folder, D-105 dropped from
  bullet only; H4i pre-existing). Every later un-owning line (19 forms incl. ?, **, /**/, bare, no-slash, 1/3 owners) killed by the
  per-folder last-match test; scratch index without service.ts (T1) kills both. H4h now killed. False red: brief path without `/`.
- tests:changes none weakened; req:coverage 13 of 63; coverage-baseline untouched; decideMutation skip (evaluated inline);
  gate:integrity 3 of 5 locally (no rules token); gh api: 13 contexts incl. mutation/traceability, code-owner review true,
  bypass []/never. No PR; check-runs total_count 0.
