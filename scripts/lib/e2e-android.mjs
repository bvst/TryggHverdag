// INF-06: the decisions behind `pnpm run e2e:android`, kept pure so they can
// be tested without a device, a JDK or a network. scripts/e2e-android.mjs does
// the running; this file decides what a result means.
//
// The one thing the script must never do is pass without having proved
// anything. An L7 run in which no flow ran, or a flow was cut short, is not a
// pass (D-060): that is how a broken release would reach testers behind a green
// tick. So every check below answers { ok, message }, and the message says what
// to do when ok is false.
import path from 'node:path';
import process from 'node:process';
import { ensurePinnedBinary, fetchArchiveFrom } from './pinned-binary.mjs';
import { run } from './proc.mjs';

/**
 * Maestro, pinned. The same version as the Mac (spec, "Versions").
 *
 * **Where the hash comes from:** Maestro publishes `checksums_sha256.txt`
 * beside the archive in the same GitHub release, and on 2026-09-25 it read
 * `29b675e1…d991  maestro.zip`, which is also the digest GitHub records for the
 * asset. It proves the archive is the one Maestro's release names, and that it
 * has not changed since.
 */
export const MAESTRO_VERSION = '2.10.0';

export const MAESTRO_SHA256 = '29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991';

/** The flows, relative to the repository. */
export const FLOWS = 'apps/mobile/e2e';

/** Where Gradle leaves the release build. */
export const APK = 'apps/mobile/android/app/build/outputs/apk/release/app-release.apk';

/** What the run leaves for a person, and for CI to upload when it fails. */
export const REPORT_DIR = 'reports/e2e-android';

/** The one ABI the build contains: the emulator's, locally and in CI. */
const ABI = 'x86_64';

export function maestroUrl() {
  return `https://github.com/mobile-dev-inc/maestro/releases/download/cli-${MAESTRO_VERSION}/maestro.zip`;
}

function extractWithUnzip(archive, into) {
  const result = run('unzip', ['-q', archive, '-d', into], { timeout: 300_000 });
  if (!result.ok) {
    throw new Error(`Unpacking Maestro failed: ${result.output.trim()}`);
  }
}

/**
 * The path of the pinned Maestro, downloading and checking it the first time.
 * Maestro ships as a folder (a launcher and its jars), so the whole folder is
 * what gets checked and moved into place.
 *
 * @param {{
 *   root?: string,
 *   sha256?: string,
 *   fetchArchive?: (url: string) => Promise<Buffer>,
 *   extract?: (archive: string, into: string) => unknown,
 * }} options — everything but `root` exists so a test can stand in for the network
 */
export function ensureMaestro({
  root = process.cwd(),
  sha256 = MAESTRO_SHA256,
  fetchArchive = fetchArchiveFrom,
  extract = extractWithUnzip,
} = {}) {
  return ensurePinnedBinary({
    dir: path.join(root, 'node_modules', '.cache', 'maestro', MAESTRO_VERSION),
    binaryName: 'maestro/bin/maestro',
    what: `Maestro ${MAESTRO_VERSION}`,
    url: maestroUrl(),
    sha256,
    fetchArchive,
    extract,
  });
}

/** An emulator's adb serial is emulator-<port>; a real phone's is anything else. */
const isEmulator = (serial) => /^emulator-\d+$/.test(serial);

/**
 * Is an Android emulator connected and ready? Reads `adb devices`, or null
 * when adb could not be run at all. Emulators only: the run clears the app's
 * state, installs a build and reads the device's crash log, none of which it
 * may do to someone's real phone.
 *
 * @param {string | null} output
 * @returns {{ ok: boolean, message: string, serial?: string }}
 */
