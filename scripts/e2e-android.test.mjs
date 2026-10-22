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
import { spawn, spawnSync } from 'node:child_process';
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
import { pathToFileURL } from 'node:url';
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
 *
 * Amended for BUG-17: a reading is an `am get-config`, and only that is
 * stamped and counted. Any call naming "locale" was, from before run 6, when
 * the script read persist.sys.locale; since then the script has read the
 * language from `am get-config` alone, so for today's script nothing changes.
 * The fix sets the property with `setprop persist.sys.locale nb-NO`, which
 * that pattern would have stamped and counted as a reading, and answered with
 * a language as no setprop does, and it may read the property with getprop
 * for its failure message. A setprop now prints nothing, and a getprop answers
 * without being a reading. A device that takes the switch is `switchable`'s.
 */
function localeAnswers({ locale, appliedAfter, readCount, readTimes }) {
  const config = (qualifier) =>
    `config: mcc310-mnc260-${qualifier}-ldltr-sw411dp-w411dp-h914dp-420dpi-normal-long-notround-lowdr-nowidecg-port-notnight-finger-keysexposed-nokeys-navhidden-v37`;
  const stamp = `        "${process.execPath}" -e 'console.log(Date.now())' >> "${readTimes}"`;
  const packageService = '      *service*check*) echo "Service package: found" ;;';
  const setprop = '      *setprop*) ;;';
  if (appliedAfter === undefined) {
    return [
      packageService,
      setprop,
      '      *get-config*)',
      stamp,
      `        echo "${config(locale.replace('-', '-r'))}" ;;`,
      `      *locale*) echo "${locale}" ;;`,
    ];
  }
  const applied = appliedAfter === Infinity ? 'false' : `[ "$n" -gt ${String(appliedAfter)} ]`;
  return [
    packageService,
    setprop,
    '      *locale*|*get-config*)',
    `        n=$(/bin/cat "${readCount}" 2>/dev/null || echo 0)`,
    '        case "$*" in',
    '          *get-config*)',
    `  ${stamp}`,
    '            n=$((n + 1))',
    `            echo "$n" > "${readCount}" ;;`,
    '        esac',
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
 *
 * Amended for BUG-17: a `setprop` is not a question about the device's state,
 * and prints nothing (timelineAnswers). The fix sets persist.sys.locale with
 * one, which the `shell*locale*` pattern counted as a question and answered
 * with the phase's property, as no setprop does. Today's script makes no
 * setprop, so for it nothing changes.
 *
 * Amended again for BUG-17 (RG-03: this restores the strength of the test on
 * MAC_RECORDING, it does not loosen it): `getprop persist.sys.locale` is no
 * question either. It still answers the phase's property, and moves the device
 * on no further. The phases' lengths were set when a reading was two questions,
 * `am get-config` and `service check package`, the two that decide. The fix
 * reads the property in every reading too, for its failure message only, which
 * made a reading three questions: a reading wholly inside a phase, as
 * `framework-stopping`'s configuration gone with the package service found, no
 * longer happened, and the getprop moved the device on between a reading and
 * the install it led to. So a script that took an unreadable configuration
 * with the package service found as ready installed in a phase logged `ready`,
 * and the test on MAC_RECORDING passed it; against the script before the fix
 * it failed (test-author, BUG-17, against 9597d9f). A script that reads only
 * the property, as before run 6, now never moves the device out of `booted`,
 * so it never installs and still fails that test.
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
    '  shell*setprop*) ;;',
    '  shell*getprop*persist.sys.locale*) ;;',
    `  shell*locale*|shell*get-config*|shell*service*check*) n=$((n + 1)); echo "$n" > "${readCount}" ;;`,
    'esac',
    ...branches,
    `echo "$phase adb $*" >> "${phaseLog}"`,
  ];
}

/**
 * How the timeline's device answers the script's questions, in `shell`'s case.
 * Amended for BUG-17: a `setprop` prints nothing, as timelinePhase says why.
 */
