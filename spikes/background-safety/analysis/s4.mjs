// SPIKE-01-AC8 (S4): positions recorded offline arrive, in order, after 3
// minutes offline, and the SDK's queue empties. Pure: reads no clock and no file.
import { arrivalsIn, findMark, harnessEvidence, journeyWindow } from './journey.mjs';

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
  const online = findMark(records, 'offline-ended');
  const offline = findMark(records, 'offline-started');
  if (!Array.isArray(held) || held.some((id) => typeof id !== 'string' || id === '')) {
    throw new Error('held must be the list of record IDs the device held offline');
  }
  const evidence = harnessEvidence(records, window, breaks);
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
  if (evidence.length > 0) status = 'invalid';
  return {
    status,
    missing,
    outOfOrder,
    queueEmptied,
    duplicates,
    offlineMs: online.mono - offline.mono,
    firstArrivalAfterReconnectMs: flushed.length > 0 ? flushed[0].mono - online.mono : null,
    lastArrivalAfterReconnectMs: lastHeld === undefined ? null : lastHeld.mono - online.mono,
    evidence,
  };
}
