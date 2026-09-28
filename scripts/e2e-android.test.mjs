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
  readdirSync,
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
 * How the stand-in adb answers when asked the device's language, by `getprop`
 * or by `am get-config`.
 *
 * With `appliedAfter` unset, the device is set to `locale` and says so every
 * time. With it set, the device behaves as CI's emulator did in run 5 and a
 * fresh CI-identical one did on the Mac: `-change-locale nb-NO` takes effect
 * only after boot has completed. The first `appliedAfter` readings see the
 * device as it booted, with persist.sys.locale empty and the configuration
 * en-rUS; later ones see nb-NO and nb-rNO. ro.product.locale is the image's own
 * and stays en-US throughout. Infinity is a device that never applies it.
 *
 * Each reading is counted in `readCount` and its time, in milliseconds, is
 * written to `readTimes`, so a test can say how long the script kept asking.
 * Only the locale part of the configuration line was seen on the device; the
 * rest of it is illustrative.
 *
 * Amended 2026-09-27, run 6: the package service is up throughout, and
 * `service check package` says so without counting as a reading. A device
 * whose framework restarts to apply the language is `timeline`'s.
 */
function localeAnswers({ locale, appliedAfter, readCount, readTimes }) {
  const config = (qualifier) =>
    `config: mcc310-mnc260-${qualifier}-ldltr-sw411dp-w411dp-h914dp-420dpi-normal-long-notround-lowdr-nowidecg-port-notnight-finger-keysexposed-nokeys-navhidden-v37`;
  const stamp = `        "${process.execPath}" -e 'console.log(Date.now())' >> "${readTimes}"`;
  const packageService = '      *service*check*) echo "Service package: found" ;;';
  if (appliedAfter === undefined) {
    return [
      packageService,
      '      *locale*|*get-config*)',
      stamp,
      '        case "$*" in',
      `          *get-config*) echo "${config(locale.replace('-', '-r'))}" ;;`,
      `          *) echo "${locale}" ;;`,
      '        esac ;;',
    ];
  }
  const applied = appliedAfter === Infinity ? 'false' : `[ "$n" -gt ${String(appliedAfter)} ]`;
  return [
    packageService,
    '      *locale*|*get-config*)',
    stamp,
    `        n=$(/bin/cat "${readCount}" 2>/dev/null || echo 0)`,
    '        n=$((n + 1))',
    `        echo "$n" > "${readCount}"`,
    `        if ${applied}; then lang=nb-NO; qualifier=nb-rNO; else lang=''; qualifier=en-rUS; fi`,
    '        case "$*" in',
    '          *ro.product.locale*) echo en-US ;;',
    `          *get-config*) echo "${config('$qualifier')}" ;;`,
    '          *) echo "$lang" ;;',
    '        esac ;;',
  ];
}

/**
 * A device that goes through `timeline`'s phases in turn, as the Mac's did in
 * run 6's reproduction. Each phase lasts `questions` of the script's questions
 * about the device's state, counted in `readCount`: getprop of a locale, `am
 * get-config` and `service check package`. The last phase lasts for ever.
 *
 * In each phase, persist.sys.locale is `property`; `am get-config` reports
 * `configLocale`, or fails as cmd does while the activity service is gone when
 * that is empty; `service check package` says the service is `packageService`,
 * found or not found; and ro.product.locale is the image's en-US. Each call to
 * the stand-in, with the phase it came in, is written to `phaseLog`, so a test
 * can say in which phase the release build was installed. `adb install` fails,
 * as it did in run 6, while the package service is not found.
 *
 * These are the shell lines that set `phase`, `property`, `qualifier` and
 * `pkg` for this call, before anything else.
 */
function timelinePhase({ timeline, readCount, phaseLog }) {
  let upTo = 0;
  const branches = timeline.map((step, i) => {
    const set = `phase='${step.phase}'; property='${step.property}'; qualifier='${step.configLocale}'; pkg='${step.packageService}'`;
    if (i === timeline.length - 1) return timeline.length === 1 ? set : `else ${set}; fi`;
    upTo += step.questions;
    return `${i === 0 ? 'if' : 'elif'} [ "$n" -le ${String(upTo)} ]; then ${set}`;
  });
  return [
    `n=$(/bin/cat "${readCount}" 2>/dev/null || echo 0)`,
    'case "$*" in',
    `  shell*locale*|shell*get-config*|shell*service*check*) n=$((n + 1)); echo "$n" > "${readCount}" ;;`,
    'esac',
    ...branches,
    `echo "$phase adb $*" >> "${phaseLog}"`,
  ];
}

