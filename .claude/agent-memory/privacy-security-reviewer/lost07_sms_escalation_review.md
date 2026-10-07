---
name: lost07-sms-escalation-review
description: LOST-07 (SMS escalation, the SMS check's second Healthchecks secret) — a task that makes a new state reachable reopens LOST-06's stranger-oracle gap; 26 planted-leak mutants; Terraform scratch with the real variables.tf; inventory/rotation/README misses; a broken runner reads as a kill
metadata:
  type: feedback
---

First seen on LOST-07 (2026-10-07, HEAD 0b8c3c0, base e695e8a). Verdict PASS, three should-fixes, notes otherwise.

**Why:** the code held every PRIV/SEC rule under probe, but the gaps were in what a NEW STATE does to old guarantees, and in docs that new secrets and new personal timings keep missing.

**How to apply:**
- **New reachable state = re-run the stranger check.** LOST-07 made ESCALATED real. Two module oracle mutants in modules/alerts/acknowledgement.ts (a non-responder to an ESCALATED alert gets 409 ALREADY_ACKNOWLEDGED, or the ALERT_RESOLVED answer plus a line) SURVIVED 171 L6 (acknowledgement, escalation, alerts system files) and 30 L3 tests. A scratch L6 test (walker, another walker, a responder of another journey vs an unknown ID; 404 and byte-identical text; no acknowledgement_ignored line; SMS unwithdrawn) passes on shipped code and kills both. Ask for it whenever a task adds a state an alert or journey can be in.
- **Equivalent mutants, explain before reporting.** "A refused acknowledgement withdraws the SMS" (fake A1, adapter A2 before the rule) survived L2/L6/L3, but is unobservable in M2: the module's pre-read refuses strangers before the store, and every refusal under the lock follows a step that already withdrew the SMS. Becomes observable with task 7 (responder removal). The AC7 property's invariants cannot see over-withdrawal.
- **New secret checklist (missed again):** docs/plan/08-cicd-releases.md inventory (name, store, the three places it lives) AND monitoring-setup.md "If the ping URL ever leaks" (named only the worker URL). The spec's own file table promised monitoring-setup.md and README; neither changed.
- **README "Open for M4": third miss** (LOST-01, LOST-03, LOST-07; LOST-06 got it right). Diff the spec's "Modules and files affected" against `git diff --stat`; promised doc files that did not change are the quickest find.
- **A runner line "exit=1 0s" with no Tests summary is a broken run, not a kill** (a doubled path in the L3 config arg). Count a kill only with a "N failed" summary.

**Recipes that ran (Linux session):**
- Copy: tar recipe minus .git, node_modules/.pnpm, mobile android/ios, reports, .turbo, spikes, coverage = 273 MB; symlink .pnpm. L3: copy of the stand-in config with root set to the copy.
- `pss-lost07/probe/alarm.mts` (tsx, args: copy root): healthchecksAlarm against refused, DNS, TLS-to-plain, 404/500/302, reset, timeout, abort, bad URL, user:pass, ftp, bad port, 5 hostile fetch stand-ins; plus setting reasons. 0 leaks.
- `pss-lost07/probe/log.mts`: 302 hostile writes over the six events. 0 leaks, exact keys.
- `pss-lost07/tools/mutate.cjs`: 26 planted leaks (sms-check, escalation, outbox, log, adapter, config, worker start line, workflow echo/top-level env, variable not sensitive): 25 killed; W2 equivalent (URL not in createTaskList's scope).
- Terraform 1.16.4 is cached under node_modules/.cache/terraform/1.16.4/<key>/terraform. Scratch dir with the real variables.tf plus a terraform_data resource; set TF_VAR_organisation too. Validation errors, plan and show print no value; show -json holds it. An errored plan still writes the -out file.
- psql on the PG16 stand-in: migrations 0000-0005, dump columns/constraints, apply 0006, diff.
- gh api: environments/staging, its deployment-branch-policies and secrets, and actions/secrets are all 403. The staging branch policy and the secret's existence stay unverifiable.

Related: [[lost06-acknowledgement-route-review]], [[lost03-home-route-review]], [[reviewer-sandbox-quirks]]
