---
name: script-change-dilutes-count
description: A production change that adds calls matching an unchanged test's call filter (isLocaleRead) silently loosens that test's count assertion; tests:changes cannot see it since the test text is unchanged
metadata:
  type: feedback
---
BUG-17 (2026-10-22): the fix added getprop persist.sys.locale per reading and a setprop persist.sys.locale, and an unchanged
AC9 test asserts calls.filter(isLocaleRead).length > 3 where isLocaleRead matches any "locale" call. The count now reaches 4
after 2 readings, so the test no longer proves "read past the three answers".
**Why:** RG-03 review reads the test diff; a weakening caused by the production diff has no test diff to read.
**How to apply:** for every new call the fix makes to a stand-in, grep the test file's call filters (is*Read, is*Call regexes)
for ones the new call also matches; plant "stop early" faults and run the affected unchanged test alone (vitest -t) against
HEAD's and main's script.
Related: [[bug17-audit]], [[entry-script-wiring]]
