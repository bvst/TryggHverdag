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
 * @param {string} locale what the device reports, such as "nb-NO", or its
 *   configuration's "nb-rNO"
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
 * How long to wait for the device to report bokmål, counted from the first
 * reading, so the switch to bokmål (switchToBokmal) is inside it.
 * persist.sys.locale takes effect when Android's framework starts, so the
 * switch restarts it: on the Mac's recording for run 6, a CI-identical
 * emulator's framework was down and back in nb-rNO about 6 s after the
 * property said nb-NO, and CI's runner is slower. That restart was the
 * emulator's own `-change-locale`; switchToBokmal's has not been timed on CI.
 * 120 s is what the wait had before BUG-17; a shorter deadline fails runs that
 * were only slow.
 */
export const LOCALE_DEADLINE_MS = 120_000;

/** How often to ask the device for its language while waiting. */
export const LOCALE_INTERVAL_MS = 1_000;

/**
 * The language on the `config:` line `adb shell am get-config` printed, as
 * Android writes it (nb-rNO), or null when there is none: while the framework
 * restarts, `am` prints cmd's "Can't find service: activity" instead.
 *
 * @param {string | null} output
 */
function configLanguage(output) {
  const config = /^config: *(\S*)/m.exec(output ?? '')?.[1] ?? '';
  return /^(?:mcc\d+-)?(?:mnc\d+-)?([a-z]{2,3}(?:-r[A-Z]{2})?)(?:[-,]|$)/.exec(config)?.[1] ?? null;
}

/**
 * Did `adb shell service check package` find the service? Exactly "found":
 * "Service package: not found" contains that word too.
 *
 * @param {string | null} output
 */
function packageServiceFound(output) {
  return /^Service package: found\r?$/m.test(output ?? '');
}

/**
 * Did `adb shell service check package` say the service is not found? It does
 * while Android's framework restarts (run 6), so a wait that saw it once saw
 * the framework restarting.
 *
 * @param {string | null} output
 */
function packageServiceNotFound(output) {
  return /^Service package: not found\r?$/m.test(output ?? '');
}

/**
 * The switch to bokmål, as the adb arguments after `-s <serial>`, in order:
 * adbd as root, which setprop of a persist. property needs; the device back
 * after adbd's restart; the language; and a restart of zygote, and with it
 * Android's framework, which reads the language only as it starts. The
 * emulator refuses to set the property at boot (`-prop`, D-081, run 8).
 */
const SWITCH_STEPS = [
  ['root'],
  ['wait-for-device'],
  ['shell', 'setprop', 'persist.sys.locale', 'nb-NO'],
  ['shell', 'setprop', 'ctl.restart', 'zygote'],
];

/**
 * Switches the emulator to bokmål (BUG-17): runs SWITCH_STEPS once each, in
 * order, and stops at the first one refused, naming it and saying what adb
 * printed. A step is refused when its status is not 0, null included (adb
 * could not be run, or did not finish), or, for `adb root`, when adbd says it
 * cannot run as root: adb exits 0 with that. Passing says only that each step
 * was accepted; whether the language took is for waitForLocale to see.
 *
 * @param {(args: string[]) => { ok: boolean, status: number | null, output: string }} adb
 *   runs `adb -s <serial>` with `args`, as proc.mjs's `run` answers: `output`
 *   is stdout and stderr together
 * @returns {{ ok: boolean, message: string }}
 */
export function switchToBokmal(adb) {
  for (const args of SWITCH_STEPS) {
    const { status, output } = adb(args);
    const step = `adb ${args.join(' ')}`;
    let refusal;
    if (status === null) refusal = 'could not be run or did not finish';
    else if (status !== 0) refusal = `exited with ${String(status)}`;
    else if (args[0] === 'root' && /cannot run as root/.test(output)) {
      refusal = 'was refused by adbd, though adb exited 0';
    }
    if (refusal !== undefined) {
      return {
        ok: false,
        message: `The switch to bokmål stopped at ${step}, which ${refusal}. ${adbPrinted(output)}`,
      };
    }
  }
  return {
    ok: true,
    message:
      "Switching the emulator to bokmål: persist.sys.locale is set to nb-NO, and Android's framework was told to restart to apply it.",
  };
}

