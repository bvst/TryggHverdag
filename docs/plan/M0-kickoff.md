# M0 kickoff — from plan to first code

**Status:** Ready · **Last updated:** 2026-09-20

Planning is complete (Sections 0–10). This page is the owner's checklist to
start milestone M0. Part 1 can be done from a phone.

## Part 1 — from your phone, anytime

**Account rules for every new account:**
- Don't use "Sign in with GitHub". These accounts belong to the AS, and one
  personal login shouldn't unlock the code, hosting, builds and monitoring all
  at once.
- Sign up with an email address on the AS's domain, for example `dev@…`. Apple
  needs a work email on the company domain anyway.
- Use a unique password stored in a password manager, turn on two-factor
  authentication, and save the recovery codes in the password manager.
- Claude's GitHub account (A-06) gets its own email address, for example
  `claude@…`, and its own two-factor authentication. It is never linked to your
  personal account.
- Services connect to GitHub only through tokens that Claude sets up as
  repository secrets, never through your login.

| ✓ | To-do | What to do |
|---|-------|-----------|
| ☐ | A-06 | Create a separate GitHub account for Claude. It needs its own email address; `owner+claude@…` style aliases work with most providers. |
| ☐ | A-05 | On your paid GitHub account, create a **private** repository (for example `walk-home`), with a README so it isn't empty. Invite Claude's account with **Write** access (not Admin), then accept the invite from Claude's account. |
| ☐ | A-02 | Look up the AS's D-U-N-S number with Apple's lookup tool, and check that the AS has a public website and an email address on its own domain. |
| ☐ | A-07 | Create an Expo account for the AS. |
| ☐ | A-08 | Create Healthchecks.io and UptimeRobot accounts, and connect alerts to your phone (app push, SMS or Signal). |
| ☐ | A-04 | Create a Clever Cloud account for the AS. |
| ☐ | A-01 | Send the phone survey to the group (drafted in Section 4). |

## Part 2 — at the Mac (tonight or tomorrow)

**From your normal (admin) account** — these tools are shared by all users:
1. Turn on FileVault (System Settings → Privacy & Security).
2. Create a new **Standard** user (not Admin) for Claude, for example `claude-dev`
   (D-056).
3. Install Xcode from the App Store (it includes the iOS simulator), Android
   Studio (for the Android emulator), Homebrew, and a Docker runtime. For
   Docker, either Docker Desktop (check its licence terms for the AS) or Colima
   (free, open source).
4. Stop the Mac from sleeping while it's on power (System Settings → Energy /
   Battery). Set macOS updates to notify you rather than restart at night.

**Logged in as `claude-dev`:**
1. Install Claude Code (see the current installer at code.claude.com/docs),
   and log in with your Max account.
2. Install the GitHub CLI, log in as **Claude's** GitHub account (A-06), and
   clone the repository into `~/code/walk-home`.
3. Unzip this plan package into the repository root: `CLAUDE.md` plus
   `docs/plan/`.
4. Run `claude setup-token` and save the token as the repository secret
   `CLAUDE_CODE_OAUTH_TOKEN` (A-09).
5. Start Claude Code in `~/code/walk-home`, accept the workspace trust prompt,
   and turn on Remote Control, so the Mac appears in the Code tab of the Claude
   app on your phone.

Node, pnpm, Maestro and everything else are installed by Claude in task
INF-00 (below), without admin rights. Claude checks each tool and tells you
exactly what's missing.

## Part 3 — the first prompt

Paste this into Claude Code on the Mac (or from your phone via Remote
Control):

> Read `docs/plan/README.md`, `docs/plan/decisions.md` and
> `docs/plan/10-roadmap.md`. Planning is complete; start milestone M0.
> First do INF-00: check this Mac's toolchain against
> `docs/plan/M0-kickoff.md` and install what's missing that doesn't need admin
> rights. Then continue with INF-01, and install the Claude Code configuration
> from `docs/plan/07b-claude-code-files/` as early as possible (INF-02), so the
> gates protect everything after it. One task at a time (D-052). Ask me one
> question at a time, with a recommendation. Record progress in
> `docs/progress.md`.

## Part 3b — starting in the cloud (owner's choice, 2026-09-20)
M0 starts in Claude Code on the web while the Mac is being set up (allowed by
D-055). The Mac takes over INF-00 and INF-06 later.

**Tasks that need something else first:**
- **Need the Mac:** INF-00 and INF-06 (emulator and simulator), and A-09
  (`claude setup-token`).
- **Need accounts, tokens or network access:** INF-07 to INF-09. Claude lists
  what it needs when it gets there.

**One cloud session per task:** each session works on its own branch and opens
one pull request (D-052). Merge it, then start the next session.

**Session 1 — import the plan:**
> Unzip `walk-home-plan.zip` into the repository root: move everything inside
> `walk-home-plan/` (including `CLAUDE.md`, `docs/` and hidden folders) to the
> root, then delete the zip and the empty folder. Open a pull request titled
> "Import planning docs". Nothing else.

**Every following session — the same prompt each time:**
> Read `CLAUDE.md`, `docs/plan/README.md` and `docs/progress.md` (create it if
> missing). Do the next M0 task from `docs/plan/10-roadmap.md` that can run in
> a cloud session. Skip INF-00 and INF-06 (they need the Mac) and anything that
> needs accounts or tokens that aren't set up yet — tell me what you need.
> One task, one pull request. Install the gates (INF-02) as early as possible;
> if a hook needs a script that doesn't exist yet, add a minimal version first.
> Ask me one question at a time, with a recommendation. Update
> `docs/progress.md` before you finish.

**Before INF-04 (merge rules):** pull requests must be opened by Claude's own
GitHub account, so your approvals count (D-042). Claude will ask you to create
a token for that account and add it to the cloud environment. Until INF-04,
you merge the pull requests yourself.

## Later (not needed for M0 start)
- **A-14:** a cloud environment at claude.ai/code for everyday sessions (from
  M2, D-055). Claude prepares the setup script and network allowlist when it's
  needed.
- **A-03:** Google Play account, needed in M1.
- **A-11 to A-13:** push credentials, the SMS provider and the location SDK
  licence, needed in M3 to M5 (Section 10).

## INF-00 — Mac environment check (added to M0)
Done when `pnpm doctor` (written in INF-01) confirms all of these on the
`claude-dev` user:
- Claude Code, git, gh (logged in as Claude's account), Node 22, pnpm;
- Docker running;
- Xcode with an iOS simulator, and Android Studio with an emulator image;
- Maestro;
- Remote Control enabled.

`claude-dev` has **no** admin rights (D-056).
