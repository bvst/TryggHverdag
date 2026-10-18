---
name: rejected-alternative
description: When a commit message explains why the fix took form A and not B, plant B - the tests for the bug's symptom usually accept both, and B's harm is what nobody tests
metadata:
  type: feedback
---
BUG-34 (2026-10-18): the fix put connectionTimeoutMillis on the pg Client, not the Pool, because the pool form also times out a
queued acquire in a full pool (Graphile's unawaited completeJob would then crash the worker). All 5 bug tests and the guard pass
with the pool form: the symptom (a silent database) is cured by both. Only a full-pool test separates them.
**Why:** bug tests pin the symptom; a design reason in prose is a claim with no assertion behind it.
**How to apply:** read the fix's commit message for "not X, because Y"; plant X; if it survives, ask for a test of Y (Should fix
unless X is in the code now). Same for any constant whose comment states a relation (CONNECT_TIMEOUT_MS half of START_LIMIT_MS):
tests that import the constant cannot pin its value; plant a raised value.
Related: [[bug34-audit]], [[bug-test-patterns]]