/** How the timeline's device answers the script's questions, in `shell`'s case. */
function timelineAnswers({ readTimes }) {
  return [
    '      *locale*|*get-config*|*service*check*)',
    `        "${process.execPath}" -e 'console.log(Date.now())' >> "${readTimes}"`,
    '        case "$*" in',
    '          *service*check*) echo "Service package: $pkg" ;;',
    '          *ro.product.locale*) echo en-US ;;',
    '          *get-config*)',
    `            if [ -z "$qualifier" ]; then echo "cmd: Can't find service: activity" >&2; exit 20; fi`,
    '            echo "config: mcc310-mnc260-$qualifier-ldltr-sw411dp-w411dp-h914dp-normal-long-notround-lowdr-nowidecg-port-notnight-420dpi-finger-keysexposed-nokeys-navhidden-v37"',
    '            echo "abi: x86_64" ;;',
    '          *) echo "$property" ;;',
    '        esac ;;',
  ];
}

/**
 * `adb install` on the timeline's device: run 6's failure while the package
 * service is gone, and what adb prints on success otherwise.
 *
 * Amended 2026-09-28: it printed nothing on success, which no adb does, and
 * the install is now judged by adb's Success line.
 */
const timelineInstall = [
  '  install)',
  '    if [ "$pkg" != found ]; then',
  `      echo "adb: failed to install ${APK}: cmd: Can't find service: package" >&2`,
  '      exit 1',
  '    fi',
  "    printf 'Performing Streamed Install\\nSuccess\\n' ;;",
];

/**
 * `adb install` on any other device: the n-th install answers the n-th of the
 * answers `installs` wrote to `installDir`, and the last from then on. Each
 * install is counted, and its time, in milliseconds, written to
 * `installDir`/times.
 */
function installAnswers({ installs, installDir }) {
  return [
    '  install)',
    `    k=$(/bin/cat "${installDir}/count" 2>/dev/null || echo 0)`,
    '    k=$((k + 1))',
    `    echo "$k" > "${installDir}/count"`,
    `    "${process.execPath}" -e 'console.log(Date.now())' >> "${installDir}/times"`,
    `    i=$k; if [ "$i" -gt ${String(installs.length)} ]; then i=${String(installs.length)}; fi`,
    `    /bin/cat "${installDir}/$i.out"`,
    `    /bin/cat "${installDir}/$i.err" >&2`,
    `    exit "$(/bin/cat "${installDir}/$i.exit")" ;;`,
  ];
}

/** What adb prints when the install worked. */
const INSTALL_SUCCESS = { stdout: 'Performing Streamed Install\nSuccess\n', stderr: '', exit: 0 };

/** Run 6's install failure, with the runner's path to the APK shortened. */
const RUN_6_INSTALL = {
  stdout: '',
  stderr: `adb: failed to install ${APK}: cmd: Can't find service: package\n`,
  exit: 1,
};

/** Run 8's install failure, as its job log shows it, the path shortened. */
const RUN_8_INSTALL = {
  stdout: '',
  stderr: [
    `adb: failed to install ${APK}: `,
    "Exception occurred while executing 'install':",
    "java.lang.NullPointerException: Attempt to invoke virtual method 'void android.content.pm.PackageManagerInternal.freeStorage(java.lang.String, long, int)' on a null object reference",
    '\tat com.android.server.StorageManagerService.allocateBytes(StorageManagerService.java:4299)',
    '',
  ].join('\n'),
  exit: 1,
};

/** An install that can never work, whatever the wait. Synthetic. */
const INVALID_APK = {
  stdout: 'Performing Streamed Install\n',
  stderr: `adb: failed to install ${APK}: Failure [INSTALL_FAILED_INVALID_APK: Failed to parse the package]\n`,
  exit: 1,
};

/**
 * The stand-in adb: emulators by serial, a device set to `locale` (bokmål
 * unless a test says otherwise) or one that applies bokmål only after
 * `appliedAfter` readings, or one that goes through `timeline`'s phases, and a
 * crash buffer when there is one. Amended 2026-09-28: `adb install` answers
 * `installs` in turn, and on the timeline's device, `timelineInstall`.
 */