/**
 * Waits for the device to be ready for bokmål flows: reads it at once, then
 * every `interval`, and passes on the first reading in which the configuration
 * is bokmål and the package service is found. persist.sys.locale is not enough:
 * it says nb-NO a second or two before Android restarts its framework to apply
 * it, and nothing can be installed while the framework is down (run 6).
 *
 * When the first reading is not ready, it calls `switchLocale` straight away,
 * before any sleep, and only that once: the emulator boots in its image's
 * language, and e2e:android switches it (BUG-17). The switch is inside the
 * wait, whose deadline counts from the first reading, and a refused switch
 * fails the wait at once with the switch's own message.
 *
 * It fails once `deadline` has passed without a ready reading, and says how
 * long it waited, what the device said last, persist.sys.locale included, and
 * whether its framework was seen restarting: the package service not found in
 * any reading. `now` and `sleep` are its only clock.
 *
 * @param {() => {
 *   config: string | null,
 *   packageService: string | null,
 *   property?: string | null,
 * }} read what `adb shell am get-config`, `adb shell service check package`
 *   and `adb shell getprop persist.sys.locale` printed, stdout and stderr
 *   together, or null when adb could not be run. A `property` left out is
 *   reported as null.
 * @param {{
 *   deadline?: number,
 *   interval?: number,
 *   now: () => number,
 *   sleep: (ms: number) => Promise<unknown>,
 *   switchLocale?: () => { ok: boolean, message: string },
 * }} options — milliseconds throughout
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function waitForLocale(
  read,
  { deadline = LOCALE_DEADLINE_MS, interval = LOCALE_INTERVAL_MS, now, sleep, switchLocale },
) {
  const start = now();
  let switched = false;
  let restartSeen = false;
  for (;;) {
    const { config, packageService, property = null } = read();
    const language = configLanguage(config);
    const found = packageServiceFound(packageService);
    if (language !== null && checkLocale(language).ok && found) {
      return {
        ok: true,
        message: `The device's language is ${language}, and its package service is up.`,
      };
    }
    restartSeen ||= packageServiceNotFound(packageService);
    if (switchLocale !== undefined && !switched) {
      switched = true;
      const switching = switchLocale();
      if (!switching.ok) return switching;
    }
    if (now() - start >= deadline) {
      const asked = (output, answer) =>
        output === null ? 'unknown, as adb could not be run' : answer;
      const value = property?.trim() ?? '';
      return {
        ok: false,
        message:
          `Waited ${String(deadline / 1000)} s for the emulator to be in Norwegian bokmål with ` +
          'its package service up, ready to install the app. When last asked, its package ' +
          `service was ${asked(packageService, found ? 'found' : 'not found')}, its ` +
          `configuration's language was ${asked(config, language ?? 'none')}, and ` +
          `persist.sys.locale was ${asked(property, value === '' ? 'empty' : JSON.stringify(value))}. ` +
          `Android's framework was ${restartSeen ? '' : 'not '}seen restarting during the wait. ` +
          'The flows expect nb-NO, and e2e:android switches an emulator in any other language to it.',
      };
    }
    await sleep(interval);
  }
}

/**
 * How long to keep trying the install while the package manager is not ready.
 * On the first boot in bokmål, the device refuses installs for a while after
 * it reports ready: on the Mac, an install 17 s after boot_completed failed
 * and one 80 s later worked, and CI's runner is slower (runs 6 and 8).
 */
export const INSTALL_DEADLINE_MS = 120_000;

/** How long to wait between installs: each one streams the whole APK again. */
export const INSTALL_INTERVAL_MS = 5_000;

