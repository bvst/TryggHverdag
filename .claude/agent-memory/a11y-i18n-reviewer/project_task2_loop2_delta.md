---
name: task2-loop2-delta
description: The M3 task 2 loop-2 delta review (d2a55ca..9c7c498): PASS; how RN 0.86.3 delivers an Android hint, and what not to re-flag.
metadata:
  type: project
---

PASS at 9c7c498, advisory (D-043), read-only, no suites run. Written by the
coordinating session from the review's report (this reviewer has no Write tool).

Closed and held by tests: the call hint is "Ringer {spelled number}" only while
the permission reads granted, `call.permission.missing` for notGranted, unread
and a failed read (call.test.tsx loop-2 cases with fakePhone.holdPermission);
CALL-02's "your phone app" drift (D-141 at decisions.md about 6711-6713 is the
source); #1 deleted at a start with no credential changes nothing visible
(home.test.tsx AC6/AC9).

Reusable, reasoned from source and not observed: on Android in RN 0.86.3,
accessibilityHint is AccessibilityNodeInfo.tooltipText
(ReactAccessibilityDelegate.kt:87), not part of contentDescription
(BaseViewManager.java about 415-445), so a hint-only change on a focused node is
probably silent to TalkBack and read at the next focus. Use it to judge any
later hint-flip concern.

Do not re-flag: the null-state hint (the safe direction; callPermission is
notGranted off Android and phone.ts rereads at the tap); "Ringer" kept after a
failed read that follows a granted one (CALL-01 Risks); the null state shows no
visible permission line.

Still open, none from this delta: WCAG 2.5.3 on the 112 button's name (with the
owner); TalkBack on a live region that mounts filled; focus from a passive
effect on Fabric; the navigation-bar button colour under edge-to-edge.
