---
name: dependency-override-fix-review
description: Reviewing an advisory FIXED by a pnpm override (BUG-23/BUG-24, 2026-10-06) — lockfile proof, tarball diff, run-time reach, inlined copies, and the unowned pnpm-workspace.yaml override route that hides advisories
metadata:
  type: feedback
---

First seen on BUG-23/BUG-24 (2026-10-06, head 68b675c, pnpm 10.33.0): root `pnpm.overrides`
`source-map-js@<1.2.2: 1.2.2` and `shell-quote@<1.11.0: 1.11.0`. Verdict PASS with one
should-fix (repository-level).

**Why:** an override fix looks trivial, but "did it change only what it says" and "can the
same mechanism hide an advisory" both need probes, not reading.

**Recipe that worked (about 6 min total):**
- Lockfile scope: `git diff origin/main...HEAD -- pnpm-lock.yaml`, then in a tar copy of the
  worktree run `pnpm install --frozen-lockfile --lockfile-only --ignore-scripts` (exit 0) and
  `pnpm install --lockfile-only --ignore-scripts` then `diff -q` against the worktree's
  lockfile: identical means pnpm wrote it.
- Registry: `npm view <pkg>@<v> dist.integrity _npmUser license dependencies scripts gitHead
  dist.attestations.provenance.predicateType --json` for old AND new version (compare
  publisher, provenance, install scripts). `npm view <pkg> time maintainers --json`.
- Advisory ranges: POST to registry.npmjs.org/-/npm/v1/security/advisories/bulk with old and
  new versions; only vulnerable ones come back. GitHub /advisories is 403 for this session.
- Tarball diff: `npm pack <pkg>@<v> --pack-destination <own empty dir> --ignore-scripts`, untar
  each in its own dir, `diff -u` the code. source-map-js 1.2.2 (sole maintainer, 2 years after
  1.2.1) was clean: bounds on indexed-map offsets plus a CSP `new Function('return 0')` check
  for the existing cloneSort path (1.2.1 already used `new Function`).
- Remove the ignores in the COPY (`delete p.pnpm.auditConfig` via node) and run
  `pnpm audit --audit-level high --json`: the only highs must be the decided ones. Swap in
  `git show origin/main:` files to reproduce the original red. Text output shows "(N ignored)".
- Red-first: copy test file from the test commit plus lockfile from the commit before the fix,
  run vitest in the copy.

**Run-time reach facts (RN 0.86.3, Expo SDK 57):**
- react-native requires `react-devtools-core` only inside `if (__DEV__)`
  (Libraries/Core/setUpDeveloperTools.js and setUpReactDevTools.js); its main is
  dist/backend.js, which holds no shell-quote.
- react-devtools-core 6.1.5 never `require`s the lockfile's shell-quote: dist/standalone.js
  webpack-INLINES an old pre-1.8 copy (single index.js in its source map). No file in
  node_modules/.pnpm requires shell-quote at all, so the installed copy is dead.
- Release bundles (expo export, same entry hashes as 2026-10-03, so app code had not changed):
  Android 1218 sources / 61 packages, iOS 1126 / 57; no react-devtools-core, shell-quote,
  source-map-js, postcss, magicast.
- postcss reaches apps/mobile through @expo/metro-config (bundler config), so `pnpm why` lists
  apps/mobile (dependencies). Build tooling, not bundled.
- `pnpm why X --filter @trygghverdag/server --prod` prints nothing when there is no path;
  sanity-check the filter with a known runtime dep (hono).

**Inlined copies (invisible to audit AND override):** find with Bash grep over
node_modules/.pnpm. source-map-js signature "Section offsets must be ordered and
non-overlapping" plus `cloneSort|sortCache` (Mozilla source-map has the first, not the second);
fixed marker `MAX_SECTION_OFFSET_LINE`. shell-quote signature: the META string `|&;()<> \\t`;
1.8.4+ shape has "`comment` must not contain line terminators"; fixed marker `sawComment`.
Found: magicast 0.5.5 dist/builders-*.js (unfixed source-map-js, coverage tooling); vite 8.3.0
dist/node/chunks/node.js (shell-quote in the vulnerable shape, but only `shellQuote.parse(` is
called, from launch-editor); react-devtools-core standalone (old copy, nothing loads it);
drizzle-kit and @drizzle-team/brocli (pre-1.8.4 shape). Mozilla `source-map`: no npm advisory.

**The hole (verified by probe):** pnpm 10.33 honours `overrides:` in pnpm-workspace.yaml.
A scratch project with `overrides: {shell-quote: link:./vendor/shell-quote}` there turned
`pnpm audit --audit-level high` from 1 critical (exit 1) to "No known vulnerabilities found"
(exit 0). pnpm-workspace.yaml, pnpm-lock.yaml and a vendor/ dir are all unowned in CODEOWNERS;
BUG-11's ROUTE does not match `overrides`; the fix tests read lockfile KEYS only, and a `link:`
resolution is not a key. npm: aliases and patchedDependencies are the same class (unprobed).
Ask, on every override/audit PR: is this route closed yet?

**Re-checked 2026-10-06:** Dependabot alerts still disabled (A-31). Ruleset "main" active,
bypass_actors [], `security` is a required check.

Related: [[dependency-audit-ignore-review]], [[reviewer-sandbox-quirks]]

**Delta re-check (2026-10-06, head c7975fe): PASS.** Overrides became floors
(`source-map-js@>=1.0.0 <1.2.2: ^1.2.2`, `shell-quote@<1.11.0: ^1.11.0`); lockfile changed only
its overrides block, frozen-consistent and regenerated byte for byte. To prove the guard code
was untouched by a big test refactor, slice both versions from `import { existsSync` to the
first `// --- What fixes` marker, and the ignores `describe` block, and compare strings (both
identical here). Facts learned:
- shell-quote advisories (npm bulk): GHSA-qg8p-v9q4-gh34 critical <1.6.1; GHSA-g4rg-993r-mgx7
  critical >=1.6.3 <=1.7.2 (the `[A-z]` quote regex); GHSA-w7jw-789q-3m8p critical
  >=1.1.0 <=1.8.3 (`quote()` and newlines in object `.op`); GHSA-395f-4hp3-45gv high <=1.8.4
  is a QUADRATIC DoS IN `parse()`, not a quote bug; GHSA-pqg4-j6r4-53mv critical
  >=1.8.4 <1.11.0. So "only parse is called" does not clear a copy at or below 1.8.4.
- Call sites: drizzle-kit 0.31.11 bin.cjs inlines brocli plus shell-quote 1.8.1, and
  `import_shell_quote` appears once (its binding): tree-shaking dropped brocli's `shellArgs`
  and `test`, so neither quote nor parse is ever called. Standalone brocli 0.10.2 calls
  `parse` only from its exported `test(command, args)` helper, and nothing requires the
  standalone package. vite 8.3.0 mounts `launchEditorMiddleware()` with no arguments, so
  `guessEditor` never reaches `shellQuote.parse`; the request's `file` never goes to it.
