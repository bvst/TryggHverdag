---
name: coinciding-times-l6
description: When an L6 harness lines several moments up on one boundary (opening, delivery, poll), plant a fault that swaps two of those times — tests cannot tell them apart
metadata:
  type: feedback
---

REL-10 audit (2026-10-10). The fake Wait advanced the clock in 10 s steps and ran the sweep and the push
sender on the same boundary the canary's 2 s read landed on, so "the answer's time" and "the alert's
opening" were always equal. A fault that reported the opening as the answer's time survived all 108
system tests, and would have let a late answer pass. Look for any two times a harness makes equal, swap
them in a fault, and ask for a test that holds them apart.
