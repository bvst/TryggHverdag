# CLAUDE.md — TryggHverdag

A cross-platform (iOS + Android) app that helps people in Norway get home
safely at night. **Safety-critical: an app that fails silently is worse than no
app.**

All code is written by Claude Code. The owner decides scope, cost, privacy and
safety. Claude decides libraries and tools and records why (D-031).

## Before you do anything
1. Read `docs/plan/README.md` (status, owner to-dos) and `docs/progress.md`.
2. Decisions in `docs/plan/decisions.md` are binding. Never contradict one;
   propose a new decision with `/decision` instead.
3. Find the requirement ID for the work (for example `LOST-02`, `SM-05`,
   `PRIV-07`). No ID means no work: ask the owner rather than inventing scope.

## How work is done
- New behaviour: `/feature <ID>`. Bugs: `/bugfix`. Report for the owner: `/status`.
- Always work on a branch (`feat/<ID>-short-name` or `fix/BUG-<n>-short-name`)
  and open a pull request. In a cloud session, use the branch the session was
  given (D-055). Never push to `main`; merging is decided by CI and the merge
  rules (D-042).
- Tests come first (RG-02). `implementer` never edits tests, and `test-author`
  never edits production code. Both are enforced by hooks.
- A task is done only when the stop gate passes: types, lint, import rules,
  affected tests, requirement coverage.
- Blocking reviewers (D-043): `safety-reviewer`, `privacy-security-reviewer`,
  `test-auditor`. A BLOCK must be fixed, or overridden by the owner.

## Non-negotiables (the reasons behind the hooks)
- Fail loudly, never silently. If something can't be verified, say so plainly.
- Read the job log before theorising. A red check is explained by its job log,
  and by nothing else — not its pull request comment, not how long it ran, not a
  script you reasoned about without running. Open the log, quote what it says,
  then explain. Three hypotheses about one failing gate were wrong in a single
  morning because the log was reached for last, and each was stated more
  confidently than its evidence carried (D-070).
- Say what you checked, not what you assume. "These paths are CODEOWNERS-gated"
  and "this is a required check" are claims: run the command, read the file,
  and if you cannot, say which part is unverified rather than rounding it up to
  true.
- Safety decisions use the database clock. Domain code never reads the clock
  itself (AR-03).
- Journey and alert behaviour follows SM-01 to SM-10 exactly (see
  `docs/plan/05-architecture.md`).
- No locations or phone numbers in logs (PRIV-07). Test data is always
  synthetic (RG-07).
- Personal data stays in the EEA. No third-party analytics or advertising
  SDKs (D-016, PRIV-06).
- Never weaken a test to make it pass (RG-03). If a test looks wrong, stop and
  explain why; only `test-author` may change it, with a written reason.
- No over-the-air code updates (D-023).

## Map
| Path | What |
|------|------|
| `apps/mobile` | Expo app. `src/safety-core` is isolated (AR-09); `src/features/<prefix>` follows the story IDs |
| `apps/server` | API (`api.ts`) and worker (`worker.ts`); `src/domain` is pure logic |
| `packages/contracts` | API schemas (oRPC + zod); `released/` holds the OpenAPI files of shipped app versions |
| `packages/test-kit` | Fakes for every adapter, data builders, fake clock |
| `infra` | Terraform for Clever Cloud |
| `docs/specs` | One spec per requirement ID |
| `docs/plan` | Planning and decisions (the project's memory) |

## Commands
Scripts are added by the task that needs them, so `docs/progress.md` is the
list that is actually true. Today:

`pnpm install` · `pnpm run gate:file <path>` · `pnpm run gate:quick` ·
`pnpm run gate:full` · `pnpm run gate:static` · `pnpm run test:unit` ·
`pnpm run test:integration` · `pnpm run test:system` · `pnpm run test:coverage` ·
`pnpm run test:hooks` · `pnpm run req:coverage` · `pnpm run tests:changes` ·
`pnpm run coverage:ratchet` · `pnpm run api:diff` · `pnpm run api:spec` ·
`pnpm run mutation` · `pnpm run licenses:check` · `pnpm run gate:integrity` ·
`pnpm run doctor` · `pnpm run dev` · `pnpm run e2e:android`

`gate:full` prints the steps it cannot run yet and which task brings them, so
"passed" never quietly means "did not check". Still to come: `e2e:ios`, with
the weekly iOS simulator run, as its own task before M3's exit (the owner's
answer to INF-06's Q2: Android only in INF-06).

`test:unit` and `test:coverage` run Vitest and then the app's jest-expo suite.
`e2e:android` (L7) builds the release app, installs it on a connected Android
emulator and runs the Maestro flows; without a device, `gate:full` names the
`android-e2e` check as where it runs.

`test:integration` (L3) needs a Docker daemon, so it runs in CI and on the Mac
but not in a cloud session; `gate:full` says so rather than skipping quietly.
`test:coverage` is the only run the coverage ratchet measures — unit and system
together, because the API is reached at L6 and nowhere else.

`gate:integrity` (CI-01) checks the merge rules through GitHub's API. The owner
has imported the ruleset, so it now reports **5 of 5** against the live
repository. It goes red the moment the rules and this repository disagree —
which is the point (D-029, D-060).

Use `pnpm run <name>`: `pnpm doctor` and `pnpm test` are pnpm's own commands and
would run instead of ours.

## Language
Code and docs are in English. App text lives in translation files: bokmål
first, then English (D-014).

## When unsure
Ask the owner one question, with a recommendation. Record the answer.
