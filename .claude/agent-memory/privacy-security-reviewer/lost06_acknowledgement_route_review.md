---
name: lost06-acknowledgement-route-review
description: LOST-06 ("I'm on it" route) — a "one 404 for not-found and not-yours" route needs an end-to-end test of strangers against EVERY alert state, not only the domain table; module-level oracle mutants survived L6 and L3; probe and mutant recipes that ran in about 1 min
metadata:
  type: feedback
---

First seen on LOST-06 (2026-10-06, HEAD 05f054a, base 57502b8). Verdict PASS, one should-fix (test gap), notes only otherwise.

**Why:** the domain rule (alertTransition) puts "not a responder" before "resolved" and "taken", and its AC14 table pins every (state x sender) pair. But the module reads first and could answer from the read before asking the rule. A pre-check inserted in modules/alerts/acknowledgement.ts (`if (alert?.state === 'RESOLVED') return answer(ignored)`, or a "taken" pre-check) SURVIVED all 100 L6 tests (acknowledgement + alerts system files) and all 13 L3 tests: every L6/L3 stranger case is on an OPEN alert. With it, the walker, another walker and a responder of another journey get 409 ALERT_RESOLVED plus an acknowledgement_ignored line: an existence-and-state oracle (spec reading 5 forbids it). Code as shipped is correct (probe).

**How to apply:** for every route whose not-found answer also covers "you do not follow it" (JOURNEY_NOT_FOUND, ALERT_NOT_FOUND, task 7's "They're safe", M3's read routes), check that an end-to-end test (L6, ideally L3 through the API) sends strangers against each state the resource can be in (open, acknowledged, resolved/ended), compares the body and headers byte-for-byte with an unknown ID's, and asserts no line. The domain table alone does not guard the module layer, and Stryker never inserts code, so mutation score will not show this.

**Probe that worked (about 1 s):** `pss-lost06/probe/enum.mts` in the scratchpad: absolute imports of api.ts, log.ts, the acknowledgement, journey and health services and packages/test-kit/src/index.ts; run from apps/server with `./node_modules/.bin/tsx`. createLog({ write }) captures production lines; stdout/stderr/console replaced to catch everything. store.seed(LOST_CONTACT) + store.seedAlert(OPEN) set up alerts without the watchdog. 41 cases: 13 ALERT_NOT_FOUND answers byte-identical with headers, strangers 404 on OPEN, ACKNOWLEDGED and RESOLVED, body cannot override the path (strict body 400), query ignored, `%61` percent-encoding decodes to the same alert (harmless), `%0A` suffix is Hono's 404, no credential gives 401 before validation, store failures with markers give fixed 500s and a SQLSTATE-only line. To probe a mutant, `sed` the absolute paths to the scratch copy.

**Mutant runners (copy recipe from lost_contact_alert_review, about 280 MB):** `pss-lost06/tools/mutate.cjs` (12 planted leaks in acknowledgement.ts, the api.ts handler and encoder, and log.ts; all killed by AC11/AC16 L6 and log.test.ts AC16), `access.cjs` (6: rule order, dropped responder check, adapter join over every journey, notices to every journey or to the acknowledger; all killed, adapter ones only at L3), `oracle.cjs` (2 module pre-checks; both SURVIVED). L3 against the copy: a copy of the stand-in vitest config with `root` set to the copy (`pss-lost06/vitest.copy-l3.config.mjs`).

**Other facts confirmed:** no package.json/lockfile change; migration 0005 applied with every migration in one transaction on the PG16 stand-in (psql), additive, FK to users ON DELETE no action, both-or-neither check; the README "Open for M4" retention note was in the spec commit (first time without a should-fix); alert IDs are defaultRandom (v4) so any oracle needs a known ID; server code has no request logger, onError, interceptor or console call (grep). Ownership: same as LOST-03 (ports.ts and packages/contracts/src/* unowned, D-094).

Related: [[lost03-home-route-review]], [[lost-contact-alert-review]], [[reviewer-sandbox-quirks]]
