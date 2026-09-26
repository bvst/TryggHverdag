---
name: stale-prose-after-amendment
description: When a spec amends an acceptance criterion after review, the AC text is updated but the Technical approach, Out of scope, app README and doctor hints keep the old rule — grep the old phrasing
metadata:
  type: project
---

INF-06's 2026-09-26 amendments changed AC9 to "Java 17 to 21, emulators only, and Maestro's exit status as well as its report" and added AC19 (allowBackup false). The code and the ACs were correct. Several other places still stated the old rule:
- the spec's own Technical approach preflight list ("Java 17 or newer", "an adb device");
- the spec's Out of scope, which still said Android backup settings were deferred;
- `apps/mobile/README.md` ("passes only when Maestro's report shows…");
- `scripts/doctor.mjs`, whose Maestro fix hint says "Java 17 or newer … e.g. Android Studio's own". Android Studio's JBR is the Java 25 that D-081 says fails the build.

**Why:** the next session reads the prose, not the test. A doctor hint that points at the exact tool the decision rules out sends the owner into the failure the amendment was written to prevent.

**How to apply:** for each amended AC, take the old wording, such as "17 or newer" or "report shows", and run `git grep` for it over `docs/specs/<ID>.md`, `apps/*/README.md`, `CLAUDE.md` and `scripts/doctor.mjs`. Report stale lines as a single Should fix, not one finding per line. Related: [[spec-promises-vs-head]], [[doctor-false-green]].
