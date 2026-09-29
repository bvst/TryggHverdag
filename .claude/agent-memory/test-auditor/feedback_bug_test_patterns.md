---
name: bug-test-patterns
description: Recurring test gaps in BUG-<n> fixes — the happy path and the reported symptom are pinned, but the "could not tell" fallback branches are not
metadata:
  type: feedback
---

In BUG-4 (doctor.mjs), all 14 reproduction tests killed their fix's revert. The in-memory mutants that survived
were all "could not determine" branches:
- SSH gave no `Hi <acct>!` greeting
- gh account unreadable
- origin owner unreadable
- case-insensitive login comparison
- the probe's error text being quoted

Removing those branches made the doctor crash (TypeError on null), not report green, so they were Should fix, not
Blocking.

**Why:** in this project a false green is the worst outcome (CLAUDE.md: fail loudly). "Unknown" branches are
exactly where one appears.
**How to apply:** in any check or verify-style code, mutate the unknown or fallback branches first. Say whether a
survivor turns into a false green (Blocking) or a loud crash (Should fix). Real adapters (`realSystem.exec`,
ENOENT → found:false) sit behind the fake seam and go untested; mention it as a note.
Bug tests are named `BUG-<n>: …` (.claude/skills/bugfix/SKILL.md). req:coverage does not track them, because they
are not spec IDs.

Cleanup safety nets in tests, such as BUG-5's `onTestFinished` SIGKILL of a child: they are fine when every test
awaits the child's end and asserts on its code and signal before finishing. Then the hook can act only after a
failure or a timeout. Prove it with a timeout mutant (the test must still fail) and a control with the hook disabled
(an orphan must appear). A remaining gap worth a note: a child that ignores SIGTERM still fails only as a bare "Test
timed out", with nothing saying the worker would not stop.

Related: [[in-memory-mutation]]

**Regex "whole line" claims (BUG-8 install fix, PR #43, 2026-09-29).** The commit, the spec and the decision all said
"the match is the whole line". The near-miss rows (a package refusal, another exception class, a Failure line) were
killed by other parts of the regex, the class name and the word "session", never by the anchors. Dropping `^`, `$`,
`\r?`, or widening `\d+` to `.*` all survived. Mutate each anchor on its own. The missing rows are the same text with
a prefix or a suffix on the line, a non-numeric id, and a CRLF copy. The grade depends on the direction: over-matching
a not-ready signature only delays a loud failure (the pass needs a Success line), so it was Should fix.
