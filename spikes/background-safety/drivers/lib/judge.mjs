// SPIKE-01: judges one run's directory with the analysis. Thin glue: it reads
// the files the driver saved and hands them to the tested readers and judges.
// It decides nothing itself, except how S5 and S6's outputs map to one status,
// which is written out below.
//
// Every run's breaks are the driver's own (meta.json) plus the Mac's sleeps
// in its window (readSleeps on pmset.txt). A reader that refuses its input
// means the harness did not produce what the scenario needs: the run is
// invalid, with the refusal as its evidence.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { judgeCapture, listDestinations } from '../../analysis/capture.mjs';
import {
  readAndroidAlert,
  readAndroidReminders,
  readIosAlert,
  readIosReminders,
} from '../../analysis/notifications.mjs';
import { readSleeps } from '../../analysis/pmset.mjs';
import { judgeS1 } from '../../analysis/s1.mjs';
import { judgeS2 } from '../../analysis/s2.mjs';
import { judgeS3 } from '../../analysis/s3.mjs';
import { judgeS4, readHeld } from '../../analysis/s4.mjs';
import { checkAlert, judgeAndroidAlert, readAudio } from '../../analysis/s5.mjs';
import { readTelecom, telecomCallStarted } from '../../analysis/s6.mjs';
import { judgeS7 } from '../../analysis/s7.mjs';
import { judgeS8, readCrashes } from '../../analysis/s8.mjs';
import { APP_ID, fixed } from './run.mjs';

/** The emulator's network, as the capture sees it with Wi-Fi off (drivers/lib/journey.mjs). */
const EMULATOR_NETWORK = {
  device: ['10.0.2.15'],
  receiver: { address: '10.0.2.2', port: fixed.receiverPort },
  resolver: { address: '10.0.2.3', port: 53 },
};
const KARTVERKET = ['cache.kartverket.no'];

const text = (dir, name) => readFileSync(join(dir, name), 'utf8');
const json = (dir, name) => JSON.parse(text(dir, name));