function deviceAdbBody({
  log,
  devices,
  crashes,
  locale = 'nb-NO',
  appliedAfter,
  readCount,
  readTimes,
  timeline,
  phaseLog,
  installs,
  installDir,
}) {
  return [
    '#!/bin/sh',
    `echo "adb $*" >> "${log}"`,
    "serial=''",
    'if [ "$1" = "-s" ]; then serial="$2"; shift 2; fi',
    ...(timeline === undefined ? [] : timelinePhase({ timeline, readCount, phaseLog })),
    'case "$1" in',
    `  devices) printf 'List of devices attached\\n${devices.map(([serial, state]) => `${serial}\\t${state}\\n`).join('')}\\n' ;;`,
    '  shell)',
    '    case "$*" in',
    '      *ro.kernel.qemu*) case "$serial" in emulator-*) echo 1 ;; esac ;;',
    ...(timeline === undefined
      ? localeAnswers({ locale, appliedAfter, readCount, readTimes })
      : timelineAnswers({ readTimes })),
    '      *boot_completed*) echo 1 ;;',
    '    esac ;;',
    ...(timeline === undefined ? installAnswers({ installs, installDir }) : timelineInstall),
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
 *   localeAppliedAfter?: number,
 *   timeline?: {
 *     phase: string,
 *     questions: number,
 *     property: string,
 *     configLocale: string,
 *     packageService: string,
 *   }[],
 *   installs?: { stdout: string, stderr: string, exit: number }[],
 *   env?: Record<string, string>,
 *   timeout?: number,
 * }} options — `flows` is what Maestro's report says ran; `crash` puts a
 *   crash of the app, and one of another app, in the device's crash buffer;
 *   `locale` is the language the device reports, unless `localeAppliedAfter`
 *   makes it a device that applies bokmål only after that many readings
 *   (localeAnswers), or `timeline` one whose framework restarts to apply it
 *   (timelinePhase); `installs` is what `adb install` answers, in turn, the
 *   last one from then on (installAnswers); `env` is added to the script's
 *   environment; `timeout` is when the run is killed
 */
