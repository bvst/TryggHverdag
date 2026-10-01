---
name: shadowed-guards
description: When a change adds a new filter layer (a plan, an allow-list) in front of an existing guard, re-run the old mutants — tests can keep passing for the new layer's reason, and the new layer can silently drop failures
metadata:
  type: feedback
---

Found in the SPIKE-01 loop-2 re-audit (2026-10-01, 6ae585f). `goNoGoInput` gained `expected`, the runner's
planned cases, and filters runs by it before judging. Two effects:
1. **Shadowed guard.** The old Force stop test still passes, unchanged. Its fixture's plan has no
   `forcestop`, though, so the plan drops those runs before `entry.judged !== false` is reached. The mutant that
   removes the judged guard was KILLED at 8a37a5e and SURVIVES now. The RG-03 reason said "nothing weaker". The
   assertion is unchanged, but its kill power is gone.
2. **Silent drop.** A failed run whose case is outside the plan vanishes, and a deciding item reads "passed". The
   plan was meant to make a missing case "no verdict"; dropping unplanned failures came along as a side effect. A
   probe confirmed it: S4 with two passes plus one failed "retry" run gives passed.

**Why:** in this project a failure that disappears is the worst outcome (fail loudly). Neither effect shows in a
line-by-line diff of the tests.
**How to apply:** when a fixture helper gains a new required argument (input() passing `expected`), re-run the
previous audit's mutants for the guards that sit behind the new layer. For any allow-list or plan filter on
evidence, probe one failing item outside the list. Ask for a refusal ("a run outside the plan"), not a silent
filter. Graded Should fix while no recorded run falls outside the plan; check the real manifests (read-only)
before grading.
Related: [[spike01-audit]], [[entry-script-wiring]], [[bug-test-patterns]]
