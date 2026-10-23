---
name: task2-loop1-delta
description: The M3 task 2 loop-1 delta review (9820f78..d2a55ca): all seven loop-1 findings closed, one spec drift, and what stays unobserved on a device.
metadata:
  type: project
---

Delta 9820f78..d2a55ca reviewed read-only (gate:full was running; no suites run):
PASS, advisory (D-043). Written by the coordinating session from the review's
report, since this reviewer has no Write tool.

Closed (do not re-flag), each held by a test:
1. userInterfaceStyle: expo-system-ui ~57.0.4 (config plugin applies itself;
   app.config.test.ts, CALL-02-AC7).
2. The explaining button's name is "{title}. {line}", no hint (home.test.tsx).
3. The hint is call.permission.missing while notGranted; back to "Ringer
   {spelled number}" once granted (call.test.tsx, grant and revoke via AppState).
4. Message has a label prop; call.button.failed and call.emergency.failedLabel
   spell the number.
5. The crash fallback's Message is assertive (screen.test.tsx, both paths).
6. GRP-02-AC11: shared/ui/new-view.tsx, Heading registers, useViewStartsAtTop
   scrolls to top and focuses the new heading; the first view moves nothing
   (home.test.tsx test.each over six view changes).
7. "Lagre" dismisses the keyboard; the refusal Message sits above it.

The owner's 112 text (D-141, fourth amendment) matches in nb and en and is
asserted in full in the owned emergency.test.tsx.

Found: CALL-02.md's prose at about line 650 said the English hint reads "the
phone app"; the code, tests, table and D-141 say "your phone app".

Unobserved, reasoned only: focus sent from a passive effect at mount (Fabric);
TalkBack on a live region that mounts already filled; the navigation-bar button
colour under edge-to-edge; WCAG 2.5.3, the 112 button's name "Ring 1 1 2, ..."
does not contain the visible "112" (the owner's choice; worth the owner
knowing). The call hint says "Ringer {number}" while permission is null (unread
or the read failed), though the tap goes to the dialer.
