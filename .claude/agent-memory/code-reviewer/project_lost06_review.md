---
name: lost06-review
description: LOST-06 review (2026-10-06) — the one-case switch lint rule, layered headers in the fake, grep tests before calling a guard dead, req:coverage without writing, and the open's withdrawal list being the resolution enum
metadata:
  type: project
---

- **Rule table instead of a one-case `switch`.** typescript-eslint 8.70's `no-unnecessary-condition` checks each `case` test against the discriminant (its `SwitchCase` visitor, `no-unnecessary-condition.js:694`), so a `switch` over a one-member union fails lint. Accept a table typed `satisfies Record<…>` with a throw for an unlisted event; ask for a `switch` with a `never` default once a second event exists.
- **Layered headers in the fake.** A task tends to add a new bullet to `fake-journey-store.ts`'s header instead of editing the old one, so two descriptions of one behaviour contradict each other. Diff the fake's header against the adapter's, which is usually edited in place.
- **Grep the tests before calling defensive code dead.** The fake's copied input guard in `recordAcknowledgement` looked unneeded, but `fake-journey-store.test.ts` pins it; removing it needs an RG-03 reason.
- **req:coverage without writing the file.** A `node --input-type=module - <<'EOF'` heredoc that imports `scripts/lib/requirements.mjs` and `trackedFiles` from `scripts/req-coverage.mjs` works; use `function`, not arrow functions, since the bash guard blocks `=>`. A running `gate:full`'s `coverage/coverage-summary.json` checks hand-added baseline entries.
- **The open's withdrawal list is the resolution enum (`ALERT_RESOLUTIONS`).** A stand-down kind that is not a resolution forces a separate domain list; the fake already calls it `WITHDRAWN_WHEN_OPENED`. Task 6 meets this.
