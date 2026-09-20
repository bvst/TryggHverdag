---
name: release
description: "Prepare a release pull request for the owner's approval: version, plain-language notes, API snapshot and release gates RL-01 to RL-07. Usage: /release <version>"
disable-model-invocation: true
---

# /release $ARGUMENTS

Delegate to `release-engineer`. Never deploy or build locally: merging the
release PR triggers `.github/workflows/release.yml`.

1. Create the branch `release/$ARGUMENTS` from an up-to-date `main`.
2. Check the gates with `pnpm release:gates --dry-run`:
   - RL-01 all required checks green on `main`;
   - RL-02 staging canary green for the last 24 hours;
   - RL-03 real-phone suite green — **required from the first release the group
     uses for real walks (D-041)**;
   - RL-05 DPIA and privacy notice updated if data processing changed.
   Stop and report if any fails.
3. Bump the app version; build numbers are managed by EAS.
4. Save the OpenAPI file to `packages/contracts/released/$ARGUMENTS.json`
   (RL-04).
5. Write `docs/releases/$ARGUMENTS.md` for the owner and testers, in plain
   language: what's new, what was fixed, known limits, residual risks, and
   whether it is safe to rely on for real walks (RL-06).
6. Open the PR and confirm there are no open BLOCK findings (RL-07). The owner
   approves it (CODEOWNERS). After merge, CI deploys and submits to TestFlight
   and Google Play testing.
