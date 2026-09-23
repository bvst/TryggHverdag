# 7 · Claude Code setup: CLAUDE.md, subagents, skills, hooks

**Status:** ✅ Done — draft v0 files in [07b-claude-code-files/](07b-claude-code-files/README.md) · **Last updated:** 2026-09-20

## Summary
- **The model:** CLAUDE.md orients · rules and skills teach · agents specialise ·
  hooks enforce · CI verifies. Every gate is machinery, not an instruction.
- **11 agents with separation of duties:**
  - `test-author` can't touch production code;
  - `implementer` can't touch tests;
  - the reviewers are read-only;
  - `safety-reviewer`, `privacy-security-reviewer` and `test-auditor` block
    merges (D-043).
- **5 workflows** (`/feature`, `/bugfix`, `/status`, `/decision`, `/release`)
  and 7 reference skills.
- **7 hook scripts**, all smoke-tested: 31 of 31 cases pass.
- **Merges:** automatic when all gates pass. The owner approves safety paths
  and changes to the gates themselves, through CODEOWNERS (D-042).
- Claude works through its own GitHub account without admin rights (A-06), so
  the owner's approvals are real approvals and the rules can't be bypassed.
- Real-phone tests are switched on before the group relies on the app for real
  walks (D-041).
- Draft files: `07b-claude-code-files/` (D-044). They are verified
  automatically when the repository is created.

## Goal of this section
Turn the decisions from Sections 1–6 into a working environment where Claude
Code:
1. always knows the rules;
2. works through specialists that have only the access they need;
3. **cannot skip the gates**, because they are enforced by machinery, not by
   instructions;
4. leaves a trail that makes resuming work and tracking progress automatic.

## Research findings — round 1

### 1. Guardrails belong in hooks, not instructions
- Anthropic's documentation says so directly: a rule written in CLAUDE.md or a
  skill is a request, not a guarantee, while a hook that blocks an action
  before it runs is enforcement. If a rule must hold every time, it should be a
  hook.
  Source: https://code.claude.com/docs/en/features-overview.md
- Hooks fire on lifecycle events (before or after a tool is used, at session
  start, when Claude tries to finish, and more). They can run a script, an HTTP
  request, an MCP tool call, a prompt or a subagent. They cost no context unless
  they return output.
  Source: https://code.claude.com/docs/en/features-overview.md
- **Implication:** Every gate from Section 6 becomes a hook or a CI check.
  Instructions only explain *why*.

### 2. Keep CLAUDE.md short; scope rules to paths
- The guidance is to keep CLAUDE.md under 200 lines and to put
  directory-specific guidance in `.claude/rules/` files, which load only when
  Claude works on matching paths.
  Source: https://code.claude.com/docs/en/features-overview.md

### 3. Subagents give real separation of duties
- Each subagent runs in its own context with its own system prompt, an allowed
  or denied tool list, a model, a permission mode, preloaded skills, its own
  hooks, optional persistent project memory, and optionally its own git
  worktree.
  Source: https://code.claude.com/docs/en/sub-agents
- A hook defined in a subagent's file only runs while that subagent is active,
  and can block, for example, specific commands. Project subagents' hooks only
  run after the owner accepts the workspace trust prompt for the folder.
  Source: https://code.claude.com/docs/en/sub-agents
- Deny rules such as `Bash(git push *)` in settings apply to the main
  conversation *and* to subagents.
  Source: https://code.claude.com/docs/en/sub-agents
- Keep subagent descriptions short: Claude Code warns when their combined
  length passes 15,000 tokens.
  Source: https://code.claude.com/docs/en/sub-agents
- **Implication:** The agent that writes tests and the agent that writes code
  can be different agents, and a hook can stop the code-writer from touching
  test files at all. That enforces RG-03 by construction.

### 4. Skills are reference material or workflows
- A skill can be reference knowledge or an action you trigger with
  `/<name>`. Skills with side effects can be hidden from automatic use, so only
  an explicit command runs them. A subagent can preload the skills it needs.
  Source: https://code.claude.com/docs/en/features-overview.md

### 5. Useful add-ons
- A TypeScript code-intelligence plugin gives Claude symbol navigation and live
  type errors, which reduces file reading.
  Source: https://code.claude.com/docs/en/features-overview.md
- Maestro offers an MCP server so Claude can drive UI tests itself (Section 6,
  finding 1).