/**
 * What `adb install -r` printed means. 'ok' only when a line is exactly
 * Success. 'not-ready' only for the three answers of a package manager that
 * has not come back after the language switch: `Can't find service: package`
 * (run 6), a NullPointerException in PackageManagerInternal (run 8) and a
 * SecurityException refusing the install's own session (run 36569778633,
 * BUG-9). Everything else is 'failed', so an install that cannot work is never
 * waited on.
 *
 * @param {string | null} output stdout and stderr together, or null when adb
 *   could not be run
 * @returns {'ok' | 'not-ready' | 'failed'}
 */
export function installVerdict(output) {
  if (output === null) return 'failed';
  if (/^Success\r?$/m.test(output)) return 'ok';
  const packageServiceGone = /Can't find service: package\r?$/m.test(output);
  const packageManagerNull = /NullPointerException\b.*\bPackageManagerInternal\./.test(output);
  const sessionRefused =
    /^java\.lang\.SecurityException: Caller has no access to session \d+\r?$/m.test(output);
  return packageServiceGone || packageManagerNull || sessionRefused ? 'not-ready' : 'failed';
}

/** What adb printed, for a message: on lines of its own, or why there is nothing. */
function adbPrinted(output) {
  if (output === null) return 'adb could not be run.';
  if (output.trim() === '') return 'adb printed nothing.';
  return `adb printed:\n${output.trim()}`;
}

/**
 * Installs at once, and while the package manager is not ready, again every
 * `interval`. It passes on the first Success. Any other failure stops it at
 * once, with what adb printed: only a device that is still starting is waited
 * for. Once `deadline` has passed without a Success it fails, and says how long
 * it waited, how many times it tried and what adb printed last. `now` and
 * `sleep` are its only clock, as in waitForLocale.
 *
 * @param {() => string | null} install runs `adb install -r` and answers what
 *   it printed, stdout and stderr together, or null when adb could not be run
 * @param {{
 *   deadline?: number,
 *   interval?: number,
 *   now: () => number,
 *   sleep: (ms: number) => Promise<unknown>,
 * }} options — milliseconds throughout
 * @returns {Promise<{ ok: boolean, message: string }>}
 */
export async function installWhenReady(
  install,
  { deadline = INSTALL_DEADLINE_MS, interval = INSTALL_INTERVAL_MS, now, sleep },
) {
  const start = now();
  for (let attempts = 1; ; attempts += 1) {
    const output = install();
    const verdict = installVerdict(output);
    if (verdict === 'ok') {
      return { ok: true, message: `The install succeeded on attempt ${String(attempts)}.` };
    }
    if (verdict === 'failed') {
      return {
        ok: false,
        message:
          'The install failed, and not with any answer of a device that is still starting, ' +
          `so it is not tried again. ${adbPrinted(output)}`,
      };
    }
    if (now() - start >= deadline) {
      return {
        ok: false,
        message:
          `Waited ${String(deadline / 1000)} s for the device's package manager to accept the ` +
          `install, and it was still not ready after ${String(attempts)} ` +
          `${attempts === 1 ? 'attempt' : 'attempts'}. When last tried, ${adbPrinted(output)}`,
      };
    }
    await sleep(interval);
  }
}

/** The value of one XML attribute in an element's opening tag, or undefined. */
const attribute = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** The entities XML names. Every other character comes as a number. */
const NAMED_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * `text` with its XML entities decoded, once: "&amp;lt;" is "&lt;", as the
 * writer meant it. A number that is no character stays as it was written.
 *
 * @param {string} text
 */
