// SPIKE-01-AC13: the per-run judge. It judges one run's saved folder, given
// as data, with the tested readers and judges; the drivers only read the files
// (the code review's N4, the safety review's B2b and B2c).
//
//   judgeRun({ meta, records, files, exit }) → { status, evidence, details }
//
// It reads no file and no clock, and never throws: whatever cannot be judged
// is an invalid run with the reason as its evidence. The fixed texts, the
// app's id, the receiver's port (app/src/fixed.json, read once when loaded) and
// the emulator's network are its own, so a re-judge uses the same values.
//
// - Breaks: the driver's own (meta.breaks, with no time) and the Mac's sleeps
//   in the run's window (pmset.txt, with their span).
// - A driver that exited non-zero is still judged: a failure its records show
//   is failed; otherwise the run is invalid, with the exit as evidence.
// - The S1 run's capture (AC12) is judged on its own and never touches S1's
//   status or evidence. The capture's clock is not the Mac's, and the file
//   keeps growing after the run, so the run is placed on the capture's clock
//   from its own uploads to the receiver (captureClock below), never guessed.
import { readFileSync } from 'node:fs';

import { judgeCapture, listDestinations } from './capture.mjs';
import {
  readAndroidAlert,
  readAndroidReminders,
  readIosAlert,
  readIosPresented,
  readIosReminders,
} from './notifications.mjs';
import { readSleeps } from './pmset.mjs';
import { judgeS1 } from './s1.mjs';
import { judgeS2 } from './s2.mjs';
import { judgeS3 } from './s3.mjs';
import { judgeS4, readHeld } from './s4.mjs';
import { checkAlert, judgeAndroidAlert, readAudio } from './s5.mjs';
import { readTelecom, telecomCallStarted } from './s6.mjs';
import { judgeS7 } from './s7.mjs';
import { judgeS8, readAlignment, readCrashes, readMapRender } from './s8.mjs';

const FIXED = JSON.parse(readFileSync(new URL('../app/src/fixed.json', import.meta.url), 'utf8'));
const APP = 'org.example.spike.backgroundsafety';

/**
 * The emulator's network as its capture sees it (Wi-Fi off), both families:
 * the device's own addresses, the Mac (the receiver) and the resolver. The
 * device's IPv6 address is the one the night's capture and the dry probe saw.
 */
const EMULATOR = {
  device: ['10.0.2.15', 'fec0::5054:ff:fe12:3456'],
  receiver: { addresses: ['10.0.2.2', 'fec0::2'], port: FIXED.receiverPort },
  resolver: { addresses: ['10.0.2.3', 'fec0::3'], port: 53 },
};
/** Kartverket's tile host, which the map style names (S8, recorded, not judged). */
const KARTVERKET = ['cache.kartverket.no'];

const PASSED = 'passed';
const FAILED = 'failed';
const INVALID = 'invalid';

/** The text of a saved file, or a refusal naming it. */
function need(files, name) {
  const text = files?.[name];
  if (typeof text !== 'string') throw new Error(`the run has no ${name}`);
  return text;
}

/** driver.jsonl's steps; an empty list when the run has none. */
function driverSteps(files) {
  const text = files?.['driver.jsonl'];
  if (typeof text !== 'string') return [];
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error('driver.jsonl holds a line that is not JSON');
      }
    });
}

const breakText = (found) => (typeof found === 'string' ? found : found.text);

/**
 * Breaks for the judges with no timing of their own, S5, S6 and S8 (review
 * loop 2). A run that would pass is invalid with any break. A failure stays
 * failed, with the breaks in the evidence, when it rests on evidence no break
 * of the harness can produce: `always` with any break (a crash log naming the
 * app, a failed alignment check, a changed alert text), `timed` only when
 * every break has its time (S5's own platform records, beside a sleep of the
 * Mac). Otherwise the run is invalid.
 */
function withBreaks(breaks, result, { always = false, timed = false } = {}) {
  if (breaks.length === 0) return result;
  const untimed = breaks.some((found) => typeof found === 'string');
  const keep = result.status === FAILED && (always || (timed && !untimed));
  return {
    ...result,
    status: keep ? FAILED : INVALID,
    evidence: [...breaks.map(breakText), ...result.evidence],
  };
}

