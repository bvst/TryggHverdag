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
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

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

describe('what decides that a run passed', () => {
  test("INF-06-AC9: the entry script judges the run by Maestro's report, through the tested decision", () => {
    // A shape check, and a deliberately narrow one. The full run cannot be
    // driven from here without the build, and how the build phase is skipped
    // is the implementer's choice (spec, "e2e:android and the Maestro flow").
    // What this holds is that the verdict comes from judgeReport, whose
    // zero-flow and failed-flow cases are tested in lib/e2e-android.test.mjs,
    // rather than from Maestro's exit code alone.
    const source = readFileSync(SCRIPT, 'utf8');

    expect(source).toMatch(
      /import\s*\{[^}]*\bjudgeReport\b[^}]*\}\s*from\s*'\.\/lib\/e2e-android\.mjs'/,
    );
    expect(source).toMatch(/\bjudgeReport\s*\(/);
  });
});
