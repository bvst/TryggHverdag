# test-auditor — recurring patterns

Notes kept between reviews. Newest section last.

## Where this repository's tests are strong
- Pure decision functions are split out from IO (`merge-rules.mjs`,
  `workflow-lint.mjs`, `sectionsFor`). Assertions on those are cheap and real.
- `expect(undefined).toContain(x)` **and** `.not.toContain(x)` both throw in
  Vitest 5. So the pervasive `expect(problems[0]?.what).toContain(...)` style
  cannot pass vacuously. Verified 2026-09-20; do not raise it as a finding.

## Recurring gaps to look for first (INF-03, INF-04)
1. **Entry points are never tested.** `main()` in every `scripts/*.mjs` is
   untested, so `process.exitCode = 1`, argv wiring and which-token-goes-where
   are unpinned. The pure helpers are 90-100 % covered and the script that calls
   them is 0-50 %. Always read `main()` by hand: the decision logic hiding there
   is where the real bugs are (INF-04: only the first ruleset's bypass list was
   read).
2. **A bug is fixed with a comment instead of a test.** INF-04 fixed two bugs;
   `proc.mjs` got a regression test, `gate.mjs` got a five-line comment and
   nothing else. RG-02 says every bug fix starts with a test. Check each bug
   named in `docs/progress.md` against a test that would fail without the fix.
3. **A lesson learned in one file is not applied to its siblings.** The
   `pnpm run x -- --flag` trap was fixed in one step of `gate.mjs` and left in
   two others, in `ci.yml` four times, and in the `coverage-ratchet.mjs` error
   message that tells the reader to run the broken form. pnpm 10 passes `--`
   through as a literal argv entry (verified); scripts that scan argv
   positionally survive it, which is why it stays latent.
4. **YAML decision logic is nobody's test.** `.github/workflows/*.yml` shell
   steps (verdict enforcement, path filters) carry real branching that no test
   level covers, and `workflow-lint.mjs` only checks pinning, script names and
   job/check agreement — not whether the shell inside a step is right.
5. **Duplicated lists with no cross-check.** `OWNER_APPROVAL_PATHS`,
   `.github/CODEOWNERS` and the `paths-filter` blocks in `ai-review.yml` are
   three copies of the same path list. All three are compared now
   (`gate.test.mjs`), but only in one direction for `ai-review.yml`: every
   `/apps/` owner path must be in its safety filter, not the reverse.
6. **A test whose fixture is "everything broken" asserts nothing.** A base
   fixture with `codeownersText: null` makes `sections.some(s => s.problems
   .length > 0)` true whatever the case under test does. Assert on the named
   section, not on the aggregate. (Caught by mutation in `gate-integrity.test.mjs`.)

## Found in INF-07
- A child-process test that only asserts "exit 1 + '<name> failed:'" passes
  for any start failure. Also assert the expected cause (for example
  `ECONNREFUSED`), and check that a redaction assertion can fail with the
  error the test actually produces.
- `echo "x=$(cmd)" >> $GITHUB_OUTPUT` swallows `cmd`'s failure even under
  `bash -e` with pipefail. Grep workflows for it.
- `test-strength.mjs`: a `)` inside a `test.each` table hides the whole table
  from the test count. Removing cases from a table is invisible to it anyway,
  so read `test.each` diffs by hand.
- HK-03 matches literal text, so check global-option forms
  (`terraform -chdir=… apply`) and re-run routes, not just the forms listed
  in the tests.
- In a cloud session, Node's `fetch` gets 401 from the GitHub API but `curl`
  through the proxy works. Use `curl` to confirm the live rules when
  `gate:integrity` cannot.

## Method that paid off
- Mutation by hand: copy the production module into the scratchpad, reword or
  blank the message/branch the assertion targets, re-run the assertion. Settles
  "tightening or weakening?" and "shape or behaviour?" in a minute, and turns an
  opinion into evidence. Use it on any assertion that only `toContain`s a
  fragment.
- `docs/plan/merge-rules.md`-style owner instructions: check every setting the
  document asks for against what the gate actually verifies. INF-04's Part 2
  (repository settings) is asked for and never checked, while Part 4 shows five
  ticks that read as "all of it is confirmed".

## Project-specific facts
- `scripts/lib/requirements.mjs` SOURCES parses only stories from
  `01b-mvp-scope.md` plus REL/SEC (03), PRIV (02) and SM (05). **CI-xx, RG-xx,
  HK-xx, AR-xx, D-0xx and roadmap INF-xx are invisible to RG-01.** So tests for
  the tooling need no `// req-coverage: fixtures-only` marker unless they quote
  a story/REL/SEC/PRIV/SM ID as sample data. Adding the marker where it is not
  needed is harmful: it would suppress genuine coverage later.
- RG-03's detector (`test-strength.mjs`) only counts tests, assertions and
  skips. It is blind to a loosened *expectation* at a constant count. That case
  is this agent's job, not the script's.

## Found in BUG-18 (2026-10-04)
- **The CODEOWNERS last-match helper in gate.test.mjs is a model of GitHub,
  so probe it with GitHub's own syntax.** It escapes `?`, but GitHub keeps
  gitignore's `?` (only `\#`, `!` and `[ ]` are excluded, per the docs), so a
  later `d?.ts` line with no owners un-owns a file while every last-match test
  says it is owned. Probe each wildcard form against the documented
  exceptions, not just `*` and `**`.
- **HEAD can move under a long fault run.** Reviewers and the coordinator
  commit during the audit. Serve every file from `git show <rev>` rather than
  the disk, and write mutants that find their target in the text handed in, so
  one list runs at both the briefed head and the new one.
- A loop commit can amend the decision ahead of its code ("its lines and tests
  follow"). Scope the verdict to what exists and name the missing half as a
  merge condition, rather than passing the decision as a whole.

## Found in LOST-02 (2026-10-04)
- **A high Stryker score says nothing about "either path" and "no other item" clauses.** The watchdog scored 97 % and still let
  a throwing second attempt count as fine, and a `break` after one failure starve the rest. Plant those two by hand on any loop
  with a retry or a per-item failure branch (see feedback_second_path_isolation.md).
- **Count Vitest's unhandled errors as kills.** A listener changed to `once` crashes only through an unhandled `error`, which
  fails the run without failing a test; a harness reading only test states reports it as a survivor.
