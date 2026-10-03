---
name: dependency-audit-ignore-review
description: Reviewing an accepted pnpm audit ignore (BUG-11/D-093) — how pnpm 10.33 matches ignores, every route that ignores an advisory outside the root package.json, and how to prove reachability in @expo/cli
metadata:
  type: feedback
---

First seen on BUG-11 (2026-10-02, pnpm 10.33.0, @expo/cli 57.0.27). Verdict PASS with should-fixes. The ignore was correct; the guard around it was narrower than its claims.

**Why:** a decision-bound ignore list is only as strong as the places pnpm reads ignores from, and the test pinned two of five.

**How pnpm 10.33 decides** (read in /opt/node22/lib/node_modules/pnpm/dist/pnpm.cjs, around `ignoreGhsas`):
- `ignoreGhsas.includes(github_advisory_id)`: exact, case-sensitive, **path-agnostic and severity-agnostic**. `ignoreCves` drops an advisory only when all its CVEs are listed. The text output says "(N ignored)" with no path; JSON `metadata.vulnerabilities` still counts it.
- `pnpm audit --ignore-unfixable` / `--ignore` WRITE `ignoreCves` into the root package.json and exit 0.
- `pnpm config get auditConfig` does not see package.json's `pnpm` field or pnpmfile hooks: useless as an effective-config check.

**Reproduce without the ignore, no repo edit:** copy pnpm-lock.yaml, pnpm-workspace.yaml, .npmrc and every workspace package.json into scratch, delete `pnpm.auditConfig` with `node -e`, run `pnpm audit --audit-level high` there.

**Routes that ignore an advisory outside package.json** (each verified exit 0 in scratch with package.json's ignore removed):
- root `.pnpmfile.cjs` with `hooks.updateConfig` (runs for every command, after CLI flags are merged; it could lower `auditLevel` too);
- `.npmrc` `pnpmfile=<any path>` (e.g. an unowned file under apps/server);
- a quoted `"auditConfig":` key in pnpm-workspace.yaml (workspace settings override package.json's). Kebab `audit-config:` is NOT honoured.
- Fix that works: `--config.ignore-pnpmfile=true` or env `npm_config_ignore_pnpmfile=true` on the audit (covers configDependencies pnpmfiles too). `--ignore-pnpmfile` is an unknown option for audit.
- CODEOWNERS (2026-10-02) does not own /pnpm-workspace.yaml, /.npmrc, a root .pnpmfile.cjs, or apps/server/package.json — those auto-merge on green.

**node-forge reachability in @expo/cli 57.0.27** (lazy `_nodeforge()` getters, so nothing loads unless called):
- `run/ios/codeSigning/Security.js` (run:ios only): `certificateFromPem`, parse only.
- `utils/codesigning.ts` imports node-forge as **type only**; runtime goes through @expo/code-signing-certificates: `validateSelfSignedCertificate` (cert.verify(itself), local file from `updates.codeSigningCertificate`) and `signBufferRSASHA256AndVerify` (verifies its own fresh signature). Only caller: ExpoGoManifestHandlerMiddleware (`expo start`). Both branches return null first when the resolved config has no `updates` and no `extra.eas.projectId` — check with `EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 pnpm exec expo config --type public --json`.
- `csr.verify` is only in the server-side `generateDevelopmentCertificateFromCSR`, never called by the CLI.
- `@parse/node-apn@8.1.0` pins node-forge 1.4.0: the likely APNs client for D-086's "push straight to APNs", i.e. a future apps__server path that an ID ignore would hide.
- spikes/background-safety/app/pnpm-lock.yaml (eas-cli 24.8.0, @expo/pkcs12, jks-js, all to node-forge) is audited by neither CI nor Dependabot.

**How to apply:** for any audit ignore ask: is the path pinned (lockfile parents)? does anything fail when it goes stale (package gone or patched)? are pnpmfile/.npmrc/quoted-YAML routes covered? are those files owned?

Related: [[mobile-release-review]], [[tooling-scripts-review]], [[reviewer-sandbox-quirks]]

**BUG-15 (2026-10-03, head 0ccd0f5, D-104, braces GHSA-vfj7-8cjw-p6xm): PASS with should-fixes.**
- **A one-level premise pin is weak when the direct dependent is a hub.** node-forge's dependents are leaves, so pinning them catches a server path (D-093 promises "a new path needs a new decision"). braces' only dependent is micromatch, which nearly every glob user goes through, so a server dependency on micromatch (or on jest-message-util) passed all 15 tests in a mutation probe. The fix to ask for: pin the importer closure (reverse walk from the package to `importers`, which must be exactly `apps/mobile`).
- **Is the vulnerable function even called?** micromatch 4.0.8 calls braces only from `.parse`, `.braces` and `.braceExpand`. `micromatch()`, `.some`, `.isMatch` and `.any` go to picomatch alone. All 8 lockfile callers (Jest's core, transform, config, haste-map and message-util, metro-file-map 0.84.x, @expo/metro-file-map) use only the picomatch ones, so braces is loaded but never invoked.
- **Copies inlined into a package's dist are invisible to the audit and to the lockfile pin.** Find them with `grep -rlE "rangeLimit"` over node_modules/.pnpm. Found: vite 8.3.0 (via chokidar 3.6.0; `braces.expand` runs only with globbing on, and Vite's dev server sets `disableGlobbing: true`), tsx 4.23.15 cli (watch mode), prettier 3.9.8 and resolve-workspace-root 2.0.1 (`micromatch.braces` on CLI or workspace globs). All tooling.
- **The Grep tool skips node_modules/.pnpm** (it is hidden and gitignored) and reports "No files found". Use Bash `grep -r` there.
- **Bundle proof, about 20 s per platform:** `tar --exclude=./.git` the worktree into scratch (relative pnpm symlinks survive), then run `EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 CI=1 pnpm exec expo export --platform android|ios --output-dir <scratch> --source-maps --no-minify` in the copy's apps/mobile, then parse the .hbc.map's `sources` and `sourcesContent`. On 0ccd0f5 Android had 1218 sources from 61 packages and iOS 1126 sources. The only @expo/cli file is `build/metro-require/require.js`. Delete the copy afterwards (854 MB).
- `pnpm why X --prod` lists Jest because react-native 0.86 has an optional peer on @react-native/jest-preset, and pnpm counts peers as prod. Explain that before calling it a runtime path.
- **Dependabot alerts are DISABLED** (GitHub API, admin token and plain curl, 2026-10-03: "Dependabot alerts are disabled for this repository."). That contradicts merge-rules.md lines 152-155. gate:integrity does not check it. With an ID ignore in place, nothing notices when a fix ships. Re-check on every audit-ignore PR.
- npm's bulk endpoint works with curl: POST `{"braces":["3.0.3"]}` to registry.npmjs.org/-/npm/v1/security/advisories/bulk. GitHub /advisories and the advisory web pages are blocked by the proxy. npm gives the CVSS 3.1 score (7.5), while decisions quote GitHub's 8.7 (probably CVSS 4.0), so say which.
- **Mutation-probe pattern:** a scratch node script that edits the COPY's package.json, lockfile and decisions.md per case, runs `pnpm exec vitest run scripts/dependency-audit.test.mjs --reporter=verbose`, and restores. It never touches the worktree under review.
