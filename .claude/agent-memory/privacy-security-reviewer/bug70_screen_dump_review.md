---
name: bug70-screen-dump-review
description: BUG-70 PASS d88a877: L7 prints the failed screen via uiautomator dump as translation keys + resource-ids only; allowlist reader, adversarial-dump probe recipe, what can carry user text in a dump
metadata:
  type: feedback
---

Reviewed 2026-10-27, HEAD d88a877, base 67492e5. Verdict PASS, no blocking, no should-fix.

**Design that held:** scripts/lib/screen-dump.mjs prints only `package` and `resource-id` raw;
text/content-desc only as nb.json keys (exact match beats placeholder match) or
`other text (N characters)`; other packages: package + id only; refusals are fixed strings.
scripts/e2e-android.mjs screenNow: fixed adb argv via proc.mjs spawnSync (no shell), cat only
when uiautomator output says `dumped to: <path>`, rm -f after cat, dump/cat output never printed
(only exit codes). Allowlist design means a real-dump format drift fails CLOSED (fewer lines).

**What can carry user text in a dump (check on re-review):**
- resource-id = RN testID (react-native 0.86 sets viewIdResourceName). Only two testIDs in
  apps/mobile/src, both constants (call-button.tsx, emergency-bar.tsx). Grep
  `testID=` for a non-literal on every app change: a template testID with a name would leak.
- other packages' resource-ids: system apps are static; a WebView exposes HTML element ids.
- kxml escapes `"` `<` `>` `&` and \n\r\t in attributes, so text cannot spoof `resource-id=`.
- nb.json has no key whose value is only a placeholder (would match any text; harmless anyway).
- home-screen.tsx accessibilityLabel = spelledNumber(#1) -> printed as a length only.

**Probe recipe:** scratchpad probe.mjs importing readScreen by absolute path, nb.json parsed,
10 hostile node strings (single quotes in text, &quot; spoofed attrs, raw `<node` in a value,
codepoint > 0x10FFFF entity, spaces around `=`, other package with text). All gave key/length only.
Running the three test files: `pnpm exec vitest run scripts/lib/screen-dump.test.mjs
packages/test-kit/src/android-dumps.test.ts scripts/e2e-android.test.mjs` ~190 s, 121 pass.

**Notes given:** lengths of typed names/numbers printed (synthetic in CI; acceptable);
stale dump file left on the emulator when uiautomator does not confirm the write; adb maps any
adbd on localhost:5555-5585 to `emulator-NNNN`, so isEmulator (pre-existing) is a name check,
not proof; e2e-level PRIV-07 test checks numbers only (names covered at the reader's unit test).

Related: [[device-harness-review]], [[home-screen-grp02-review]], [[tooling-scripts-review]]
