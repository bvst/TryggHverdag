---
name: spike-harness-invalid-vs-failed
description: Review angle for scenario runners and drivers (SPIKE-01 run-all.mjs, 2026-09-30) — a driver that throws on the scenario's own failure turns FAILED into INVALID and gets re-run (D-060 hole); emulator captures miss IPv6
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

**Emulator capture facts** (dry-s1-android-20260930T163720Z):
- The Pixel_8 emulator also has IPv6: fec0::5054:ff:fe12:3456, with fec0::2 as its gateway. A judge keyed on 10.0.2.15 silently dropped 9 of 27 destinations.
- `-tcpdump` stays on for every later run on that emulator, because run-all never stops it after a capture slot. Re-judging a pcap must cut it to the run's window.
- `tcpdump -nn -r` works on the dry-run pcaps from the reviewer's Bash.

Related: [[spawned-process-tests]], [[doctor-false-green]], [[stale-prose-after-amendment]].
