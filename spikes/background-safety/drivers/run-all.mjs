#!/usr/bin/env node
// SPIKE-01-AC13: runs every counted run unattended, one device at a time: the
// Android block, then the iOS block, each case twice. Each run is judged with
// the analysis as soon as it ends (drivers/lib/judge.mjs) and written to the
// night's manifest, ~/spike-runs/<night>/manifest.jsonl. Nothing is left out.
//
//   node drivers/run-all.mjs --night night-YYYYMMDD   the night's runs (resumable)
//   node drivers/run-all.mjs --plan                   the plan and its expected time; runs nothing
//   node drivers/run-all.mjs --smoke                  one short real run (S6 Android "without"),
//                                                     under a smoke- id, in its own manifest
//
// The rules (D-060, AC13):
// - invalid (the harness broke, the driver threw or timed out): that run is
//   repeated, at most twice extra per case; beyond that the case stops, and
//   the manifest says why;
// - failed: never repeated. It is recorded, and the plan moves on;
// - restarted with the same --night, it skips what the manifest already holds.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, closeSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import * as android from './lib/android.mjs';
import * as ios from './lib/ios.mjs';
import { judgeRun } from './lib/judge.mjs';
import { BUILDS, REPOSITORY, RUNS, SPIKE, fixed, sleep } from './lib/run.mjs';

const MIN = 60_000;

/**
 * The plan: the go/no-go scenarios first in each block (S1, S3, S4, S7, and the
 * AC12 capture), then the findings (S2, S5, S6, S8). `repeat` is the planned
 * run's number within its case; each case is run twice. One of each pair of
 * S1 and S8 runs on Android carries the network capture.
 */
const BLOCKS = [
  {
    platform: 'android',
    runs: [
      { scenario: 's1', tcpdump: true, minutes: 50, timeout: 75 },
      { scenario: 's1', minutes: 49, timeout: 70 },
      ...twice({ scenario: 's3', case: 'exempt', minutes: 50, timeout: 70 }),
      ...twice({ scenario: 's3', case: 'not-exempt', minutes: 50, timeout: 70 }),
      ...twice({ scenario: 's4', minutes: 13, timeout: 25 }),
      ...twice({ scenario: 's7', case: 'background', minutes: 9, timeout: 20 }),
      ...twice({ scenario: 's7', case: 'fine', minutes: 9, timeout: 20 }),
      ...twice({ scenario: 's2', case: 'swipe', minutes: 15.5, timeout: 30 }),
      ...twice({ scenario: 's2', case: 'lmk', minutes: 15.5, timeout: 30 }),
      ...twice({ scenario: 's2', case: 'forcestop', minutes: 15.5, timeout: 30 }),
      ...twice({ scenario: 's5', minutes: 2, timeout: 10 }),
      ...twice({ scenario: 's6', case: 'without', minutes: 1.5, timeout: 8 }),
      ...twice({ scenario: 's6', case: 'with', minutes: 1.5, timeout: 8 }),
      { scenario: 's8', tcpdump: true, minutes: 5, timeout: 15 },
      { scenario: 's8', minutes: 3, timeout: 12 },
    ],
  },
  {
    platform: 'ios',
    runs: [
      ...twice({ scenario: 's1', minutes: 50, timeout: 70 }),
      ...twice({ scenario: 's4', minutes: 14, timeout: 25 }),
      ...twice({ scenario: 's7', case: 'always-to-inuse', minutes: 9, timeout: 20 }),
      ...twice({ scenario: 's2', minutes: 16, timeout: 30 }),
      ...twice({ scenario: 's5', minutes: 3, timeout: 10 }),
      ...twice({ scenario: 's8', minutes: 3, timeout: 12 }),
    ],
  },
];

function twice(run) {
  return [run, { ...run }];
}

/** Each planned run with its platform, its case key and its number within the case. */
function planned() {
  const slots = [];
  for (const { platform, runs } of BLOCKS) {
    const seen = new Map();
    for (const run of runs) {
      const key = caseKey({ platform, scenario: run.scenario, case: run.case ?? null });
      const repeat = (seen.get(key) ?? 0) + 1;
      seen.set(key, repeat);
      slots.push({ platform, case: null, tcpdump: false, ...run, repeat, key });
    }
  }
  return slots;
}

