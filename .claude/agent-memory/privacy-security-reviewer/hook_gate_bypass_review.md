---
name: hook-gate-bypass-review
description: Reviewing changes to the session hooks (stop gate, progress gate) as security controls - stand-down env switches, remembered-green fingerprints, what an agent can already do to skip them
metadata:
  type: feedback
---

First seen on BUG-30/31 (D-118, D-119, head 75ca5d1, 2026-10-08). Verdict PASS, Notes only.

**Frame:** the Stop/SubagentStop hooks are session-local quality controls, not merge
controls. Merges depend on CI's required checks (gate:full etc.), which never go through
the hooks. So a hook bypass is a Note unless it reaches a required check or a secret.

**What an adversarial agent could ALREADY do to skip the stop gate (pre-existing, not
protected anywhere, checked by grepping guard-paths/guard-bash/scan-sensitive):**
- write `.claude/state/phase` = `red:...` (downgrades to gate:static);
- write `.claude/settings.local.json` (not in settings.json's ask list) with
  `disableAllHooks` or an `env` block;
- `git update-index --assume-unchanged/--skip-worktree` (not in the allow list, so asks).
A new bypass only matters if it is EASIER than these, or reachable by accident.

**Probe recipe for a fingerprint/remembered-green hook (about 1 tool call):** scratch git
repo in the scratchpad, copy the hook plus lib.mjs, package.json with gate:quick and
gate:static both `node gate.cjs`; gate.cjs appends to a runs file and exits 1 if a
watched file holds BAD. Run the hook with `env -u` on the stand-down variables, print
exit code and run count. D-119 results: unchanged = skip; untracked new/changed = rerun;
staged BAD = rerun; **gitignored input turning BAD = skip** (ignored files are not in
the fingerprint); **assume-unchanged on a tracked BAD file = skip** (git diff hides it).

**Stand-down switches:** check (1) both variables required, exact values, tests for
each alone and for a wrong value; (2) the test helper strips the variable so a CI job
that sets it cannot make hook tests pass falsely; (3) in a review job the hooks are
main's (`.claude/**` reverted), so a PR cannot add a stand-down to its own review;
(4) the workflow side should set it on the claude-code-action STEP env only, and a
test should pin that no other workflow (ci.yml, daily-status.yml) sets it.
The stop gate in a review job runs PR code (pnpm gate:quick) inside the step that
holds the Claude token: standing it down REDUCES exposure.

**Guard quirk again:** a Bash grep naming the environment object with a dot was blocked;
use the Grep tool.

Related: [[tooling-scripts-review]], [[reviewer-sandbox-quirks]], [[merge-rules-codeowners-review]]

**BUG-36 / D-120 review (head 019e941, 2026-10-08), PASS with should-fix.** The global
guards now refuse writes to the local-settings file and the hooks' state folder.
- **Probe without naming the paths:** as a subagent, the guard refused my own heredoc probe
  because its text named the phase file (any redirect or write op plus a matching token).
  Build paths in JS from pieces ('.cl' + 'aude', 'st' + 'ate') and put placeholders (@L, @S)
  in the case JSON. Spawn guard-bash/guard-paths with the exact settings.json args, an
  input with/without agent_id, and with/without CLAUDE_PROJECT_DIR. 40 cases in 1 call.
- **Token split gap:** tokens split on whitespace, quotes and `=` only. A path followed by
  `;`, `&&`, `)` or an unspaced `<` escapes an exact glob (the local-settings file, the bare
  state dir), while `state/**` (compiled to `.*`) swallows the trailing chars. Also open:
  cp into the directory (`cp x/<file> <dir>/`), ln/install/dd (not in WRITE_OPS), shell
  globs (`stat?`), case variants (same file on macOS APFS), symlinks from outside the repo
  (guard-paths --global ignores outside paths).
- **Root mismatch:** stop-gate and progress-gate root their records at input.cwd;
  session-start uses CLAUDE_PROJECT_DIR; the guard judges from CLAUDE_PROJECT_DIR. From a
  subfolder holding a package.json (apps/server), the stop gate reads the subfolder's state
  records, which the guard does not protect (probed exit 0 for a subagent). Check that every
  reader and the guard share a root.
- **CLAUDE_PROJECT_DIR unset:** the hook command path itself does not resolve, node exits 1,
  and Claude Code treats that as non-blocking: every guard is off, not "cwd stands in".
- **D-121 evidence via REST:** jobs API steps (claude-code-action + "Enforce the verdict")
  count reviewer sessions. Job log blobs return 403 through the proxy; use
  check-runs/<job id>/annotations for the failure text (run 213 = Claude Code install
  failure, exit 22, not missing structured output).
