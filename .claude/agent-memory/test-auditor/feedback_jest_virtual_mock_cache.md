---
name: jest-virtual-mock-cache
description: jest 29 per-worker resolver caches module IDs by (requiring file, name); a {virtual:true} mock of an INSTALLED package is skipped once another file in the worker loaded the real one from the same importer
metadata:
  type: feedback
---
jest-resolve resolver.js getModuleID: key = from + delimiter + moduleName; cached in _moduleIDCache on a Resolver that jest-runner's testWorker
keeps per config for the whole worker. _getVirtualMockPath returns the bare name only if this runtime's virtualMocks has it, else the real path.
So file A loading importer X unmocked caches (X, pkg) -> real path; file B's virtual mock is keyed by the bare name -> never matched -> real package runs.
Order-dependent, never alone (CALL-01 phone.test.tsx, a54f735: app.test.tsx then phone.test.tsx 13 failed; non-virtual 208 passed).
Reverse also breaks: virtual seeded first, then a NON-virtual mock in a later file is skipped. Relative-path virtual mocks are harmless (same absolute id).
**How to apply:** for any virtual mock of an installed package, list every importer of it and every test file reaching that importer; all must mock it
the same way. Reproduce with the sequencer FIRST=<files> trick (scratchpad/phoneloop/last-sequencer.cjs, puts phone.test.tsx last) and `-i`.
Related: [[m3t2-home-screen-audit]]
