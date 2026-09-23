// The first domain rule, and the shape every later one follows: given numbers,
// return a decision. No database, no network, no clock — so these run in
// milliseconds and time is something the test states rather than waits for.
//
// No requirement ID in these names, deliberately, and not an oversight —
// code-reviewer asked for one and the answer is no. What these tests cover is
// the server half of the monitoring requirement (the uptime rule in
// docs/plan/03-safety-reliability-security.md): making "the watchdog has
// stopped" visible to something that watches. The other half — something that
// polls this every minute and wakes the owner within five — is INF-08 and does
// not exist yet.
//
// The ID is left unwritten on purpose, and the reason is worth knowing, because
// the first version of this comment got it wrong. `coverage()` counts a test
// file as covering a requirement when the file's *text* mentions the ID, and
// text includes comments. So spelling it out here — even in a sentence saying
// this does not cover it — turned the report green for a requirement nothing
// satisfies. A comment denying the claim still made it. An ID is a claim about
// what is true, not a label for what a file is near.
import { describe, expect, test } from 'vitest';
import { assessWorkerHealth } from './health.ts';

const staleAfterMs = 60_000;

describe('assessWorkerHealth', () => {
  test('a worker that checked in a moment ago is healthy', () => {
    const health = assessWorkerHealth({ nowMs: 10_000, lastBeatMs: 9_000, staleAfterMs });

    expect(health).toEqual({ status: 'ok', silentForMs: 1_000 });
  });

  test('silence past the limit is degraded, because nothing is watching the journeys', () => {
    const health = assessWorkerHealth({ nowMs: 100_000, lastBeatMs: 30_000, staleAfterMs });

    expect(health).toEqual({ status: 'degraded', silentForMs: 70_000 });
  });

  test('exactly at the limit is still healthy, so the boundary is stated rather than guessed', () => {
    const health = assessWorkerHealth({ nowMs: 60_000, lastBeatMs: 0, staleAfterMs });

    expect(health).toEqual({ status: 'ok', silentForMs: 60_000 });
  });

  test('one millisecond past the limit is not', () => {
    expect(assessWorkerHealth({ nowMs: 60_001, lastBeatMs: 0, staleAfterMs }).status).toBe(
      'degraded',
    );
  });

  test('a worker that has never checked in is degraded, not unknown', () => {
    // A server that has just started has no beat yet. Reporting that as "ok"
    // would mean the monitor stays quiet exactly when the watchdog has never
    // run at all, which is the worst moment to be quiet.
    const health = assessWorkerHealth({ nowMs: 10_000, lastBeatMs: null, staleAfterMs });

    expect(health).toEqual({ status: 'degraded', silentForMs: null });
  });

  test('a beat from the future does not read as silence', () => {
    // Clocks disagree. A beat written by a worker whose clock ran ahead must
    // not produce a negative silence, which would sail under any threshold and
    // look healthy forever.
    const health = assessWorkerHealth({ nowMs: 10_000, lastBeatMs: 12_000, staleAfterMs });

    expect(health).toEqual({ status: 'ok', silentForMs: 0 });
  });
});
