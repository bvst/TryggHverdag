#!/usr/bin/env node
/**
 * L7 on Android (INF-06, CI-09): build the release app, install it on the
 * connected emulator, run every Maestro flow in apps/mobile/e2e, and pass only
 * when Maestro exits 0 and its report shows every flow ran and passed.
 * Emulators only: it never installs onto, or reads crash logs from, a real
 * phone.
 *
 * The flows run in two parts (CALL-01, approach 9; D-031): first one Maestro
 * run over every flow not tagged `scripted`; then each flow tagged
 * `scripted`, alone, in the order SCRIPTED_FLOWS holds, with the script's
 * steps around it: CALL_PHONE granted or revoked, the font size set, and
 * Telecom's record read before it; Telecom's record read again after it, the
 * dialer checked in front where the flow leaves it and only then left with
 * Android's back key, and a call still in progress ended. Before each, the
 * phone is woken and its keyguard lifted when `dumpsys power` says it is not
 * awake, and when one fails in Maestro, the phone's wakefulness and the
 * focused window's package are printed. A flow the order names that is absent,
 * or there but not tagged `scripted`, stops the run before any flow runs, as
 * does a flow tagged `scripted` that the order does not name. Maestro
 * cannot see a call, so the script reads Telecom's record instead, as
 * SPIKE-01's S6 did (lib/call-records.mjs). The font size is set back to the
 * usual at the end, even after a failed step or flow, and a failure names the
 * flow and the step. No step taps anything, and back is a key, not a tap:
 * the flows never tap in the dialer, and the one call placed is to the test
 * kit's synthetic #1, in Ofcom's range reserved for drama, on an emulator
 * with no network (SPIKE-01-AC10's rule).
 *
 * Usage:
 *   pnpm run e2e:android                 the whole run: check, build, install, test
 *   pnpm run e2e:android --build-only    only the release build (no device needed)
 *   pnpm run e2e:android --skip-build    install and test the APK already built
 *
 * CI builds before it boots the emulator and tests after, because on a small
 * runner Gradle and an emulator starve each other and a slow build turns into
 * a flaky test. Every decision is in lib/e2e-android.mjs, where it is tested.
 *
 * A failed flow is never retried here: a pass on the second try hides a flaky
 * test, which is dealt with in the open (RG-06).
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { EMULATOR_FIRST_CONTACT } from '../packages/test-kit/src/fixtures/phone-numbers.ts';
import {
  callInProgress,
  callPlacedByApp,
  dialerInFront,
  focusedPackage,
  noNewCall,
  readTelecom,
  readWakefulness,
} from './lib/call-records.mjs';
import {
  APK,
  FLOWS,
  INSTALL_DEADLINE_MS,
  INSTALL_INTERVAL_MS,
  LOCALE_DEADLINE_MS,
  LOCALE_INTERVAL_MS,
  REPORT_DIR,
  USUAL_FONT_SCALE,
  buildPlan,
  checkDevices,
  checkJava,
  checkMaestro,
  ensureMaestro,
  escapeRegExp,
  installWhenReady,
  judgeReport,
  maestroTestCommand,
  scriptedFlowsToRun,
  switchToBokmal,
  waitForLocale,
} from './lib/e2e-android.mjs';
import { run } from './lib/proc.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
const buildOnly = args.includes('--build-only');
const skipBuild = args.includes('--skip-build');

// Nothing leaves for a tooling vendor that does not have to. Set here, so
// every tool this starts inherits it. Maestro reads the update check with
// Boolean.parseBoolean, so only 'true' turns it off (D-081).
process.env.EXPO_NO_TELEMETRY = '1';
process.env.MAESTRO_CLI_NO_ANALYTICS = '1';
process.env.MAESTRO_DISABLE_UPDATE_CHECK = 'true';

/** Stops the run with a message that says which precondition failed. */
function stop(message) {
  process.stderr.write(`e2e:android: ${message}\n`);
  process.exit(1);
}

/** A result's `ok` is false: say why and stop. */
function expectOk(result) {
  if (!result.ok) stop(result.message);
  process.stdout.write(`e2e:android: ${result.message}\n`);
  return result;
}