const caseKey = ({ platform, scenario, case: name }) => `${scenario}/${platform}/${name ?? '-'}`;

/** S2's Force stop is recorded, not judged (AC6). */
const isJudged = (slot) => !(slot.scenario === 's2' && slot.case === 'forcestop');

/** The builds from 20545d9, as recorded when they were built and downloaded. */
const EXPECTED = {
  apk: '46d27eef369372b66425e46062db67db1665b6e8914603623c08d8eff7ebe2f9',
  iosArtifact: 'ee5775f0817ea609423f8929c57fcc5ab860e31eaf59c6cd5160ebbd89d60fdd',
  iosExecutable: 'e5cdcab71a9806525b77e8700b97f8443d0baaf39e692182a372a1f19940b034',
  iosBundle: '65ea9ba698aab729971ad3646aeea243745cad6c166dbec2c94d8823c466efd0',
  easBuildId: 'b08e812d-83af-4ec3-b5b5-054732269185',
  commit: '20545d9',
};

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const succeeds = (command, args) => {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const output = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

/** Every check, each with what it found. The night does not start if any fails. */
async function selfChecks() {
  const json = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {});
  const androidInfo = json(join(BUILDS, 'android-build.json'));
  const iosInfo = json(join(BUILDS, 'ios-build.json'));
  const hash = (file) => (existsSync(file) ? sha256(file) : 'missing');
  const checks = [
    ['Colima is stopped', !succeeds('colima', ['status'])],
    ['the Mac is on AC power', output('pmset', ['-g', 'batt']).includes("'AC Power'")],
    ['no Android emulator is running', !succeeds('pgrep', ['-f', 'qemu-system'])],
    [
      'no iOS simulator is booted',
      !output('xcrun', ['simctl', 'list', 'devices', 'booted']).includes('(Booted)'),
    ],
    [`port ${fixed.receiverPort} is free`, await portFree(fixed.receiverPort)],
    [
      'the Android build is 20545d9 with its recorded sha256',
      androidInfo.commit === EXPECTED.commit && hash(android.APK) === EXPECTED.apk,
    ],
    [
      'the iOS build is EAS b08e812d from 20545d9 with its recorded sha256s',
      iosInfo.easBuildId === EXPECTED.easBuildId &&
        String(iosInfo.commit).startsWith(EXPECTED.commit) &&
        hash(join(BUILDS, 'ios/SPIKE01-simulator.tar.gz')) === EXPECTED.iosArtifact &&
        hash(join(ios.APP, 'SPIKE01')) === EXPECTED.iosExecutable &&
        hash(join(ios.APP, 'main.jsbundle')) === EXPECTED.iosBundle,
    ],
    [
      'Maestro 2.10.0 is cached',
      existsSync(join(REPOSITORY, 'node_modules/.cache/maestro/2.10.0/maestro/bin/maestro')),
    ],
    [
      'JDK 17 is in ~/jdks',
      existsSync(join(homedir(), 'jdks/jdk-17.0.20.1+1/Contents/Home/bin/java')),
    ],
    ['tcpdump is installed', existsSync('/usr/sbin/tcpdump')],
  ];
  return checks.map(([what, ok]) => ({ what, ok: Boolean(ok) }));
}

