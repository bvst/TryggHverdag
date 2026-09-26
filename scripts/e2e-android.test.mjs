// req-coverage: fixtures-only — the IDs below name gates and decisions, not product requirements.
//
// INF-06-AC9: `node scripts/e2e-android.mjs` as a real process, the way
// daily-status.test.mjs runs its script: stand-in `adb` and `java` on PATH,
// each logging how it was called, so a test can say what never happened.
//
// These are the runs that must stop before anything is built, installed or
// run on a device. Each one exits non-zero with a message saying which
// precondition failed, rather than a stack trace or, worse, a pass.
//
// The environment is set in full, never inherited. A test that inherits the
// runner's GITHUB_* variables, JAVA_HOME or ANDROID_HOME tests the machine it
// runs on, not the script (docs/progress.md, "a test that spawns a script
// inherits the runner's environment"). PATH holds the stand-ins and nothing
// else, so the machine's own adb and java cannot answer in their place.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { APK, ensureMaestro } from './lib/e2e-android.mjs';

const SCRIPT = path.resolve('scripts/e2e-android.mjs');

/** A shell script at `file` that logs its call and then runs `body`. */
function standIn(file, log, name, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, ['#!/bin/sh', `echo "${name} $*" >> "${log}"`, body, ''].join('\n'));
  chmodSync(file, 0o755);
}

/** `adb` answering `devices` with these lines, and `getprop` with this locale. */
function adbBody(devices, locale) {
  return [
    'if [ "$1" = "-s" ]; then shift 2; fi',
    'case "$1" in',
    `  devices) printf 'List of devices attached\\n${devices.map(([serial, state]) => `${serial}\\t${state}\\n`).join('')}\\n' ;;`,
    '  shell)',
    '    case "$*" in',
    `      *locale*) echo "${locale}" ;;`,
    '      *boot_completed*) echo 1 ;;',
    '    esac ;;',
    'esac',
    'exit 0',
  ].join('\n');
}

/** `java`, printing the version the way a real one does for -version and --version. */
function javaBody(version) {
  return [
    'case "$1" in',
    `  --version) echo "openjdk ${version} 2024-01-16" ;;`,
    `  *) echo 'openjdk version "${version}" 2024-01-16' >&2 ;;`,
    'esac',
    'exit 0',
  ].join('\n');
}

/**
 * Runs the entry script with no arguments: the whole run, preflight first.
 *
 * @param {{ devices?: [string, string][], java?: string, locale?: string }} machine
 *   `devices` undefined means no adb at all; `java` undefined means no Java.
 */
