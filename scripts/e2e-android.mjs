#!/usr/bin/env node
/**
 * L7 on Android (INF-06, CI-09): build the release app, install it on the
 * connected emulator, run every Maestro flow in apps/mobile/e2e, and pass only
 * when Maestro exits 0 and its report shows every flow ran and passed.
 * Emulators only: it never installs onto, or reads crash logs from, a real
 * phone.
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
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  APK,
  LOCALE_DEADLINE_MS,
  LOCALE_INTERVAL_MS,
  REPORT_DIR,
  buildPlan,
  checkDevices,
  checkJava,
  checkMaestro,
  ensureMaestro,
  escapeRegExp,
  judgeReport,
  maestroTestCommand,
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

const maestro = buildOnly ? undefined : await ensureMaestro({ root });
if (maestro !== undefined) {
  expectOk(checkMaestro(run(maestro, ['--version'], { timeout: 120_000 })));
  // The emulator applies its language after it has booted, by restarting
  // Android's framework, so one reading proves nothing: wait, up to the
  // deadline, for the restarted framework's configuration to be bokmål and its
  // package service to be back, which the install needs.
  const readDevice = () => ({
    config: output(adb, ['-s', device ?? '', 'shell', 'am', 'get-config']),
    packageService: output(adb, ['-s', device ?? '', 'shell', 'service', 'check', 'package']),
  });
  expectOk(
    await waitForLocale(readDevice, {
      deadline: millisecondsFrom('E2E_ANDROID_LOCALE_DEADLINE_MS', LOCALE_DEADLINE_MS),
      interval: millisecondsFrom('E2E_ANDROID_LOCALE_INTERVAL_MS', LOCALE_INTERVAL_MS),
      now: Date.now,
      sleep,
    }),
  );
}

// 2. Build.
if (!skipBuild) {
  for (const step of buildPlan({ root })) runLive(step.name, step.command, step.cwd);
  process.stdout.write(`\ne2e:android: built ${APK}\n`);
}
if (buildOnly) process.exit(0);

// 3. Install.
if (!existsSync(path.join(root, APK))) {
  stop(`there is no release build at ${APK}. Run with --build-only first, or without flags.`);
}
runLive('install the release build', [adb, '-s', device ?? '', 'install', '-r', APK], root);

// 4. Run every flow, with what the flows need read from the app itself.
const appDir = path.join(root, 'apps', 'mobile');
const { getConfig } = createRequire(path.join(appDir, 'package.json'))('expo/config');
const appId = getConfig(appDir, { skipSDKVersionRequirement: true }).exp.android?.package;
if (typeof appId !== 'string') stop('app.config.ts names no Android application ID.');
const translations = JSON.parse(
  readFileSync(path.join(appDir, 'src/shared/translations/nb.json'), 'utf8'),
);
const report = path.join(REPORT_DIR, 'report.xml');
rmSync(REPORT_DIR, { recursive: true, force: true });
mkdirSync(REPORT_DIR, { recursive: true });
const test = maestroTestCommand({
  maestro,
  report,
  appId,
  translations,
  device,
  debugOutput: path.join(REPORT_DIR, 'debug'),
});
process.stdout.write(`\ne2e:android: run the flows\n  $ ${test.join(' ')}\n`);
const maestroRun = spawnSync(test[0] ?? '', test.slice(1), { cwd: root, stdio: 'inherit' });

// 5. Both have to pass: Maestro's exit status and its report. The report alone
// is not enough, because it is written as flows finish and does not show that
// Maestro itself got to the end; the exit status alone is not enough, because
// a run in which nothing ran exits 0 too.
const verdict = judgeReport(existsSync(report) ? readFileSync(report, 'utf8') : null);
if (maestroRun.status !== 0 || !verdict.ok) {
  let exit = `Maestro exited with code ${String(maestroRun.status)}`;
  if (maestroRun.signal !== null) exit = `Maestro was stopped by ${maestroRun.signal}`;
  if (maestroRun.error !== undefined) exit = `Maestro could not run: ${maestroRun.error.message}`;
  // Only the app's own lines: the crash buffer holds every app's crashes.
  const crashes =
    output(adb, ['-s', device ?? '', 'logcat', '-d', '-b', 'crash', '-e', escapeRegExp(appId)]) ??
    '';
  if (crashes.trim() !== '') {
    process.stderr.write(
      `\nThe app's crash lines on the device (adb logcat -b crash):\n${crashes}\n`,
    );
  }
  stop(
    `${exit}, and its report says: ${verdict.message} Both have to pass. ` +
      `Maestro's debug output is in ${REPORT_DIR}/debug.`,
  );
}
process.stdout.write(`\ne2e:android: ${verdict.message}\n`);
