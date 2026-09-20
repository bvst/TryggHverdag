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

## Part 1 — the ruleset (5 minutes)

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

Add exactly these ten, spelled this way:

```
gate-integrity
static
unit
contract
traceability
mutation
security
ai-review (safety-reviewer)
ai-review (privacy-security-reviewer)
ai-review (test-auditor)
```

Three more are missing on purpose, because the scripts they would run do not
exist yet: `integration` and `system` (INF-05) and `android-e2e` (INF-06).
`ai-review (code-reviewer)` and `ai-review (a11y-i18n-reviewer)` are advisory
and must never be required (D-043).

Nobody has to remember to add the missing ones later. `gate:integrity` works out
the list from the scripts the repository actually has, and starts failing the day
one of those checks becomes possible but is still not required. It prints the
full list on every run.

## Part 2 — the repository settings (1 minute)

**Settings → General → Pull Requests:**

- **Allow auto-merge** — on. D-042's "merges when the checks pass" is this
  setting plus the ruleset above.
- **Allow squash merging** — on; the other two off, so `main` stays one commit
  per task (D-052).
- **Automatically delete head branches** — on.

## Part 3 — the two secrets

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

To see it before pushing anything, run it locally against the live repository:

```
GITHUB_TOKEN=<any token that can read this repo> \
RULES_READ_TOKEN=<the fine-grained token> \
pnpm run gate:integrity
```

## What is still not proven

`gate:integrity` reads the settings. It does not try to break them. Proving that
a push to `main` is actually refused, that a pull request with a weakened test is
actually blocked, and that a safety-path change actually waits for the owner is
**INF-10**, the gate drills — the last task of M0, and the one that decides
whether M0 is done.