/** A tool from the SDK or the JDK the environment names, falling back to the PATH. */
function tool(home, relative, name) {
  const candidate = home === undefined ? undefined : path.join(home, relative);
  return candidate !== undefined && existsSync(candidate) ? candidate : name;
}

const adb = tool(
  process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT,
  'platform-tools/adb',
  'adb',
);
const java = tool(process.env.JAVA_HOME, 'bin/java', 'java');

/** What a command printed, or null when it could not be run. */
function output(command, commandArgs) {
  const result = run(command, commandArgs, { timeout: 60_000 });
  return result.status === null ? null : result.output;
}

/**
 * Milliseconds from the environment, or `fallback` when the variable is unset.
 * Only the tests set these, to shorten a wait; a value that is not a whole
 * number of milliseconds stops the run rather than being guessed at.
 */
function millisecondsFrom(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const ms = Number(value);
  if (!Number.isInteger(ms) || ms < 0) {
    stop(`${name} must be a whole number of milliseconds, but is ${JSON.stringify(value)}.`);
  }
  return ms;
}

/** Runs a long step with its output shown as it happens. */
function runLive(name, command, cwd) {
  process.stdout.write(`\ne2e:android: ${name}\n  $ ${command.join(' ')}\n`);
  const result = spawnSync(command[0] ?? '', command.slice(1), { cwd, stdio: 'inherit' });
  if (result.error !== undefined) stop(`${name} could not start: ${result.error.message}`);
  if (result.status !== 0) stop(`${name} failed (exit code ${String(result.status)}).`);
}

if (buildOnly && skipBuild) {
  stop('--build-only and --skip-build together would do nothing. Choose one.');
}

// 1. Preflight: everything that can be checked before a ten-minute build.
const device = buildOnly ? undefined : expectOk(checkDevices(output(adb, ['devices']))).serial;
expectOk(checkJava(output(java, ['-version'])));
const installDeadline = millisecondsFrom('E2E_ANDROID_INSTALL_DEADLINE_MS', INSTALL_DEADLINE_MS);
const installInterval = millisecondsFrom('E2E_ANDROID_INSTALL_INTERVAL_MS', INSTALL_INTERVAL_MS);

const maestro = buildOnly ? undefined : await ensureMaestro({ root });
if (maestro !== undefined) {
  expectOk(checkMaestro(run(maestro, ['--version'], { timeout: 120_000 })));
  // The emulator boots in its image's language. When the first reading is not
  // bokmål, this switches it, once (switchToBokmal, BUG-17): Android applies
  // the language by restarting its framework, so one reading after the switch
  // proves nothing. Wait, up to the deadline, for the restarted framework's
  // configuration to be bokmål and its package service to be back, which the
  // install needs. persist.sys.locale is read only for the failure message.
  const readDevice = () => ({
    config: output(adb, ['-s', device ?? '', 'shell', 'am', 'get-config']),
    packageService: output(adb, ['-s', device ?? '', 'shell', 'service', 'check', 'package']),
    property: output(adb, ['-s', device ?? '', 'shell', 'getprop', 'persist.sys.locale']),
  });
  const switchLocale = () => {
    const switched = switchToBokmal((adbArgs) =>
      run(adb, ['-s', device ?? '', ...adbArgs], { timeout: 60_000 }),
    );
    if (switched.ok) process.stdout.write(`e2e:android: ${switched.message}\n`);
    return switched;
  };
  expectOk(
    await waitForLocale(readDevice, {
      deadline: millisecondsFrom('E2E_ANDROID_LOCALE_DEADLINE_MS', LOCALE_DEADLINE_MS),
      interval: millisecondsFrom('E2E_ANDROID_LOCALE_INTERVAL_MS', LOCALE_INTERVAL_MS),
      now: Date.now,
      sleep,
      switchLocale,
    }),
  );
}

// 2. Build.
if (!skipBuild) {
  for (const step of buildPlan({ root })) runLive(step.name, step.command, step.cwd);
  process.stdout.write(`\ne2e:android: built ${APK}\n`);
}
if (buildOnly) process.exit(0);

