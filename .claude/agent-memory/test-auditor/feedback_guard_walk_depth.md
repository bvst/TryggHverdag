---
name: guard-walk-depth
description: source-walking guards that skip generated folder names (build, dist, android, ios) at every depth go blind to nested src folders the test runner still runs
metadata:
  type: feedback
---
jest-virtual-mocks.test.mjs (2026-10-23) skips NOT_SOURCE names at any depth; jest-expo testMatch has only /node_modules/ ignored, so
src/shared/build/x.test.tsx runs under jest but the guard never reads it (planted, guard green). ESLint's IGNORED_PATHS '**/build/**' has the same shape repo-wide.
**How to apply:** for any walker guard, compare its skip list with the runner's real testMatch/ignore (`npx jest --showConfig`), and plant a file in a nested
folder with each skipped name. Also plant aliasing (`import { jest as j }`, `jest['mock']`, computed keys) and report them as notes.
Related: [[jest-virtual-mock-cache]], [[m3t2-home-screen-audit]]