/** The manifest's records so far. */
function readManifest(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Stops whatever a killed driver may have left: the receiver, Maestro, and the device state. */
async function cleanUp(slot, say) {
  for (const pid of output('lsof', ['-nP', `-iTCP:${fixed.receiverPort}`, '-sTCP:LISTEN', '-t'])
    .split('\n')
    .filter(Boolean)) {
    succeeds('kill', ['-TERM', pid]);
  }
  succeeds('pkill', ['-f', 'maestro']);
  const log = (step, detail) => say(`cleanup ${step} ${JSON.stringify(detail ?? {})}`);
  const run = { log, addBreak: () => {} };
  try {
    if (slot.platform === 'android') {
      android.resetDevice(run);
      android.shell('pm clear org.example.spike.backgroundsafety');
    } else {
      ios.resetDevice(run, ios.deviceId());
    }
  } catch (error) {
    say(`cleanup could not reset the device: ${error.message}`);
  }
  await sleep(3000);
}

/** Stops the emulator and waits for it to be gone. */
async function stopEmulator(say) {
  if (!succeeds('pgrep', ['-f', 'qemu-system'])) return;
  succeeds(join(homedir(), 'Library/Android/sdk/platform-tools/adb'), ['emu', 'kill']);
  for (let i = 0; i < 30 && succeeds('pgrep', ['-f', 'qemu-system']); i += 1) await sleep(2000);
  say(`emulator stopped: ${!succeeds('pgrep', ['-f', 'qemu-system'])}`);
}

function shutDownSimulators(say) {
  succeeds('xcrun', ['simctl', 'shutdown', 'all']);
  say('simulators shut down');
}

/** Runs one driver, with its timeout. Resolves with its exit code, or null when it was killed. */
function runDriver(slot, runId, logFile, say) {
  const args = [join(SPIKE, 'drivers', `${slot.scenario}-${slot.platform}.mjs`), '--run-id', runId];
  if (slot.case) args.push('--case', slot.case);
  if (slot.tcpdump) args.push('--tcpdump');
  const fd = openSync(logFile, 'a');
  const child = spawn(process.execPath, args, { cwd: SPIKE, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      say(`${runId}: timed out after ${slot.timeout} min; stopping it`);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000);
    }, slot.timeout * MIN);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

/** The tail of a driver's log, for the evidence of a run that threw. */
function tail(file) {
  if (!existsSync(file)) return '';
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const failure = lines.findIndex((line) => line.startsWith('driver failed:'));
  return (failure >= 0 ? lines.slice(failure, failure + 3) : lines.slice(-3))
    .join(' | ')
    .slice(0, 600);
}

function printPlan(slots) {
  let total = 0;
  for (const slot of slots) {
    total += slot.minutes;
    const name = `${slot.platform.padEnd(8)}${slot.scenario} ${(slot.case ?? '').padEnd(16)}#${slot.repeat}${slot.tcpdump ? ' +capture' : ''}${isJudged(slot) ? '' : ' (recorded, not judged)'}`;
    process.stdout.write(
      `${name.padEnd(56)} ~${String(slot.minutes).padStart(4)} min  (timeout ${slot.timeout} min)\n`,
    );
  }
  const hours = (minutes) => `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`;
  const per = (platform) =>
    slots.filter((s) => s.platform === platform).reduce((sum, s) => sum + s.minutes, 0);
  process.stdout.write(
    `\n${slots.length} runs. Expected: Android ${hours(per('android'))}, iOS ${hours(per('ios'))}, ` +
      `in all ${hours(total)}.\nEach invalid run is repeated, at most twice extra per case, which adds its time.\n`,
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      night: { type: 'string' },
      plan: { type: 'boolean', default: false },
      smoke: { type: 'boolean', default: false },
    },
  });
  let slots = planned();
  if (values.plan) {
    printPlan(slots);
    return;
  }
  let night = values.night;
  if (values.smoke) {
    // A named smoke night (--smoke --night smoke-…) resumes that manifest.
    night =
      values.night ??
      `smoke-${new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, 'Z')}`;
    if (!night.startsWith('smoke-'))
      throw new Error('a smoke run keeps out of the night: --night smoke-…');
    slots = [
      {
        platform: 'android',
        scenario: 's6',
        case: 'without',
        tcpdump: false,
        minutes: 1.5,
        timeout: 8,
        repeat: 1,
        key: 's6/android/without',
      },
    ];
  }
  if (!night || !/^(night|smoke)-[A-Za-z0-9]+$/.test(night)) {
    throw new Error('--night must be given as night-YYYYMMDD (or use --plan or --smoke)');
  }

  const dir = join(RUNS, night);
  mkdirSync(join(dir, 'logs'), { recursive: true });
  const manifestFile = join(dir, 'manifest.jsonl');
  const record = (entry) => appendFileSync(manifestFile, `${JSON.stringify(entry)}\n`);
  const say = (line) => {
    const text = `${new Date().toISOString()} ${line}\n`;
    process.stdout.write(text);
    appendFileSync(join(dir, 'runner.log'), text);
  };
  // The Mac stays awake between runs too.
  spawn('caffeinate', ['-dims', '-w', String(process.pid)], { stdio: 'ignore' });

  const checks = await selfChecks();
  for (const { what, ok } of checks) say(`self-check ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (checks.some((check) => !check.ok)) {
    record({
      kind: 'runner',
      event: 'self-check-failed',
      at: Date.now(),
      failed: checks.filter((c) => !c.ok).map((c) => c.what),
    });
    throw new Error('a self-check failed: nothing was run');
  }
  record({ kind: 'runner', event: 'started', at: Date.now(), smoke: values.smoke === true });

  let platform = null;
  for (const slot of slots) {
    for (;;) {
      const manifest = readManifest(manifestFile);
      const ofCase = manifest.filter((entry) => entry.kind === 'run' && entry.key === slot.key);
      const ofSlot = ofCase.filter((entry) => entry.repeat === slot.repeat);
      if (ofSlot.some((entry) => entry.status !== 'invalid')) break;
      if (manifest.some((entry) => entry.kind === 'case-stopped' && entry.key === slot.key)) break;
      const invalid = ofCase.filter((entry) => entry.status === 'invalid').length;
      if (invalid > 2) {
        const reason = `${invalid} invalid runs: the case has had its two extra runs`;
        record({
          kind: 'case-stopped',
          key: slot.key,
          platform: slot.platform,
          scenario: slot.scenario,
          case: slot.case,
          at: Date.now(),
          reason,
        });
        say(`${slot.key}: stopped, ${reason}`);
        break;
      }

      if (platform !== slot.platform) {
        if (slot.platform === 'ios') await stopEmulator(say);
        else shutDownSimulators(say);
        platform = slot.platform;
      }
      if (slot.tcpdump) await stopEmulator(say);

      const attempt = ofCase.length + 1;
      const runId = `${night}-${slot.scenario}-${slot.platform}${slot.case ? `-${slot.case}` : ''}-${attempt}`;
      const logFile = join(dir, 'logs', `${runId}.log`);
      say(
        `${runId}: starting (${slot.key} #${slot.repeat}${slot.tcpdump ? ', with capture' : ''}, timeout ${slot.timeout} min)`,
      );
      const startedAt = Date.now();
      const exit = await runDriver(slot, runId, logFile, say);
      const endedAt = Date.now();
      let result;
      if (exit.code === 0) {
        result = judgeRun(join(RUNS, runId));
      } else {
        const why =
          exit.code === null
            ? `killed (${exit.signal}) after its timeout`
            : `exited with ${exit.code}`;
        result = {
          status: 'invalid',
          evidence: [`the driver ${why}: ${tail(logFile)}`],
          details: {},
        };
        await cleanUp(slot, say);
      }
      record({
        kind: 'run',
        key: slot.key,
        repeat: slot.repeat,
        attempt,
        runId,
        scenario: slot.scenario,
        platform: slot.platform,
        case: slot.case,
        tcpdump: slot.tcpdump,
        judged: isJudged(slot),
        startedAt,
        endedAt,
        exitCode: exit.code,
        status: result.status,
        evidence: result.evidence,
        details: result.details,
      });
      say(
        `${runId}: ${result.status}${result.evidence.length ? ` (${result.evidence[0].slice(0, 160)})` : ''}`,
      );
      await sleep(5000);
      if (result.status !== 'invalid') break;
    }
  }
  await stopEmulator(say);
  shutDownSimulators(say);
  record({ kind: 'runner', event: 'finished', at: Date.now() });
  say(`finished. Summary: node drivers/summarize.mjs --night ${night}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`run-all failed: ${error?.stack ?? error}\n`);
    process.exit(1);
  },
);