/** The device's addresses: the emulator's, and any the driver recorded for this run. */
function networkOf(meta) {
  const recorded = Array.isArray(meta.deviceAddresses)
    ? meta.deviceAddresses.filter((address) => typeof address === 'string' && address !== '')
    : [];
  return { ...EMULATOR, device: [...new Set([...EMULATOR.device, ...recorded])] };
}

// The capture's clock.

const TT_LINE = /^(\d+\.\d{6})\s+(IP6?)\s+(\S+) > (\S+): (.*)$/;
/** Two arrival-to-upload distances this close (ms) are the same offset. */
const CLUSTER_MS = 1_000;

/** "10.0.2.15.40001" → address and port; "fec0::15.50002" too. */
function endpoint(text, ipv6) {
  const dot = text.lastIndexOf('.');
  if (ipv6) {
    return dot < 0
      ? { address: text, port: null }
      : { address: text.slice(0, dot), port: Number(text.slice(dot + 1)) };
  }
  const parts = text.split('.');
  return parts.length === 5
    ? { address: parts.slice(0, 4).join('.'), port: Number(parts[4]) }
    : { address: text, port: null };
}

/** When each upload to the receiver (a packet with data) was captured, in ms on the capture's clock. */
function uploadTimes(text, network) {
  const times = [];
  for (const line of text.split(/\r?\n/)) {
    const packet = TT_LINE.exec(line);
    if (packet === null) continue;
    const ipv6 = packet[2] === 'IP6';
    const from = endpoint(packet[3], ipv6);
    const to = endpoint(packet[4], ipv6);
    const length = /\blength (\d+)/.exec(packet[5]);
    if (
      network.device.includes(from.address) &&
      network.receiver.addresses.includes(to.address) &&
      to.port === network.receiver.port &&
      length !== null &&
      Number(length[1]) > 0
    ) {
      times.push(Number(packet[1]) * 1000);
    }
  }
  return times;
}

/**
 * The capture's clock against the Mac's, from the run's own uploads: every
 * pair of an arrival (the receiver's `at`, on the Mac's clock) and an upload
 * (its time in the capture) gives a candidate offset. The true one is where
 * the most arrivals meet their upload within 1 s; its median is the offset.
 * Refused, never guessed, when there is no upload or fewer than two arrivals,
 * when that cluster holds fewer than half the arrivals, or when another
 * cluster holds as many.
 * @returns {{ offsetMs: number, matched: number, arrivals: number, uploads: number,
 *   spreadMs: number, window: { from: number, to: number }, method: string }}
 */
