// SPIKE-01-AC6 (S2) and AC9 (S5): the readers of the platforms' own
// notification records. Pure: they read the text they are given.
//
// Android: `adb shell dumpsys notification --noredact`. Only the records in its
// "Notification List" count, each read on its own: the package, the fixed
// title, the time the platform posted it (mCreationTimeMs), whether Do Not
// Disturb intercepted it, and the channel and audio usage that record carries.
// The channels stored per package later in the dump are never read: a stored
// channel can say ALARM while the record went out as NOTIFICATION, and another
// package may have a channel with the same id.
//
// iOS: the app's evidence files. delivered.json is the platform's delivered
// list as the app read it when next opened; received.json is the last
// notification received, with the payload as it was pushed. Times are ms.
//
// Output that is not the record is refused, never read as "none".

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const RECORD = /^ {4}NotificationRecord\(/;
const HEADER = /pkg=(\S+) .*Notification\(channel=(\S+)/;

/** Each record in the dump's "Notification List", as the lines that belong to it. */
function notificationRecords(text) {
  if (typeof text !== 'string') throw new Error("the notification record must be the dump's text");
  const lines = text.split(/\r?\n/);
  const at = lines.indexOf('  Notification List:');
  if (!lines.includes('Current Notification Manager state:') || at < 0) {
    throw new Error('the text is not the notification dump: it has no "Notification List"');
  }
  const records = [];
  for (const line of lines.slice(at + 1)) {
    if (RECORD.test(line)) records.push([line]);
    else if (line.trim() !== '' && !line.startsWith('    ')) break;
    else records.at(-1)?.push(line);
  }
  return records.map(readRecord);
}

/** The fields S2 and S5 read from one record. */
function readRecord(lines) {
  const [, pkg, channel] = HEADER.exec(lines[0]) ?? [];
  const field = (pattern) =>
    lines.map((line) => pattern.exec(line)?.[1]).find((v) => v !== undefined);
  const created = field(/^\s+mCreationTimeMs=(\d+)$/);
  const intercept = field(/^\s+mIntercept=(true|false)$/);
  const bypass = field(
    /^\s+effectiveNotificationChannel=NotificationChannel\{.*?mBypassDnd=(true|false)/,
  );
  return {
    pkg: pkg ?? null,
    channel: channel ?? null,
    title: field(/^\s+android\.title=String \((.*)\)$/) ?? null,
    // Greedy to the last ")", so a text with parentheses is read whole; "android.text=null" gives none.
    text: field(/^\s+android\.text=(?:Spannable)?String \((.*)\)$/) ?? null,
    createdAt: created === undefined ? null : Number(created),
    intercepted: intercept === undefined ? null : intercept === 'true',
    bypassDnd: bypass === undefined ? null : bypass === 'true',
    usage: field(/^\s+mAttributes= AudioAttributes: usage=(\w+)/) ?? null,
  };
}

/** The app's own records with the fixed title: the exact package, never one that only starts with it. */
function matching(records, app, title) {
  if (typeof app !== 'string' || app === '') throw new Error('the app id is missing');
  if (typeof title !== 'string' || title === '') throw new Error('the fixed title is missing');
  return records.filter((record) => record.pkg === app && record.title === title);
}

/**
 * S2 on Android: each reminder the platform shows as posted, at its post time
 * on the platform (mCreationTimeMs), not the app's own `when`.
 *
 * @param {{ text: string, app: string, title: string }} input
 * @returns {{ at: number }[]} in time order, for judgeS2
 */
export function readAndroidReminders({ text, app, title }) {
  return matching(notificationRecords(text), app, title)
    .map((record) => {
      if (record.createdAt === null) throw new Error("a reminder's record has no post time");
      return { at: record.createdAt };
    })
    .sort((a, b) => a.at - b.at);
}

/**
 * S5 on Android: the alert's own record. When the app posted it more than
 * once, the latest counts.
 *
 * @param {{ text: string, app: string, title: string }} input
 * @returns {{ posted: boolean, intercepted: boolean | null, channel: string | null,
 *   bypassDnd: boolean | null, usage: string | null, text: string | null }}
 *   `text`: the record's android.text, or null when it has none
 */
export function readAndroidAlert({ text, app, title }) {
  const alerts = matching(notificationRecords(text), app, title).sort(
    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
  );
  const alert = alerts.at(-1);
  if (alert === undefined) {
    return {
      posted: false,
      intercepted: null,
      channel: null,
      bypassDnd: null,
      usage: null,
      text: null,
    };
  }
  return {
    posted: true,
    intercepted: alert.intercepted,
    channel: alert.channel,
    bypassDnd: alert.bypassDnd,
    usage: alert.usage,
    text: alert.text,
  };
}

/** Any time before 2001 in ms: a time in seconds (iOS's own unit) would land here. */
const MS_FLOOR = 1e12;

function parse(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} is not JSON`);
  }
}

/** delivered.json's list, each entry with its delivery time in ms. */
function readDelivered(text) {
  const delivered = parse(text, 'delivered.json')?.delivered;
  if (!Array.isArray(delivered)) throw new Error('delivered.json has no delivered list');
  for (const entry of delivered) {
    if (!isObject(entry) || typeof entry.title !== 'string') {
      throw new Error('delivered.json holds an entry that is not a notification');
    }
    if (!Number.isFinite(entry.deliveredAt) || entry.deliveredAt < MS_FLOOR) {
      throw new Error('delivered.json holds a delivery time that is not in ms since the epoch');
    }
  }
  return delivered;
}

/**
 * S2 on iOS: each delivered notification with the fixed reminder title.
 *
 * @param {{ text: string, title: string }} input delivered.json's text
 * @returns {{ at: number }[]} in time order, for judgeS2
 */
export function readIosReminders({ text, title }) {
  return readDelivered(text)
    .filter((entry) => entry.title === title)
    .map((entry) => ({ at: entry.deliveredAt }))
    .sort((a, b) => a.at - b.at);
}

/**
 * S5 on iOS: the pushed alert as the app received it (the payload as it came,
 * and the text shown), and whether the platform presented the background push:
 * a delivered entry with the alert's title, delivered after the app went to
 * the background (the safety review's S3). The foreground push reaches the
 * app's handler whether or not anything is presented, so it never counts.
 *
 * @param {{ received: string, delivered: string, title: string, backgroundAt: number }} input
 *   the two files' text, and when the app went to the background, in ms on the Mac's clock
 * @returns {{ alert: { payload: object, shownText: string }, presented: boolean }}
 */
export function readIosAlert({ received, delivered, title, backgroundAt }) {
  if (!Number.isFinite(backgroundAt) || backgroundAt < MS_FLOOR) {
    throw new Error(
      'when the app went to the background must be a time in ms since the epoch, ' +
        'so "presented" is never guessed',
    );
  }
  if (typeof title !== 'string' || title === '') throw new Error('the fixed title is missing');
  const notification = parse(received, 'received.json')?.notification;
  if (!isObject(notification)) throw new Error('received.json holds no notification');
  if (!isObject(notification.payload)) {
    throw new Error(
      'the notification received has no pushed payload, so it is not the pushed alert',
    );
  }
  const list = readDelivered(delivered);
  return {
    alert: { payload: notification.payload, shownText: notification.body },
    presented: list.some((entry) => entry.title === title && entry.deliveredAt > backgroundAt),
  };
}
