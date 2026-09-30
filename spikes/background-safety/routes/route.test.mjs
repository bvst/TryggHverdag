// SPIKE-01: the route generator (routes/route.mjs).
//
// Every route is synthetic: made-up waypoints and a fixed seed, never a
// recorded track. The tests read the route only to measure it; they print no
// coordinate.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

const MODULE = new URL('./route.mjs', import.meta.url);
/** Imported per call, so that each test reports a missing module on its own. */
const buildRoute = async (options) => (await import(MODULE.href)).buildRoute(options);

const SEED = 7;
const S = 1_000;
const MIN = 60 * S;
const EARTH_RADIUS_M = 6_371_000;
/** Slower than this (m/s) is standing still. */
const STANDING = 0.2;
/** Walking pace, in m/s. */
const WALKING = { slowest: 0.8, fastest: 2.0 };

/** Great-circle distance in metres. */
function metres(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Each stretch between two consecutive points: when it starts, how long, how fast. */
function stretches(points) {
  return points.slice(1).map((point, i) => {
    const ms = point.t - points[i].t;
    return { from: points[i].t, ms, speed: metres(points[i], point) / (ms / S) };
  });
}

/** Runs of standing still, each with its start and length. */
function stops(points) {
  const found = [];
  let current = null;
  for (const stretch of stretches(points)) {
    if (stretch.speed >= STANDING) {
      current = null;
      continue;
    }
    if (current === null) {
      current = { from: stretch.from, ms: 0 };
      found.push(current);
    }
    current.ms += stretch.ms;
  }
  return found;
}

test('SPIKE-01-AC4: the same seed gives the same route, in this process and in a fresh one', async () => {
  const first = await buildRoute({ seed: SEED });
  assert.deepEqual(await buildRoute({ seed: SEED }), first);

  const code =
    `const { buildRoute } = await import(${JSON.stringify(MODULE.href)});` +
    `process.stdout.write(JSON.stringify(buildRoute({ seed: ${SEED} })));`;
  const fresh = execFileSync(process.execPath, ['--input-type=module', '--eval', code], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.deepEqual(
    JSON.parse(fresh),
    JSON.parse(JSON.stringify(first)),
    'another run gave another route: the route depends on something besides its seed',
  );
});

test('SPIKE-01-AC4: a different seed gives a different route', async () => {
  const one = await buildRoute({ seed: SEED });
  const other = await buildRoute({ seed: SEED + 1 });
  assert.notDeepEqual(other.points, one.points, 'the seed is ignored');
});

test('SPIKE-01-AC4: the route lasts 45 minutes, starting at 0, in time order', async () => {
  const { points } = await buildRoute({ seed: SEED });
  assert.ok(points.length >= 2, 'a route needs at least two points');
  assert.equal(points[0].t, 0);
  assert.equal(points.at(-1).t, 45 * MIN);
  points.forEach((point, i) => {
    assert.ok(
      Number.isFinite(point.lat) && Number.isFinite(point.lon),
      `point ${i} has no position`,
    );
    if (i > 0) assert.ok(point.t > points[i - 1].t, `point ${i} is not later than the one before`);
  });
});

test('SPIKE-01-AC4: every stretch is either standing still or walking pace, and most of it is walking', async () => {
  const { points } = await buildRoute({ seed: SEED });
  const all = stretches(points);
  const neither = all.filter(
    (stretch) =>
      stretch.speed >= STANDING &&
      (stretch.speed < WALKING.slowest || stretch.speed > WALKING.fastest),
  );
  assert.deepEqual(
    neither.map(({ from, speed }) => ({ from, speed: Math.round(speed * 100) / 100 })),
    [],
    `every stretch must be under ${STANDING} m/s or between ${WALKING.slowest} and ${WALKING.fastest} m/s`,
  );
  const walkingMs = all
    .filter((stretch) => stretch.speed >= STANDING)
    .reduce((sum, stretch) => sum + stretch.ms, 0);
  assert.ok(walkingMs >= 30 * MIN, `walks for only ${walkingMs / MIN} of 45 minutes`);
});

test('SPIKE-01-AC4: the route includes a stop of 5 minutes or more', async () => {
  const { points } = await buildRoute({ seed: SEED });
  const longest = Math.max(0, ...stops(points).map((stop) => stop.ms));
  assert.ok(longest >= 5 * MIN, `the longest stop is ${longest / S} s`);
});

test('SPIKE-01-AC4: every point is made up: open sea within 1° of 0° N 0° E, where nobody lives or walks', async () => {
  const { points } = await buildRoute({ seed: SEED });
  points.forEach((point, i) => {
    assert.ok(
      Math.abs(point.lat) <= 1 && Math.abs(point.lon) <= 1,
      `point ${i} is outside the made-up area`,
    );
    assert.ok(
      !(point.lat === 0 && point.lon === 0),
      `point ${i} is exactly 0, 0, which some location code reads as "no fix"`,
    );
  });
});
