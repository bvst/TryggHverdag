---
name: action-pin-bump-review
description: Reviewing a claude-code-action (or any third-party action) SHA bump when gh api is refused for the upstream repo — git ls-remote and a scratch bare fetch do the whole job
metadata:
  type: reference
---

First seen on the D-075 batch branch claude/busy-faraday-40n2zl-ai-review (2026-10-10, head 934b475): claude-code-action 1.0.235 to 1.0.242 plus the REL-10 canary owner paths. PASS.

**Why:** `gh api repos/anthropics/...` answered 403 "GitHub access to this repository is not enabled for this session", and unauthenticated curl to api.github.com hit the same proxy message. Do not stop there.

**How to apply (worked from the Linux cloud session):**
- `git ls-remote https://github.com/<o>/<r>.git 'refs/tags/vX*'` lists each tag and its `^{}` peeled commit: annotated tag object and the commit it points to, in one call. Pin must equal the `^{}` line.
- `git init --bare <scratch>/repo.git` then `git -C ... fetch <url> 'refs/tags/vA:refs/tags/vA' 'refs/tags/vB:refs/tags/vB'`, then `git cat-file -p vB` (tagger, message), `merge-base --is-ancestor vA vB`, `log --format='%h %an %ad %G? %s' vA..vB`, `diff --stat vA vB`, and diff only the shipped files. Never run anything from the fetched tree.
- claude-code-action's runtime surface: root `action.yml`, `src/`, `base-action/action.yml`, `base-action/src/`, `package.json`/`bun.lock` (both dirs). Everything under its `.github/` is the upstream repo's own CI and does not ship to callers. The CLI comes from `curl -fsSL https://claude.ai/install.sh | bash -s -- <version>` (`buildInstallCommand` in src/entrypoints/run.ts): not hash-pinned, so the CLI version bump itself is unreadable from the diff. Say so.
- 1.0.235..1.0.242: 7 daily "bump Claude Code to 2.1.28x/2.1.290 and Agent SDK" commits plus #1867 "security hardening" (a8cb0db) which touched ONLY the upstream repo's own workflows, an egress-firewall yaml, a hardening checker script and CLAUDE.md (runner `ubuntu-24.04-firewall`, `--permission-mode auto` advice). action.yml unchanged; no input, permission or secret-handling change. Licence MIT.
- `%G?` = E means signed but no key here to check; GitHub's "verified" needs the API, so it stays unverified. Say so.
- Repo-side: this repository's comments and D-118 cite the CLI version the action installs (2.1.283 at ai-review.yml:197, scripts/ci-models.test.mjs:4,11, scripts/ai-review.test.mjs:312, docs). A bump leaves them stale; since ai-review.yml edits are D-075 manual merges, ask for the comment fix in the same batch.
- Probes reused: last-match script (anchored-only, throws on globs) over both trees plus canary probes, and js-yaml 4.3.2 parse with `filters` blanked AND the two SHAs normalised, so "rest identical" covers a pin bump too.

Related: [[merge-rules-codeowners-review]], [[reviewer-sandbox-quirks]]

**Second D-075 batch on the same branch name (PR #94, 2026-10-20, head 700cc56, GRP-01 step 1 / D-137) — PASS.** Bumps: setup-node 7.0.0 to 7.1.0, claude-code-action 1.0.242 to 1.0.251, upload-artifact 7.0.1 to 7.0.2, setup-java 6.0.1 to 6.1.0; plus `modules/groups/` and `adapters/groups.ts` in all three owner lists.
- The brief said "do not read the working tree": export both versions with `git show <ref>:<path>` into the scratchpad and run every probe on those copies. Worked without touching the checkout.
- actions/* tags are lightweight (ls-remote shows no `^{}` line): the ref IS the commit. claude-code-action tags are annotated, by github-actions[bot]: pin must equal the `^{}` line.
- One js-yaml script did all five workflows at once: a SHA map new to old applied to every string, `filters` blanked and parsed apart, then whole-document JSON compare plus `on` and `permissions` compares. Result: identical, safety 31 to 33, ui unchanged. Comments are invisible to the parse, so read the diff for the one comment hunk.
- 1.0.242..1.0.251 = 9 bot commits "bump Claude Code to 2.1.29x/2.1.30x and Agent SDK", touching only `base-action/action.yml` (CLAUDE_CODE_VERSION), `src/entrypoints/run.ts` (claudeCodeVersion), both package.json and bun.lock (agent-sdk ^0.3.301, sha512 integrity). Root action.yml unchanged. The CLI download stays unhashed (same as before).
- actions/* bumps: read `action.yml` diff and `runs:` (all node24, unchanged), package.json diff for new runtime deps. setup-node 7.1.0 bundles smol-toml (BSD-3-Clause, per its .licenses/ entry) for `mise.toml` as node-version-file; inert with `.nvmrc`. setup-java 6.1.0 adds Maven-only inputs. upload-artifact 7.0.2 is @actions/artifact 6.3.1 only.
- `git diff` pathspec `':!__tests__'` fails ("Unimplemented pathspec magic '_'"); use `':(exclude)__tests__'`.
- **Recurring (2nd time): a claude-code-action bump updates the ai-review.yml comment but not the same CLI version cited in `scripts/ci-models.test.mjs` (lines 4, 11) and `scripts/ai-review.test.mjs` (~313).** Those are test-author's files, so it is a Should fix for a follow-up, not something the D-075 PR can fix in its own commit. `git grep -nE '<old cli>|<old tag>' <ref>` finds them in one line.

**Third D-075 batch on the same branch name (CALL-01-AC9 step 1 + Dependabot #95, 2026-10-22, head cb9fbd3, D-141 items 7 and 9) — PASS, two should-fixes.**
- gh api compare on anthropics/claude-code-action refused again (403 "not enabled for this session"); scratch bare fetch did the job. 1.0.251..1.0.254 = 3 bot commits "bump Claude Code to 2.1.302/303/304 and Agent SDK to 0.3.30x" (unsigned, %G? = N), touching only base-action/action.yml (CLAUDE_CODE_VERSION), src/entrypoints/run.ts, both package.json and bun.lock. Root action.yml unchanged.
- Pin db77d4d3 == `refs/tags/v1.0.254^{}`; tag object c335fd6 by github-actions[bot]. Dependabot PR #95's own patch (gh api pulls/95/files) is byte-identical to the branch's two `uses:` lines.
- 5-workflow js-yaml compare (SHA map new->old, filters blanked): all identical; safety 33 -> 34 (+ features/call/**), ui 5 -> 5.
- Last-match over both trees + probes: 744 files, only the call/ probes changed owner, 0 lost; `features/callx/`, `features/call.ts`, `features/CALL/` stay unowned (prefix on slash, case-sensitive). All 60 OWNER_APPROVAL_PATHS owned (import the module; a regex over its quoted strings breaks on apostrophes in comments).
- codeowners/errors [] (branch sha == cb9fbd3); ruleset 23864486 active, bypass [], code owner on, count 1, dismiss stale on, 13 checks; gate:integrity 5 of 5 with NODE_USE_ENV_PROXY=1; vitest on merge-rules/gate/ai-review/ci-models tests 337 passed.
- **Recurring, now 3rd time and worse: this bump left the ai-review.yml comment itself stale** (line 208 "2.1.301 at v1.0.251"), plus ci-models.test.mjs:4,12 and ai-review.test.mjs:313. Model ID is pinned in full, so no behaviour change: Should fix. Also docs/progress.md:256-258 still lists #95 as "open now" and "1.0.251 to 1.0.252".
- Caller said "don't change the tree": memory written to scratchpad and handed back instead of edited in place.