function captureClock({ text, records, meta, network }) {
  const arrivals = records.filter((record) => record.kind === 'arrival');
  const uploads = uploadTimes(text, network);
  if (uploads.length === 0) {
    throw new Error(
      'the capture holds no dated upload to the receiver (`tcpdump -tt`), ' +
        "so the run cannot be placed on the capture's clock",
    );
  }
  if (arrivals.length < 2) {
    throw new Error(
      `the run has ${arrivals.length} arrival(s), too few to place it on the capture's clock`,
    );
  }
  const pairs = [];
  arrivals.forEach((arrival, i) => {
    for (const upload of uploads) pairs.push({ offset: arrival.at - upload, arrival: i });
  });
  pairs.sort((a, b) => a.offset - b.offset);

  // Every 1 s span of offsets, with how many different arrivals it holds.
  const spans = [];
  const counts = new Map();
  let low = 0;
  for (let high = 0; high < pairs.length; high++) {
    counts.set(pairs[high].arrival, (counts.get(pairs[high].arrival) ?? 0) + 1);
    while (pairs[high].offset - pairs[low].offset > CLUSTER_MS) {
      const left = counts.get(pairs[low].arrival) - 1;
      if (left === 0) counts.delete(pairs[low].arrival);
      else counts.set(pairs[low].arrival, left);
      low += 1;
    }
    spans.push({ low, high, matched: counts.size });
  }
  const best = spans.reduce((a, b) => (b.matched > a.matched ? b : a));
  const from = pairs[best.low].offset - CLUSTER_MS;
  const to = pairs[best.high].offset + CLUSTER_MS;
  const rival = spans
    .filter((span) => pairs[span.high].offset < from || pairs[span.low].offset > to)
    .reduce((a, b) => (b.matched > a.matched ? b : a), { matched: 0 });
  if (best.matched * 2 < arrivals.length) {
    throw new Error(
      `only ${best.matched} of the run's ${arrivals.length} arrivals meet an upload at one offset, ` +
        "so the run cannot be placed on the capture's clock",
    );
  }
  if (rival.matched >= best.matched) {
    throw new Error(
      `two offsets each match ${best.matched} arrivals with an upload, ` +
        "so the run cannot be placed on the capture's clock",
    );
  }
  const offsets = pairs.slice(best.low, best.high + 1).map((pair) => pair.offset);
  const offsetMs = Math.round(offsets[Math.floor((offsets.length - 1) / 2)]);
  return {
    offsetMs,
    matched: best.matched,
    arrivals: arrivals.length,
    uploads: uploads.length,
    spreadMs: Math.round(offsets.at(-1) - offsets[0]),
    window: { from: meta.startedAt - offsetMs, to: meta.endedAt - offsetMs },
    method:
      "the capture's clock is the Mac's less offsetMs: the median of the densest 1 s cluster " +
      "of (arrival time on the Mac's clock − upload time in the capture), over every pair of " +
      "the run's arrivals and the capture's uploads to the receiver; the run's window, " +
      'moved by it, is what was read',
  };
}

/** AC12: the S1 run's capture, judged on its own. Never throws: an unreadable capture is its own invalid. */
function s1Capture({ meta, records, files }) {
  const network = networkOf(meta);
  let clock = null;
  try {
    const text = files?.['capture.txt'];
    if (typeof text !== 'string') {
      throw new Error('the run has no capture text (`tcpdump -tt -nn -r` of its pcap)');
    }
    clock = captureClock({ text, records, meta, network });
    const judged = judgeCapture({ text, ...network, ...clock.window });
    return {
      status: judged.status,
      problems: judged.problems,
      flagged: judged.flagged,
      destinations: judged.destinations,
      clock,
    };
  } catch (error) {
    return { status: INVALID, problems: [error.message], flagged: [], destinations: [], clock };
  }
}

/**
 * AC16: S8's capture, recorded and not judged. The map screen uploads nothing,
 * so its run may not be placeable on the capture's clock; then the whole file
 * is listed, and the details say so.
 */
function s8Capture({ meta, records, files }) {
  const network = networkOf(meta);
  try {
    const text = files?.['capture.txt'];
    if (typeof text !== 'string') {
      throw new Error('the run has no capture text (`tcpdump -tt -nn -r` of its pcap)');
    }
    let clock = null;
    let scope = "the run's window, on the capture's clock";
    try {
      clock = captureClock({ text, records, meta, network });
    } catch (error) {
      scope =
        `not this run alone: ${error.message}. So these are the whole capture file's ` +
        'destinations: every run in this capture slot, and the emulator starting up';
    }
    const listed = listDestinations({
      text,
      device: network.device,
      resolver: network.resolver,
      receiver: network.receiver,
      kartverket: KARTVERKET,
      ...(clock === null ? {} : clock.window),
    });
    return {
      destinations: listed.destinations,
      flagged: listed.flagged,
      captureScope: scope,
      clock,
    };
  } catch (error) {
    return { captureError: error.message };
  }
}

/** S8 on Android: the 16 KB alignment, from zipalign's output and exit code, or the night's reading. */
function alignmentOf(meta, files) {
  if (typeof files?.['zipalign.txt'] === 'string' && meta.zipalignExitCode !== undefined) {
    const read = readAlignment({ text: files['zipalign.txt'], exitCode: meta.zipalignExitCode });
    return { ...read, from: "zipalign's output and its exit code" };
  }
  if (typeof meta.aligned16k === 'boolean') {
    return {
      aligned16k: meta.aligned16k,
      misaligned: null,
      from:
        "meta.aligned16k, the driver's own reading: the run saved zipalign's output " +
        'but not its exit code, so readAlignment could not read it',
    };
  }
  throw new Error('the run has no result of the 16 KB alignment check');
}

