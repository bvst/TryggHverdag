# Progress log

**Last updated:** 2026-10-26 · **Milestone:** M3 started (2026-10-20, D-134): twelve tasks; **tasks 1 and 2 are done: GRP-01 in [#96](https://github.com/bvst/TryggHverdag/pull/96) (squashed as `bd83b21`, 2026-10-21) and the home screen (GRP-02, CALL-01, CALL-02) in [#101](https://github.com/bvst/TryggHverdag/pull/101) (squashed as `05bfb73`, 2026-10-25), each after `urso-agent` approved it**; **task 3, start a journey (JRN-01, JRN-02, LOST-01's phone half), is next in D-134's order and not started**; **BUG-64 is done:** `main`'s dependency audit, red since #101 merged on two high advisories that were published or changed in npm's data after #101's last green run, is green again with [#104](https://github.com/bvst/TryggHverdag/pull/104) (squashed as `35a3290`, 2026-10-26; the owner's answer is D-143) (task 1's step 1 was [#94](https://github.com/bvst/TryggHverdag/pull/94), `60b46ee`; task 2's was [#100](https://github.com/bvst/TryggHverdag/pull/100), `50214c0`) · **M2 closed 2026-10-23 (D-142, the owner's choice of 2026-10-22):** all nine tasks done, the last REL-10 in [#77](https://github.com/bvst/TryggHverdag/pull/77) (`b6c6074`); closed on window B of REL-10-AC19 (A-35), with BUG-63 open · M1 closed 2026-10-01 (D-088) · M0 closed 2026-09-29 (D-083)

What is true **right now**. The narrative — why each thing was built and what
went wrong on the way — is in [`progress/m0.md`](progress/m0.md) for M0,
[`progress/m1.md`](progress/m1.md) for M1, [`progress/m2.md`](progress/m2.md)
for M2 and [`progress/m3.md`](progress/m3.md) for M3.

This file is kept short on purpose. `CLAUDE.md` tells every session to read it
before doing anything, and a thousand-line file that is read under protest stops
being read at all. It reached 1,336 lines and, more to the point, **went stale
where it mattered**: four items under "In flight" described work that was already
done. Length was the symptom; a status nobody trusts was the cost.

The plan is in [`plan/README.md`](plan/README.md); the milestone task lists are in
[`plan/10-roadmap.md`](plan/10-roadmap.md). One task per pull request (D-052).

## M3 at a glance

**M3 started on 2026-10-20** (**D-134**), while M2's last exit criterion (A-35)
was still running. The app MVP, demo-able, in twelve tasks, one pull request each,
**one task at a time**, GRP-01 first and sign-in without SMS first. Exit: L7
green on Android (every pull request) and iOS (weekly); the owner can show the
app through internal TestFlight and Google Play internal testing. The order is
in D-134 and [`plan/10-roadmap.md`](plan/10-roadmap.md); the story is in
[`progress/m3.md`](progress/m3.md).

| # | ID | Task | Status |
|---|----|------|--------|
| 1 | GRP-01 | Sign-in and groups: a single-use invitation that expires after 7 days, the first admin's bootstrap code, device sessions where membership is the session, the admin's invitations, member list and removal, the walker's removal of a responder (D-122), and the minimum app screens | ✅ **Done** — 2026-10-21, [#96](https://github.com/bvst/TryggHverdag/pull/96), squashed as `bd83b21` at 06:41:40 UTC by auto-merge, after `urso-agent`'s code-owner approval at 06:41:34 UTC. The tree of `bd83b21` is the reviewed head `a2830fa` (`git diff a2830fa bd83b21` is empty). All five CI reviewers passed `a2830fa` (safety-reviewer, privacy-security-reviewer, test-auditor, code-reviewer and a11y-i18n-reviewer), none with a blocking finding; `code-reviewer`'s last round left small advisory should-fixes, recorded for later. Every required check on `a2830fa` was green after one re-run (BUG-17's third occurrence, below). On `main` at `bd83b21`: `ci` run 39557013605 passed (eleven jobs succeeded and `mutation-group` was skipped; 06:41:43 to 06:51:40 UTC), and `deploy-staging` run 39557013621 passed (06:41:47 to 06:45:21 UTC): the pre-run hook `migrate.ts` ran, the app started and the smoke test passed. 33 acceptance criteria; D-136 (the owner's five answers), D-137 (delegated, amended in loop 1), D-138 (the app's client is plain `fetch`). Step 1 is done: [#94](https://github.com/bvst/TryggHverdag/pull/94), `60b46ee`. A-36's plan and apply are done (2026-10-21); the join in the app is the owner's (below). What CI's reviewers left for tasks 2 and 3 and later, and the story: `progress/m3.md` |
| | BUG-57 | `apps/server/src/api.ts` is mutated by no run, though its middleware decides FULL versus WALKER_ONLY access (GRP-01-AC21, AC23): `safety-reviewer`'s planted mutant, that gate always open, survived the `journeys` group and was killed only by `groups.system.test.ts`, which `test:system` runs and no mutation run reads for `api.ts`. **In the same change,** the `membership` group would run `modules/groups/join.test.ts` before `groups.system.test.ts`, under `vitest.coverage.config.mjs`. That was tried in loop 2 (`1594939`) and withdrawn (`879096f`): a group's configuration is a mutation input (`decideMutation`), so BUG-14's tests then require the coverage configuration in `ai-review.yml`'s safety filter (D-075, merged by hand) and in `.claude/agents/safety-reviewer.md` (the owner's). What it would kill: `join.ts`'s `code === null` guard, which no request can reach (the contract refuses such a code first; removed, it fails loudly with a `join_failed` line and a 500), and `invitations.ts`'s `invitation_failed` stage. Measured in loop 2: about 50 s for the group (48 s in the implementer's run), `join.ts` 97.2 % (83.3 % today), `invitations.ts` 93.1 % (89.7 %). Found 2026-10-20 by `safety-reviewer` (S4, loop 1) and `test-auditor` (S1, loop 2). **The 14 mutants that survive in the `membership` group** (`test-auditor` on `a2830fa`: 86 %, every file at or above 80 %: `invitations.ts` 89.65, `join.ts` 83.33, `members.ts` 85.71) belong with this bug and have no ID of their own: 10 are `type` or `reason` strings in returned results, 3 are `stage: 'store'` in log lines (`invitations.ts:56`, `join.ts:85`, `members.ts:68`), and 1 is `join.ts:76`'s `code === null` guard, which `join.test.ts` covers but which is outside the group (the second half of this row). Detail: the spec's "Left for later tasks", and `progress/m3.md` | ⚪ **Queued**, for the owner to schedule (`ai-review.yml` is a hand merge, D-075, and the safety reviewer's brief under `.claude/` needs the owner's approval). Claude recommends one pull request: `api.ts` into `SAFETY_PATHS` with a group over the system tests that reach its routes, measured first for time (D-066, D-098), and the `membership` group's second test file in the same change, with the two input lists (`ai-review.yml`, the reviewer's brief) updated first, as step 1 did for the filter |
| | BUG-58 | guard-bash's rule against skipping git hooks (`.claude/hooks/guard-bash.mjs`, line 37: `/--no-verify\b\|\bgit\s+commit\b[^\n]*\s-n\b/`) matches more than the flag. The short flag is matched anywhere later on the line, so `git commit -F msg && sed -n 1,5p msg` and `git commit -F msg && grep -n x msg` are refused, and so is a command that only mentions the words, such as `grep -r "git commit -n" docs`. Measured 2026-10-20 by running line 37's pattern on ten sample commands in a scratch file; the guard's other checks were not exercised. It fails closed, so it is a nuisance, not a hole: a refused command costs a rewrite, and a rule that refuses what it should not teaches people to word around it. Found by the implementer in review loop 2, and by Claude when a search for the pattern itself was refused | ⚪ **Queued**, for the owner to schedule (`.claude/` needs the owner's approval). Claude recommends matching the flag only as an argument of the `git commit` command itself: split the command into simple commands first (the same word splitting BUG-56 wants fixed as a whole), with tests for the flag itself, the chained `-n` and the mention |
| | BUG-59 | The post-edit hook runs `gate:file` on a file outside the repository. `.claude/hooks/post-edit.mjs` (lines 15-39) names the edited file relative to the working tree (`relPath` gives a `../…` path for one outside it), skips only a wrong extension and `docs/`, and runs the gate on the rest. Seen by Claude in review loop 1 on a file in the session's scratchpad, and **again on 2026-10-20 while GRP-01 was being recorded:** a scratch `.mjs` under `/tmp` was reported as failing Prettier ("Code style issues found") and ESLint ("ESLint couldn't find an eslint.config.* file"), and the hook ended "Fix them before moving on", though the ESLint half cannot be fixed outside the repository. A false red on a file that is not the repository's; the live gotcha about a worktree outside the project is the same hook, but there the files are checked against the main checkout | ⚪ **Queued**, for the owner to schedule (`.claude/` needs the owner's approval). Claude recommends skipping a path outside the working tree and saying so in one line (not checked, and why), so it is neither a false failure nor a silent pass |
| | BUG-60 | test-author's Bash guard denies writes only under `apps/*/src/**` and `packages/contracts/**` (`.claude/agents/test-author.md`, line 20), while its Edit and Write hook (line 16) allows only `**/*.test.ts`, `.tsx` and `.mjs` files, `apps/mobile/e2e/**` and `packages/test-kit/**`. So a shell write by test-author could reach production files that hook would refuse, such as non-test `.mjs` files in `scripts/`, `infra/` and `.github/`; and a shell write skips the Edit hooks and the post-edit checks. In review loop 1, test-author edited `scripts/lib/merge-rules.test.mjs` with a shell script: that was its own file, but the post-edit checks did not run, so it redid the edit with Edit. **What was checked:** the two frontmatter lines (16 and 20) were read. What `guard-paths.mjs` and `guard-bash.mjs` enforce for test-author with those arguments, and whether the global guard (D-120) already refuses some of these paths, was **not** checked; no shell write by test-author to a production file is known. The same family as BUG-56 | ⚪ **Queued**, for the owner to schedule (`.claude/` needs the owner's approval). Claude recommends denying shell writes to every non-test path for test-author, mirroring the Edit hook's rule, or refusing shell writes to tracked files for both roles |
| | BUG-61 | `pnpm audit --audit-level high` turned red on #96 at `155fef6` on a new advisory, GHSA-587h-7wmj-h5pm: `vite` >=8.3.0 <=8.3.2, patched in 8.3.3, reached only through `vitest`. It was published after the branch's last green audit, so `main` would fail the same way (`6b7cd97`'s reasoning; `main`'s own run before the fix was not read). Found 2026-10-20 | ✅ **Done** — 2026-10-21, in GRP-01's merge, [#96](https://github.com/bvst/TryggHverdag/pull/96), `bd83b21`; `security` passed in `main`'s `ci` run 39557013605. The fix, `6b7cd97`: a root dev dependency `vite: ^8.3.3`, locked at 8.3.4. It is the only way found to move vitest's auto-installed peer: a pnpm override changed only the peer range, and `pnpm up --depth Infinity` left vite at 8.3.0. Pinned by `dbe2c7a`: a `PATCHED` row in `scripts/dependency-audit.test.mjs` and a test that holds the dev dependency, with its reason. Record: `progress/m3.md` |
| | BUG-62 | `pnpm audit` reports a moderate advisory, GHSA-5r4p-p66f-jhc7, in `hono` >=4.12.4 <4.13.11, patched in 4.13.11. `apps/server` depends on `hono` `^4.13.8`, installed as 4.13.8, a production dependency of the API. The advisory (CWE-174, created 2026-10-20) is about `serveStatic` decoding the request path a second time, so middleware mounted on a static prefix can be bypassed; "Applications that serve only public files are not affected." `apps/` does not use `serveStatic` (a grep finds no use), so it is not exploitable in the API today. CI's audit runs at `--audit-level high`, so it is not red. Found 2026-10-21 | ⚪ **Queued**, for the owner to schedule. Claude recommends bumping `hono` to `^4.13.11` in a small `/bugfix`, or with the next dependency batch, so a later use of `serveStatic` does not inherit it |
| 2 | GRP-02, CALL-01, CALL-02 | The home screen: the #1 contact (a name and a number, kept on the phone only), the call button, and 112 on every screen | ✅ **Done** — 2026-10-25, [#101](https://github.com/bvst/TryggHverdag/pull/101), squashed as `05bfb73` at 13:26:02 UTC (GitHub's API: merged by `urso-agent`). `urso-agent`'s approval of 2026-10-23, on `96c04b7`, was dismissed that day at 13:12:48 UTC by a push (`dismiss_stale_reviews_on_push` is on in the `main` ruleset; the API gives `2cc97d9` as the dismissal commit); it approved `16c46f3` at 13:25:47 UTC on 2026-10-25, and auto-merge (squash, on since 2026-10-23) merged 15 seconds later. **On `16c46f3` all 26 checks succeeded** (GitHub's API), `android-e2e` and the five `ai-review` checks among them: safety, privacy-security, test-auditor, code and a11y-i18n, each with a PASS comment. `test-auditor` planted 21 faults in a copy of `16c46f3`, in the new script code and in `session.tsx`, and each made a test fail (its comment). **`android-e2e` failed twice first** (`96c04b7`, run 39956809738; `2cc97d9`, run 39959347972, a push of specs only), in the step that boots the emulator and runs the flows; the coordinating session read the log of the first at `call-without-permission.yaml`'s first wait, right after the script pressed `KEYCODE_ENDCALL`. The fix, CALL-01 approach 9 (red `2ad0ce6`, green `0acf098`), wakes the phone before each scripted flow and presses end-call only while a call is in progress. **The run on `16c46f3` (job 120473565944) confirmed the cause,** on the coordinating session's reading of its log (a session cannot open job logs): the call to #1 had already ended, so "No key pressed"; no wake line was printed for any flow; every flow passed. It is the first observation on a device of CALL-01-AC2 (one outgoing call to #1's number, placed by `no.trygghverdag.placeholder` with no second tap), CALL-01-AC4 (the dialer in front, no new call) and CALL-02-AC3 (`emergency-112`: the dialer in front, and Telecom's record shows no new call). **On `main` at `05bfb73`** (job conclusions, GitHub's API): `ci` run 40197588527 failed in `security` only, on BUG-64 (below), and `mutation-group` was skipped; `deploy-staging` run 40197588530 succeeded. Specs: `docs/specs/GRP-02.md`, `CALL-01.md`, `CALL-02.md`; the owner's answers are D-141 and its four amendments; step 1 was [#100](https://github.com/bvst/TryggHverdag/pull/100) (`50214c0`). **Not verified:** how TalkBack reads "Ring 1 1 2, nødnummeret" (a real phone, L9); anything on iOS (task 12). No folder is a mutation path until task 3 (D-081 item 13). The follow-ups: "In flight" below; the story and the evidence: `progress/m3.md` |
| | BUG-64 | `pnpm audit --audit-level high` failed on `main` at `05bfb73`, the merge of #101 (`security`, job 121181676976 of `ci` run 40197588527), and so failed every pull request, on two new high advisories. **GHSA-mrhx-c7xc-m3w5** (zod below 4.6.6: oversized constrained collections exhaust memory), on `apps__server>zod` (4.6.5) and on `apps__mobile>expo>@expo/cli>zod` (3.25.76); **GHSA-xjj6-f33q-929c** (undici 8.0.0 up to 8.12.1: a denial of service through excessive content-encodings), on `apps__server>@testcontainers/postgresql>testcontainers>undici` (8.11.0), a dev dependency. Not #101's: its `security` passed on `16c46f3`, #101 added no zod or undici, and the audit on `50214c0` gives the same result. What changed is npm's audit data, after 14:36 UTC on 2026-10-23 (D-143 has the dates). `@expo/cli` declares `zod ^3.25.76` even in 58.1.15 (`pnpm view`, 2026-10-25), and no 3.x is patched. Found 2026-10-25 | ✅ **Done** — 2026-10-26, [#104](https://github.com/bvst/TryggHverdag/pull/104), squashed as `35a3290` at 06:20:04 UTC (GitHub's API: merged by `urso-agent`, whose approval of `3092a35` is stamped 06:19:50 UTC; the pull request had waited for it since 20:02 UTC on 2026-10-25, with auto-merge on). `35a3290` and the reviewed head `3092a35` have the same tree. **The fix:** zod 4.6.7 and undici 8.12.3 locked (workspace catalog `zod: ^4.6.6`, two root overrides), and GHSA-mrhx-c7xc-m3w5 ignored by its ID for `@expo/cli`'s zod only, as D-093 did for `node-forge`: **the owner's answer (D-143, 2026-10-25), "Godta den, registrert (Recommended)".** The ignore is global, so `scripts/dependency-audit.test.mjs` pins that the server and the contracts reach no zod below 4.6.6, that `@expo/cli`'s is the only one and is reached from `apps/mobile` alone, and that the ignore list is exactly D-093's, D-104's and D-143's. Reconsidered when Expo moves to zod 4: the premise test then says "remove the ignore". **The green is two commits, not one.** Red `8d437af` (`test-author`, the test file only) fails 5 of 29. The fix `e47dee5` (the implementer's: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`) is **not green alone:** on its own tree the audit test passes 27 of 29 and fails the two decision checks, "BUG-11: every advisory the audit ignores is accepted by a decision" and "BUG-15, BUG-64: …exactly the three accepted advisories…", because it adds the ignore and D-143 lands only in `3092a35`. `3092a35` (D-143 and the records) passes 29 of 29. (`test-auditor` on #104; I ran all three trees on 2026-10-26 and got 5, 2 and 0 failures.) **Reviews on `3092a35`:** 17 of the 18 check runs succeeded and `mutation-group` was skipped; the five `ai-review` checks are among the 17. Three posted a PASS comment (code, privacy-security, test-auditor). Safety and a11y-i18n posted none and finished in 3 s and 6 s, which looks like "did not apply to this diff"; that is read from the timings, not from a log. `test-auditor` planted 21 faults in the new lockfile checks and 20 were caught; the survivor is the peer-suffix strip in `zodShortOfFix`, which it judged fail-safe. **On `main` at `35a3290`** (job conclusions, GitHub's API): `ci` run 40279208647 succeeded, `security` (job 121428516942) among its eleven successful jobs, and `mutation-group` was skipped; `deploy-staging` run 40279208537 succeeded. So `main` is green again after `05bfb73`'s red `security`. Dependabot alerts are off (A-31, below), so nothing automated would notice a change to D-143's advisory. Record: `progress/m3.md` |
| | BUG-65 | `scripts/dependency-audit.test.mjs`'s check that nothing but the root `package.json` sets pnpm's audit settings read `pnpm-workspace.yaml`, the root `.npmrc` and the workflows as raw text, but pnpm decodes them (YAML escapes in a double-quoted key, `ini`'s JSON-decoding of a quoted name, `${NAME-fallback}` filled in from the environment), so a name spelled with escapes or an environment variable got past it. **Shown end to end with pnpm 10.33.0**, in a scratch copy: `pnpm audit --audit-level high` exits 0 with "2 high (2 ignored)", and the control, with no ignore anywhere, exits 1, for (a) `auditConfig` and `ignoreGhsas` written with unicode escapes in the workspace file (the coordinating session re-ran this one itself on 2026-10-26: exit 0 against the control's 1), (b) a workspace key `pnpm${TRYGG_UNSET-f}ile` that pnpm fills in to `pnpmfile`, naming a hook, (c) a quoted, JSON-escaped pnpmfile name in `.npmrc`, and (d) an environment-filled pnpmfile name in `.npmrc`. The workflow case (escaped YAML in `.github/workflows`) was read in pnpm's bundle and not run, since workflows are code-owned. *Corrected the same day:* `test-author`'s reads of "pnpm's bundle" for BUG-65 were of pnpm 10.28.0's, not 10.33.0's (BUG-67's row); the re-check against 10.33.0's was not reported to name this one, so it is unverified there. The scratch runs above used 10.33.0 and stand. Found by `privacy-security-reviewer` on #105 | 🟡 **In #105**, not merged: red `5620397` (4 of its tests fail, 29 pass), green `96c7156` (before the squash). Test-only, one file. The workspace file is parsed as YAML, every scalar at every depth is decoded and checked, a key containing `${` is refused, and a parse error or a warning is refused, never read as clean; `.npmrc` names are decoded by a port of `ini` 1.3.8's `decode`; workflow scalars are decoded, and any audit other than `pnpm audit --audit-level high` is refused, a folded `run: >` included. The raw-text checks stay, and `tests:changes` says "1 changed test file(s), none weakened (RG-03)" (I ran it on 2026-10-26). The parser is `yaml` 2.9.1, which the lockfile resolves as the root vite's peer, loaded the way `stryker-config.test.mjs` loads its own: no dependency or lockfile change, and if the peer goes the tests fail with a named error. **Not pinned:** a command a workflow builds at run time (shell quoting, `${{ }}` expressions, repository variables), a workflow's `npm_config_*` variable (workflows are code-owned), and a workspace package's install script (BUG-68, below; `82c4be0` added both to the test's list). **This is a test, and a test is not an owner:** `privacy-security-reviewer`'s BLOCK on #105 (BUG-69, below) is that one line in the files it guards stops `pnpm run`, and so this test, from running in CI. D-144 (six pnpm files get the owner as code owner) is written and is in #105, by the owner's choice; its CODEOWNERS and `OWNER_APPROVAL_PATHS` lines are in, in `e61b03e`, and count on `main` once #105 merges. Record: `progress/m3.md`, 2026-10-26 |
| | BUG-66 | A `registry=` line in the root `.npmrc` makes `pnpm audit` ask that server for advisories. `.npmrc` has no code owner, and no check read that setting. **Found and reproduced** by the coordinating session on 2026-10-26, while verifying BUG-65, in a scratch copy with pnpm 10.33.0: a local server answering every request with zero vulnerabilities (it logged `POST /-/npm/v1/security/audits/quick`) made `pnpm audit --audit-level high` exit 0, "No known vulnerabilities found"; the unchanged `.npmrc` exits 1, "2 high". **What did not redirect the audit** (exit 1, real advisories): `registry=` in `apps/mobile/.npmrc`, and a plain `registry:` key in `pnpm-workspace.yaml`. **That file can redirect it, though: a `registries:` key does** (BUG-67, the next row; refused by the list in #105). In CI the `security` job runs `pnpm install --frozen-lockfile` and then `pnpm audit --audit-level high`, and both read the root `.npmrc`, so an attacker would need a pass-through registry that serves the real packages and reports no advisories, which is feasible | 🟡 **In #105**, not merged: red `6e96a4c` (1 of its tests fails, 38 pass), green `c37d0f0` (before the squash). Test-only, the same file. The root `.npmrc` may hold only the settings in `RC_SETTINGS`, today just `engine-strict`; every decoded name is checked, section names included. Adding a setting is a change to this test, and `/scripts/` is code-owned, so the owner approves it. Controls refused: registry, scoped registry, an auth line, `registry[]`, escaped and quoted registry names, proxy, https-proxy, strict-ssl, cafile, noproxy and a `[registry]` section. **Not tried:** proxy, `strict-ssl` and the certificate settings as routes; the list refuses them either way. **`.npmrc` gets a code owner in D-144, in #105:** the owner answered yes on 2026-10-26, after the BLOCK (BUG-69, below); its CODEOWNERS line is in, in `e61b03e`, on the branch; `main` has none until #105 merges (follow-up 14, under "In flight"). Record: `progress/m3.md`, 2026-10-26 |
| | BUG-67 | pnpm 10.33.0 copies `pnpm-workspace.yaml`'s top-level keys into its settings with no check on the key, and `pnpm audit` sends its request to `registries.default`, so **a `registries:` key in that file redirects the audit**. No check read it, and the file has no code owner until D-144's lines land in #105 and it merges. A plain `registry:` key does not (BUG-66's row). **Found by `privacy-security-reviewer` and `test-auditor` on #105 at `4577ecf`,** each with a PASS and this as a should-fix: `test-auditor` read the path in pnpm's bundle (the workspace keys are copied onto the config; the audit uses `opts.registries.default`), and `privacy-security-reviewer` ran it end to end. **Reproduced** by the coordinating session on 2026-10-26, in a scratch copy with pnpm 10.33.0: today's workspace file plus a `registries:` key whose `default:` points at a local server that reports zero vulnerabilities makes `pnpm audit --audit-level high` exit 0, "No known vulnerabilities found" (the server logged `POST /-/npm/v1/security/audits/quick`); the control exits 1, "2 high". **A second route, reported by `privacy-security-reviewer` and not re-run by us:** `lockfileDir: sub`, pointing at an empty lockfile, also made the audit exit 0; it was not shown to get through `pnpm install --frozen-lockfile` in CI. **Not tried:** `httpsProxy`, `strictSsl` and `ca` in the workspace file as routes | 🟡 **In #105**, not merged: red `dac3614` (fails only its own new test: 1 failed, 41 passed), green `bc5a6f9`, and `62c2ce2` (`code-reviewer`'s two tidy-ups in the test file), all before the squash. Test-only, the same file. The workspace file's top-level keys may be only `packages` and `catalog` (`WORKSPACE_SETTINGS`), checked by `workspaceUnlisted`; BUG-65's `workspaceRoutes` and its assertions are unchanged. Keys are named as `yaml` 2.9.1 reads them (decoded, aliases followed), and `<<` is refused as a key. *Corrected the same day:* an earlier version of this row said they were named "the way pnpm's js-yaml reads them". That reader agrees with pnpm's on every fixture tried, **but not on a lone CR** (a carriage return with no line feed after it), which pnpm's reader takes as a line break and `yaml` keeps inside a scalar: that is the BLOCK below. Adding a setting is a change to this test, and `/scripts/` is code-owned, so the owner approves it. **Refused in the test:** `registries` (default and scoped), `registry`, `lockfileDir`, `overrides`, `httpsProxy`, `strictSsl`, `ca`, a plain `auditConfig`, quoted and escaped `registries`, a sequence key, a `${…}` key, an alias key, a `<<` merge, an unparsable file and a top-level sequence. Today's file passes. `overrides` is BUG-25's route through this file; BUG-25 stays queued (its row). At `62c2ce2`: `scripts/dependency-audit.test.mjs` 44 of 44, all of `scripts/` 1875 of 1875. `4577ecf`, the head before BUG-67, passed CI and all five reviewers (the coordinating session's report; I opened no check). **#105 had a BLOCK at `e57543d`, fixed in three commits and cleared on `a0c11ed`, where every check is green and all five reviewers pass** (the coordinating session read the check-runs API; I opened no check). `privacy-security-reviewer`'s re-review fuzzed about 163,000 files the line grammar accepts against js-yaml 4.3.2, a stand-in for pnpm's `@zkochan/js-yaml` 0.0.11, and none gave a top-level key but `packages` or `catalog`; **pnpm itself was not run on them.** `privacy-security-reviewer` returned BLOCK (its check, `ai-review (privacy-security-reviewer)`, failed). **The hole:** pnpm 10.33.0 reads the workspace file with `@zkochan/js-yaml` 0.0.11, which breaks a line at a lone CR; `yaml` 2.9.1, the parser the test used, keeps it inside a plain scalar with no error or warning. So `  - packages/*`, a lone CR, then `registries: {default: "<local server>"}` hid a top-level `registries` key from every check while pnpm read it. **Reproduced by the coordinating session on 2026-10-26:** with that edit in the repository's own workspace file (restored afterwards, checked with `cmp`) the test passed 44 of 44; in a scratch copy with a local server reporting no vulnerabilities, `pnpm audit --audit-level high` exited 0 and the server logged the audit POST (the control exits 1). A `lockfileDir:` line behind the same CR was also reported by the reviewer, not re-run by us. **The fix** (test-only, same file; red `2ea9e6c`, 3 new tests fail and 44 pass; green `41d9bfc`; `1ecf157`; all before the squash) adds three layers and removes nothing: **(a)** `decodedYaml` refuses a lone CR in the workspace file and in workflows; **(b)** `workspaceLines` checks the workspace file's raw text, split on LF only, against a strict line grammar (`WORKSPACE_LINE`) with no YAML parser: blank lines, whole-line comments, `packages:` and `catalog:` once each, plain globs under `packages:`, plain `name: range` entries under `catalog:`; any CR (CRLF too), NEL, LS or PS fails; it is the class fix, since each round had found another way the test's YAML model differed from pnpm's; **(c)** the root `.npmrc` is pinned to exactly `engine-strict=true` and a newline (`code-reviewer`). `1ecf157` also makes `readRc()` throw on a missing root `.npmrc` at all five sites (`test-auditor`: renaming the path had passed all 44; now 5 tests fail). With the reviewer's exact edit applied to the real workspace file, 5 tests now fail (the coordinating session; file restored). **Now, at `ad7f27a`:** the file passes 50 of 50 and all of `scripts/` 1881 of 1881 (`test-author`; I ran both on 2026-10-26), `tests:changes` "1 changed test file(s), none weakened (RG-03)" (I ran it). Every claim of the line grammar is now pinned by its own fixture, and a 131-mutant sweep left only 4 survivors, all equivalent (`test-author`; the detail is in `progress/m3.md`). On `e57543d`, `code-reviewer` and `test-auditor` gave PASS (the coordinating session's report; I opened no check). **A second correction:** the test file, its commit messages from `96c7156` on and the records said "pnpm 10.33.0's bundle" for reads that were of pnpm 10.28.0's (the launcher in `/opt/node-tools`; its `@zkochan/js-yaml` is 0.0.9). `test-author` re-read 10.33.0's own bundle (0.0.11) and every fixture's reading held, beyond the differences the test's header now records. The scratch runs used the real `pnpm` command, 10.33.0, and stand. The checks and reviews above were read at `a0c11ed`; `ad7f27a` came after them and was not pushed when I fetched on 2026-10-26, so read #105 for its own CI and reviews. **Update:** `ad7f27a` is in the pushed head `ec81f65`. On it, 16 of 18 check runs succeeded, `mutation-group` was skipped, and `ai-review (privacy-security-reviewer)` failed on BUG-69 (below); the other four `ai-review` checks succeeded (GitHub's REST API, 2026-10-26; I read only `code-reviewer`'s and `test-auditor`'s PASS comments, and no job log). D-144 (six pnpm files get the owner as code owner) is written and is in #105. Record: `progress/m3.md`, 2026-10-26 |
| | BUG-68 | CI's `security` job runs `pnpm install --frozen-lockfile` and then `pnpm audit --audit-level high` (`.github/workflows/ci.yml`, lines 786 and 788; `pnpm run licenses:check` is line 790), and **pnpm 10.33.0 runs each workspace package's install scripts** (`preinstall`, `install`, `postinstall`, `prepare`) during that install. Such a script can rewrite the root `.npmrc` (BUG-66's redirect) or write to `$GITHUB_ENV` after the checked-in files were checked and before the audit runs. The reviewer's reading is that the same script also runs before `licenses:check` and gitleaks in that job (the step order is read; the effect on them is not shown), and at `ec81f65` that the install also runs, without `--ignore-scripts`, before the tests in `unit` (its comment on #105; I did not check that). **Found by `privacy-security-reviewer` on #105,** at `892d7c9` and again at `82c4be0`; it reproduced it twice with pnpm 10.33.0. **Confirmed by the coordinating session** on 2026-10-26, in a minimal pnpm 10.33.0 workspace: a `postinstall` in a workspace package ran during `pnpm install --frozen-lockfile` and appended a `registry=` line to the root `.npmrc`, and with `--ignore-scripts` it did not run. BUG-66's reproduction already showed that a `registry=` line in `.npmrc` makes the audit exit 0 against a server that reports nothing; **the whole chain, install script then audit, was not run in one go.** **Today's exposure:** no workspace package has an install script (I read the keys of all eight tracked `package.json` files on 2026-10-26), and the root's `prepare` is in the code-owned `/package.json` and only runs `git config core.hooksPath .githooks || true`. But `apps/server/package.json` and `packages/contracts/package.json` have no CODEOWNERS entry on `main` (`/package.json` and `/apps/mobile/package.json` do; `.github/CODEOWNERS` read 2026-10-26). **D-144 gives both an owner:** the owner answered yes on 2026-10-26, and the lines are in, in `e61b03e`, on #105's branch; `main` has them once #105 merges. **#105 did not cause it:** it is on `main` already, and #105's test lists it under "Not pinned" (`scripts/dependency-audit.test.mjs`) | ⚪ **Queued**, after #105; its fix is not in #105 (D-144, which is, only gives the two `package.json` files an owner). Claude's plan, its own pull request: the `security` job runs `pnpm install --frozen-lockfile --ignore-scripts` (check that `licenses:check` still works), and a test refuses `preinstall`, `install`, `postinstall`, `prepare` and their pre and post forms in workspace `package.json` files. The owner answered yes on 2026-10-26 to a code owner for the two `package.json` files above, in D-144 (follow-up 19, under "In flight"). Record: `progress/m3.md`, 2026-10-26 |
| | BUG-69 | pnpm 10.33.0 reads `scriptShell` from `pnpm-workspace.yaml` and `script-shell` from `.npmrc`, and every CI check runs through `pnpm run`, `pnpm run test:unit` (which runs the guard test on those two files) among them. **One line in either file makes `pnpm run` hand every script to a shell the pull request chooses, so every check goes green having run nothing, the guard test included.** **Found by `privacy-security-reviewer`:** BLOCK on #105 at head `ec81f65`, in a comment headed "head 357cd4f", GitHub's test-merge of `ec81f65` into `main` (the coordinating session checked its parents; the commit does not resolve in my checkout). **Reproduced by the coordinating session** with pnpm 10.33.0, in a minimal project with a script that echoes and exits 1: the control exits 1 and the script ran; `scriptShell: /bin/true` in `pnpm-workspace.yaml` exits 0 and the script did not run; so does `script-shell=/bin/true` in `.npmrc`; **and so does a root `.pnpmfile.cjs` with an `updateConfig` hook returning `{ ...config, scriptShell: '/bin/true' }`, a third route beyond the reviewer's report** (10.33.0's default pnpmfile name is only `.pnpmfile.cjs`, checked in its bundle). A package's own `.npmrc` with `script-shell` hijacked a run only from inside that package's folder; from the root (`--filter`, `-r`) the script ran and failed; no package has one (`git ls-files`, 2026-10-26). **The reviewer's own runs, not repeated by us:** in a `git archive` copy of `357cd4f` with `scriptShell: /bin/true`, `pnpm run test:unit` and `pnpm run licenses:check` exited 0 having run nothing, while the test file run directly with vitest failed as it should. **On `main` the route is open already; #105 did not cause it.** It blocks #105 because the owner had put D-144 after #105 believing #105's test closed these routes in the meantime, and in CI it does not: the test is run by the pnpm the route disables | 🟡 **In #105 (mitigated by D-144), check before pnpm queued.** **Mitigation:** D-144, written 2026-10-26 on the owner's answers: "D-144 inn i #105, + .npmrc (Recommended)"; "Ja, begge (Recommended)" for `apps/server/package.json` and `packages/contracts/package.json`; "Ja, ta den med (Recommended)" for `/.pnpmfile.cjs`. Six paths need the owner's approval: `/pnpm-workspace.yaml`, `/pnpm-lock.yaml`, `/.npmrc`, `/.pnpmfile.cjs` (it does not exist; owned so that adding one needs the owner), `/apps/server/package.json`, `/packages/contracts/package.json`. **`test-author`'s tests were red (`2a0f6c2`, and `dad32ba`, which adds `/apps/server/package.json` as the safety-filter test's eleventh named exception; both in `scripts/gate.test.mjs`), and the six lines that turn them green are in: `e61b03e` (`implementer`) adds them to `OWNER_APPROVAL_PATHS` and `.github/CODEOWNERS`, one line each naming `@bvst @urso-agent`, under a comment citing D-144; `ai-review.yml` is unchanged.** `gate`, `merge-rules` and `dependency-audit` tests pass 352 of 352 (I ran them 2026-10-26); the implementer reports all of `scripts/` 1883 of 1883, `gate:quick` 3 of 3 and `gate:integrity` 5 of 5, which I did not repeat. **The six files are owner-reviewed only once #105 merges:** the lines are on the branch, and `main` has none of them until then. The owner's review is a person, not a check that runs. **The fix, queued** as its own bug and pull request after #105: a dependency-free Node check (the `.npmrc` byte pin, the workspace file's line grammar, no root `.pnpmfile.cjs`) before the first pnpm command in every job that gates a merge, minding that a skipped required check counts as passed. **Unverified:** whether turbo runs a package's script from that package's folder, which is the case where a package-level `.npmrc` can hijack the shell; the reviewer's full combined attack, never run in CI. Record: `progress/m3.md`, 2026-10-26 |
| 3 | JRN-01, JRN-02, LOST-01 (phone half) | Start a journey: the safety core, the location SDK in the background, a heartbeat every 60 s, the "sharing" notice that stays on screen. Mutation testing of the safety core is set up before its first code (D-081 item 13) | ⚪ **Next** in D-134's order; not started. A-29 is needed for real phones only |
| 4 to 12 | D-134 | In the order of D-134: the safety permission check (GRP-03); "I'm home" and the two-hour stop (JRN-05, JRN-06); real push; the alert screen (HELP-01); what responders see (JRN-03); responder setup (GRP-04); real SMS (LINK Mobility) and the SMS sign-in code; CALL-03, LOST-04, LOST-05; iOS and the stores | ⚪ Not started. One at a time (D-134); A-11 is needed by task 6, A-12 by task 10, A-03 by task 12 |

## M2 at a glance

**M2 started on 2026-10-01** (**D-090**) and **closed on 2026-10-23**
(**D-142**). The core safety loop on the server, in eight tasks, one pull request
each, SM-01 first; nine since D-115 (2026-10-07) gave SM-10 and the last-responder
warning a task of their own. The owner chose this order; the alternative was seven
tasks with LOST-01 first. Exit: L6 green; mutation ≥ 80 %; the staging canary on
time for 24 hours. **The owner chose on 2026-10-22 to close it on window B of
REL-10-AC19, with BUG-63 open.** Window B, 12:22:54 UTC on 2026-10-21 to the same
time on the 22nd: 96 `canary_run` lines in Clever Cloud's log, all `ON_TIME`, the
largest gap 15.04 minutes (AC19 allows 35), the largest `alertMs` 310 041 ms. The
Healthchecks.io half was seen for the last 28 of its 96 runs, all OK, and not for
the first 68: the owner can no longer see back that far. The lines are the owner's,
counted by the coordinating session and again by the session that wrote D-142.
Meaning, as D-127 set it: the alert reaches the push port on time, not that a phone
is alerted. Until GRP-01 brought logins in M3, devices authenticated with a hashed
per-device credential (**D-091**). The task list is in
[`plan/10-roadmap.md`](plan/10-roadmap.md); the story is in
[`progress/m2.md`](progress/m2.md).

| # | ID | Task | Status |
|---|----|------|--------|
| 1 | SM-01 | Start a journey: the base tables, per-device authentication (SEC-07), the state machine module (AR-04), one active journey per walker, at least one responder | ✅ **Done** — 2026-10-02, [#53](https://github.com/bvst/TryggHverdag/pull/53), merged as `2db7046`. On `main` after the merge: `ci` 10 of 10 jobs passed (run 36978813054), and `deploy-staging` ran the first migration with journey tables and passed its smoke test (run 36978812889). In CI, L3 ran under Testcontainers for the first time, 49 of 49. Reviews, all PASS: safety, privacy-security, code, test-auditor, in the session and in CI. BUG-11 (D-093) merged with it. Its record: `progress/m2.md` |
| | BUG-10 | The journey files need the owner and the safety review (D-092, D-094 to D-097): the six journey files, `api.ts`, `adapters/clock.ts`, the migrations' location and the system and integration Vitest configs in CODEOWNERS and `OWNER_APPROVAL_PATHS`, and in the ai-review `safety` filter; `modules/**` in `CLOCK_FREE_PATHS`; `modules/journeys/` and `api-process.ts` in `SAFETY_PATHS`, the first with its own mutation run under the system-test config | ✅ **Done** — 2026-10-02, [#56](https://github.com/bvst/TryggHverdag/pull/56), merged by the owner by hand (D-075) as `348f620`. Approved by `urso-agent`; all four session reviewers PASS (CI's AI reviewers cannot run on a pull request that edits `ai-review.yml`; their skip was read in each job log). In CI before the merge: `integration` 50 of 50, the new REL-01 clock test among them. On `main` after the merge: `ci` 10 of 10 jobs passed (run 37005844364), and `deploy-staging` passed with its smoke test (run 37005844368) |
| | BUG-12 | The mutation gate fails silently: on CI the whole-suite run's mutants all time out, and Stryker scores timeouts as detected | ✅ **Done** — 2026-10-02, [#57](https://github.com/bvst/TryggHverdag/pull/57), merged as `a47334f` after `urso-agent` approved it (D-098, D-099). Only a kill counts, each file ≥ 80 %, every run fresh. On CI's four CPUs (#57's job 110875720392): 265 mutants, 0 timed out, about 3 minutes of 25. Reviews PASS in the session (safety, test-auditor, code) and in CI (privacy-security, test-auditor, code). On `main` after the merge: `ci` 10 of 10 jobs passed (run 37040515081), and `deploy-staging` passed (run 37040515144). Record: `progress/m2.md` |
| | BUG-13 | `gate:full` says "0 step(s) after it did not run" after a failure, even when steps did not run: `summarize` in `scripts/lib/steps.mjs` subtracts the counts of `results`, which never holds the steps after a failure, so the number is always 0. On 2026-10-02 four steps did not run and it said 0 | ⚪ **Queued**, for the owner to schedule. On `main`. A reporting bug in what a gate says it skipped, not in what it checks |
| | BUG-14 | The test kit needs the owner, and the mutation check's own files and the test kit join the ai-review `safety` filter (D-100, the owner's answer of 2026-10-02 to CI's `code-reviewer` and `test-auditor` on #57) | ✅ **Done** — 2026-10-02, [#58](https://github.com/bvst/TryggHverdag/pull/58), merged by the owner by hand (D-075) as `34bc460` after `urso-agent` approved. D-100 and its amendment: `/packages/test-kit/` needs the owner; the mutation check's own files, the test kit and the three Vitest configs are in the safety filter. All four session reviewers PASS; CI's four AI reviewers skipped, as expected for a pull request that edits `ai-review.yml` (read in each job log). On #58, the new filter matched `gate-decisions.mjs` and started the safety review, and `mutation` ran fresh, identical to BUG-12 (job 110964175819). On `main` after the merge: `ci` 10 of 10 jobs passed (run 37058587754), and `deploy-staging` passed with its smoke test (run 37058587803). Record: `progress/m2.md` |
| | BUG-15 | CI's required `security` check (`pnpm audit --audit-level high`) failed on `main` and every pull request from 2026-10-02: braces GHSA-vfj7-8cjw-p6xm, no patched version, reached only through Jest and Metro tooling (D-104) | ✅ **Done** — 2026-10-03, [#59](https://github.com/bvst/TryggHverdag/pull/59), merged as `c46b3b3` after `urso-agent` approved; `main`'s tree is the reviewed head `10a1af4`. D-104 (owner, 2026-10-03: accept this one, recorded): one ID in `ignoreGhsas`, and a lockfile test that only `apps/mobile` reaches braces. Reviews PASS in the session (privacy and security, test audit, code) and in CI (all five AI reviewers). On `main` after the merge: `ci` 10 of 10 jobs passed (run 37125357152), and `deploy-staging` passed with its smoke test (run 37125357148). Record: `progress/m2.md` |
| | BUG-16 | `req:coverage` counts a requirement as tested when any test file names its ID, in a comment too: `mentions()` in `scripts/lib/requirements.mjs` searches the file's whole text. Found by CI's `test-auditor` on #60, which checked LOST-01's 20 criteria by hand and found a real test behind each | ⚪ **Queued**, for the owner to schedule. On `main` |
| | BUG-17 | `android-e2e` fails before the app is installed: the emulator still reports `en-rUS` 120 s after the switch to nb-NO. **Three times:** #57 (job 110875720264), #60 (job 111180346250) and #96 (job 118947039610, run 39515647691): "Waited 120 s for the emulator to be in Norwegian bokmål with its package service up … its configuration's language was en-rUS". A re-run passed on #57, and on #96 (job 119070015215, the owner's, because a session may not re-run a job, D-077). The failing run and its passing re-run log the same sequence at the same timing, so the log does not tell them apart (`progress/m3.md`) | ✅ **Done** — 2026-10-22, [#99](https://github.com/bvst/TryggHverdag/pull/99), squashed as `3d2255c` at 10:20:14 UTC. **Root cause:** CI started the emulator with `-change-locale nb-NO`, which the emulator applies after boot by restarting Android's framework, so `e2e:android` could only wait for a switch it could not watch, and three times it had not taken 120 s later (which of "did not take" and "no restart" cannot be known: the script logged nothing of its readings). **The fix (D-140, Claude's choice under D-031):** `e2e:android` makes the switch itself when its first reading is not ready, that is not bokmål or no package service (`adb root`, `adb wait-for-device`, `setprop persist.sys.locale nb-NO`, `setprop ctl.restart zygote`, once each, inside the 120 s wait; a refused step fails at once, naming it), its timeout message says what `persist.sys.locale` said last and whether the framework was seen restarting, and `ci.yml` drops `-change-locale` and `EMULATOR_LOCALE`, so every run takes that path. Red `f7d4e2a`: 17 failing tests and 2 guards, 399 passing; green `9caa720`. The e2e-android, its lib and gate tests: 416 of 416 there, 417 of 417 at the merge (counted 2026-10-23; one test came in later in the pull request). `tests:changes`: "3 changed test file(s), none weakened (RG-03)". `gate:full`: 11 steps passed; its CI-01 step needs the session's proxy setting, and `gate:integrity` run alone with it gives 5 of 5. L3 needs Docker and L7 needs an emulator, so both run in CI. **The merge** was at 10:20:14 UTC, inside REL-10's window B (the merger, by GitHub's API, was `urso-agent`); its deploy cost the canary no run (D-142). **On `main` at `3d2255c`** (GitHub's API, 2026-10-23; job conclusions, not logs): `ci` run 39762336456 succeeded (eleven jobs, `android-e2e` among them, and `mutation-group` skipped) and `deploy-staging` run 39762336560 succeeded. **The pull request's own `android-e2e`** (run 39753601142, job 119739944768, on `ea7d82d`) succeeded; its step "Boot the emulator, switch it to bokmål and run every flow" ran 09:19:30 to 09:24:21 UTC (API step times). From its log, as the coordinating session read it (a session's `gh` cannot fetch logs): "Switching the emulator to bokmål…" at 09:22:08, `nb-rNO` 3.7 s later, the install on attempt 1, 3 of 3 flows. So the switch worked on CI's image once. **Not verified: that the failure is gone.** The old setup also passed on re-run, so two green runs (the pull request's and `main`'s) do not show it; a fourth `en-rUS` timeout would mean the cause is still open. **Two follow-ups, neither urgent:** a stale docblock above `timelinePhase` in `scripts/e2e-android.test.mjs` (`test-auditor`; it still lists `getprop` among the questions `readCount` counts), and the "Emulators only" comment on `checkDevices` in `scripts/lib/e2e-android.mjs`, which should say the run also roots `adbd` (`privacy-security-reviewer`); see `progress/m3.md`, 2026-10-23. The owner's Mac runs (INF-06-AC16) need an image that allows `adb root` (a `google_apis` one does, a Play Store one does not: the script then fails at once, naming `adb root`) |
| | BUG-18 | Three files that decide whether a missed alert or a stopped watchdog can go unseen need the owner and the safety review (D-105 and its two amendments, the owner's answers of 2026-10-03 and 2026-10-04): `apps/server/src/adapters/db.ts` (every pool's size, and LOST-02's session limits), `adapters/worker-heartbeats.ts` (the worker's check-in row) and `modules/health/` (which turns it into `/v1/health`'s answer) | ✅ **Done** — 2026-10-04, [#61](https://github.com/bvst/TryggHverdag/pull/61), merged by the owner by hand (D-075) as `7e05c8e` at 11:48 UTC, with no review on the pull request; `main`'s tree is the reviewed head `974e6e8`. The merge rules were updated at 11:49 UTC and read active with no bypass actors. All four session reviewers PASS; CI's three AI reviewers that apply skipped, as expected (read in each job log). On `main` after the merge: `ci` 10 of 10 jobs passed (run 37199989215), `gate-integrity` among them, and `deploy-staging` passed (run 37199989255). Record: `progress/m2.md` |
| | BUG-19 | No test checks that every file git tracks under every owner-approval path still has owners under CODEOWNERS' last-match rule. Pins exist per file family (since BUG-8), so an ownerless later line for another owned file (for example `/?ackage.json`) un-owns it with every test green. Found by `test-auditor` on BUG-18; replacing the hand-written glob readers with real matchers (`git check-ignore`, picomatch) would also fit here | ⚪ **Queued**, for the owner to schedule. `/.github/` needs the owner, so such a line needs the owner's approval anyway |
| | BUG-20 | graphile-worker's own LISTEN connection prints its error object to the console when it drops or cannot connect (`@graphile/logger` prints meta with `%O`), at start and at every retry while the database is out of reach. The object can name the database's host, port or user, never personal data or the password; it bypasses `log.ts`'s closed events, so for that one connection AC18's "one `database_error` line" is not the only line. Pre-existing (the same on `main` before LOST-02). Found by `privacy-security-reviewer` in LOST-02's reviews and raised again by CI's on [#63](https://github.com/bvst/TryggHverdag/pull/63). The fix the spec names: give Graphile a logger that writes closed events only, without dropping the lines that make a stopped worker loud | ⚪ **Queued**, for the owner to schedule. Claude recommends it before M3, as its own small task |
| | BUG-21 | `scripts/e2e-android.test.mjs`, "INF-06-AC9: when the emulator never applies bokmål, it stops after the deadline …", is load-sensitive: it measures `askedFor`, the span between the first and last device readings, each stamped by a stand-in the test spawns, and allows three 100 ms intervals (`WAITED_OUT` = 700 ms) for start-up. Under `gate:full`'s full-suite load on 2026-10-06 (84 workers) it measured 639 ms and failed; alone it passed 3 of 3, and the same gate passed on its re-run. The script itself said "Waited 1 s". Found while running LOST-03's checks; this file is not in LOST-03's diff. **Seen again on 2026-10-13** during BUG-45's checks, at a load average of about 11.5 with Stryker and a test audit running beside `gate:full`, in two siblings in the same file: "without the tests' shorter deadline, it is still waiting for bokmål after 4 s, not failing at once", and "when the install is still not ready at the deadline …", which made 2 install attempts where it expects more than 2. The second passed 3 of 3 alone at the same load; the file is not in BUG-45's diff | ✅ **Done** — 2026-10-18, [#88](https://github.com/bvst/TryggHverdag/pull/88), squashed as `0c0b239` (the owner, 2026-10-14: `/bugfix BUG-21`): test-only (`e5c6d2e`, loop 1 `b73fc73`). Six `BUG-21:` tests make a slow machine explicit (stand-in calls that start late), and all six failed against the old checks on a correct script. The waits are now judged by what the script decided: a `--import` preload records its own `Date.now` readings and its sleeps, unchanged. The 4 s and 6 s stops count from the first question, not from spawn. Of 24 faults planted in the script's two waits, all are killed; the old file let four through, among them an install given up at half while saying it waited 1 s |
| | BUG-22 | The test-weakening check (RG-03) does not see the shared behaviour suites. `TEST_GLOBS` in `scripts/lib/test-strength.mjs` and `.claude/hooks/test-weakening.mjs` match `*.test.*` files and `apps/mobile/e2e/**`, so `packages/test-kit/src/journey-store-behaviour.ts`, which holds every L2/L3 journey-store behaviour, the alert and outbox ones among them, is never checked; it also uses `{ name, run }` entries, not `test(` calls. In LOST-03's loop 3, `tests:changes` reported "2 changed test file(s), none weakened" while the real edits were in that suite. Ownership is fine: `implementer` cannot edit `packages/test-kit/`. Found by `test-auditor` on LOST-03 | ⚪ **Queued**, for the owner to schedule. Claude recommends adding the shared suites to the check's files and teaching it the `{ name, run }` form |
| | BUG-23 | `pnpm audit --audit-level high` failed on `main` and every pull request on a new advisory, GHSA-68fv-2mgg-jv7q: `source-map-js` before 1.2.2, an event-loop denial of service, reached only through dev tooling (`@vitest/coverage-v8` › `magicast`, and `postcss`). Found on LOST-03's pull request (#64), 2026-10-06 | ✅ **Done** — 2026-10-06, in LOST-03's merge, [#64](https://github.com/bvst/TryggHverdag/pull/64), `57502b8`. Its own pull request, [#65](https://github.com/bvst/TryggHverdag/pull/65), passed all 16 checks and its three applicable AI reviewers, and was closed as superseded once `main` held it byte for byte. `security` passes on `main` |
| | BUG-24 | The same audit also failed on GHSA-pqg4-j6r4-53mv, published 2026-10-06: `shell-quote` before 1.11.0, critical, command injection through `quote()`, reached only through the mobile app's dev tooling (`react-native` › `react-devtools-core`) | ✅ **Done** — 2026-10-06, in LOST-03's merge, [#64](https://github.com/bvst/TryggHverdag/pull/64), `57502b8`. Its own pull request, [#65](https://github.com/bvst/TryggHverdag/pull/65), passed all 16 checks and its three applicable AI reviewers, and was closed as superseded once `main` held it byte for byte. `security` passes on `main` |
| | BUG-25 | An override in a file nobody owns can hide an advisory from the audit: pnpm 10.33 also reads `overrides:` from `pnpm-workspace.yaml`, which has no CODEOWNERS entry, and `privacy-security-reviewer` showed (in a probe project) that an override to a `link:` copy makes `pnpm audit` report nothing. BUG-11's audit-settings test does not look for `overrides`, `packageExtensions` or `patchedDependencies` there, nor for `link:`/`file:` resolutions in the lockfile. Found while reviewing BUG-23/24; predates them | ⚪ **Queued**, for the owner to schedule. Claude recommends a test that keeps those keys in the owned root `package.json` and refuses non-workspace `link:`/`file:` resolutions, or a CODEOWNERS line for `/pnpm-workspace.yaml`. *2026-10-20, #96's `privacy-security-reviewer`: `/pnpm-lock.yaml` has no code owner either (BUG-61's fix edits it); a line for it belongs in the same change.* *2026-10-26: the owner answered "Ja, begge filene": `/pnpm-workspace.yaml` and `/pnpm-lock.yaml` get the owner (D-144, written, in #105: the owner then reviews every change to them, `overrides` included; the CODEOWNERS lines are in, in `e61b03e`, and count on `main` once #105 merges); #104's `privacy-security-reviewer` raised it again, and BUG-65 (#105) makes the test catch the escaped-key route it missed, for as long as the test runs (BUG-69).* *2026-10-26, BUG-67 (#105, not merged): the workspace file's allowlist (`packages` and `catalog` only) also refuses an `overrides:` key there, this bug's route through that file; by the same rule it refuses `packageExtensions` and `patchedDependencies` there, though only `overrides` is pinned by a test. It does not check the rest of this row, the lockfile's `link:`/`file:` resolutions, so BUG-25 stays queued* |
| | BUG-26 | A lint run during a mutation run fails on Stryker's sandbox: `.stryker-tmp/` is in `.gitignore`, but ESLint does not read it, and `IGNORED_PATHS` (`packages/config/eslint/index.mjs`) does not list it. While `gate:full`'s mutation step ran, the stop gate's `gate:quick` reported 480 errors, every one `@ts-nocheck` in `.stryker-tmp/sandbox-*`. A false red, never a false green, and gone once Stryker deletes its sandbox; a sandbox left behind by a crashed run would keep it red. Found during LOST-06, 2026-10-06; predates it | ✅ **Done** — the same finding as BUG-42, fixed with it in [#82](https://github.com/bvst/TryggHverdag/pull/82) (`69370a2`): `.stryker-tmp/` in `IGNORED_PATHS`, with two tests beside the existing ignore tests. `reports/**` is left out: it holds only Stryker's JSON and HTML, which ESLint never lints, so ignoring it would be wider than needed (`test-auditor`, 2026-10-13) |
| | BUG-27 | Whether the worker's session limits are in force on a deploy is seen only by chance. The deploy job's log is Clever Cloud's stream, which ends when Clever Cloud reports the deploy done: on LOST-06's deploy (run 37595559908) "Successfully deployed" came 21 ms after "Starting worker", and the worker's `session limit` read-back line (D-109) was never in the log. The API's was. Earlier deploys caught both only because the timing fell right. The worker ran (its beat moved every 10 s and it checked in). Found 2026-10-07 | ⚪ **Queued**, for the owner to schedule. Claude recommends that each process records its read-back where the smoke test can check it (for example, the worker beside its beat, read through `/v1/health`), so every deploy fails loudly if either process's limits are not in force |
| | BUG-28 | The watchdog's waiting loop (`modules/alerts/watchdog.ts:116-123` on `main` then, 141-147 now, LOST-02) has no test with two journeys held past the stuck threshold, so a loop that stops early goes unseen, in either order: a `break` after the first stuck journey survives `main`'s three L6 alert suites and `alerts.integration.test.ts`, and so does a `break` after the first journey opened within its wait. Later journeys would lose this sweep's retry: their `watchdog_overdue` line, or their open, comes one sweep (about 10 s) later, and `stuck` can be undercounted. With the first break the sweep still fails and pages; with the second, it can record one beat while a journey is held. Found by `test-auditor` in LOST-07's loop-2 and loop-3 audits, 2026-10-07; LOST-07 adds the tests for the escalation's twin loop | ✅ **Done** — 2026-10-18, [#90](https://github.com/bvst/TryggHverdag/pull/90), squashed as `c94e908` (the owner, 2026-10-18: `/bugfix BUG-28`): tests only; five `BUG-28:` L6 tests, one for each answer the first journey's waiting attempt can give, in both orders for held and opened, and each kills a `break` that `main`'s suites let through ([progress/m2.md](progress/m2.md#bug-28--pins-for-the-watchdogs-waiting-loop-two-journeys-at-once-2026-10-18)) |
| | BUG-29 | The required `mutation` check ran out of its 25-minute budget on LOST-07's pull request (#67): `spawnSync pnpm ETIMEDOUT`, twice (jobs 112914873757 and 112942878321, about 25:00 each). Every group that finished passed | ✅ **Done** — with LOST-07 in [#67](https://github.com/bvst/TryggHverdag/pull/67) (`1c4bc8b`): `worker.ts` has a mutation group of its own, without `bin.test.ts`, and each mutant's run starts Vitest directly (D-117; the owner agreed). CI's run on the fix took 21:07, every score unchanged. The budget is not raised; the margin, 3:53, is thin |
| | BUG-30, BUG-31 | Which model and thinking level each agent uses, and how fast the gates run (D-118, D-119) | ✅ **Done** — 2026-10-08, [#68](https://github.com/bvst/TryggHverdag/pull/68) (`5f4bdc1`); the workflow half in [#69](https://github.com/bvst/TryggHverdag/pull/69) (`2c9808f`), merged by the owner by hand (D-075): `--model claude-opus-5-5` for CI's reviews, `--model claude-sonnet-5-5` for the daily report, `TRYGGHVERDAG_REVIEW_JOB=1` on the review step only; review loops 2 to 4 in [#70](https://github.com/bvst/TryggHverdag/pull/70) (`b6ee158`). Their follow-ups BUG-36 to BUG-39 are in #72, below. Record: `progress/m2.md` |
| | BUG-32 | The worker listened for a stop signal only after its start had returned, and Graphile Worker opens the pool's connections before that, so a SIGTERM or SIGINT during the start met no listener and ended the process by the signal: no runner stopped, no pool ended, no exit 0. CI's `integration` check hit it once on #70 (job 113295132594, the D-068 test: `{ code: null, signal: 'SIGTERM' }`); the real worker against a fresh local PostgreSQL 16, signalled as soon as it held a connection, died by SIGTERM 12 times out of 12 | ✅ **Done** — [#71](https://github.com/bvst/TryggHverdag/pull/71) (`acda4c0`): `runWorkerProcess` installs `exitOnSignal` before the start, its stop waits for the start, and a signal during the start is said at once and waits at most 10 s, then exits with 1 (measured: 12 of 12 exits with 0 against the real worker; 10.016 s against a database that never answers) |
| | BUG-33 | `gate:full` cannot measure mutation in a session where Terraform is installed: its static step's `scripts/infra-check.mjs` runs `terraform init -backend=false`, which leaves `infra/staging/.terraform/providers/…/linux_amd64` as a symlink to a directory (the plugin cache in `node_modules/.cache/terraform`), and every Stryker run in the same `gate:full` then stops with `EISDIR: illegal operation on a directory, copyfile` before testing a mutant. CI's `mutation` job runs no `terraform init`, so it is unaffected. Found on BUG-32, 2026-10-08 | ✅ **Done** — 2026-10-10, in REL-10 ([#77](https://github.com/bvst/TryggHverdag/pull/77), `b6c6074`): `ignorePatterns: ['infra/**/.terraform']` in `stryker.config.mjs` (`e9f1d11`), with its test (`389ecea`, red first). REL-10's first `gate:full` hit it again on the new `random` provider |
| | BUG-34 | The worker's start can hang silently: `createPool` sets no `connectionTimeoutMillis`, so a database that accepts the connection and never answers holds the start forever, with nothing written after the start-up lines. A worker stuck there watches nobody: no beat, so the Healthchecks.io check-in stops and `/v1/health` reads degraded. Shown by `safety-reviewer` on BUG-32 (a TCP listener that never answers as `DATABASE_URL`), 2026-10-08; predates BUG-32 | ✅ **Done** — 2026-10-18, [#89](https://github.com/bvst/TryggHverdag/pull/89), squashed as `1151d18` (the owner, 2026-10-18: `/bugfix BUG-34`): every pool gives up on a connection's handshake after `CONNECT_TIMEOUT_MS` (5 s) through a `pg.Client` subclass, never on a wait for a free client in a full pool (red `3023816`, fix `befe3ed`, loop 1 `c74d569` and `52f510b`). A worker started against a silent database now writes `worker failed: Error: timeout expired` and exits 1 within 5 s; migrations fail the deploy and the API answers 500, each within about 6 s. The one open edge is BUG-51 (a connection that hangs after its handshake) |
| | BUG-35 | `exitOnSignal` (`apps/server/src/process.ts`) listens with `once` per signal, so a second SIGTERM during a stop finds no listener and ends the process by the signal, before the pool is ended. Found by `test-auditor` on BUG-32, 2026-10-08; predates BUG-32 | ⚪ **Queued**, for the owner to schedule. Claude recommends keeping a listener for the whole stop that ignores repeats, with a test sending SIGTERM twice |
| | BUG-36 | Any tool call could change `.claude/settings.local.json` (`disableAllHooks` turns every hook off) or the hooks' own records in `.claude/state/` (a written `gate-passed` skips the stop gate, `red:` in `phase` downgrades it), and Claude Code's own protection of `.claude/` is a classifier's call in auto mode. From `privacy-security-reviewer` on #68 | ✅ **Done** — [#72](https://github.com/bvst/TryggHverdag/pull/72) (`aa8a94d`), D-120: the global guards refuse it from every session and subagent, `phase` the main session's only, paths judged from the repository. Review loop 3 (a redirect into a backtick command, a quoted `2>&1`, a file at the state folder's path) is done too: [#73](https://github.com/bvst/TryggHverdag/pull/73) (`689a0b5`, 2026-10-08) |
| | BUG-37 | The five reviewer briefs said the gate reads the verdict's last line; CI reads structured output and checks the comment | ✅ **Done** — [#72](https://github.com/bvst/TryggHverdag/pull/72) (`aa8a94d`): the paragraph says who reads the last line now |
| | BUG-38 | Four reviewers kept a loose memory file (`.claude/agent-memory/<agent>.md`, 577 lines in all) that Claude Code never loads | ✅ **Done** — [#72](https://github.com/bvst/TryggHverdag/pull/72) (`aa8a94d`): each moved, byte-for-byte, into its agent's folder; a test keeps the folder tidy |
| | BUG-39 | Agents were sent to `docs/plan/decisions.md`, over 4,400 lines, to read one decision | ✅ **Done** — [#72](https://github.com/bvst/TryggHverdag/pull/72) (`aa8a94d`): `pnpm run decision D-NNN`; CLAUDE.md and `architecture-rules` point to it |
| | BUG-40 | `scripts/lib/affected.mjs` counts `.claude/agent-memory/**` and `docs/plan/decisions.md` as inert, so a pull request that changes only those skips CI's `unit` job, and with it the tests that read them: `agent-memory.test.mjs` (BUG-38) and `decision.test.mjs` (BUG-39) on this branch, and `dependency-audit.test.mjs`, which has read `decisions.md` since BUG-15. `affected.test.mjs` pins both as inert. Found by `test-author` and `test-auditor` on BUG-36 to BUG-39, 2026-10-08 | ⚪ **Queued**, for the owner to schedule. Claude recommends counting both as code, with `affected.test.mjs` changed under a written reason (RG-03), in its own pull request |
| | BUG-41 | SM-10's mutation run ran out of its 25-minute budget locally (`spawnSync pnpm ETIMEDOUT`): alone on a 4-core machine, domain 9:29, healthchecks 2:01, journeys 4:28 and alerts 8:15 took 24:13 before `worker` started, about 32 minutes in all against LOST-07's 18:57. Every group that finished passed. Each mutant's run is mostly Vitest's transforms (55 to 77 %), and SM-10 grew the test kit the domain tests import whole | ✅ **Done** — in SM-10's [#74](https://github.com/bvst/TryggHverdag/pull/74) (`f4ded6d`): each mutant's command reuses Vitest's transforms (`--fsModuleCache`, inside the run's own sandbox) and runs its files one at a time (`--maxWorkers=1`), D-124. Locally about 16 minutes, with the same status for every mutant (1,170 of 1,170). **CI's mutation step took 12:15** (job 113802883028), every run passed; LOST-07's took 21:07. The budget is not raised |
| | BUG-42 | `gate:quick`'s lint and formatting read `.stryker-tmp/`, so while a mutation run is going, or after one is killed at its limit (which leaves its sandbox behind), the stop gate fails on Stryker's instrumented copies (`@ts-nocheck` in every file: 513 to 1,033 errors) rather than on the branch. Seen three times during SM-10, and again in REL-10: the mutation runs that crashed on BUG-33's `EISDIR` left eight sandboxes | ✅ **Done** — 2026-10-13, [#82](https://github.com/bvst/TryggHverdag/pull/82), squashed as `69370a2` (fix `a4106b6`, red first in `7fe39a7`; the owner, 2026-10-13: "Let's do BUG-42"): `.stryker-tmp/` in ESLint's `IGNORED_PATHS`. Only ESLint read the folder; Prettier already skips it through `.gitignore`. The queued second half, removing a timed-out run's sandbox, is dropped: the gate no longer reads it, deleting a sandbox another Stryker run is using would silently count its mutants as killed, and it would not have removed the crash leftovers seen |
| | BUG-43 | `deploy.integration.test.ts`, LOST-08-AC20, takes the first outbox row of the 0007 seed (`const [message] = before.outbox`, ordered by random UUID). When that row is the walker's `NO_RESPONDER` message, which has no `alert_id`, its `SAFE`/`EXPIRED` insert violates `outbox_alert_id_journey_id_check`, so the test fails at random. It failed `integration` on #77 at `0513b21` (job 114202479612; every REL-10 test passed); it is on `main` since LOST-08 (#75) | ✅ **Done** — 2026-10-10, [#79](https://github.com/bvst/TryggHverdag/pull/79), merged as `85426bf` at 17:45 UTC after `urso-agent` approved (test only, `546a82e`; the owner: "Start BUG-43 now"). Reproduced first: the `NO_RESPONDER` row forced first gave SQLSTATE 23514, and 2 of 40 runs of the unchanged file failed (15 messages in the seed, 14 an alert's). The pick now finds a message that names an alert and asserts one was found; nothing else changed (RG-03). Every check and CI's reviewers passed; `main`'s CI and `deploy-staging` passed |
| | BUG-44 | No test checks that `startWorker` hands the canary its real wait: `worker.ts` (about line 454) passes `wait: CANARY_WAIT` to `createCanary`, and a wait that ignores its signal, wired in there instead, passes all 190 worker tests (`test-auditor`, in the session and in CI on #80). Low risk: a stopped run still ends at once through `run.ts`'s race, and the process exits, so the worst case is a stray timer, not a missed alert. Found on the REL-10 follow-up, 2026-10-10 | ✅ **Done** — 2026-10-14, [#87](https://github.com/bvst/TryggHverdag/pull/87), squashed as `111815d` (the owner, 2026-10-14: `/bugfix BUG-44`): two `BUG-44:` tests in `apps/server/src/worker.test.ts` (`d560734`, loops `2d3a252` and `749c050`) run the canary `startWorker` made and count its run limit's real timer: one while in flight, none once a stop or its own end has finished it. No production change. Of seven faults planted in the wiring, five are killed by these tests and by nothing else, and one (the wait left out) also by six REL-10 tests and `tsc`. Accepted, not pinned: a signal-respecting wait of the wrong length. It is loud, not silent: every run ends `RUN_LIMIT` and pages, or a hung run pages through `staging-canary` (`test-auditor` and `safety-reviewer`) |
| | BUG-45 | The mutation check takes 17 to 20 minutes, and every push or fix pays it again: its eight groups run one after another in one CI job (1,691 mutants; #80 17:20, #77 19:44), it is CI's critical path, and the margin under D-098's 25 minutes is closing. Six mutants end only by timing out. Raised by the owner, 2026-10-13 | ✅ **Done** — 2026-10-13, [#83](https://github.com/bvst/TryggHverdag/pull/83), squashed as `9cc74b7` (D-129, the owner's answers; D-130, the design; spec `specs/BUG-45.md`). On #83's own CI the check took **4:57** from the plan's start to the aggregator's end (17:20 on #80, 19:44 on #77), the eight legs started within 3 s of each other, and no mutant timed out. Still unseen: re-running one leg alone (AC13's second half; D-077 leaves re-runs to the owner, and #83 merged on its first attempt). What was asked for: one CI job per group under an aggregator still named `mutation`, a local `pnpm run mutation --group <name>`, and the six timeouts fixed |
| | BUG-46 | A mutation run with a `--base` git cannot resolve skips quietly. With an unknown base, `changedFiles` (`scripts/lib/git.mjs`) returns only the uncommitted files, so `pnpm run mutation --only-if-safety-paths-changed` (and `--plan`) decides "nothing to mutate" and exits 0. CI is safe, because `affected.mjs` runs first in `mutation-plan` and fails on a base it cannot see; a local run (`gate:full`'s mutation step, or `--plan` by hand) is not. Pre-existing; found by `safety-reviewer` in BUG-45's review and reproduced the same day: `pnpm run mutation --plan --only-if-safety-paths-changed --base origin/no-such-branch` printed `decision=skip` and exited 0 | ✅ **Done** — 2026-10-13, [#84](https://github.com/bvst/TryggHverdag/pull/84), squashed as `595c584` (the owner, 2026-10-13: "do" it, and "All three gates"; D-131): `tests:changes` and `coverage:ratchet` were reproduced passing the same way ("nothing to compare against", "0 changed file(s)"), so all three refuse a base git cannot resolve. A fourth, `req:coverage --fail-on-uncovered-changed`, was found by `safety-reviewer` and reproduced; the owner added it (D-131 amended) |
| | BUG-47 | No test checks which files `req:coverage --fail-on-uncovered-changed` treats as product code. Its list (`IMPLEMENTING_DIRS` in `scripts/req-coverage.mjs`: `apps/`, `packages/` and `docs/specs/`) can lose `apps/` or `packages/`, or gain `scripts/`, with every test green: no entry-point test commits a product file that names an ID with no test, or a tooling file that mentions one. Pre-existing (the same three faults survived the old `||` chain). Found by `test-auditor` in BUG-46's loop-1 audit, 2026-10-13 | ✅ **Done** — 2026-10-14, [#86](https://github.com/bvst/TryggHverdag/pull/86), squashed as `f1bfb5e` (the owner, 2026-10-13: "Continue"): `BUG-47:` pins in `scripts/lib/requirements.test.mjs`. `test-author` planted eight faults in the folder check and reports each killed by exactly one test; CI's `test-auditor` re-planted seven of them with the same result (the eighth, adding `.claude/`, is blocked by the bash guard). The one fault that still survives, outside this bug, is BUG-50 |
| | BUG-48 | Two of the session's own hooks treat an `origin/main` git cannot resolve as "nothing committed", the quiet pass D-131 ended in the gates. `.claude/hooks/stop-gate.mjs` (lines 33-38): when `git merge-base HEAD origin/main` fails, the committed diff counts as empty, so on a clean working tree the stop gate exits 0 without running `gate:quick`. `.claude/hooks/progress-gate.mjs` (line 52) reads `changedFiles`, which narrows the same way, so HK-08 cannot see committed code changes either. Local sessions only; CI has no such hook. Found by CI's `safety-reviewer` and `code-reviewer` on #84, 2026-10-13; confirmed by reading the code, not reproduced | ✅ **Done** — 2026-10-14, [#85](https://github.com/bvst/TryggHverdag/pull/85), squashed as `85aa8fb` (the owner, 2026-10-13: "Continue", after this row's recommendation): both hooks act on "could not tell" instead of "nothing committed", as D-131's gates do. The stop hook runs its gate, the progress hook refuses with the shared message |
| | BUG-49 | Moving `origin/main` gets a session past the stop and progress hooks. `git update-ref refs/remotes/origin/main HEAD` makes the merge base equal HEAD, so both hooks judge only the working tree, and committed code changes skip `gate:quick` and HK-08. The same kind of bypass as `assume-unchanged`; pre-existing; CI's required checks do not rest on these hooks, and the command is not on `.claude/settings.json`'s allow list, so a session must ask before running it. Found by `privacy-security-reviewer` on BUG-48, 2026-10-14, and reproduced by CI's on #85: in a scratch repository with a failing committed change, both hooks exited 0 and no gate ran. Whether "a session must ask" holds is unverified: a session in auto mode can run a command that is not on the allow list without asking | ⚪ **Queued**, for the owner to decide (`.claude/` needs the owner's approval). The reviewer's options: the stop gate refuses when the merge base equals HEAD while the branch has commits the real remote lacks, or the bash guard treats `git update-ref` (and `git fetch` with a refspec) as a git write |
| | BUG-50 | No test checks that `req:coverage --fail-on-uncovered-changed` leaves changed test files out of the files that can implement an ID. Removing `!matchesAnyGlob(file, TEST_GLOBS) &&` at `scripts/req-coverage.mjs:130` leaves all 55 tests in `scripts/lib/requirements.test.mjs` green. The fault makes the gate refuse more, not less: a changed test file under `apps/` or `packages/` that names an ID no counted test covers would be refused as product code. Found by CI's `test-auditor` on #86 (BUG-47), 2026-10-14, which judged the impact close to none; not reproduced in the session | ⚪ **Queued**, for the owner to decide. The auditor's suggestion: a `BUG-50:` case that commits an `apps/…` test file naming an uncovered ID and expects no refusal |
| | BUG-51 | A database connection that hangs after its handshake is still unbounded: neither pool sets TCP keepalive, `statement_timeout` or `query_timeout`, so a query that never returns, or a peer that vanishes without a reset, holds a sweep, a Graphile query or the API's session-limits read-back forever. The API's `stop()` awaits that read-back (`apps/server/src/api-process.ts:83`), so a stop then waits until the platform kills it. Detection is covered (a hung sweep writes no beat, so the minute check-in stops, Healthchecks.io pages in about 3 minutes and `/v1/health` reads degraded); recovery is not: the worker never restarts on its own. Predates BUG-34 and is not made worse by it (BUG-34 bounds only the handshake). Found by `safety-reviewer` on BUG-34, 2026-10-18 | ✅ **Done** — 2026-10-19, [#92](https://github.com/bvst/TryggHverdag/pull/92), squashed as `0df5737` (the owner, 2026-10-18: `/bugfix BUG-51`, and "Time out the query", D-132): the API's and the worker's pools send `statement_timeout` 10 s, bound every query at 15 s (the connection ended, its pool place given back, ETIMEDOUT so Graphile retries) and keep TCP keepalive after 10 s idle; staging reads both limits back ([progress/m2.md](progress/m2.md#bug-51--a-query-the-database-never-answers-fails-within-a-limit-2026-10-18-to-2026-10-19)) |
| | BUG-52 | `gate:file` cannot check an edited L6 or L3 test file. It runs an edited `*.system.test.ts` or `*.integration.test.ts` with `vitest run` and the unit config, whose `exclude` names both, so Vitest finds no test files and exits 1 (`scripts/gate-file.mjs:63-72` on `main`). Measured 2026-10-18 on the unchanged `escalation.system.test.ts` and `alerts.integration.test.ts`: "No test files found, exiting with code 1". So the post-edit hook reports every edit to such a file as a failure while running none of its tests; LOST-07's record in `progress/m2.md` called the same output "Not a failure". Edited L6 tests still run in `gate:full` (`test:system`) and in CI, and L3 tests in CI. Found by `test-author` in BUG-28 | ✅ **Done** — 2026-10-20, [#93](https://github.com/bvst/TryggHverdag/pull/93), squashed as `20af31a` (the owner, 2026-10-19: `/bugfix BUG-52`, and "Yes, change the hook", D-133): `gate:file` runs each edited test with the config whose `include` finds it (L6 with the system config; L3 with the integration config, or "not possible here" without Docker), and the post-edit hook passes that note to the session as `additionalContext`. The hook loads no repository code, so a gate that throws, never settles or hangs still blocks ([progress/m2.md](progress/m2.md#bug-52--each-edited-test-runs-at-its-own-level-and-the-post-edit-hook-says-what-could-not-run-2026-10-19)) |
| | BUG-53 | Two hooks fail open when the repository code they import cannot load: `progress-gate.mjs` and `test-weakening.mjs` import from `scripts/lib` statically, so a syntax error there, or a mid-TDD import of a name not yet exported, ends the hook with node's exit 1, which Claude Code treats as non-blocking: the session is told nothing and the check does not run until the file is fixed. The stop gate imports only `./lib.mjs` and spawns `gate:quick`, so the end of the turn still fails loudly, and CI backs it. The post-edit hook's unguarded `JSON.parse` of `package.json` fails the same way on a malformed file (the implementer, BUG-52 loop 2). Found by `privacy-security-reviewer` and `test-auditor` on BUG-52's loop 1, 2026-10-19, where the post-edit hook had the same fault and BUG-52 fixes it there | ⚪ **Queued**, for the owner to schedule (`.claude/` needs the owner's approval). Claude recommends what BUG-52 ships in the post-edit hook (D-133): the hook loads no repository code and runs the check in a child process with a named time limit, blocking on a non-zero exit, a signal or a timeout. A guarded `import()` is not enough: it cannot catch a load that never finishes (a top-level await that never settles exits 13, a busy loop hangs the hook) |
| | BUG-54 | `test-weakening`'s focused-test pattern (`scripts/lib/test-strength.mjs`, `\bf(?:it|describe)\b`) counts the English word "fit" anywhere in a test file as a focused test, so a test named "…steps fit inside…" is flagged as weakened. It fails closed, but a check people learn to word around, with no record of why, loses trust. Found by `test-author` and confirmed by `test-auditor` on BUG-52, 2026-10-19 | ⚪ **Queued**, for the owner to schedule. Claude recommends matching `fit(` and `fdescribe(` as calls, not as words |
| | BUG-55 | When the post-edit hook's limit stops `pnpm` (`spawnSync`'s timeout sends SIGTERM to `pnpm` only), the gate's own node child keeps running, reparented to PID 1, until it ends by itself. Only a gate that hangs in its own code reaches the limit (its steps stop at 150 s), so this needs a gate already broken, and then every checked edit adds one more spinning process. Availability only: the orphan prints nowhere and holds only the session's own environment. Predates BUG-52 (`main`'s hook has the same `spawnSync`). Found by `test-author` and confirmed by `privacy-security-reviewer` and `test-auditor` on BUG-52, 2026-10-19 | ⚪ **Queued**, for the owner to schedule (`.claude/` needs the owner's approval). Claude recommends starting `gate:file` detached and killing its process group at the limit, as `runStep` in `scripts/gate-file.mjs` already does |
| | BUG-56 | guard-bash splits a command into words at quotes before it judges paths, so quoted pieces the shell joins into one word, such as `".clau""de"`, are judged one by one and escape its `--deny-write-glob` rules (D-120). The same word splitting has other known gaps: `>&file`, `xargs rm`, `unlink`, `find -delete`, brace expansion and a backslash in a name (`privacy-security-reviewer`, open since BUG-36's loop 1). A change under `.claude/` still needs a code owner and CI to merge, and no secret is reachable through it. `test-author` used the quote splice in a throwaway worktree on BUG-52, 2026-10-19, which no brief allows | ⚪ **Queued**, for the owner to schedule (`.claude/` needs the owner's approval). Claude recommends one fix for the word splitting as a whole (join words as the shell does before matching, and refuse a command the guard cannot parse), and a line in the agent briefs that getting around a guard is never allowed, even in a scratch copy |
| | BUG-11 | The dependency audit accepts one advisory, GHSA-86w9-cpqp-85rv in `node-forge` (D-093) | ✅ **Done** — merged with SM-01 in [#53](https://github.com/bvst/TryggHverdag/pull/53) (`2db7046`). Its own pull request, [#54](https://github.com/bvst/TryggHverdag/pull/54), was closed as superseded: every file it held was already on `main` |
| 2 | LOST-01 | Heartbeat, with or without position | ✅ **Done** — 2026-10-03, [#60](https://github.com/bvst/TryggHverdag/pull/60), merged as `fe384c5` after `urso-agent` approved; `main`'s tree is the reviewed head `5aa074c`. D-101 to D-103 (D-102 amended); 20 acceptance criteria. Reviews PASS in the session (all four, and the three blocking ones again after loop 1) and in CI (all five AI reviewers). In CI before the merge: `integration` 103 of 103 on PostgreSQL 15; `mutation` every safety file ≥ 96 %, 0 timed out. On `main` after the merge: `ci` 10 of 10 jobs passed (run 37144094720), and `deploy-staging` ran migration `0002` and passed its smoke test (run 37144094724). Record: `progress/m2.md` |
| 3 | LOST-02 | Lost-contact alert: the watchdog, the outbox, a recording push fake | ✅ **Done** — 2026-10-05, [#63](https://github.com/bvst/TryggHverdag/pull/63), merged as `5cd5d24` at 06:50 UTC after `urso-agent` approved; `main`'s tree is the reviewed head `6527e38`. 25 acceptance criteria; D-106, D-107 and D-109 (owner), D-108 (delegated, amended). Session reviews: `test-auditor` blocked the first round, fixed in loop 1; all three blocking reviewers PASS after loops 1 and 2. In CI on `6527e38`: all 16 checks passed, all five AI reviewers PASS; `integration` on PostgreSQL 15; `mutation` every run passed (`watchdog.ts` 87 of 87, `outbox.ts` 37 of 38, `worker.ts` 140 of 146). On `main` after the merge: `ci` 10 of 10 jobs passed (run 37274508925), and `deploy-staging` passed (run 37274508942), with both session-limit lines in force. Record: `progress/m2.md` |
| 4 | LOST-03 | Back in contact | ✅ **Done** — 2026-10-06, [#64](https://github.com/bvst/TryggHverdag/pull/64), merged as `57502b8` at 17:56 UTC after `urso-agent` approved; `main`'s tree is the reviewed head `53bf338`. 20 acceptance criteria; D-110 and D-111 (owner), D-112 (delegated, amended in three review loops). Session reviews: all four PASS in the first round; the three blocking ones PASS after loops 1, 2 and 3 (the process's limit). In CI on `53bf338`, with BUG-23/24's fix merged in: all 16 checks passed, and the four AI reviewers that review its paths PASS; `integration` on PostgreSQL 15; `mutation` every run passed (`journey.ts` 134 of 135, `service.ts` 122 of 123, `outbox.ts` 37 of 38, `worker.ts` 140 of 146). On `main` after the merge: `ci` 10 of 10 jobs passed (run 37507461460), and `deploy-staging` passed (run 37507461487), with both session-limit lines in force and migration 0004 applied. Record: `progress/m2.md` |
| 5 | LOST-06 | "I'm on it" | ✅ **Done** — 2026-10-07, [#66](https://github.com/bvst/TryggHverdag/pull/66), merged as `e695e8a` at 08:42 UTC after `urso-agent` approved; `main`'s tree is the reviewed head `5925938`. 17 acceptance criteria; D-113 (owner) with its amendment (the notice is not pushed on a platform until a real-phone test shows it never displaces an undelivered critical alert), D-114 (delegated). Session reviews: all three PASS in the first round; two review loops; `test-auditor` PASS, then a delta audit PASS. In CI on `5925938`: all 16 checks passed, all five AI reviewers PASS; `integration` on PostgreSQL 15, migration 0005 included; `mutation` every run passed (`acknowledgement.ts` 37 of 37, `journey.ts` 176 of 177). On `main` after the merge: `ci` 10 of 10 jobs passed (run 37595559915), and `deploy-staging` passed (run 37595559908); the worker's session-limit line was not in the deploy's log (BUG-27). Record: `progress/m2.md` |
| 6 | LOST-07 | SMS escalation at 2 minutes | ✅ **Done** — 2026-10-07, [#67](https://github.com/bvst/TryggHverdag/pull/67), merged as `1c4bc8b` at 19:43 UTC after `urso-agent` approved; `main`'s tree is the reviewed head `2a65c3a`. 20 acceptance criteria; D-115 (owner, five answers), D-116 (delegated, three review-loop amendments), with BUG-29 in it (D-117). Session reviews: all three PASS in the first round; three review loops; `test-auditor` blocked loop 1's head and passed loops 2 and 3. In CI on `2a65c3a`: all 16 checks passed, all five AI reviewers PASS (the privacy reviewer after two re-runs: a review that ran but returned no structured verdict, explained by D-121); `integration` on PostgreSQL 15 with migration 0006; `mutation` 21:07 against 25:00. On `main` after the merge: `ci` passed (run 37676690823) and `deploy-staging` passed (run 37676690808); the smoke test saw the worker check in at 19:47:54 UTC, so the stricter ping-URL check accepted the existing `HEALTHCHECKS_WORKER_URL`. **A-33 done** (the owner, 2026-10-07; apply run 37678702578). Record: `progress/m2.md` |
| 7 | SM-10 | Removing a responder: resumed escalation and the last-responder warning (D-115) | ✅ **Done** — 2026-10-09, [#74](https://github.com/bvst/TryggHverdag/pull/74), merged as `f4ded6d` at 13:36 UTC after `urso-agent` approved: D-122 (the owner's four answers), D-123, and BUG-41's faster mutant runs (D-124). Three review loops; every check and all five CI reviewers passed, mutation in 12:15 and 13:48. `main`'s CI and `deploy-staging` passed; migration 0007 ran in the pre-run hook |
| 8 | LOST-08 | "They're safe" | ✅ **Done** — 2026-10-09, [#75](https://github.com/bvst/TryggHverdag/pull/75), merged as `f5c14b2` at 18:33 UTC after `urso-agent` approved: the owner's two answers (D-125) and the delegated choices (D-126). One review loop; every check and all five CI reviewers passed, mutation in 15:19. `main`'s CI and `deploy-staging` passed; migration 0008 ran in the pre-run hook |
| 9 | REL-10 | The staging canary | ✅ **Done** — 2026-10-10, [#77](https://github.com/bvst/TryggHverdag/pull/77), merged as `b6c6074` at 16:06 UTC after `urso-agent` approved; `main`'s tree is the reviewed head `1e6f957`. 19 acceptance criteria; D-127 (owner, three answers), D-128 (delegated, amends D-091 for the canary only, with a review-loop amendment). The filter lines shipped first in [#76](https://github.com/bvst/TryggHverdag/pull/76) (`5e5dc81`). Two review loops; every check and all five CI reviewers passed `1e6f957`, mutation in 19:26 (`run.ts` 95.9 %, `worker.ts` 96.41 %). `main`'s CI (all 10 jobs) and `deploy-staging` passed; REL-10 adds no migration, and the deployed worker has no canary setting until A-35's apply. A-34 and A-35 are done (the owner): the plan and apply ran on 2026-10-20 (06:36:55 UTC), and **window B of the 24-hour reading, REL-10-AC19, closed M2 on 2026-10-23 (D-142)**: 96 of 96 runs `ON_TIME`, with BUG-63, the outage of 2026-10-21 that ended window A, still open (row below). Follow-up in [#80](https://github.com/bvst/TryggHverdag/pull/80) (`8838d0d`, 2026-10-13): four REL-10-AC9 tests of the canary's real wait, which kill the mutant #77 left alive, and two out-of-date comments in `worker.ts` |
| | BUG-63 | Staging's public API gave the canary no HTTP answer three times between 11:50 and 12:20 UTC on 2026-10-21: "I'm home" failed fast twice (`HOME_FAILED`, 11:50:02 and 12:20:04) and one start timed out after 10 s (`START_FAILED`, 12:00:10). The worker and the database were fine and nothing restarted; the owner did nothing against staging (their last action was at 07:51 UTC). `staging-canary` went from up to down at 11:50. Two escalation SMS were written (`74c29daf`, `ce489c45`) and `sms_unsent` was reported from 11:54 to 12:15 and at 12:24: the canary escalated and paged the SMS check, so D-128's "never escalates" was wrong for a failed "I'm home" (corrected in D-142). It ended window A. **The cause is unknown:** the API writes no per-request log | ⚪ **Open**, for the owner to decide. Claude proposes one log line per API request: the route (its pattern, not the path), the status and the duration in milliseconds, nothing else (PRIV-07). It adds a closed event to `apps/server/src/log.ts`, an owned path (D-102), so it needs the owner's yes. Claude recommends it as a small `/bugfix BUG-63`; the owner may first want to look at Clever Cloud's metrics for 11:40 to 12:25 UTC on 2026-10-21, which a session cannot reach. It does not stop the line (D-127, second answer). Found 2026-10-21; record: `progress/m2.md` |

## M1 at a glance

**M1 is closed** (2026-10-01, **D-088**). Its exit — spike results recorded,
the SDK go/no-go decision, and Section 4 closed — is met (D-086), and the
roadmap's fourth M1 item, the Critical Alerts request, is drafted and merged
too (D-087, STORE-01). As with M0 (D-083), the owner made the call. **M2,
the core safety loop on the server, started on 2026-10-01 (above).**

| ID | Task | Status |
|----|------|--------|
| SPIKE-01 | Background safety on emulators and simulators: S1–S7, and S8, MapLibre with Kartverket's tiles | ✅ Done (2026-10-01) — both nights ran (`night-20260930`, 38 runs; `night-20261001-s1-exempt`, 2 runs; none invalid), all four reviewers passed through review loop 2, and the owner chose a **conditional GO** over the rule's NO-GO, recorded as **D-086**. Results: `docs/plan/04b-spike-results.md`. Section 4 is closed Merged as `d6a2dff` ([#49](https://github.com/bvst/TryggHverdag/pull/49), 2026-10-01); CI on `main` green, 10 of 10 jobs; the raw network captures deleted, as D-086 says |
| STORE-01 | Critical Alerts entitlement request drafted | ✅ Done (2026-10-01) — `docs/plan/critical-alerts-request.md`, from the spec `docs/specs/STORE-01.md`. The owner answered Q1–Q4; **D-087** records them. Safety, privacy, test-auditor and code reviews all PASS (safety and privacy re-checked after fixes, and passed again). The owner's to-do to send it once A-02 exists is **A-30**, due M4 at the latest. Merged as [#51](https://github.com/bvst/TryggHverdag/pull/51) (`881c780`, 2026-10-01); CI green on `main` — `ci` (10 of 10 jobs) and `deploy-staging` both passed |

**M1's five open items, found while planning SPIKE-01, are now all answered**
(full account in [`progress/m1.md`](progress/m1.md)): (a) and (c) when
Section 4 closed; (b) by the licence timing in D-086; (d) by STORE-01
getting an ID and being drafted; (e), the public repository with no
decision recording it, by **D-089**.

**What stays open does not block M2:** D-086's conditions (L9 on real
devices), A-30 (send the request once A-02 exists), the spike harness's
known limits, and three `.claude/` configuration gaps needing the owner's
approval (below, under "Live gotchas").

## M0 at a glance

| ID | Task | Status |
|----|------|--------|
| INF-00 | Mac environment check | ✅ Done — 2026-09-25. `pnpm run doctor` passes 9 of 9 on `claude-dev`, and the owner confirmed Remote Control |
| INF-01 | Monorepo skeleton | ✅ Done — 2026-09-20 ([#2](https://github.com/bvst/TryggHverdag/pull/2)) |
| INF-02 | Claude Code configuration + hook tests | ✅ Done — 2026-09-20 ([#2](https://github.com/bvst/TryggHverdag/pull/2)) |
| INF-03 | Gate scripts + HK-08 | ✅ Done — 2026-09-20 ([#2](https://github.com/bvst/TryggHverdag/pull/2)) |
| INF-04 | CI workflows, merge rules, CODEOWNERS | ✅ Done — 2026-09-23 ([#3](https://github.com/bvst/TryggHverdag/pull/3)) |
| INF-05 | Server skeleton | ✅ Done — 2026-09-23 ([#6](https://github.com/bvst/TryggHverdag/pull/6)); four test levels green, mutation 100 % |
| INF-06 | App skeleton | ✅ Done — 2026-09-28 ([#34](https://github.com/bvst/TryggHverdag/pull/34)). L5 and L7 pass in CI: `android-e2e` "1 of 1 flow passed" on runs 7 and 9. The first run on `main` failed on a 2-core emulator; BUG-6 ([#37](https://github.com/bvst/TryggHverdag/pull/37)) gave it 4 cores, and `main` is green again |
| INF-07 | Staging on Clever Cloud | ✅ Done — 2026-09-25 ([#22](https://github.com/bvst/TryggHverdag/pull/22), fixes [#23](https://github.com/bvst/TryggHverdag/pull/23) [#24](https://github.com/bvst/TryggHverdag/pull/24), names [#25](https://github.com/bvst/TryggHverdag/pull/25)). A merge deployed and the smoke test passed; BUG-3 fixed ([#27](https://github.com/bvst/TryggHverdag/pull/27)) |
| INF-08 | Monitoring | ✅ Done — 2026-09-28 ([#31](https://github.com/bvst/TryggHverdag/pull/31)). In the owner's drill (2026-09-26) Healthchecks.io alerted about 3 minutes after the worker's last ping, and UptimeRobot alerted too, both by email. The owner accepted it with no UptimeRobot app; UptimeRobot's recovery and its keyword rule were not checked |
| INF-09 | Daily status workflow | ✅ Done — 2026-09-25 ([#18](https://github.com/bvst/TryggHverdag/pull/18)). Since D-080 ([#32](https://github.com/bvst/TryggHverdag/pull/32)) a dashboard: the description of the pinned issue [#35](https://github.com/bvst/TryggHverdag/issues/35), replaced every run. It is scheduled at 01:07 UTC, but GitHub starts it about 5½ hours late, so it lands around 08:30 in Oslo. The missed-run alarm is proven (2026-09-25) |
| INF-10 | Gate drills | ✅ Done — 2026-09-29 ([#42](https://github.com/bvst/TryggHverdag/pull/42)). Seven offline drills run on every pull request that can change a gate, and each is shown to go red when its gate is made to pass. The push to `main` and the merge without owner approval are covered by `gate:integrity`; their one live attempt is an M5 go-live item (D-083) |

**M0 is closed** (2026-09-29, D-083):
- every INF task above is done;
- the seven offline gate drills pass on every pull request that can change a
  gate;
- CI is green on `main` after #42 and #41.

The owner chose to move the live attempt at the two GitHub-only drills to M5's
go-live checklist. So D-071's question, whether GitHub enforces code-owner
review, stays open until then.

**Done since M0 closed** (2026-09-29; the account is in
[`progress/m0.md`](progress/m0.md)):
- **BUG-8:** six more gate files need the owner's approval (D-084).
  [#46](https://github.com/bvst/TryggHverdag/pull/46), merged at 15:45 UTC as
  `ba94a45`.
- **D-085 and BUG-9:** CI names `ubuntu-26.04` ahead of GitHub's move, and the
  emulator install waits through a refused session.
  [#43](https://github.com/bvst/TryggHverdag/pull/43), merged at 19:42 UTC as
  `0637482`. Its loose ends are under "In flight".
- **The D-075 batch:** `ai-review.yml` on `ubuntu-26.04`, and three Dependabot
  bumps. [#48](https://github.com/bvst/TryggHverdag/pull/48), merged as
  `05ca463` (checked with `git log` and `git show --stat`: it changed all
  five workflows).

**The reviewer gate works.** As of 2026-09-23 it reviews real code and returns
verdicts. On its first working day it caught two genuine bugs, a half-finished
decision and a factually wrong count — all in Claude's own work. Before that it
could not record a verdict at all (D-069, D-070, D-073).

## What the owner still needs to do

**Answered 2026-10-26: six pnpm files get a code owner (D-144, written and in
#105).** The owner answered in four steps, in session: "Ja, begge filene
(Recommended)" for `/pnpm-workspace.yaml` and `/pnpm-lock.yaml`, first planned as
its own pull request after #105; then, after the BLOCK below, "D-144 inn i #105,
+ .npmrc (Recommended)", "Ja, begge (Recommended)" for `/apps/server/package.json`
and `/packages/contracts/package.json`, and "Ja, ta den med (Recommended)" for
`/.pnpmfile.cjs`, which does not exist. **On #105's branch, not on `main`:** `.github/CODEOWNERS` and
`OWNER_APPROVAL_PATHS` have the six lines (`e61b03e`, one line each naming `@bvst @urso-agent`, a comment
citing D-144; `ai-review.yml` unchanged), and `test-author`'s tests (`2a0f6c2`, `dad32ba`) pass with them. `main`
has none of the lines until #105 merges, so **the six files are owner-reviewed only from then on.** **What is left for you:** #105's code-owner approval, as for any pull
request that changes owner paths (D-042, D-071). The BLOCK stands on `ec81f65`; no
later head has been reviewed. The evidence is in the BUG-65 to BUG-69 rows (M3 table)
and in `progress/m3.md`, 2026-10-26.

**BUG-69: one line in `pnpm-workspace.yaml` or `.npmrc`, or a root `.pnpmfile.cjs`,
makes `pnpm run` run nothing, and every CI check goes green** (the BLOCK on #105 at
`ec81f65`, from `privacy-security-reviewer`; reproduced by the coordinating session
with pnpm 10.33.0: exit 0 with the script not run, where the control exits 1). It is
open on `main` already. The checks that BUG-65 to BUG-67 added are run through
`pnpm run`, so they cannot guard against it, and that is why D-144 moved into #105.
The check before pnpm, a Node script, is queued as its own pull request after #105;
until it exists, **your review of those six files is the protection, not a check that
runs.**

**A-31 — turn on Dependabot alerts** (Settings → Code security). Verified off:
`gh api repos/bvst/TryggHverdag/dependabot/alerts` answered 403 "Dependabot alerts
are disabled for this repository." on 2026-10-25 and again on 2026-10-26. Nothing
automated would notice a change to D-143's advisory, such as a patched zod 3.x;
the premise test only fires when `@expo/cli` moves to zod 4. The row is in
[`plan/README.md`](plan/README.md).

**A question for you, not asked yet: should the other files under
`apps/mobile/src/features/grp/` have a code owner?** CI's `privacy-security-reviewer`
raised it on #101. D-139 gave eleven sign-in files an owner; `.github/CODEOWNERS`
(read 2026-10-25) lists two of them under `features/grp/`, `session.tsx` and
`join-key.ts`, so the screens and `first-contact.ts` have none. The reviewer also
noted that no lint rule keeps raw `fetch` inside `shared/api/`. Changing
CODEOWNERS is yours; a lint rule is the alternative. The coordinating session has
queued it for you and has not asked.

**A-36 — the plan and apply are done; the join is yours.** On 2026-10-21
`infra-staging` ran the plan (run 39564821518, job 119104478062: "Plan: 1 to
add, 1 to change, 0 to destroy.") and the apply (run 39564903393, job
119104742624: "Same plan as the one read in run 39564821518: 92bd5a13…", then
"Apply complete! Resources: 1 added, 1 changed, 0 destroyed." at 07:51:29 UTC).
The coordinating session read the job logs: the staging app's `environment` and
the bootstrap code's `base64` and `hex` print as "(sensitive value)", and no code
appears; the only long hex string is the plan's fingerprint, a SHA-256. **What is
left:** read `ADMIN_BOOTSTRAP_CODE` once in Clever Cloud's console, and join in
the app on your phone, with your name. You become the group's admin. That needs a
development build made on the Mac, since there is no EAS build before task 12
(`apps/mobile` has no `eas.json`); tell Claude if you want the steps written. The
full row, with the retry and the leak runbook, is in
[`plan/README.md`](plan/README.md). **Not verified from a session:** that the API
now logs "api: the first admin can join with ADMIN_BOOTSTRAP_CODE while no group
exists." A session cannot read Clever Cloud's log; if it still says "cannot
join", tell Claude.

**BUG-63 — a question for you: should the API log one line per request?** On
2026-10-21 staging's API gave the canary no answer three times in half an hour,
and nobody can say why, because the API logs nothing per request (the row in the
M2 table above). Claude proposes one line with the route, the status and the
duration, and nothing else, so no location, number, identifier or body (PRIV-07).
It changes `apps/server/src/log.ts`, which needs your approval, so Claude has not
started. You may first want to look at Clever Cloud's metrics and events for the
API app between 11:40 and 12:25 UTC that day, which a session cannot reach; if
they show a restart, a memory limit or a platform event, say so. M2 is closed
either way (D-142).

**A-03 — Google Play account for the AS:** waiting on Google's answer. If it
does not give the AS an organisation account, a new one is made with the
AS's Workspace user. Needed by M3's task 12.

**A-11 — Firebase project and APNs key** (push), needed by M3's task 6.
**A-12 — LINK Mobility account** (SMS), needed by M3's task 10. M3's order,
twelve tasks with GRP-01 first, is D-134; the full rows are in
[`plan/README.md`](plan/README.md).

**A-29 — request the location SDK's 30-day trial key shortly before M3's
demo** (transistorsoft.com/shop/trials/new; owner's own phones only; D-086).
Due M3, not now.

**A-30 — send the Critical Alerts entitlement request**
(`docs/plan/critical-alerts-request.md`, Part D); D-087. The Apple Developer
account exists now (A-02 done, 2026-10-20), so nothing blocks it. Due M4 at the
latest; record only the outcome.

**A-27 — raise the daily-status check's grace in Healthchecks.io to 8 hours**
(about a minute; agreed 2026-09-26). GitHub starts the report hours late by
varying amounts, and 3 hours' grace could page for a run that happened (D-080).

**A-22's leftover:** delete the first apply's `trygghverdag-staging` app and
database in the Clever Cloud console. They are outside Terraform, and the app
costs money.

**A-14 — the cloud environment's allowlist is applied** (2026-09-24). A setup
script is still to come.

**A-01 — which phones the group uses** (iPhone or Android; brand and model):
decides which real devices the automated tests cover, and Google's 12-tester
rule. Still open. A-02 (Apple) is done; A-03 (Google Play) is above.

**Dependabot and the reviewer gate.** `CLAUDE_CODE_OAUTH_TOKEN` is in the
Dependabot secret store, which unblocks npm updates. **github-actions updates
still cannot pass**, structurally: `ai-review.yml` pins actions such as
`actions/checkout`, `actions/setup-node` and `pnpm/action-setup`, so bumping any
of them edits that workflow, and `claude-code-action` refuses to run when the
workflow differs from the default branch. Those pull requests need a manual merge
(D-075), batched. #91's four bumps went in with #94 (`60b46ee`, 2026-10-20), and
`claude-code-action`'s 1.0.251 to 1.0.254 (Dependabot's
[#95](https://github.com/bvst/TryggHverdag/pull/95)) with task 2's step 1,
[#100](https://github.com/bvst/TryggHverdag/pull/100) (`50214c0`, 2026-10-22);
#95 was closed without a merge. The workflows name SHA `db77d4d`, the commit
tag `v1.0.254` points to (`git ls-remote`, 2026-10-22). **Two are open again**
(`gh api`, 2026-10-26; opened 2026-10-25, looked at only for their file lists):
[#102](https://github.com/bvst/TryggHverdag/pull/102), `claude-code-action` to
1.0.259, which edits `ai-review.yml` (a manual merge, D-075), and
[#103](https://github.com/bvst/TryggHverdag/pull/103), `actions/download-artifact`
to 8.0.2, which edits `ci.yml`.

**Done, and recorded elsewhere:** A-04 to A-10, A-15 to A-26 (bar A-22's leftover),
A-28 and A-32 to A-35 (A-35 closed M2: D-142). Each row is in [`plan/README.md`](plan/README.md), and the evidence is
in [`progress/m0.md`](progress/m0.md). Still true from them:
`CLAUDE_CODE_OAUTH_TOKEN` is set and `ANTHROPIC_API_KEY` is not; `claude-dev` acts
on GitHub as `urso-agent` only; the owner accepted the INF-08 drill with no
UptimeRobot app ("it is enough for now").

## Live gotchas

The things that still bite, and cost a session hours the first time.

- **Naming a requirement that has no test yet, in a changed spec or source
  file, fails `req:coverage --fail-on-uncovered-changed`** (and with it
  `gate:full` and CI's `traceability`). LOST-01's loop 1 wrote "task 3
  (LOST-02)" in a code comment and in its spec; LOST-02 went to 📝 and the gate
  stopped at that step. Name a later task in words ("task 3, the lost-contact
  watchdog"). Docs under `progress/` are not read for this.
- **Don't run two gates at once in one checkout.** The drill test INF-10-AC11
  compares `git status` before and after, so a background `gate:full`
  rewriting `docs/requirements-status.md` fails a concurrent `gate:quick`;
  and a `gate:quick` (or the stop hook) during a mutation run lints Stryker's
  `.stryker-tmp/sandbox-*` copy, which carries `@ts-nocheck`. Let one finish.
- **In a cloud session CI-01 (`gate:integrity`) needs `NODE_USE_ENV_PROXY=1`,
  and `gate:full` as a whole must not have it.** Without the variable CI-01 gives
  3 of 5; with it, 5 of 5. Set for the whole of `gate:full`, it fails
  `scripts/lib/proc.test.mjs` (3 of 8 tests, measured 2026-10-23): every child
  process then prints Node's `UNDICI-EHPA` warning, and the tests compare the
  output. Run `gate:full` without it, then `NODE_USE_ENV_PROXY=1 pnpm run
  gate:integrity` on its own, and say so when you quote `gate:full`'s count (task
  2's run on `9c7c498` left CI-01 out and ran it apart).
- **A git worktree outside the project gets no post-edit checks.** The
  post-edit hook runs in `$CLAUDE_PROJECT_DIR`, so edits in a scratchpad
  worktree are checked against the main checkout (reporting its errors, or
  "No test files found"). Run the gates in the worktree yourself (BUG-15).

- **On the Mac, hooks run with the PATH Claude Code started with.** A stop
  hook that fails with no output, or with `git init -b` refused, is this
  machine's old `/usr/local/bin` Node 20 or git 2.23, not the change. Restart
  Claude Code after editing `~/.zshrc`; `claude-dev`'s pnpm shim also forces
  Homebrew's Node and git (BUG-4's log).
- **HK-03 matches text, not intent.** A shell command that merely *mentions*
  starting a workflow run from the command line, a Clever Cloud deploy,
  `scripts/staging-deploy.mjs`, or Terraform apply/destroy is blocked — a
  heredoc writing documentation included. Write such text with the Edit or
  Write tools instead.
- **HK-05 counts a `test.each` only up to its first `)`.** A comment with
  parentheses inside a `test.each([...])` array hides that test from the
  counter, which then reports "the number of tests went down". Keep
  parentheses out of those comments.
- **Clever Cloud's CLI is a pinned binary, not an npm package.** The package
  needs Node 24 and the repository is on 22, so the deploy runs the standalone
  clever-tools 5.0.2 binary, checked by hash (`scripts/lib/clever-tools.mjs`).
  The hash is trust-on-first-use: a version bump means downloading the new
  archive and recording its hash by hand (D-077 item 16). It ran on
  `ubuntu-26.04` for the first time on 2026-09-29, and worked.
- **Sessions reach `www.clever.cloud` and `registry.terraform.io`, and never
  `api.clever-cloud.com`** — on purpose (`plan/cloud-environment.md`).
  `pnpm run infra:check` works in a session; `plan` and `apply` do not, and
  must not.

- **Every job failing in ~2 seconds means the Actions budget, not the code.**
  On 2026-09-23 all fifteen checks went red for two and a half hours. The
  signature: `runner_id: 0`, empty `runner_name`, **no `steps` array at all** —
  not even GitHub's own "Set up job" — and a job log returning HTTP 404, because
  nothing ran to write one. The included minutes had run out against a spending
  limit, and the owner raising it fixed it within minutes. **Since 2026-09-28
  the repository is public**, so standard runners are free and unlimited, and
  have 4 CPUs and 16 GB RAM instead of 2 and 8 (GitHub's docs). This cannot
  happen on standard runners any more; if the signature ever returns, check
  Settings → Billing and licensing → Plans and usage first. Re-running is pointless and consumes more
  of what is already gone. Sixteen jobs fire on every push (ten `ci`, six
  `ai-review`), so a day of many small pushes was expensive — which is the
  argument for path filters on the docs-only ones.
- **A green `ai-review` tick is not proof a review happened, and a red one can
  be advisory.** Twice on #15 a reviewer returned a verdict without having
  reviewed: `test-auditor` emitted `{"verdict":"PASS","summary":"Placeholder —
  waiting for test-auditor subagent to finish before posting PR comment and final
  verdict."}`, and the gate, which only grepped for `^(PASS|BLOCK)$`, accepted it.
  Since #16 a verdict must be corroborated by a comment, and that works.
  **The tell is still a reviewer that goes green without commenting**, in well
  under the four to six minutes a real review takes. Read the job log's
  `STRUCTURED:` line before trusting any verdict. The other way round,
  `code-reviewer` can end with no verdict at all (`--json-schema was provided but
  Claude did not return structured_output`, on #43's `f22d5ee`). It is advisory,
  so the three blocking reviewers decide.
- **`ai-review.yml` cannot be reviewed by the reviewers.** Editing it stops the
  action running at all, so every change to that file is merged by hand, on
  purpose (**D-075**). Batch changes to it rather than spending a manual merge
  each time.
- **`.claude/**` and `CLAUDE.md` are reverted in a reviewer's working tree**
  before it reads them, so the `Read` tool shows stale text. Use
  `git show HEAD:<path>` or `git diff origin/main...HEAD -- <path>`. This is
  behaviour of the environment the reviewer runs in, **not** automation in this
  repository — a reviewer grepped the workflows, hooks, settings and `.git/hooks`
  looking for it and correctly reported finding nothing. **It can produce a false
  BLOCK**: on #22, safety-reviewer read the revert as "uncommitted changes strip
  the D-077 guardrails" while the committed head had all of them. Check any
  `.claude/` finding against `git show HEAD:<path>` before acting on it.
- **A superseded run posts five red `ai-review` checks.** The guard fires on
  `needs.changes.result != 'success'`, and a cancelled duplicate run is not
  `success`. They look exactly like real failures. Check whether a newer run for
  the same SHA exists before believing them.
- **A pull request with a merge conflict gets no workflows at all.** GitHub runs
  no `pull_request` workflow while the pull request cannot merge cleanly. Two
  pushes to #43 started nothing, and the pulls API showed `mergeable: false`,
  `mergeable_state: dirty`. If a push starts no checks, look there before
  suspecting CI. Merge `main` in.
- **A green `android-e2e` can hide a refused first install.** On `ubuntu-26.04`
  the install was refused on attempt 1 in 3 of 6 runs. The wait got past
  the ones it knew and the check stayed green, so only the job's log shows which
  attempt succeeded. A session once read a run from its check alone and nearly
  reported one refusal where there were two (`progress/m0.md`).
- **`gate:quick` does not run the coverage ratchet.** For a file the baseline
  tracks, run `test:coverage` then `coverage:ratchet` before pushing, or CI finds
  it for you.
- **Pushing while a reviewer run is in flight** cancels it and manufactures the
  false reds above. Wait for the run, then push.
- **`daily-status.yml` cannot run from a pull request.** GitHub runs scheduled
  and manual workflows only from the default branch, so its first real run is
  after merge. Its tests hold its shape and run its scripts; they cannot run it.
- **Owner questions filed from a session do not notify the owner.** The GitHub
  tools here act as `@bvst`, so the issue is the owner's own, and GitHub does not
  notify anyone of their own actions. The daily report lists open ones (D-076).
- **A test that spawns a script inherits the runner's environment.** On a push
  to `main` that means `GITHUB_EVENT_NAME=push` and a live `GITHUB_OUTPUT`, so a
  test green on its pull request can be red on `main` — one was, from #17 until
  #20 fixed it. Set the environment in the spawn; don't inherit it.
- **Read the job log before theorising** (D-070) and **say what you checked, not
  what you assume** — both are non-negotiables in `CLAUDE.md` because three
  hypotheses about one failing gate were wrong in a single morning.
- **Vitest's coverage cannot see a spawned process.** Logic that runs only in
  an entry script that tests spawn counts as uncovered, and the ratchet drops.
  Keep entry scripts to IO and put decisions in `scripts/lib/`, as INF-10's
  `req-coverage.mjs` shows.
- **A session reaches GitHub release assets but not release pages.** The proxy
  answers 403 for `…/releases/latest` and 200 for `…/releases/download/…`.
  Probe the asset, not the page.
- **The Bash guard reads `rm -f` beside a `git push` as a force push.** Keep a
  push in a command of its own.
- **The bash guard (`guard-bash.mjs --global`) reads the whole command.** A
  `sed` pattern containing `main` in the same command as a `git push` was
  refused as a push to main, and a pattern containing `.env` (as in
  `process.env`) as reading an env file. Split such commands.
- **Writing "close #19" in a pull request's description closes #19 when it
  merges.** GitHub reads close, fix and resolve, in any of their forms, as a
  closing keyword when an issue number follows, even inside advice to the
  owner. #32 said "If you'd like a clean issue, close #19", and merging it
  closed the daily-status issue. Put the number first ("#19 can be closed"),
  or leave the keyword out. The same goes for commit messages, which a squash
  merge copies into its own.
- **`req:coverage` counts the requirement a spec names, not the task ID.**
  INF-08's spec names REL-08, so its tests had to name REL-08 too, or RG-01
  fails on the branch.
- **Two sessions can take the same decision number.** On 2026-09-29, #43 and #44
  both wrote a D-083, each the next number after `main`'s last at the time. #44
  merged first, and #43 renumbered to D-085 and BUG-9. Before taking a number,
  check the open pull requests' `decisions.md` too, and check it again before
  each push.
- **The agent briefs still send the narrative to `m0.md`.** `plan-keeper`,
  `/status` and `/bugfix` name `docs/progress/m0.md` (D-088 lists it among the
  `.claude/` gaps). M3's narrative is [`progress/m3.md`](progress/m3.md), M2's
  is [`progress/m2.md`](progress/m2.md) and M1's is
  [`progress/m1.md`](progress/m1.md), so a bug's next `BUG-<n>` has to be looked
  for in all four files, in this one and in `decisions.md`. The next one is
  **BUG-70** (BUG-13 to BUG-69 are taken). The last paragraph of
  `progress/m1.md` says why.
- **gitleaks scans the pull request's whole history, not only its tree.** A
  credential-shaped literal stays a finding after the commit that removes it
  (GRP-01: `064be6c`). Make synthetic secrets at run time (RG-07). The way out
  used here, while the pull request was open, was one full
  `commit:file:rule:line` fingerprint in `.gitleaksignore`, which needs the owner
  (SEC-06); a squash-merge leaves the commit off `main`, so the line is removed
  afterwards (done for GRP-01 in #97, `f3e682c`).
- **The dependency audit can turn red with no change of ours,** on an advisory
  published, or changed in npm's data, after the last green run (BUG-15, BUG-23,
  BUG-24, BUG-61, BUG-64). Read the job log for the advisory; when a fixed version
  exists, add a `PATCHED` row in `scripts/dependency-audit.test.mjs`. A pnpm
  override did not move an auto-installed peer (vite); a root dev dependency did.
  An ID in `ignoreGhsas` is **global**: it hides the advisory on every path, the
  server's included (D-143), so an ignore needs a test of where the ignored
  package is reached from. **A session cannot open a job's log** (the log host
  answers 403 to its `gh`): reproduce the audit instead, from a `git archive <sha>
  package.json pnpm-lock.yaml pnpm-workspace.yaml apps packages` in a scratch
  folder, with `pnpm audit --audit-level high` there. On 2026-10-25 that printed
  the same summary line and paths as the failed job's.
- **`git log origin/main..HEAD` is not the task's commits.** Every task is
  squash-merged and this session branch is reused, so the range also lists each
  earlier pull request's own commits: 396 on 2026-10-20, for a task of 48. Count
  from the task's first commit (`git rev-list --count <first>^..HEAD`).
- **guard-bash refuses a `git commit` line that has `-n` anywhere after it,**
  `sed -n` and `grep -n` included, and any command that only mentions the rule's
  words (BUG-58). Commit with `git commit -F <file>` in a command of its own,
  and search for the rule with the Grep tool.
- **The post-edit hook checks a file outside the repository,** a scratchpad
  script for instance, and reports Prettier and ESLint failures there ("ESLint
  couldn't find an eslint.config.* file", BUG-59). They are about the location,
  not the code; say so and go on.
- **The write-time sensitive-data hook catches only `+47`/`0047` phone
  numbers, on Write and Edit.** `scan-sensitive.mjs` does not look for 8-digit
  domestic numbers, email addresses, postal addresses, D-U-N-S or
  organisation numbers, or coordinates in prose, and it does not see a file
  written from a shell. Found by `test-author` while checking STORE-01's
  AC11, 2026-10-01. Review carries the rest; a `.claude/` fix needs the
  owner's approval and has no ID yet.
- **`planner`'s and `test-author`'s own `guard-paths` hooks block them from
  writing their own agent memory.** `planner` may only write
  `docs/specs/**`, and `test-author` only test files and `packages/test-kit/**`
  — neither allowlist covers `.claude/agent-memory/<agent>/**`, so a memory
  write from either agent is blocked and the session must stop and report it
  (never work around a guard block). It has fired: `test-author` three times
  in SPIKE-01 and `planner` twice in STORE-01, each stopped and reported. The
  reviewers and `implementer` write their own memory without trouble. A
  configuration gap for the owner, with no ID yet.
- **Red-phase TypeScript tests cannot be committed alone.** The pre-commit
  hook (HK-09) lints staged files with type information, and a test that
  imports modules which do not exist fails `no-unsafe-*`. SM-01's way: write
  the code, then commit the tests first by explicit path, with the code
  present but unstaged, and the code after them. The history keeps the order
  that RG-02 asks for.
- **Background agents hang on git's pager.** Run `git --no-pager …`, or pipe
  to `cat`. One session lost an hour to it.
- **An agent worktree fails the stop gate.** `isolation: worktree` puts a
  checkout in `.claude/worktrees/`, inside the repository: git sees it as
  untracked, and `prettier --check .` reads its generated files, which
  `.prettierignore`'s paths no longer match. The role guards refuse any path
  outside the repository, so a worktree elsewhere doesn't work for
  `test-author` or `implementer` either. Have `planner` write a draft to the
  scratchpad instead (LOST-06).
- **The session's disk allowance runs out.** Reviewers' scratch copies of the
  repository (about 280 MB to 1 GB each) pile up across tasks; one filled the
  allowance during `gate:full`'s mutation step (ENOSPC). Delete finished
  copies between tasks.
- **A container restart stops background agents and loses uncommitted work.**
  One attempt at a records task was cut off before it wrote anything. Commit
  and push in small steps.
- **A Vitest JSON reporter writes `.vitest/json/output.json` into the repo
  root,** and `gate:quick`'s formatting step fails on it. Agents give an
  `--outputFile` in the scratchpad, and point `TMPDIR` there too, so Vite's
  `ssr` folders don't pile up in `/tmp` (LOST-07).
- **Run `gate:full` on a quiet machine.** Its mutation step runs the groups
  one after another inside a 25-minute budget. With reviewers running beside
  it, LOST-07's groups overran it; alone, they passed (LOST-07). It happened
  again on task 2's `d2a55ca`: seven of the nine groups used the 25 minutes, and
  `process` and `api-process`, run alone with `--group` (D-129), passed. Whether
  anything ran beside that `gate:full` was not checked.
- **Agents can sit for hours on an approval prompt.** Edits to `.claude/**`
  and `docs/plan/decisions.md` always ask (`settings.json`), and a background
  agent waiting on one shows no sign of it: no file changes, no processes. On
  2026-10-07/08 `plan-keeper` and `test-author` each waited over four hours.
  When an agent goes quiet, ask the owner about pending prompts first.

## In flight

**BUG-65, BUG-66, BUG-67, BUG-69 and D-144 are in #105** (not merged). BUG-65 to BUG-67
are test-only changes to `scripts/dependency-audit.test.mjs`, with their fixes;
**BUG-69 is `privacy-security-reviewer`'s BLOCK on head `ec81f65`,** mitigated by D-144
and not yet re-reviewed (its paragraph is below). On `ec81f65`, 16 of 18 check runs
succeeded, `mutation-group` was skipped, and `ai-review (privacy-security-reviewer)`
failed (GitHub's REST API, 2026-10-26). The detail is in `progress/m3.md`, 2026-10-26.

**BUG-65** (red `5620397`, green `96c7156`, before the squash). The check that nothing
but the root `package.json` sets pnpm's audit settings read `pnpm-workspace.yaml`,
`.npmrc` and the workflows as raw text, but pnpm decodes them, so escaped or
environment-filled names got past it: with pnpm 10.33.0, `pnpm audit --audit-level
high` exited 0 ("2 high (2 ignored)") where the control exited 1. Found by
`privacy-security-reviewer` on #105. The test now reads each file as pnpm and GitHub
do (YAML scalars decoded at every depth, `ini`'s decoding of `.npmrc` names, a `${`
in a key refused, a file that does not parse refused), and the raw-text checks stay.
Not pinned: a command a workflow builds at run time.

**BUG-66** (red `6e96a4c`, green `c37d0f0`; found and fixed in the same pull request).
A `registry=` line in the root `.npmrc` makes `pnpm audit` ask that server for
advisories: in a scratch copy on 2026-10-26, a local server that reported none made
the audit exit 0 ("No known vulnerabilities found"), and the unchanged `.npmrc` exits
1 ("2 high"). CI's `security` job installs and audits with that file, which has no
code owner yet (D-144 adds one), and no check read the setting. The root `.npmrc` may now hold only the
settings in the test's `RC_SETTINGS`, today `engine-strict`. A plain `registry:` key in
`pnpm-workspace.yaml` did not redirect the audit, but a `registries:` key does (BUG-67).

**BUG-67** (red `dac3614`, green `bc5a6f9`, `code-reviewer`'s tidy-ups `62c2ce2`; found by
`privacy-security-reviewer` and `test-auditor` on #105 at `4577ecf`, fixed in the same
pull request). The workspace file's top-level keys are copied into pnpm's settings
with no check, and the audit asks `registries.default`: with pnpm 10.33.0 in a scratch
copy, a `registries:` key pointing at a server that reported no vulnerabilities made
the audit exit 0 where the control exits 1. A second route, `lockfileDir`, was
reported and not re-run. The test now allows only `packages` and `catalog` as
top-level keys of the file (`WORKSPACE_SETTINGS`, `workspaceUnlisted`), and adding
one is a change to the test, which the owner approves. Not tried as routes:
`httpsProxy`, `strictSsl`, `ca` (the list refuses them either way).
**#105 had a BLOCK at `e57543d`** (`privacy-security-reviewer`): a lone CR hid a
`registries:` key from every check, while pnpm 10.33.0 read it (reproduced by the
coordinating session: the audit exited 0 against a server reporting nothing). It is
fixed in three commits (`2ea9e6c` red, `41d9bfc` green, `1ecf157`) and **was cleared
on `a0c11ed`**, where every check is green and all five reviewers pass (the
coordinating session read the check-runs API): a lone CR is refused, the workspace
file is read against a strict line grammar with no YAML parser, and the root `.npmrc`
is pinned byte for byte (the BUG-67 row has the detail). `test-auditor`'s one
should-fix on `a0c11ed` is fixed in `ad7f27a` (test-only: every grammar claim has its
own fixture, and a 131-mutant sweep left 4 equivalent survivors), which came after
those checks and is in the head `ec81f65`: every check passed there but `ai-review
(privacy-security-reviewer)`, which blocked on BUG-69 (below); the other four
`ai-review` checks succeeded (REST API, 2026-10-26; I read only `code-reviewer`'s and
`test-auditor`'s PASS comments).

**BUG-69** (the BLOCK on #105 at `ec81f65`; red `2a0f6c2`; `cfdf38b`, which corrects the
test file's header; `dad32ba`, the eleventh exception in the safety-filter test; `e61b03e`, which makes the six
lines and turns the red green; `origin` reads `ec81f65` when fetched, so none of the four is pushed). `privacy-security-reviewer`: pnpm 10.33.0 reads `scriptShell` from the workspace file and `script-shell` from
`.npmrc`, and one line in either makes `pnpm run` hand every script to a shell the pull
request chooses, so every CI check goes green having run nothing, the guard test of
BUG-65 to BUG-67 included. The coordinating session reproduced it with pnpm 10.33.0 and
found a third route, a root `.pnpmfile.cjs` with an `updateConfig` hook. It is open on
`main` already. **The owner's answer on 2026-10-26 moved D-144 into #105:** six paths
(the two pnpm files, `.npmrc`, `.pnpmfile.cjs`, and the server's and the contracts'
`package.json`) get the owner as code owner. D-144 is written, and its tests pass with the six lines made (`e61b03e`);
**the lines are on the branch only: `main` has none of them until #105 merges.** The check
before pnpm, a dependency-free Node script, is queued as its own pull request after #105.
The BUG-69 row in the M3 table has the reproduction and what is unverified.

BUG-64 is done ([#104](https://github.com/bvst/TryggHverdag/pull/104), `35a3290`,
2026-10-26; the row is in the M3 table), and task 3 is next in D-134's order.
**Queued, each its own pull request after #105:** BUG-68 (a workspace package's install
script runs in CI's `security` job before the audit) and BUG-69's check before pnpm.
The next free IDs are **BUG-70** and **D-145**.

**Follow-ups, queued and not done.** Task 2
([#101](https://github.com/bvst/TryggHverdag/pull/101), `05bfb73`, 2026-10-25), from
the reviews of `16c46f3` and the loops before it:
1. the `expo/build` / `expo/src` deep-path pattern and its probe (CALL-01 Risks);
2. the start's delete of #1 has no time limit (`safety-reviewer`, loop 2, and again
   on `16c46f3`); a limit in `shared/secure-storage.ts` would be the fix, and
   Expo's Android delete always settles today;
3. `safety-reviewer`, on `16c46f3`, about `e2e:android`: `svc power stayon true` for
   the whole run, the first, unscripted run included (it has no wake check); and
   the window between reading Telecom and pressing end-call;
4. `code-reviewer`, on `16c46f3`: a `label`/`title` default in `LargeButton`;
   `flowTags` (`scripts/lib/e2e-android.mjs`) and `maestroTags`
   (`packages/test-kit/src/maestro-flows.ts`) duplicated; `SEPARATORS` in
   `phone.ts` and `first-contact.ts`, held together by a test; a comment on why
   `features/call` imports the kit directly; `type View` renamed in
   `home-screen.tsx`. From its first review: the app's lint rules out of
   `eslint.config.mjs` and into `packages/config/eslint/`;
5. `a11y-i18n-reviewer`: a live region on `Waiting` (`shared/ui/kit.tsx`; from GRP-01);
6. **the owner's call,** `privacy-security-reviewer`: files under `features/grp/`
   without a code owner, or a lint rule keeping raw `fetch` in `shared/api/` (the
   question is under "What the owner still needs to do");
7. on iOS, Keychain items, the credential included, can outlive an uninstall
   (`privacy-security-reviewer`); it belongs in task 12's spec;
8. the 112 button's name and WCAG 2.5.3: the owner kept it (2026-10-23), a
   trade-off to look at again with real users;
9. the two BUG-17 follow-ups: the stale docblock above `timelinePhase` in
   `scripts/e2e-android.test.mjs` (a `test-author` change), and the "Emulators
   only" comment on `checkDevices` in `scripts/lib/e2e-android.mjs`, which should
   say the run also roots `adbd` (the BUG-17 row has the detail);
10. the mock guard's obscure spellings (`{ ['virtual']: true }`, `jest['mock']`, an
    aliased `jest`): `test-auditor` rated them a note, no action.

From BUG-64 (#104):
11. a code owner for `/pnpm-workspace.yaml` and `/pnpm-lock.yaml`: **done in #105.** The
    owner said yes on 2026-10-26, and D-144 is written there; the CODEOWNERS and
    `OWNER_APPROVAL_PATHS` lines are in, in `e61b03e` (none of the six at `dad32ba`), and count on `main` once #105 merges.
    **Owning `/pnpm-lock.yaml` is what covers a note from `privacy-security-reviewer`
    on #105** (at `a0c11ed`; reported to me, not reproduced): a `resolution.tarball` in
    `pnpm-lock.yaml` with a false version label can change what the audit sees;
12. **D-104's advisory no longer appears.** GHSA-vfj7-8cjw-p6xm (`braces`) is absent
    from npm's audit data (the implementer, 2026-10-25; confirmed 2026-10-26 by an
    audit of `35a3290` with no ignore list: the only highs are `node-forge` and
    `@expo/cli`'s zod). `braces` 3.0.3 is still locked and its ignore stays.
    **Why it disappeared is not checked;**
13. whether a release or export build loads `@expo/cli`'s two zod files is untraced
    (D-143): the owner was told the tool uses zod "when the app is built", and the
    code read is the dev server's.

From BUG-66 (#105):
14. **a code owner for the root `.npmrc`: answered yes on 2026-10-26, in D-144 (#105).**
    After the BLOCK (BUG-69) the owner chose "D-144 inn i #105, + .npmrc (Recommended)".
    `.github/CODEOWNERS` had no line for it and `scripts/lib/merge-rules.mjs` did
    not name it (read at `dad32ba`); both have it in `e61b03e`, on the branch, and `main` has neither until #105 merges. BUG-66's
    allowlist stays as a test, and the owner now also reviews every other change to
    the file.

From #105's second round of reviews (`code-reviewer`'s PASSes on `892d7c9` and
`82c4be0`, and `privacy-security-reviewer`'s on both). The shadowed-name point of
`code-reviewer` is done in `82c4be0` (`fromEnvironment` renamed); no follow-up named
it open:
15. **trim the decoded-key checks in `scripts/dependency-audit.test.mjs`** (queued,
    not agreed). With `RC_SETTINGS` and `WORKSPACE_SETTINGS` in place, much of BUG-65's
    deny-list decoding may be redundant, and `code-reviewer` prefers deleting it and
    code-owning `/pnpm-workspace.yaml` and `/.npmrc` instead. Claude's position (replied
    on #105): the decoded checks still read the values under `packages` and `catalog`,
    and the allowlists themselves depend on decoding keys as pnpm does. Any deletion
    needs `test-author`'s written reason (RG-03). D-144 now code-owns both files and keeps
    the test-side checks as a second line, so the trim is still not agreed;
    `code-reviewer` repeated it, and item 17, as should-fixes on `ec81f65`, not
    blockers. The BLOCK on #105 (a lone CR, which
    pnpm's reader breaks a line at and `yaml` does not) is evidence for `code-reviewer`'s
    point that parser models drift; the line-grammar layer (`workspaceLines`) is the
    parser-free check that a trim would keep;
16. **`yaml` as a direct root devDependency** instead of through vite's peer. Today, if
    the peer goes, the tests fail loudly by name. A direct dependency is a lockfile
    change with its own review;
17. **trim the test file's dated session narrative** to what each check pins and why;
    the history is in `progress/m3.md`;
18. **`/.nvmrc` has no code owner** (`privacy-security-reviewer`, on `892d7c9`; checked
    in `.github/CODEOWNERS` on 2026-10-26). Queued, not asked;
19. **a code owner for `apps/server/package.json` and `packages/contracts/package.json`:
    answered yes on 2026-10-26, in D-144 (#105).** The question was "Skal
    apps/server/package.json og packages/contracts/package.json også få deg som
    kodeeier?", and the owner chose "Ja, begge (Recommended)". They had no CODEOWNERS
    entry (read at `dad32ba`); `/package.json`, `/apps/mobile/package.json`,
    `/packages/config/` and `/packages/test-kit/` do. BUG-68's route runs from a
    workspace package's `package.json`. The lines are in, in `e61b03e`, on the branch; `main` has them once #105 merges.

**Carried into M3, from M2's decisions:**
- Before M3 pushes the "I'm on it" notice on either platform, a real-phone test
  must show it never displaces an undelivered critical alert (D-113's
  amendment): task 6 or 7.
- D-122's condition for the removal route, that a deployed worker must not leave
  the SMS check unseen, is met by GRP-01's AC25, merged in #96 (`bd83b21`): the
  worker withholds its check-in, and `staging-worker` pages. The deployed
  worker's log says its SMS check reports once a minute.
- LOST-01's to LOST-07's reviews leave items for later tasks, listed in
  `progress/m2.md` ("Left for later tasks"); GRP-01's are in its spec and in
  `progress/m3.md`.

**For the owner, from CI's `test-auditor` on #60:** should
`apps/server/src/log.ts` be mutation-tested? It is the one place that keeps
locations and phone numbers out of the server's logs (PRIV-07), and
`SAFETY_PATHS` holds only code where a missed bug is a missed alert (D-036).
Claude recommends a mutation group for it on every pull request, under a new
decision, as its own task after LOST-01. The alternative is to wait for D-036's
nightly run, which does not exist yet.

**For the owner, from `safety-reviewer` on LOST-02:** the same question for
`apps/server/src/adapters/db.ts`. It holds every pool's session limits and
the start-up read-back that says whether they are in force (D-109), and it is
not in `SAFETY_PATHS`, so no mutation run measures its tests. Claude would
answer both questions in one decision.

Still open from BUG-14's reviews, for the owner:
- nothing pins what `package.json`'s `mutation` script runs (`safety-reviewer`
  on BUG-14, for the owner): changed to `echo`, CI's required check would pass
  with only the owner's approval in the way;
- an extra unowned entry in the safety filter is not caught by a test
  (`test-auditor`; the safe direction, and `/.github/` needs the owner anyway).

Still open from D-098's consequences (BUG-12, done):
- imports do not trigger the run (`api.ts`, `http.ts`, the adapters, contracts;
  `api.ts` itself is BUG-57);
- dependency updates do not trigger it either (a cost question);
- the whole-suite run is now unreachable, and removing it needs a decision;
- mobile `.tsx` safety files will need a jest-expo group.

**BUG-13**, **BUG-16**, **BUG-19**, **BUG-20**, **BUG-22**, **BUG-25**, **BUG-27**, **BUG-35**, **BUG-40**, **BUG-53**, **BUG-54**, **BUG-55**, **BUG-56**, **BUG-57**, **BUG-58**, **BUG-59**, **BUG-60** and **BUG-62** are queued for the owner to schedule, and **BUG-49**, **BUG-50** and **BUG-63** for the owner to decide (the rows in the M3 and M2 tables, above; BUG-63's question is under "What the owner still needs to do"). BUG-57 to BUG-60 came from GRP-01; BUG-58 to BUG-60 are in `.claude/` and need the owner's approval, and BUG-57 touches it too.

**D-085's loose ends** (the pull request merged, [#43](https://github.com/bvst/TryggHverdag/pull/43)).
- **Verified:** `deploy-staging` on `ubuntu-26.04`. Run 36621209842, for
  `0637482`, succeeded, and so did its Deploy step and its smoke test.
- **Verified:** `daily-status` on `ubuntu-26.04`, 2026-09-30 06:34 UTC, both
  jobs.
- **Verified:** every workflow names `ubuntu-26.04` since #48 (`05ca463`,
  which moved `ai-review.yml`): `grep` finds `ubuntu-latest` only in a comment
  in `ci.yml`.
- **Verified:** `infra-staging` on `ubuntu-26.04`. A-35's plan (run
  39381315279, 2026-10-20) has the job label `ubuntu-26.04` and concluded
  `success` (`gh api`, 2026-10-20); `infra-staging.yml` names it twice.
- **On 26.04, `android-e2e`'s install was refused on attempt 1 in 3 of 6
  runs:** BUG-9's session error once, run 8's `NullPointerException` twice. The
  wait got past the NPE both times. BUG-9's own signature has not come back.
- **`ci.yml`'s comment on the emulator snapshot** ("a clean snapshot for later
  runs to start from") is not borne out by the logs, and is left for a follow-up
  (D-085).

**Open follow-ups from M0,** recorded in [`progress/m0.md`](progress/m0.md):
- **INF-08's two unverified things.** UptimeRobot's recovery was not captured.
  Its keyword rule was not looked at: the alert gave the root cause "Keyword
  Exists", while A-25 asked for an alert when `"status":"ok"` does *not* exist.
  The alert came during the stop, which is what A-25's rule does, so the setting
  is probably right and the wording is UptimeRobot's. If the monitor ever shows
  Down while staging is healthy, the rule is inverted.
- D-036's nightly full mutation run.
- D-079's hand-offs to M2.
- AR-10's import rule, which nothing enforces. (GRP-01 added one such rule:
  anything in the app outside `features/` reaches a feature through its index
  alone. The others were not re-checked.)
- ESLint reading Stryker's `.stryker-tmp/` during a run.
- **From INF-10:**
  - the live attempt at drills 6 and 8 is an M5 go-live item (D-083). It runs
    once from the Mac as `urso-agent`, with the owner watching;
  - `reviewCodeowners` ignores GitHub's last-match rule for CODEOWNERS, found by
    `test-author`. BUG-8's test covers the six new paths and `packages/config`
    (D-084); everywhere else it is a `/bugfix` candidate;
  - the drills and `gate.test.mjs` each hold copies of the workflow-reading
    helpers. One tested reader should replace them (`code-reviewer`);
  - the drills do not carry a workflow's `env:` into the gates. A gate that
    honoured an env toggle set in the workflow would get past them; none does
    today;
  - when the test kit's phone-number builder lands, the drills' number should
    come from it (`privacy-security-reviewer`).

**An unmerged branch exists: `claude/inf-04-follow-through`.** It closes INF-04's
record and widens `engines.node` so Dependabot can run. It holds **D-063 and
D-064**, which is why INF-05's decisions start at D-065. Deliberately parked, not
forgotten.

**The `ai-review.yml` batch — three items left.** The
verdict corroboration shipped in #16 and works: every reviewer on #18 went green
only with a corroborating comment (read in `test-auditor`'s log; the others by
their green checks). `checks: read` also shipped in #16, and **does not work** —
the first item below. What remains:

- **`checks: read` never reaches the reviewer.** It is on the job's token, and
  the reviewer's `gh` does not use that token. With no `github_token` input the
  action mints the Claude app's token — `contents`, `pull_requests` and `issues`
  only (`src/github/token.ts:69-73` at the pinned commit) — and sets `GH_TOKEN`
  to it (`src/entrypoints/run.ts:189-191`). The action's documented route is
  `additional_permissions: | actions: read`. **Evidence:** that source, read on
  2026-09-24, and `test-auditor` reporting a 403 reading check results on #18.
  **Not in the evidence:** the 403 itself — the action does not print the
  agent's tool calls, so the job log cannot show it. Also unknown: whether the
  Claude app's installation may grant `actions: read` at all.

- **The Dependabot guard message.** It fires when neither
  `CLAUDE_CODE_OAUTH_TOKEN` nor `ANTHROPIC_API_KEY` is visible and then advises
  running `claude setup-token`. A-09 is done and the repository secret is set,
  so the only way it can fire now is a context where repository secrets are not
  passed at all — a Dependabot pull request being the one that happens here.
  The advice is wrong for that case and should name it. **Grounded**, since the
  owner confirmed which secrets exist.
- **The cancelled-versus-failed guard condition.** `needs.changes.result != 'success'`
  treats a cancelled duplicate run as a failure, producing reds that look real.
  **Not re-verified today**, so it waits: changing an unreviewable file on an
  unverified claim is how the placeholder verdict got in.

Three small changes to `ai-review.yml`'s safety filter shipped ahead of the
batch, each merged by hand (D-075): [#21](https://github.com/bvst/TryggHverdag/pull/21)
(the worker files), [#30](https://github.com/bvst/TryggHverdag/pull/30)
(`healthchecks.ts`, D-079) and [#45](https://github.com/bvst/TryggHverdag/pull/45)
(`apps/mobile/app.config.ts`, D-084). The runner label and the three action
bumps went in as [#48](https://github.com/bvst/TryggHverdag/pull/48). BUG-10's
filter (D-092) went in as [#56](https://github.com/bvst/TryggHverdag/pull/56),
and BUG-14's (D-100: the mutation check's own files, the test kit and the three
Vitest configs) as [#58](https://github.com/bvst/TryggHverdag/pull/58), both
merged by hand.

## History

[`progress/m0.md`](progress/m0.md) — the full narrative of M0, including the wrong
turns. Several entries exist only so the next session does not repeat them.
[`progress/m1.md`](progress/m1.md) — M1, from 2026-09-29.
[`progress/m2.md`](progress/m2.md) — M2, from 2026-10-01.
[`progress/m3.md`](progress/m3.md) — M3, from 2026-10-20.
