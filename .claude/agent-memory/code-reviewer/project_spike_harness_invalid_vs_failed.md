---
name: spike-harness-invalid-vs-failed
description: Review angle for scenario runners, drivers and judges (SPIKE-01, 2026-09-30 and loop 1 2026-10-01) — throws on the scenario's own failure turn FAILED into INVALID (D-060 hole); the inverse (failed sentinel set before harness steps); judges refusing before reading crashes; extra cases vs aggregators; capture facts
metadata:
  type: project
---

In SPIKE-01 (2026-09-30 review), `drivers/run-all.mjs` recorded every non-zero driver exit as "invalid" and re-ran it, up to two extra runs per case. Several drivers threw on the scenario's own failure condition:
- S3 waited for the "not exempt" report, which is exactly AC7's failure;
- S8 waited for the map to render, and ran zipalign through execFileSync;
- S5 on iOS waited for the pushed alert;
- the AC12 capture was read inside S1's judge, so a capture error made S1 invalid.

The judges had already been fixed so that a short run's final failure counts as failed (m1 log, 6b61e92). The runner opened the same hole one level up. S2's judge also let "short" override a failure it had already shown.

**Why:** D-060 is binding: a failed run is never re-run to replace it. Spec AC13 counts a run as invalid only when the harness broke. A runner that re-runs the scenario's own failures can replace a real failure with a later pass. It can also end with "case stopped / NO VERDICT" and never report FAILED.

**How to apply:** for every `waitFor` or `throw` in a driver, ask whether it fires when the harness broke or when the thing under test failed. The second kind must become data the judge reads, not an exit code. Check that every judge follows the same order of precedence: a failure already shown beats a short run.

**Residual shapes after the fix** (loop-1 re-review, 2026-10-01, HEAD 8a37a5e). B1 and B2 were fixed, but the same class came back in new places:
- **The inverse hole.** s5-ios set `received = null` (the "failed" sentinel) before `setUp()` and the first `simctl push`, either of which can throw. A harness break was then judged FAILED, and "a failure shown is final" kept it. Check where each outcome sentinel is assigned, compared with the harness steps that can throw before it.
- **A judge that refuses before reading the crash log.** In S8, a missing or stale `zoom-N.json`, or `meta.shots` of `[]` after a throw, made the judge throw, so the run was invalid. A native crash, which is S8's own criterion, was lost. Failure evidence (crashes, the process gone) must be read before any refusal.
- **`withBreaks`.** For S5, S6 and S8 (and S2 by its own rule), any break in the window turns FAILED into invalid. This does not follow the overlap rule that S1 and S3 use.
- **Extra cases and aggregators.** An extra `--case` added later (s1/android/exempt) must be checked against every aggregator. `goNoGoInput`'s `per('s1')` has no case filter, and summarize groups by scenario and platform only.

For a loop re-review, the original findings were not on GitHub (no PR was open). They are in the main session's `morning-checklist.md`. A subagent shares the main session's scratchpad path (`/private/tmp/claude-503/-Users-claude-dev-code-TryggHverdag/<session>/scratchpad/`), so read it there first. Its "Loop-1 re-reviews" section lists SF1–SF8 and notes a–d. No note e or f is recorded there.

**Loop-2 residuals** (2026-10-01, HEAD 6ae585f, advisory PASS):
- Aggregators that read several manifests (`summarize`, `results-tables`) flatMap them with no check for duplicate runIds. The same night given twice double-counts its runs, so "two valid runs" can be met by one run. `judgeScenario` does not refuse duplicate ids. Whenever an input becomes a list, check for duplicates.
- `summarize` ignores `--night` silently when `--manifest` is also given.
- `goNoGoInput` drops runs whose case is not in `expected`. A failed run of an unplanned case would vanish.
- `rejudge` keeps the earlier re-judge under the *new* run's timestamp, not its own.
- S5 Android `withBreaks(..., { timed: true })` keeps a failure beside any timed break, with no overlap check.

**Emulator capture facts** (dry-s1-android-20260930T163720Z):
- The Pixel_8 emulator also has IPv6: fec0::5054:ff:fe12:3456, with fec0::2 as its gateway. A judge keyed on 10.0.2.15 silently dropped 9 of 27 destinations.
- `-tcpdump` stays on for every later run on that emulator, because run-all never stops it after a capture slot. Re-judging a pcap must cut it to the run's window.
- `tcpdump -nn -r` works on the dry-run pcaps from the reviewer's Bash.
- The night's pcap clock ran 3603.8 s behind the Mac's. The capture reader still drops packets whose source is not a listed device address without saying so. Counting those packets was blocked by the guard on 2026-10-01 and is still unverified.
- In the night's S5 Android alert record (notification.txt), the app's notification had no `category=` and its effective usage was USAGE_NOTIFICATION, while the channel was set to USAGE_ALARM. Resolved in loop 2: AOSP's `restrict_audio_attributes_alarm` flag means the cause is our own configuration.
- Counted on 2026-10-01 from the reviewer's Bash. S1#1's window holds 5,820 packets. 26 of them have neither end a listed device address; for exempt-1 it is 21. All of them are ICMPv6 neighbour/router discovery or MLD (fe80::, ff02::, and the fec0::2 gateway), with no TCP or UDP. So "none dropped" holds for traffic, but not literally.
- The Firebase Installations session: DNS at 17:49:19.05 on the pcap's clock, which is 18:49:22.8Z on the Mac's. SYN from :34468 to 172.217.112.4:443, 2,649 B out and 5,846 B in. 172.217.112.4 also carries QUIC for the whole run, so only the SNI ties the session to Firebase.
- In both exempt runs, `meta.deviceAddresses` is `[]`. The judge silently falls back to the EMULATOR defaults.
- In both S8 Android runs, the alignment comes from `meta.aligned16k`, the driver's own reading, because no exit code was saved. The results document presented it as a zipalign result.
- The runner records no harness commit. "Ran at" claims come from session notes. night-20260930 started 21 s before e9753cc (docs only) was committed.

Related: [[spawned-process-tests]], [[doctor-false-green]], [[stale-prose-after-amendment]].
