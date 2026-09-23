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

## Part 2 — at the Mac

**The Mac (confirmed 2026-09-22):** MacBook Pro 16-inch, 2019 — 8-core Intel
Core i9, 16 GB, macOS Tahoe 26.6.2. Intel, not Apple silicon, which changes
several steps below; they are marked **(Intel)**.

**(Intel) What this means for the plan.** macOS Tahoe 26 is the last macOS
release for Intel Macs, so this machine's Xcode runway is finite. It does not
put the project at risk: iOS builds happen on Expo's machines (EAS, Section 8),
and the weekly iOS simulator run in `nightly.yml` is an EAS workflow, not a
local one. The Mac is a convenience for the M1 spike and M3 UI work (D-055),
not a dependency. Revisit before M5.

### From your normal (admin) account

1. **FileVault** on — System Settings → Privacy & Security.
2. **Create the `claude-dev` Standard user** — System Settings → Users & Groups
   → Add User → **Standard** (not Administrator). D-056.
3. **`claude-dev`'s password.** A long unique one from the password manager;
   you will rarely type it. Three things about it are easy to get wrong:

   - **Let it unlock the disk at startup.** FileVault turns automatic login
     off, so after any reboot — a macOS update, a power cut — somebody has to
     type a password before any session exists. If `claude-dev` cannot unlock
     the disk, that somebody has to be you, at the machine. Check by rebooting:
     `claude-dev` should appear on the startup screen. Unlocking the disk does
     not let it read your home folder; macOS keeps home folders private between
     users, and it is still not an administrator.
   - **Never reset it from your admin account.** That leaves the login keychain
     locked behind the old password, and the keychain is where Claude Code and
     `gh` keep their credentials — both would silently lose their logins.
     Change it from inside the `claude-dev` session instead.
   - **It is not an administrator password.** Anything that asks for admin
     rights will ask for *yours*. If a Claude Code session triggers such a
     prompt, that is the guard in D-056 working; do not type your password to
     get past it.

   Turn on **Fast User Switching** (Control Centre settings) so both accounts
   can be logged in at once, and set the screen to lock rather than to log out
   — logging out would end the session the phone connects to.

4. **Energy** — System Settings → Battery → Options: prevent sleeping on power
   adapter. Set macOS updates to notify rather than install and restart.
5. **Install the shared tools.** These need admin, and a Standard user cannot
   install them later:
   - **Homebrew** — `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`.
     **(Intel)** it installs to `/usr/local`, not `/opt/homebrew`, so it is
     already on everyone's `PATH` and no `shellenv` line is needed.
   - `brew install node@22 git gh colima docker`
     — `node@22` is keg-only, so add its bin directory to `claude-dev`'s
     `PATH`: **(Intel)** `/usr/local/opt/node@22/bin`. Not plain `brew install
     node`: package.json pins `>=22.13.0 <23` and the latest would fail it.
   - **Xcode** from the App Store, then open it once and let it install its
     components. **(Intel)** Xcode 26.x is the line to use; Apple's
     requirements page states only one architecture restriction (visionOS needs
     Apple silicon), and Tahoe 26.6.2 satisfies Xcode 26.6's minimum. Xcode 27
     is reported to drop Intel — check before upgrading, and do not let it
     upgrade automatically. `pnpm run doctor` sets no version floor: it asks
     only that `xcodebuild -version` answers and that an iPhone simulator
     exists, so there is nothing to gain from chasing releases, and an upgrade
     past the Intel line would cost the simulator.
   - **Android Studio** from developer.android.com.
   - **Docker: Colima**, not Docker Desktop. Colima is open source with no
     licence question for the AS, and it runs per-user, so `claude-dev` starts
     and stops its own VM without admin. **(Intel)** containers run amd64
     natively — no emulation, so the PostgreSQL integration tests (L3) are
     faster here than on Apple silicon.

   A Standard user cannot `brew install` into `/usr/local`, so anything missed
   here has to come back to this account.

6. **Do not add `claude-dev` to the `admin` group.** That is the whole point of
   the separate user (D-056).

### Logged in as `claude-dev`

1. **Claude Code** — installer at code.claude.com/docs. Log in with the Max
   account.
2. **GitHub CLI** — `gh auth login`, as **Claude's** account (A-06), not yours.
   Pull requests must come from Claude's account so that your approvals count
   (D-042).
3. **Clone** — `git clone https://github.com/bvst/TryggHverdag.git ~/code/TryggHverdag`
4. **`corepack enable pnpm`** — pnpm 10.33.0 comes from the `packageManager`
   field; do not install pnpm separately.
5. **Maestro** — `curl -fsSL https://get.maestro.mobile.dev | bash`. It
   installs into `~/.maestro`, so no admin is needed and each user has its own.
   (It is not in homebrew-core; there is a tap, but the installer is simpler.)
6. **Colima** — `colima start --cpu 4 --memory 6 --disk 40`. **(Intel)** with
   16 GB in the machine, leave room: do not run the Android emulator and Colima
   at the same time on this Mac.
7. **Android Studio** → SDK Manager → install an **x86_64** system image
   (API 34). **(Intel)** an `arm64-v8a` image will not run here.
8. **Remote Control** — turn it on in Claude Code, so the Mac appears in the
   Code tab of the Claude app on your phone.
9. **`pnpm install && pnpm run doctor`** — it names anything still missing and
   why it is needed. That is INF-00.

### What only *you* can do, from your own account

Claude's GitHub account has Write access, not Admin (A-06), so it cannot add
repository secrets or change settings. Those are in
[merge-rules.md](merge-rules.md) and stay with you.

## Part 3 — the first prompt

Paste this into Claude Code on the Mac (or from your phone via Remote
Control):

> Read `CLAUDE.md`, `docs/plan/README.md` and `docs/progress.md`. Do INF-00:
> run `pnpm run doctor`, install what is missing that does not need admin
> rights, and tell me what does. Then take the next M0 task from
> `docs/plan/10-roadmap.md`. One task, one pull request (D-052). Ask me one
> question at a time, with a recommendation. Update `docs/progress.md` before
> you finish.

(INF-01 to INF-04 are done — the original version of this prompt, which started
from an empty repository, is in the git history.)

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
Done when `pnpm run doctor` (written in INF-01) confirms all of these on the
`claude-dev` user — `pnpm run doctor`, not `pnpm doctor`, because pnpm has a
built-in command by that name:
- Claude Code, git, gh (logged in as Claude's account), Node 22, pnpm;
- Docker running;
- Xcode with an iOS simulator, and Android Studio with an emulator image;
- Maestro;
- Remote Control enabled.

`claude-dev` has **no** admin rights (D-056).