export function checkDevices(output) {
  if (output === null) {
    return {
      ok: false,
      message:
        'adb could not be run, so no Android device can be reached. Install the Android SDK ' +
        'platform-tools and set ANDROID_HOME, or put adb on the PATH.',
    };
  }
  const lines = output.split('\n');
  const start = lines.findIndex((line) => line.startsWith('List of devices attached'));
  const devices = lines
    .slice(start + 1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial !== undefined && serial !== '' && state !== undefined)
    .map(([serial, state]) => ({ serial, state }));
  const ready = devices.filter((device) => device.state === 'device');
  const emulator = ready.find((device) => isEmulator(device.serial));
  if (emulator !== undefined) {
    return {
      ok: true,
      serial: emulator.serial,
      message: `Using the Android emulator ${emulator.serial}.`,
    };
  }
  if (ready.length > 0) {
    return {
      ok: false,
      message:
        `Only real phones are ready (${ready.map((d) => d.serial).join(', ')}), and e2e:android ` +
        'runs on emulators only: it never installs onto, or reads crash logs from, a real phone. ' +
        'Start the emulator and run this again.',
    };
  }
  if (devices.length > 0) {
    return {
      ok: false,
      message:
        `No Android device is ready: ${devices.map((d) => `${d.serial} is ${d.state}`).join(', ')}. ` +
        'Wait for the emulator to finish booting, or accept the debugging prompt on the device.',
    };
  }
  return {
    ok: false,
    message:
      'No Android device is connected. Start the emulator (or connect a device) and run this again. ' +
      'In CI, android-e2e starts one.',
  };
}

/**
 * Is Java 17 to 21 usable? Reads what `java -version` printed, or null when no
 * Java could be run. Newer is refused as firmly as older: Java 25 (Android
 * Studio's own) fails the native build, after about 18 minutes (D-081).
 *
 * @param {string | null} output
 * @returns {{ ok: boolean, message: string }}
 */
export function checkJava(output) {
  const help = 'Maestro and the Android build need Java 17 to 21: set JAVA_HOME to a JDK 17.';
  if (output === null) {
    return { ok: false, message: `No Java could be run. ${help}` };
  }
  const version = /version "(\d+)(?:\.(\d+))?/.exec(output);
  if (version === null) {
    return {
      ok: false,
      message: `Could not read the Java version from: ${output.trim()}. ${help}`,
    };
  }
  // "1.8.0" is Java 8: before Java 9, the major version came second.
  const major = version[1] === '1' ? Number(version[2]) : Number(version[1]);
  if (major < 17 || major > 21) {
    return { ok: false, message: `Found Java ${String(major)}. ${help}` };
  }
  return { ok: true, message: `Using Java ${String(major)}.` };
}

/**
 * Does the pinned Maestro run? Reads the result of `maestro --version`.
 *
 * @param {{ ok: boolean, output: string }} result
 * @returns {{ ok: boolean, message: string }}
 */
export function checkMaestro(result) {
  if (!result.ok) {
    return {
      ok: false,
      message: `Maestro ${MAESTRO_VERSION} did not run. It printed:\n${result.output.trim()}`,
    };
  }
  return { ok: true, message: `Using Maestro ${result.output.trim()}.` };
}

/**
 * Is the device set to bokmål? The flow asserts the bokmål strings, so on a
 * device in any other language it would fail for a reason that says nothing
 * about the app.
 *
 * @param {string} locale what the device reports, such as "nb-NO"
 * @returns {{ ok: boolean, message: string }}
 */
export function checkLocale(locale) {
  if (/^nb([-_]|$)/i.test(locale.trim())) {
    return { ok: true, message: `The device's language is ${locale.trim()}.` };
  }
  return {
    ok: false,
    message:
      `The device's language is ${JSON.stringify(locale.trim())}, but the flows expect Norwegian ` +
      'bokmål (nb-NO). Set the emulator to nb-NO; in CI, android-e2e does.',
  };
}

/**
 * How long to wait for the device to report bokmål. An emulator started with
 * `-change-locale nb-NO` applies it only after it has booted: on the Mac, a
 * CI-identical one reported nb-NO about 20 s after sys.boot_completed, and
 * CI's runner is slower. A shorter deadline fails runs that were only slow.
 */
export const LOCALE_DEADLINE_MS = 120_000;

/** How often to ask the device for its language while waiting. */
export const LOCALE_INTERVAL_MS = 1_000;

/**
 * Waits for the device to report bokmål: reads its language at once, then
 * every `interval`, and passes on the first reading checkLocale accepts. It
 * fails once `deadline` has passed without one, and says how long it waited
 * and what the device reported last. `now` and `sleep` are its only clock.
 *
 * @param {() => string} read the device's language, as checkLocale reads it
 * @param {{
 *   deadline?: number,
 *   interval?: number,
 *   now: () => number,
 *   sleep: (ms: number) => Promise<unknown>,
 * }} options — milliseconds throughout
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function waitForLocale(
  read,
  { deadline = LOCALE_DEADLINE_MS, interval = LOCALE_INTERVAL_MS, now, sleep },
) {
  const start = now();
  for (;;) {
    const verdict = checkLocale(read());
    if (verdict.ok) return verdict;
    if (now() - start >= deadline) {
      return {
        ok: false,
        message: `Waited ${String(deadline / 1000)} s for the emulator to apply its language. ${verdict.message}`,
      };
    }
    await sleep(interval);
  }
}

/** The value of one XML attribute in an element's opening tag, or undefined. */
const attribute = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/**
 * The verdict on a run, from Maestro's JUnit report, or null when there is no
 * report. Only a report in which at least one flow ran and every flow's status
 * is SUCCESS is a pass. Maestro counts only ERROR in its `failures` attribute,
 * so a cancelled flow has no <failure> element and still did not pass.
 *
 * @param {string | null} xml
 * @returns {{ ok: boolean, message: string }}
 */
