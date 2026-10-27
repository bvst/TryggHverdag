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
import { APK, SCRIPTED_FLOWS, ensureMaestro } from './lib/e2e-android.mjs';
import {
  DIALER_PACKAGE,
  appWindow,
  appWindowNode,
  buttonNode,
  callRecord,
  dialerWindow,
  dialingEvents,
  dialledEvents,
  editTextNode,
  endingEvents,
  hierarchyDump,
  layoutNode,
  maskedAddress,
  powerDump,
  progressNode,
  telecomDump,
  textNode,
  windowDump,
} from '../packages/test-kit/src/android-dumps.ts';
import { EMULATOR_FIRST_CONTACT, MOBILE } from '../packages/test-kit/src/fixtures/phone-numbers.ts';
import { flowsRunBy, maestroTags } from '../packages/test-kit/src/maestro-flows.ts';

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

/**
 * The stand-in Maestro.
 *
 * Amended for CALL-01, approach 9: with a `world` (worldMaestro), a run of
 * the flows is handed to the stand-in emulator's world, which records it,
 * does to the device what the flow would, writes the flow's report and exits
 * as the flow did. Without one, nothing changes.
 */
function maestroBody({ log, envLog, report, crashes, exit, world }) {
  const quote = (line) => `'${line.replace(/'/g, "'\\''")}'`;
  return [
    '#!/bin/sh',
    `echo "maestro $*" >> "${log}"`,
    `printf '%s\\t%s\\t%s\\n' "$*" "\${MAESTRO_DISABLE_UPDATE_CHECK-<unset>}" "\${MAESTRO_CLI_NO_ANALYTICS-<unset>}" >> "${envLog}"`,
    'if [ "$1" = "--version" ]; then echo "2.10.0"; exit 0; fi',
    ...(world === undefined
      ? []
      : [`exec "${process.execPath}" "${world.script}" "${world.config}" "$@"`]),
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
 * CALL-01, approach 9 (D-031): the stand-in emulator's world, for the flows
 * tagged `scripted`, which e2e:android runs one at a time with its own steps
 * around each. What the device holds is kept in files in `stateDir`, which
 * the stand-in adb reads and writes (worldAnswers) and this stand-in Maestro
 * changes as a flow would:
 *   telecom      what `dumpsys telecom` prints: Telecom's record of calls;
 *   window       what `dumpsys window` prints: the focused window;
 *   font_scale   Settings' font size, as `settings get system font_scale` says;
 *   call_phone   CALL_PHONE, granted or revoked.
 *
 * Each run of the flows is written to invocations.jsonl: its arguments, the
 * scripted flow it ran alone (`flow`, or null for any other run), and the
 * font size and CALL_PHONE's state as it started. A scripted flow run alone
 * does what its `effects` entry says: `calls`, each placed by the app or by
 * the dialer to #1 or to an emergency number, added to Telecom's record;
 * `focus`, the app's window or the dialer's left in front; `callPhone`, the
 * permission as the flow leaves it (Android's dialog in first-contact.yaml);
 * `status`, its report's, ERROR exiting 1. The report goes where --output
 * says. Every package and number is synthetic, and no call reaches anyone: it
 * is a line in a file (RG-07; SPIKE-01-AC10's rule).
 *
 * The script is read by Node as a module of its own, with the world's
 * config, written as JSON by runPastPreflight, as its first argument.
 *
 * Amended for CALL-01, approach 9, after PR #101's first android-e2e (run
 * 39956809738; RG-03 in the test-changes list): the device also has
 *   wakefulness  what `dumpsys power`'s mWakefulness= line says: Awake, or
 *                Asleep, Dozing, Dreaming;
 *   keyguard     shown or gone: a sleep leaves it shown;
 *   in_progress  the call still in progress, by its `to`, or empty when none
 *                is (a call placed with `inProgress: true`).
 * A scripted flow run while the phone is not Awake, or with the keyguard
 * shown, shows Maestro nothing: it fails at its first wait, as
 * call-without-permission did in that run, its report ERROR, exit 1, and
 * does nothing to the device. Each run's record holds the wakefulness and the
 * keyguard as it started. And `effects` may say more: `wakefulness`, the
 * phone as the flow leaves it (its screen timed out), with the keyguard
 * shown; `focus` 'launcher', or 'numbered' (a focused window with no package
 * of its own and a number in its title, the launcher the focused app);
 * `breaksDumps`, after which `dumpsys power` and `dumpsys window` fail. A
 * call with `inProgress: true` has its events only up to SET_DIALING; the
 * end-call key ends it (worldAnswers).
 *
 * Amended for BUG-70 (additive: no existing test sets either): the device
 * also has
 *   screen       what `uiautomator dump` writes: the screen, as a hierarchy
 *                (the launcher's until a flow leaves another).
 * A scripted flow's `effects` entry may say `screen`, the screen it leaves,
 * and the first run's `firstRun.screen` the one it leaves; in either, {APP}
 * is the application ID Maestro was given.
 */
const WORLD_MAESTRO = [
  "import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';",
  "import path from 'node:path';",
  'const [configFile, ...args] = process.argv.slice(2);',
  "const config = JSON.parse(readFileSync(configFile, 'utf8'));",
  'const at = (name) => path.join(config.stateDir, name);',
  "const read = (name) => (existsSync(at(name)) ? readFileSync(at(name), 'utf8').trim() : '');",
  'const after = (option) => {',
  '  const i = args.indexOf(option);',
  "  const joined = args.find((arg) => arg.startsWith(option + '='));",
  '  return i !== -1 ? args[i + 1] : joined?.slice(option.length + 1);',
  '};',
  "const env = args.filter((arg, i) => args[i - 1] === '-e' || args[i - 1] === '--env');",
  "const app = (env.find((value) => value.startsWith('APP_ID=')) ?? 'APP_ID=').slice('APP_ID='.length);",
  'const named = args',
  "  .filter((arg, i) => /\\.ya?ml$/.test(arg) && !['--config', '--output', '--debug-output'].includes(args[i - 1] ?? ''))",
  "  .map((arg) => arg.split('/').at(-1).replace(/\\.ya?ml$/, ''));",
  'const flow = named.length === 1 && config.scripted.includes(named[0]) ? named[0] : null;',
  "const wakefulness = read('wakefulness');",
  "const keyguard = read('keyguard');",
  'appendFileSync(',
  "  at('invocations.jsonl'),",
  "  JSON.stringify({ args, flow, fontScale: read('font_scale'), callPhone: read('call_phone'), wakefulness, keyguard }) + '\\n',",
  ');',
  // Review loop 1 (CALL-01, approach 9): a run not of one scripted flow, the
  // first run, plays the test's own first run when it has one (firstRun):
  // the report the test wrote, its crash buffer, and its exit status.
  'if (flow === null && config.firstRun !== undefined) {',
  "  const output = after('--output');",
  "  if (output !== undefined) writeFileSync(output, readFileSync(config.firstRun.report, 'utf8'));",
  '  if (config.firstRun.crashes !== undefined) {',
  '    writeFileSync(',
  '      config.firstRun.crashes,',
  "      config.firstRun.crashLines.map((line) => line.replace('$app', app)).join('\\n') + '\\n',",
  '    );',
  '  }',
  // BUG-70: the screen the first run leaves, when the test gives one.
  '  if (config.firstRun.screen !== undefined) {',
  "    writeFileSync(at('screen'), config.firstRun.screen.replaceAll('{APP}', app));",
  '  }',
  '  process.exit(config.firstRun.exit);',
  '}',
  // CALL-01, approach 9 (run 39956809738): a sleeping or locked phone shows
  // Maestro nothing, so a scripted flow fails at its first wait and does
  // nothing to the device.
  "if (flow !== null && (wakefulness !== 'Awake' || keyguard === 'shown')) {",
  "  const output = after('--output');",
  '  if (output !== undefined) writeFileSync(output, config.flowReports[flow].ERROR);',
  '  process.exit(1);',
  '}',
  'const effect = (flow === null ? undefined : config.effects[flow]) ?? {};',
  'for (const call of effect.calls ?? []) {',
  "  const id = Number(read('call_count') || '0') + 1;",
  "  writeFileSync(at('call_count'), String(id));",
  "  const by = call.by === 'app' ? app : config.dialer;",
  '  const templates = call.inProgress === true ? config.inProgressTemplates : config.callTemplates;',
  '  appendFileSync(',
  "    at('telecom'),",
  "    templates[call.to].replaceAll('{ID}', String(id)).replaceAll('{BY}', by),",
  '  );',
  "  if (call.inProgress === true) writeFileSync(at('in_progress'), call.to + '\\n');",
  '}',
  "if (effect.focus === 'dialer') writeFileSync(at('window'), config.dialerWindow);",
  "if (effect.focus === 'app') writeFileSync(at('window'), config.appWindow.replaceAll('{APP}', app));",
  "if (effect.focus === 'launcher') writeFileSync(at('window'), config.launcherWindow);",
  "if (effect.focus === 'numbered') writeFileSync(at('window'), config.numberedWindow);",
  "if (effect.callPhone !== undefined) writeFileSync(at('call_phone'), effect.callPhone + '\\n');",
  'if (effect.wakefulness !== undefined) {',
  "  writeFileSync(at('wakefulness'), effect.wakefulness + '\\n');",
  "  writeFileSync(at('keyguard'), 'shown\\n');",
  '}',
  "if (effect.breaksDumps === true) writeFileSync(at('dumps_broken'), 'yes\\n');",
  // BUG-70: the screen the flow leaves, when its effects say.
  "if (effect.screen !== undefined) writeFileSync(at('screen'), effect.screen.replaceAll('{APP}', app));",
  "const status = effect.status ?? 'SUCCESS';",
  "const output = after('--output');",
  'if (output !== undefined) {',
  '  writeFileSync(output, flow === null ? config.firstRunReport : config.flowReports[flow][status]);',
  '}',
  "process.exit(status === 'SUCCESS' ? 0 : 1);",
  '',
].join('\n');

/** #1's number as Telecom's record shows it (the test kit's, from Ofcom's range reserved for drama), and 112's. */
const FIRST_CONTACT_ADDRESS = maskedAddress(EMULATOR_FIRST_CONTACT.normalised);
const EMERGENCY_ADDRESS = maskedAddress('112');

/** The launcher, in front before any flow has run. */
const LAUNCHER_PACKAGE = 'com.google.android.apps.nexuslauncher';
const LAUNCHER_WINDOW = `Window{1f2e3d4 u0 ${LAUNCHER_PACKAGE}/${LAUNCHER_PACKAGE}.NexusLauncherActivity}`;

/** BUG-70: the launcher's screen, as uiautomator dumps it, in front before any flow has run. */
const LAUNCHER_SCREEN = hierarchyDump(LAUNCHER_PACKAGE, [
  layoutNode(
    [
      {
        resourceId: `${LAUNCHER_PACKAGE}:id/workspace`,
        children: [textNode('Telefon'), textNode('Meldinger')],
      },
    ],
    'android.widget.FrameLayout',
  ),
]);

/** BUG-70: where e2e:android has uiautomator write the screen on the device, and reads it back with cat. */
const SCREEN_DUMP_PATH = '/data/local/tmp/trygghverdag-window.xml';

/** Where the wakefulness goes in the power dump the stand-in prints (setUpWorld, worldAnswers). */
const WAKEFULNESS_SLOT = '<<wakefulness>>';

/**
 * PRIV-07 (CALL-01, approach 9): a window with no package of its own and
 * another synthetic number in its title, as a heads-up or a popup's title
 * could hold one, and the line the window dump lists it on. MOBILE is the test
 * kit's, and the script is never given it.
 */
const NUMBERED_WINDOW = `Window{2b3c4d5 u0 Ringer ${MOBILE}}`;
const NUMBERED_WINDOW_LINE = `  Window #2 ${NUMBERED_WINDOW}:`;

/**
 * Writes the stand-in emulator's world for a run (WORLD_MAESTRO) to
 * `stateDir`: a device as an earlier run on the same emulator leaves it, with
 * Telecom's record holding no call, the launcher in front, the usual font
 * size, and CALL_PHONE granted, as `adb install -r` keeps a grant. And the
 * config WORLD_MAESTRO reads: which flows in `flowsDir` are scripted, each
 * one's report, and the dumps it writes. Returns where the script and its
 * config are.
 *
 * Amended for CALL-01, approach 9, after PR #101's first android-e2e: the
 * phone starts Awake with no keyguard, and no call in progress; and the
 * files worldAnswers prints `dumpsys power` from, and the events it adds
 * when the end-call key ends a call in progress (call-end-<to>). With
 * `world.unmasked` (PRIV-07: an emulator image may print a number unmasked),
 * Telecom's record shows every address in full, its history holds, before
 * the run, an incoming call from another of the test kit's synthetic numbers
 * (MOBILE, which the script is never given), and every window dump holds a
 * window with that number in its title. Nothing here dials: each is a line in
 * a file the stand-in prints.
 */
function setUpWorld({ dir, stateDir, flowsDir, world }) {
  const firstAddress =
    world.unmasked === true ? `tel:${EMULATOR_FIRST_CONTACT.normalised}` : FIRST_CONTACT_ADDRESS;
  const emergencyAddress = world.unmasked === true ? 'tel:112' : EMERGENCY_ADDRESS;
  const otherAddress = `tel:${MOBILE}`;
  const withNumberedWindow = (dump) =>
    world.unmasked === true
      ? dump.replace('  mCurrentFocus=', `${NUMBERED_WINDOW_LINE}\n  mCurrentFocus=`)
      : dump;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    path.join(stateDir, 'telecom'),
    telecomDump(
      world.unmasked === true
        ? [
            callRecord({
              id: 0,
              direction: 'MT - incoming',
              address: otherAddress,
              events: dialledEvents(DIALER_PACKAGE, otherAddress),
            }),
          ]
        : [],
    ),
  );
  writeFileSync(path.join(stateDir, 'window'), withNumberedWindow(windowDump(LAUNCHER_WINDOW)));
  writeFileSync(path.join(stateDir, 'font_scale'), '1.0\n');
  writeFileSync(path.join(stateDir, 'call_phone'), 'granted\n');
  writeFileSync(path.join(stateDir, 'wakefulness'), 'Awake\n');
  writeFileSync(path.join(stateDir, 'keyguard'), 'gone\n');
  writeFileSync(path.join(stateDir, 'in_progress'), '');
  // BUG-70: the launcher's screen, until a flow leaves another.
  writeFileSync(path.join(stateDir, 'screen'), LAUNCHER_SCREEN);
  const [powerHead = '', powerTail = ''] = powerDump(WAKEFULNESS_SLOT).split(WAKEFULNESS_SLOT);
  writeFileSync(path.join(stateDir, 'power-head'), powerHead);
  writeFileSync(path.join(stateDir, 'power-tail'), powerTail);
  writeFileSync(path.join(stateDir, 'power-no-line'), powerDump(null));
  const endLines = (to) =>
    `${endingEvents(to)
      .map((event) => `    ${event}`)
      .join('\n')}\n`;
  writeFileSync(path.join(stateDir, 'call-end-first'), endLines(firstAddress));
  writeFileSync(path.join(stateDir, 'call-end-emergency'), endLines(emergencyAddress));
  const flows = readdirSync(flowsDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => ({
      name: name.replace(/\.ya?ml$/, ''),
      tags: maestroTags(readFileSync(path.join(flowsDir, name), 'utf8')),
    }));
  const scripted = flows.filter(({ tags }) => tags.includes('scripted')).map(({ name }) => name);
  const template = (address) =>
    `${callRecord({ id: '{ID}', address, events: dialledEvents('{BY}', address) }).join('\n')}\n`;
  // CALL-01, approach 9: a call placed with `inProgress: true` has its events
  // only up to SET_DIALING; the end-call key adds the rest (call-end-<to>).
  const inProgress = (to) =>
    `${callRecord({ id: '{ID}', address: to, events: dialingEvents('{BY}', to) }).join('\n')}\n`;
  const config = {
    stateDir,
    scripted,
    effects: world.effects ?? {},
    firstRun: world.firstRun,
    firstRunReport: junit(
      flows.filter(({ name }) => !scripted.includes(name)).map(({ name }) => [name, 'SUCCESS']),
    ),
    flowReports: Object.fromEntries(
      scripted.map((name) => [
        name,
        { SUCCESS: junit([[name, 'SUCCESS']]), ERROR: junit([[name, 'ERROR']]) },
      ]),
    ),
    // Amended for CALL-01, approach 9 (PRIV-07): with `unmasked`, the
    // addresses in full; otherwise masked, as before.
    callTemplates: {
      first: template(firstAddress),
      emergency: template(emergencyAddress),
    },
    inProgressTemplates: {
      first: inProgress(firstAddress),
      emergency: inProgress(emergencyAddress),
    },
    dialerWindow: withNumberedWindow(windowDump(dialerWindow())),
    appWindow: withNumberedWindow(windowDump(appWindow('{APP}'))),
    launcherWindow: withNumberedWindow(windowDump(LAUNCHER_WINDOW)),
    numberedWindow: withNumberedWindow(windowDump(NUMBERED_WINDOW, LAUNCHER_WINDOW)),
    dialer: DIALER_PACKAGE,
  };
  const files = {
    script: path.join(dir, 'world-maestro.mjs'),
    config: path.join(dir, 'world.json'),
  };
  writeFileSync(files.script, WORLD_MAESTRO);
  writeFileSync(files.config, JSON.stringify(config));
  return files;
}

/**
 * How the stand-in emulator's world answers in `shell`'s case (CALL-01,
 * approach 9): Telecom's record, the focused window and the dialer role's
 * holder; CALL_PHONE granted and revoked, and the font size set, cleared and
 * read, each kept in `stateDir` (WORLD_MAESTRO says which file holds what);
 * and the API level of CI's image. `refuse` makes Android refuse a step, as
 * a SecurityException does: every `pm revoke` of CALL_PHONE ('revoke'), or
 * every font size above 1 ('largeFont').
 *
 * Amended for CALL-01, approach 9, after PR #101's first android-e2e (RG-03
 * in the test-changes list): `dumpsys power` prints the power dump with its
 * mWakefulness= line holding the phone's wakefulness; the wake key
 * (KEYCODE_WAKEUP, or its code 224) makes the phone Awake; `wm
 * dismiss-keyguard` lifts the keyguard, but only from an Awake phone; and the
 * end-call key (KEYCODE_ENDCALL, or its code 6) ends the call in progress,
 * adding its ending events to Telecom's record, or, with no call in progress,
 * puts the phone to sleep with the keyguard shown, as Android's
 * END_BUTTON_BEHAVIOR_SLEEP does (inferred in run 39956809738, not seen). Once
 * a flow has broken them (`breaksDumps`), `dumpsys power` and `dumpsys window`
 * fail as a missing service does. `refuse` may also be 'wake' (the wake key
 * leaves the phone as it was) or 'powerRead' (`dumpsys power` prints its dump
 * with no mWakefulness= line).
 *
 * Amended for BUG-70 (additive: today's script calls neither, and no existing
 * test refuses it): `uiautomator dump`, to SCREEN_DUMP_PATH and nowhere else,
 * copies the screen (WORLD_MAESTRO) to the device's file at that path and
 * says so, as the tool does ("UI hierchary dumped to: …", its own spelling);
 * `cat` of that path prints the file, or fails as cat does when there is none.
 * `refuse` may be 'screenDump': uiautomator then prints the error it gives
 * with no window to read, writes nothing, and exits 1 (the exit status is the
 * stand-in's choice: the real tool's, for that error, is not known here).
 *
 * @param {{ stateDir: string, refuse?: 'revoke' | 'largeFont' | 'wake' | 'powerRead' | 'screenDump' }} world
 */
function worldAnswers({ stateDir, refuse }) {
  const file = (name) => `"${path.join(stateDir, name)}"`;
  const refusal = (what) => [
    `        echo "Exception occurred while executing '${what}':" >&2`,
    '        echo "java.lang.SecurityException: refused by the stand-in emulator (synthetic)" >&2',
    '        exit 1',
  ];
  /** A dump that fails, as one from a missing service does, once a flow has broken the dumps. */
  const broken = (service) =>
    `        if [ -s ${file('dumps_broken')} ]; then echo "Can't find service: ${service}" >&2; exit 1; fi`;
  return [
    // BUG-70: the screen, dumped by uiautomator to the device, and printed by cat.
    '      *uiautomator*)',
    ...(refuse === 'screenDump'
      ? [
          '        echo "ERROR: null root node returned by UiTestAutomationBridge." >&2',
          '        exit 1 ;;',
        ]
      : [
          `        if [ "$*" != "shell uiautomator dump ${SCREEN_DUMP_PATH}" ]; then`,
          `          echo "the stand-in emulator dumps the screen only to ${SCREEN_DUMP_PATH}" >&2; exit 2`,
          '        fi',
          `        /bin/cp ${file('screen')} ${file('screen-dumped')}`,
          `        echo "UI hierchary dumped to: ${SCREEN_DUMP_PATH}" ;;`,
        ]),
    `      "shell cat ${SCREEN_DUMP_PATH}")`,
    `        if [ ! -f ${file('screen-dumped')} ]; then`,
    `          echo "cat: ${SCREEN_DUMP_PATH}: No such file or directory" >&2; exit 1`,
    '        fi',
    `        /bin/cat ${file('screen-dumped')} ;;`,
    `      *dumpsys*telecom*) /bin/cat ${file('telecom')} ;;`,
    '      *dumpsys*window*)',
    broken('window'),
    `        /bin/cat ${file('window')} ;;`,
    '      *dumpsys*power*)',
    broken('power'),
    ...(refuse === 'powerRead'
      ? [`        /bin/cat ${file('power-no-line')} ;;`]
      : [
          `        read -r w < ${file('wakefulness')}`,
          `        /bin/cat ${file('power-head')}; printf '%s' "$w"; /bin/cat ${file('power-tail')} ;;`,
        ]),
    '      *input*keyevent*KEYCODE_WAKEUP*|*input*keyevent\\ 224)',
    refuse === 'wake' ? '        ;;' : `        echo Awake > ${file('wakefulness')} ;;`,
    '      *wm*dismiss-keyguard*)',
    `        read -r w < ${file('wakefulness')}`,
    `        if [ "$w" = Awake ]; then echo gone > ${file('keyguard')}; fi ;;`,
    '      *input*keyevent*KEYCODE_ENDCALL*|*input*keyevent\\ 6)',
    `        if [ -s ${file('in_progress')} ]; then`,
    `          read -r to < ${file('in_progress')}`,
    `          /bin/cat "${stateDir}/call-end-$to" >> ${file('telecom')}`,
    `          : > ${file('in_progress')}`,
    '        else',
    `          echo Asleep > ${file('wakefulness')}`,
    `          echo shown > ${file('keyguard')}`,
    '        fi ;;',
    `      *get-role-holders*android.app.role.DIALER*) echo "${DIALER_PACKAGE}" ;;`,
    '      *pm*grant*android.permission.CALL_PHONE*)',
    `        echo granted > ${file('call_phone')} ;;`,
    '      *pm*revoke*android.permission.CALL_PHONE*)',
    ...(refuse === 'revoke' ? refusal('revoke') : []),
    `        echo revoked > ${file('call_phone')} ;;`,
    '      *settings*put*system*font_scale*)',
    '        for v in $*; do :; done',
    ...(refuse === 'largeFont'
      ? [
          `        if "${process.execPath}" -e 'process.exit(Number(process.argv[1]) > 1 ? 0 : 1)' "$v"; then`,
          ...refusal('settings').map((line) => `  ${line}`),
          '        fi',
        ]
      : []),
    `        echo "$v" > ${file('font_scale')} ;;`,
    '      *settings*delete*system*font_scale*)',
    `        echo 1.0 > ${file('font_scale')} ;;`,
    `      *settings*get*system*font_scale*) /bin/cat ${file('font_scale')} ;;`,
    '      *getprop*ro.build.version.sdk*) echo 37 ;;',
  ];
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
 * Amended for CALL-01, approach 9: with a `world`, the stand-in emulator's
 * world answers first in `shell`'s case (worldAnswers).
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
  world,
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
    ...(world === undefined ? [] : worldAnswers(world)),
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
 *   and `stopAfter` kills it `ms` after its first call that `call` matches.
 *
 *   Amended for CALL-01, approach 9 (D-031; RG-03 in the test-changes list):
 *   `copyFlows` is which of the app's flows the scratch copy holds. By
 *   default, 'unscripted': only the flows not tagged `scripted`, as the folder
 *   held before the call flows came, because the tests that use the default
 *   are of INF-06's one run, its preflight and its waits, and the scripted
 *   flows need a device that answers for Telecom, the focused window and the
 *   dialer role, which only `world` gives. 'all' copies every flow.
 *   `extraFlows` adds synthetic flows, by file name. `world` is the stand-in
 *   emulator's world for the scripted flows (WORLD_MAESTRO, worldAnswers):
 *   each flow's `effects`, and what Android `refuse`s.
 *
 *   Amended again in review loop 1 (CALL-01, approach 9; RG-03 in the
 *   test-changes list): a flow the script's order names that is absent from
 *   the folder, or there but not tagged `scripted`, now stops the run before
 *   any flow runs. The default 'unscripted' copy lacks every scripted flow,
 *   so every run past the install would stop there, and the tests of INF-06's
 *   one run, its preflight and its waits would no longer reach what they
 *   test. So `copyFlows` is 'all' by default, the folder as CI has it, and a
 *   run given no `world` gets the stand-in emulator's world as it should be
 *   (AS_IT_SHOULD_BE), with its first run played as before: the report
 *   `flows` makes, Maestro's exit status `maestroExit`, and the crash buffer
 *   `crash` asks for (WORLD_MAESTRO's `firstRun`). The scripted flows then run
 *   after a first run that passes, each as it should. 'unscripted' stays, for
 *   the test that the run stops when they are absent.
 *
 *   Amended for BUG-70 (additive): `firstRunScreen` is the screen that first
 *   run leaves, as uiautomator dumps it ({APP} for the application ID); unset,
 *   the launcher's stays, as before. And the result holds `screenDumped`, the
 *   file uiautomator wrote on the device, empty when nothing dumped the screen.
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
  // RG-03 (review loop 1): was 'unscripted'; see the amendment above.
  copyFlows = 'all',
  extraFlows = {},
  world,
  firstRunScreen,
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
    // RG-03 (CALL-01, approach 9, D-031): was every flow of the folder. The
    // flows tagged `scripted` are copied only when a test asks for them, with
    // the world they need (`copyFlows`, above).
    cpSync(path.join(REPO, APP, 'e2e'), path.join(root, APP, 'e2e'), {
      recursive: true,
      filter: (source) =>
        copyFlows === 'all' ||
        !/\.ya?ml$/.test(source) ||
        !maestroTags(readFileSync(source, 'utf8')).includes('scripted'),
    });
    for (const [name, text] of Object.entries(extraFlows)) {
      writeFileSync(path.join(root, APP, 'e2e', name), text);
    }
    symlinkSync(path.join(REPO, APP, 'node_modules'), path.join(root, APP, 'node_modules'), 'dir');
    mkdirSync(path.dirname(path.join(root, APK)), { recursive: true });
    writeFileSync(path.join(root, APK), 'a stand-in for the release build');

    writeFileSync(report, junit(flows));
    const stateDir = path.join(dir, 'world');
    // Review loop 1: with every flow copied and no world given, the world as
    // it should be, with this test's own first run (see the amendment above).
    const worldInUse =
      world ??
      (copyFlows === 'all'
        ? {
            effects: AS_IT_SHOULD_BE,
            firstRun: {
              report,
              exit: maestroExit,
              crashes: crash ? crashes : undefined,
              crashLines: CRASH_BUFFER,
              screen: firstRunScreen,
            },
          }
        : undefined);
    const worldFiles =
      worldInUse === undefined
        ? undefined
        : setUpWorld({ dir, stateDir, flowsDir: path.join(root, APP, 'e2e'), world: worldInUse });
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
            world: worldFiles,
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
          world: worldInUse === undefined ? undefined : { stateDir, refuse: worldInUse.refuse },
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
      // With a world: each run of the flows, as WORLD_MAESTRO recorded it, and
      // the font size Settings holds at the end.
      invocations: lines(path.join(stateDir, 'invocations.jsonl'))
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line)),
      fontScaleAtEnd: lines(path.join(stateDir, 'font_scale')).join(''),
      // Added for CALL-01, approach 9 (PRIV-07): what Telecom's record and the
      // window dump held at the end, so a test can show that the numbers it
      // keeps out of the job log were there to leak.
      telecomAtEnd: lines(path.join(stateDir, 'telecom')).join('\n'),
      windowAtEnd: lines(path.join(stateDir, 'window')).join('\n'),
      // Added for BUG-70: the file uiautomator wrote on the device, so a test
      // can show that what it keeps out of the job log was there to leak.
      screenDumped: lines(path.join(stateDir, 'screen-dumped')).join('\n'),
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
function expectInstalledOnThirdAttempt({
  code,
  output,
  calls,
  invocations,
  sleeps,
  readTimes,
  installTimes,
}) {
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
  // RG-03 (review loop 1, CALL-01 approach 9): was "exactly one run of the
  // flows". The harness now copies every flow, the scripted ones included
  // (runPastPreflight's amendment), so the first run is followed by one run
  // of each scripted flow. What this holds is unchanged: no run of the flows
  // was repeated. The first run, once; each scripted flow, once.
  const runs = flowRunsOf({ calls, invocations });
  const scriptedRuns = runs.filter(({ flow }) => flow !== null).map(({ flow }) => flow);
  expect(runs.length, output).toBe(calls.filter(isFlowRun).length);
  expect(runs.filter(({ flow }) => flow === null).length, output).toBe(1);
  expect(scriptedRuns, output).toEqual([...new Set(scriptedRuns)]);
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

// CALL-01, approach 9 (the main session's decision under D-031): after the
// one run over every flow not tagged `scripted`, e2e:android runs each flow
// tagged `scripted` on its own, one `maestro test <flow>` each, in a fixed
// order it holds, with its steps around it: before it, CALL_PHONE granted or
// revoked as the flow needs, the font size set, and Telecom's record read as
// the baseline; after it, Telecom's record read again and compared (one new
// call, to #1, after call-with-permission; none after any other), and the
// focused window checked against the dialer role where the flow leaves the
// dialer in front. The font size is reset at the end, even after a failure,
// and a failed step or flow fails the run, naming the flow and the step.
//
// These runs copy every flow of the app's folder (copyFlows: 'all'), the
// real ones, and give the stand-in emulator a world (WORLD_MAESTRO) that
// answers for Telecom, the window, the role, the permission and the font
// size. Nothing here dials anything: a call is a line in a file.

/** The flows of the app's folder, by file name, with their tags. */
const APP_FLOWS = readdirSync(path.join(REPO, APP, 'e2e'))
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({
    name,
    tags: maestroTags(readFileSync(path.join(REPO, APP, 'e2e', name), 'utf8')),
  }));
const SCRIPTED = APP_FLOWS.filter(({ tags }) => tags.includes('scripted'))
  .map(({ name }) => name)
  .sort();
const UNSCRIPTED = APP_FLOWS.filter(({ tags }) => !tags.includes('scripted'))
  .map(({ name }) => name)
  .sort();

/**
 * What each scripted flow does to the device in a run where all is as it
 * should be. first-contact.yaml grants CALL_PHONE in Android's dialog;
 * call-with-permission.yaml places one call, by the app, to #1, and the
 * dialer's call screen comes to the front; the flows that open the dialer
 * leave it in front; the others leave the app there.
 *
 * RG-03 (CALL-01, approach 9, after PR #101's first android-e2e): the call
 * call-with-permission places was ended in Telecom's record by the time the
 * script read it (dialledEvents, SET_DISCONNECTED and DESTROYED included). It
 * is now still in progress (`inProgress: true`: its events up to SET_DIALING)
 * until the script's end-call key ends it. Approach 9 now presses that key
 * only while Telecom shows the call in progress, and the existing assertion
 * that the call is ended after call-with-permission (the "each scripted flow
 * gets its steps" test, `endsCall`) is unchanged; it holds in a world where
 * there is a call to end. A call already ended when the flow ends, as
 * SPIKE-01's emulator call was (the network ended it 0.14 s after dialling),
 * is the world of the tests below that reproduce run 39956809738.
 */
const AS_IT_SHOULD_BE = {
  'first-admin-invites': { focus: 'app' },
  'first-contact': { focus: 'app', callPhone: 'granted' },
  'call-with-permission': {
    calls: [{ by: 'app', to: 'first', inProgress: true }],
    focus: 'dialer',
  },
  'call-without-permission': { focus: 'dialer' },
  'back-from-the-dialer': { focus: 'app' },
  'large-text': { focus: 'app' },
  'emergency-112': { focus: 'dialer' },
};

/**
 * What the script does around each scripted flow, from the flows' headers:
 * CALL_PHONE's state as the flow starts (`callPhone`); the font size it
 * starts at, the largest for large-text and the usual 1 for the others
 * (`largest`); whether the script checks the dialer in front after it
 * (`dialer`); and whether it ends the call after it (`endsCall`). Telecom's
 * record is read before and after every one.
 */
const STEPS = {
  'first-admin-invites.yaml': {},
  'first-contact.yaml': { callPhone: 'revoked' },
  'call-with-permission.yaml': { callPhone: 'granted', endsCall: true },
  'call-without-permission.yaml': { callPhone: 'revoked', dialer: true },
  'back-from-the-dialer.yaml': {},
  'large-text.yaml': { largest: true },
  'emergency-112.yaml': { dialer: true },
};

/** Calls to adb that read Telecom's record, the focused window, or the dialer role's holders. */
const isTelecomRead = (call) => /^adb\b.*\bdumpsys\b.*\btelecom\b/.test(call);
const isWindowRead = (call) => /^adb\b.*\bdumpsys\b.*\bwindow\b/.test(call);
const isRoleRead = (call) =>
  /^adb\b.*\bget-role-holders\b.*\bandroid\.app\.role\.DIALER\b/.test(call);
/** Calls to adb that set, or clear, Settings' font size. */
const isFontWrite = (call) =>
  /^adb\b.*\bsettings\b.*\b(put|delete)\b.*\bsystem\b.*\bfont_scale\b/.test(call);
/** A font size set back to the usual: put to 1, or cleared. */
const isFontReset = (call) =>
  /^adb\b.*\bsettings\b.*\bdelete\b.*\bsystem\b.*\bfont_scale\b/.test(call) ||
  /^adb\b.*\bsettings\b.*\bput\b.*\bsystem\b.*\bfont_scale\s+1(\.0+)?['"]?\s*$/.test(call);
/**
 * A call to adb that ends a call: the end-call key, the emulator console's
 * `gsm cancel`, or the phone service's end call. How is the script's choice.
 */
/**
 * A call to adb that presses Android's back key (review loop 1): the key's
 * name, or its code, 4.
 */
const pressesBack = (call) => /^adb\b.*\binput\b.*\bkeyevent\b.*\b(KEYCODE_BACK|4)\b/.test(call);
const endsTheCall = (call) =>
  /^adb\b.*\bkeyevent\b.*\b(KEYCODE_ENDCALL|6)\b/.test(call) ||
  /^adb\b.*\bgsm\b.*\bcancel\b/.test(call) ||
  /^adb\b.*\bservice\s+call\s+phone\b/.test(call);

/**
 * A run with every flow copied and the stand-in emulator's world, as it should
 * be unless `effects` or `refuse` say otherwise. Amended for CALL-01, approach
 * 9 (PRIV-07): `unmasked` has Telecom's record and the window dumps hold
 * numbers in full (setUpWorld).
 */
const runScripted = ({ effects = {}, refuse, extraFlows, unmasked } = {}) =>
  runPastPreflight({
    copyFlows: 'all',
    extraFlows,
    world: { effects: { ...AS_IT_SHOULD_BE, ...effects }, refuse, unmasked },
  });

/**
 * The runs of the flows in a run, in order: the flows each one ran, as Maestro
 * reads its command line; the scripted flow it ran alone, or null; the font
 * size and CALL_PHONE's state as it started; where it is in `calls`; and the
 * calls to adb before it, since the run before (or the start), and after it,
 * until the next (or the end).
 */
function flowRunsOf({ calls, invocations }, flows = APP_FLOWS) {
  const at = calls.flatMap((call, i) => (isFlowRun(call) ? [i] : []));
  return at.map((index, n) => {
    const invocation = invocations[n] ?? { args: [], flow: null, fontScale: '', callPhone: '' };
    const from = n === 0 ? 0 : (at[n - 1] ?? 0) + 1;
    const to = at[n + 1] ?? calls.length;
    return {
      index,
      flows: flowsRunBy(['maestro', ...invocation.args], { folder: `${APP}/e2e`, flows }),
      flow: invocation.flow === null ? null : `${String(invocation.flow)}.yaml`,
      fontScale: invocation.fontScale,
      callPhone: invocation.callPhone,
      before: calls.slice(from, index).filter((call) => call.startsWith('adb')),
      after: calls.slice(index + 1, to).filter((call) => call.startsWith('adb')),
      end: to,
    };
  });
}

/** Whether a flow of the app's folder clears the app's state at launch (`clearState: true`). */
const clearsState = (name) =>
  readFileSync(path.join(REPO, APP, 'e2e', name), 'utf8')
    .split('\n---')
    .slice(1)
    .join('\n---')
    .split('\n')
    .some((line) => !line.trimStart().startsWith('#') && /^\s+clearState:\s*true\s*$/.test(line));

/**
 * What each scripted flow's header says must run before it, as pairs of
 * [earlier, later]. emergency-112 clears the app's state, which signs the app
 * out and forgets #1, so it comes after every flow that needs either.
 * first-contact continues from first-admin-invites' state (D-031).
 */
const MUST_RUN_BEFORE = [
  ['first-admin-invites.yaml', 'first-contact.yaml'],
  ['first-contact.yaml', 'call-with-permission.yaml'],
  ['first-contact.yaml', 'call-without-permission.yaml'],
  ['first-contact.yaml', 'large-text.yaml'],
  ['call-with-permission.yaml', 'call-without-permission.yaml'],
  ['first-contact.yaml', 'emergency-112.yaml'],
  ['call-with-permission.yaml', 'emergency-112.yaml'],
  ['call-without-permission.yaml', 'emergency-112.yaml'],
  ['large-text.yaml', 'emergency-112.yaml'],
];

/**
 * Ways a run goes wrong after the first run, each with the flow whose step
 * failed, a word the message must hold for that step, and where in the calls
 * it failed. Kept out of the test.each call, as REPORT_PROBLEMS is.
 */
const SCRIPTED_FAILURES = [
  {
    // Telecom's record shows no new call after the flow.
    id: 'CALL-01-AC2',
    what: 'call-with-permission places no call',
    effects: { 'call-with-permission': { focus: 'app' } },
    flow: 'call-with-permission',
    step: /telecom/i,
    failedAt: (calls) => calls.findIndex((call) => /call-with-permission\.yaml/.test(call)),
  },
  {
    // The new call was created by the dialer, which means a second tap.
    id: 'CALL-01-AC2',
    what: 'the dialer, not the app, placed the call',
    effects: {
      'call-with-permission': { calls: [{ by: 'dialer', to: 'first' }], focus: 'dialer' },
    },
    flow: 'call-with-permission',
    step: /telecom/i,
    failedAt: (calls) => calls.findIndex((call) => /call-with-permission\.yaml/.test(call)),
  },
  {
    // A new call in Telecom's record, though the flow never taps the dialer.
    id: 'CALL-02-AC3',
    what: 'a call appears during emergency-112',
    effects: { 'emergency-112': { calls: [{ by: 'dialer', to: 'emergency' }], focus: 'dialer' } },
    flow: 'emergency-112',
    step: /telecom/i,
    failedAt: (calls) => calls.findIndex((call) => /emergency-112\.yaml/.test(call)),
  },
  {
    id: 'CALL-02-AC3',
    what: 'emergency-112 leaves the app in front',
    effects: { 'emergency-112': { focus: 'app' } },
    flow: 'emergency-112',
    step: /focus|window|in front/i,
    failedAt: (calls) => calls.findIndex((call) => /emergency-112\.yaml/.test(call)),
  },
  {
    // The app, not the dialer, is in front after call-without-permission.
    id: 'CALL-01-AC4',
    what: 'call-without-permission shows no dialer',
    effects: { 'call-without-permission': { focus: 'app' } },
    flow: 'call-without-permission',
    step: /focus|window|in front/i,
    failedAt: (calls) => calls.findIndex((call) => /call-without-permission\.yaml/.test(call)),
  },
  {
    // call-without-permission's own run ends in ERROR, exit code 1.
    id: 'INF-06-AC9',
    what: 'a scripted flow fails in Maestro',
    effects: { 'call-without-permission': { focus: 'dialer', status: 'ERROR' } },
    flow: 'call-without-permission',
    step: /\bmaestro\b|\bexit|\bERROR\b/i,
    failedAt: (calls) => calls.findIndex((call) => /call-without-permission\.yaml/.test(call)),
  },
  {
    // Every `pm revoke` of CALL_PHONE is refused; first-contact needs one first.
    id: 'CALL-01-AC3',
    what: 'Android refuses to revoke CALL_PHONE',
    refuse: 'revoke',
    flow: 'first-contact',
    step: /\brevoke|CALL_PHONE/i,
    failedAt: (calls) => calls.findIndex((call) => /^adb\b.*\bpm\b.*\brevoke\b/.test(call)),
  },
  {
    // Every font size above 1 is refused; large-text needs the largest.
    id: 'CALL-01-AC8',
    what: 'Android refuses the largest font size',
    refuse: 'largeFont',
    flow: 'large-text',
    step: /font/i,
    failedAt: (calls) =>
      calls.findIndex(
        (call) => isFontWrite(call) && !isFontReset(call) && !/font_scale\s+0/.test(call),
      ),
  },
];

describe('CALL-01, approach 9: e2e:android runs each flow tagged scripted on its own, in its order, with its steps', () => {
  test('INF-06-AC9: with every flow passing and the emulator answering as it should, the run passes: first one run over every flow not tagged scripted, then one run for each scripted flow, alone', async () => {
    const { code, output, calls, invocations } = await runScripted();
    const runs = flowRunsOf({ calls, invocations });

    expect(code, output).toBe(0);
    // The first run's flows are app-starts and wrong-code: first-admin-invites
    // is scripted, for its place in the order (D-031). And the folder holds both kinds.
    expect(UNSCRIPTED).toEqual(['app-starts.yaml', 'wrong-code.yaml']);
    expect(SCRIPTED).toContain('first-admin-invites.yaml');
    expect(runs[0]?.flows, output).toEqual(UNSCRIPTED);
    expect(
      runs.slice(1).map(({ flows }) => flows.length),
      output,
    ).toEqual(runs.slice(1).map(() => 1));
    expect(
      runs
        .slice(1)
        .map(({ flow }) => flow)
        .sort(),
      output,
    ).toEqual(SCRIPTED);
  });

  test('CALL-01-AC2, CALL-01-AC4 and CALL-02-AC3: the scripted flows run in an order that meets what each one’s header says it needs before it', async () => {
    const { output, calls, invocations } = await runScripted();
    const order = flowRunsOf({ calls, invocations })
      .map(({ flow }) => flow)
      .filter((flow) => flow !== null);
    const unmet = MUST_RUN_BEFORE.filter(
      ([earlier, later]) =>
        !order.includes(earlier) ||
        !order.includes(later) ||
        order.indexOf(earlier) > order.indexOf(later),
    ).map(([earlier, later]) => `${earlier} before ${later}`);
    const back = order.indexOf('back-from-the-dialer.yaml');

    expect(unmet, `order: ${JSON.stringify(order)}\n${output}`).toEqual([]);
    // The way back from the dialer comes right after a flow that left it in front.
    expect(back, `order: ${JSON.stringify(order)}`).toBeGreaterThan(0);
    expect(['emergency-112.yaml', 'call-without-permission.yaml']).toContain(order[back - 1]);
  });

  test('GRP-01-AC26 and GRP-02-AC1: first-admin-invites runs first of the scripted flows, on its own, and before first-contact, with no flow that clears the app’s state between them, so first-contact starts signed in as the first admin (D-031)', async () => {
    const { output, calls, invocations } = await runScripted();
    const runs = flowRunsOf({ calls, invocations });
    const scripted = runs.filter(({ flow }) => flow !== null);
    const admin = runs.findIndex(({ flow }) => flow === 'first-admin-invites.yaml');
    const contact = runs.findIndex(({ flow }) => flow === 'first-contact.yaml');
    const clearing = runs
      .slice(admin + 1, contact)
      .flatMap(({ flows }) => flows)
      .filter(clearsState);

    // Not vacuous: the flows that clear the app's state are known by their steps.
    expect(
      ['app-starts.yaml', 'wrong-code.yaml', 'emergency-112.yaml'].filter(clearsState),
    ).toEqual(['app-starts.yaml', 'wrong-code.yaml', 'emergency-112.yaml']);
    expect(scripted[0]?.flow, output).toBe('first-admin-invites.yaml');
    // In a run of its own, not in the first run, where Maestro picks the order.
    expect(runs[0]?.flows ?? [], output).not.toContain('first-admin-invites.yaml');
    expect(admin, output).toBeGreaterThan(0);
    expect(contact, output).toBeGreaterThan(admin);
    expect(clearing, output).toEqual([]);
  });

  test('CALL-01-AC2, CALL-01-AC3, CALL-01-AC4, CALL-01-AC8 and CALL-02-AC3: each scripted flow gets its steps: CALL_PHONE as it needs, its font size, and Telecom’s record read before it; Telecom’s record read after it; the dialer checked in front where it leaves it; and the call ended after call-with-permission', async () => {
    const { output, calls, invocations } = await runScripted();
    const runs = flowRunsOf({ calls, invocations });
    const missing = [];
    for (const [flow, need] of Object.entries(STEPS)) {
      const run = runs.find((candidate) => candidate.flow === flow);
      if (run === undefined) {
        missing.push(`${flow}: never run on its own`);
        continue;
      }
      if (need.callPhone !== undefined && run.callPhone !== need.callPhone) {
        missing.push(`${flow}: started with CALL_PHONE ${run.callPhone}, not ${need.callPhone}`);
      }
      const scale = Number(run.fontScale);
      if (need.largest === true ? !(scale > 1) : scale !== 1) {
        missing.push(`${flow}: started at font size ${run.fontScale}`);
      }
      if (!run.before.some(isTelecomRead)) missing.push(`${flow}: Telecom not read before it`);
      if (!run.after.some(isTelecomRead)) missing.push(`${flow}: Telecom not read after it`);
      if (need.dialer === true) {
        if (!run.after.some(isWindowRead)) {
          missing.push(`${flow}: the focused window not read after it`);
        }
        if (!calls.slice(0, run.end).some(isRoleRead)) {
          missing.push(`${flow}: the dialer role's holders not read by then`);
        }
      }
      if (need.endsCall === true) {
        const read = run.after.findIndex(isTelecomRead);
        if (!run.after.slice(read + 1).some(endsTheCall)) {
          missing.push(`${flow}: the call not ended after Telecom was read`);
        }
      }
    }

    expect(missing, output).toEqual([]);
  });

  test('CALL-01-AC8: the font size set before large-text is above the usual 1, its value is in the job log, and the font size is the usual again at the end', async () => {
    const { code, stdout, output, calls, invocations, fontScaleAtEnd } = await runScripted();
    const large = flowRunsOf({ calls, invocations }).find(({ flow }) => flow === 'large-text.yaml');
    const lastWrite = calls.findLastIndex(isFontWrite);

    expect(code, output).toBe(0);
    expect(large, output).toBeDefined();
    expect(Number(large?.fontScale)).toBeGreaterThan(1);
    expect(stdout).toMatch(
      new RegExp(`font[^\\n]*${(large?.fontScale ?? '').replace(/\./g, '\\.')}`, 'i'),
    );
    expect(Number(fontScaleAtEnd), output).toBe(1);
    expect(isFontReset(calls[lastWrite] ?? ''), output).toBe(true);
    expect(lastWrite, output).toBeGreaterThan(calls.findLastIndex(isFlowRun));
  });

  test.each(SCRIPTED_FAILURES)(
    '$id: when $what, the run fails, the message names the flow and the step, and the font size is still reset at the end (CALL-01, approach 9)',
    async ({ effects, refuse, flow, step, failedAt }) => {
      const { code, stderr, output, calls, fontScaleAtEnd } = await runScripted({
        effects,
        refuse,
      });
      const at = failedAt(calls);

      expect(code, output).not.toBe(0);
      expect(code, 'it was killed rather than finishing').not.toBeNull();
      expect(stderr, output).toContain(flow);
      expect(stderr, output).toMatch(step);
      // Not vacuous: the run got as far as the step that failed.
      expect(at, output).toBeGreaterThan(-1);
      expect(calls.slice(at + 1).some(isFontReset), output).toBe(true);
      expect(Number(fontScaleAtEnd), output).toBe(1);
    },
  );

  test('INF-06-AC9: a flow tagged scripted that the script’s order does not name stops the run, naming the flow, rather than never running', async () => {
    // The first run leaves every scripted flow out, so a scripted flow the
    // script does not know would otherwise run nowhere, and the run pass.
    const { code, stderr, output } = await runScripted({
      extraFlows: {
        'unordered-scripted.yaml': [
          '# A synthetic flow, tagged scripted, that no order names.',
          'appId: ${APP_ID}',
          'tags:',
          '  - scripted',
          '---',
          '- launchApp:',
          '    permissions:',
          '      all: deny',
          '',
        ].join('\n'),
      },
    });

    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(stderr, output).toContain('unordered-scripted');
  });

  // Review loop 1 (code-reviewer 1; CALL-01, approach 9): a flow named in the
  // script's order that is absent, or there but not tagged scripted, stops
  // the run before any flow runs, named, and said which of the two it is. It
  // was only printed as "not run": a flow that silently drops out of the
  // order takes its Telecom and dialer checks with it.
  test('INF-06-AC9: with the scripted flows absent from the folder, the run stops before any flow runs, and the message names each one and says it is not there', async () => {
    const { code, stderr, output, calls } = await runPastPreflight({ copyFlows: 'unscripted' });

    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(calls.filter(isFlowRun), output).toEqual([]);
    for (const flow of SCRIPTED) {
      expect(stderr, output).toContain(flow);
    }
    expect(stderr, output).toMatch(/\b(absent|missing|not in\b|is not there|not found|no such)/i);
    expect(output).not.toMatch(/flows? passed/);
  });

  test('INF-06-AC9: with a scripted flow there but not tagged scripted, the run stops before any flow runs, and the message names it and says it is not tagged', async () => {
    const tagged = readFileSync(path.join(REPO, APP, 'e2e', 'large-text.yaml'), 'utf8');
    const untagged = tagged.replace(/^tags:\n(?:[ \t]+-[^\n]*\n)+/m, '');
    // Not vacuous: the copy lost its tag, and nothing else.
    expect(maestroTags(tagged)).toContain('scripted');
    expect(maestroTags(untagged)).toEqual([]);

    const { code, stderr, output, calls } = await runScripted({
      extraFlows: { 'large-text.yaml': untagged },
    });

    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(calls.filter(isFlowRun), output).toEqual([]);
    expect(stderr, output).toContain('large-text.yaml');
    expect(stderr, output).toMatch(/\bnot tagged\b|\buntagged\b|\bwithout the scripted tag\b/i);
  });

  // CALL-02-AC3 (review loop 1): the check that the dialer is in front after
  // emergency-112 must read the window the flow left. The flow presses
  // nothing after its tap (scripts/lib/e2e-android.test.mjs); this holds the
  // script's half: it reads the window before it presses any key or runs
  // another flow.
  test('CALL-02-AC3: after emergency-112 runs, the script reads the focused window before it presses any key, so it reads the dialer the flow left in front', async () => {
    const { output, calls, invocations } = await runScripted();
    const run = flowRunsOf({ calls, invocations }).find(
      ({ flow }) => flow === 'emergency-112.yaml',
    );
    if (run === undefined) {
      throw new Error(`emergency-112.yaml never ran on its own\n${output}`);
    }
    const windowRead = run.after.findIndex(isWindowRead);

    expect(windowRead, output).toBeGreaterThan(-1);
    expect(
      run.after.slice(0, windowRead).filter((call) => /\binput\b.*\bkeyevent\b/.test(call)),
      output,
    ).toEqual([]);
  });

  // Review loop 1 (the main session's decision under D-031, after the red
  // step): the run never leaves the dialer showing 112. After a flow that
  // leaves the dialer in front, the script reads the focused window first,
  // and only once that check has passed does it press Android's back key,
  // once, as its last step for that flow, before the next flow's steps. The
  // flow itself still presses nothing (scripts/lib/e2e-android.test.mjs).
  test('CALL-02-AC3 and CALL-01-AC4: after each flow that leaves the dialer in front, the script presses Android’s back key once, after its reads of Telecom’s record and the focused window, never before, and before the next flow’s steps', async () => {
    const { output, calls, invocations } = await runScripted();
    const runs = flowRunsOf({ calls, invocations });
    const dialerFlows = Object.entries(STEPS)
      .filter(([, need]) => need.dialer === true)
      .map(([flow]) => flow)
      .sort();

    // Not vacuous: the two flows that leave the dialer in front.
    expect(dialerFlows).toEqual(['call-without-permission.yaml', 'emergency-112.yaml']);
    for (const flow of dialerFlows) {
      const run = runs.find((candidate) => candidate.flow === flow);
      if (run === undefined) {
        throw new Error(`${flow} never ran on its own\n${output}`);
      }
      const telecomRead = run.after.findIndex(isTelecomRead);
      const windowRead = run.after.findIndex(isWindowRead);
      const backs = run.after.flatMap((call, at) => (pressesBack(call) ? [at] : []));
      const nextSteps = run.after.findIndex(
        (call, at) =>
          at > windowRead && (isFontWrite(call) || /\bpm\b.*\b(grant|revoke)\b/.test(call)),
      );

      expect({ flow, backs: backs.length }, output).toEqual({ flow, backs: 1 });
      expect(windowRead, output).toBeGreaterThan(-1);
      expect(backs[0], output).toBeGreaterThan(windowRead);
      expect(backs[0], output).toBeGreaterThan(telecomRead);
      if (nextSteps !== -1) {
        expect(backs[0], output).toBeLessThan(nextSteps);
      }
    }
  });

  test('CALL-02-AC3: no back key is pressed after a flow that does not leave the dialer in front, nor after the first run', async () => {
    const { output, calls, invocations } = await runScripted();
    const runs = flowRunsOf({ calls, invocations });
    const others = runs.filter(({ flow }) => flow === null || STEPS[flow]?.dialer !== true);

    // Not vacuous: the first run and five scripted flows.
    expect(others.length, output).toBe(6);
    expect(
      others.flatMap(({ flow, after }) =>
        after.filter(pressesBack).map((call) => `${String(flow)}: ${call}`),
      ),
      output,
    ).toEqual([]);
  });

  test.each([
    ['emergency-112', 'emergency-112.yaml'],
    ['call-without-permission', 'call-without-permission.yaml'],
  ])(
    'CALL-02-AC3: when the dialer is not in front after %s, the run fails naming the flow, and no back key is pressed after it',
    async (name, flow) => {
      const { code, stderr, output, calls, invocations } = await runScripted({
        effects: { [name]: { focus: 'app' } },
      });
      const run = flowRunsOf({ calls, invocations }).find((candidate) => candidate.flow === flow);

      expect(code, output).not.toBe(0);
      expect(code, 'it was killed rather than finishing').not.toBeNull();
      expect(stderr, output).toContain(flow);
      expect(run, output).toBeDefined();
      expect(run?.after.some(isWindowRead), output).toBe(true);
      expect(run?.after.filter(pressesBack), output).toEqual([]);
    },
  );
});

// CALL-01, approach 9, after PR #101's first android-e2e (run 39956809738,
// job 120424570385; the coordinating session's choice under D-031). That
// run's job log shows call-with-permission passing with its call placed, the
// script pressing KEYCODE_ENDCALL, and call-without-permission failing at its
// first wait, 30 s for the permission line. With no call in progress,
// Android's end-call key puts the phone to sleep (END_BUTTON_BEHAVIOR_SLEEP),
// and a sleeping phone shows Maestro nothing: inferred, not seen. So:
//   - before each scripted flow, the script reads the phone's wakefulness
//     (`dumpsys power`, its mWakefulness= line); not Awake, it presses
//     KEYCODE_WAKEUP, lifts the keyguard (`wm dismiss-keyguard`), says so,
//     naming the flow and what it read, and reads again; still not Awake, or
//     no such line, stops the run;
//   - after call-with-permission, the end-call key only while Telecom shows
//     the call in progress; once it has ended, nothing, and the job log says
//     it had already ended, naming the events read, never the number;
//   - when a scripted flow fails, the phone's wakefulness and the focused
//     window's package are printed, best effort, and the failure stays the
//     flow's.
// The stand-in emulator's world models the phone (WORLD_MAESTRO,
// worldAnswers): a flow run asleep or locked fails at its first wait, and
// the end-call key with no call in progress puts the phone to sleep.

/** Calls to adb that read the phone's wakefulness, press its wake key, lift its keyguard, or press any key. */
const isPowerRead = (call) => /^adb\b.*\bdumpsys\b.*\bpower\b/.test(call);
const pressesWake = (call) =>
  /^adb\b.*\binput\b.*\bkeyevent\b.*\b(KEYCODE_WAKEUP|224)\b/.test(call);
const liftsKeyguard = (call) => /^adb\b.*\bwm\b.*\bdismiss-keyguard\b/.test(call);
const pressesKey = (call) => /^adb\b.*\binput\b.*\bkeyevent\b/.test(call);

/** The names of a call's events, as Telecom's record lists them (the test kit's event lines). */
const eventNames = (events) => events.map((event) => /^\S+ - ([A-Z_]+)/.exec(event)?.[1] ?? '');

/** The flows in the script's own order (SCRIPTED_FLOWS), by file name. */
const SCRIPT_ORDER = SCRIPTED_FLOWS.map(({ flow }) => flow);

/** A line that says something could not be read. */
const UNREAD = /\bunread\b|\bcould not be read\b|\bnot read\b/i;

/** A job-log line that says the end-call key was pressed. */
const SAYS_END_CALL = /KEYCODE_ENDCALL|\bend[- ]?call key\b/i;

/** The world in which call-with-permission's call has ended by the time the flow ends (SPIKE-01's emulator call: the network ended it 0.14 s after dialling). */
const CALL_ALREADY_ENDED = {
  'call-with-permission': { calls: [{ by: 'app', to: 'first' }], focus: 'dialer' },
};

/**
 * PRIV-07 (privacy-security-reviewer on PR #101): every six digits in a row
 * of `number`'s. Any longer run of its digits holds one of these.
 */
function sixDigitRuns(number) {
  const digits = number.replace(/\D/g, '');
  return Array.from({ length: Math.max(digits.length - 5, 0) }, (_, at) =>
    digits.slice(at, at + 6),
  );
}

/** `line` with the spaces, dashes, dots, slashes and brackets between digits taken out, so a number written in groups reads as its digits. */
const digitsJoined = (line) => line.replace(/(\d)[\s\-.()/]+(?=\d)/g, '$1');

/**
 * The Maestro command lines the script prints before each run (`  $ …/maestro
 * test …`). They hand #1's number to the flows, by design: FIRST_CONTACT_NUMBER
 * and FIRST_CONTACT_NUMBER_SHOWN (maestroTestCommand), as the flows type and
 * match it. So #1's number is held out of every other line, and not these.
 */
const isMaestroCommandLine = (line) => /^\s*\$ \S*\/maestro test\b/.test(line);

/**
 * PRIV-07: the lines of `output` that hold six digits in a row of a number the
 * dumps held in full. MOBILE, which the script is never given, in no line at
 * all; #1's in no line but the Maestro command lines.
 */
function numberLeaks(output) {
  const lines = output.split('\n');
  const holding = (number) => (line) =>
    sixDigitRuns(number).some((run) => digitsJoined(line).includes(run));
  return [
    ...lines.filter(holding(MOBILE)).map((line) => `MOBILE: ${line}`),
    ...lines
      .filter((line) => !isMaestroCommandLine(line))
      .filter(holding(EMULATOR_FIRST_CONTACT.normalised))
      .map((line) => `#1: ${line}`),
  ];
}

describe('CALL-01, approach 9 (PR #101’s first android-e2e): an awake, unlocked phone before each scripted flow, the end-call key only during a call, and evidence when a flow fails', () => {
  test('PRIV-07 (the check the tests below use): a number is caught whole, in groups, or by six of its digits; #1’s is allowed only in the Maestro command lines', () => {
    const own = EMULATOR_FIRST_CONTACT.normalised;
    const grouped = `${MOBILE.slice(0, 3)} ${MOBILE.slice(3, 5)} ${MOBILE.slice(5)}`;

    expect(numberLeaks(`e2e:android: ${MOBILE}`)).toHaveLength(1);
    expect(numberLeaks(`e2e:android: ${grouped}`)).toHaveLength(1);
    expect(numberLeaks(`e2e:android: …${MOBILE.slice(-6)}`)).toHaveLength(1);
    expect(numberLeaks(`e2e:android: ${EMULATOR_FIRST_CONTACT.typed}`)).toHaveLength(1);
    expect(numberLeaks(`e2e:android: tel:${own}`)).toHaveLength(1);
    expect(
      numberLeaks(`  $ /x/maestro/bin/maestro test -e FIRST_CONTACT_NUMBER_SHOWN=${own}`),
    ).toEqual([]);
    expect(numberLeaks(`  $ /x/maestro/bin/maestro test -e OTHER=${MOBILE}`)).toHaveLength(1);
    expect(numberLeaks(`e2e:android: tel:${maskedAddress(own).slice(4)}`)).toEqual([]);
  });

  test('CALL-01-AC2, CALL-01-AC3, CALL-01-AC4 and CALL-01-AC8: before each scripted flow, the script reads the phone’s wakefulness (dumpsys power), after every key it pressed since the flow before; with the phone awake, it presses nothing to wake it', async () => {
    const { code, output, calls, invocations } = await runScripted();
    const scripted = flowRunsOf({ calls, invocations }).filter(({ flow }) => flow !== null);
    const unread = scripted.flatMap(({ flow, before }) => {
      const lastRead = before.findLastIndex(isPowerRead);
      const lastKey = before.findLastIndex((call) => pressesKey(call) && !pressesWake(call));
      if (lastRead === -1) return [`${String(flow)}: the wakefulness not read before it`];
      if (lastKey > lastRead) {
        return [
          `${String(flow)}: a key pressed after the wakefulness was read: ${before[lastKey]}`,
        ];
      }
      return [];
    });

    // Not vacuous: every scripted flow ran on its own.
    expect(scripted.map(({ flow }) => flow).sort(), output).toEqual(SCRIPTED);
    expect(unread, output).toEqual([]);
    expect(
      calls.filter((call) => pressesWake(call) || liftsKeyguard(call)),
      output,
    ).toEqual([]);
    expect(code, output).toBe(0);
  });

  test.each(['Asleep', 'Dozing', 'Dreaming'])(
    'CALL-01-AC2, CALL-01-AC3, CALL-01-AC4 and CALL-01-AC8: when the wakefulness read before a scripted flow is %s, the script presses KEYCODE_WAKEUP, then lifts the keyguard, says so in the job log naming the flow and what it read, reads again, and runs the flow awake and unlocked',
    async (wakefulness) => {
      const { code, stdout, output, calls, invocations } = await runScripted({
        effects: { 'first-contact': { ...AS_IT_SHOULD_BE['first-contact'], wakefulness } },
      });
      const runs = flowRunsOf({ calls, invocations });
      const next = runs[runs.findIndex(({ flow }) => flow === 'first-contact.yaml') + 1];
      if (next === undefined || next.flow === null) {
        throw new Error(`no scripted flow ran after first-contact.yaml\n${output}`);
      }
      const name = next.flow.replace(/\.yaml$/, '');
      const steps = next.before.flatMap((call) => {
        if (isPowerRead(call)) return ['read'];
        if (pressesWake(call)) return ['wake'];
        if (liftsKeyguard(call)) return ['lift the keyguard'];
        return [];
      });
      const started = invocations.find((invocation) => invocation.flow === name);

      expect({ flow: next.flow, steps }, output).toEqual({
        flow: next.flow,
        steps: ['read', 'wake', 'lift the keyguard', 'read'],
      });
      expect(
        stdout.split('\n').filter((line) => line.includes(name) && line.includes(wakefulness)),
        output,
      ).not.toEqual([]);
      expect({ wakefulness: started?.wakefulness, keyguard: started?.keyguard }, output).toEqual({
        wakefulness: 'Awake',
        keyguard: 'gone',
      });
      expect(code, output).toBe(0);
    },
  );

  test('CALL-01-AC2, CALL-01-AC3, CALL-01-AC4 and CALL-01-AC8: when the phone is still not Awake after the wake key and the keyguard, the run stops before the flow runs, naming the flow and the step, and the font size is still reset', async () => {
    const { code, stderr, output, calls, invocations, fontScaleAtEnd } = await runScripted({
      effects: { 'first-contact': { ...AS_IT_SHOULD_BE['first-contact'], wakefulness: 'Asleep' } },
      refuse: 'wake',
    });
    const next = SCRIPT_ORDER[SCRIPT_ORDER.indexOf('first-contact.yaml') + 1] ?? '';
    const contact = calls.findIndex(
      (call) => isFlowRun(call) && /\bfirst-contact\.yaml\b/.test(call),
    );
    const after = calls.slice(contact + 1);
    const ran = invocations.filter(({ flow }) => flow !== null).map(({ flow }) => flow);

    // Not vacuous: first-contact ran, and a flow comes after it in the order.
    expect(contact, output).toBeGreaterThan(-1);
    expect(next, output).not.toBe('');
    // The run stopped there: no flow ran after first-contact, on a phone still asleep.
    expect(ran.at(-1), output).toBe('first-contact');
    expect(after.filter(pressesWake).length, output).toBe(1);
    expect(after.filter(isPowerRead).length, output).toBe(2);
    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(stderr, output).toContain(next);
    expect(stderr, output).toMatch(/\b(awake|wake|woke|wakefulness)\b/i);
    expect(after.slice(after.findLastIndex(isPowerRead) + 1).some(isFontReset), output).toBe(true);
    expect(Number(fontScaleAtEnd), output).toBe(1);
  });

  test('CALL-01-AC2, CALL-01-AC3, CALL-01-AC4 and CALL-01-AC8: dumpsys power output with no mWakefulness= line stops the run before the first scripted flow runs, naming it, never read as awake', async () => {
    const { code, stderr, output, calls, invocations, fontScaleAtEnd } = await runScripted({
      refuse: 'powerRead',
    });
    const first = SCRIPT_ORDER[0] ?? '';

    expect(
      invocations.filter(({ flow }) => flow !== null).map(({ flow }) => flow),
      output,
    ).toEqual([]);
    expect(calls.some(isPowerRead), output).toBe(true);
    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(first, output).toBe('first-admin-invites.yaml');
    expect(stderr, output).toContain(first);
    expect(stderr, output).toMatch(/\bmWakefulness\b|\bwakefulness\b/i);
    expect(Number(fontScaleAtEnd), output).toBe(1);
  });

  test('CALL-01-AC2: while Telecom shows call-with-permission’s call in progress, the script presses the end-call key once, after reading Telecom’s record, and says so, naming the events it read', async () => {
    const { code, stdout, output, calls, invocations } = await runScripted();
    const run = flowRunsOf({ calls, invocations }).find(
      ({ flow }) => flow === 'call-with-permission.yaml',
    );
    if (run === undefined)
      throw new Error(`call-with-permission.yaml never ran on its own\n${output}`);
    const read = run.after.findIndex(isTelecomRead);
    const ends = run.after.flatMap((call, at) => (endsTheCall(call) ? [at] : []));
    const events = eventNames(dialingEvents('a.b', 'tel:x'));

    expect(ends.length, output).toBe(1);
    expect(ends[0], output).toBeGreaterThan(read);
    expect(
      stdout
        .split('\n')
        .filter(
          (line) => SAYS_END_CALL.test(line) && events.every((event) => line.includes(event)),
        ),
      output,
    ).not.toEqual([]);
    expect(code, output).toBe(0);
  });

  test('CALL-01-AC2 and CALL-01-AC4 (run 39956809738): when call-with-permission’s call has already ended in Telecom’s record, the script presses no key after it, says the call had already ended, naming the events it read, and call-without-permission runs with the phone awake and unlocked', async () => {
    const { code, stdout, output, calls, invocations } = await runScripted({
      effects: CALL_ALREADY_ENDED,
    });
    const run = flowRunsOf({ calls, invocations }).find(
      ({ flow }) => flow === 'call-with-permission.yaml',
    );
    if (run === undefined)
      throw new Error(`call-with-permission.yaml never ran on its own\n${output}`);
    const events = eventNames(dialledEvents('a.b', 'tel:x'));
    const without = invocations.find(({ flow }) => flow === 'call-without-permission');

    expect(run.after.filter(pressesKey), output).toEqual([]);
    expect(
      stdout
        .split('\n')
        .filter(
          (line) =>
            /\balready ended\b/i.test(line) && events.every((event) => line.includes(event)),
        ),
      output,
    ).not.toEqual([]);
    expect({ wakefulness: without?.wakefulness, keyguard: without?.keyguard }, output).toEqual({
      wakefulness: 'Awake',
      keyguard: 'gone',
    });
    expect(code, output).toBe(0);
  });

  test.each([
    ['in progress', {}, SAYS_END_CALL],
    ['already ended', CALL_ALREADY_ENDED, /\balready ended\b/i],
  ])(
    'CALL-01-AC2 and PRIV-07: with Telecom’s record and the window dumps holding numbers in full, the job-log line for call-with-permission’s call (%s) names its events, and no number, nor six of its digits, appears in the job log',
    async (_case, effects, says) => {
      const { code, stdout, output, telecomAtEnd } = await runScripted({
        effects,
        unmasked: true,
      });

      // Not vacuous: Telecom's record held both numbers in full, to be read.
      expect(telecomAtEnd).toContain(`tel:${EMULATOR_FIRST_CONTACT.normalised}`);
      expect(telecomAtEnd).toContain(`tel:${MOBILE}`);
      expect(numberLeaks(output), output).toEqual([]);
      // Not vacuous: the line about the call is there.
      expect(
        stdout.split('\n').filter((line) => says.test(line) && line.includes('SET_DIALING')),
        output,
      ).not.toEqual([]);
      expect(code, output).toBe(0);
    },
  );

  test('CALL-01-AC2, CALL-01-AC3, CALL-01-AC4 and CALL-01-AC8: when a scripted flow fails, before the run stops the script reads and prints the phone’s wakefulness and the focused window’s package, and the failure stays the flow’s', async () => {
    const { code, stderr, output, calls, invocations } = await runScripted({
      effects: {
        'call-without-permission': { focus: 'launcher', wakefulness: 'Dozing', status: 'ERROR' },
      },
    });
    const run = flowRunsOf({ calls, invocations }).find(
      ({ flow }) => flow === 'call-without-permission.yaml',
    );

    expect(run, output).toBeDefined();
    expect(run?.after.some(isPowerRead), output).toBe(true);
    expect(run?.after.some(isWindowRead), output).toBe(true);
    expect(output).toContain('Dozing');
    expect(output).toContain(LAUNCHER_PACKAGE);
    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(stderr, output).toContain('call-without-permission');
    expect(stderr, output).toMatch(/\bMaestro\b/);
  });

  test('CALL-01-AC2, CALL-01-AC3, CALL-01-AC4 and CALL-01-AC8: when that evidence cannot be read, it is printed as unread, and the failure stays the flow’s', async () => {
    const { code, stderr, output, calls, fontScaleAtEnd } = await runScripted({
      effects: {
        'call-without-permission': { focus: 'dialer', status: 'ERROR', breaksDumps: true },
      },
    });
    const lines = output.split('\n');
    const failed = calls.findIndex(
      (call) => isFlowRun(call) && /\bcall-without-permission\.yaml\b/.test(call),
    );

    expect(
      lines.filter((line) => /wakeful/i.test(line) && UNREAD.test(line)),
      output,
    ).not.toEqual([]);
    expect(
      lines.filter((line) => /\b(window|package|focus|focused)\b/i.test(line) && UNREAD.test(line)),
      output,
    ).not.toEqual([]);
    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
    expect(stderr, output).toContain('call-without-permission');
    expect(stderr, output).toMatch(/\bMaestro\b/);
    expect(output, 'a stack trace, not a message').not.toMatch(/^\s+at .+:\d+:\d+\)?$/m);
    expect(failed, output).toBeGreaterThan(-1);
    expect(calls.slice(failed + 1).some(isFontReset), output).toBe(true);
    expect(Number(fontScaleAtEnd), output).toBe(1);
  });

  test('CALL-01-AC2, CALL-01-AC3, CALL-01-AC4, CALL-01-AC8 and PRIV-07: with numbers in full in Telecom’s record and the window dump, the evidence of a failed flow names the wakefulness and the package, and no number, nor six of its digits, appears in the job log', async () => {
    const { code, output, telecomAtEnd, windowAtEnd } = await runScripted({
      unmasked: true,
      effects: {
        'call-without-permission': { focus: 'numbered', wakefulness: 'Dozing', status: 'ERROR' },
      },
    });

    // Not vacuous: Telecom's record held both numbers in full, and the focused
    // window's own line held one, when the evidence was read.
    expect(telecomAtEnd).toContain(`tel:${EMULATOR_FIRST_CONTACT.normalised}`);
    expect(telecomAtEnd).toContain(`tel:${MOBILE}`);
    expect(windowAtEnd).toContain(`mCurrentFocus=${NUMBERED_WINDOW}`);
    expect(numberLeaks(output), output).toEqual([]);
    // Not vacuous: the evidence is there. The focused window has no package
    // of its own, so the package is the focused app's, the launcher's.
    expect(output).toContain('Dozing');
    expect(output).toContain(LAUNCHER_PACKAGE);
    expect(code, output).not.toBe(0);
    expect(code, 'it was killed rather than finishing').not.toBeNull();
  });
});

// BUG-70 (CI run 40469535686, job 122073049491, on 00542de, 2026-10-27):
// first-contact.yaml failed at its first step after launchApp, "Assertion is
// false: id: trygghverdag-call-button is visible", and the evidence this
// script prints said the phone was Awake with the app's package focused, and
// no crash lines. The app shows the call button as soon as its session leaves
// 'starting' (the secure-storage reads), whatever the network does; while
// 'starting' it shows the waiting indicator (grp.waiting), and with no
// credential the join screen (grp.join.*). Which screen it showed, the job log
// cannot say, and Maestro's debug output cannot be read from a session.
//
// So (the main session's design under D-031): whenever a Maestro run fails,
// the first run or a scripted flow, the script reads the screen right after
// Maestro exits, before any other step touches the phone, with `adb -s
// <serial> shell uiautomator dump /data/local/tmp/trygghverdag-window.xml`
// then `adb -s <serial> shell cat` of that file, and prints
// lib/screen-dump.mjs's readScreen lines under a heading that names the flow,
// or the first run, and says only translation keys and ids are shown. Best
// effort, as the evidence above is: an adb step that fails, or output
// readScreen refuses, is one line saying the screen is unread and why, never
// the dump's text, and the run still fails with Maestro's reason. A passing
// run never dumps the screen.

/** The app's Android application ID, which the script reads from app.config.ts and hands Maestro. */
const APP_ID = 'no.trygghverdag.placeholder';

/** The app's bokmål translations, as the script reads them. */
const NB = JSON.parse(
  readFileSync(path.join(REPO, APP, 'src/shared/translations/nb.json'), 'utf8'),
);

/** A button's ID as the app's source holds it: React Native's testID, Android's resource-id. */
function buttonIdIn(file, name) {
  const source = readFileSync(path.join(REPO, APP, 'src/features/call', file), 'utf8');
  const found = new RegExp(`\\bconst ${name} = '([^']+)';`).exec(source)?.[1];
  if (found === undefined) {
    throw new Error(`${name} is no longer a string constant in ${file}: the screens here need it`);
  }
  return found;
}

const EMERGENCY_BUTTON_ID = buttonIdIn('emergency-bar.tsx', 'EMERGENCY_BUTTON_ID');
const CALL_BUTTON_ID = buttonIdIn('call-button.tsx', 'CALL_BUTTON_ID');

/** `value` with each `{{name}}` filled with `name`, as i18next fills it. */
const filledIn = (value, name) => value.replaceAll(/\{\{\w+\}\}/g, name);

/** A number as a screen reader is given it: each character apart (the app's spelledNumber). */
const spelledOut = (number) => Array.from(number).join(' ');

/** A call to adb that dumps the screen. */
const isScreenDump = (call) => /^adb\b.*\buiautomator\b/.test(call);

/** The app's window, as uiautomator dumps it, with the 112 bar and then `content`; {APP} is the application ID. */
const appWindowWith = (...content) =>
  appWindowNode([
    buttonNode({ id: EMERGENCY_BUTTON_ID, label: NB.call.emergency.label, texts: ['112'] }),
    ...content,
  ]);

/** The lines readScreen gives for what every screen of the app starts with: Android's content frame, and the 112 bar. */
const SCREEN_START_LINES = [
  `${APP_ID}: id android:id/content; text: none; label: none`,
  `${APP_ID}: id ${EMERGENCY_BUTTON_ID}; text: none; label: call.emergency.label or call.button.call`,
  `${APP_ID}: id none; text: other text (3 characters); label: none`,
];

/** The waiting indicator, the screen while the app reads secure storage, and its lines. */
const WAITING_SCREEN = hierarchyDump('{APP}', [appWindowWith(progressNode(NB.grp.waiting))]);
const WAITING_LINES = [...SCREEN_START_LINES, `${APP_ID}: id none; text: none; label: grp.waiting`];

/** The join screen as wrong-code.yaml leaves it, with what that flow types, and its lines. */
const JOIN_SCREEN = hierarchyDump('{APP}', [
  appWindowWith(
    textNode(NB.grp.join.title),
    textNode(NB.grp.join.intro),
    textNode(NB.grp.join.codeLabel),
    editTextNode(NB.grp.join.codeLabel, 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ'),
    textNode(NB.grp.join.nameLabel),
    editTextNode(NB.grp.join.nameLabel, 'Testmedlem Emulator'),
    buttonNode({ label: NB.grp.join.submit, texts: [NB.grp.join.submit] }),
    textNode(NB.grp.join.notValid),
  ),
]);
const JOIN_LINES = [
  ...SCREEN_START_LINES,
  `${APP_ID}: id none; text: grp.join.title; label: none`,
  `${APP_ID}: id none; text: grp.join.intro; label: none`,
  `${APP_ID}: id none; text: grp.join.codeLabel; label: none`,
  `${APP_ID}: id none; text: other text (23 characters); label: grp.join.codeLabel`,
  `${APP_ID}: id none; text: grp.join.nameLabel; label: none`,
  `${APP_ID}: id none; text: other text (19 characters); label: grp.join.nameLabel`,
  `${APP_ID}: id none; text: none; label: grp.join.submit`,
  `${APP_ID}: id none; text: grp.join.submit; label: none`,
  `${APP_ID}: id none; text: grp.join.notValid; label: none`,
];

/**
 * PRIV-07: the home screen after a call to #1 could not start, #1's number in
 * a text and spelled in labels, with a missed call from another of the test
 * kit's numbers (MOBILE, which the script is never given) in System UI.
 */
const NUMBERED_SCREEN = hierarchyDump('{APP}', [
  appWindowWith(
    textNode(filledIn(NB.grp.firstContact.shown, EMULATOR_FIRST_CONTACT.name)),
    textNode(EMULATOR_FIRST_CONTACT.normalised, spelledOut(EMULATOR_FIRST_CONTACT.normalised)),
    buttonNode({
      id: CALL_BUTTON_ID,
      label: filledIn(NB.call.button.call, EMULATOR_FIRST_CONTACT.name),
      texts: [filledIn(NB.call.button.call, EMULATOR_FIRST_CONTACT.name)],
    }),
    textNode(
      filledIn(NB.call.button.failed, EMULATOR_FIRST_CONTACT.normalised),
      filledIn(NB.call.button.failed, spelledOut(EMULATOR_FIRST_CONTACT.normalised)),
    ),
  ),
  {
    package: 'com.android.systemui',
    resourceId: 'com.android.systemui:id/notification_stack_scroller',
    children: [
      { className: 'android.widget.TextView', resourceId: 'android:id/title', text: 'Tapt anrop' },
      { className: 'android.widget.TextView', resourceId: 'android:id/text', text: MOBILE },
    ],
  },
]);

/** first-contact.yaml failing in Maestro, on the screen given. */
const FIRST_CONTACT_FAILS_ON = (screen) => ({
  'first-contact': { focus: 'app', status: 'ERROR', screen },
});

/** The index in `lines` of the heading over the screen's lines: it names `who`, and says only translation keys and ids are shown. */
const screenHeading = (lines, who) =>
  lines.findIndex(
    (line) =>
      who.test(line) &&
      /\bscreen\b/i.test(line) &&
      /\bonly\b/i.test(line) &&
      /\btranslation keys?\b/i.test(line) &&
      /\bids?\b/i.test(line),
  );

/** Which of `expected` are not in `lines`, in that order, after the line at `from`. */
function missingInOrder(lines, expected, from) {
  let at = from;
  return expected.filter((wanted) => {
    const found = lines.findIndex((line, i) => i > at && line.includes(wanted));
    if (found === -1) return true;
    at = found;
    return false;
  });
}

/** The two adb steps that read the screen, as the stand-in adb logs them. */
const SCREEN_READ = [
  `adb -s emulator-5554 shell uiautomator dump ${SCREEN_DUMP_PATH}`,
  `adb -s emulator-5554 shell cat ${SCREEN_DUMP_PATH}`,
];

/**
 * The runs whose Maestro run fails, for the order of the steps after it. Kept
 * out of the test.each call, as REPORT_PROBLEMS is.
 */
const FAILED_MAESTRO_RUNS = [
  {
    what: 'a scripted flow, first-contact.yaml,',
    run: () => runScripted({ effects: FIRST_CONTACT_FAILS_ON(WAITING_SCREEN) }),
  },
  {
    what: 'the first run',
    run: () =>
      runPastPreflight({
        flows: [
          ['app-starts', 'SUCCESS'],
          ['wrong-code', 'ERROR'],
        ],
        maestroExit: 1,
        firstRunScreen: JOIN_SCREEN,
      }),
  },
];

describe('BUG-70: when a Maestro run fails, the job log names the screen it failed on, by translation keys and ids only', () => {
  test('BUG-70: the screens here are the app’s: the call button’s and 112’s IDs are read from its source, and the call button’s is the one first-contact.yaml waits for', () => {
    const flow = readFileSync(path.join(REPO, APP, 'e2e', 'first-contact.yaml'), 'utf8');

    expect(CALL_BUTTON_ID).toBe('trygghverdag-call-button');
    expect(flow).toContain(`id: ${CALL_BUTTON_ID}`);
    expect(EMERGENCY_BUTTON_ID).toMatch(/^trygghverdag-/);
    expect(EMERGENCY_BUTTON_ID).not.toBe(CALL_BUTTON_ID);
  });

  test('BUG-70: when first-contact.yaml fails in Maestro on the waiting indicator, the job log has a heading naming the flow and saying only translation keys and ids are shown, then the screen’s lines, grp.waiting among them; and the run fails with Maestro’s reason', async () => {
    const { code, stderr, output, invocations } = await runScripted({
      effects: FIRST_CONTACT_FAILS_ON(WAITING_SCREEN),
    });
    const lines = output.split('\n');
    const heading = screenHeading(lines, /\bfirst-contact\b/);

    // Not vacuous: the application ID the lines name is the one Maestro was given.
    expect(invocations[0]?.args, output).toContain(`APP_ID=${APP_ID}`);
    expect(heading, output).toBeGreaterThan(-1);
    expect(missingInOrder(lines, WAITING_LINES, heading), output).toEqual([]);
    expect(code, output).toBe(1);
    expect(stderr, output).toContain('first-contact');
    expect(stderr, output).toMatch(/\bMaestro exited with code 1\b/);
  });

  test('BUG-70: when the first run fails in Maestro on the join screen, the job log has a heading naming the first run and saying only translation keys and ids are shown, then the join screen’s lines; and the run fails with Maestro’s reason', async () => {
    const { code, stderr, output } = await runPastPreflight({
      flows: [
        ['app-starts', 'SUCCESS'],
        ['wrong-code', 'ERROR'],
      ],
      maestroExit: 1,
      firstRunScreen: JOIN_SCREEN,
    });
    const lines = output.split('\n');
    const heading = screenHeading(lines, /\bfirst run\b/i);

    expect(heading, output).toBeGreaterThan(-1);
    expect(missingInOrder(lines, JOIN_LINES, heading), output).toEqual([]);
    expect(code, output).toBe(1);
    expect(stderr, output).toMatch(/\bMaestro exited with code 1\b/);
  });

  test.each(FAILED_MAESTRO_RUNS)(
    'BUG-70: when $what fails in Maestro, the screen is read right after: the next two adb steps are uiautomator dump to /data/local/tmp/trygghverdag-window.xml and cat of it, before any wake, key, font size, dumpsys or logcat, and only once',
    async ({ run }) => {
      const { output, calls } = await run();
      const failed = calls.findLastIndex(isFlowRun);
      const next = calls.slice(failed + 1).filter((call) => call.startsWith('adb'));

      expect(failed, output).toBeGreaterThan(-1);
      expect(next.slice(0, 2), output).toEqual(SCREEN_READ);
      expect(calls.filter(isScreenDump), output).toHaveLength(1);
    },
  );

  test('BUG-70: when uiautomator cannot dump the screen, one line says the screen is unread, naming the step and its exit code, no screen line is printed, and the run still fails with Maestro’s reason, the font size reset', async () => {
    const { code, stderr, output, calls, fontScaleAtEnd } = await runScripted({
      effects: FIRST_CONTACT_FAILS_ON(WAITING_SCREEN),
      refuse: 'screenDump',
    });
    const unread = output
      .split('\n')
      .filter((line) => /\bscreen\b/i.test(line) && UNREAD.test(line));

    // Not vacuous: it tried.
    expect(calls.filter(isScreenDump), output).toHaveLength(1);
    expect(unread, output).toHaveLength(1);
    expect(unread[0], output).toMatch(/\buiautomator dump\b/);
    expect(unread[0], output).toMatch(/\bexit code 1\b/);
    expect(output).not.toContain('grp.waiting');
    expect(code, output).toBe(1);
    expect(stderr, output).toContain('first-contact');
    expect(stderr, output).toMatch(/\bMaestro exited with code 1\b/);
    expect(Number(fontScaleAtEnd), output).toBe(1);
  });

  test('BUG-70 and PRIV-07: when what uiautomator wrote is not a hierarchy, one line says the screen is unread, never repeating that text or a number in it, and the run still fails with Maestro’s reason', async () => {
    const unreadable = `Uleselig skjerm ${MOBILE}`;
    const { code, stderr, output, screenDumped } = await runScripted({
      effects: FIRST_CONTACT_FAILS_ON(unreadable),
    });
    const unread = output
      .split('\n')
      .filter((line) => /\bscreen\b/i.test(line) && UNREAD.test(line));

    // Not vacuous: that is what the device's file held.
    expect(screenDumped, output).toBe(unreadable);
    expect(unread, output).toHaveLength(1);
    expect(output).not.toContain('Uleselig');
    expect(numberLeaks(output), output).toEqual([]);
    expect(code, output).toBe(1);
    expect(stderr, output).toContain('first-contact');
    expect(stderr, output).toMatch(/\bMaestro exited with code 1\b/);
  });

  test('BUG-70: a run in which every Maestro run passes never dumps the screen', async () => {
    const { code, output, calls } = await runScripted();

    expect(code, output).toBe(0);
    expect(calls.filter(isScreenDump), output).toEqual([]);
    expect(
      calls.filter((call) => call.includes(SCREEN_DUMP_PATH)),
      output,
    ).toEqual([]);
  });

  test('BUG-70 and PRIV-07: with #1’s number in a text and spelled in labels on the screen a flow failed on, and another number in System UI, the screen’s lines are printed and no number, nor six of its digits, appears in the job log', async () => {
    const { code, output, screenDumped } = await runScripted({
      unmasked: true,
      effects: {
        'call-with-permission': { focus: 'app', status: 'ERROR', screen: NUMBERED_SCREEN },
      },
    });

    // Not vacuous: the device's file held both numbers, whole and spelled.
    expect(screenDumped).toContain(EMULATOR_FIRST_CONTACT.normalised);
    expect(screenDumped).toContain(spelledOut(EMULATOR_FIRST_CONTACT.normalised));
    expect(screenDumped).toContain(MOBILE);
    // And the screen was read and printed.
    expect(output).toContain(
      `${APP_ID}: id ${CALL_BUTTON_ID}; text: none; label: call.button.call`,
    );
    expect(output).toContain(
      `${APP_ID}: id none; text: call.button.failed; label: call.button.failed`,
    );
    expect(output).toContain('com.android.systemui: id android:id/text');
    expect(numberLeaks(output), output).toEqual([]);
    expect(code, output).toBe(1);
  });
});

// CALL-01, approach 9 (review loop 1, code-reviewer 2): e2e-android.mjs
// imports the test kit's .ts phone-number fixture, which Node runs only with
// type stripping on by default, from 22.18. So the root package.json's
// engines.node floor is 22.18.0; the ceiling stays below 23. CI reads .nvmrc,
// "22", which installs the latest 22.
describe('INF-06-AC9: the Node the script needs', () => {
  test('INF-06-AC9 (CALL-01, approach 9): the root package.json’s engines.node is ">=22.18.0 <23", since the script imports a .ts file, which Node runs by default from 22.18', () => {
    const manifest = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    const script = readFileSync(SCRIPT, 'utf8');

    // Not vacuous: the script does import a .ts file.
    expect(script).toMatch(/^import\b[^;]*\bfrom\s+'[^']+\.ts';$/m);
    expect(manifest.engines?.node).toBe('>=22.18.0 <23');
  });
});
