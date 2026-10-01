---
name: owner-docs-for-external-forms
description: Review angle for docs-only deliverables the owner pastes into an outside form (STORE-01's critical-alerts-request.md, 2026-10-01) — paste hygiene, length stop-rule, numbered cross-refs, paraphrase vs quoted source, "Built in" milestones vs the roadmap
metadata:
  type: project
---

STORE-01 (2026-10-01, advisory PASS) delivered `docs/plan/critical-alerts-request.md`: a text for Apple's Critical Alerts form (Part A), a claims-and-sources table (Part B), and the owner's steps. Code rules (AR-03, AR-10) do not apply. These were the findings that mattered:
- **Paste hygiene.** Part A used `**` headings and lines hard-wrapped at about 78 columns. Copied from the raw file, both come along. Ask for one line saying "copy from the rendered GitHub page". A fenced code block is worse, because it keeps the hard wraps.
- **Unknown field limits with no stop rule.** The text says "short because limits are unknown", but nothing says what to do when a field is too short. Ask for "stop and tell Claude; don't shorten it in the form". Otherwise cutting silently changes the claims.
- **Numbered cross-refs inside the pasted text** ("in answer 2", "this alert" before the alert is introduced) break once the answers are spread over separate form fields.
- **A paraphrase adds to the source.** "Apple's guidelines describe the Critical level as *the one that* can override…" adds an exclusivity that the quoted sentence does not have. Meanwhile Part B claimed it "goes no further than Apple's own sentence". Check each "X says" paraphrase against the quote, word for word.
- **"Built in" milestone columns.** Check them against `10-roadmap.md`'s rows: M2 has *fake* push, real APNs and FCM come in M3 (A-11), every PRIV ID is tested in M4, and L9 runs in M5. A blanket "M3 or M4" marker (from the spec's AC10) was wrong for L9 and depends on when Apple approves.
- **"Kept out of the public repo" vs a value derived from it.** The bundle identifier is "the AS's domain, reversed". Recording it with `/decision` puts the AS's domain in the public repo, while the same guide says the AS's details never go there. The repo is public (api.github.com `visibility: public` on 2026-10-01; D-029's "private" is stale, and m1.md item (e) tracks it).

**How to apply:** for any `docs/plan/*` guide that feeds an outside form:
1. Check where to copy from, and the stop rules (missing answer, field too short).
2. Diff the quoted source blocks against the spec. A plain `diff <(sed -n …) <(sed -n …)` passes the guard.
3. Re-check each paraphrase of a quote.
4. Check the milestone columns against the roadmap's rows.
5. Grep for values derived from "secret" details.

`req:coverage` regenerates `docs/requirements-status.md`, so don't run it as the read-only reviewer. Grep the spec for tracked ID patterns instead. Related: [[stale-prose-after-amendment]], [[spec-promises-vs-head]], [[gate-file-silent-success]].
