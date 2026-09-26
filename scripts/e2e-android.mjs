#!/usr/bin/env node
/**
 * L7 on Android (INF-06, CI-09): build the release app, install it on the
 * connected emulator, run every Maestro flow in apps/mobile/e2e, and pass only
 * when Maestro's report shows every flow ran and passed.
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
import {
  APK,
  REPORT_DIR,
  buildPlan,
  checkDevices,
  checkJava,
  checkLocale,
  checkMaestro,
  ensureMaestro,
  judgeReport,
  maestroTestCommand,
} from './lib/e2e-android.mjs';
import { run } from './lib/proc.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
const buildOnly = args.includes('--build-only');
const skipBuild = args.includes('--skip-build');

// Nothing leaves for a tooling vendor that does not have to. Set here, so
// every tool this starts inherits it.
process.env.EXPO_NO_TELEMETRY = '1';
process.env.MAESTRO_CLI_NO_ANALYTICS = '1';

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

let maestro;
if (!buildOnly) {
  maestro = await ensureMaestro({ root });
  expectOk(checkMaestro(run(maestro, ['--version'], { timeout: 120_000 })));
  const locale =
    output(adb, ['-s', device ?? '', 'shell', 'getprop', 'persist.sys.locale'])?.trim() ||
    (output(adb, ['-s', device ?? '', 'shell', 'getprop', 'ro.product.locale']) ?? '');
  expectOk(checkLocale(locale));
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
  maestro: maestro ?? 'maestro',
  report,
  appId,
  translations,
  device,
  debugOutput: path.join(REPORT_DIR, 'debug'),
});
process.stdout.write(`\ne2e:android: run the flows\n  $ ${test.join(' ')}\n`);
spawnSync(test[0] ?? '', test.slice(1), { cwd: root, stdio: 'inherit' });

// 5. The verdict comes from the report, never from Maestro's exit code alone:
// a run in which nothing ran exits 0 too.
const verdict = judgeReport(existsSync(report) ? readFileSync(report, 'utf8') : null);
if (!verdict.ok) {
  const crashes = output(adb, ['-s', device ?? '', 'logcat', '-d', '-b', 'crash']) ?? '';
  if (crashes.trim() !== '') {
    process.stderr.write(`\nCrash lines from the device (adb logcat -b crash):\n${crashes}\n`);
  }
  stop(`${verdict.message} Maestro's debug output is in ${REPORT_DIR}/debug.`);
}
process.stdout.write(`\ne2e:android: ${verdict.message}\n`);
