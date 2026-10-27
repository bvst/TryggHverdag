---
name: bug70-audit
description: BUG-70 (screen dump on a failed Maestro run, d88a877) audit — reader and entry-script mutants, stale requirements report, label-path decode-twice survivor
metadata:
  type: project
---

2026-10-27 cloud, branch claude/busy-faraday-40n2zl at d88a877 (unpushed, no PR, check-runs 422; NODE_USE_ENV_PROXY=1
gate:integrity 5 of 5, 13 required incl. mutation/traceability).
- **Stale docs/requirements-status.md at HEAD**: req:coverage moves CALL-02 18→19 and PRIV-07 17→18; ci.yml:317 fails
  traceability on `git diff --exit-code` of it. CALL-02's +1 is only a comment in screen-dump.test.mjs ("(CALL-02)").
  Restoring the file with node writeFileSync(git show HEAD:…) was refused by the auto-mode classifier this time: report it.
- Reader mutants (33, in-process Vite transform, scratchpad/ta-bug70u): survivors decode-twice on the LABEL path (the
  "decoded once" test covers text only), the placeholder pattern's `$` anchor (only exact values tested with trailing
  text), codepoint limit, naive <node> regex (kxml escapes `>`, so moot), non-string skip (nb.json all strings), `s` flag.
- Entry mutants via a loader hook injected into the spawn at e2e-android.test.mjs `'--import', pathToFileURL(observer).href,
  SCRIPT` (scratchpad/ta-bug70; hooks read mutant.json, so never run two harnesses sharing that dir at once). ~1 min per
  mutant while a gate:full ran.
- Overlap trap: the dump path `trygghverdag-window.xml` contains `\bwindow\b`, which the CALL-01 "evidence cannot be read"
  test filters for with UNREAD; a screen-unread line would satisfy it if both were ever unread together.
Related: [[entry-script-wiring]], [[gate-integrity-local]], [[in-memory-mutation]]
Entry results (22 mutants): killed stale-file read, rm-before-cat, no rm, dump on passing run, no print, screen after
crashes, heading-only to stderr, cat output leaked (lines or unread), wrong who/app/serial, rethrow. Survived, all benign:
whole block or unread line on stderr (`output` is stdout+stderr concatenated), dumped-to check without path, dump.output
in the unread line, no cat.ok check (readScreen refuses cat's error anyway).
Harness trap: multi-pair mutants apply in order with `replace` of the FIRST match, so "insert P earlier, then delete P"
deletes the inserted copy (a no-op that reads SURVIVED). Delete first, then insert. Verdict PASS.
