---
name: home-screen-review
description: M3 task 2 (GRP-02/CALL-01/CALL-02) review patterns - redundant props, silent skips in scripted E2E order, .ts import in a plain node script, copied oracle
metadata:
  type: project
---
- Component props that are always passed the same value twice (LargeButton label === title): delete one.
- scripts/lib/e2e-android.mjs scriptedFlowsToRun: a flow in SCRIPTED_FLOWS but missing/untagged is only printed as "absent" and the run still passes; message says "not in e2e" when it may merely be untagged. Check for fail-loud.
- scripts/e2e-android.mjs imports a .ts file under plain node; engines is >=22.13 but unflagged type stripping is 22.18+.
- test-kit maestroTags is a verbatim copy of lib flowTags: a shared bug passes both.
- Spec promises "each view keyed so it starts at top of scroll" but ScrollView lives in Screen, so a key inside cannot reset it.
- iOS placeholder: callPermission returns notGranted so the "allow" line shows with a button that does nothing.
- depcruise run clean (77 modules); no clock reads outside tests.