## The model in one line
**CLAUDE.md orients · rules and skills teach · agents specialise · hooks
enforce · CI verifies.**

## Proposed layout

```
CLAUDE.md                 ≤ 200 lines: what, where, how we work, links to docs
.claude/
├── settings.json         permissions (allow / deny), hooks, environment
├── rules/                short, path-scoped conventions (auto-load)
│   ├── server-domain.md      paths: apps/server/src/domain/**
│   ├── safety-core.md        paths: apps/mobile/src/safety-core/**
│   ├── contracts.md          paths: packages/contracts/**
│   ├── tests.md              paths: **/*.test.ts, **/*.test.tsx
│   └── ui-i18n.md            paths: apps/mobile/src/**/*.tsx
├── agents/               specialists (below)
├── skills/               workflows and reference (below)
├── hooks/                hook scripts — tested in CI like any other code
└── agent-memory/         reviewers' project memory, committed to git
```

## Agent roster (proposed)

| Agent | Job | Can change | Key guard |
|-------|-----|-----------|-----------|
| `planner` | Turns a story ID into `docs/specs/<ID>.md`: acceptance criteria, test list, technical approach | `docs/specs/**` only | Hook blocks writes elsewhere |
| `test-author` | Writes the failing tests from the spec and proves they fail for the right reason | Test files and `packages/test-kit/**` only | Hook blocks writes to production code |
| `implementer` | Makes the tests pass. Can run in its own worktree for parallel work | Production code | **Hook blocks any edit to test files** (RG-03 by construction) |
| `code-reviewer` | Clarity, simplicity, AR-01 to AR-12, conventions | Nothing (read-only) | Remembers recurring issues in project memory |
| `safety-reviewer` | Required for changes to domain, alerts, worker or safety-core: SM, REL and LOST rules | Nothing (read-only) | Its verdict is a required check (round 1, question 3) |
| `privacy-security-reviewer` | PRIV and SEC rules, logging, access control, dependencies | Nothing (read-only) | Required check for data, auth and logging changes |
| `a11y-i18n-reviewer` | Accessibility, and complete bokmål and English text | Nothing (read-only) | — |
| `test-auditor` | RG-01 to RG-06: tests trace to IDs, nothing weakened, mutation survivors in safety code | Nothing; runs tests and mutation analysis | Blocks "done" when gates fail |
| `release-engineer` | Versions, changelog, builds, store metadata (Section 8) | Release files only | Can't touch app or server code |
| `infra-engineer` | Terraform for Clever Cloud (AR-12) | `infra/**` | Plans changes only; applying them needs the owner's approval |
| `plan-keeper` | Keeps `docs/plan/`, `docs/progress.md` and `decisions.md` up to date | `docs/**` | The only agent allowed to edit `decisions.md` |

Separation of duties is the core idea: the agent that writes the tests can't
write the code, the agent that writes the code can't change the tests, and a
third agent checks both.

## Skills (proposed)

| Skill | Type | What it does |
|-------|------|--------------|
| `/feature <ID>` | Workflow (explicit only) | planner → test-author (tests fail) → implementer (tests pass) → reviewers in parallel → test-auditor → plan-keeper updates progress → pull request |
| `/bugfix` | Workflow (explicit only) | Reproduce with a failing test named `BUG-<n>` → fix → reviewers → pull request (RG-02) |
| `/status` | Workflow | A plain-language progress report for the owner: stories done, requirements covered, open risks, CI health |
| `/decision` | Workflow | Records a decision in the format from the working agreement |
| `/release` | Workflow (explicit only) | Release checklist and gates (Section 8) |
| `architecture-rules` | Reference | AR-01 to AR-12, repository layout, where code goes |
| `testing-conventions` | Reference | Test levels, naming with requirement IDs, fakes, fast-check and Testcontainers patterns |
| `safety-rules` | Reference | SM-01 to SM-10, REL, the LOST stories, failure modes |
| `privacy-rules` | Reference | PRIV and SEC tables, logging and retention |
| `api-contracts` | Reference | oRPC contract-first rules, versioning, oasdiff |
| `platform-notes` | Reference | iOS and Android background behaviour, notifications, permissions |
| `ui-i18n-a11y` | Reference | Night-use design, big touch targets, nb and en text |

## Hooks — the enforcement layer (proposed)