// 3. Install. On the first boot in bokmål the package manager refuses installs
// for a while after the device reports ready (runs 6 and 8), so an install
// that fails that way is tried again, up to a deadline; any other failure
// stops the run. This waits for the device: the flows still run once.
if (!existsSync(path.join(root, APK))) {
  stop(`there is no release build at ${APK}. Run with --build-only first, or without flags.`);
}
const installArgs = ['-s', device ?? '', 'install', '-r', APK];
let installAttempt = 0;
const install = () => {
  installAttempt += 1;
  process.stdout.write(
    `\ne2e:android: install the release build, attempt ${String(installAttempt)}\n` +
      `  $ ${[adb, ...installArgs].join(' ')}\n`,
  );
  // Two minutes is far past any install seen, and keeps a hung adb inside
  // the CI step's own time limit.
  const result = run(adb, installArgs, { cwd: root, timeout: 120_000 });
  process.stdout.write(`${result.output.trimEnd()}\n`);
  return result.status === null ? null : result.output;
};
expectOk(
  await installWhenReady(install, {
    deadline: installDeadline,
    interval: installInterval,
    now: Date.now,
    sleep,
  }),
);

// 4. Run every flow, with what the flows need read from the app itself.
const appDir = path.join(root, 'apps', 'mobile');
const { getConfig } = createRequire(path.join(appDir, 'package.json'))('expo/config');
const appId = getConfig(appDir, { skipSDKVersionRequirement: true }).exp.android?.package;
if (typeof appId !== 'string') stop('app.config.ts names no Android application ID.');
const translations = JSON.parse(
  readFileSync(path.join(appDir, 'src/shared/translations/nb.json'), 'utf8'),
);
// Which flows run on their own, after the first run, and in which order
// (CALL-01, approach 9). A flow tagged `scripted` that the order does not
// name would run nowhere, and a flow the order names that is absent, or there
// but not tagged `scripted`, would take its checks with it; so the run stops
// here, before any flow runs, naming each.
const flowsDir = path.join(root, FLOWS);
const scripted = scriptedFlowsToRun(
  readdirSync(flowsDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => ({ name, text: readFileSync(path.join(flowsDir, name), 'utf8') })),
);
if (!scripted.ok) stop(scripted.message);
// The flows that need a server (GRP-01) join as the first admin with the API's
// ADMIN_BOOTSTRAP_CODE, which the caller hands in as BOOTSTRAP_CODE: CI's
// android-e2e job sets both, from one synthetic value. Unset, those flows type
// an empty code and fail, loudly; this says why first.
const bootstrapCode = process.env.BOOTSTRAP_CODE ?? '';
if (bootstrapCode === '') {
  process.stderr.write(
    'e2e:android: BOOTSTRAP_CODE is not set, so the flows that join as the first admin will ' +
      'fail: set it to the ADMIN_BOOTSTRAP_CODE of the API the emulator reaches, on a freshly ' +
      'migrated database.\n',
  );
}
rmSync(REPORT_DIR, { recursive: true, force: true });
mkdirSync(REPORT_DIR, { recursive: true });

/** The command line for the first run, or, given `flow`, for that flow alone. */
const testCommand = ({ report, debugOutput, flow }) =>
  maestroTestCommand({
    maestro,
    report,
    appId,
    translations,
    bootstrapCode,
    // The test kit's synthetic #1, from Ofcom's range reserved for drama: the
    // one number a flow may type and call on the emulator (GRP-02, HK-07).
    firstContact: EMULATOR_FIRST_CONTACT,
    device,
    debugOutput,
    flow,
  });

/** The app's own lines in the device's crash buffer, printed for a run that failed. */
function printCrashes() {
  // Only the app's own lines: the crash buffer holds every app's crashes.
  const crashes =
    output(adb, ['-s', device ?? '', 'logcat', '-d', '-b', 'crash', '-e', escapeRegExp(appId)]) ??
    '';
  if (crashes.trim() !== '') {
    process.stderr.write(
      `\nThe app's crash lines on the device (adb logcat -b crash):\n${crashes}\n`,
    );
  }
}

/**
 * Runs Maestro and judges the run. Both have to pass: Maestro's exit status
 * and its report. The report alone is not enough, because it is written as
 * flows finish and does not show that Maestro itself got to the end; the exit
 * status alone is not enough, because a run in which nothing ran exits 0 too.
 * Null when it passed, or what failed.
 */
