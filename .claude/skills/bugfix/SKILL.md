---
name: bugfix
description: "Fix a bug test-first: reproduce with a failing test named BUG-<n>, fix, review, audit, pull request. Usage: /bugfix <description or issue link>"
disable-model-invocation: true
---

# /bugfix $ARGUMENTS

1. Give the bug the next ID `BUG-<n>` (see `docs/progress/m0.md`) and create the
   branch `fix/BUG-<n>-<short-name>`.
2. **Reproduce** — `test-author` writes the smallest failing test named
   `BUG-<n>: <symptom>`, at the lowest level that reproduces it. For
   production or release failures this is mandatory (D-035).
3. **Fix** — `implementer`, with the same rules as `/feature`.
4. Continue with steps 4–9 of `/feature`. The PR explains the root cause and why
   the test would have caught it.