function decodeXml(text) {
  return text.replace(
    /&(?:(lt|gt|amp|quot|apos)|#(\d+)|#x([\da-fA-F]+));/g,
    (entity, name, decimal, hex) => {
      if (name !== undefined) return NAMED_ENTITIES[name];
      const code = decimal === undefined ? Number.parseInt(hex, 16) : Number(decimal);
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    },
  );
}

/**
 * What a <testcase> holds: the report after its opening tag, up to its
 * </testcase>. Nothing when the tag closes itself, as a cancelled flow's does,
 * and never past the next flow's tag, so no flow is given another's <failure>.
 *
 * @param {string} xml
 * @param {string} tag
 * @param {number} index where `tag` starts in `xml`
 */
function testcaseBody(xml, tag, index) {
  if (tag.endsWith('/>')) return '';
  return xml.slice(index + tag.length).split(/<\/testcase>|<testcase\b/, 1)[0];
}

/**
 * Why a flow failed, in the words of its <failure> elements: the text Maestro
 * writes, after the `message` attribute other JUnit writers use, decoded. An
 * empty string when there is none.
 *
 * @param {string} body
 */
function failureReason(body) {
  return [...body.matchAll(/<failure\b([^>]*?)(?:\/>|>([\s\S]*?)<\/failure>)/g)]
    .flatMap(([, attributes, text]) => [attribute(attributes, 'message'), text])
    .filter((part) => part !== undefined)
    .map((part) => decodeXml(part).trim())
    .filter((part) => part !== '')
    .join('\n');
}

/**
 * How much of each flow's reason the message shows. The start says what went
 * wrong; a stack trace under it would flood the job log, and the whole of it is
 * in the report.
 */
const REASON_LIMIT = 500;

/** `reason`, at most REASON_LIMIT characters of it, saying so when it was cut. */
function shortened(reason) {
  if (reason.length <= REASON_LIMIT) return reason;
  return (
    `${reason.slice(0, REASON_LIMIT)}\n[Cut here: the other ` +
    `${String(reason.length - REASON_LIMIT)} characters are in ${REPORT_DIR}/report.xml.]`
  );
}

/**
 * The verdict on a run, from Maestro's JUnit report, or null when there is no
 * report. Only a report in which at least one flow ran and every flow's status
 * is SUCCESS is a pass. Maestro counts only ERROR in its `failures` attribute,
 * so a cancelled flow has no <failure> element and still did not pass.
 *
 * A flow that failed with a reason has it shown under its name, indented and
 * cut to REASON_LIMIT, so the job log says why without the debug artifact.
 * Typed values stay in: in CI the only one is the job's synthetic bootstrap
 * code, which the log already prints.
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
  const flows = [...xml.matchAll(/<testcase\b[^>]*>/g)].map(({ 0: tag, index }) => ({
    name: attribute(tag, 'name') ?? attribute(tag, 'id') ?? '(unnamed flow)',
    status: attribute(tag, 'status') ?? '(no status)',
    reason: failureReason(testcaseBody(xml, tag, index)),
  }));
  if (flows.length === 0) {
    return {
      ok: false,
      message: "Maestro's report shows no flows ran. A run in which nothing ran has not passed.",
    };
  }
  const notPassed = flows.filter((flow) => flow.status !== 'SUCCESS');
  if (notPassed.length > 0) {
    const reasons = notPassed
      .filter((flow) => flow.reason !== '')
      .map(
        (flow) =>
          `\nMaestro's reason for ${flow.name}:\n${shortened(flow.reason).replace(/^/gm, '  ')}`,
      );
    return {
      ok: false,
      message:
        `${String(notPassed.length)} of ${String(flows.length)} flows failed or did not finish: ` +
        notPassed.map((flow) => `${flow.name} (${flow.status})`).join(', ') +
        reasons.join(''),
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
 * Each string of the app's a flow names, as the variable it reads, and its key
 * in nb.json: the join screen, the member screen and the admin's invitation
 * (GRP-01); and, from M3 task 2, the 112 button, #1's setup and the call
 * permission's lines (GRP-02, CALL-01, CALL-02). A flow names nothing a reader
 * sees in its own words.
 */
export const FLOW_TEXT_KEYS = {
  JOIN_TITLE: 'grp.join.title',
  JOIN_INTRO: 'grp.join.intro',
  CODE_LABEL: 'grp.join.codeLabel',
  NAME_LABEL: 'grp.join.nameLabel',
  JOIN_SUBMIT: 'grp.join.submit',
  NOT_VALID: 'grp.join.notValid',
  MEMBER_TITLE: 'grp.member.title',
  INVITE_BUTTON: 'grp.member.invite',
  MEMBERS_BUTTON: 'grp.member.members',
  CREATE_INVITATION: 'grp.invite.create',
  SHARE_BUTTON: 'grp.invite.share',
  EMERGENCY_LABEL: 'call.emergency.label',
  CHOOSE_CONTACT: 'grp.firstContact.none',
  NO_CONTACT_HINT: 'grp.firstContact.noneHint',
  CHANGE_CONTACT: 'grp.firstContact.change',
  SETUP_TITLE: 'grp.firstContact.title',
  CONTACT_NAME_LABEL: 'grp.firstContact.nameLabel',
  CONTACT_NUMBER_LABEL: 'grp.firstContact.numberLabel',
  SAVE_CONTACT: 'grp.firstContact.save',
  PERMISSION_WHY: 'call.permission.why',
  PERMISSION_MISSING: 'call.permission.missing',
  PERMISSION_ALLOW: 'call.permission.allow',
};

/**
 * The strings of the app's a flow names with #1's name in them, and the key
 * each is filled from, as the app fills it (GRP-02-AC2, CALL-01-AC2).
 */
const FIRST_CONTACT_TEMPLATES = {
  FIRST_CONTACT_SHOWN: 'grp.firstContact.shown',
  CALL_BUTTON: 'call.button.call',
};

/**
 * The number the 112 button dials: the app's own constant, EMERGENCY_NUMBER
 * in apps/mobile/src/features/call/emergency-bar.tsx, never a translation. A
 * flow matches it on the dialer and never dials it (SPIKE-01-AC10's rule).
 */
const EMERGENCY_NUMBER = '112';

/**
 * The text at a dotted key of a translation file. A key with no text there
 * throws, naming it: a flow handed an empty string would assert that nothing
 * is visible, which is no test of the screen.
 *
 * @param {Record<string, unknown>} translations
 * @param {string} key
 * @returns {string}
 */
function textOf(translations, key) {
  /** @type {unknown} */
  let node = translations;
  for (const part of key.split('.')) {
    node = typeof node === 'object' && node !== null ? node[part] : undefined;
  }
  if (typeof node !== 'string' || node === '') {
    throw new Error(`nb.json has no text for ${key}, which an e2e flow names.`);
  }
  return node;
}

/**
 * The Maestro command line, with a JUnit report to judge the run by: the first
 * run, over every flow in apps/mobile/e2e not tagged `scripted`; or, given
 * `flow`, that one flow alone (CALL-01, approach 9). The flows name what they
 * need as ${APP_ID}, ${BOOTSTRAP_CODE}, each string of FLOW_TEXT_KEYS and #1's,
 * and get exactly those, from the app config, nb.json, the API the emulator
 * reaches and the test kit's synthetic #1, so no flow keeps a second copy of
 * the text a reader sees, or a number.
 *
 * Maestro reads a text selector as a regular expression, so every string a
 * flow matches is escaped: unescaped, "Klar." would also match "Klar!", and a
 * flow could pass on a screen the app does not show. What a flow types goes
 * as it is: the bootstrap code, the API's ADMIN_BOOTSTRAP_CODE (GRP-01-AC26),
 * and #1's name and number as a person types them (GRP-02-AC2).
 *
 * @param {{
 *   maestro: string,
 *   report: string,
 *   appId: string,
 *   translations: Record<string, unknown>,
 *   bootstrapCode: string,
 *   firstContact: { name: string, typed: string, normalised: string },
 *   device?: string,
 *   debugOutput?: string,
 *   flow?: string,
 * }} options
 * @returns {string[]}
 */
export function maestroTestCommand({
  maestro,
  report,
  appId,
  translations,
  bootstrapCode,
  firstContact,
  device,
  debugOutput,
  flow,
}) {
  const filled = (key) => textOf(translations, key).replaceAll('{{name}}', firstContact.name);
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
    `BOOTSTRAP_CODE=${bootstrapCode}`,
    ...Object.entries(FLOW_TEXT_KEYS).flatMap(([name, key]) => [
      '-e',
      `${name}=${escapeRegExp(textOf(translations, key))}`,
    ]),
    '-e',
    `FIRST_CONTACT_NAME=${firstContact.name}`,
    '-e',
    `FIRST_CONTACT_NUMBER=${firstContact.typed}`,
    '-e',
    `FIRST_CONTACT_NUMBER_SHOWN=${escapeRegExp(firstContact.normalised)}`,
    ...Object.entries(FIRST_CONTACT_TEMPLATES).flatMap(([name, key]) => [
      '-e',
      `${name}=${escapeRegExp(filled(key))}`,
    ]),
    '-e',
    `EMERGENCY_NUMBER=${escapeRegExp(EMERGENCY_NUMBER)}`,
    ...(flow === undefined
      ? ['--exclude-tags', SCRIPTED_TAG, FLOWS]
      : [path.posix.join(FLOWS, flow)]),
  ];
}