/**
 * The map's render at a shot's zoom. Evidence written for an earlier zoom
 * (the tap never moved the map) means it did not render at this one (review
 * loop 2); anything else readMapRender refuses stays refused.
 */
function renderAt(evidence, zoom, earlier) {
  try {
    return readMapRender({ text: evidence, zoom });
  } catch (error) {
    for (const before of earlier) {
      try {
        readMapRender({ text: evidence, zoom: before });
        return { rendered: false, frame: null };
      } catch {
        // Not that zoom's either.
      }
    }
    throw error;
  }
}

/** S8's shots: each zoom's map evidence, then its screenshot where the map rendered. */
function shotsOf(meta, files) {
  if (!Array.isArray(meta.shots)) throw new Error('meta.json lists no shots');
  return meta.shots.map((shot, i) => {
    const evidence = files?.[`zoom-${shot.zoom}.json`];
    if (typeof evidence !== 'string')
      throw new Error(`the run has no map evidence for zoom ${shot.zoom}`);
    const earlier = meta.shots.slice(0, i).map((before) => before.zoom);
    const render = renderAt(evidence, shot.zoom, earlier);
    if (!render.rendered) return { zoom: shot.zoom, rendered: false };
    const png = typeof shot.file === 'string' ? files?.[shot.file] : undefined;
    if (!(png instanceof Uint8Array)) {
      throw new Error(`the map rendered at zoom ${shot.zoom}, but the run has no screenshot of it`);
    }
    return { zoom: shot.zoom, png, region: shot.region ?? render.frame ?? undefined };
  });
}

/** S7: whether the platform ended the app's process on the change, from the driver's own step. */
function processEndedOf(meta, files) {
  if (typeof meta.processEnded === 'boolean') return meta.processEnded;
  const steps = driverSteps(files);
  if (meta.platform === 'android') {
    const revoked = steps.find((step) => step.step === 'revoked');
    return typeof revoked?.processEnded === 'boolean' ? revoked.processEnded : null;
  }
  const reduced = steps.find((step) => step.step === 'reduced');
  return typeof reduced?.processRunning === 'boolean' ? !reduced.processRunning : null;
}