function runFlows(title, { report, debugOutput, flow }) {
  const test = testCommand({ report, debugOutput, flow });
  process.stdout.write(`\ne2e:android: ${title}\n  $ ${test.join(' ')}\n`);
  const maestroRun = spawnSync(test[0] ?? '', test.slice(1), { cwd: root, stdio: 'inherit' });
  const verdict = judgeReport(existsSync(report) ? readFileSync(report, 'utf8') : null);
  if (maestroRun.status === 0 && verdict.ok) {
    process.stdout.write(`\ne2e:android: ${verdict.message}\n`);
    return null;
  }
  let exit = `Maestro exited with code ${String(maestroRun.status)}`;
  if (maestroRun.signal !== null) exit = `Maestro was stopped by ${maestroRun.signal}`;
  if (maestroRun.error !== undefined) exit = `Maestro could not run: ${maestroRun.error.message}`;
  printCrashes();
  return (
    `${exit}, and its report says: ${verdict.message} Both have to pass. ` +
    `Maestro's debug output is in ${debugOutput}.`
  );
}

// 5. The first run: every flow not tagged `scripted`, in one Maestro run.
const firstRun = runFlows('run the flows not tagged scripted', {
  report: path.join(REPORT_DIR, 'report.xml'),
  debugOutput: path.join(REPORT_DIR, 'debug'),
});
if (firstRun !== null) stop(firstRun);

/** A step of the run on the device: adb's output, or what failed, with the step's name. */
function step(name, adbArgs) {
  const result = run(adb, ['-s', device ?? '', ...adbArgs], { timeout: 60_000 });
  if (!result.ok) {
    throw new Error(`${name} failed (exit code ${String(result.status)}): ${result.output.trim()}`);
  }
  return result.output;
}

/** Telecom's record of calls now: `adb shell dumpsys telecom`, read. */
const telecomNow = () =>
  readTelecom(step("read Telecom's record", ['shell', 'dumpsys', 'telecom']));

/** The phone's wakefulness now: `adb shell dumpsys power`'s mWakefulness= value, read. */
const wakefulnessNow = () =>
  readWakefulness(step("read the phone's wakefulness", ['shell', 'dumpsys', 'power']));

/**
 * An awake, unlocked phone before `flow` (CALL-01, approach 9): a sleeping
 * phone shows Maestro nothing. Read after every key pressed since the flow
 * before; when it is not Awake, the wake key, then the keyguard a sleep leaves
 * lifted, and a second read. Throws, naming the step, when it cannot be read
 * or is still not Awake.
 */
