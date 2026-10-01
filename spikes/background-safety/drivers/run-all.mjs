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
//   node drivers/run-all.mjs --night night-YYYYMMDD-s1-exempt --only s1/android/exempt
//                                                     only that case, twice, in a night of its
//                                                     own (with --plan: its plan)
//
// The rules (D-060, AC13):
// - every run is judged from what it saved, however its driver exited: a
//   failure its records show is failed; a driver that threw or timed out
//   with no failure shown is invalid (the safety review's B2c);
// - invalid (the harness broke): that run is repeated, at most twice extra
//   per case; beyond that the case stops, and the manifest says why;
// - failed: never repeated. It is recorded, and the plan moves on;
// - restarted with the same --night, it skips what the manifest already
//   holds. A run folder of the night with no line in the manifest (the runner
//   stopped during it) is judged as it was left and recorded as interrupted.
// - the emulator is stopped after each run with a capture, so the next run
//   cannot write into its pcap, and after any invalid Android run, so a hung
//   emulator is never reused.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import * as android from './lib/android.mjs';
import * as ios from './lib/ios.mjs';
import { judgeRunFolder } from './lib/judge.mjs';
import { BLOCKS, EXTRAS, isJudged, planned, runFolder } from './lib/plan.mjs';
import { BUILDS, REPOSITORY, RUNS, SPIKE, fixed, sleep } from './lib/run.mjs';

