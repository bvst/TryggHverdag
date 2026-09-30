// SPIKE-01: what every driver shares. A run is one directory under
// ~/spike-runs/<run-id>, outside the repository, holding:
// - the receiver's records (receiver-<time>.jsonl), on the Mac's real clock;
// - driver.jsonl: each step the driver took, with its wall-clock and
//   monotonic time;
// - the platform's dumps and screenshots the scenario collects;
// - pmset.txt: `pmset -g log` after the run, for readSleeps;
// - meta.json: the run's scenario, platform, case, build and breaks.
//
// Drivers only act and collect. Every verdict comes from the analysis.
// Nothing here prints a position or a request body.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const SPIKE = fileURLToPath(new URL('../../', import.meta.url));
export const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));
export const fixed = JSON.parse(readFileSync(join(SPIKE, 'app/src/fixed.json'), 'utf8'));
export const APP_ID = 'org.example.spike.backgroundsafety';
export const RUNS = join(homedir(), 'spike-runs');
export const BUILDS = join(RUNS, 'builds');

const MINUTE = 60_000;
export const minutes = (count) => count * MINUTE;
export const seconds = (count) => count * 1000;
export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A run id the runner chose (--run-id), which openRun then uses. */
let requestedRunId = null;
const RUN_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * The command line every driver takes:
 *   --dry        a short, uncounted run (its run id starts with "dry-")
 *   --case NAME  the case, for scenarios that have more than one
 *   --tcpdump    Android only: boot the emulator with a network capture (AC12, AC16)
 *   --run-id ID  the run's id and directory name, as the runner chooses it
 */
export function readArguments({ cases = [] } = {}) {
  const { values } = parseArgs({
    options: {
      dry: { type: 'boolean', default: false },
      case: { type: 'string' },
      tcpdump: { type: 'boolean', default: false },
      'run-id': { type: 'string' },
    },
  });
  if (cases.length > 0 && !cases.includes(values.case)) {
    throw new Error(`--case must be one of: ${cases.join(', ')}`);
  }
  if (cases.length === 0 && values.case !== undefined) throw new Error('this driver has no cases');
  if (values['run-id'] !== undefined) {
    if (!RUN_ID.test(values['run-id']))
      throw new Error('--run-id: letters, digits and hyphens only');
    requestedRunId = values['run-id'];
  }
  return { dry: values.dry, runCase: values.case ?? null, tcpdump: values.tcpdump };
}

const stamp = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

/** The sha256 of a file. */
function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Opens a run: its directory, a caffeinate held for the driver's life, and the
 * receiver on loopback. Returns the run's handle.
 */