| ID | Event | What it does | Enforces |
|----|-------|--------------|----------|
| HK-01 | Session start | Shows plan status, owner to-dos, CI status of `main` and open pull requests | Resuming work |
| HK-02 | Before an edit | Blocks protected files: test files for `implementer`; production code for `test-author`; `decisions.md` for anyone but `plan-keeper`; CI workflows, `.claude/settings.json`, hook scripts and merge rules unless the owner approves | RG-03; the gates themselves |
| HK-03 | Before a shell command | Blocks pushing to `main`, force pushes, skipping git hooks (`--no-verify`), reading `.env` files, and any connection to production data | D-029, SEC-03 |
| HK-04 | After an edit | Formats the file; type-checks, lints and checks import rules for the changed package; runs affected tests; feeds the results back | L1, L2, L5 |
| HK-05 | After an edit to a test file | Detects weakening: skipped or focused tests, removed assertions, fewer tests | RG-03 |
| HK-06 | When an agent tries to finish | Refuses "done" while affected tests, the type check or the requirement-coverage check fail | RG-01, RG-02 |
| HK-07 | Before an edit | Blocks anything that looks like secrets or real personal data (real phone numbers, coordinates in log statements) | PRIV-07, RG-07 |
| HK-08 | Before the session ends or compacts | Checks that `docs/progress.md` and the plan status were updated | Resuming work |
| HK-09 | Before a commit (a git hook, not a Claude Code hook) | Formats staged files with Prettier and re-stages what it changed; reports ESLint findings and refuses the commit. A partly staged file is checked, never rewritten | HK-04's blind spot |

Hooks are code, so they have their own tests in CI. A broken guard fails
loudly.

HK-09 is the odd one out: a git hook rather than a Claude Code hook, because it
covers a gap the others cannot see. HK-04 runs on `Edit` and `Write` — every
edit Claude Code makes *through those tools*. Work that reaches disk another
way, through Bash (a `sed` one-liner, a heredoc, a generator), never passes it.
That is not hypothetical: on #13 a test file written with a heredoc kept a
formatting error, and only `gate:quick`, run by hand before pushing, caught it.
git sees all of those paths, because every one of them ends at a commit.

HK-03 has always blocked the flag that skips git hooks — so the guard against
stepping around this one predates the hook itself by several months.

## Permissions baseline (proposed)
- **Deny:** pushing to `main`, force pushing, `--no-verify`, reading `.env`
  files, deleting outside the workspace, running production deploys from a local
  session.
- **Ask:** changes to CI workflows, merge rules, `.claude/settings.json` and hook
  scripts.
- **Allow:** package scripts (test, lint, type-check, build), git on feature
  branches, local containers for tests.
- Claude always works on a feature branch and opens a pull request. CI then
  runs everything again: a second line of defence that doesn't depend on the
  local session (Section 8).

## Open questions for the owner

**Round 1 (asked 2026-09-20, answered):**
1. **Carried over from Section 6:** when should the real-phone tests (L9) be
   switched on? (Recommendation: before the private group relies on the app for
   real walks home — see the note in Section 6, round 2.)
2. How much merge autonomy should Claude have? (Recommendation: merge
   automatically when all gates pass. You approve only changes to safety paths
   (domain, alerts, worker, safety-core) and to the gates themselves, based on
   the reviewers' plain-language summary.)
3. Should the AI reviewers' blocking findings block merges? (Recommendation: yes
   for `safety-reviewer`, `privacy-security-reviewer` and `test-auditor`;
   advisory for the rest. You can override any block.)

## Rounds

### Round 1 — 2026-09-20
- **Questions:** switch-on point for real-phone tests · merge autonomy ·
  blocking reviewers.
- **Answers (owner):** before the group relies on it for real walks ·
  auto-merge when the gates pass, with owner approval for safety and gate
  changes · safety, privacy and test-auditor block.
- **Outcome:**
  - D-041 to D-044 recorded.
  - Draft files written and smoke-tested: all 31 hook test cases pass and the
    frontmatter validates.
  - One consequence found: GitHub doesn't let authors approve their own pull
    requests. Claude therefore works through its own GitHub account (owner
    action A-06). This also closes the admin-bypass concern from D-029.
  - Section 7 closed.

### Follow-up — 2026-09-20
- **Owner review of the 07b drafts:** "Looks good, continue to Section 8."
- **Claude plan:** Max. Recorded as D-045 (model and usage choices).

## Next steps
Section closed. Next: Section 8 (CI/CD, environments and releases), which adds
the CI workflows that repeat every local gate, and fills in `/release`.