/** The tag a flow carries when it runs on its own, with the script's steps around it (CALL-01, approach 9). */
export const SCRIPTED_TAG = 'scripted';

/**
 * The tags in a flow's config section, the YAML before its first `---` line,
 * as Maestro reads them: `tags:` as a block list or a flow sequence.
 *
 * @param {string} flowText
 * @returns {string[]}
 */
export function flowTags(flowText) {
  const lines = flowText.split('\n');
  const end = lines.findIndex((line) => line.trim() === '---');
  if (end === -1) return [];
  const config = lines.slice(0, end).filter((line) => !line.trimStart().startsWith('#'));
  const at = config.findIndex((line) => /^tags\s*:/.test(line));
  if (at === -1) return [];
  const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2');
  const inline = /^tags\s*:\s*\[(.*)\]\s*$/.exec(config[at] ?? '');
  if (inline !== null) return (inline[1] ?? '').split(',').map(unquote).filter(Boolean);
  const tags = [];
  for (const line of config.slice(at + 1)) {
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (item === null) break;
    tags.push(unquote(item[1] ?? ''));
  }
  return tags;
}

/**
 * The largest font size the emulator image's Settings offer: 200 %, Android
 * 14's non-linear font scaling and later (CI's image is API 37.2). Set before
 * large-text.yaml, printed in the job log, and reset at the end (CALL-01-AC8).
 */