/** Each scenario's judge: { status, evidence, details }. */
const JUDGES = {
  s1: ({ meta, records, files, breaks }) => {
    const result = judgeS1({ records, breaks });
    const details = {
      largestGapMs: result.largestGapMs,
      gapsOver60s: result.gapsOver60s,
      gapsOver120s: result.gapsOver120s,
      stateChanges: result.stateChanges,
    };
    if (meta.capture) details.capture = s1Capture({ meta, records, files });
    return { status: result.status, evidence: result.evidence, details };
  },
  s2: ({ meta, records, files, breaks }) => {
    const title = FIXED.reminder.title;
    const reminders =
      meta.platform === 'android'
        ? readAndroidReminders({ text: need(files, 'notification.txt'), app: APP, title })
        : readIosReminders({ text: need(files, 'delivered.json'), title });
    const { status, evidence, ...details } = judgeS2({ records, reminders, breaks });
    return { status, evidence, details };
  },
  s3: ({ meta, records, breaks }) => {
    const { status, evidence, ...details } = judgeS3({
      exemption: meta.exemption,
      records,
      breaks,
      inForce: meta.inForce,
    });
    return { status, evidence, details };
  },
  s4: ({ records, files, breaks }) => {
    const held = readHeld({ text: need(files, 'held.json'), records });
    const { status, evidence, ...details } = judgeS4({ records, held, breaks });
    return { status, evidence, details: { held: held.length, ...details } };
  },
  // S5: seen (or presented), heard and the text are each a result, and the
  // run's status never hides one: any failed fails the run.
  s5: ({ meta, files, breaks }) => {
    if (meta.platform === 'android') {
      const alert = readAndroidAlert({
        text: need(files, 'notification.txt'),
        app: APP,
        title: FIXED.alert.title,
      });
      const { shown, heard } = judgeAndroidAlert({
        alert,
        audio: readAudio(need(files, 'audio.txt')),
        app: APP,
      });
      const text = alert.text === FIXED.alert.body ? PASSED : FAILED;
      const details = { seen: shown, heard, text };
      const failed = [shown, heard, text].includes(FAILED);
      // The platform's own records: no sleep of the Mac or hole in the ticks
      // makes them; a changed text, not even a break with no time.
      return withBreaks(
        breaks,
        { status: failed ? FAILED : PASSED, evidence: [], details },
        { always: text === FAILED, timed: true },
      );
    }
    const steps = driverSteps(files);
    const backgrounded = steps.find((step) => step.step === 'app-backgrounded');
    const backgroundAt = Number.isFinite(meta.backgroundAt) ? meta.backgroundAt : backgrounded?.at;
    if (meta.received === null && typeof files?.['received.json'] !== 'string') {
      // No foreground push recorded. Failed only when the driver pushed and
      // waited for it (review loop 2); otherwise the harness broke first.
      if (!steps.some((step) => step.step === 'foreground-push-not-recorded')) {
        throw new Error(
          'the app recorded no foreground push, and the driver never waited for one: ' +
            'it broke before the push',
        );
      }
      const delivered = files?.['delivered.json'];
      const presented =
        typeof delivered === 'string'
          ? readIosPresented({ delivered, title: FIXED.alert.title, backgroundAt })
          : null;
      const problems = [
        "the app recorded no foreground push within the driver's wait, " +
          'so its payload and text could not be checked',
      ];
      const details = { presented, text: null, problems };
      return withBreaks(breaks, { status: FAILED, evidence: [], details });
    }
    const alert = readIosAlert({
      received: need(files, 'received.json'),
      delivered: need(files, 'delivered.json'),
      title: FIXED.alert.title,
      backgroundAt,
    });
    const checked = checkAlert({
      expected: { payload: JSON.parse(need(files, 'payload.json')), text: FIXED.alert.body },
      delivered: alert.alert,
    });
    const details = {
      presented: alert.presented,
      text: checked.status,
      problems: checked.problems,
    };
    const passed = alert.presented && checked.status === PASSED;
    return withBreaks(
      breaks,
      { status: passed ? PASSED : FAILED, evidence: [], details },
      { always: checked.status === FAILED },
    );
  },
  // S6: the behaviour is recorded, not scored (AC10): a run passes once
  // Telecom's record was read.
  s6: ({ meta, files, breaks }) => {
    const before = readTelecom(need(files, 'telecom-before.txt'));
    const after = readTelecom(need(files, 'telecom.txt'));
    const earlier = new Set(before.map((call) => call.id));
    const placed = after.find((call) => !earlier.has(call.id) && call.direction === 'outgoing');
    const details = {
      callPhone: meta.callPhone,
      callStarted: telecomCallStarted({ before, after, app: APP }),
      placedBy: placed?.createdBy ?? null,
    };
    return withBreaks(breaks, { status: PASSED, evidence: [], details });
  },
  s7: ({ meta, records, files, breaks }) => {
    const { status, evidence, ...details } = judgeS7({ records, breaks });
    return { status, evidence, details: { ...details, processEnded: processEndedOf(meta, files) } };
  },
  // S8: the crash log and the alignment check are read first (review loop 2).
  // Either failing is final, even when the shots cannot be read, and beside
  // any break; without them, what cannot be read makes the run invalid.
  s8: ({ meta, records, files, breaks }) => {
    const android = meta.platform === 'android';
    const crashes = android
      ? readCrashes({ platform: 'android', text: need(files, 'crash.txt'), app: APP })
      : (meta.crashReports ?? []).flatMap((name) =>
          readCrashes({ platform: 'ios', text: need(files, name), app: APP }),
        );
    let alignment = null;
    let alignmentError = null;
    if (android) {
      try {
        alignment = alignmentOf(meta, files);
      } catch (error) {
        alignmentError = error;
      }
    }
    const final = [];
    if (crashes.length > 0) final.push(`${crashes.length} crash(es) of the app in its crash log`);
    if (alignment?.aligned16k === false) {
      final.push('the native libraries are not aligned for 16 KB pages');
    }
    let result;
    try {
      if (alignmentError !== null) throw alignmentError;
      result = judgeS8({
        platform: meta.platform,
        shots: shotsOf(meta, files),
        sentinel: FIXED.sentinel,
        crashes,
        processRunning: meta.processRunning,
        ...(android ? { aligned16k: alignment.aligned16k } : {}),
      });
    } catch (error) {
      if (final.length === 0) throw error;
      result = {
        status: FAILED,
        shots: [],
        problems: [...final, `the rest could not be judged: ${error.message}`],
      };
    }
    const details = { shots: result.shots, problems: result.problems };
    if (alignment !== null) details.alignment = alignment;
    if (meta.capture) Object.assign(details, s8Capture({ meta, records, files }));
    const evidence = result.status === FAILED ? result.problems : [];
    return withBreaks(
      breaks,
      { status: result.status, evidence, details },
      { always: final.length > 0 },
    );
  },
};

