---
name: red-phase-typed-lint
description: Type-aware ESLint fails a TypeScript test whose imports don't exist yet (no-unsafe-* on error types), so HK-09 blocks committing red TS tests before their modules exist
metadata:
  type: project
---

With `strictTypeChecked` (packages/config/eslint), a TypeScript test that imports a module which does not exist yet gets `@typescript-eslint/no-unsafe-assignment`, `-member-access`, `-call` and `-argument` errors ("error typed value", "type that cannot be resolved") wherever it uses what it imported. Seen on INF-06's app tests, 2026-09-25: 22 errors across three of four files once `apps/mobile/tsconfig.json` existed. A tsconfig makes the file *parseable*; it does not make it lint-clean.

**Why:** HK-09 (pre-commit) runs ESLint on staged files and HK-03 blocks `--no-verify`, so "commit the red tests first, then the source" does not work for TypeScript tests the way it does for the `.mjs` tooling tests (those are linted without type information).

**How to apply:** when a plan says "commit the TS tests on their own before the source", say up front that it cannot pass HK-09. Don't loosen lint for tests to get round it. What the coordinator approved for INF-06: the implementer writes stubs first, only the type surface the tests import (JSON files with keys and empty values, functions that throw "not implemented", modules that render nothing). Tests, stubs and config are then committed together as the red commit, with the jest run showing every suite failing on assertions. Related: [[expo-pnpm-peers]].
