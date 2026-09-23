# Merge rules — what the owner switches on

**Status:** 🟢 Imported and live · **Added by:** INF-04 · **Last updated:** 2026-09-23

The owner imported the ruleset; `gate:integrity` reports **5 of 5** against the
live repository, so parts 1 and 2 are on. **Part 3 below is still open**, and a
reviewer has now produced evidence for it rather than leaving it hypothetical —
see the note there.

Everything else in this repository — the hooks, the gates, the reviewers —
assumes it is allowed to stop a merge. Nothing here can switch that on: it needs
repository-admin rights, which Claude's account deliberately does not have
(A-06, D-042).

Until it is switched on, `pnpm run gate:integrity` fails and the `gate-integrity`
check is red. That is the intended behaviour, not a bug to work around: a gate
that cannot tell whether it is enforced must not report that it is (D-029).

At the time of writing, `main` has **no protection at all** — anyone with write
access can push to it directly, force-push it, or delete it.

## Part 1 — the Claude app and its token (5 minutes)

### 1. Install the Claude GitHub App

[github.com/apps/claude](https://github.com/apps/claude) → install it on
`bvst/TryggHverdag` only, not on every repository.

The AI reviews need this. `ai-review.yml` passes no `github_token`, so the
action signs in as the Claude GitHub App — without the app installed it cannot
post its findings. Installing it grants the app's whole permission set (contents,
issues, pull requests, checks, workflows and more, read and write); GitHub does
not let you accept a subset.

### 2. `CLAUDE_CODE_OAUTH_TOKEN`

On a machine with Claude Code signed in to your Max subscription:

```
claude setup-token
```

It prints a long-lived token. **Settings → Secrets and variables → Actions →
New repository secret**, name `CLAUDE_CODE_OAUTH_TOKEN`, paste, save.

Without it the three blocking AI reviews fail rather than pass (D-045). The
token is tied to whoever ran the command, and CI reviews draw on that person's
Max allowance.

There is a `/install-github-app` command inside Claude Code that does both steps
and more — but it also pushes its own workflow files, which would sit beside the
ones this repository already has. Do the two steps above instead.

