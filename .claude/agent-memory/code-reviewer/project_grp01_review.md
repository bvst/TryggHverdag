---
name: grp01-review
description: GRP-01 (a5fd8cf) review patterns - orphaned JSDoc after extracting a helper, spec deviations not recorded, description pinned by test
metadata:
  type: project
---
- api.ts: extracting `fromDevice` left the old `fromKnownDevice` JSDoc as a detached block above the new one. After a refactor, look for two stacked JSDoc blocks.
- Spec deviations (plain fetch instead of @orpc/client + react-query) were not recorded in any decision; grep decisions.md for each flagged deviation.
- Contract parameter descriptions can go stale when only the error message is updated (responderIds still "an existing user" in journeys.ts and openapi.json; a test pins it).
- Mobile members-screen shows the "unreachable" text for any non-404 refusal (403/409).
- Good: authenticator is one query, closed-by-default middleware, removal in one tx reusing removeInside.