function runE2e({ devices, java, locale = 'nb-NO' }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'e2e-android-run-'));
  try {
    const bin = path.join(dir, 'bin');
    const sdk = path.join(dir, 'android-sdk');
    const jdk = path.join(dir, 'jdk');
    const log = path.join(dir, 'calls.log');
    mkdirSync(bin, { recursive: true });
    const env = {
      PATH: bin,
      HOME: path.join(dir, 'home'),
      ANDROID_HOME: sdk,
      ANDROID_SDK_ROOT: sdk,
      EXPO_NO_TELEMETRY: '1',
      MAESTRO_CLI_NO_ANALYTICS: '1',
    };
    if (devices !== undefined) {
      for (const file of [path.join(bin, 'adb'), path.join(sdk, 'platform-tools', 'adb')]) {
        standIn(file, log, 'adb', adbBody(devices, locale));
      }
    }
    if (java !== undefined) {
      for (const file of [path.join(bin, 'java'), path.join(jdk, 'bin', 'java')]) {
        standIn(file, log, 'java', javaBody(java));
      }
      env.JAVA_HOME = jdk;
    }
    const result = spawnSync(process.execPath, [SCRIPT], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env,
      timeout: 60_000,
    });
    return {
      code: result.status,
      output: `${result.stdout}${result.stderr}`,
      calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Something was built, installed or tested. None of these runs may get that far. */
const didWork = (calls) =>
  calls.filter((call) => /\binstall\b|\bmaestro\b|\bgradle|\bprebuild\b/.test(call));

describe('the entry script stops before it does anything when', () => {
  test('INF-06-AC9: no Android device is connected, and it says so', () => {
    const { code, output, calls } = runE2e({ devices: [], java: '17.0.12' });

    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(output).toMatch(/no Android device/i);
    expect(output).not.toMatch(/flows? passed/);
    expect(didWork(calls)).toEqual([]);
  });

  test('INF-06-AC9: adb is not there at all, and it names adb or the missing device', () => {
    const { code, output, calls } = runE2e({ java: '17.0.12' });

    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(output).toMatch(/\badb\b|no Android device/i);
    expect(didWork(calls)).toEqual([]);
  });

  test('INF-06-AC9: Java is older than 17, and it says Java 17', () => {
    const { code, output, calls } = runE2e({
      devices: [['emulator-5554', 'device']],
      java: '11.0.22',
    });

    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(output).toMatch(/Java 17/);
    expect(didWork(calls)).toEqual([]);
  });

  test('INF-06-AC9: there is no Java at all, and it says Java 17', () => {
    const { code, output, calls } = runE2e({ devices: [['emulator-5554', 'device']] });

    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(output).toMatch(/Java 17/);
    expect(didWork(calls)).toEqual([]);
  });
});

// Past the preflight. These runs go as far as Maestro, so they need what the
// script reads from the repository, and a Maestro of their own. Each gets a
// scratch copy of the app: its manifest, its config, its translations and its
// flows, with the app's installed packages linked in so that the script reads
// the application ID the way it always does. The Maestro is a stand-in,
// installed through ensureMaestro where the script will look for it. It logs
// how it was called and with which Maestro settings, writes the JUnit report
// it is given, and exits with the status it is given.
//
// Nothing is built here. --skip-build installs a stand-in APK, and a `pnpm`
// on PATH logs its call and fails, so a run that would build is seen, not run.

const REPO = process.cwd();
const APP = 'apps/mobile';

/** A JUnit report as Maestro 2.10.0 writes it: one <testcase> per [name, status]. */
function junit(flows) {
  const failures = flows.filter(([, status]) => status === 'ERROR').length;
  return [
    "<?xml version='1.0' encoding='UTF-8'?>",
    '<testsuites>',
    `  <testsuite name="Test Suite" device="emulator-5554" tests="${String(flows.length)}" failures="${String(failures)}" time="31" timestamp="2026-09-26T09:00:00">`,
    ...flows.map(
      ([name, status]) =>
        `    <testcase id="${name}" name="${name}" classname="${name}" file="apps/mobile/e2e/${name}.yaml" time="21" timestamp="2026-09-26T09:00:02" status="${status}"/>`,
    ),
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

/**
 * What the device's crash buffer holds once the flow has run: a crash of
 * another app, PID 3131, and one of the app under test, PID 4242. All of it is
 * synthetic (RG-07). "$app" is the application ID Maestro was given.
 */
const CRASH_BUFFER = [
  '--------- beginning of crash',
  '09-26 21:14:03.512  3131  3131 E AndroidRuntime: FATAL EXCEPTION: main',
  '09-26 21:14:03.512  3131  3131 E AndroidRuntime: Process: com.example.weather, PID: 3131',
  '09-26 21:14:03.512  3131  3131 E AndroidRuntime: java.lang.IllegalStateException: synthetic crash in another app',
  '09-26 21:14:03.512  3131  3131 E AndroidRuntime: \tat com.example.weather.MainActivity.onCreate',
  '09-26 21:14:07.880  4242  4242 E AndroidRuntime: FATAL EXCEPTION: main',
  '09-26 21:14:07.880  4242  4242 E AndroidRuntime: Process: $app, PID: 4242',
  '09-26 21:14:07.880  4242  4242 E AndroidRuntime: java.lang.RuntimeException: synthetic crash in the app under test',
];

/** The stand-in Maestro. */
function maestroBody({ log, envLog, report, crashes, exit }) {
  const quote = (line) => `'${line.replace(/'/g, "'\\''")}'`;
  return [
    '#!/bin/sh',
    `echo "maestro $*" >> "${log}"`,
    `printf '%s\\t%s\\t%s\\n' "$*" "\${MAESTRO_DISABLE_UPDATE_CHECK-<unset>}" "\${MAESTRO_CLI_NO_ANALYTICS-<unset>}" >> "${envLog}"`,
    'if [ "$1" = "--version" ]; then echo "2.10.0"; exit 0; fi',
    "out=''",
    "app=''",
    "prev=''",
    'for arg in "$@"; do',
    '  case "$prev" in',
    '    --output) out="$arg" ;;',
    '    -e|--env) case "$arg" in APP_ID=*) app="${arg#APP_ID=}" ;; esac ;;',
    '  esac',
    '  case "$arg" in --output=*) out="${arg#--output=}" ;; esac',
    '  prev="$arg"',
    'done',
    `if [ -n "$out" ]; then /bin/cat "${report}" > "$out"; fi`,
    ...(crashes === undefined
      ? []
      : [
          `printf '%s\\n' ${CRASH_BUFFER.map((line) => quote(line).replace('$app', '\'"$app"\'')).join(' ')} > "${crashes}"`,
        ]),
    `exit ${String(exit)}`,
  ].join('\n');
}

/**
 * The stand-in adb: emulators by serial, a device set to `locale` (bokmål
 * unless a test says otherwise), and a crash buffer when there is one.
 */
function deviceAdbBody({ log, devices, crashes, locale = 'nb-NO' }) {
  return [
    '#!/bin/sh',
    `echo "adb $*" >> "${log}"`,
    "serial=''",
    'if [ "$1" = "-s" ]; then serial="$2"; shift 2; fi',
    'case "$1" in',
    `  devices) printf 'List of devices attached\\n${devices.map(([serial, state]) => `${serial}\\t${state}\\n`).join('')}\\n' ;;`,
    '  shell)',
    '    case "$*" in',
    '      *ro.kernel.qemu*) case "$serial" in emulator-*) echo 1 ;; esac ;;',
    `      *locale*) echo "${locale}" ;;`,
    '      *boot_completed*) echo 1 ;;',
    '    esac ;;',
    '  logcat)',
    "    pattern=''",
    "    prev=''",
    '    for arg in "$@"; do',
    '      if [ "$prev" = "-e" ]; then pattern="$arg"; fi',
    '      case "$arg" in --regex=*) pattern="${arg#--regex=}" ;; esac',
    '      prev="$arg"',
    '    done',
    `    if [ -f "${crashes}" ]; then`,
    `      if [ -n "$pattern" ]; then /usr/bin/grep -E -e "$pattern" "${crashes}"; else /bin/cat "${crashes}"; fi`,
    '    fi ;;',
    'esac',
    'exit 0',
  ].join('\n');
}

/** A stand-in written to `file`, executable. */
function writeTool(file, body) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${body}\n`);
  chmodSync(file, 0o755);
}

/**
 * Runs the entry script past its preflight, against the stand-ins.
 *
 * @param {{
 *   args?: string[],
 *   devices?: [string, string][],
 *   java?: string,
 *   flows?: [string, string][],
 *   maestroExit?: number,
 *   crash?: boolean,
 *   locale?: string,
 * }} options — `flows` is what Maestro's report says ran; `crash` puts a
 *   crash of the app, and one of another app, in the device's crash buffer;
 *   `locale` is the language the device reports
 */
async function runPastPreflight({
  args = ['--skip-build'],
  devices = [['emulator-5554', 'device']],
  java = '17.0.12',
  flows = [['app-starts', 'SUCCESS']],
  maestroExit = 0,
  crash = false,
  locale = 'nb-NO',
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'e2e-android-past-preflight-'));
  try {
    const root = path.join(dir, 'repo');
    const bin = path.join(dir, 'bin');
    const sdk = path.join(dir, 'android-sdk');
    const jdk = path.join(dir, 'jdk');
    const log = path.join(dir, 'calls.log');
    const envLog = path.join(dir, 'maestro-env.log');
    const report = path.join(dir, 'report-to-write.xml');
    const crashes = path.join(dir, 'crash-buffer.txt');

    for (const file of [
      'package.json',
      'app.config.ts',
      'src/shared/translations/nb.json',
      'src/shared/translations/en.json',
    ]) {
      mkdirSync(path.dirname(path.join(root, APP, file)), { recursive: true });
      copyFileSync(path.join(REPO, APP, file), path.join(root, APP, file));
    }
    cpSync(path.join(REPO, APP, 'e2e'), path.join(root, APP, 'e2e'), { recursive: true });
    symlinkSync(path.join(REPO, APP, 'node_modules'), path.join(root, APP, 'node_modules'), 'dir');
    mkdirSync(path.dirname(path.join(root, APK)), { recursive: true });
    writeFileSync(path.join(root, APK), 'a stand-in for the release build');

    writeFileSync(report, junit(flows));
    const archive = Buffer.from('a stand-in for maestro.zip');
    await ensureMaestro({
      root,
      sha256: createHash('sha256').update(archive).digest('hex'),
      fetchArchive: () => Promise.resolve(archive),
      extract: (_archive, into) => {
        writeTool(
          path.join(into, 'maestro', 'bin', 'maestro'),
          maestroBody({
            log,
            envLog,
            report,
            crashes: crash ? crashes : undefined,
            exit: maestroExit,
          }),
        );
      },
    });

    for (const file of [path.join(bin, 'adb'), path.join(sdk, 'platform-tools', 'adb')]) {
      writeTool(file, deviceAdbBody({ log, devices, crashes, locale }));
    }
    for (const file of [path.join(bin, 'java'), path.join(jdk, 'bin', 'java')]) {
      writeTool(file, ['#!/bin/sh', `echo "java $*" >> "${log}"`, javaBody(java)].join('\n'));
    }
    writeTool(
      path.join(bin, 'pnpm'),
      ['#!/bin/sh', `echo "pnpm $*" >> "${log}"`, 'exit 1'].join('\n'),
    );

    // Set in full: no MAESTRO_ or EXPO_ variable comes from the caller, so
    // whatever Maestro is run with, the script set.
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: {
        PATH: bin,
        HOME: path.join(dir, 'home'),
        ANDROID_HOME: sdk,
        ANDROID_SDK_ROOT: sdk,
        JAVA_HOME: jdk,
      },
      timeout: 60_000,
    });
    const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : []);
    return {
      code: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      output: `${result.stdout}${result.stderr}`,
      calls: lines(log),
      maestroRuns: lines(envLog).map((line) => {
        const [maestroArgs = '', updateCheck = '', analytics = ''] = line.split('\t');
        return { args: maestroArgs, updateCheck, analytics };
      }),
      crashBuffer: lines(crashes),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Reports that do not show a pass, though Maestro exited 0. Kept out of the
 * test.each call: the test counter reads a table only up to its first `)`.
 */
const REPORT_PROBLEMS = [
  { what: 'no flow ran', flows: [], problem: /no flows ran/i },
  {
    what: 'a flow ended in ERROR',
    flows: [['app-starts', 'ERROR']],
    problem: /\bapp-starts \(ERROR\)/,
  },
  {
    what: 'a flow was CANCELED',
    flows: [['app-starts', 'CANCELED']],
    problem: /\bapp-starts \(CANCELED\)/,
  },
];

/** Calls that install onto a device, read its logs, or run a flow. */
const touchedDevice = (calls) =>
  calls.filter(
    (call) => /^adb\b.*\b(install|logcat)\b/.test(call) || /^maestro\b.*\btest\b/.test(call),
  );

describe('past the preflight', () => {
  test('INF-06-AC9: when every flow passed and Maestro exited 0, it passes and says how many flows ran', async () => {
    // The control for the tests below: the stand-ins are enough for a pass.
    const { code, output, calls } = await runPastPreflight();

    expect(code, output).toBe(0);
    expect(output).toMatch(/\b1 of 1 flows? passed/);
    expect(calls.some((call) => /^maestro\b.*\btest\b/.test(call))).toBe(true);
  });

  test('INF-06-AC9: Maestro exiting 1 fails the run though its report shows every flow passed, and the message names both', async () => {
    // Amended 2026-09-26. The report is written as flows finish, so a report
    // that says SUCCESS does not show that Maestro itself got to the end.
    const { code, stderr, output, calls } = await runPastPreflight({ maestroExit: 1 });

    expect(
      calls.some((call) => /^maestro\b.*\btest\b/.test(call)),
      output,
    ).toBe(true);
    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(stderr).toMatch(/\bexit(?:ed| code| status)?\b[^\n]*\b1\b/i);
    expect(stderr).toMatch(/\breport\b/i);
  });

  // The other half of "both have to pass": Maestro exits 0, and its report
  // says the run did not pass. The exit status says nothing about any of
  // these, so each one fails on the report alone. Before these, a script that
  // called judgeReport and then ignored it passed every test here.
  test.each(REPORT_PROBLEMS)(
    'INF-06-AC9: Maestro exiting 0 does not pass the run when its report shows $what, and the message says what the report shows',
    async ({ flows, problem }) => {
      const { code, stderr, output, calls } = await runPastPreflight({ flows, maestroExit: 0 });

      // Not a preflight stop: the flows were run, and this is the report's verdict.
      expect(
        calls.some((call) => /^maestro\b.*\btest\b/.test(call)),
        output,
      ).toBe(true);
      expect(code, output).not.toBe(0);
      expect(code, 'it was killed rather than finishing').not.toBeNull();
      expect(stderr).toMatch(problem);
      expect(output).not.toMatch(/flows? passed/);
    },
  );

  test('INF-06-AC9: on a device set to en-US it stops before the flows run, and says they expect bokmål', async () => {
    // The flow asserts the bokmål strings, so on any other language it would
    // fail for a reason that says nothing about the app.
    const { code, output, calls } = await runPastPreflight({ locale: 'en-US' });

    // Not vacuous: the device was asked for its language.
    expect(
      calls.some((call) => /^adb\b.*\bgetprop\b.*\blocale\b/.test(call)),
      output,
    ).toBe(true);
    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(output).toMatch(/bokmål/);
    expect(output).not.toMatch(/flows? passed/);
    expect(calls.filter((call) => /^maestro\b.*\btest\b/.test(call))).toEqual([]);
    expect(touchedDevice(calls)).toEqual([]);
  });

  test('INF-06-AC20: every Maestro run has MAESTRO_DISABLE_UPDATE_CHECK=true and MAESTRO_CLI_NO_ANALYTICS, though the caller set neither', async () => {
    // Maestro reads the first with Boolean.parseBoolean, so only "true" turns
    // the update check off: "1" does nothing, and every run then sends a
    // persistent ID to api.copilot.mobile.dev.
    const { maestroRuns, output } = await runPastPreflight();

    expect(
      maestroRuns.some((run) => /\btest\b/.test(run.args)),
      output,
    ).toBe(true);
    for (const run of maestroRuns) {
      expect(run.updateCheck, `maestro ${run.args}`).toBe('true');
      expect(run.analytics, `maestro ${run.args}`).not.toBe('<unset>');
      expect(run.analytics, `maestro ${run.args}`).not.toBe('');
    }
  });

  test('INF-06-AC9: with only a real phone connected, it stops: nothing is installed, no flow runs, no log is read', async () => {
    // Amended 2026-09-26: it never installs onto, or reads crash logs from, a
    // real phone. The serial is made up.
    const { code, output, calls } = await runPastPreflight({
      devices: [['R5CT21ABCDE', 'device']],
    });

    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(output).toMatch(/emulator/i);
    expect(output).not.toMatch(/flows? passed/);
    expect(touchedDevice(calls)).toEqual([]);
  });

  test("INF-06-AC9: when a flow fails, the crash lines it prints are the app's, and no other app's", async () => {
    const { code, output, crashBuffer } = await runPastPreflight({
      flows: [['app-starts', 'ERROR']],
      maestroExit: 1,
      crash: true,
    });
    const theApp = crashBuffer.filter((line) => /\s4242\s/.test(line));
    const another = crashBuffer.filter((line) => /\s3131\s/.test(line));

    expect(code, output).not.toBe(0);
    // Not vacuous: the buffer held both, and the app's crash is shown.
    expect(theApp.length).toBeGreaterThan(0);
    expect(another.length).toBeGreaterThan(0);
    expect(output).toContain(theApp.find((line) => line.includes('Process:')));
    for (const line of another) {
      expect(output).not.toContain(line);
    }
    expect(output).not.toContain('com.example.weather');
  });

  test('INF-06-AC9: with Java 25 it stops before building, and says to set JAVA_HOME to a JDK 17', async () => {
    // Amended 2026-09-26: Java 25 passed a "17 or newer" check, and the native
    // build then failed after about 18 minutes.
    const { code, output, calls } = await runPastPreflight({ args: [], java: '25.0.3' });

    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(output).toMatch(/\bJAVA_HOME\b/);
    expect(output).toMatch(/\bJDK 17\b/);
    expect(didWork(calls)).toEqual([]);
  });
});