function wakeBefore(flow) {
  const read = (when) => {
    try {
      return wakefulnessNow();
    } catch (error) {
      throw new Error(
        `the phone's wakefulness could not be read ${when}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  };
  const first = read('before it');
  if (first === 'Awake') return;
  process.stdout.write(
    `e2e:android: ${flow}: the phone is ${first}, not Awake (dumpsys power's mWakefulness), before it: ` +
      'waking it (KEYCODE_WAKEUP) and lifting the keyguard (wm dismiss-keyguard).\n',
  );
  step('wake the phone', ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']);
  step('lift the keyguard', ['shell', 'wm', 'dismiss-keyguard']);
  const second = read('after waking it');
  if (second !== 'Awake') {
    throw new Error(
      `wake the phone before it: still ${second}, not Awake, after the wake key and lifting the keyguard, so Maestro would see nothing.`,
    );
  }
  process.stdout.write(`e2e:android: ${flow}: the phone is Awake now.\n`);
}

/** What `read` returns, or undefined when it throws: evidence is best effort. */
function bestEffort(read) {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * What the phone was showing when `flow` failed in Maestro (CALL-01, approach
 * 9): its wakefulness and the focused window's package, printed, or unread
 * when they cannot be read. Only the value and the package name are printed,
 * never a dump's text (PRIV-07).
 */
function printEvidence(flow) {
  const wakefulness = bestEffort(wakefulnessNow);
  const focused = bestEffort(() =>
    focusedPackage(step('read the focused window', ['shell', 'dumpsys', 'window'])),
  );
  let window = focused ?? 'none: nothing has focus';
  if (focused === undefined) window = 'unread: dumpsys window could not be read';
  process.stdout.write(
    `e2e:android: ${flow} failed. The phone's wakefulness then: ` +
      `${wakefulness ?? 'unread: dumpsys power could not be read'}.\n` +
      `e2e:android: ${flow} failed. The focused window's package then: ${window}.\n`,
  );
}

/** Sets Settings' font size, saying so in the job log (CALL-01-AC8). */
function setFontScale(scale, why) {
  step(`set the font size to ${scale}`, [
    'shell',
    'settings',
    'put',
    'system',
    'font_scale',
    scale,
  ]);
  process.stdout.write(`e2e:android: font size (font_scale) set to ${scale}, ${why}.\n`);
}

/** One scripted flow, alone, with its steps around it. Throws, naming the step, when one fails. */
function runScripted({ flow, callPhone, fontScale, telecomAfter, dialerInFront: dialer, endCall }) {
  if (callPhone !== undefined) {
    step(`${callPhone} CALL_PHONE`, [
      'shell',
      'pm',
      callPhone,
      appId,
      'android.permission.CALL_PHONE',
    ]);
  }
  setFontScale(fontScale, `for ${flow}`);
  const before = telecomNow();
  wakeBefore(flow);
  const name = flow.replace(/\.ya?ml$/, '');
  const failed = runFlows(`run ${flow} on its own`, {
    report: path.join(REPORT_DIR, `${name}.xml`),
    debugOutput: path.join(REPORT_DIR, 'debug', name),
    flow,
  });
  if (failed !== null) {
    printEvidence(flow);
    throw new Error(`the flow failed in Maestro: ${failed}`);
  }
  const after = telecomNow();
  const calls =
    telecomAfter === 'callPlaced'
      ? callPlacedByApp({ before, after, app: appId, number: EMULATOR_FIRST_CONTACT.normalised })
      : noNewCall({ before, after });
  if (!calls.ok) throw new Error(`Telecom's record after it: ${calls.message}`);
  process.stdout.write(`e2e:android: ${flow}: ${calls.message}\n`);
  if (dialer === true) {
    const inFront = dialerInFront({
      window: step('read the focused window', ['shell', 'dumpsys', 'window']),
      holders: step("read the dialer role's holders", [
        'shell',
        'cmd',
        'role',
        'get-role-holders',
        'android.app.role.DIALER',
      ]),
    });
    if (!inFront.ok) throw new Error(`the dialer in front after it: ${inFront.message}`);
    process.stdout.write(`e2e:android: ${flow}: ${inFront.message}\n`);
    // Only now, once the window it left was read and was the dialer, Android's
    // back key, once, as the last step for this flow, so the run never leaves
    // the dialer showing 112. Back is not a tap: nothing in the dialer is
    // touched (CALL-02-AC3). A failed check above presses nothing.
    step('leave the dialer with the back key', ['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
  }
  if (endCall === true) {
    // The emulator's call to #1 reaches no one; it is ended before the next
    // flow, but only while Telecom shows it in progress: with no call in
    // progress, the end-call key puts the phone to sleep (CALL-01, approach 9).
    const call = callInProgress({ before, after });
    if (call.inProgress) {
      process.stdout.write(
        `e2e:android: ${flow}: ${call.message} Pressing the end-call key (KEYCODE_ENDCALL).\n`,
      );
      step('end the call', ['shell', 'input', 'keyevent', 'KEYCODE_ENDCALL']);
    } else {
      process.stdout.write(`e2e:android: ${flow}: ${call.message} No key pressed.\n`);
    }
  }
}

// 6. Each flow tagged `scripted`, alone, in its order, with its steps. The
// font size is set back to the usual at the end, whatever happened, and the
// first failure stops the run, naming the flow and the step.
let failure = null;
if (scripted.run.length > 0) {
  try {
    for (const flow of scripted.run) {
      try {
        runScripted(flow);
      } catch (error) {
        failure = `${flow.flow}: ${error instanceof Error ? error.message : String(error)}`;
        break;
      }
    }
  } finally {
    try {
      setFontScale(USUAL_FONT_SCALE, 'the usual, at the end of the run');
    } catch (error) {
      const reset = `the font size could not be set back to the usual: ${error instanceof Error ? error.message : String(error)}`;
      failure = failure === null ? reset : `${failure}\nAnd ${reset}`;
    }
  }
}
if (failure !== null) stop(failure);
process.stdout.write(
  `\ne2e:android: every flow passed: the first run, and ${String(scripted.run.length)} on their own.\n`,
);
