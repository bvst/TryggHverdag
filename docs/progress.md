# Progress log

**Last updated:** 2026-09-20 · **Milestone:** M0 (foundations)

What has actually been built, task by task. The plan is in
[`plan/README.md`](plan/README.md); the M0 task list is in
[`plan/10-roadmap.md`](plan/10-roadmap.md). One task per pull request (D-052).

## M0 at a glance

| ID | Task | Status |
|----|------|--------|
| INF-00 | Mac environment check | ⬜ Waits for the Mac (A-10). `pnpm run doctor` is ready for it |
| INF-01 | Monorepo skeleton | ✅ Done — 2026-09-20 ([#2](https://github.com/bvst/TryggHverdag/pull/2)) |
| INF-02 | Claude Code configuration + hook tests | ✅ Done — 2026-09-20 ([#2](https://github.com/bvst/TryggHverdag/pull/2)) |
| INF-03 | Gate scripts | 🔜 Next (runs in a cloud session) |
| INF-04 | CI workflows, merge rules, CODEOWNERS | ⬜ Blocked on owner: see below |
| INF-05 | Server skeleton | ⬜ Not started — needs Docker for the L3 tests |
| INF-06 | App skeleton | ⬜ Waits for the Mac |
| INF-07 | Staging on Clever Cloud | ⬜ Blocked on owner: Clever Cloud token |
| INF-08 | Monitoring | ⬜ Blocked on owner: Healthchecks.io / UptimeRobot |
| INF-09 | Daily status workflow | ⬜ Blocked on owner: A-09 |
| INF-10 | Gate drills | ⬜ Not started |

## What Claude needs from the owner next

Nothing blocks INF-02 or INF-03, so cloud sessions can continue. These are
needed before the tasks in brackets:

1. **A-09 — `claude setup-token`**, saved as the repository secret
   `CLAUDE_CODE_OAUTH_TOKEN` [INF-04 AI reviews, INF-09 daily report].
2. **A token for Claude's GitHub account (A-06)** in the cloud environment, so
   pull requests are opened by Claude's account and the owner's approvals count
   (D-042). Until then the owner merges the pull requests. The same account's
   token is the `CLAUDE_BOT_TOKEN` secret that `gate:integrity` uses to read the
   merge rules [INF-04].
3. **Repository merge rules** need repository-admin rights, which Claude's
   account does not have on purpose (A-06). Claude will write down the exact
   settings for the owner to switch on [INF-04].
4. **Clever Cloud API token** for the AS's account (A-04) [INF-07].
5. **Healthchecks.io and UptimeRobot API keys** (A-08) [INF-08].

## Log

### 2026-09-20 — INF-01: monorepo skeleton ✅ (pull request [#2](https://github.com/bvst/TryggHverdag/pull/2))

**Built**

- pnpm workspace (`apps/*`, `packages/*`) with Turborepo, Node 22 and pnpm
  pinned, and a catalog so every package shares one TypeScript version.
- `packages/config` — the shared settings, in one place so a session, a hook and
  CI all use the same rules:
  - `tsconfig/base.json`: strict TypeScript plus `noUncheckedIndexedAccess`,
    `exactOptionalPropertyTypes` and `verbatimModuleSyntax`;
  - `eslint/index.mjs`: type-aware lint for every package, and the **AR-03 rule**
    that stops safety code from reading the clock or keeping timers in memory;
  - `dependency-cruiser.cjs`: the **AR-10 import rules** — domain stays pure,
    the UI cannot reach into the safety core, features cannot reach into each
    other's internals, only the safety core may import the location SDK,
    contracts depend on nothing of ours, test fakes never reach shipping code,
    and nothing imports a spike.
- `packages/contracts` and `packages/test-kit` — the two packages the server
  skeleton will fill (INF-05), with just enough in them to prove that one
  workspace package can import another.
- `scripts/doctor.mjs` — the INF-00 environment check: Node, pnpm, git, Claude
  Code everywhere; GitHub CLI, Docker, Xcode with a simulator, the Android SDK
  with an emulator image and Maestro on the Mac. Missing tools print why they
  are needed and how to install them.
- `pnpm run gate:static` — the L1 gate: formatting → types → lint → import
  rules.

**Verified**

- `pnpm run gate:static` passes on the skeleton (the INF-01 exit criterion), and
  `pnpm install --frozen-lockfile` works from the committed lockfile, which is
  what CI will do.
- `pnpm run doctor` passes in a cloud session and reports the Mac-only checks as
  skipped.
- The new gates were made to fail on purpose, by hand, and all blocked:
  - domain code calling `Date.now()` and `new Date()` → AR-03 lint errors;
  - a package importing a spike → `spikes-are-throwaway`;
  - `packages/contracts` importing another of our packages → blocked (it does
    not even resolve, because pnpm only links what a package declares);
  - the two workspace lists made to disagree → the import check stops with an
    explanation instead of silently checking less.
  These were run by hand in the session. INF-10 turns them into automated
  drills; that is where they become permanent.

**Decisions recorded:** D-057 (package names), D-058 (toolchain versions).

**Worth knowing for the next task**

- **TypeScript is pinned to 6.0.x, not 7.** See D-058: typed lint (the L1 gate)
  does not support TypeScript 7 yet.
- **`pnpm run doctor`, not `pnpm doctor`** — pnpm has its own `doctor` command
  and it wins. The two plan documents that said `pnpm doctor` were corrected.
- **The root `package.json` repeats the workspace list** in an npm-style
  `workspaces` field, because dependency-cruiser reads only that field. A guard
  in `packages/config/dependency-cruiser.cjs` fails the import check if the two
  lists ever drift apart.
- **Prettier does not format Markdown**, and neither Prettier nor ESLint looks
  inside `docs/`: the planning documents are prose wrapped by hand, and the
  files in `07b`/`08b` are templates that INF-02 copies in unchanged.
- **One lint error is waiting in a template**: `07b`'s `scan-sensitive.mjs` has
  an unnecessary escape (`no-useless-escape`). It is ignored where it sits now,
  and needs fixing when INF-02 copies it into `.claude/hooks/`.
- **No test runner yet.** Vitest arrives with the hook tests in INF-02
  (`pnpm test:hooks`), which is also when `scripts/doctor.mjs` gets its tests.
- **Docker does not run in this cloud session** (the binary is there, the daemon
  is not). INF-05's integration tests (L3, Testcontainers) will therefore need
  either the Mac or CI, unless the cloud environment (A-14) is set up with
  Docker. Worth checking before INF-05 starts.

### 2026-09-20 — INF-02: the gates are installed ✅ (same pull request [#2](https://github.com/bvst/TryggHverdag/pull/2))

The owner chose to continue in the same session rather than switch, so INF-01
and INF-02 share one pull request. Back to one task per pull request after this.

**Installed**

- `.claude/` — 11 agents, 12 skills, 5 path-scoped rule files, 7 hook scripts
  and the permission settings from `docs/plan/07b-claude-code-files/` (D-044).
- `CLAUDE.md` — replaced by the build-phase version, with the real command list.
- `.github/CODEOWNERS` — `@OWNER` replaced by `@bvst`. Changes to the safety
  paths, the gates themselves and the decision log need the owner's approval
  (D-042). INF-04 wires it into the merge rules.
- `pnpm run gate:file` and `pnpm run gate:quick` — minimal versions, because the
  post-edit and stop hooks call them. INF-03 replaces them with the full ones.
- Vitest, with `pnpm run test:hooks` and `pnpm run test:unit`.

**Tested — 77 cases, one file per hook**

| Hook | What the tests prove |
|------|----------------------|
| `lib.mjs` | Glob matching and path handling: if these are wrong, every gate is wrong |
| `guard-paths.mjs` (HK-02) | `implementer` cannot touch tests or the test kit; `test-author` cannot touch production code; nothing outside the repository can be edited |
| `guard-bash.mjs` (HK-03) | Pushes to `main`, force pushes, skipped git hooks, reading environment files, deploys and admin merges are blocked; reviewers cannot change anything; `implementer` cannot reach tests through `sed` or a redirect either |
| `scan-sensitive.mjs` (HK-07) | Private keys, hard-coded secrets, positions in log lines and real-looking Norwegian numbers are blocked; the one fixtures file is the exception |
| `test-weakening.mjs` (HK-05) | Skipped, focused and deleted tests and removed assertions are caught; honest changes are not |
| `post-edit.mjs` (HK-04) | The gate runs on the edited file, failures stop the work, and a **missing** gate is loud rather than silent |
| `stop-gate.mjs` (HK-06) | "Done" is refused while the gate fails; the red phase of `/feature` runs only the static checks; after being asked to continue once it writes the failure down instead of looping |
| `session-start.mjs` (HK-01) | A session is told the branch, the plan status, the open owner to-dos, and anything left failing last time |

`claude plugin validate .claude` passes (agents, skills and commands).

**Changed from the draft, and why** (recorded as D-059)

1. **Permission paths are anchored at the project.** The drafts used `./x`,
   which the [permissions documentation](https://code.claude.com/docs/en/permissions)
   anchors at the session's *current* directory; `/x` anchors at the project.
   This was the one item the 07b notes asked to verify, and it needed changing.
2. **`claude/*` branches may be pushed**, which is what cloud sessions are given
   (D-055).
3. **The weakening detector and the two role guards now also cover
   `**/*.test.mjs`**, because the hook tests are written in `.mjs`. Without it,
   the tests that protect the gates would have been the one kind of test nobody
   was watching.
4. **Environment files are denied in both forms**, project-anchored and bare.

**Worth knowing for the next task**

- **HK-08 has no script.** Section 7 lists eight hooks; the draft set has seven.
  The missing one checks that `docs/progress.md` and the plan status were
  updated before a session ends. Claude recommends adding it in INF-03, next to
  the other gate scripts, unless the owner would rather leave it out.
- **The gates are live and they bite.** While the tests were being written,
  `guard-bash` twice blocked Claude's own shell commands, because the test data
  contains forbidden commands as strings. The way around it is the ordinary one
  — write the file with the editor instead of the shell — which is exactly the
  shell loophole the 07b notes describe. CODEOWNERS is the backstop: every
  change under `.claude/` needs the owner's approval.
- Hook tests live next to the hooks (`.claude/hooks/*.test.mjs`) and run with
  `pnpm run test:hooks`.

## In flight

Nothing. INF-03 is the next task: the full gate scripts (`gate:file`,
`gate:quick`, `gate:full`, `req:coverage`, `tests:changes`, `coverage:ratchet`,
`api:diff`, `mutation`, `licenses:check`), each with its own tests.