export const LARGEST_FONT_SCALE = '2.0';

/** The phone's usual font size, set before every other scripted flow, and at the end of the run. */
export const USUAL_FONT_SCALE = '1.0';

/**
 * @typedef {{
 *   flow: string,
 *   callPhone?: 'grant' | 'revoke',
 *   fontScale: string,
 *   telecomAfter: 'callPlaced' | 'noNewCall',
 *   dialerInFront?: true,
 *   endCall?: true,
 * }} ScriptedFlow
 */

/**
 * The flows tagged `scripted`, in the order they run, each alone, with the
 * script's steps around it, as each flow's header says it needs (CALL-01,
 * approach 9). Before each: CALL_PHONE granted or revoked where the flow needs
 * it, its font size, and Telecom's record read as the baseline. After each:
 * Telecom's record again, with one call to #1 after call-with-permission and
 * no new call after any other; the dialer checked in front where the flow
 * leaves it there; and the call ended after call-with-permission.
 *
 *   - first-admin-invites signs the app in as the group's first admin, and
 *     first-contact continues from there, so nothing runs between them that
 *     clears the app's state (D-031);
 *   - the call flows need #1, which first-contact chooses;
 *   - back-from-the-dialer comes right after a flow that leaves the dialer in
 *     front;
 *   - emergency-112 clears the app's state, so it comes last.
 *
 * @type {readonly ScriptedFlow[]}
 */
