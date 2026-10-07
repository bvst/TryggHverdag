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

**Loop 1 re-check (2026-10-07, 0b8c3c0..4d7f188): PASS, all three should-fixes met.**
- X1/X2 (oracle.cjs) re-run on the escalation files ONLY: each "1 failed | 69 passed (70)" at L6 and "1 failed | 16 passed (17)" at L3, both by the new LOST-07-AC6 stranger test. Running only the file that holds the new test proves the new test is the killer.
- Small copy that works (3.7 MB, not 273 MB): root-level `git ls-files` files + `tar` of apps/server and packages (minus apps/server/node_modules/.vite and coverage) + a symlink to the repo's root node_modules. The apps/server/node_modules workspace links are relative, so they resolve into the copy's packages. L6, L3, tsx bin/migrate.ts and tsx bin/worker.ts all ran from it.
- End-to-end start-line probe: createdb on the stand-in, tsx bin/migrate.ts, then tsx bin/worker.ts with the two ping variables and `timeout -s TERM 9`. Keep the secret in a shell variable, `grep -c` for it BEFORE masking, and point every ping at https://127.0.0.1:1 so nothing leaves the machine. An 85 s background run reaches the check-in failure line and `sms_check_failed`.
- Probe hygiene lessons: (1) real-fetch cases with an hc-ping.com host DID go out (an answer of 403, probably the agent proxy); use 127.0.0.1:1 hosts for those. (2) `http://%<uuid>` percent-decodes, so a recording fetch printed an unmasked chunk of the probe secret. Mask after normalisation, or print counts only.
- Terraform scratch: `organisation` must match `^orga_[0-9a-f-]{36}$` (use orga_00000000-0000-4000-8000-000000000000), or every plan fails on it first and hides the validations under test (cost one run). Validation errors for the sensitive URLs print no value and no "is (sensitive value)" lines; a cross-variable `!=` works in 1.16.
- Notes left for safety: config.ts and Terraform both take a URL ending in "/ " (trailing space), one ending in a backslash, and an upper-case or slug form of the same check, which gets past both `!=` checks.
- config.ts is still unowned (D-079 says it is not a safety path); it now carries the refusal reasons for both secrets. Noted only, as the owner's decision.
- A parallel reviewer's vitest JSON reporter left an untracked `.vitest/` in the repo root. Check its time and files before attributing; never delete another agent's output.

**Loop 2 re-check (2026-10-07, 4d7f188..e9f1687): PASS, nothing to fix.** Loop 2 took ping URLs only as `url.href === value` with path "/" and a lower-case UUID (config.ts), compared the two settings by pathname in the worker, pinned Terraform to `https://hc-ping.com/<lower-case uuid>`, and added test-kit `syntheticPingUrl(uuid)` (127.0.0.1:1).
- Config leak probe (tsx scratch .mts, absolute import of config.ts, which has no imports): 49 hostile spellings x 2 variables (whitespace in and around the value, NBSP/ZWSP, backslashes, upper case, %-encoded, slug, userinfo, host in UUID, IDN/fullwidth host, dot segments, ports, IPv6/hex IPv4) gave 82 refusals and 0 leaks. Checked raw, lower-cased and decodeURIComponent forms through JSON.stringify and inspect. Distinct reasons: 6, each naming only the variable.
- Config still takes any https: host by design (INF-08): userinfo, trailing-dot host, other port and IPv6 are accepted with href === value. Terraform pins hc-ping.com for staging, and the worker's pathname compare makes host spelling irrelevant to the one-check rule. Not a finding.
- **Start lines need no Postgres:** runWorkerProcess writes the Healthchecks/SMS-check lines BEFORE startWorker. Run src/bin/worker.ts with tsx from apps/server, a synthetic DATABASE_URL at 127.0.0.1:1, the ping URLs on 127.0.0.1:1 or localhost:1, and `timeout -s TERM 25`. It ends "worker failed: Error: connect ECONNREFUSED 127.0.0.1:1", exit 1, in seconds. Four cases (same UUID on two hosts, same UUID plus user:pass, upper-case SMS UUID, different UUIDs) gave 0 counts for UUID, user, pass, localhost and the loopback path.
- **Terraform reports only ONE variable error per plan:** with both URLs invalid, only the worker variable's message (line 11) printed. To exercise the SMS variable's message, give the worker a valid value. 9 plans: 0 values, the `!=` message is clean, and show masks the values ("sensitive value" x2). RE2's `$` refused a trailing newline, as infra.test.mjs's JS-RegExp `takes` simulation assumes.
- Loop 1's Notes (trailing space, backslash, upper-case or slug form getting past `!=`) are now closed in both config.ts and Terraform.
- RG-07 scan of added lines: the only literal UUID was the all-zero one in this memory file. Tests mint UUIDs and ping keys fresh (syntheticUuid, syntheticCredential); "staging-worker" is a slug, which is not a secret without the ping key.
- Running 3 small vitest files from the root wrote no `.vitest/`.
