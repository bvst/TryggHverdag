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

**Loop 1 (head fa00e6f, 2026-10-19), PASS with one should-fix.** All loop-0 findings closed
(probe3.mjs in scratchpad: out-of-include L3 names route to "the edited tests no Vitest config
includes" with no needsTool; needsScript/needsEnv/adb all throw). Vitest 5 resolves a filter
holding a slash against the root (`vitest run lib/glob.test.mjs` = "No test files found", it
does NOT substring-match scripts/lib/glob.test.mjs), so an orphan step cannot borrow a
matching file's pass.
- **NEW fail-open from loop 1:** post-edit.mjs now statically imports scripts/gate-file.mjs
  (for GATE_FILE_LIMIT_MS), which pulls in vitest.shared.mjs and scripts/lib/{glob,proc,steps,
  test-strength}.mjs. A syntax error in any of them kills the hook with node's exit 1, which
  Claude Code treats as NON-blocking: the breaking edit passes and every later edit is
  unchecked until fixed. The 5ee115c hook exited 2 for the same edit (gate:file failed).
  Probe recipe (scratchpad/imp): copy hook + lib.mjs, scripts/lib, gate-file.mjs,
  vitest.shared.mjs into a scratch project, append `export const broken = ;`, run new and
  `git show 5ee115c:` hooks, compare exit 1 vs 2. Fix: dynamic import in try/catch that
  calls block(), or a literal pinned by a test. Same class pre-exists for test-weakening.mjs
  and progress-gate.mjs (static imports from scripts/lib) - check every hook that imports
  repo code for this.
- Guard quirk again: a Bash grep pattern naming the environment object with a dot was
  refused ("Reading .env files"); drop the object name from the pattern.

**Loop 2 (head 8568ed8, fix 84cb623, 2026-10-19), PASS, Notes only.** The hook now loads
gate-file.mjs with `await import()` in try/catch after the early exits; a failed load calls
block() (lib.mjs block = stderr + process.exit(2), so `gate` is never read undefined).
probe4 re-run (scratchpad/imp, keep `git show fa00e6f:` hook as the loop-1 control):
syntax error in gate-file.mjs -> exit 2 (loop-1 hook exit 1, 5ee115c hook exit 2); syntax
error in vitest.shared.mjs -> exit 2 on its own edit and on a later apps/x.ts edit; top-level
`throw 42` in scripts/lib/glob.mjs -> exit 2 with "42"; README.md edit while broken -> exit 0
(early exit first, test-author's documented decision). Left open on purpose and queued:
malformed package.json JSON.parse -> exit 1 (BUG-53, with progress-gate/test-weakening
static imports). Residual notes: a missing GATE_FILE_LIMIT_MS export gives spawnSync no
limit (pinned by a test only; a `typeof !== 'number'` block would close it); the
SyntaxError message names no file or line (the stack is dropped). The hook test's
hookModules() follows the hook's relative imports and copies them into a dirWith temp
project, so it tracks future imports. 112 tests passed (post-edit + gate-file).

**Loop 3 (head d04c930, 2026-10-19), PASS with one should-fix (my miss from loop 2).**
Limit check (Number.isInteger and above 0) blocks string/0/-1/1.5/undefined (probed exit 2), but
accepts 1e300, which spawnSync takes as no effective limit (sleep 2 ran 2008 ms, no
error); only the settings.json test holds the real value under 180 s. whereItBroke: child
`node --input-type=module -e "await import(<GATE_URL>)"`, process.execPath, arg array, no
shell, 10 s, stdin closed, env/cwd inherited; main() stays off (argv[1] undefined under -e);
only a `^file:///\S+:\d+$` line leaves, made repo-relative. Probed: syntax error -> "at
scripts/gate-file.mjs:308"; lib/steps.mjs error -> "at scripts/lib/steps.mjs:126"; missing
named export -> "at scripts/gate-file.mjs:20" (from error.stack's first line).
- **inspect() of a non-Error throw prints its contents:** `throw { token: "SYNTH-SECRET-123" }`
  came out verbatim in the block message (String() gave "[object Object]"). Theoretical (gate
  code throwing a secret-bearing object), unbounded length: suggest depth 0 + maxStringLength
  or tail().
- **MISSED IN LOOP 2: an in-process dynamic import fails OPEN on a load that never ends.**
  Appended to the scratch gate-file.mjs: `await new Promise(function () {})` -> node exit 13
  ("unsettled top-level await", non-blocking); the same with a live setInterval -> hangs (124
  under `timeout 25`), so Claude Code's 180 s hook timeout ends it, non-blocking;
  `while (true) {}` -> hangs too. The 5ee115c hook blocked all of these (exit 2: gate failed /
  spawnSync ETIMEDOUT at 170 s). Lesson: when a hook moves repo code from a child process with
  a timeout into its own process, probe THREE load failures, not one: throw/syntax error,
  unsettled top-level await (exit 13), and a hang (sync loop or live handle). Fix to ask
  for: no repo import in the hook (literal limit pinned by a test), or do the whole load in
  a child with a timeout and block on anything but success.
- Exit codes in probes: with `printf | timeout node | cut | head`, the hook's status is
  PIPESTATUS[1], not [2]; the first loop-3 run read cut's 0. Simpler: send the hook's output
  to /dev/null and read $?.

**Loop 4 (head ae082f5, 2026-10-19), PASS, Notes only.** Option (a): the hook loads no repo
code (literal GATE_FILE_LIMIT_MS = 170_000, test pins it equal to the gate's export); diff
against 5ee115c is the constant plus comments. probe4 with a scratch hook whose limit is sed'ed
to 5_000: syntax error (gate-file.mjs and vitest.shared.mjs), throw 42, unsettled TLA -> exit 2
"Checks failed"; live-timer TLA and `while (true) {}` -> exit 2 "spawnSync pnpm ETIMEDOUT"
after 5 s; README.md -> 0.
- **Orphans (pre-existing, confirmed):** spawnSync's timeout SIGTERMs only pnpm; the
  `node scripts/gate-file.mjs` child is reparented to PID 1 and keeps running (a busy loop
  spins forever). One was still alive 2 h after my loop-3 run of the 5ee115c hook, which proves
  it predates the branch. Find with `ps -eo pid,ppid,etimes,args | grep "[n]ode scripts/gate-file"`
  and kill them after probing. In practice the gate's own step timers (150 s) end first, so only
  a gate that hangs itself orphans. Fix: spawn detached + process.kill(-pid) in the hook.
  The hook tests' fake pnpm does `exec node load-gate.mjs`, so they leave no orphans.
- **Another agent may be running the same vitest file at the same time** (test-auditor): a
  ps listing then shows their node and bash processes. Do not kill by pattern beyond your own
  scratch path.
- guard-bash quote splice (`".clau""de"`): already listed as open in hook_gate_bypass_review.md
  since BUG-36 loop 1 (2026-10-08); test-author actually USED it in a throwaway worktree.
  Severity view: low-medium, session-local (CODEOWNERS + CI gate merges), same class as the
  other tokenizer gaps; queue them together with a shell-word lexer, not one-off regexes.
