# TryggHverdag

A mobile app (iOS and Android) that helps people in Norway feel — and be —
safer when walking home alone late in the evening. If the phone goes quiet
during a walk, a server notices and alerts the people who agreed to respond.

**Status:** milestone M0 — foundations. Nothing is released yet.

- What we are building and why: [`docs/plan/README.md`](docs/plan/README.md)
- Decisions that bind every session: [`docs/plan/decisions.md`](docs/plan/decisions.md)
- What has been built so far: [`docs/progress.md`](docs/progress.md)

## Layout

| Path | What lives here | From |
|------|-----------------|------|
| `apps/server/` | API and watchdog worker, one codebase, two processes (AR-01) | INF-05 |
| `apps/mobile/` | The Expo app, with the safety core behind one interface (AR-09) | INF-06 |
| `packages/contracts/` | The API schemas app and server share (AR-07) | INF-01 |
| `packages/test-kit/` | Fakes, builders and synthetic test data (AR-02, RG-07) | INF-01 |
| `packages/config/` | Shared TypeScript, lint and import-rule settings | INF-01 |
| `infra/` | Terraform for Clever Cloud (AR-12) | INF-07 |
| `spikes/` | Throwaway experiments, never shipped | M1 |
| `scripts/` | Repository scripts that the hooks and CI both call | INF-01 |

The full picture is in [`docs/plan/05-architecture.md`](docs/plan/05-architecture.md).

## Everyday commands

| Command | What it does |
|---------|--------------|
| `pnpm install` | Installs everything (Node 22, pnpm 10 — see `pnpm run doctor`) |
| `pnpm run gate:quick` | What a session must pass before calling a task done: static checks, unit tests, no weakened tests |
| `pnpm run gate:full` | Everything that runs without a phone or a deployment — what CI repeats |
| `pnpm run gate:file <path>` | The same checks for one file; this is what runs after every edit |
| `pnpm run gate:static` | The static gate (L1): formatting, types, lint, import rules |
| `pnpm run test:unit` · `test:hooks` | All unit tests · just the tests of the gates |
| `pnpm run req:coverage` | Which requirements have a test that names them (RG-01), written to `docs/requirements-status.md` |
| `pnpm run doctor` | Checks this machine has the tools the project needs (INF-00) |
| `pnpm run format` | Formats the code Prettier owns (Markdown is wrapped by hand) |

`pnpm run doctor`, not `pnpm doctor`: pnpm has a built-in command by that name,
and it would run instead of this one.

## How the quality gates fit together

The checks live in repository scripts, so a local session, a Claude Code hook
and CI all run exactly the same thing. The hooks in `.claude/hooks/` call the
same `gate:*` scripts that CI will call (INF-04).

One rule runs through all of them: **a check that cannot run yet is reported as
skipped, with the task that will bring it — never as a check that passed.**
`pnpm run gate:full` prints that list every time.