export const SCRIPTED_FLOWS = [
  { flow: 'first-admin-invites.yaml', fontScale: USUAL_FONT_SCALE, telecomAfter: 'noNewCall' },
  {
    flow: 'first-contact.yaml',
    callPhone: 'revoke',
    fontScale: USUAL_FONT_SCALE,
    telecomAfter: 'noNewCall',
  },
  {
    flow: 'call-with-permission.yaml',
    callPhone: 'grant',
    fontScale: USUAL_FONT_SCALE,
    telecomAfter: 'callPlaced',
    endCall: true,
  },
  {
    flow: 'call-without-permission.yaml',
    callPhone: 'revoke',
    fontScale: USUAL_FONT_SCALE,
    telecomAfter: 'noNewCall',
    dialerInFront: true,
  },
  { flow: 'back-from-the-dialer.yaml', fontScale: USUAL_FONT_SCALE, telecomAfter: 'noNewCall' },
  { flow: 'large-text.yaml', fontScale: LARGEST_FONT_SCALE, telecomAfter: 'noNewCall' },
  {
    flow: 'emergency-112.yaml',
    fontScale: USUAL_FONT_SCALE,
    telecomAfter: 'noNewCall',
    dialerInFront: true,
  },
];

/**
 * The scripted flows to run, in SCRIPTED_FLOWS' order, from the flows in the
 * folder. The run stops before any flow runs, naming each flow and what is
 * wrong with it, when:
 *   - a flow tagged `scripted` is not in that order: the first run leaves it
 *     out, and nothing else would run it;
 *   - a flow in that order is absent from the folder, or there but not tagged
 *     `scripted` (CALL-01, approach 9, review loop 1): a flow that silently
 *     dropped out of the order would take its Telecom and dialer checks with
 *     it, and an untagged one would run in the first run, without its steps.
 *
 * @param {{ name: string, text: string }[]} flows the folder's flow files
 * @returns {{ ok: true, run: ScriptedFlow[] } | { ok: false, message: string }}
 */
export function scriptedFlowsToRun(flows) {
  const present = flows.map(({ name }) => name);
  const tagged = flows
    .filter(({ text }) => flowTags(text).includes(SCRIPTED_TAG))
    .map(({ name }) => name);
  const ordered = new Set(SCRIPTED_FLOWS.map(({ flow }) => flow));
  const unordered = tagged.filter((name) => !ordered.has(name));
  /** One sentence for each thing wrong, naming the flow. */
  const problems = [];
  if (unordered.length > 0) {
    problems.push(
      `${unordered.join(', ')} ${unordered.length === 1 ? 'is' : 'are'} tagged ${SCRIPTED_TAG}, ` +
        "but the script's order (SCRIPTED_FLOWS in scripts/lib/e2e-android.mjs) does not name " +
        `${unordered.length === 1 ? 'it' : 'them'}, so nothing would run ${unordered.length === 1 ? 'it' : 'them'}. ` +
        'Add each to the order, with the steps its header says it needs.',
    );
  }
  for (const { flow } of SCRIPTED_FLOWS) {
    if (!present.includes(flow)) {
      problems.push(
        `${flow} is in the script's order (SCRIPTED_FLOWS in scripts/lib/e2e-android.mjs) ` +
          'but not in the folder of flows, so its checks would not run.',
      );
    } else if (!tagged.includes(flow)) {
      problems.push(
        `${flow} is in the script's order and in the folder, but not tagged ${SCRIPTED_TAG}, ` +
          "so the first run would run it without the script's steps around it.",
      );
    }
  }
  if (problems.length > 0) {
    return { ok: false, message: problems.join('\n') };
  }
  return { ok: true, run: [...SCRIPTED_FLOWS] };
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
