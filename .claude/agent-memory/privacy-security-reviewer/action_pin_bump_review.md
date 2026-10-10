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
