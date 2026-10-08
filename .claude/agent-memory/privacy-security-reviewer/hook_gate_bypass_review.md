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
