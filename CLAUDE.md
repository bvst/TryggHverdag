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
`pnpm run gate:static` · `pnpm run test:hooks` · `pnpm run test:unit` ·
`pnpm run doctor`

Still to come, with their tasks: `gate:full`, `req:coverage`, `tests:changes`,
`coverage:ratchet`, `api:diff`, `mutation` (INF-03), `dev`, `test:integration`,
`test:system` (INF-05), `e2e:android`, `e2e:ios` (INF-06).

Use `pnpm run <name>`: `pnpm doctor` and `pnpm test` are pnpm's own commands and
would run instead of ours.

## Language
Code and docs are in English. App text lives in translation files: bokmål
first, then English (D-014).

## When unsure
Ask the owner one question, with a recommendation. Record the answer.
