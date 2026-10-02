---
name: bug14-audit
description: BUG-14 / D-100 test audit (PASS at 49d66ae, code at ef0c1cf): 31 in-memory faults, all brief faults killed; an added fifth safety-filter entry survives; D-100's list is a hand copy of part of MUTATION_INPUTS
metadata:
  type: project
---

Audited 2026-10-02 (cloud session), branch fix/BUG-14-gate-files-owned. Code and tests at ef0c1cf; d1d30a4 and 49d66ae landed
during the audit (docs and privacy-security memory only, checked with `git diff ef0c1cf HEAD -- scripts .github packages apps`).
PASS.

- RG-02 replay: the tests at f7daaa6 (== HEAD's) against merge-rules.mjs, CODEOWNERS and ai-review.yml at 097d835 (== origin/main)
  gave exactly 8 red, each on an assertion that names the missing piece; the other 30 tests in the describe stayed green.
- Faults (harness scratchpad/ta-bug14/ta-harness.mjs): test-kit line moved after /.claude/agent-memory/ (killed only by the
  ordering assertion, a convention: that pattern cannot match test-kit files, so ownership is unchanged), given no owner, only
  @bvst, removed, commented out, unanchored; later unowned lines (src/, package.json); dropped from OWNER_APPROVAL_PATHS or
  written without its slash; each filter entry removed, moved under ui:, into a comment, or replaced by a wrong entry (typo,
  `/*`, no glob, leading /, double quotes). All 28 KILLED.
- SURVIVED (Note): an **added** fifth entry (`docs/**`, a path matching no file, an unowned package). Test 5 checks only the
  constant D100_SAFETY_ENTRIES, and BUG-10's reverse test only `apps/` entries. A full reverse test needs an explicit
  exception for `packages/contracts/**` (in the filter, only released/ is owned). Backstop: ai-review.yml is under owned /.github/.
- Scope note: MUTATION_INPUTS (gate-decisions.mjs:199) also holds vitest.config.mjs and vitest.shared.mjs, and groups add
  their configs (vitest.system.config.mjs). They are not in the safety filter. D-100 took the four files #57's code-reviewer
  named. D100_SAFETY_ENTRIES is a fourth hand copy of a path list.
- RG-05: no PR, check-runs total_count 0 at 49d66ae. decideMutation on the branch's files says skip (nothing to mutate). Main's
  ai-review.yml already has `checks: read` (line 99), so the brief's "403, no checks: read" premise is stale.
- gate:full (coordinator's run): 11 passed, gate:integrity 3 of 5 (token), integration and android not possible here.
Related: [[bug12-audit]], [[in-memory-mutation]], [[gate-integrity-local]]

**Loop 1 re-audit (HEAD 3e1babb, tests 5d0174e, D-100 amended 1fca48c): PASS.** D100_SAFETY_ENTRIES became a list derived from
exported MUTATION_INPUTS plus every group's config; ai-review.test.mjs pins safety-reviewer's brief naming D-100 and each input.
Harness v2: scratchpad/ta-bug14/ta-harness2.mjs (also rewrites gate-decisions.mjs, reads .claude/agents/safety-reviewer.md via
the readFileSync override in ai-review.test.mjs, runs gate-decisions.test.mjs as the backstop). Two-stage RG-02 replay: at
1fca48c 4 red on "MUTATION_INPUTS is not exported"; with only the export added, the filter test names the 3 Vitest configs and the
brief test names D-100 plus all 7 paths. The owner and group-tests tests go green with the export alone (they pin
conditions that already held). 30 faults killed. A filter list derived from the code cannot see the same removal in both places,
but gate-decisions.test.mjs's per-input trigger rows (lines 126-144) catch it: test-kit, mutation.mjs and journeys' config
(S1-S3) were all killed there. Dropped memory-line assertions: still covered by INF-10-AC18 (gate.test.mjs:618; Q3, Q4 killed). The
ordering move (Q2) and an added unowned fifth entry (G2) survive, as expected and as already noted.
