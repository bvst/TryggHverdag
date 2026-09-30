// SPIKE-01-AC4: the synthetic route. Made-up waypoints in open sea near
// 0° N 0° E, where nobody lives or walks, and a seeded generator: the same seed
// gives the same route on every run and on both platforms. No recorded track is
// used. Pure: no clock and no global random numbers.

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
/** One point every 10 s. */
const STEP_MS = 10 * SECOND;
/** Metres per degree on a sphere of 6 371 km; flat is close enough this near 0° N 0° E. */
const METRES_PER_DEGREE = 111_195;

/** Where the walk starts, in degrees: made up, in open sea. */
const START = { lat: 0.042, lon: 0.044 };

/**
 * The legs of the journey, in order: 39 minutes of walking and one stop. A walk
 * heads for its made-up waypoint for its whole length, at a pace drawn from the
 * seed. The 6-minute stop is longer than the 5 minutes after which D-021 raises
 * lost contact, and it is where the SDK changes state.
 */
const LEGS = [
  { walk: 12 * MINUTE, towards: { lat: 0.05, lon: 0.05 } },
  { walk: 10 * MINUTE, towards: { lat: 0.058, lon: 0.043 } },
  { stop: 6 * MINUTE },
  { walk: 9 * MINUTE, towards: { lat: 0.066, lon: 0.051 } },
  { walk: 8 * MINUTE, towards: { lat: 0.061, lon: 0.059 } },
];

/** Each walk's pace, in m/s, is drawn between these; each step then wavers by ±10 %. */
const PACE = { slowest: 1.1, fastest: 1.5 };

/** mulberry32: a small seeded generator of numbers in [0, 1). */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The unit heading from `from` to `to`, in degrees per degree walked. */
function heading(from, to) {
  const dLat = to.lat - from.lat;
  const dLon = to.lon - from.lon;
  const length = Math.hypot(dLat, dLon);
  return { lat: dLat / length, lon: dLon / length };
}

/**
 * @param {{ seed: number }} options
 * @returns {{ seed: number, points: { t: number, lat: number, lon: number }[] }}
 *   One point every 10 s; `t` is ms from the start, 0 to 45 minutes.
 */
export function buildRoute({ seed }) {
  if (!Number.isInteger(seed)) throw new Error('the route needs an integer seed');
  const random = seeded(seed);
  let lat = START.lat;
  let lon = START.lon;
  let t = 0;
  const points = [{ t, lat, lon }];
  for (const leg of LEGS) {
    const ms = leg.walk ?? leg.stop;
    const direction = leg.walk ? heading({ lat, lon }, leg.towards) : null;
    const pace = leg.walk ? PACE.slowest + (PACE.fastest - PACE.slowest) * random() : 0;
    for (let elapsed = STEP_MS; elapsed <= ms; elapsed += STEP_MS) {
      if (direction !== null) {
        const metres = pace * (0.9 + 0.2 * random()) * (STEP_MS / SECOND);
        lat += (direction.lat * metres) / METRES_PER_DEGREE;
        lon += (direction.lon * metres) / METRES_PER_DEGREE;
      }
      t += STEP_MS;
      points.push({ t, lat, lon });
    }
  }
  return { seed, points };
}