export async function openRun({ scenario, platform, runCase = null, dry = false, build }) {
  const runId =
    requestedRunId ??
    [dry ? 'dry' : null, scenario, platform, runCase, stamp()].filter(Boolean).join('-');
  const dir = join(RUNS, runId);
  if (existsSync(dir)) throw new Error(`the run directory ${runId} exists already`);
  mkdirSync(dir, { recursive: true });
  const logFile = join(dir, 'driver.jsonl');
  const log = (step, detail = {}) => {
    const entry = { at: Date.now(), mono: performance.now(), step, ...detail };
    appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
    process.stdout.write(`${new Date(entry.at).toISOString()} ${step}${detailText(detail)}\n`);
  };

  // The Mac stays awake while this process lives (display, idle, disk, and
  // system sleep on power). A sleep would still show in pmset.txt.
  const caffeinate = spawn('caffeinate', ['-dims', '-w', String(process.pid)], {
    stdio: 'ignore',
  });

  // The receiver runs in its own process, on the real clock: nothing the driver
  // waits for (adb, simctl, Maestro) can delay an arrival's timestamp, and a
  // stalled receiver shows as a hole in its ticks.
  const receiver = spawn(process.execPath, [join(SPIKE, 'receiver/main.mjs'), '--run', runId], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let receiverExited = false;
  receiver.on('exit', () => {
    receiverExited = true;
  });
  const file = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the receiver did not start')), 15_000);
    receiver.stdout.setEncoding('utf8').on('data', (text) => {
      for (const line of text.split('\n').filter(Boolean)) {
        log('receiver', { line });
        const started = /records in (\S+)$/.exec(line);
        if (started) {
          clearTimeout(timer);
          resolve(started[1]);
        }
      }
    });
    receiver.stderr.setEncoding('utf8').on('data', (text) => log('receiver-error', { text }));
    receiver.on('exit', (code) => reject(new Error(`the receiver exited with ${code}`)));
  });
  const base = `http://127.0.0.1:${fixed.receiverPort}`;
  const post = async (path) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', body: '' });
    if (!response.ok) throw new Error(`the receiver answered ${path} with ${response.status}`);
  };
  const breaks = [];
  const startedAt = Date.now();
  log('run-opened', { runId, scenario, platform, runCase, dry });

  return {
    runId,
    dir,
    dry,
    log,
    /** A mark on the receiver's clock, with a label the judges read. */
    mark: async (label) => {
      await post(`/mark/${label}`);
      log('mark', { label });
    },
    /** S4 on iOS: the receiver refuses uploads until told to accept. */
    refuse: () => post('/refuse').then(() => log('receiver-refusing')),
    accept: () => post('/accept').then(() => log('receiver-accepting')),
    /** The receiver's records so far. */
    records: () =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    /** A break of the harness, word for word, for the judges (AC13). */
    addBreak: (text) => {
      breaks.push(text);
      log('break', { text });
    },
    save: (name, content) => {
      writeFileSync(join(dir, name), content);
      log('saved', { name, bytes: Buffer.byteLength(content) });
    },
    /** Closes the receiver, saves pmset's log and meta.json, and releases caffeinate. */
    close: async (meta = {}) => {
      const endedAt = Date.now();
      if (receiverExited) breaks.push('the receiver exited before the run ended');
      else {
        await new Promise((resolve) => {
          receiver.once('exit', resolve);
          receiver.kill('SIGINT');
        });
      }
      // pmset's log gives whole seconds: a log read in the same second as
      // endedAt could look read before the run ended, and be refused.
      await sleep(1500);
      try {
        writeFileSync(
          join(dir, 'pmset.txt'),
          execFileSync('pmset', ['-g', 'log'], { maxBuffer: 1 << 28 }),
        );
      } catch (error) {
        breaks.push(
          `pmset -g log could not be read (${error.code ?? error.name}), so sleeps are unknown`,
        );
      }
      const buildInfo = build === undefined ? null : describeBuild(build);
      writeFileSync(
        join(dir, 'meta.json'),
        `${JSON.stringify(
          {
            runId,
            scenario,
            platform,
            runCase,
            dry,
            startedAt,
            endedAt,
            breaks,
            build: buildInfo,
            ...meta,
          },
          null,
          2,
        )}\n`,
      );
      log('run-closed', { breaks: breaks.length });
      caffeinate.kill();
    },
  };
}

/** The build a run used: its recorded build.json and the digest of the file installed. */
function describeBuild({ file, info }) {
  return {
    ...(existsSync(info) ? JSON.parse(readFileSync(info, 'utf8')) : {}),
    installedFile: file,
    installedSha256: file.endsWith('.apk') ? digest(file) : null,
  };
}

/** Waits until `check` returns a truthy value, or throws after `timeoutMs`. */
export async function waitFor(what, check, { timeoutMs, everyMs = 2000 }) {
  const until = performance.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (performance.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(everyMs);
  }
}

/** Waits `ms` on the Mac's clock, logging why. */
export async function hold(run, ms, why) {
  run.log('hold', { why, seconds: Math.round(ms / 1000) });
  await sleep(ms);
}

function detailText(detail) {
  const keys = Object.keys(detail);
  if (keys.length === 0) return '';
  return ` ${keys.map((key) => `${key}=${JSON.stringify(detail[key])}`).join(' ')}`;
}

/** Runs the driver's body, and exits non-zero on a failure, after closing what it can. */
export function main(body) {
  body().then(
    () => process.exit(0),
    (error) => {
      process.stderr.write(`driver failed: ${error?.stack ?? error}\n`);
      process.exit(1);
    },
  );
}
