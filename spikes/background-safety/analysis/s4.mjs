// SPIKE-01-AC8 (S4): positions recorded offline arrive, in order, after 3
// minutes offline, and the SDK's queue empties. Pure: reads no clock and no file.
//
// Two windows must be long enough. The device must be offline for 3 min, from
// the "offline-started" mark to the "offline-ended" mark; a shorter window
// means the scenario did not run, so the run is invalid. And the run must watch
// for 5 min after reconnecting (D-021's threshold), to the journey's end; a
// shorter watch is never passed, and it is failed only if an out-of-order
// arrival already shows, since more watching could not undo that.
//
// Breaks (review loop 2): S4's failure shows from the moment the device goes
// back online. A timed break wholly before the "offline-ended" mark cannot
// explain it, so the run stays failed. A break from that mark on, or one with
// no time, makes it invalid, except that an order already broken before a
// timed break began is final. A run that would pass is invalid with any
// break. Every break stays in the evidence.
import {
  arrivalsIn,
  breakOver,
  harnessBreaks,
  journeyWindow,
  markInside,
  shortRun,
  spanOf,
} from './journey.mjs';

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
 * The IDs the device held when it went back online, from held.json as the
 * driver saves it: { ids, count, writtenAt, readAt }. Refused when it is not
 * that file, when its count does not match its IDs, or when it was read after
 * the "offline-ended" mark (on the Mac's wall clock), when it may already miss
 * what was uploaded.
 *
 * @param {{ text: string, records: object[] }} input
 * @returns {string[]} the IDs, in the file's order
 */
export function readHeld({ text, records }) {
  let held;
  try {
    held = JSON.parse(text);
  } catch {
    throw new Error('held.json is not JSON, so what the device held is unknown');
  }
  const ids = held?.ids;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || id === '')) {
    throw new Error("held.json's ids must be a list of record IDs");
  }
  if (held.count !== ids.length) {
    throw new Error(`held.json counts ${held.count} records and lists ${ids.length}`);
  }
  if (!Number.isFinite(held.readAt)) {
    throw new Error('held.json does not say when it was read');
  }
  const online = records.find(
    (record) => record.kind === 'mark' && record.label === 'offline-ended',
  );
  if (online === undefined) throw new Error('the run has no "offline-ended" mark');
  if (held.readAt > online.at) {
    throw new Error('held.json was read after the device went back online, so it may miss records');
  }
  return ids;
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
  const harness = harnessBreaks(records, window, breaks);
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
  // The arrival at which the order broke: recorded before the one ahead of it.
  const orderBroken = flushed.find(
    (arrival, i) => i > 0 && recordedTime(arrival) < recordedTime(flushed[i - 1]),
  );
  const outOfOrder = orderBroken !== undefined;
  const lastHeld = flushed.at(-1);
  const reportsAfterFlush =
    lastHeld === undefined ? after : after.slice(after.indexOf(lastHeld) + 1);
  const queueEmptied = reportsAfterFlush.some((arrival) => arrival.queueCount === 0);

  const ids = arrivals.map((arrival) => arrival.recordId).filter((id) => id != null);
  const duplicates = ids.length - new Set(ids).size;

  const passed = held.length > 0 && missing.length === 0 && !outOfOrder && queueEmptied;
  let status = passed ? 'passed' : 'failed';
  const { untimed, timed, texts } = harness;
  const fromOnline = spanOf(online, window.end);
  const over = timed.filter((found) => breakOver(found, fromOnline));
  // Each timed break over the flush and the watch began after the order broke.
  const orderFinal =
    outOfOrder &&
    untimed.length === 0 &&
    over.every(
      (found) => found.from > (found.clock === 'mono' ? orderBroken.mono : orderBroken.at),
    );
  if (passed) {
    if (texts.length > 0) status = 'invalid';
  } else if (!orderFinal && (untimed.length > 0 || over.length > 0)) {
    status = 'invalid';
  }
  if (offlineShort.length > 0) status = 'invalid';
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
    evidence: [...texts, ...offlineShort, ...watchShort],
  };
}
