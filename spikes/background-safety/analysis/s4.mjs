// SPIKE-01-AC8 (S4): positions recorded offline arrive, in order, after 3
// minutes offline, and the SDK's queue empties. Pure: reads no clock and no file.
//
// Two windows must be long enough. The device must be offline for 3 min, from
// the "offline-started" mark to the "offline-ended" mark; a shorter window
// means the scenario did not run, so the run is invalid. And the run must watch
// for 5 min after reconnecting (D-021's threshold), to the journey's end; a
// shorter watch is never passed, and it is failed only if an out-of-order
// arrival already shows, since more watching could not undo that. A break
// still makes any run invalid.
import { arrivalsIn, harnessEvidence, journeyWindow, markInside, shortRun } from './journey.mjs';

/** S4 cuts the device off for 3 minutes. */
const OFFLINE_MS = 3 * 60_000;
/** Then it watches for D-021's 5 minutes. */
const WATCH_MS = 5 * 60_000;

/** When the device recorded `arrival`, in ms since the epoch. Throws if unreadable. */
function recordedTime(arrival) {
  const time = typeof arrival.recordedAt === 'string' ? Date.parse(arrival.recordedAt) : NaN;
  if (Number.isNaN(time)) {
    throw new Error(`held record ${arrival.recordId} has no readable recordedAt`);
  }
  return time;
}

/**
 * @param {{ records: object[], held: string[], breaks?: string[] }} input
 *   `held`: the SDK record IDs the device held in its queue when the window closed.
 */
export function judgeS4({ records, held, breaks = [] }) {
  const window = journeyWindow(records);
  const online = markInside(records, 'offline-ended', window);
  const offline = markInside(records, 'offline-started', window);
  if (online.mono < offline.mono) {
    throw new Error('the "offline-ended" mark comes before the "offline-started" mark');
  }
  if (!Array.isArray(held) || held.some((id) => typeof id !== 'string' || id === '')) {
    throw new Error('held must be the list of record IDs the device held offline');
  }
  const broken = harnessEvidence(records, window, breaks);
  const offlineShort = shortRun(
    online.mono - offline.mono,
    OFFLINE_MS,
    (measured, required) => `the device was offline for ${measured}, and S4 needs ${required}`,
  );
  const watchShort = shortRun(
    window.end.mono - online.mono,
    WATCH_MS,
    (measured, required) =>
      `the run watched ${measured} after reconnecting, and S4 needs ${required}`,
  );
  const arrivals = arrivalsIn(records, window);
  const after = arrivals.filter((arrival) => arrival.mono >= online.mono);

  // The first arrival of each held position, in the order they arrived.
  const firstOf = new Map();
  for (const arrival of after) {
    if (held.includes(arrival.recordId) && !firstOf.has(arrival.recordId)) {
      firstOf.set(arrival.recordId, arrival);
    }
  }
  const flushed = [...firstOf.values()];
  const missing = held.filter((id) => !firstOf.has(id));
  const outOfOrder = flushed.some(
    (arrival, i) => i > 0 && recordedTime(arrival) < recordedTime(flushed[i - 1]),
  );
  const lastHeld = flushed.at(-1);
  const reportsAfterFlush =
    lastHeld === undefined ? after : after.slice(after.indexOf(lastHeld) + 1);
  const queueEmptied = reportsAfterFlush.some((arrival) => arrival.queueCount === 0);

  const ids = arrivals.map((arrival) => arrival.recordId).filter((id) => id != null);
  const duplicates = ids.length - new Set(ids).size;

  let status =
    held.length > 0 && missing.length === 0 && !outOfOrder && queueEmptied ? 'passed' : 'failed';
  if (broken.length > 0 || offlineShort.length > 0) status = 'invalid';
  else if (watchShort.length > 0 && !outOfOrder) status = 'invalid';
  return {
    status,
    missing,
    outOfOrder,
    queueEmptied,
    duplicates,
    offlineMs: online.mono - offline.mono,
    firstArrivalAfterReconnectMs: flushed.length > 0 ? flushed[0].mono - online.mono : null,
    lastArrivalAfterReconnectMs: lastHeld === undefined ? null : lastHeld.mono - online.mono,
    evidence: [...broken, ...offlineShort, ...watchShort],
  };
}
