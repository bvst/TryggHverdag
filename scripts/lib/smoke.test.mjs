// The staging smoke test (INF-07): after a deploy, is the system actually
// working — not just answering?
//
// "status: ok" is not enough on its own. The worker's last beat stays fresh for
// three minutes, so right after a deploy the API reports ok on the strength of
// a heartbeat from the worker that was just stopped. What proves the new worker
// runs is a beat *after* the deploy — and, since the old instance may outlive
// the deploy by a little, a beat more than LINGER_MS after it.
import { describe, expect, test } from 'vitest';
import { healthResponseSchema } from '../../packages/contracts/src/health.ts';
import { LINGER_MS, smokeTest } from './smoke.mjs';

const URL = 'https://staging.example.invalid';

/** The first answer after a deploy, and a beat comfortably after it. */
const DEPLOY = '2026-09-24T21:00:00.000Z';
const BEAT = '2026-09-24T21:02:00.000Z';

/** A health answer, as /v1/health gives it. */
function health(status, checkedAt, lastBeatAt) {
  return {
    status: 200,
    body: {
      status,
      checkedAt,
      worker: { lastBeatAt, silentForMs: lastBeatAt === null ? null : 0 },
    },
  };
}

/** Runs the smoke test against a scripted series of answers; an Error in the list is a failed request. */
async function against(answers, attempts = answers.length) {
  const asked = [];
  const log = [];
  let next = 0;
  const result = await smokeTest({
    url: URL,
    attempts,
    intervalMs: 0,
    sleep: () => Promise.resolve(),
    log: (line) => log.push(line),
    fetchHealth: (url) => {
      asked.push(url);
      const answer = answers[Math.min(next, answers.length - 1)];
      next += 1;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  });
  return { ...result, asked, log };
}

describe('smokeTest', () => {
  test('asks the health endpoint of the given address', async () => {
    const { asked } = await against([health('ok', '2026-09-24T21:00:00Z', '2026-09-24T21:00:30Z')]);

    expect(asked[0]).toBe(`${URL}/v1/health`);
  });

  test('its fixtures are real health responses, so a renamed field breaks here first', () => {
    // The smoke test reads /v1/health's shape by hand (asHealth). Checking the
    // fixtures against the contract means a change to the contract fails this
    // file, rather than the first deploy after it merges.
    expect(healthResponseSchema.safeParse(health('ok', DEPLOY, BEAT).body).success).toBe(true);
    expect(healthResponseSchema.safeParse(health('degraded', DEPLOY, null).body).success).toBe(
      true,
    );
  });

  test('passes once the worker has beaten well after the deploy', async () => {
    const result = await against([
      health('ok', DEPLOY, '2026-09-24T20:59:10Z'),
      health('ok', '2026-09-24T21:02:05Z', BEAT),
    ]);

    expect(result.ok).toBe(true);
    expect(result.reason).toContain(BEAT);
  });

  test('a beat within LINGER_MS of the deploy is not enough — the old instance may have made it', async () => {
    // safety-reviewer on INF-07: if the old instance outlives the deploy past a
    // minute boundary, its beat lands after the first answer.
    expect(LINGER_MS).toBe(90_000);
    const result = await against([
      health('ok', DEPLOY, '2026-09-24T20:59:10Z'),
      health('ok', '2026-09-24T21:01:05Z', '2026-09-24T21:01:00Z'),
    ]);

    expect(result.ok).toBe(false);
  });

  test('a recent beat does not pass while the API says degraded', async () => {
    const result = await against([
      health('degraded', DEPLOY, null),
      health('degraded', '2026-09-24T21:02:05Z', BEAT),
    ]);

    expect(result.ok).toBe(false);
  });

  test('fails when the only beat is from before the deploy, even though the API says ok', async () => {
    // The case this test exists for: the old worker's beat is still inside the
    // three minutes, so status is ok — and the new worker has never started.
    const result = await against([
      health('ok', '2026-09-24T21:00:00Z', '2026-09-24T20:59:10Z'),
      health('ok', '2026-09-24T21:01:00Z', '2026-09-24T20:59:10Z'),
      health('ok', '2026-09-24T21:02:00Z', '2026-09-24T20:59:10Z'),
    ]);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not checked in since the deploy/);
  });

  test('fails when the worker has never beaten at all', async () => {
    const result = await against([
      health('degraded', '2026-09-24T21:00:00Z', null),
      health('degraded', '2026-09-24T21:01:00Z', null),
    ]);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('never');
  });

  test('waits through a starting API — refused connections and errors — then passes', async () => {
    const result = await against([
      new Error('connect ECONNREFUSED'),
      { status: 503, body: null },
      health('degraded', DEPLOY, null),
      health('ok', '2026-09-24T21:02:05Z', BEAT),
    ]);

    expect(result.ok).toBe(true);
  });

  test('says what it last saw when the API never answers', async () => {
    const result = await against([new Error('getaddrinfo ENOTFOUND')], 3);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('ENOTFOUND');
  });

  test('stops at once when the answer is not a health response at all', async () => {
    // A 200 with some other body means the address points at something that is
    // not this API — a default page, another app. Waiting would not fix it.
    const result = await against(
      [
        { status: 200, body: '<html>Welcome</html>' },
        health('ok', '2026-09-24T21:00:00Z', '2026-09-24T21:00:30Z'),
      ],
      5,
    );

    expect(result.ok).toBe(false);
    expect(result.asked).toHaveLength(1);
    expect(result.reason).toMatch(/not a health response/);
  });

  test('gives up after the number of attempts it was given', async () => {
    const result = await against([new Error('connect ECONNREFUSED')], 4);

    expect(result.asked).toHaveLength(4);
  });

  test('reports its progress, so a slow deploy is visibly waiting rather than hung', async () => {
    const { log } = await against([
      health('degraded', DEPLOY, null),
      health('ok', '2026-09-24T21:02:05Z', BEAT),
    ]);

    expect(log.length).toBeGreaterThan(0);
  });
});