const MIN = 60_000;

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
async function selfChecks(slots) {
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
    [
      `every planned case has its driver (${[...new Set(slots.map((slot) => slot.key))].length} case(s))`,
      slots.every((slot) =>
        existsSync(join(SPIKE, 'drivers', `${slot.scenario}-${slot.platform}.mjs`)),
      ),
    ],
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

/**
 * Stops the emulator and waits for it to be gone. A hung emulator does not
 * answer `adb emu kill`, so after a minute its process is killed outright
 * (the code review, 2026-10-01).
 */
async function stopEmulator(say) {
  const alive = () => succeeds('pgrep', ['-f', 'qemu-system']);
  if (!alive()) return;
  succeeds(android.ADB_PATH, ['emu', 'kill']);
  for (let i = 0; i < 30 && alive(); i += 1) await sleep(2000);
  if (alive()) {
    say('the emulator did not answer adb emu kill; killing its process');
    succeeds('pkill', ['-9', '-f', 'qemu-system']);
    for (let i = 0; i < 15 && alive(); i += 1) await sleep(2000);
  }
  say(`emulator stopped: ${!alive()}`);
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

/**
 * The night's run folders with no line in the manifest: the runner stopped
 * while they ran. Each with the slot it belongs to, so it can be recorded.
 */
function unrecordedFolders(night, manifest, slots) {
  if (!existsSync(RUNS)) return [];
  const recorded = new Set(manifest.filter((e) => e.kind === 'run').map((e) => e.runId));
  const found = [];
  for (const name of readdirSync(RUNS)) {
    const folder = runFolder(night, name);
    if (folder === null || recorded.has(name)) continue;
    const slot = slots.find((candidate) => candidate.key === folder.key);
    if (slot !== undefined) found.push({ runId: name, slot, attempt: folder.attempt });
  }
  return found.sort((a, b) => a.attempt - b.attempt);
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
      only: { type: 'string' },
    },
  });
  let slots = planned();
  if (values.only !== undefined) {
    slots = planned([...BLOCKS, ...EXTRAS]).filter((slot) => slot.key === values.only);
    if (slots.length === 0) {
      const keys = [...new Set(planned([...BLOCKS, ...EXTRAS]).map((slot) => slot.key))];
      throw new Error(`--only: no case ${values.only}; the cases are ${keys.join(', ')}`);
    }
  }
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
  if (!night || !/^(night|smoke)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(night)) {
    throw new Error(
      '--night must be given as night-YYYYMMDD, or night-YYYYMMDD-<name> (or use --plan or --smoke)',
    );
  }

  const dir = join(RUNS, night);
  const manifestFile = join(dir, 'manifest.jsonl');
  // A night holds one plan: the full night, or one --only case. Resuming it
  // with another would mix its runs into a manifest they do not belong to.
  const before = readManifest(manifestFile);
  const keys = new Set(slots.map((slot) => slot.key));
  const otherPlan = before.some(
    (entry) =>
      (entry.kind === 'runner' && entry.event === 'started' && entry.only !== values.only) ||
      (entry.kind === 'run' && !keys.has(entry.key)),
  );
  if (otherPlan) {
    throw new Error(
      `${night} already holds another plan's runs: give this one a night of its own ` +
        '(for example night-YYYYMMDD-s1-exempt). Nothing was run.',
    );
  }
  mkdirSync(join(dir, 'logs'), { recursive: true });
  const record = (entry) => appendFileSync(manifestFile, `${JSON.stringify(entry)}\n`);
  const say = (line) => {
    const text = `${new Date().toISOString()} ${line}\n`;
    process.stdout.write(text);
    appendFileSync(join(dir, 'runner.log'), text);
  };
  // The Mac stays awake between runs too.
  spawn('caffeinate', ['-dims', '-w', String(process.pid)], { stdio: 'ignore' });

  const checks = await selfChecks(slots);
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
  record({
    kind: 'runner',
    event: 'started',
    at: Date.now(),
    smoke: values.smoke === true,
    ...(values.only === undefined ? {} : { only: values.only }),
  });

  // A run the runner was stopped during: judged as it was left, never re-used.
  for (const { runId, slot, attempt } of unrecordedFolders(
    night,
    readManifest(manifestFile),
    slots,
  )) {
    const result = judgeRunFolder(join(RUNS, runId), { code: null, signal: null });
    const manifest = readManifest(manifestFile);
    const ofCase = manifest.filter((entry) => entry.kind === 'run' && entry.key === slot.key);
    const open = planned(values.only === undefined ? BLOCKS : [...BLOCKS, ...EXTRAS])
      .filter((candidate) => candidate.key === slot.key)
      .find(
        (candidate) =>
          !ofCase.some((entry) => entry.repeat === candidate.repeat && entry.status !== 'invalid'),
      );
    const interrupted =
      'the runner stopped during this run: it was judged from what it saved, ' +
      'with no exit from its driver';
    record({
      kind: 'run',
      key: slot.key,
      repeat: open?.repeat ?? slot.repeat,
      attempt,
      runId,
      scenario: slot.scenario,
      platform: slot.platform,
      case: slot.case,
      tcpdump: slot.tcpdump,
      judged: isJudged(slot),
      interrupted: true,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      status: result.status,
      evidence: [interrupted, ...result.evidence],
      details: result.details,
    });
    say(`${runId}: interrupted earlier; recorded as ${result.status}`);
  }

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

      // Folders already used by this case, recorded or not, are never reused.
      const attempt = Math.max(ofCase.length, ...ofCase.map((entry) => entry.attempt ?? 0)) + 1;
      const runId = `${night}-${slot.scenario}-${slot.platform}${slot.case ? `-${slot.case}` : ''}-${attempt}`;
      const logFile = join(dir, 'logs', `${runId}.log`);
      say(
        `${runId}: starting (${slot.key} #${slot.repeat}${slot.tcpdump ? ', with capture' : ''}, timeout ${slot.timeout} min)`,
      );
      const startedAt = Date.now();
      const exit = await runDriver(slot, runId, logFile, say);
      const endedAt = Date.now();
      // A capture's emulator stops before the run is judged, so its pcap is
      // complete when tcpdump reads it (the code review, loop 2).
      if (slot.tcpdump) await stopEmulator(say);
      // Judged however the driver exited: a failure it saved is final (B2c).
      const result = judgeRunFolder(join(RUNS, runId), exit);
      if (exit.code !== 0) {
        result.evidence = [...result.evidence, `the driver's log ends: ${tail(logFile)}`];
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
        signal: exit.signal ?? null,
        status: result.status,
        evidence: result.evidence,
        details: result.details,
      });
      say(
        `${runId}: ${result.status}${result.evidence.length ? ` (${result.evidence[0].slice(0, 160)})` : ''}`,
      );
      // A capture's emulator was stopped above, so no later run writes into its
      // pcap; an invalid Android run's emulator may be hung, so it goes too.
      if (slot.platform === 'android' && result.status === 'invalid') await stopEmulator(say);
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
