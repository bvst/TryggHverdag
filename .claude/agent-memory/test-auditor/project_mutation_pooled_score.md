---
name: mutation-pooled-score
description: The mutation gate cannot promise that unkilled safety-core mutants fail loudly; its score is pooled per Stryker run and folder safety paths mutate only *.ts, so docs claiming "a red mutation" are wrong
metadata:
  type: project
---

As of INF-06 fa607f3 (2026-09-26):
- `stryker.config.mjs` turns a folder safety path into `${path}**/*.ts`. A `.tsx` file under
  `apps/mobile/src/safety-core/` is never mutated.
- `mutationRuns()` puts every safety path no MUTATION_GROUPS entry claims into one `whole-suite` run, and
  `thresholds.break: 80` applies to that run's pooled score. Today that run holds safety-core together with
  modules/alerts/, worker.ts, bin/worker.ts and process.ts. The app's jest tests are not in the vitest command, so
  safety-core mutants all survive, but they fail the run only if there are enough of them to pull the pooled score
  under 80 %. With 200 server mutants at 95 % killed, it takes about 38 survivors.
- `judgeMutationRun` passes any Stryker run that exits 0. Stryker with no files to mutate only warns and does a dry
  run.
INF-06's spec risk R16 and D-081 item 13 say that a safety-core change "would fail `mutation` loudly". That is not
guaranteed; it was graded Should fix, because safety-core does not exist yet.

**Why:** a gate that is believed to be loud but can stay green is the false green this project fears most. The first
task that adds safety-core code will lean on this belief.
**How to apply:** when a branch adds files under a safety path, check that the Stryker `mutate` globs match their
extensions. Check which run they fall into and whether that run's score could hide them. Before repeating this
finding, see whether safety-core now has its own group, a `{ts,tsx}` glob, or a jest command.
Related: [[safety-test-gate-gaps]], [[stryker-incremental-reuse]]

**Resolved by D-098 (BUG-12, 2026-10-02).** The gate judges every file from the run JSON report, and only Killed counts.
Every existing safety file has a group. The whole-suite run holds only the empty alerts/ and safety-core/ and is not
started while they are empty. A repository test (matching .ts and .tsx) fails the day either gets a file without a
group. The .ts-only mutate glob remains, so a safety-core .tsx will need a jest-expo group (docs/progress/m2.md).
