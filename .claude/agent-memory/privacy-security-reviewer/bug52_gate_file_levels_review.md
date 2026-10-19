---
name: bug52-gate-file-levels-review
description: BUG-52 / D-133 review (gate:file runs each edited test at its level, L3 "not possible here" without Docker, post-edit hook forwards passing-gate stdout as additionalContext) - fail-open routes and probe recipes
metadata:
  type: feedback
---

BUG-52 (head 5ee115c, base 0df5737, 2026-10-19). Verdict PASS, Should fix + Notes.

**Frame (same as hook_gate_bypass_review):** post-edit is a session quality control; merges
depend on CI. gate:file is not run in CI at all (grep .github: no gate:file).

**What a "not possible here" status can open (check on any planSteps reuse):**
- gate-file's runSteps calls `planSteps(steps, {}, {}, available)`: scripts and env are
  EMPTY, so any future step with `needsScript` or `needsEnv` is always "not possible" and
  exit 0; `availableFor` probes only docker, so any other `needsTool` (adb, ...) is always
  "not possible" too. Probed with a pure node script importing stepsFor/runSteps/report.
  Fix to ask for: availableFor throws on a needsTool it cannot probe; runSteps rejects
  needsScript/needsEnv.
- **Name-dodge:** L3 routing is `endsWith('.integration.test.ts')`, not the integration
  config's `include` (apps|packages/**/src/**). `scripts/x.integration.test.ts` or
  `apps/server/x.integration.test.ts` (outside src) -> L3 step -> no Docker -> exit 0 with a
  note claiming CI checks it. But unit AND coverage configs exclude `**/*.integration.test.ts`
  globally and the L3 include misses it, so it runs NOWHERE. Before BUG-52 such an edit
  always blocked (spuriously). With Docker it still fails closed ("No test files found").
  L6 misplacement fails closed (system config run, no files, exit 1). No repo check finds
  a test file no config collects (grepped scripts for orphan/collected: none).
- Monotonicity read: exit 1 iff some result `!ok && notPossible !== true`; notPossible is
  set only in runSteps for planned skips, never from a child's result. Good.

**Hook additionalContext:** forwards only `r.stdout` on exit 0 (stderr dropped); on exit 0
report() prints only constant step names and planSteps reasons, so no env/secret/path data;
`rel` is the model's own tool path. JSON.stringify verified with a probe: quote, newline,
U+2028, backtick/$(), `</system>` + "Ignore previous instructions" names all come out as one
parseable line with the exact name. Recipe: scratch dir with package.json
`gate:file: node gate.cjs` (gate prints a note), spawn the real hook with input
{cwd, tool_input.file_path} and CLAUDE_PROJECT_DIR=dir.

**Timeout budget:** hook spawnSync 170 s; gate = docker info probe (15 s, before steps) +
steps (160 s) = 175 s worst case. Fails closed (r.error -> block) but the detached step
groups would be orphaned. Note. settings.json hook timeout is 180.

**Docker probe:** same as gate.mjs availableTools (`docker info`, 15 s, spawnSync arg array,
output discarded - docker info prints proxy URLs that can hold credentials, so it must stay
discarded). PATH lookup is pre-existing for pnpm too.

**In-process test hygiene:** restores argv, PATH, exitCode, stdout.write spy in finally;
mkdtemp dirs removed in afterEach. Nit: `process.env.PATH = undefined` would store the
string "undefined" (delete instead); PATH is always set, so theoretical.

Targeted run: `pnpm exec vitest run scripts/gate-file.test.mjs .claude/hooks/post-edit.test.mjs`
= 75 passed, 8 s. Cloud session: /usr/bin/docker exists, `docker info` exits 1 (no daemon).

Related: [[hook-gate-bypass-review]], [[tooling-scripts-review]]
