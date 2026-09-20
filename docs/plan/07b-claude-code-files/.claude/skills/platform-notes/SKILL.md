---
name: platform-notes
description: "iOS and Android background location, notifications, permissions and manufacturer quirks. Use before changing safety-core or notification code."
---

# platform-notes

Read `docs/plan/04-tech-stack.md` (findings and SPIKE-01) and `docs/plan/03-safety-reliability-security.md` (findings 1–4). Key facts: iOS doesn't relaunch an app the user swiped away · Android needs a location foreground service plus manufacturer-specific battery guidance · Critical Alerts need Apple's entitlement and the user's opt-in · push delivery is best effort.