function timelineAnswers({ readTimes }) {
  return [
    '      *setprop*) ;;',
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

/**
 * BUG-17: a device that e2e:android switches to bokmål itself, as CI's is once
 * the emulator is no longer started with `-change-locale`. It booted in its
 * image's language: `am get-config` says en-rUS, persist.sys.locale is empty,
 * and the package service is found. `adb shell setprop persist.sys.locale
 * nb-NO` sets the property and changes nothing else, until `adb shell setprop
 * ctl.restart zygote`, after it, restarts the framework that reads it: for the
 * next `downFor` readings `am get-config` fails as cmd does while the activity
 * service is gone, and the package service is not found. From then on the
 * configuration is `after`, nb-rNO when the switch took and en-rUS when it did
 * not, with the package service found. A restart before the property is set,
 * like a property never followed by a restart, changes nothing.
 *
 * Its phase, booted, property-set, restarting or up, is kept in `stateFile`. A
 * reading is one `am get-config`, stamped in `readTimes` as on the other
 * devices; while it restarts they are counted in `readCount`. Each call is
 * written to `phaseLog` with the phase it came in, as on the timeline's
 * device, so a test can say when the release build was installed.
 *
 * These are the shell lines that set `phase` for this call, before anything else.
 */
function switchablePhase({ switchable: { downFor }, stateFile, readCount, phaseLog }) {
  return [
    `phase=$(/bin/cat "${stateFile}" 2>/dev/null || echo booted)`,
    'case "$*" in',
    '  shell*setprop*persist.sys.locale*nb-NO*)',
    `    if [ "$phase" = booted ]; then phase=property-set; echo "$phase" > "${stateFile}"; fi ;;`,
    '  shell*setprop*ctl.restart*zygote*)',
    '    if [ "$phase" = property-set ]; then',
    `      phase=restarting; echo "$phase" > "${stateFile}"; echo 0 > "${readCount}"`,
    '    fi ;;',
    '  shell*get-config*)',
    '    if [ "$phase" = restarting ]; then',
    `      r=$(/bin/cat "${readCount}"); r=$((r + 1)); echo "$r" > "${readCount}"`,
    `      if [ "$r" -gt ${String(downFor)} ]; then phase=up; echo "$phase" > "${stateFile}"; fi`,
    '    fi ;;',
    'esac',
    `echo "$phase adb $*" >> "${phaseLog}"`,
  ];
}

/** How the switchable device answers, in `shell`'s case. */
function switchableAnswers({ switchable: { after }, readTimes }) {
  const config = (qualifier) =>
    `config: mcc310-mnc260-${qualifier}-ldltr-sw411dp-w411dp-h914dp-normal-long-notround-lowdr-nowidecg-port-notnight-420dpi-finger-keysexposed-nokeys-navhidden-v37`;
  return [
    '      *setprop*) ;;',
    '      *get-config*)',
    `        "${process.execPath}" -e 'console.log(Date.now())' >> "${readTimes}"`,
    '        case "$phase" in',
    `          restarting) echo "cmd: Can't find service: activity" >&2; exit 20 ;;`,
    `          up) echo "${config(after)}" ;;`,
    `          *) echo "${config('en-rUS')}" ;;`,
    '        esac ;;',
    '      *service*check*)',
    '        if [ "$phase" = restarting ]; then echo "Service package: not found"; else echo "Service package: found"; fi ;;',
    '      *ro.product.locale*) echo en-US ;;',
    '      *persist.sys.locale*) if [ "$phase" = booted ]; then echo; else echo nb-NO; fi ;;',
  ];
}

/** What a google_apis emulator's `adb root` prints: adbd restarts as root. */
const ROOT_ACCEPTED = { output: 'restarting adbd as root\n', exit: 0 };

/** `text` as one single-quoted shell word. */
const shellWord = (text) => `'${text.replace(/'/g, "'\\''")}'`;

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
 * Shell lines that make the stand-in slow to start, the way a busy machine
 * makes every program it starts (BUG-21). Before it does anything else, a call
 * whose arguments match a rule's `call`, a `case` pattern, sleeps for `ms`: the
 * first `times` such calls, or every one when `times` is unset. Each rule
 * counts its calls in a file of its own in `dir`.
 *
 * @param {{ call: string, ms: number, times?: number }[]} slowStarts
 * @param {string} dir
 */
function slowStartLines(slowStarts, dir) {
  return slowStarts.flatMap(({ call, ms, times }, i) => {
    const count = path.join(dir, `slow-start-${String(i)}`);
    const sleep = `/bin/sleep ${String(ms / 1000)}`;
    return [
      `case "$*" in ${call})`,
      `  s=$(/bin/cat "${count}" 2>/dev/null || echo 0); s=$((s + 1)); echo "$s" > "${count}"`,
      times === undefined
        ? `  ${sleep} ;;`
        : `  if [ "$s" -le ${String(times)} ]; then ${sleep}; fi ;;`,
      'esac',
    ];
  });
}

/**
 * The stand-in adb: emulators by serial, a device set to `locale` (bokmål
 * unless a test says otherwise) or one that applies bokmål only after
 * `appliedAfter` readings, or one that goes through `timeline`'s phases, and a
 * crash buffer when there is one. Amended 2026-09-28: `adb install` answers
 * `installs` in turn, and on the timeline's device, `timelineInstall`.
 * Amended 2026-10-14 (BUG-21): `slowStarts` makes chosen calls slow to start.
 *
 * Amended for BUG-17: or a device that takes the switch to bokmål only from
 * the script (`switchable`). And `adb root` answers as a google_apis
 * emulator's adbd does, or with `rootAnswer`, and `adb wait-for-device`
 * returns at once, on every device: the fix issues both. `adb root` answered
 * nothing before, which no adb does, so a script that judges it by what adb
 * printed, as it must (adb exits 0 even when adbd refuses), would have been
 * refused by the stand-in rather than by the device.
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
  switchable,
  stateFile,
  phaseLog,
  rootAnswer = ROOT_ACCEPTED,
  installs,
  installDir,
  slowStarts,
  slowStartDir,
}) {
  /** The device's own answers in `shell`'s case: the timeline's, the switchable one's, or a locale's. */
  const answers = () => {
    if (timeline !== undefined) return timelineAnswers({ readTimes });
    if (switchable !== undefined) return switchableAnswers({ switchable, readTimes });
    return localeAnswers({ locale, appliedAfter, readCount, readTimes });
  };
  /** The lines that set this call's phase, on the devices that have one. */
  const phase = () => {
    if (timeline !== undefined) return timelinePhase({ timeline, readCount, phaseLog });
    if (switchable !== undefined) {
      return switchablePhase({ switchable, stateFile, readCount, phaseLog });
    }
    return [];
  };
  return [
    '#!/bin/sh',
    ...slowStartLines(slowStarts, slowStartDir),
    `echo "adb $*" >> "${log}"`,
    "serial=''",
    'if [ "$1" = "-s" ]; then serial="$2"; shift 2; fi',
    ...phase(),
    'case "$1" in',
    `  devices) printf 'List of devices attached\\n${devices.map(([serial, state]) => `${serial}\\t${state}\\n`).join('')}\\n' ;;`,
    '  root)',
    `    printf '%s' ${shellWord(rootAnswer.output)}`,
    `    exit ${String(rootAnswer.exit)} ;;`,
    '  wait-for-device) ;;',
    '  shell)',
    '    case "$*" in',
    '      *ro.kernel.qemu*) case "$serial" in emulator-*) echo 1 ;; esac ;;',
    ...answers(),
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
 * A module, loaded with --import before the script, that records what the
 * script's waits decide by (BUG-21), and writes it out as the script exits:
 * every reading it takes of Date.now, one per line, to `clockFile`; and every
 * sleep it takes through node:timers/promises, as "<when> <ms>", to
 * `sleepFile`, `when` read from the real clock without counting as a reading.
 * The waits for bokmål and for the install read that clock and sleep that way,
 * and nothing else in the script does either (the tests below pin both), so the
 * records say what the waits decided, however slow the machine was to start
 * the programs they asked.
 *
 * It only records, and changes nothing the script sees: each reading is
 * returned unchanged, and each sleep is the original's own promise, for the
 * same time. The sleep is replaced on the module's exports and synced to its
 * ESM bindings before the script loads, so the script's `import { setTimeout
 * as sleep }` gets the recording one.
 */
function clockObserver({ clockFile, sleepFile }) {
  return [
    "import { writeFileSync } from 'node:fs';",
    "import { syncBuiltinESMExports } from 'node:module';",
    "import timers from 'node:timers/promises';",
    'const readings = [];',
    'const sleeps = [];',
    'const read = Date.now;',
    'Date.now = function now() {',
    '  const t = read();',
    '  readings.push(t);',
    '  return t;',
    '};',
    'const sleep = timers.setTimeout;',
    'timers.setTimeout = function setTimeout(delay, ...rest) {',
    "  sleeps.push(read() + ' ' + delay);",
    '  return sleep(delay, ...rest);',
    '};',
    'syncBuiltinESMExports();',
    "process.on('exit', () => {",
    `  writeFileSync(${JSON.stringify(clockFile)}, readings.join('\\n'));`,
    `  writeFileSync(${JSON.stringify(sleepFile)}, sleeps.join('\\n'));`,
    '});',
    '',
  ].join('\n');
}

/**
 * Runs `command` to its end, as spawnSync does, and kills it with SIGTERM
 * `timeout` ms after it started, or, with `stopAfter`, `stopAfter.ms` after
 * the first call in `log` that `stopAfter.call` matches, whichever comes first.
 *
 * Added 2026-10-14 (BUG-21): a check of how long the script is still waiting
 * starts its time at the script's first question, not at its start, so a
 * machine slow to start the script cannot use up the time the check is for.
 */
function runToEnd([command = '', ...args], { cwd, env, timeout, stopAfter, log }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    const stop = () => child.kill('SIGTERM');
    const timers = [setTimeout(stop, timeout)];
    const watching =
      stopAfter === undefined
        ? undefined
        : setInterval(() => {
            const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n') : [];
            if (!calls.some(stopAfter.call)) return;
            clearInterval(watching);
            timers.push(setTimeout(stop, stopAfter.ms));
          }, 10);
    const done = () => {
      clearInterval(watching);
      for (const timer of timers) clearTimeout(timer);
    };
    child.on('error', (error) => {
      done();
      reject(error);
    });
    // 'close' comes once every process holding the script's stdout and stderr
    // has let go of them. The stand-in adb never holds them: the script runs it
    // with pipes of its own, so one still sleeping at SIGTERM does not delay
    // this. A program the script starts with its output inherited, as it runs
    // the build and the flows, would delay it until that program ended.
    child.on('close', (status, signal) => {
      done();
      resolve({ status, signal, stdout, stderr });
    });
  });
}

/**
 * A wait as the script decided it (BUG-21), from `clock`, the script's own
 * readings of Date.now, and `asks`, when each question it waited on reached
 * adb, in milliseconds on the same machine's clock. Only readings from `since`
 * on count, so that an earlier wait does not.
 *
 * `waited` is from its first reading to its last. A wait reads the clock as it
 * starts and again after each question, and stops on the first reading at or
 * past the deadline, so a correct wait is at least the deadline long, whatever
 * the machine's speed.
 *
 * `lastTimeLeft` is its last reading that still left time before the deadline,
 * and `lastAsk` when it last asked. A wait that keeps asking asks again after
 * every such reading, so `lastAsk` comes after it: however slow that question
 * is to start or to answer, it reaches adb after the reading that sent it.
 *
 * `sleeps` is how long each sleep it took from `since` on was, in order, as it
 * asked node:timers/promises for it.
 *
 * These replace spans taken from the stand-ins' own stamps, which a slow start
 * of the first question shortened and a slow last question cut off, so that a
 * run that waited 1 s by its clock measured 639 ms.
 */
function waitByItsClock({ clock, sleeps, asks, deadline, since = -Infinity }) {
  const readings = clock.filter((t) => t >= since);
  const start = Math.min(...readings);
  return {
    readings: readings.length,
    waited: Math.max(...readings) - start,
    lastTimeLeft: Math.max(...readings.filter((t) => t - start < deadline)),
    lastAsk: Math.max(...asks),
    sleeps: sleeps.filter(({ at }) => at >= since).map(({ ms }) => ms),
  };
}

/** The message when the script read its clock less than a wait has to. */
const noClock = (output) =>
  `the script read Date.now fewer than twice; if its waits now read another clock, the observer must too:\n${output}`;

/** The message when the script stopped asking while its clock still left time. */
const stoppedAsking = ({ lastAsk, lastTimeLeft }, output) =>
  `it last asked at ${String(lastAsk)}, though its clock still left time at ${String(lastTimeLeft)}:\n${output}`;

/** The message when the script slept other than once for `interval` between each two questions. */
const sleptOtherwise = ({ sleeps }, interval, output) =>
  `it slept ${JSON.stringify(sleeps)} ms between its questions, where it was to sleep ${String(interval)} ms once between each two:\n${output}`;

/**
 * A wait that gave up at `deadline`, checked as the script decided it
 * (BUG-21). It read its clock more than once; by that clock it waited the
 * whole deadline; it asked again after every reading that left time; and
 * between each two questions it slept once, for exactly `interval`. A wait
 * reads its clock as it starts and after each question, and sleeps after each
 * of those readings but the last, so it sleeps two times fewer than it reads.
 *
 * Amended in BUG-21's review: the sleeps hold the interval from above, which
 * nothing else here does. A wait that slept 5 s where it was given 250 ms
 * still waited out its deadline and asked again after its last reading with
 * time left. Before BUG-21, a 1 s deadline that three installs had to beat was
 * the only such bound, and only on the install's interval.
 */
function expectWaitedOut(wait, { deadline, interval }, output) {
  expect(wait.readings, noClock(output)).toBeGreaterThan(1);
  expect(wait.waited, output).toBeGreaterThanOrEqual(deadline);
  expect(wait.lastAsk, stoppedAsking(wait, output)).toBeGreaterThan(wait.lastTimeLeft);
  expect(wait.sleeps, sleptOtherwise(wait, interval, output)).toEqual(
    Array.from({ length: wait.readings - 2 }, () => interval),
  );
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
 *   switchable?: { downFor: number, after: string },
 *   rootAnswer?: { output: string, exit: number },
 *   installs?: { stdout: string, stderr: string, exit: number }[],
 *   slowStarts?: { call: string, ms: number, times?: number }[],
 *   env?: Record<string, string>,
 *   timeout?: number,
 *   stopAfter?: { call: (call: string) => boolean, ms: number },
 * }} options — `flows` is what Maestro's report says ran; `crash` puts a
 *   crash of the app, and one of another app, in the device's crash buffer;
 *   `locale` is the language the device reports, unless `localeAppliedAfter`
 *   makes it a device that applies bokmål only after that many readings
 *   (localeAnswers), or `timeline` one whose framework restarts to apply it
 *   (timelinePhase), or `switchable` one that the script switches itself
 *   (switchablePhase, BUG-17); `rootAnswer` is what `adb root` prints and
 *   exits with; `installs` is what `adb install` answers, in turn, the
 *   last one from then on (installAnswers); `slowStarts` makes chosen calls to
 *   adb slow to start (slowStartLines); `env` is added to the script's
 *   environment; `timeout` is when the run is killed, counted from its start,
 *   and `stopAfter` kills it `ms` after its first call that `call` matches
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
  switchable,
  rootAnswer,
  installs = [INSTALL_SUCCESS],
  slowStarts = [],
  env = {},
  // Amended in BUG-21's review: under vitest's own testTimeout of 60 s, so a
  // run that hangs is killed here and its output shown, rather than the test
  // timing out first with nothing to show.
  timeout = 50_000,
  stopAfter,
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
    const stateFile = path.join(dir, 'switch-state');
    const installDir = path.join(dir, 'installs');
    const slowStartDir = path.join(dir, 'slow-starts');

    mkdirSync(installDir, { recursive: true });
    mkdirSync(slowStartDir, { recursive: true });
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
          switchable,
          stateFile,
          phaseLog,
          rootAnswer,
          installs,
          installDir,
          slowStarts,
          slowStartDir,
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

    // Amended 2026-10-14 (BUG-21): the script runs with an observer of its
    // clock and its sleeps, so a test can read the waits as the script decided
    // them.
    const clockLog = path.join(dir, 'clock.log');
    const sleepLog = path.join(dir, 'sleeps.log');
    const observer = path.join(dir, 'clock-observer.mjs');
    writeFileSync(observer, clockObserver({ clockFile: clockLog, sleepFile: sleepLog }));

    // Set in full: no MAESTRO_ or EXPO_ variable comes from the caller, so
    // whatever Maestro is run with, the script set. `env` adds only what a
    // test names.
    const result = await runToEnd(
      [process.execPath, '--import', pathToFileURL(observer).href, SCRIPT, ...args],
      {
        cwd: root,
        env: {
          PATH: bin,
          HOME: path.join(dir, 'home'),
          ANDROID_HOME: sdk,
          ANDROID_SDK_ROOT: sdk,
          JAVA_HOME: jdk,
          ...env,
        },
        timeout,
        stopAfter,
        log,
      },
    );
    const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : []);
    return {
      code: result.status,
      signal: result.signal,
      // Every reading the script took of its clock, Date.now, in order. Empty
      // when it was killed, as it then wrote none.
      clock: lines(clockLog)
        .filter((line) => line !== '')
        .map(Number),
      // Every sleep the script took, in order: when it began, on the same
      // clock, and for how many milliseconds. Empty when it was killed.
      sleeps: lines(sleepLog)
        .filter((line) => line !== '')
        .map((line) => {
          const [at = NaN, ms = NaN] = line.split(' ').map(Number);
          return { at, ms };
        }),
      // When each reading of the device's language reached adb, in milliseconds.
      readTimes: lines(readTimes).map(Number),
      stdout: result.stdout,
      stderr: result.stderr,
      output: `${result.stdout}${result.stderr}`,
      calls: lines(log),
      maestroRuns: lines(envLog).map((line) => {
        const [maestroArgs = '', updateCheck = '', analytics = ''] = line.split('\t');
        return { args: maestroArgs, updateCheck, analytics };
      }),
      crashBuffer: lines(crashes),
      // With a timeline, or a switchable device: every call to adb, and the
      // phase the device was in.
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

/**
 * The wait for the install in runs that end in a pass: the short interval, and
 * a 20 s deadline, as the waits for bokmål that end in a pass have (BUG-21).
 * Such a run never waits out its deadline, so it costs no time; with the 1 s
 * one, its attempts had to be made within a second, and on a machine slow to
 * start adb the deadline came first, though the script did what the test says.
 */
const PASSING_INSTALL_DEADLINE = 20_000;
const PASSING_INSTALL_WAIT = {
  ...SHORT_INSTALL_WAIT,
  E2E_ANDROID_INSTALL_DEADLINE_MS: String(PASSING_INSTALL_DEADLINE),
};

/** A message that says the install was tried `n` times: "7 attempts", "tried 7 times". */
function saysAttempts(n) {
  return new RegExp(
    `(?<![\\d.])${String(n)} ?(?:install(?:ation)? )?(?:attempts?|tries|times)\\b|\\b(?:attempts?|tries)\\b:? ?${String(n)}(?![\\d.])`,
    'i',
  );
}

/** The message when something other than `waits` read the script's clock. */
const notOnlyTheWaits = (waits, output) =>
  `nothing but ${waits} may read Date.now, as waitByItsClock counts every reading as a wait's:\n${output}`;

// The checks of the four runs below that BUG-21's runs repeat on a machine
// slow to start programs. They are in functions of their own (BUG-21's
// review), so that both runs check the same things and cannot drift apart.

/**
 * "When the emulator never applies bokmål, it stops after the deadline, says
 * it waited, how long, bokmål and what the device reports, and runs no flow",
 * with the tests' short wait for bokmål.
 */
function expectGaveUpOnBokmal({ code, stderr, output, calls, clock, sleeps, readTimes }) {
  const wait = waitByItsClock({ clock, sleeps, asks: readTimes, deadline: SHORT_DEADLINE });

  expect(code, output).not.toBe(0);
  expect(code, 'it was killed rather than finishing').not.toBeNull();
  // It waited: it asked more than once, and kept asking until the deadline.
  // Amended 2026-10-14 (BUG-21): both are read from the script's own clock.
  // The span from the first reading to the last, each stamped by a stand-in
  // this test starts, was allowed three intervals for the stand-ins' start-up,
  // and under gate:full's load measured 639 ms of a wait the script timed at
  // 1 s: a slow start of the first reading shortens it, a slow last reading
  // cuts it off. The script's clock says what it decided: it waited the whole
  // deadline, with no allowance, and asked again after every reading of its
  // clock that left time. "More than once" also assumed a reading takes less
  // than the deadline; this holds it to more than once whenever its clock left
  // time for a second reading, which on this machine is several times over.
  // Amended in BUG-21's review: the wait reads Date.now once as it starts and
  // once after each reading of the device, and nothing else reads it, as the
  // measure assumes; and it slept exactly the interval between each two.
  expect(clock.length, notOnlyTheWaits('the wait for bokmål', output)).toBe(readTimes.length + 1);
  const shortWait = { deadline: SHORT_DEADLINE, interval: SHORT_INTERVAL };
  expectWaitedOut(wait, shortWait, output);
  // And it says so where a failure is said.
  expect(stderr, output).toMatch(/bokmål/);
  expect(stderr, output).toMatch(/\bwait/i);
  expect(stderr, output).toMatch(saysHowLong(SHORT_DEADLINE));
  // What the device reports: ro.product.locale's en-US, or the configuration's en-rUS.
  expect(stderr, output).toMatch(/\ben[-_]r?US\b/);
  expect(output).not.toMatch(/flows? passed/);
  expect(calls.filter(isFlowRun)).toEqual([]);
  expect(touchedDevice(calls)).toEqual([]);
}

/**
 * "Without the tests' shorter deadline, it is still waiting": killed by
 * `stopAfter`, a while after its first call that `first` matches, it had not
 * finished. `within` says how long that while was, for the message.
 */
function expectStillWaiting({ code, signal, output, calls }, { first, within }) {
  // Not vacuous: it got as far as the question its time is counted from.
  expect(calls.filter(first).length, output).toBeGreaterThan(0);
  expect(
    code,
    `it finished within ${within}, with exit code ${String(code)}:\n${output}`,
  ).toBeNull();
  expect(signal).toBe('SIGTERM');
  expect(calls.filter(isFlowRun)).toEqual([]);
}

/**
 * "When the install is still not ready at the deadline, it stops, says how
 * long it waited, how many attempts and what adb said last, and runs no
 * flow", with the tests' short wait for the install, adb answering `answers`
 * in turn and the last of them from then on.
 */
function expectInstallGaveUp(
  { code, stderr, output, calls, clock, sleeps, readTimes, installTimes },
  answers,
) {
  const installs = calls.filter(isInstallCall);
  // The install's wait, by the script's clock: from after it last read the
  // device's language, which it does only before it installs.
  const wait = waitByItsClock({
    clock,
    sleeps,
    asks: installTimes,
    deadline: SHORT_INSTALL_DEADLINE,
    since: Math.max(...readTimes),
  });

  // It waited: it tried more than the two answers, and kept trying until the deadline.
  // Amended 2026-10-14 (BUG-21): both are read from the script's own clock.
  // "More than two attempts" needed each attempt, with the interval after it,
  // to take under a third of the deadline; on a machine slow to start adb a
  // correct run made 2. The span from the first attempt to the last was held
  // to the deadline less three intervals, here a single interval. The
  // script's clock says what it decided: it tried for the whole deadline, and
  // tried again after every reading of its clock that left time, which on
  // this machine means more than two attempts.
  // Amended in BUG-21's review: the wait for bokmål reads Date.now as it
  // starts and after each reading but the one that passes, the install's
  // wait as it starts and after each attempt, and nothing else reads it, as
  // the measure assumes; and it slept exactly the interval between attempts.
  expect(clock.length, notOnlyTheWaits('the two waits', output)).toBe(
    readTimes.length + installs.length + 1,
  );
  const shortWait = { deadline: SHORT_INSTALL_DEADLINE, interval: SHORT_INSTALL_INTERVAL };
  expectWaitedOut(wait, shortWait, output);
  expect(code, output).not.toBe(0);
  expect(code, 'it was killed rather than finishing').not.toBeNull();
  expect(stderr, output).toMatch(/\bwait/i);
  expect(stderr, output).toMatch(saysHowLong(SHORT_INSTALL_DEADLINE));
  expect(stderr, output).toMatch(saysAttempts(installs.length));
  // What adb said last: run 8's exception, which the first answer did not have.
  // Amended 2026-10-14 (BUG-21): all of what adb printed on the last attempt,
  // which the stand-in chose as it does: run 8's from the second attempt on.
  // A run whose clock had passed the deadline after one attempt made only
  // that one, and its last answer is the first.
  const lastAnswer = answers[Math.min(installs.length, answers.length) - 1];
  expect(stderr, output).toContain(lastAnswer?.stderr.trim());
  expect(output).not.toMatch(/flows? passed/);
  expect(calls.filter(isFlowRun)).toEqual([]);
}

/**
 * "When the install fails as in run 8 and then as in run 6 before it works, it
 * waits for the package manager, shows each attempt, and then runs the flows,
 * once", with the tests' short interval between installs.
 */
function expectInstalledOnThirdAttempt({ code, output, calls, sleeps, readTimes, installTimes }) {
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
  // Amended in BUG-21's review: and it slept for exactly the interval, once
  // between each two attempts. The gaps hold the interval from below; this
  // holds it from above too, which once the deadline became 20 s nothing did:
  // a wait that slept 5 s where it was given 250 ms passed.
  const slept = sleeps.filter(({ at }) => at >= Math.max(...readTimes)).map(({ ms }) => ms);
  expect(slept, sleptOtherwise({ sleeps: slept }, SHORT_INSTALL_INTERVAL, output)).toEqual([
    SHORT_INSTALL_INTERVAL,
    SHORT_INSTALL_INTERVAL,
  ]);
  // A wait for the device, not a retry of a flow: the flows ran once, after the install worked.
  expect(calls.filter(isFlowRun).length, output).toBe(1);
  expect(calls.findIndex(isFlowRun), output).toBeGreaterThan(calls.findLastIndex(isInstallCall));
  expect(code, output).toBe(0);
  expect(output).toMatch(/\b1 of 1 flows? passed/);
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
    // Amended 2026-10-14 (BUG-21): "that long" is read from the script's own
    // clock, and "more than once" became "again after every reading of its
    // clock that left time", as in expectGaveUpOnBokmal, which says why.
    // Amended in BUG-21's review: and it slept exactly the interval between
    // each two readings (expectWaitedOut).
    const { code, output, calls, clock, sleeps, readTimes } = await runPastPreflight({
      locale: 'en-US',
      env: SHORT_WAIT,
    });
    const wait = waitByItsClock({ clock, sleeps, asks: readTimes, deadline: SHORT_DEADLINE });

    // Not vacuous: the device was asked for its language.
    // Amended 2026-09-27, run 6: asked through the configuration, `am
    // get-config`, and no longer through persist.sys.locale, which says nb-NO
    // before the framework has restarted to apply it.
    expect(
      calls.some((call) => /^adb\b.*\bam get-config\b/.test(call)),
      output,
    ).toBe(true);
    expectWaitedOut(wait, { deadline: SHORT_DEADLINE, interval: SHORT_INTERVAL }, output);
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
    const { code, output, calls, sleeps, readTimes } = await runPastPreflight({
      localeAppliedAfter: 3,
      env: { ...SHORT_WAIT, E2E_ANDROID_LOCALE_DEADLINE_MS: '20000' },
    });

    expect(code, output).toBe(0);
    expect(output).toMatch(/\b1 of 1 flows? passed/);
    // It read past the three answers the device gave as it booted, and only
    // then ran the flows.
    // Amended for BUG-17 (RG-03: this restores the test's strength, it does
    // not loosen it): readings are counted as `am get-config` calls
    // (isConfigRead, with the BUG-17 tests below), one in each reading, not as
    // every call isLocaleRead matches. Since the fix, each reading also runs
    // `getprop persist.sys.locale`, and the switch one `setprop
    // persist.sys.locale nb-NO`; both name "locale", so two readings made five
    // such calls, and a script that passed on its second or third reading,
    // whatever the device said, passed here (test-auditor, at 9597d9f).
    expect(calls.filter(isConfigRead).length, output).toBeGreaterThan(3);
    expect(calls.findIndex(isFlowRun), output).toBeGreaterThan(calls.findLastIndex(isLocaleRead));
    // Amended in BUG-21's review: between each two readings it slept for
    // exactly the interval, once. Nothing else here holds the interval from
    // above, and its 20 s deadline lets a wait that sleeps too long pass.
    const slept = sleeps.map(({ ms }) => ms);
    expect(slept, sleptOtherwise({ sleeps: slept }, SHORT_INTERVAL, output)).toEqual(
      Array.from({ length: readTimes.length - 1 }, () => SHORT_INTERVAL),
    );
  });

  test('INF-06-AC9: when the emulator never applies bokmål, it stops after the deadline, says it waited, how long, bokmål and what the device reports, and runs no flow', async () => {
    // Amended in BUG-21's review: its checks are expectGaveUpOnBokmal's, which
    // BUG-21's run of it on a slow machine shares.
    const run = await runPastPreflight({ localeAppliedAfter: Infinity, env: SHORT_WAIT });

    expectGaveUpOnBokmal(run);
  });

  test("INF-06-AC9: without the tests' shorter deadline, it is still waiting for bokmål after 4 s, not failing at once", async () => {
    // The production deadline, at least 60 s, is what the script uses when no
    // test shortens it. Killed at 4 s, it must still be waiting.
    // Amended 2026-10-14 (BUG-21): the 4 s are counted from its first question
    // about the language, not from its start. Counted from its start, a machine
    // slow to start the script and its preflight used them up before it asked,
    // and the check that it asked failed, though nothing was wrong.
    // Amended in BUG-21's review: its checks are expectStillWaiting's, which
    // BUG-21's run of it on a slow machine shares.
    const run = await runPastPreflight({
      localeAppliedAfter: Infinity,
      stopAfter: { call: isLocaleRead, ms: 4_000 },
    });

    expectStillWaiting(run, { first: isLocaleRead, within: '4 s of asking' });
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
    const { code, stderr, output, calls, clock, sleeps, readTimes } = await runPastPreflight({
      timeline: PROPERTY_ONLY,
      env: SHORT_WAIT,
    });
    const wait = waitByItsClock({ clock, sleeps, asks: readTimes, deadline: SHORT_DEADLINE });

    expect(touchedDevice(calls), output).toEqual([]);
    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    // Amended 2026-10-14 (BUG-21): how long it asked is read from the script's
    // own clock, for the reason expectGaveUpOnBokmal gives. Amended in BUG-21's
    // review: and it slept exactly the interval between each two readings.
    expectWaitedOut(wait, { deadline: SHORT_DEADLINE, interval: SHORT_INTERVAL }, output);
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
    const { code, stderr, output, calls, clock, sleeps, readTimes } = await runPastPreflight({
      timeline: PACKAGE_NEVER_BACK,
      env: SHORT_WAIT,
    });
    const wait = waitByItsClock({ clock, sleeps, asks: readTimes, deadline: SHORT_DEADLINE });

    expect(touchedDevice(calls), output).toEqual([]);
    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    // Amended 2026-10-14 (BUG-21): how long it asked is read from the script's
    // own clock, for the reason expectGaveUpOnBokmal gives. Amended in BUG-21's
    // review: and it slept exactly the interval between each two readings.
    expectWaitedOut(wait, { deadline: SHORT_DEADLINE, interval: SHORT_INTERVAL }, output);
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
    // Amended 2026-10-14 (BUG-21): with a 20 s deadline, PASSING_INSTALL_WAIT,
    // which says why. Amended in BUG-21's review: its checks are
    // expectInstalledOnThirdAttempt's, which BUG-21's run of it on a slow
    // machine shares, and they now hold the interval from above as well.
    const run = await runPastPreflight({
      installs: [RUN_8_INSTALL, RUN_6_INSTALL, INSTALL_SUCCESS],
      env: PASSING_INSTALL_WAIT,
    });

    expectInstalledOnThirdAttempt(run);
  });

  test('INF-06-AC9: when the install is still not ready at the deadline, it stops, says how long it waited, how many attempts and what adb said last, and runs no flow', async () => {
    // Amended in BUG-21's review: its checks are expectInstallGaveUp's, which
    // BUG-21's run of it on a slow machine shares.
    const answers = [RUN_6_INSTALL, RUN_8_INSTALL];
    const run = await runPastPreflight({ installs: answers, env: SHORT_INSTALL_WAIT });

    expectInstallGaveUp(run, answers);
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
    // Amended 2026-10-14 (BUG-21): the 6 s are counted from its first install,
    // not from its start, for the reason the 4 s wait for bokmål above gives.
    // Amended in BUG-21's review: its checks are expectStillWaiting's, which
    // BUG-21's run of it on a slow machine shares.
    const run = await runPastPreflight({
      installs: [RUN_8_INSTALL],
      stopAfter: { call: isInstallCall, ms: 6_000 },
    });

    expectStillWaiting(run, { first: isInstallCall, within: '6 s of installing' });
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

// BUG-21. The waits above were judged with clocks and counts the script does
// not control: the stand-ins it starts, each stamped or counted per call, and
// the test's own timer, started with the run. Under gate:full's load on
// 2026-10-06 a run that waited out its deadline, and said "Waited 1 s",
// measured 639 ms from its first reading to its last; on 2026-10-13 another
// made 2 install attempts where 3 were expected, and the 4 s check failed. A
// machine slow to start programs made a correct wait look short.
//
// These runs make that slowness explicit, rather than hoping for a busy
// machine: chosen calls to the stand-in adb sleep before they do anything, as
// a program does that a busy machine is slow to start. The script is the same
// correct one throughout, so each of these runs must pass the same checks as
// its sibling above. Each failed them as they were before BUG-21: the first
// reading 0.8 s slow measured 157 ms against 700; 1.1 s slow, it read once, not
// more than once; started 1.2 s slow with the timer started at its start, it
// had not yet asked; with installs 0.4 s slow it made 2 attempts, not more than
// 2, and the install that works on the third attempt failed after the second
// at the 1 s deadline; started slowly, it had not yet installed. Each also
// checks that the slowness happened, so it cannot pass by being fast.
// Amended in BUG-21's review: each calls its sibling's checks, the same
// function the sibling calls, and adds only its slowness and that check.

/** The first reading of the language slow to start, and how slow. */
const SLOW_FIRST_READINGS = [
  { what: 'slow to start, by 0.8 s', ms: 800 },
  { what: 'so slow to start, by 1.1 s, that the deadline has passed when it answers', ms: 1_100 },
];

describe('BUG-21: a machine slow to start programs does not fail a run that waited correctly', () => {
  test.each(SLOW_FIRST_READINGS)(
    'BUG-21: with the first reading of the language $what, a run that never sees bokmål still counts as waiting out the deadline',
    async ({ ms }) => {
      const run = await runPastPreflight({
        localeAppliedAfter: Infinity,
        env: SHORT_WAIT,
        slowStarts: [{ call: '*get-config*', ms, times: 1 }],
      });

      // Not vacuous: the first reading reached adb at least `ms` after the wait began.
      expect((run.readTimes[0] ?? 0) - Math.min(...run.clock), run.output).toBeGreaterThanOrEqual(
        ms,
      );
      expectGaveUpOnBokmal(run);
    },
  );

  test('BUG-21: started slowly, by 1.2 s, it is still waiting for bokmål a second after it first asked, and was not stopped before it asked', async () => {
    const started = Date.now();
    const run = await runPastPreflight({
      localeAppliedAfter: Infinity,
      slowStarts: [{ call: 'devices', ms: 1_200 }],
      stopAfter: { call: isLocaleRead, ms: 1_000 },
    });

    // Not vacuous: it first asked more than the slow start after the run began.
    expect((run.readTimes[0] ?? 0) - started, run.output).toBeGreaterThanOrEqual(1_200);
    expectStillWaiting(run, { first: isLocaleRead, within: '1 s of asking' });
  });

  test('BUG-21: with every install slow to start, by 0.4 s, an install still not ready at the deadline still counts as trying until then', async () => {
    const answers = [RUN_6_INSTALL, RUN_8_INSTALL];
    const run = await runPastPreflight({
      installs: answers,
      env: SHORT_INSTALL_WAIT,
      slowStarts: [{ call: '*install*', ms: 400 }],
    });

    // Not vacuous: the first install reached adb at least 0.4 s after the language was read.
    expect(
      (run.installTimes[0] ?? 0) - Math.max(...run.readTimes),
      run.output,
    ).toBeGreaterThanOrEqual(400);
    expectInstallGaveUp(run, answers);
  });

  test('BUG-21: with every install slow to start, by 0.4 s, an install that works on the third attempt still gets its third attempt, and the flows run once', async () => {
    const run = await runPastPreflight({
      installs: [RUN_8_INSTALL, RUN_6_INSTALL, INSTALL_SUCCESS],
      env: PASSING_INSTALL_WAIT,
      slowStarts: [{ call: '*install*', ms: 400 }],
    });

    // Not vacuous: the first install reached adb at least 0.4 s after the language was read.
    expect(
      (run.installTimes[0] ?? 0) - Math.max(...run.readTimes),
      run.output,
    ).toBeGreaterThanOrEqual(400);
    expectInstalledOnThirdAttempt(run);
  });

  test('BUG-21: started slowly, by 1.2 s, it is still waiting for the package manager a second after it first tried the install, and was not stopped before it tried', async () => {
    const started = Date.now();
    const run = await runPastPreflight({
      installs: [RUN_8_INSTALL],
      slowStarts: [{ call: 'devices', ms: 1_200 }],
      stopAfter: { call: isInstallCall, ms: 1_000 },
    });

    // Not vacuous: it first asked more than the slow start after the run began.
    expect((run.readTimes[0] ?? 0) - started, run.output).toBeGreaterThanOrEqual(1_200);
    expectStillWaiting(run, { first: isInstallCall, within: '1 s of installing' });
  });
});

// BUG-17. android-e2e failed three times before the app was installed (#57,
// #60 and #96; #96's was job 118947039610, run 39515647691): "Waited 120 s for
// the emulator to be in Norwegian bokmål with its package service up … its
// package service was found, and its configuration's language was en-rUS."
// CI started the emulator with `-change-locale nb-NO`, which the emulator
// applies after boot by restarting Android's framework, and the runner logged
// "Changing locale to nb-NO … Restarting framework." in the failing run and in
// its passing re-run (job 119070015215) alike. That switch cannot be watched
// and sometimes does not take, so the script could only wait for it and fail.
//
// The script now makes the switch itself, once, and only on a device that is
// not in bokmål already: `adb root`, `adb wait-for-device`, `adb shell setprop
// persist.sys.locale nb-NO`, `adb shell setprop ctl.restart zygote`, and then
// the wait for bokmål as before. A refused step stops the run at once. When
// the wait after the switch runs out, its message also says what
// persist.sys.locale said last and whether the framework was seen restarting.
// The switchable device (switchablePhase) takes the switch only from the
// script; scripts/lib/e2e-android.test.mjs holds the steps and the wait's
// message in detail.

/** The calls, in the stand-ins' log, that switch the device's language, or would: root, a wait for the device, a setprop, a reboot. */
const isSwitchCall = (call) =>
  /^adb\b.*\s(?:root|unroot|wait-for-device|reboot|remount|setprop)\b/.test(call);

/** The calls that read the device's configuration: one in each reading. */
const isConfigRead = (call) => /^adb\b.*\bam get-config\b/.test(call);

/** The switch, as the stand-ins log it, in order. */
const SWITCH_CALLS = [
  'adb -s emulator-5554 root',
  'adb -s emulator-5554 wait-for-device',
  'adb -s emulator-5554 shell setprop persist.sys.locale nb-NO',
  'adb -s emulator-5554 shell setprop ctl.restart zygote',
];

/**
 * The wait for bokmål in a run that fails at its deadline after the switch,
 * having to see the framework restart and come back first: 5 s, read every
 * 100 ms. The switch and three readings must all happen within it, about
 * thirteen calls to the stand-in adb, so the tests' 1 s would leave a machine
 * slow to start programs (BUG-21) failing on the device's state rather than
 * on the message.
 */
const RESTART_DEADLINE = 5_000;

/**
 * A message that says persist.sys.locale was `value`: the property's name, and
 * then the value in the same clause, at most 25 characters on. "The flows expect
 * nb-NO", which the message already says, is no such statement.
 */
const propertySays = (value) =>
  new RegExp(`persist\\.sys\\.locale\\b[^\\n.;,]{0,25}?\\b${value.replace(/[.-]/g, '\\$&')}\\b`);

/** A message that says persist.sys.locale was empty, in the same way. */
const PROPERTY_EMPTY =
  /persist\.sys\.locale\b[^\n.;,]{0,25}?(?:""|''|\bempty\b|\bnothing\b|\bunset\b|\bnot set\b|\bblank\b|\bno value\b)/i;

/** A message that speaks of the framework's restart at all. */
const SAYS_RESTART = /\brestart/i;

/**
 * A message that says no restart was seen: a no, not, never or without, and
 * "restart" after it in the same clause, at most 25 characters on. "was not
 * seen restarting", "no restart was seen" and "never restarted" all are; "was
 * seen restarting" is not.
 */
const NO_RESTART = /\b(?:no|not|never|without)\b[^.,;:()\n]{0,25}?\brestart/i;

/** What adbd says on a production build, where it cannot be root. adb exits 0 with it. */
const ROOT_REFUSED = 'adbd cannot run as root in production builds';

describe('BUG-17: e2e:android switches the emulator to bokmål itself, rather than waiting for -change-locale', () => {
  test('BUG-17: on a device in en-US, it switches the language itself, once: adb root, wait-for-device, setprop persist.sys.locale nb-NO and setprop ctl.restart zygote, in that order, then waits through the restart for nb-rNO with the package service found, installs, and the flows run', async () => {
    const { code, output, calls, phaseCalls, sleeps, readTimes } = await runPastPreflight({
      switchable: { downFor: 3, after: 'nb-rNO' },
      env: { ...SHORT_WAIT, E2E_ANDROID_LOCALE_DEADLINE_MS: '20000' },
    });
    const installs = phaseCalls.filter(isInstall);

    expect(calls.filter(isSwitchCall), output).toEqual(SWITCH_CALLS);
    // It read the device before it switched it.
    expect(calls.findIndex(isConfigRead), output).toBeGreaterThan(-1);
    expect(calls.findIndex(isConfigRead), output).toBeLessThan(calls.findIndex(isSwitchCall));
    // It read on through the restart, and installed only once the restarted
    // framework said bokmål and could install.
    expect(
      phaseCalls.map(({ phase }) => phase),
      output,
    ).toContain('restarting');
    expect(installs.length, output).toBeGreaterThan(0);
    expect(
      installs.map(({ phase }) => phase),
      output,
    ).toEqual(installs.map(() => 'up'));
    // The wait is the one it was: between each two readings, one sleep of
    // exactly the interval, and none for the switch.
    const slept = sleeps.filter(({ at }) => at <= Math.max(...readTimes)).map(({ ms }) => ms);
    expect(slept, sleptOtherwise({ sleeps: slept }, SHORT_INTERVAL, output)).toEqual(
      Array.from({ length: readTimes.length - 1 }, () => SHORT_INTERVAL),
    );
    expect(code, output).toBe(0);
    expect(output).toMatch(/\b1 of 1 flows? passed/);
  });

  test('BUG-17: on a device already in bokmål with its package service up, it switches nothing: no adb root, no wait-for-device and no setprop, and the flows run', async () => {
    // Passes before the fix too, which never switches: it fails a fix that
    // switches every device, bokmål or not.
    const { code, output, calls } = await runPastPreflight();

    // Not vacuous: it read the device's configuration.
    expect(calls.some(isConfigRead), output).toBe(true);
    expect(calls.filter(isSwitchCall), output).toEqual([]);
    expect(code, output).toBe(0);
    expect(output).toMatch(/\b1 of 1 flows? passed/);
  });

  test('BUG-17: when adb root is refused, as on a production build, it stops at once: it names adb root and says what adb printed, sets nothing, reads the device no more and sleeps not once', async () => {
    // The device would take the switch, so a script that went on past the
    // refusal would be seen to.
    const { code, stderr, output, calls, sleeps } = await runPastPreflight({
      switchable: { downFor: 3, after: 'nb-rNO' },
      rootAnswer: { output: `${ROOT_REFUSED}\n`, exit: 0 },
      env: SHORT_WAIT,
    });

    expect(calls.filter(isSwitchCall), output).toEqual([SWITCH_CALLS[0]]);
    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(stderr, output).toContain(ROOT_REFUSED);
    // The step is named apart from adbd's words, which say "root" too.
    expect(stderr.split(ROOT_REFUSED).join(''), output).toMatch(/\broot\b/);
    // At once: the one reading before the switch, and no wait at all.
    expect(calls.filter(isConfigRead).length, output).toBe(1);
    expect(sleeps, output).toEqual([]);
    expect(touchedDevice(calls)).toEqual([]);
  });

  test('BUG-17: when the switch is made and the framework restarts but comes back in en-rUS, it fails at the deadline, and says what it said before, that persist.sys.locale said nb-NO, and that the framework was seen restarting', async () => {
    const { code, stderr, output, calls } = await runPastPreflight({
      switchable: { downFor: 2, after: 'en-rUS' },
      env: { ...SHORT_WAIT, E2E_ANDROID_LOCALE_DEADLINE_MS: String(RESTART_DEADLINE) },
    });

    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    // What it said before.
    expect(stderr, output).toMatch(/bokmål/);
    expect(stderr, output).toMatch(/\bwait/i);
    expect(stderr, output).toMatch(saysHowLong(RESTART_DEADLINE));
    expect(stderr, output).toMatch(/\ben[-_]r?US\b/);
    expect(stderr, output).toMatch(/\bpackage\b/i);
    expect(stderr, output).not.toMatch(PACKAGE_MISSING);
    // What it adds: persist.sys.locale as last read, and the restart it saw.
    expect(stderr, output).toMatch(propertySays('nb-NO'));
    expect(stderr, output).not.toMatch(PROPERTY_EMPTY);
    expect(stderr, output).toMatch(SAYS_RESTART);
    expect(stderr, output).not.toMatch(NO_RESTART);
    // Not vacuous: the switch was made, once, and nothing was installed.
    expect(calls.filter(isSwitchCall), output).toEqual(SWITCH_CALLS);
    expect(touchedDevice(calls)).toEqual([]);
  });

  test('BUG-17: when the switch is made and nothing comes of it, it fails at the deadline, and says that persist.sys.locale was empty and that the framework was not seen restarting', async () => {
    // localeAnswers' device that never applies bokmål: the property stays
    // empty, and the package service is found throughout.
    const { code, stderr, output, calls } = await runPastPreflight({
      localeAppliedAfter: Infinity,
      env: SHORT_WAIT,
    });

    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(stderr, output).toMatch(/\ben[-_]r?US\b/);
    expect(stderr, output).toMatch(PROPERTY_EMPTY);
    expect(stderr, output).not.toMatch(propertySays('nb-NO'));
    expect(stderr, output).toMatch(NO_RESTART);
    // Not vacuous: the switch was made, once.
    expect(calls.filter(isSwitchCall), output).toEqual(SWITCH_CALLS);
  });
});
