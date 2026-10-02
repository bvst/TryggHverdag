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