export function judgeReport(xml) {
  if (xml === null) {
    return {
      ok: false,
      message: 'Maestro wrote no report, so nothing shows that any flow ran. That is not a pass.',
    };
  }
  const flows = [...xml.matchAll(/<testcase\b[^>]*>/g)].map(([tag]) => ({
    name: attribute(tag, 'name') ?? attribute(tag, 'id') ?? '(unnamed flow)',
    status: attribute(tag, 'status') ?? '(no status)',
  }));
  if (flows.length === 0) {
    return {
      ok: false,
      message: "Maestro's report shows no flows ran. A run in which nothing ran has not passed.",
    };
  }
  const notPassed = flows.filter((flow) => flow.status !== 'SUCCESS');
  if (notPassed.length > 0) {
    return {
      ok: false,
      message:
        `${String(notPassed.length)} of ${String(flows.length)} flows failed or did not finish: ` +
        notPassed.map((flow) => `${flow.name} (${flow.status})`).join(', '),
    };
  }
  return {
    ok: true,
    message: `${String(flows.length)} of ${String(flows.length)} ${flows.length === 1 ? 'flow' : 'flows'} passed.`,
  };
}

/**
 * The release build, made on this machine: the native project generated from
 * app.config.ts, then Gradle's release variant for the emulator's ABI alone.
 * No EAS and no Expo account. The debug variant is not built: it is not what
 * ships, and it would be a second native build on every run.
 *
 * @param {{ root: string }} options
 * @returns {{ name: string, command: string[], cwd: string }[]}
 */
export function buildPlan({ root }) {
  const app = path.join(root, 'apps', 'mobile');
  return [
    {
      name: 'generate the Android project from app.config.ts',
      command: [
        'pnpm',
        'exec',
        'expo',
        'prebuild',
        '--platform',
        'android',
        '--clean',
        '--no-install',
      ],
      cwd: app,
    },
    {
      name: `build the release APK for ${ABI}`,
      command: ['./gradlew', ':app:assembleRelease', `-PreactNativeArchitectures=${ABI}`],
      cwd: path.join(app, 'android'),
    },
  ];
}

/**
 * The Maestro command line: every flow in apps/mobile/e2e, with a JUnit report
 * to judge the run by. The flows name what they need as ${APP_ID}, ${TITLE}
 * and ${STATUS}, and get exactly those, from the app config and nb.json, so no
 * flow keeps a second copy of the text a reader sees.
 *
 * Maestro reads a text selector as a regular expression, so TITLE and STATUS
 * are escaped: unescaped, "Klar." would also match "Klar!", and a flow could
 * pass on a screen the app does not show.
 *
 * @param {{
 *   maestro: string,
 *   report: string,
 *   appId: string,
 *   translations: { placeholder: { title: string, status: string } },
 *   device?: string,
 *   debugOutput?: string,
 * }} options
 * @returns {string[]}
 */
export function maestroTestCommand({ maestro, report, appId, translations, device, debugOutput }) {
  return [
    maestro,
    'test',
    ...(device === undefined ? [] : ['--udid', device]),
    '--format',
    'junit',
    '--output',
    report,
    ...(debugOutput === undefined ? [] : ['--debug-output', debugOutput, '--flatten-debug-output']),
    '-e',
    `APP_ID=${appId}`,
    '-e',
    `TITLE=${escapeRegExp(translations.placeholder.title)}`,
    '-e',
    `STATUS=${escapeRegExp(translations.placeholder.status)}`,
    FLOWS,
  ];
}

/**
 * `text` as a regular expression that matches exactly that text: every
 * character that means something in one gets a backslash. Java's, which
 * Maestro uses, and logcat's both read it that way.
 *
 * @param {string} text
 */
export function escapeRegExp(text) {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}
