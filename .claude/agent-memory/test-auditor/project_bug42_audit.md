---
name: bug42-audit
description: BUG-42 (ESLint ignores .stryker-tmp/) PASS at a4106b6; in-memory revert via NODE_OPTIONS data-URL load hook reaches ESLint's own config import; width mutants
metadata:
  type: project
---

BUG-42 (2026-10-13, 7fe39a7 tests, a4106b6 fix, HEAD 10a6775 docs): one IGNORED_PATHS entry '.stryker-tmp/'.
PASS. Reverting it in memory turns both BUG-42 tests red on the sandbox paths only. Wider forms ('.stryker-tmp*/',
'.stryker*', '.*/') are caught by the .stryker-tmp-old control. '.stryker-tmp/**/*.ts' is caught because the sandbox's
copied eslint.config.mjs lints the file (the test's config copy is load-bearing). These survive as equivalent or harmless:
'.stryker-tmp/**', '.stryker-tmp/**/*', '**/.stryker-tmp/', '.stryker-tmp/*/', '.stryker-tmp/sandbox-*/'.
Open notes: BUG-26 (same finding) is still "Queued" in docs/progress.md; Prettier's skip of the sandbox (.gitignore)
is checked by hand only (`prettier --file-info`), not by a test.

**How to mutate a module ESLint loads through its own config import** (no files written): pass
NODE_OPTIONS="--import=data:text/javascript,<encoded register(data:...hooks)>" to `pnpm exec vitest run <file>`.
Build the string with `node -e` that prints it, captured by $(...). Keep `>` and `=>` out of the inline JS.
Have the hook write `TA_MUTANT matches=N` to stderr. A Vite transform cannot reach this module, because ESLint
imports the config natively.
Also: req:coverage rewrites docs/requirements-status.md. Run it, then check `git status` to show the report is byte-identical.
gate:integrity is 3/5 locally. `gh api repos/bvst/TryggHverdag/rules/branches/main` and `/rulesets/<id>` give the
required checks and bypass_actors ([] on 2026-10-13).
Related: [[in-memory-mutation]], [[bug-test-patterns]], [[gate-integrity-local]]
