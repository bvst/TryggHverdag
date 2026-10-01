---
name: spike-01-night-20260930
description: SPIKE-01 overnight runs (night-20260930, builds 20545d9): loop 0 BLOCK at e9753cc, loop 1 PASS at 8a37a5e (2026-10-01); what the results document / go-no-go must still say
metadata:
  type: project
---

Loop 0 (e9753cc, 2026-09-30) BLOCKED on B1 (S7 per run), B2a/b/c (timed breaks, capture apart from
S1, non-zero exit judged), B3 ("no verdict"). Loop 1 (8a37a5e, 2026-10-01): all fixed, 247 tests
pass, the night re-judged into manifest.rejudged.jsonl with no status change; the rule gives NO-GO
(S1 failed both platforms, S7 Android fine excused, capture Android failed). Verdict PASS.

Verified against raw evidence (re-check if the results doc quotes otherwise):
- S1 Android gaps 802+432 s / 602+464 s after going stationary at the stop; iOS 370 s = route stop
  1320-1690 s after route start; no iOS arrival all night had moving=false (iOS heartbeats never seen).
- S3 exempt passed with stationary heartbeats at 104-110 s (10 s margin); not-exempt "passed" with a 967 s gap.
- Capture: not just a lookup. TLS to SNI firebaseinstallations.googleapis.com, 2649 B up / 5846 B down,
  at Mac 18:49:22.8Z, 6.5 s after the arrival that ended the 802 s gap. APK has FirebaseInitProvider but
  no google_app_id; app code never asks for a token. Unattributed; new runs cannot attribute it.
- crash.txt is the whole crash buffer: thousands of UWB HAL aborts (/dev/uwb0), no app crash.

Open should-fixes for the results: missing case passes silently in goNoGoInput; untimed breaks
(route-step, device death, checked only at the end) still erase a shown gap; S4/S7 any break -> invalid;
S7 fine "what noticed" not recorded (no notification dump); iOS S5 text is the foreground push only.

**Why:** the owner's SDK go/no-go (D-023, $399) rests on these results.
**How to apply:** when 04b-spike-results.md or the S1-exempt results reach review, check the items
above, that S1 iOS stays failed (never in the "open until L9" list), and see [[verdict-pipeline-review]].
