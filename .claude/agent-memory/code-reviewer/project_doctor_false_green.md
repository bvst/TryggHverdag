---
name: doctor-false-green
description: Recurring review angle for scripts/doctor.mjs (INF-00, BUG-4) — hunt for checks that report OK on an unverified inference
metadata:
  type: project
---

For `scripts/doctor.mjs`, the owner's main worry is a check that says ✅ when the tool can't actually be used (BUG-4, 2026-09-25). Hanging is the second worry: every `sys.exec` has a timeout, and `ssh` must use BatchMode.

**Why:** a doctor that is green without knowing is worse than no doctor. BUG-4 found three false answers on the Mac.

**How to apply:** for each ✅ branch, ask what it *inferred* rather than checked. Example: in BUG-4, "HTTPS origin, so git pushes through gh" was inferred and never checked against `credential.https://github.com.helper`. Hooks block Bash commands whose text contains `doctor.test.mjs`. Run `vitest run scripts/doctor` instead, or use Read.
