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
| `pnpm run gate:static` | The static gate (L1): formatting, types, lint, import rules |
| `pnpm run doctor` | Checks this machine has the tools the project needs (INF-00) |
| `pnpm run format` | Formats the code Prettier owns (Markdown is wrapped by hand) |

`pnpm run doctor`, not `pnpm doctor`: pnpm has a built-in command by that name,
and it would run instead of this one.

## How the quality gates fit together

The checks live in repository scripts, so a local session, a Claude Code hook
and CI all run exactly the same thing. `gate:static` is the first of them; the
rest arrive with INF-02 (hooks), INF-03 (gate scripts) and INF-04 (CI).
