// SPIKE-01-AC13: reads the Mac's sleeps from the text of `pmset -g log`, for a
// run's window on the Mac's wall clock, as breaks the judges take. Pure.
//
// A sleep leaves no hole in the receiver's ticks: the monotonic clock is
// believed not to advance while the Mac sleeps, and the emulator and simulator
// are frozen with it. So each Sleep and DarkWake that overlaps the window is a
// break, and the run is invalid.
//
// The line format (Darwin 25.6, read on the Mac on 2026-09-30):
// - an event is "<date> <time> <±hhmm> <domain>\t<message>", and a Sleep or
//   DarkWake message ends with how long it lasted ("… 57 secs");
// - the lines are not strictly in time order;
// - the output ends with "<now> : Showing all currently held IOKit power
//   assertions", then the assertions held at that moment.
//
// Text that is not the log, or a log that does not cover the whole window, is
// refused: it is never read as "the Mac did not sleep".

const STAMP = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d) ([+-])(\d\d)(\d\d)$/;
const WHEN = '\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d [+-]\\d{4}';
const EVENT = new RegExp(`^(${WHEN}) ([^\\t]*)\\t(.*)$`);
const CLOSING = new RegExp(`^(${WHEN}) : Showing all currently held IOKit power assertions\\s*$`);
const LASTED = /(\d+) secs\s*$/;

/** What each sleeping event means, for the break's text. */
const SLEEPS = new Map([
  ['Sleep', 'the Mac slept'],
  ['DarkWake', 'the Mac was in a dark wake, between sleeps'],
]);

/** A pmset time, read with its own UTC offset, in ms since the epoch. */
function epoch(stamp) {
  const [, year, month, day, hour, minute, second, sign, offsetH, offsetM] = STAMP.exec(stamp);
  const offset = (Number(offsetH) * 60 + Number(offsetM)) * 60_000;
  const local = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  return sign === '+' ? local - offset : local + offset;
}

/**
 * @param {{ text: string, from: number, to: number }} input
 *   `from` and `to`: the run's window on the Mac's wall clock, in ms since the epoch.
 * @returns {{ text: string, from: number, to: number }[]} one break per Sleep or
 *   DarkWake that overlaps the window, in time order: its words, quoting the
 *   time as pmset printed it, and its span on the Mac's wall clock in ms, from
 *   when it began to when it ended, so a judge can tell whether it overlaps a gap
 */
export function readSleeps({ text, from, to }) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    throw new Error("the run's window must be two wall-clock times, the start before the end");
  }
  if (typeof text !== 'string') throw new Error('the log must be the text `pmset -g log` printed');

  const events = [];
  let readAt = null;
  for (const line of text.split(/\r?\n/)) {
    const closing = CLOSING.exec(line);
    if (closing !== null) {
      readAt = epoch(closing[1]);
      continue;
    }
    const event = EVENT.exec(line);
    if (event === null) continue;
    const [, stamp, domain, message] = event;
    events.push({ stamp, at: epoch(stamp), domain: domain.trim(), message });
  }
  if (events.length === 0) {
    throw new Error('the text holds no event line of `pmset -g log`, so it is not the log');
  }
  if (readAt === null) {
    throw new Error('the log has no closing line saying when it was read, so it may be cut short');
  }
  if (readAt < to) throw new Error('the log was read before the run ended, so it misses its end');
  if (Math.min(...events.map((event) => event.at)) > from) {
    throw new Error('the log begins after the run began, so it misses its start');
  }

  const breaks = [];
  for (const { stamp, at, domain, message } of events) {
    const meaning = SLEEPS.get(domain);
    if (meaning === undefined) continue;
    const lasted = LASTED.exec(message);
    if (lasted === null) {
      throw new Error(`the ${domain} at ${stamp} gives no duration, so it cannot be placed`);
    }
    const until = at + Number(lasted[1]) * 1000;
    if (at <= to && until >= from) {
      breaks.push({
        text: `${meaning}: pmset logged ${domain} at ${stamp} for ${lasted[1]} secs`,
        from: at,
        to: until,
      });
    }
  }
  return breaks.sort((a, b) => a.from - b.from);
}