const invalid = (why) => ({ status: INVALID, evidence: [why], details: {} });

/** Why the driver's exit was not a clean one, or null when it was. */
function exitProblem(exit) {
  if (exit?.code === 0 && (exit.signal ?? null) === null) return null;
  if (typeof exit?.signal === 'string' && exit.signal !== '') {
    return `the driver was killed by ${exit.signal} before it exited, so the run did not finish as written`;
  }
  if (Number.isInteger(exit?.code)) {
    return `the driver exited with code ${exit.code}, so the run did not finish as written`;
  }
  return "the driver's exit is not known, so the run may not have finished as written";
}

function judgeSaved({ meta, records, files }) {
  if (meta === null || typeof meta !== 'object') {
    return invalid('the run left no meta.json: the driver did not finish');
  }
  if (!Array.isArray(records)) return invalid('the run left no receiver records');
  try {
    const own = meta.breaks ?? [];
    if (!Array.isArray(own) || own.some((found) => typeof found !== 'string' || found === '')) {
      throw new Error("meta.json's breaks must be a list of descriptions");
    }
    const pmset = files?.['pmset.txt'];
    if (typeof pmset !== 'string') {
      throw new Error('the run has no pmset.txt, so whether the Mac slept is unknown');
    }
    const breaks = [...own, ...readSleeps({ text: pmset, from: meta.startedAt, to: meta.endedAt })];
    const judge = JUDGES[meta.scenario];
    if (judge === undefined) throw new Error(`there is no judge for scenario ${meta.scenario}`);
    const result = judge({ meta, records, files, breaks });
    if (result.status === INVALID && result.evidence.length === 0) {
      return { ...result, evidence: ['the judge found the run invalid without saying why'] };
    }
    return result;
  } catch (error) {
    return invalid(`not judged: ${error.message}`);
  }
}

/**
 * Judges one run's saved folder. Never throws.
 * @param {{ meta: object | null, records: object[] | null,
 *   files: Record<string, string | Uint8Array>, exit: { code: number | null, signal: string | null } }} input
 *   `files`: each saved file by name, as text (screenshots as bytes), and
 *   capture.txt, the text of `tcpdump -tt -nn -r` on meta.capture
 * @returns {{ status: 'passed' | 'failed' | 'invalid', evidence: string[], details: object }}
 */
export function judgeRun({ meta = null, records = null, files = {}, exit } = {}) {
  let result;
  try {
    result = judgeSaved({ meta, records, files });
  } catch (error) {
    result = invalid(`not judged: ${error?.message ?? String(error)}`);
  }
  const problem = exitProblem(exit);
  if (problem === null) return result;
  const details = {
    ...result.details,
    exit: { code: exit?.code ?? null, signal: exit?.signal ?? null },
  };
  // A failure the records show is final, whatever the driver did after it.
  if (result.status === FAILED)
    return { ...result, evidence: [...result.evidence, problem], details };
  return { status: INVALID, evidence: [...result.evidence, problem], details };
}