**If you would rather not tie CI to your subscription:** an API key from
[platform.claude.com](https://platform.claude.com), saved as `ANTHROPIC_API_KEY`,
works instead and is billed per use. The workflow accepts either.

### No second token — probably

An earlier version of this document asked for a `RULES_READ_TOKEN` with
*Administration: Read-only*, so CI could read who may bypass the merge rules.
That was wrong twice over. GitHub itself answers
`X-Accepted-Github-Permissions: metadata=read` for both ruleset endpoints, so
the permission needed is **Metadata**, not Administration — and the ordinary
Actions token already has it. `gate:integrity` now uses that, and asks for
nothing extra.

If it turns out not to work, the gate says so rather than passing, and the way
out is a fine-grained token on your account, **this repository only, Metadata:
Read-only, nothing else**, saved as `RULES_READ_TOKEN`. The gate prefers it when
it is there. Do not create it up front.

### `CLAUDE_BOT_TOKEN` — later, and not a repository secret

A-06's machine account needs a token so that pull requests come from Claude's
account rather than yours, which is what makes your approvals count as real
approvals (D-042). That token goes in the **cloud environment** at
claude.ai/code, not in repository secrets, and nothing in CI reads it. Until it
exists, you merge the pull requests by hand.

## Part 2 — the ruleset (2 minutes)

Part 1 first, and not only for tidiness: importing this while the Claude token
is missing leaves the three `ai-review` checks red *and* required, so nothing
can merge at all — including the pull request that added them.

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

**Superseded by D-072 below — left standing so the correction has something to
correct.** What this paragraph proposed watching for is exactly what happened:
#6 merged on owner-gated paths with no approval standing at all. The count is
now 1, and `gate:integrity` fails if the live ruleset drops below it. The
paragraph as written:

**One thing to watch on the first pull request after this.** The ruleset asks
for 0 approvals plus "require review from Code Owners", which is what lets
ordinary changes merge on green checks while safety paths still wait for you
(D-042). If a change under a CODEOWNERS path turns out to merge without your
approval, raise `required_approving_review_count` to 1 — at the cost of every
pull request then waiting for you. INF-10's drills settle this properly.

**This stopped being hypothetical on 2026-09-23.** Auditing #7, `test-auditor`
went to the API rather than the prose and found the only `APPROVED` review on a
change touching `/scripts/` and `/docs/plan/decisions.md` — both assigned to
`@bvst` alone — came from `urso-agent`, a second collaborator with write access
that appears nowhere in CODEOWNERS or in `docs/plan/`. With
`required_approving_review_count: 0`, and `gh pr view --json reviewDecision`
returning an empty string rather than a definite answer, it could not establish
whether GitHub will actually withhold the merge pending the owner's own
approval. Its conclusion, and it is the right one: *"this PR may become
mergeable on `urso-agent`'s approval alone, on paths CODEOWNERS assigns solely
to `@bvst`."*

**Half of that is now answered, and the reviewers had the wrong end of it.**
GitHub does not let anyone approve their own pull request, and the pull
requests here are opened by `@bvst`. With `@bvst` as the sole code owner the
rule could never be satisfied on this repository's actual work — it would block
everything and check nothing. `urso-agent` is the owner's second account and
exists for exactly that. CODEOWNERS now lists both, and says so in a comment,
so the next reviewer finds an explanation instead of an anomaly (D-071).

**And the other half is now answered, badly.** It was never enforced. #6 merged
on owner-gated paths with **no standing approval at all** — its newest review is
`DISMISSED`, on an earlier commit — because `dismiss_stale_reviews_on_push`
erases approvals on every push and `required_approving_review_count: 0` never
asks for them back. `require_code_owner_review` has nothing to attach to at
zero: GitHub asks for a code owner among the approvals it requires, and zero of
them is none.

**So: set "Required approvals" to 1** when you next import this ruleset.
`docs/plan/main-ruleset.json` already says 1, and `gate:integrity` now fails
while the live rules say otherwise, so the two cannot drift apart again (D-072).
This does not mean every pull request waits for you — `@urso-agent` is a code
owner (D-071) and its approval satisfies both the count and the code-owner rule.

Be clear what it buys: `@urso-agent` approves automatically, so this closes the
"merged with zero approvals" hole and makes CODEOWNERS mean something. It does
not add human judgement. The required status checks remain the real protection.

**Still open:** `require_last_push_approval` is `false`, so an approval can
predate the final commit. Turning it on is the stronger setting. Claude has not
touched it — that is a merge rule and the owner did not ask for it (D-029).

**Part 3 is not checked by anything.** The gate reads the ruleset and
CODEOWNERS; whether auto-merge is on, and whether the code-security settings
are, it cannot see. Those are on you until a later task adds them.

To see it before pushing anything, run it locally against the live repository.
One token that can read the repository is enough. Read it from a file rather
than typing it on the command line, where it would land in shell history and be
visible to anyone else on the machine (the Mac is shared with a separate
`claude-dev` user, A-10):

```
gh auth token > ~/.config/trygghverdag/github-token
chmod 600 ~/.config/trygghverdag/github-token
GITHUB_TOKEN="$(cat ~/.config/trygghverdag/github-token)" pnpm run gate:integrity
```

Without a token it prints what it could check and says plainly that it could not
check the rest, and fails. That is the same thing it does in CI when something is
missing.

## What is still not proven

`gate:integrity` reads the settings. It does not try to break them. Proving that
a push to `main` is actually refused, that a pull request with a weakened test is
actually blocked, and that a safety-path change actually waits for the owner is
**INF-10**, the gate drills — the last task of M0, and the one that decides
whether M0 is done.
