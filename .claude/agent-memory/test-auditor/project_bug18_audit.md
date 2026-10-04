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
