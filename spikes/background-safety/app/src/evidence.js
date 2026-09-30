// SPIKE-01: small JSON files in the app's own documents folder, for the
// drivers to read from outside the app (Android: `run-as … cat files/<name>`;
// iOS: the app's data container from `simctl get_app_container`).
//
// They never touch the network, so they can neither be mistaken for an
// upload nor delay one, and they hold IDs, titles and times only: never a
// position.
import { File, Paths } from 'expo-file-system';

export const EVIDENCE = {
  /** S4: the IDs of the records the SDK still holds, and when they were read. */
  held: 'held.json',
  /** S2 and S5: the platform's list of delivered notifications, as the app reads it. */
  delivered: 'delivered.json',
  /** S5: the last notification received or opened, with a pushed payload as it came. */
  received: 'received.json',
  /** S8: the map's status, zoom and frame on the screen. */
  map: 'map.json',
};

/**
 * Writes `value` as the file `name`. Returns null, or the error's name when the
 * write failed, so the caller can show it: a missing file must never pass for
 * an empty one.
 */
export function record(name, value) {
  try {
    new File(Paths.document, name).write(JSON.stringify({ ...value, writtenAt: Date.now() }));
    return null;
  } catch (error) {
    return error?.name ?? 'error';
  }
}
