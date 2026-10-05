---
name: isolating-values
description: A value list that names several refusal clauses needs one value per clause that only that clause refuses; each.$name titles are truncated by Vitest
metadata:
  type: feedback
---
LOST-02 loop 2 (2026-10-04): 15a refuses "not a whole number from 1 to 2147483647 (0, -1, 0.5, NaN, 2147483648)". Dropping
`Number.isInteger` from the fake and from the adapter both survived, because 0.5 is also refused by `>= 1`. The test name claims a
clause no value isolates, and D-100 parity on that clause is unbound (the two predicates agree only because they are copies).

**Why:** a guard `A && B && C` is tested per clause only if some input fails exactly one clause. Lists written to "cover the edges"
pick values that fail several at once.
**How to apply:** for each clause of a refusal, find a value that passes every other clause (1.5 for the integer check). Plant each
clause's removal separately at both the fake and the adapter. Also: Vitest renders `test.each(...)('$name')` titles through its 40-char
truncation, so `-t '<full name>'` selects nothing; a harness run with pass 0 fail 0 is not a survivor, it ran nothing. Always print
the pass count and run a control per pattern.
Related: [[lost02-audit]], [[second-path-isolation]], [[allowlist-anchor-tz]]
