---
name: promised-future-tests
description: Docs-only specs that promise later tests ("M3 will test X"); check each promise has a tracked ID or a decision to land on, because design-only promises fall outside RG-01
metadata:
  type: feedback
---

When a docs-only spec or plan guide promises tests for a later milestone, check each promise in three ways:
- **A carrier:** a tracked requirement (story, or REL, SEC, PRIV or SM row) or a binding decision whose spec will be
  written. RG-01 only asks for tests of tracked IDs. A promise that rests on design text (a finding, a Section 4
  default) is never asked for by any gate.
- **A pointer from the carrier:** something in the row or the decision that sends the later spec author to the
  promise. Otherwise it lives only in a `docs/plan/` guide nobody is directed to read.
- **No condition that defers it past its milestone:** for example, a list under "once approved" that also says
  "written in M3".
Also check that the test level named can hold an "only" or "never". An L5 or L7 test shows that setup asks; it does
not show that nothing else asks. That needs an L1 import rule or an exhaustive mapping.

**Why:** STORE-01 (ca72239, 2026-10-01) told Apple the push payload would carry no name, location or phone number
(C15). That rests on `04-tech-stack.md` finding 4 and D-086, not on a tracked row (PRIV-07 covers logs only), and
Part E's M3 test list left it out. Its "only lost-contact is critical" test also sat under "once approved", while
sending was due by M4 at the latest. Graded Should fix, not Blocking: STORE-01 adds no behaviour, and plan-keeper
can fix it at step 8 in docs/plan, where IDs are free to name.

**How to apply:** for every "tests written in Mx" bullet, name the ID or decision that will carry it, or say that
none does. Recommend that the decision recording the owner's answer quotes the test, because decisions are binding
and read every session. A spec naming tracked IDs only in words is correct, not evasion: in docs/specs a tracked ID
would mark that requirement 📝, "a spec, no test yet", although the spec is not its spec.
Related: [[entry-script-wiring]], [[gate-integrity-local]]
