# Merge rules — what the owner switches on

**Status:** ⬜ Waiting for the owner · **Added by:** INF-04 · **Last updated:** 2026-09-20

Everything else in this repository — the hooks, the gates, the reviewers —
assumes it is allowed to stop a merge. Nothing here can switch that on: it needs
repository-admin rights, which Claude's account deliberately does not have
(A-06, D-042).

Until it is switched on, `pnpm run gate:integrity` fails and the `gate-integrity`
check is red. That is the intended behaviour, not a bug to work around: a gate
that cannot tell whether it is enforced must not report that it is (D-029).

At the time of writing, `main` has **no protection at all** — anyone with write
access can push to it directly, force-push it, or delete it.

## Part 1 — the two secrets (5 minutes)

**Settings → Secrets and variables → Actions → New repository secret.**

| Secret | What it is | What breaks without it |
|--------|------------|------------------------|
| `RULES_READ_TOKEN` | A **fine-grained personal access token** on the owner's account, scoped to this repository only, with one permission: **Administration → Read-only**. No expiry longer than a year. | `gate-integrity` fails: it can read the rules on `main`, but not who is allowed to bypass them — which is the one thing D-029 is about |
| `CLAUDE_CODE_OAUTH_TOKEN` | Owner to-do **A-09**: run `claude setup-token` and paste the result | The three blocking AI reviews fail (D-045). `ANTHROPIC_API_KEY` is the documented fallback |

**Why a separate read-only token rather than Claude's account token.** Claude's
GitHub account has write access but not admin, on purpose (A-06) — so it cannot
read who may bypass the rules. Giving it admin to fix that would hand the gates'
own enforcement to the account being gated. A token that can read one
repository's settings and do nothing else is the smaller thing to trust. This
corrects the note in `08b-ci-files/README.md`, which assumed `CLAUDE_BOT_TOKEN`
would do (D-060).

`CLAUDE_BOT_TOKEN` is still wanted, for a different job: so that pull requests
are opened by Claude's account and the owner's approvals count as real
approvals (D-042). Nothing in CI reads it yet.

## Part 2 — the ruleset (2 minutes)

Part 1 first, and not only for tidiness: importing this while the two secrets
are missing leaves `gate-integrity` and the three `ai-review` checks red *and*
required, so nothing can merge at all — including the pull request that added
them.

**Settings → Rules → Rulesets → New ruleset → Import a ruleset**, and upload
[`main-ruleset.json`](main-ruleset.json). That is everything below in one file;
the tables are there so you can see what you are switching on, and so the next
person can tell why.

A test puts that file through the same functions `gate:integrity` runs against
the live repository, so it cannot drift from the list of checks that actually
exist. If you would rather click through it by hand:

**Settings → Rules → Rulesets → New ruleset → New branch ruleset.**

| Field | Value | Why |
|-------|-------|-----|
| Name | `main` | — |
| Enforcement status | **Active** | "Evaluate" reports without blocking, which is not a gate |
| Bypass list | **empty — add nobody** | D-029: Claude Code works with the owner's credentials, so an admin bypass is a bypass for Claude too |
| Target branches | Include default branch | — |

Then tick these rules:

| Rule | Setting | Why |
|------|---------|-----|
| Restrict deletions | on | `main` cannot be deleted |
| Block force pushes | on | history, and the evidence in it, cannot be rewritten |
| Require a pull request before merging | on | nothing reaches `main` unreviewed (D-029) |
| → Required approvals | **0** | pull requests merge on green checks alone (D-042) |
| → Require review from Code Owners | **on** | the paths in `.github/CODEOWNERS` still need the owner (D-042) |
| → Dismiss stale approvals on push | **on** | an approval must not outlive the code it approved |
| Require status checks to pass | on | see the list below |
| → Require branches to be up to date | **on** | a green check must describe the code that will actually be merged |

**Required approvals is 0 on purpose.** It is what makes D-042 work: ordinary
changes merge by themselves when every check is green, and only the safety
paths, the gates and the decision log wait for the owner — because CODEOWNERS
says so, not because every pull request does.

### The checks to require

The ten in `main-ruleset.json`. Adding them by hand instead, run
`pnpm run gate:integrity` and copy the names it prints under "required today" —
never from prose, which is a list nothing verifies.

Three checks are missing on purpose, because the scripts they would run do not
exist yet: `integration` and `system` (INF-05) and `android-e2e` (INF-06).
`ai-review (code-reviewer)` and `ai-review (a11y-i18n-reviewer)` are advisory
and must never be required (D-043).

Nobody has to remember to add the missing ones later: `gate:integrity` starts
failing the day one of those checks becomes possible but is still not required.

## Part 3 — the repository settings (1 minute)

**Settings → General → Pull Requests:**

- **Allow auto-merge** — on. D-042's "merges when the checks pass" is this
  setting plus the ruleset above.
- **Allow squash merging** — on; the other two off, so `main` stays one commit
  per task (D-052). The ruleset also allows only squash, so this is belt and
  braces.
- **Automatically delete head branches** — on.

**Settings → Code security:**

- **Dependency graph** — on, and **Dependabot alerts** and **Dependabot
  security updates** with it. `.github/dependabot.yml` only schedules *version*
  updates; these are what react when an advisory lands against a dependency
  nobody is touching. Between pull requests, nothing else is watching.
- **Secret scanning** and **push protection** — on. The gitleaks step in CI
  catches a secret that has already been committed; push protection is what
  stops it being committed.

## Part 4 — check it worked

Push any branch and open a pull request. The `gate-integrity` check prints what
it found:

```
gate:integrity — CI-01: are the gates real?

✓ the checks that must be required today (10)
✓ the workflow files produce them, with pinned actions
✓ CODEOWNERS covers every path that needs the owner (D-042)
✓ main requires review, the checks, and no rewriting of history
✓ nobody can bypass those rules (D-029)
```

Anything less than five ticks names what is wrong and what to do about it.
(Run from a clone whose origin is not this repository, there are four sections
rather than five, and it says so.)

**One thing to watch on the first pull request after this.** The ruleset asks
for 0 approvals plus "require review from Code Owners", which is what lets
ordinary changes merge on green checks while safety paths still wait for you
(D-042). If a change under a CODEOWNERS path turns out to merge without your
approval, raise `required_approving_review_count` to 1 — at the cost of every
pull request then waiting for you. INF-10's drills settle this properly.

**Part 3 is not checked by anything.** The gate reads the ruleset and
CODEOWNERS; whether auto-merge is on, and whether the code-security settings
are, it cannot see. Those are on you until a later task adds them.

To see it before pushing anything, run it locally against the live repository.
Read the tokens from files rather than typing them on the command line, where
they would land in shell history and be visible to anyone else on the machine
(the Mac is shared with a separate `claude-dev` user, A-10):

```
chmod 600 ~/.config/trygghverdag/rules-read-token
GITHUB_TOKEN="$(cat ~/.config/trygghverdag/github-token)" \
RULES_READ_TOKEN="$(cat ~/.config/trygghverdag/rules-read-token)" \
pnpm run gate:integrity
```

## What is still not proven

`gate:integrity` reads the settings. It does not try to break them. Proving that
a push to `main` is actually refused, that a pull request with a weakened test is
actually blocked, and that a safety-path change actually waits for the owner is
**INF-10**, the gate drills — the last task of M0, and the one that decides
whether M0 is done.