function receiverRecords(dir) {
  const file = readdirSync(dir).find((name) => /^receiver-\d+\.jsonl$/.test(name));
  if (file === undefined) throw new Error('the run has no receiver records');
  return text(dir, file)
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const captureText = (dir) =>
  execFileSync('tcpdump', ['-nn', '-r', join(dir, 'capture.pcap')], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

/** What each scenario's judge makes of the run: { status, evidence, details }. */
const JUDGES = {
  s1: ({ dir, meta, breaks }) => {
    const result = judgeS1({ records: receiverRecords(dir), breaks });
    const details = {
      largestGapMs: result.largestGapMs,
      gapsOver60s: result.gapsOver60s,
      gapsOver120s: result.gapsOver120s,
      stateChanges: result.stateChanges,
    };
    if (meta.capture) {
      // AC12, judged on its own: it does not change S1's verdict.
      const capture = judgeCapture({ text: captureText(dir), ...EMULATOR_NETWORK });
      details.capture = {
        status: capture.status,
        problems: capture.problems,
        flagged: capture.flagged,
      };
    }
    return { status: result.status, evidence: result.evidence, details };
  },
  s2: ({ dir, meta, breaks }) => {
    const title = fixed.reminder.title;
    const reminders =
      meta.platform === 'android'
        ? readAndroidReminders({ text: text(dir, 'notification.txt'), app: APP_ID, title })
        : readIosReminders({ text: text(dir, 'delivered.json'), title });
    const result = judgeS2({ records: receiverRecords(dir), reminders, breaks });
    const { status, evidence, ...details } = result;
    return { status, evidence, details };
  },
  s3: ({ dir, meta, breaks }) => {
    const result = judgeS3({
      exemption: meta.exemption,
      records: receiverRecords(dir),
      breaks,
      inForce: meta.inForce,
    });
    const { status, evidence, ...details } = result;
    return { status, evidence, details };
  },
  s4: ({ dir, breaks }) => {
    const records = receiverRecords(dir);
    const held = readHeld({ text: text(dir, 'held.json'), records });
    const { status, evidence, ...details } = judgeS4({ records, held, breaks });
    return { status, evidence, details: { held: held.length, ...details } };
  },
  // S5: one status from two findings. Failed when the alert was not shown, or
  // when the records show its sound went to a muted stream; "heard" not shown
  // on simulators leaves it passed, and says so in the details.
  s5: ({ dir, meta, breaks }) => {
    if (meta.platform === 'android') {
      const alert = readAndroidAlert({
        text: text(dir, 'notification.txt'),
        app: APP_ID,
        title: fixed.alert.title,
      });
      const judged = judgeAndroidAlert({
        alert,
        audio: readAudio(text(dir, 'audio.txt')),
        app: APP_ID,
      });
      const failed = judged.shown === 'failed' || judged.heard === 'failed';
      return withBreaks(breaks, {
        status: failed ? 'failed' : 'passed',
        evidence: [],
        details: judged,
      });
    }
    const alert = readIosAlert({
      received: text(dir, 'received.json'),
      delivered: text(dir, 'delivered.json'),
      title: fixed.alert.title,
    });
    const checked = checkAlert({
      expected: { payload: json(dir, 'payload.json'), text: fixed.alert.body },
      delivered: alert.alert,
    });
    const passed = checked.status === 'passed' && alert.presented;
    return withBreaks(breaks, {
      status: passed ? 'passed' : 'failed',
      evidence: [],
      details: { payload: checked.status, problems: checked.problems, presented: alert.presented },
    });
  },
  // S6: the behaviour is recorded, not scored (AC10): a run passes once
  // Telecom's record was read, and says whether the tap alone started a call.
  s6: ({ dir, meta, breaks }) => {
    const callStarted = telecomCallStarted({
      before: readTelecom(text(dir, 'telecom-before.txt')),
      after: readTelecom(text(dir, 'telecom.txt')),
      app: APP_ID,
    });
    return withBreaks(breaks, {
      status: 'passed',
      evidence: [],
      details: { callPhone: meta.callPhone, callStarted },
    });
  },
  s7: ({ dir, breaks }) => {
    const { status, evidence, ...details } = judgeS7({ records: receiverRecords(dir), breaks });
    return { status, evidence, details };
  },
  s8: ({ dir, meta, breaks }) => {
    const crashes =
      meta.platform === 'android'
        ? readCrashes({ platform: 'android', text: text(dir, 'crash.txt'), app: APP_ID })
        : (meta.crashReports ?? []).flatMap((name) =>
            readCrashes({ platform: 'ios', text: text(dir, name), app: APP_ID }),
          );
    const shots = (meta.shots ?? []).map((shot) => ({
      zoom: shot.zoom,
      region: shot.region,
      png: readFileSync(join(dir, shot.file)),
    }));
    const result = judgeS8({
      platform: meta.platform,
      shots,
      sentinel: fixed.sentinel,
      crashes,
      processRunning: meta.processRunning,
      aligned16k: meta.aligned16k,
    });
    const details = {
      shots: result.shots,
      problems: result.problems,
    };
    if (meta.capture) {
      // Recorded, not judged (AC16).
      const listed = listDestinations({
        text: captureText(dir),
        device: EMULATOR_NETWORK.device,
        resolver: EMULATOR_NETWORK.resolver,
        kartverket: KARTVERKET,
      });
      details.destinations = listed.destinations;
      details.flagged = listed.flagged;
    }
    return withBreaks(breaks, { status: result.status, evidence: [], details });
  },
};

/** For judges that take no breaks: any break makes the run invalid. */
function withBreaks(breaks, result) {
  if (breaks.length === 0) return result;
  return { ...result, status: 'invalid', evidence: [...breaks, ...result.evidence] };
}

/**
 * Judges the run in `dir`. Never throws: whatever cannot be judged is an
 * invalid run with the reason as its evidence.
 * @returns {{ status: 'passed' | 'failed' | 'invalid', evidence: string[], details: object }}
 */
export function judgeRun(dir) {
  let meta;
  try {
    meta = json(dir, 'meta.json');
  } catch {
    return {
      status: 'invalid',
      evidence: ['the run left no meta.json: the driver did not finish'],
      details: {},
    };
  }
  try {
    const breaks = [...(meta.breaks ?? [])];
    if (!existsSync(join(dir, 'pmset.txt'))) throw new Error('the run has no pmset.txt');
    breaks.push(
      ...readSleeps({ text: text(dir, 'pmset.txt'), from: meta.startedAt, to: meta.endedAt }),
    );
    const judge = JUDGES[meta.scenario];
    if (judge === undefined) throw new Error(`no judge for scenario ${meta.scenario}`);
    const result = judge({ dir, meta, breaks });
    if (result.status === 'invalid' && result.evidence.length === 0) {
      return { ...result, evidence: ['the judge found the run invalid without saying why'] };
    }
    return result;
  } catch (error) {
    return { status: 'invalid', evidence: [`not judged: ${error.message}`], details: {} };
  }
}
