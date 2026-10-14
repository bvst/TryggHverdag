---
name: load-proof-floors
description: When a flaky timing test trades a tight real deadline or a count for a load-proof floor, the old tight bound was often the only CEILING on an interval; plant interval-length faults against old and new files
metadata:
  type: feedback
---
BUG-21 (2026-10-14): replacing `installs > 2` and a 1 s deadline (raised to 20 s in the passing sibling) with
"waited >= deadline by the script's clock" kept every floor and killed more, but dropped the only upper bound on the
retry interval: "env interval ignored" and "interval x4" were killed by main's file and survive the new one.
**Why:** the author plants faults that shorten or stop a wait; nobody plants "waits too long between asks".
**How to apply:** for any deadline/count relaxation, plant interval x2/x4, env-interval ignored, and interval=deadline,
run them against BOTH files. A load-proof ceiling exists: record the sleeps themselves in the preload
(patch `timers/promises`.setTimeout, then `syncBuiltinESMExports()`), assert each equals the configured interval.
Related: [[bug21-audit]], [[isolating-values]]
