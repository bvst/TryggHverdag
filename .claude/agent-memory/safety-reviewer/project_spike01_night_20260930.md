---
name: spike-01-night-20260930
description: SPIKE-01 overnight runs (night-20260930 + night-20261001-s1-exempt, builds 20545d9): loop 0 BLOCK, loop 1 PASS (8a37a5e), loop 2 PASS (6ae585f, 2026-10-01); verified raw facts and what 04b-spike-results.md must still fix
metadata:
  type: project
---

Loop 0 (e9753cc) BLOCK; loop 1 (8a37a5e) PASS; loop 2 (6ae585f, 2026-10-01) PASS: 312 tests pass, both
nights re-judged at a8de5ee (clean tree, no status change), summary recomputed at HEAD = scratchpad copy,
results-tables output = the doc's tables byte for byte. Rule gives NO-GO on S1 iOS + capture Android;
S1 Android "failed; passed with the battery-optimisation exemption" (a condition); S7 Android fine excused.

Verified raw facts (re-check if a later doc quotes otherwise):
- S1 Android night: stationary at 25.3 / 28.1 min, never back to moving; gaps 802+432 / 602+464 s;
  all 69/72 arrivals exempt:false. Exempt runs: 109.5 / 109.0 s, stationary 25.1 -> moving 30.4-30.5 min;
  all 100/101 arrivals exempt:true; same APK sha 46d27eef.
- S1 iOS: 370 s at the route stop; 235 moving:true, 0 moving:false per run.
- Capture: TLS SNI firebaseinstallations at Mac 18:49:22.8Z to 172.217.112.4:443 (a SHARED Google front
  end: the judge labels 8 172.217.11x.4 addresses "analytics" by DNS sharing), 6.5 s after the arrival
  ending the 802 s gap, inside a burst of Google connections (maintenance window). Exempt-night logcat:
  app pid 3184 "FirebaseApp failed to initialize ... no default options"; other pids init Firebase OK.
- S6 without CALL_PHONE: driver saw dialer MainActivity in foreground, app said "dialer opened".
- S5 alert posted at spikes/background-safety/app/src/journey.js:319-330 (alertSoon), no category.

Open should-fixes left at loop 2 (results doc, before the owner is asked): part 9 calls S1 Android
"resolved" (it is a condition; vendor calls the exemption a "last resort", "much more power");
CATEGORY_ALARM stated as THE cause / "not a platform limit" (flag state, AOSP site, a run with the
category all unshown); S1 observed vs inference mixed (211-214, 233-238, "same reason", "close to 370 s");
capture prose omits the SNI and the pro-app timing; spec SPIKE-01.md:1155 still says S1 iOS "open until
a real iPhone (L9)". Code (future runs only): longestIntact mixes wall sleep offsets into a mono gap;
goNoGoInput takes duplicate runIds / drops unplanned cases; GO headline silent on conditions.

**Why:** the owner's SDK go/no-go (D-023, $399) rests on these results.
**How to apply:** on any loop 3 or the decision record, check the open items above, that S1 iOS stays
failed everywhere (spec too), and see [[verdict-pipeline-review]].
