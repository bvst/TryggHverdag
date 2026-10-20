---
name: new-logic-outside-group-tests
description: New logic added to an existing safety folder is often proven only by a NEW test file the mutation group does not list; the group's score stays above 80 % on old code while every new mutant survives; read the per-mutant report for the new lines
metadata:
  type: feedback
---
GRP-01 (2026-10-20): removal.ts's walker check and service.ts's AC13 refusal were proven only by groups.system.test.ts,
outside the journeys group's three test files. Scores 88.89 % / 94.66 % passed the gate while every new mutant
survived (5 and 7). A new safety folder (modules/groups/) was also left out of SAFETY_PATHS, so it was neither mutated
nor under the 95 % branch floor (coverage.mjs imports SAFETY_PATHS).

**Why:** a file score is pooled over old and new lines; a passing gate says nothing about the lines the PR added.
**How to apply:** for each safety file the diff touches, list the Survived/NoCoverage mutants in the local Stryker
JSON and match their lines to the diff's hunks. Plant the new branches by hand against the group's own test list
and against the new test file; a kill only by the outside file means the group's `tests` need it. Check every new
folder the spec calls a safety path against SAFETY_PATHS and MUTATION_GROUPS (gate-decisions.test.mjs pins both).
Treat a local report's Survived as a lead, not a fact: plant it (one was stale here).
Related: [[narrowed-mutation-group]], [[grp01-audit]], [[stryker-incremental-reuse]]
**Read the span, not the start column** (GRP-01 loop 1): a ConditionalExpression at `if (a === null || f(a))` may be the left operand alone (equivalent when f(null) already refuses), and a StringLiteral survivor on a `return { type: ..., reason: ... }` line is often the `type` discriminant the caller never compares. Print location start-end and the replaced text before calling a survivor real.
