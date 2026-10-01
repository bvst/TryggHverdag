---
name: results-doc-vs-evidence
description: How to check a generated results document (SPIKE-01's 04b-spike-results.md, 2026-10-01) against its generator and the run evidence — exact table diff, clock zones, provenance fields, usage lines
metadata:
  type: project
---

A results document says its tables are "pasted unchanged" from a generator. Check that by running the generator over the same inputs and comparing the `|` rows exactly. Use a python heredoc with `subprocess.run`; it writes no file. On 2026-10-01, all 72 rows of 04b were identical. The errors were in the prose around the tables:
- **Clock zones mixed.** "20:09–03:43 CEST" was a CEST start beside a UTC end; the real range was 20:09–05:43 CEST. A timestamp was given with no clock named, although it was the Mac's clock, the pcap's plus a 3603.8 s offset. Convert the manifest's `startedAt`/`at` values yourself.
- **Provenance flattened.** The re-judged `details.alignment.from` said "the driver's own reading … readAlignment could not read it", but the document wrote "aligned: true (`zipalign -c -P 16`)". Read the `from`, `captureScope` and `method` fields, and check that the prose keeps their hedges.
- **Usage lines.** Run each documented command's flag combination in your head against `parseArgs`. `--night X --manifest Y` silently dropped X.
- **"Ran at <commit>".** Check that the manifest or meta records the commit. If it does not, the claim comes from session notes. Compare the commit time with the run's start.

**Why:** the owner decides go/no-go from this document (CLAUDE.md: "say what you checked"). A matching table can sit beside prose that overclaims.

**How to apply:** for any `docs/plan/*results*.md`, (1) run the generator and diff it exactly; (2) grep the times and convert them; (3) for every verdict in the prose, find the field it comes from and its provenance; (4) for every "N packets / none found" claim, recount it if the guard allows. Related: [[spike-harness-invalid-vs-failed]], [[stale-prose-after-amendment]].