async function runPastPreflight({
  args = ['--skip-build'],
  devices = [['emulator-5554', 'device']],
  java = '17.0.12',
  flows = [['app-starts', 'SUCCESS']],
  maestroExit = 0,
  crash = false,
  locale = 'nb-NO',
  localeAppliedAfter,
  timeline,
  installs = [INSTALL_SUCCESS],
  env = {},
  timeout = 60_000,
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
    const readCount = path.join(dir, 'locale-reads');
    const readTimes = path.join(dir, 'locale-read-times');
    const phaseLog = path.join(dir, 'phases.log');
    const installDir = path.join(dir, 'installs');

    mkdirSync(installDir, { recursive: true });
    installs.forEach(({ stdout, stderr, exit }, i) => {
      writeFileSync(path.join(installDir, `${String(i + 1)}.out`), stdout);
      writeFileSync(path.join(installDir, `${String(i + 1)}.err`), stderr);
      writeFileSync(path.join(installDir, `${String(i + 1)}.exit`), String(exit));
    });

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
      writeTool(
        file,
        deviceAdbBody({
          log,
          devices,
          crashes,
          locale,
          appliedAfter: localeAppliedAfter,
          readCount,
          readTimes,
          timeline,
          phaseLog,
          installs,
          installDir,
        }),
      );
    }
    for (const file of [path.join(bin, 'java'), path.join(jdk, 'bin', 'java')]) {
      writeTool(file, ['#!/bin/sh', `echo "java $*" >> "${log}"`, javaBody(java)].join('\n'));
    }
    writeTool(
      path.join(bin, 'pnpm'),
      ['#!/bin/sh', `echo "pnpm $*" >> "${log}"`, 'exit 1'].join('\n'),
    );

    // Set in full: no MAESTRO_ or EXPO_ variable comes from the caller, so
    // whatever Maestro is run with, the script set. `env` adds only what a
    // test names.
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: {
        PATH: bin,
        HOME: path.join(dir, 'home'),
        ANDROID_HOME: sdk,
        ANDROID_SDK_ROOT: sdk,
        JAVA_HOME: jdk,
        ...env,
      },
      timeout,
    });
    const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : []);
    const readAt = lines(readTimes).map(Number);
    return {
      code: result.status,
      signal: result.signal,
      // From the device's first language reading to its last, in milliseconds.
      askedFor: readAt.length === 0 ? 0 : Math.max(...readAt) - Math.min(...readAt),
      stdout: result.stdout,
      stderr: result.stderr,
      output: `${result.stdout}${result.stderr}`,
      calls: lines(log),
      maestroRuns: lines(envLog).map((line) => {
        const [maestroArgs = '', updateCheck = '', analytics = ''] = line.split('\t');
        return { args: maestroArgs, updateCheck, analytics };
      }),
      crashBuffer: lines(crashes),
      // With a timeline: every call to adb, and the phase the device was in.
      phaseCalls: lines(phaseLog).map((line) => {
        const [phase = '', ...call] = line.split(' ');
        return { phase, call: call.join(' ') };
      }),
      // Without one: when each `adb install` began, in milliseconds.
      installTimes: lines(path.join(installDir, 'times')).map(Number),
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

/** The calls that asked the device for its language. */
const isLocaleRead = (call) => /^adb\b.*(?:\blocale\b|\bget-config\b)/.test(call);

/** The calls that ran the flows. */
const isFlowRun = (call) => /^maestro\b.*\btest\b/.test(call);

/**
 * The wait for bokmål, shortened for these tests: a one-second deadline, read
 * every 100 ms. Only tests set these variables. The production deadline is at
 * least 60 s (lib/e2e-android.test.mjs), and a test below holds that no
 * workflow or package script sets them.
 */
const SHORT_DEADLINE = 1_000;
const SHORT_INTERVAL = 100;
const SHORT_WAIT = {
  E2E_ANDROID_LOCALE_DEADLINE_MS: String(SHORT_DEADLINE),
  E2E_ANDROID_LOCALE_INTERVAL_MS: String(SHORT_INTERVAL),
};

/**
 * How long a run that waited out SHORT_DEADLINE kept asking the device, at the
 * least: one interval off for a wait that stops when the next reading would be
 * late, and two for the stand-in's own start-up, which stamps each reading. A
 * run that does not wait asks for a few milliseconds at most.
 */
const WAITED_OUT = SHORT_DEADLINE - 3 * SHORT_INTERVAL;

/** A message that states `ms` as a duration, in seconds, minutes or milliseconds. */
function saysHowLong(ms) {
  const forms = [
    `${String(ms / 1000).replace('.', '\\.')}(?:\\.0+)? ?s(?:ec(?:ond)?s?)?`,
    `${String(ms).replace(/\B(?=(\d{3})+$)/g, '[ ,.\\u00a0]?')} ?ms`,
  ];
  if (ms % 60_000 === 0) forms.push(`${String(ms / 60_000)} ?min(?:ute)?s?`);
  return new RegExp(`(?<![\\d.])(?:${forms.join('|')})\\b`);
}

// Added 2026-09-27, run 6 of android-e2e (run 36309631129, job 108592943641).
// The emulator booted, e2e:android printed `e2e:android: The device's language
// is nb-NO.`, and 0.16 s later `adb … install -r …/app-release.apk` failed with
// `adb: failed to install …: cmd: Can't find service: package`. The Mac, on a
// fresh CI-identical device, one row per change:
//
//   t+73s  boot=1 locale=       config=en-rUS package=found     system_server=739
//   t+103s boot=1 locale=nb-NO  config=       package=found     system_server=
//   t+104s boot=1 locale=nb-NO  config=       package=not found system_server=
//   t+106s boot=1 locale=nb-NO  config=       package=not found system_server=4228
//   t+107s boot=1 locale=nb-NO  config=       package=found     system_server=4228
//   t+109s boot=1 locale=nb-NO  config=nb-rNO package=found     system_server=4228
//
// `locale` is getprop persist.sys.locale; `config` the locale on `am
// get-config`'s `config:` line; `package` what `service check package` says.
// persist.sys.locale flips a second or two before Android restarts its
// framework to apply it, and sys.boot_completed stays 1 throughout. An earlier
// recording had the property at nb-NO from t+92 s and the framework gone only
// from t+94 s, which is `property-flipped` below.

/** The Mac's recording, as timelinePhase plays it. */
const MAC_RECORDING = [
  { phase: 'booted', questions: 4, property: '', configLocale: 'en-rUS', packageService: 'found' },
  {
    phase: 'property-flipped',
    questions: 4,
    property: 'nb-NO',
    configLocale: 'en-rUS',
    packageService: 'found',
  },
  {
    phase: 'framework-stopping',
    questions: 2,
    property: 'nb-NO',
    configLocale: '',
    packageService: 'found',
  },
  {
    phase: 'framework-down',
    questions: 4,
    property: 'nb-NO',
    configLocale: '',
    packageService: 'not found',
  },
  {
    phase: 'package-back',
    questions: 3,
    property: 'nb-NO',
    configLocale: '',
    packageService: 'found',
  },
  {
    phase: 'ready',
    questions: Infinity,
    property: 'nb-NO',
    configLocale: 'nb-rNO',
    packageService: 'found',
  },
];

/** A device whose property says nb-NO, and whose framework never restarts to apply it. */
const PROPERTY_ONLY = [
  { phase: 'booted', questions: 4, property: '', configLocale: 'en-rUS', packageService: 'found' },
  {
    phase: 'property-flipped',
    questions: Infinity,
    property: 'nb-NO',
    configLocale: 'en-rUS',
    packageService: 'found',
  },
];

/** A device whose configuration says bokmål, and whose package service never comes back. */
const PACKAGE_NEVER_BACK = [
  { phase: 'booted', questions: 2, property: '', configLocale: 'en-rUS', packageService: 'found' },
  {
    phase: 'package-missing',
    questions: Infinity,
    property: 'nb-NO',
    configLocale: 'nb-rNO',
    packageService: 'not found',
  },
];

/**
 * A message that says the package service was not there. Near the word
 * "package", so a message that says something else is missing does not count.
 */
const PACKAGE_MISSING =
  /\bpackage\b[^.\n]{0,40}?\b(?:not found|missing|unavailable|absent|gone|down|not there|not running|not available|not up)\b|\b(?:no|missing|can't find|cannot find|could not find)\b[^.\n]{0,20}?\bpackage\b/i;

/** The calls, in the timeline's log, that installed onto the device. */
const isInstall = ({ call }) => /^adb\b.*\binstall\b/.test(call);

// Added 2026-09-28. Run 8 of android-e2e (run 36324362689, job 108634139466),
// on code identical to the green run 7, printed `The device's language is
// nb-rNO, and its package service is up.` Then `adb install -r …` failed with
// run 8's NullPointerException in PackageManagerInternal.freeStorage, as
// RUN_8_INSTALL has it; run 6's had failed with `cmd: Can't find service:
// package`. On the Mac, on fresh CI-identical devices, the first boot in
// bokmål refused installs for a while after the device reported ready: 17 s
// after boot_completed one failed, and 80 s later one succeeded. A reboot after
// the switch did not help; later boots installed straight away, 6 of 6; with
// no language switch the install after the first boot worked; and the emulator
// refuses `-prop persist.sys.locale=…` ("only 'qemu.*' properties are
// supported"). So the script waits, up to a deadline, while the install fails
// with one of those two, and for nothing else. The flows still run once.

/** The calls, in the stand-ins' log, that installed onto the device. */
const isInstallCall = (call) => /^adb\b.*\binstall\b/.test(call);

/**
 * The wait for the install, shortened for these tests as the wait for bokmål
 * is: a one-second deadline, tried every 250 ms. Only tests set these
 * variables. The production deadline is at least 60 s (lib/e2e-android.test.mjs),
 * and a test below holds that no workflow or package script sets them.
 */
const SHORT_INSTALL_DEADLINE = 1_000;
const SHORT_INSTALL_INTERVAL = 250;
const SHORT_INSTALL_WAIT = {
  E2E_ANDROID_INSTALL_DEADLINE_MS: String(SHORT_INSTALL_DEADLINE),
  E2E_ANDROID_INSTALL_INTERVAL_MS: String(SHORT_INSTALL_INTERVAL),
};

/** A message that says the install was tried `n` times: "7 attempts", "tried 7 times". */
function saysAttempts(n) {
  return new RegExp(
    `(?<![\\d.])${String(n)} ?(?:install(?:ation)? )?(?:attempts?|tries|times)\\b|\\b(?:attempts?|tries)\\b:? ?${String(n)}(?![\\d.])`,
    'i',
  );
}

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
    // Amended 2026-09-27: it now waits for bokmål before it stops, so this run
    // has the tests' one-second deadline, and it stops after the wait, not at
    // once: it asks more than once, and keeps asking for that long.
    const { code, output, calls, askedFor } = await runPastPreflight({
      locale: 'en-US',
      env: SHORT_WAIT,
    });

    // Not vacuous: the device was asked for its language.
    // Amended 2026-09-27, run 6: asked through the configuration, `am
    // get-config`, and no longer through persist.sys.locale, which says nb-NO
    // before the framework has restarted to apply it.
    expect(
      calls.some((call) => /^adb\b.*\bam get-config\b/.test(call)),
      output,
    ).toBe(true);
    expect(calls.filter(isLocaleRead).length, output).toBeGreaterThan(1);
    expect(askedFor, output).toBeGreaterThanOrEqual(WAITED_OUT);
    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(output).toMatch(/bokmål/);
    expect(output).not.toMatch(/flows? passed/);
    expect(calls.filter((call) => /^maestro\b.*\btest\b/.test(call))).toEqual([]);
    expect(touchedDevice(calls)).toEqual([]);
  });

  // Added 2026-09-27. Run 5 of android-e2e (run 36306264081) booted the
  // emulator, started with `-change-locale nb-NO`, at 08:41:46, and at 08:42:06
  // e2e:android stopped on its first reading: `e2e:android: The device's
  // language is "en-US", but the flows expect Norwegian bokmål (nb-NO). Set the
  // emulator to nb-NO; in CI, android-e2e does.` On the Mac, a fresh device
  // identical to CI's showed persist.sys.locale empty, ro.product.locale en-US
  // and `am get-config` en-rUS straight after sys.boot_completed=1, and nb-NO
  // and nb-rNO about 20 s later. localeAnswers plays that device.

  test('INF-06-AC9: when the emulator applies bokmål only after it has booted, it waits for it, and then the flows run', async () => {
    const { code, output, calls } = await runPastPreflight({
      localeAppliedAfter: 3,
      env: { ...SHORT_WAIT, E2E_ANDROID_LOCALE_DEADLINE_MS: '20000' },
    });

    expect(code, output).toBe(0);
    expect(output).toMatch(/\b1 of 1 flows? passed/);
    // It read past the three answers the device gave as it booted, and only
    // then ran the flows.
    expect(calls.filter(isLocaleRead).length, output).toBeGreaterThan(3);
    expect(calls.findIndex(isFlowRun), output).toBeGreaterThan(calls.findLastIndex(isLocaleRead));
  });

  test('INF-06-AC9: when the emulator never applies bokmål, it stops after the deadline, says it waited, how long, bokmål and what the device reports, and runs no flow', async () => {
    const { code, stderr, output, calls, askedFor } = await runPastPreflight({
      localeAppliedAfter: Infinity,
      env: SHORT_WAIT,
    });

    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    // It waited: it asked more than once, and kept asking until the deadline.
    expect(calls.filter(isLocaleRead).length, output).toBeGreaterThan(1);
    expect(askedFor, output).toBeGreaterThanOrEqual(WAITED_OUT);
    // And it says so where a failure is said.
    expect(stderr, output).toMatch(/bokmål/);
    expect(stderr, output).toMatch(/\bwait/i);
    expect(stderr, output).toMatch(saysHowLong(SHORT_DEADLINE));
    // What the device reports: ro.product.locale's en-US, or the configuration's en-rUS.
    expect(stderr, output).toMatch(/\ben[-_]r?US\b/);
    expect(output).not.toMatch(/flows? passed/);
    expect(calls.filter(isFlowRun)).toEqual([]);
    expect(touchedDevice(calls)).toEqual([]);
  });

  test("INF-06-AC9: without the tests' shorter deadline, it is still waiting for bokmål after 4 s, not failing at once", async () => {
    // The production deadline, at least 60 s, is what the script uses when no
    // test shortens it. Killed at 4 s, it must still be waiting.
    const { code, signal, output, calls } = await runPastPreflight({
      localeAppliedAfter: Infinity,
      timeout: 4_000,
    });

    // Not vacuous: it got as far as asking the device for its language.
    expect(calls.filter(isLocaleRead).length, output).toBeGreaterThan(0);
    expect(code, `it finished within 4 s, with exit code ${String(code)}:\n${output}`).toBeNull();
    expect(signal).toBe('SIGTERM');
    expect(calls.filter(isFlowRun)).toEqual([]);
  });

  test("INF-06-AC9: on the Mac's recording, where persist.sys.locale says nb-NO before the framework restarts, it installs only once the configuration says nb-rNO and the package service is found, and the flows run", async () => {
    const { code, output, calls, phaseCalls } = await runPastPreflight({
      timeline: MAC_RECORDING,
      env: { ...SHORT_WAIT, E2E_ANDROID_LOCALE_DEADLINE_MS: '20000' },
    });
    const installs = phaseCalls.filter(isInstall);

    // Installed, and only once the restarted framework reported bokmål and
    // could install: never in the window run 6 installed in.
    expect(installs.length, output).toBeGreaterThan(0);
    expect(
      installs.map(({ phase }) => phase),
      output,
    ).toEqual(installs.map(() => 'ready'));
    // Not vacuous: it asked the two questions that decide, and kept asking
    // while the framework was down.
    expect(
      calls.some((call) => /^adb\b.*\bam get-config\b/.test(call)),
      output,
    ).toBe(true);
    expect(
      calls.some((call) => /^adb\b.*\bservice check package\b/.test(call)),
      output,
    ).toBe(true);
    expect(
      phaseCalls.map(({ phase }) => phase),
      output,
    ).toContain('framework-down');
    expect(code, output).toBe(0);
    expect(output).toMatch(/\b1 of 1 flows? passed/);
  });

  test('INF-06-AC9: when persist.sys.locale says nb-NO but the framework never restarts to apply it, it installs nothing, and after the deadline says the configuration is en-rUS and the package service was found', async () => {
    const { code, stderr, output, calls, askedFor } = await runPastPreflight({
      timeline: PROPERTY_ONLY,
      env: SHORT_WAIT,
    });

    expect(touchedDevice(calls), output).toEqual([]);
    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(askedFor, output).toBeGreaterThanOrEqual(WAITED_OUT);
    expect(stderr, output).toMatch(/bokmål/);
    expect(stderr, output).toMatch(/\bwait/i);
    expect(stderr, output).toMatch(saysHowLong(SHORT_DEADLINE));
    // What it last saw: the configuration's language, and the package service there.
    expect(stderr, output).toMatch(/\ben[-_]r?US\b/);
    expect(stderr, output).toMatch(/\bpackage\b/i);
    expect(stderr, output).not.toMatch(PACKAGE_MISSING);
    expect(output).not.toMatch(/flows? passed/);
  });

  test('INF-06-AC9: when the configuration says nb-rNO but the package service never comes back, it installs nothing, and after the deadline says the package service was not found', async () => {
    const { code, stderr, output, calls, askedFor } = await runPastPreflight({
      timeline: PACKAGE_NEVER_BACK,
      env: SHORT_WAIT,
    });

    expect(touchedDevice(calls), output).toEqual([]);
    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(askedFor, output).toBeGreaterThanOrEqual(WAITED_OUT);
    expect(stderr, output).toMatch(/bokmål/);
    expect(stderr, output).toMatch(/\bwait/i);
    expect(stderr, output).toMatch(saysHowLong(SHORT_DEADLINE));
    // What it last saw: bokmål in the configuration, and no package service.
    expect(stderr, output).toMatch(/\bnb[-_]r?NO\b/);
    expect(stderr, output).toMatch(PACKAGE_MISSING);
    expect(output).not.toMatch(/flows? passed/);
  });

  test('INF-06-AC9: only the tests shorten the waits for bokmål and for the install: no workflow and no package script sets their variables', () => {
    // Amended 2026-09-28: the install's wait has variables of its own.
    const workflows = readdirSync(path.join(REPO, '.github', 'workflows'))
      .filter((name) => /\.ya?ml$/.test(name))
      .map((name) => readFileSync(path.join(REPO, '.github', 'workflows', name), 'utf8'));
    const packages = ['package.json', path.join(APP, 'package.json')].map((file) =>
      readFileSync(path.join(REPO, file), 'utf8'),
    );

    // Not vacuous: these are the files that run e2e:android.
    expect(workflows.join('\n')).toMatch(/\be2e:android\b/);
    expect(packages.join('\n')).toMatch(/\be2e:android\b/);
    for (const text of [...workflows, ...packages]) {
      expect(text).not.toMatch(/\bE2E_ANDROID_LOCALE_/);
      expect(text).not.toMatch(/\bE2E_ANDROID_INSTALL_/);
    }
  });

  test('INF-06-AC9: when the install fails as in run 8 and then as in run 6 before it works, it waits for the package manager, shows each attempt, and then runs the flows, once', async () => {
    const { code, output, calls, installTimes } = await runPastPreflight({
      installs: [RUN_8_INSTALL, RUN_6_INSTALL, INSTALL_SUCCESS],
      env: SHORT_INSTALL_WAIT,
    });

    expect(calls.filter(isInstallCall).length, output).toBe(3);
    // Each not-ready attempt is in the log, where CI shows it.
    expect(output).toContain('PackageManagerInternal');
    expect(output).toContain("Can't find service: package");
    // Tried again a whole interval later, not straight away. Each install is
    // stamped as it starts, and the next starts only after this one ended and
    // the interval passed; 2 ms is for the clock's rounding.
    const gaps = installTimes.slice(1).map((t, i) => t - (installTimes[i] ?? Infinity));
    expect(gaps.length, output).toBe(2);
    for (const gap of gaps) {
      expect(gap, `gaps between installs: ${gaps.join(', ')} ms`).toBeGreaterThanOrEqual(
        SHORT_INSTALL_INTERVAL - 2,
      );
    }
    // A wait for the device, not a retry of a flow: the flows ran once, after the install worked.
    expect(calls.filter(isFlowRun).length, output).toBe(1);
    expect(calls.findIndex(isFlowRun), output).toBeGreaterThan(calls.findLastIndex(isInstallCall));
    expect(code, output).toBe(0);
    expect(output).toMatch(/\b1 of 1 flows? passed/);
  });

  test('INF-06-AC9: when the install is still not ready at the deadline, it stops, says how long it waited, how many attempts and what adb said last, and runs no flow', async () => {
    const { code, stderr, output, calls, installTimes } = await runPastPreflight({
      installs: [RUN_6_INSTALL, RUN_8_INSTALL],
      env: SHORT_INSTALL_WAIT,
    });
    const installs = calls.filter(isInstallCall);

    // It waited: it tried more than the two answers, and kept trying until the deadline.
    expect(installs.length, output).toBeGreaterThan(2);
    expect((installTimes.at(-1) ?? 0) - (installTimes[0] ?? 0), output).toBeGreaterThanOrEqual(
      SHORT_INSTALL_DEADLINE - 3 * SHORT_INSTALL_INTERVAL,
    );
    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(stderr, output).toMatch(/\bwait/i);
    expect(stderr, output).toMatch(saysHowLong(SHORT_INSTALL_DEADLINE));
    expect(stderr, output).toMatch(saysAttempts(installs.length));
    // What adb said last: run 8's exception, which the first answer did not have.
    expect(stderr, output).toContain('PackageManagerInternal');
    expect(output).not.toMatch(/flows? passed/);
    expect(calls.filter(isFlowRun)).toEqual([]);
  });

  test('INF-06-AC9: when the install fails with INSTALL_FAILED_INVALID_APK, it stops at once with what adb said: one install, and no flow', async () => {
    // The production deadline and interval, and a second install that would
    // work: an install tried again would be seen, and the flows would run.
    const { code, stderr, output, calls } = await runPastPreflight({
      installs: [INVALID_APK, INSTALL_SUCCESS],
    });

    expect(calls.filter(isInstallCall).length, output).toBe(1);
    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(stderr, output).toContain('INSTALL_FAILED_INVALID_APK');
    expect(output).not.toMatch(/flows? passed/);
    expect(calls.filter(isFlowRun)).toEqual([]);
  });

  test("INF-06-AC9: without the tests' shorter install deadline, it is still waiting for the package manager after 6 s, not failing at once", async () => {
    // The production deadline, at least 60 s, is what the script uses when no
    // test shortens it. Killed at 6 s, it must still be waiting.
    const { code, signal, output, calls } = await runPastPreflight({
      installs: [RUN_8_INSTALL],
      timeout: 6_000,
    });

    // Not vacuous: it got as far as installing.
    expect(calls.filter(isInstallCall).length, output).toBeGreaterThan(0);
    expect(code, `it finished within 6 s, with exit code ${String(code)}:\n${output}`).toBeNull();
    expect(signal).toBe('SIGTERM');
    expect(calls.filter(isFlowRun)).toEqual([]);
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
