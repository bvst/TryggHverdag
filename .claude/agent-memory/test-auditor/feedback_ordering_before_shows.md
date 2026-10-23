---
name: ordering-before-shows
description: "X happens before the screen shows" claims survive unawaited-but-caught and after-update faults unless a hold on X is part of the test
metadata:
  type: feedback
---
GRP-02 loop 2 (session.tsx start with no credential deletes #1 "before the join screen shows"): tests checked the key gone after
findByText(join) and no join request, so `deleteFirstContact().catch(()=>{})` unawaited and `update(joining)` before the awaited delete both pass.
**Why:** an immediately-resolving fake settles before the render flush; order is invisible.
**How to apply:** for any "before it shows/starts" claim, plant (a) unawaited+caught and (b) the side effect moved after the state update; ask for a hold
on the side effect (fake holdX/release) and an assertion that the screen is absent while held, present after release.
Related: [[m3t2-home-screen-audit]], [[disarm-faults]]
