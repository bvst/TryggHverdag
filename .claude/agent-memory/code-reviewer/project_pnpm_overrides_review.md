---
name: pnpm-overrides-review
description: BUG-23/24 review (2026-10-06) — how pnpm 10 overrides match, why exact targets freeze, how to reproduce a lockfile and a red-first claim from scratch, and the half-generalised-helper smell
metadata:
  type: project
---

- **pnpm 10.33.0 override selectors match by `semver.intersects(declared, selector)`** (read in `/opt/node22/lib/node_modules/pnpm/dist/pnpm.cjs`, `createVersionsOverrider` / `isIntersectingRange`) and then *replace* the declared range with the target. So `"x@<1.2.2": "1.2.2"` rewrites `^1.2.1` to exactly 1.2.2 and freezes it (later patches can't arrive while the override stands), and `<1.2.2` also grabs 0.x declarers. Check: selector = the advisory's own range (npm bulk endpoint gives `vulnerable_versions`); target = a floor (`^1.2.2`).
- **Docs paraphrase advisory ranges.** BUG-23's docs said "before 1.2.2"; the advisory is `>=1.0.0 <1.2.2`. Always query `registry.npmjs.org/-/npm/v1/security/advisories/bulk` and compare.
- **Reproduce a lockfile claim in ~6 s:** `git archive origin/main $(git ls-tree -r --name-only origin/main | grep -E '(^|/)package\.json$|^pnpm-lock\.yaml$|^pnpm-workspace\.yaml$' | grep -v ^spike)` into a scratch dir, copy in the branch's package.json, `pnpm install --lockfile-only --ignore-scripts`, `diff` against HEAD's lockfile. `pnpm update -r --depth Infinity --lockfile-only <pkg>` is *broader* (moved postcss, rolldown, nanoid too), so an override can be the narrower fix.
- **Red-first check:** `git archive <test-commit> | tar -x -C scratch`, symlink `node_modules` to the repo's, run `./node_modules/.bin/vitest run <file>` from scratch (scripts' tests compute root from `import.meta.url`).
- **Half-generalised helpers:** a generic helper plus one-line per-instance wrappers plus near-identical per-instance tests pays for both designs. Recommend a data table + `test.each` once the substance is identical and only data differs (unlike D-093/D-104 premises, which differ in substance).
- `gh api /advisories/<GHSA>` is 403 here too (session bound to repo-scoped endpoints); the publish time of an advisory can't be checked from a session.
