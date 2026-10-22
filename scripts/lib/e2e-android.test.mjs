// req-coverage: fixtures-only — the IDs below name gates and decisions, not product requirements.
//
// INF-06-AC9 and AC10: the decisions behind `pnpm run e2e:android`, tested
// without a device, a JDK or a network (the house pattern: gate-decisions.mjs,
// daily-status.mjs). scripts/e2e-android.test.mjs runs the entry script itself.
//
// The one thing this script must never do is pass without having proved
// anything: an L7 run in which no flow ran, or a flow was cut short, is not a
// pass (D-060). That is the false green F8 would later reach testers through.
//
// The JUnit fixtures follow what Maestro 2.10.0 writes. Its reporter, read from
// maestro-cli-2.10.0.jar on the Mac, emits <testsuites><testsuite tests=…
// failures=…> with one <testcase … status=…> per flow and a <failure> element
// inside a failed one. A flow's status is one of PENDING, PREPARING,
// INSTALLING, RUNNING, SUCCESS, ERROR, CANCELED, STOPPED or WARNING, so "has
// no <failure>" is not the same as "passed".
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  APK,
  INSTALL_DEADLINE_MS,
  INSTALL_INTERVAL_MS,
  LOCALE_DEADLINE_MS,
  MAESTRO_SHA256,
  MAESTRO_VERSION,
  buildPlan,
  checkDevices,
  checkJava,
  checkLocale,
  checkMaestro,
  ensureMaestro,
  installVerdict,
  installWhenReady,
  judgeReport,
  maestroTestCommand,
  maestroUrl,
  switchToBokmal,
  waitForLocale,
} from './e2e-android.mjs';

const FLOWS = 'apps/mobile/e2e';
const NB = 'apps/mobile/src/shared/translations/nb.json';
const EN = 'apps/mobile/src/shared/translations/en.json';

const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'e2e-android-test-'));
  made.push(dir);
  return dir;
}

describe('checkDevices: an Android device has to be connected', () => {
  test('INF-06-AC9: adb that cannot be run is a failure that names adb', () => {
    const result = checkDevices(null);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/adb/);
  });

  test('INF-06-AC9: no device connected is a failure that says so', () => {
    const result = checkDevices('List of devices attached\n\n');

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no Android device/i);
  });

  test.each(['offline', 'unauthorized'])(
    'INF-06-AC9: a device that is %s does not count, and the message says why',
    (state) => {
      const result = checkDevices(`List of devices attached\nemulator-5554\t${state}\n\n`);

      expect(result.ok).toBe(false);
      expect(result.message).toContain(state);
    },
  );

  test('INF-06-AC9: a device in the "device" state is used, even when adb first starts its server', () => {
    const result = checkDevices(
      '* daemon not running; starting now at tcp:5037\n' +
        '* daemon started successfully\n' +
        'List of devices attached\n' +
        'emulator-5554\tdevice\n\n',
    );

    expect(result).toMatchObject({ ok: true, serial: 'emulator-5554' });
  });

  // Amended 2026-09-26: it never installs onto, or reads crash logs from, a
  // real phone. An emulator is known by its adb serial, emulator-<port>. Both
  // serials below are made up: a USB serial, and the form wireless debugging uses.
  test.each(['R5CT21ABCDE', 'adb-R5CT21ABCDE-Xy9Zq1._adb-tls-connect._tcp'])(
    'INF-06-AC9: a real phone, %s, is refused even when ready, and the message says only emulators are used',
    (serial) => {
      const result = checkDevices(`List of devices attached\n${serial}\tdevice\n\n`);

      expect(result.ok).toBe(false);
      expect(result.serial).toBeUndefined();
      expect(result.message).toMatch(/emulator/i);
      expect(result.message).toMatch(/\b(real|physical)\b|\bphones?\b/i);
      expect(result.message).not.toMatch(/no Android device is connected/i);
    },
  );

  test('INF-06-AC9: with a real phone and an emulator both ready, the emulator is used, whatever the order', () => {
    const phoneFirst = checkDevices(
      'List of devices attached\nR5CT21ABCDE\tdevice\nemulator-5554\tdevice\n\n',
    );
    const emulatorFirst = checkDevices(
      'List of devices attached\nemulator-5556\tdevice\nR5CT21ABCDE\tdevice\n\n',
    );

    expect(phoneFirst).toMatchObject({ ok: true, serial: 'emulator-5554' });
    expect(emulatorFirst).toMatchObject({ ok: true, serial: 'emulator-5556' });
  });
});

/**
 * What a `java -version` can print with no version in it. Kept out of the
 * test.each call: the test counter reads a table only up to its first `)`.
 */
const UNREADABLE_JAVA = [
  {
    // What macOS's /usr/bin/java stub prints when no JDK is installed.
    what: "macOS's stub with no JDK behind it",
    output:
      'The operation couldn’t be completed. Unable to locate a Java Runtime.\n' +
      'Please visit http://www.java.com for information on installing Java.\n',
    printed: 'Unable to locate a Java Runtime',
  },
  {
    // `java --version` rather than `-version`: no quoted version after "version".
    what: 'the --version format',
    output: 'openjdk 17.0.12 2024-07-16\nOpenJDK Runtime Environment Temurin-17.0.12+7\n',
    printed: 'openjdk 17.0.12 2024-07-16',
  },
];

describe('checkJava: Java 17 to 21 has to be usable', () => {
  test('INF-06-AC9: no Java at all is a failure that names Java 17', () => {
    const result = checkJava(null);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Java 17/);
  });

  test.each([
    ['openjdk version "11.0.22" 2024-01-16\nOpenJDK Runtime Environment Temurin-11.0.22+7\n'],
    ['java version "1.8.0_401"\nJava SE Runtime Environment build 1.8.0_401-b10\n'],
    ['openjdk version "16.0.2" 2021-07-20\n'],
  ])('INF-06-AC9: an older Java is a failure that names Java 17: %j', (output) => {
    const result = checkJava(output);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Java 17/);
  });

  // Amended 2026-09-26. Java 25 passed a "17 or newer" check, and the native
  // build then failed after about 18 minutes. Too new is refused up front, the
  // same way too old is, and the message says what to do about it.
  test.each([
    ['openjdk version "22.0.2" 2024-07-16\n'],
    ['openjdk version "23.0.1" 2024-10-15\n'],
    ['openjdk version "25.0.3" 2026-04-21\nOpenJDK Runtime Environment build 25.0.3\n'],
  ])('INF-06-AC9: a Java newer than 21 is a failure, not a pass: %j', (output) => {
    expect(checkJava(output).ok).toBe(false);
  });

  test.each([
    { what: 'no Java at all', output: null },
    { what: 'Java 16', output: 'openjdk version "16.0.2" 2021-07-20\n' },
    { what: 'Java 22', output: 'openjdk version "22.0.2" 2024-07-16\n' },
    { what: 'Java 25', output: 'openjdk version "25.0.3" 2026-04-21\n' },
  ])('INF-06-AC9: with $what, the message says to set JAVA_HOME to a JDK 17', ({ output }) => {
    const result = checkJava(output);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/\bJAVA_HOME\b/);
    expect(result.message).toMatch(/\bJDK 17\b/);
  });

  test.each([
    ['openjdk version "17.0.12" 2024-07-16\n'],
    ['openjdk version "21.0.4" 2024-07-16 LTS\n'],
  ])('INF-06-AC9: Java 17 to 21 is usable: %j', (output) => {
    expect(checkJava(output).ok).toBe(true);
  });

  test.each(UNREADABLE_JAVA)(
    'INF-06-AC9: a Java whose version cannot be read is a failure that says so and what it printed: $what',
    ({ output, printed }) => {
      const result = checkJava(output);

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/Could not read the Java version/);
      expect(result.message).toContain(printed);
      expect(result.message).toMatch(/\bJAVA_HOME\b/);
      expect(result.message).toMatch(/\bJDK 17\b/);
    },
  );
});

describe('checkMaestro: the pinned Maestro has to run', () => {
  test('INF-06-AC9: a Maestro that does not run is a failure that names Maestro and says what it printed', () => {
    const result = checkMaestro({ ok: false, output: 'Error: Could not find or load main class' });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Maestro/);
    expect(result.message).toContain('Could not find or load main class');
  });

  test('INF-06-AC9: a Maestro that answers is usable', () => {
    expect(checkMaestro({ ok: true, output: `${MAESTRO_VERSION}\n` }).ok).toBe(true);
  });
});

describe('checkLocale: the flow expects a bokmål device', () => {
  test('INF-06-AC9: a device set to nb-NO is ready', () => {
    expect(checkLocale('nb-NO').ok).toBe(true);
  });

  test.each(['en-US', 'sv-SE', ''])(
    'INF-06-AC9: a device set to %j is a failure that names bokmål',
    (locale) => {
      const result = checkLocale(locale);

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/bokmål|nb-NO/);
    },
  );
});

// Added 2026-09-27. Run 5 of android-e2e (run 36306264081) started the
// emulator with `-change-locale nb-NO`, it booted, and e2e:android stopped on
// its first reading: `e2e:android: The device's language is "en-US", but the
// flows expect Norwegian bokmål (nb-NO). Set the emulator to nb-NO; in CI,
// android-e2e does.` A fresh device identical to CI's, on the Mac, showed why:
// straight after sys.boot_completed=1, persist.sys.locale was empty,
// ro.product.locale en-US and `am get-config` en-rUS; about 20 s later,
// persist.sys.locale was nb-NO and `am get-config` nb-rNO. The emulator applies
// the language after boot has completed, so one reading proves nothing. The
// script waits for bokmål, up to a deadline, and only then fails.

/**
 * Time a test states rather than waits for. `now` reads it; `sleep` moves it
 * on by exactly what it is asked, at once, and refuses to go backwards, as
 * packages/test-kit's fakeClock does. That clock is the server's Clock port, an
 * async Date, and scripts/ does not depend on test-kit, so this is its
 * millisecond counterpart for a script.
 */
function fakeTime() {
  let at = 0;
  return {
    now: () => at,
    sleep: (ms) => {
      if (!(ms >= 0)) throw new Error(`sleep(${String(ms)}): time does not go backwards`);
      at += ms;
      return Promise.resolve();
    },
  };
}

/**
 * More readings than any wait here needs. A wait that goes past this is not
 * following the `now` and `sleep` it was given, and would otherwise spin for
 * the real deadline.
 */
const MAX_READS = 200_000;

// Amended 2026-09-27, run 6 of android-e2e (run 36309631129, job
// 108592943641). The emulator booted, e2e:android printed `e2e:android: The
// device's language is nb-NO.`, and 0.16 s later `adb … install -r
// …/app-release.apk` failed with `adb: failed to install …: cmd: Can't find
// service: package`. On the Mac, a fresh CI-identical device, recorded twice,
// one row per change:
//
//   t+73s  boot=1 locale=       config=en-rUS package=found     system_server=739
//   t+103s boot=1 locale=nb-NO  config=       package=found     system_server=
//   t+104s boot=1 locale=nb-NO  config=       package=not found system_server=
//   t+106s boot=1 locale=nb-NO  config=       package=not found system_server=4228
//   t+107s boot=1 locale=nb-NO  config=       package=found     system_server=4228
//   t+109s boot=1 locale=nb-NO  config=nb-rNO package=found     system_server=4228
//
// `locale` is getprop persist.sys.locale, `config` the locale on the `config:`
// line of `adb shell am get-config`, `package` what `adb shell service check
// package` says. The property flips to nb-NO a second or two before Android
// restarts its framework to apply it, and sys.boot_completed stays 1
// throughout. So the property alone proves nothing: the wait reads both
// commands, and ends only when the configuration is bokmål and the package
// service is found.
//
// `read` now answers what the two commands printed, as the entry script's
// `output` returns it: stdout and stderr together, or null when adb could not
// be run at all. { config, packageService }.

/** What `adb shell service check package` prints, with the service up and gone. */
const FOUND = 'Service package: found\n';
const NOT_FOUND = 'Service package: not found\n';

/**
 * What `adb shell am get-config` prints while the activity service is down:
 * `am` is `cmd activity`, and this is cmd's wording, as in run 6's install
 * failure. The Mac's recording shows only that no configuration came back.
 */
const ACTIVITY_DOWN = "cmd: Can't find service: activity\n";

/**
 * What `adb shell am get-config` prints on a device whose configuration's
 * locale is `qualifier`, written the way Android writes it, such as nb-rNO.
 * Only the locale was recorded on the device; the rest is illustrative.
 */
function configOutput(qualifier, { network = true } = {}) {
  return [
    `config: ${network ? 'mcc310-mnc260-' : ''}${qualifier}-ldltr-sw411dp-w411dp-h914dp-normal-long-notround-lowdr-nowidecg-port-notnight-420dpi-finger-keysexposed-nokeys-navhidden-v37`,
    'abi: x86_64',
    '',
  ].join('\n');
}

/**
 * The reading of a device whose configuration's language is `reply`, with the
 * package service up. An empty reply is a configuration that says nothing, as
 * the Mac's did while its framework restarted.
 */
const asReading = (reply) => ({
  config:
    reply === '' ? '' : configOutput(reply.replace(/^([a-z]{2,3})[-_]r?([A-Z]{2})$/, '$1-r$2')),
  packageService: FOUND,
});

/**
 * A language as a message may write it: as the property does, nb-NO, or as
 * the configuration does, nb-rNO.
 */
function spelled(locale) {
  const [language = '', region = ''] = locale.split(/[-_]r?/);
  return new RegExp(`\\b${language}[-_]r?${region}\\b`);
}

/**
 * A device whose configuration's language is `answer(now, readingsSoFar)`, with
 * the package service up throughout; notes when each reading was taken.
 */
function device(time, answer) {
  const reads = [];
  return {
    reads,
    read: () => {
      if (reads.length >= MAX_READS) {
        throw new Error(
          `read ${String(MAX_READS)} times: the wait is not following the now and sleep it was given`,
        );
      }
      const reply = answer(time.now(), reads.length);
      reads.push({ at: time.now(), reply });
      return asReading(reply);
    },
  };
}

/**
 * A device whose reading, { config, packageService }, is `answer(now,
 * readingsSoFar)`; notes when each reading was taken, and what it was.
 */
function rawDevice(time, answer) {
  const reads = [];
  return {
    reads,
    read: () => {
      if (reads.length >= MAX_READS) {
        throw new Error(
          `read ${String(MAX_READS)} times: the wait is not following the now and sleep it was given`,
        );
      }
      const reading = answer(time.now(), reads.length);
      reads.push({ at: time.now(), ...reading });
      return reading;
    },
  };
}

/**
 * The Mac's second recording, as readings: milliseconds from its first row,
 * t+73 s, when the device had booted in its image's language.
 */
function macRecording(at) {
  if (at < 30_000) return { config: configOutput('en-rUS'), packageService: FOUND };
  // t+103 s: persist.sys.locale is nb-NO, and the framework is going down.
  if (at < 31_000) return { config: '', packageService: FOUND };
  // t+104 s to t+106 s: no framework, and no package service to install with.
  if (at < 34_000) return { config: '', packageService: NOT_FOUND };
  // t+107 s: the package service is back, the configuration is not yet.
  if (at < 36_000) return { config: '', packageService: FOUND };
  // t+109 s: the restarted framework reports bokmål.
  return { config: configOutput('nb-rNO'), packageService: FOUND };
}

/**
 * A message that says the package service was not there. Near the word
 * "package", so a message that says something else is missing does not count.
 */
const PACKAGE_MISSING =
  /\bpackage\b[^.\n]{0,40}?\b(?:not found|missing|unavailable|absent|gone|down|not there|not running|not available|not up)\b|\b(?:no|missing|can't find|cannot find|could not find)\b[^.\n]{0,20}?\bpackage\b/i;

/** Everything `am get-config` printed in the tests below, by name. */
const CONFIGS = {
  bokmål: configOutput('nb-rNO'),
  english: configOutput('en-rUS'),
  nothing: '',
  'the activity service missing': ACTIVITY_DOWN,
  'no adb': null,
};

/** Everything `service check package` printed in the tests below, by name. */
const PACKAGE_ANSWERS = {
  found: FOUND,
  'not found': NOT_FOUND,
  nothing: '',
  'no adb': null,
};

/** Readings that end the wait at once. */
const READY = [
  {
    what: "an emulator's configuration",
    config: configOutput('nb-rNO'),
  },
  {
    what: 'a configuration without mcc and mnc',
    config: configOutput('nb-rNO', { network: false }),
  },
];

/**
 * The last reading before the deadline, after one that differs in both, and
 * what the failure must then say about each.
 */
const LAST_SEEN = [
  {
    what: 'sv-rSE, the package service found',
    readings: [
      { config: configOutput('en-rUS'), packageService: NOT_FOUND },
      { config: configOutput('sv-rSE'), packageService: FOUND },
    ],
    language: /\bsv[-_]r?SE\b/,
    packageMissing: false,
  },
  {
    what: 'nb-rNO, the package service not found',
    readings: [
      { config: configOutput('en-rUS'), packageService: FOUND },
      { config: configOutput('nb-rNO'), packageService: NOT_FOUND },
    ],
    language: /\bnb[-_]r?NO\b/,
    packageMissing: true,
  },
];

/** Answers `replies` in turn, and the last one from then on. */
const inTurn = (replies) => (_at, n) => replies[Math.min(n, replies.length - 1)];

/** Answers en-US until `from`, and nb-NO from then on: an emulator applying its language. */
const bokmalFrom = (from) => (at) => (at >= from ? 'nb-NO' : 'en-US');

const isBokmal = (reply) => /^nb([-_]|$)/i.test(reply.trim());

/** A message that states `ms` as a duration, in seconds, minutes or milliseconds. */
function saysHowLong(ms) {
  const forms = [
    `${String(ms / 1000).replace('.', '\\.')}(?:\\.0+)? ?s(?:ec(?:ond)?s?)?`,
    `${String(ms).replace(/\B(?=(\d{3})+$)/g, '[ ,.\\u00a0]?')} ?ms`,
  ];
  if (ms % 60_000 === 0) forms.push(`${String(ms / 60_000)} ?min(?:ute)?s?`);
  return new RegExp(`(?<![\\d.])(?:${forms.join('|')})\\b`);
}

/** Replies that are not bokmål, however long they are read. */
const NOT_BOKMAL = ['', 'en-US', 'en-rUS', 'sv-SE', 'da-DK', 'nbx'];

/** A deadline of zero still reads the device once. */
const AT_ONCE = [
  { reply: 'nb-NO', ok: true },
  { reply: 'en-US', ok: false },
];

describe('waitForLocale: the emulator applies its language after it has booted', () => {
  test('INF-06-AC9: reads at once and then every interval until the device reports bokmål, then stops reading and passes', async () => {
    const time = fakeTime();
    const phone = device(time, inTurn(['', '', 'en-US', 'nb-NO']));

    const result = await waitForLocale(phone.read, {
      deadline: 30_000,
      interval: 1_000,
      now: time.now,
      sleep: time.sleep,
    });

    expect(result.ok, result.message).toBe(true);
    expect(result.message).toMatch(spelled('nb-NO'));
    expect(phone.reads.map((r) => r.reply)).toEqual(['', '', 'en-US', 'nb-NO']);
    expect(phone.reads.map((r) => r.at)).toEqual([0, 1_000, 2_000, 3_000]);
  });

  test('INF-06-AC9: a device that never reports bokmål fails at the deadline, and the message says it waited, how long, bokmål and the last language it saw', async () => {
    const time = fakeTime();
    const phone = device(time, inTurn(['', 'en-US', 'sv-SE']));

    const result = await waitForLocale(phone.read, {
      deadline: 30_000,
      interval: 1_000,
      now: time.now,
      sleep: time.sleep,
    });

    expect(result.ok).toBe(false);
    // It waited out the deadline, reading as it went, and not an interval past it.
    expect(phone.reads.length).toBeGreaterThan(3);
    expect(phone.reads.at(-1)?.at).toBeGreaterThanOrEqual(30_000 - 1_000);
    expect(time.now()).toBeLessThanOrEqual(30_000 + 1_000);
    expect(result.message).toMatch(/bokmål/);
    expect(result.message).toMatch(/\bwait/i);
    expect(result.message).toMatch(saysHowLong(30_000));
    expect(result.message).toMatch(spelled('sv-SE'));
  });

  test.each(NOT_BOKMAL)(
    'INF-06-AC9: a device that only ever says %j is never reported as bokmål',
    async (reply) => {
      const time = fakeTime();
      const phone = device(time, () => reply);

      const result = await waitForLocale(phone.read, {
        deadline: 5_000,
        interval: 1_000,
        now: time.now,
        sleep: time.sleep,
      });

      expect(result.ok).toBe(false);
      expect(phone.reads.length).toBeGreaterThan(1);
    },
  );

  test.each(AT_ONCE)(
    'INF-06-AC9: with a deadline of zero it still reads the device once, and a reading of $reply decides it',
    async ({ reply, ok }) => {
      const time = fakeTime();
      const phone = device(time, () => reply);

      const result = await waitForLocale(phone.read, {
        deadline: 0,
        interval: 1_000,
        now: time.now,
        sleep: time.sleep,
      });

      expect(phone.reads.length).toBeGreaterThanOrEqual(1);
      expect(result.ok).toBe(ok);
      expect(result.message).toMatch(spelled(reply));
    },
  );

  test('INF-06-AC9: for any deadline and interval, it reads at least once, passes only on a bokmål reading and stops there, never polls faster than the interval, and otherwise waits out the deadline', async () => {
    // A sweep in place of fast-check, which the repository root does not have.
    for (const deadline of [0, 1_000, 2_500, 30_000]) {
      for (const interval of [1, 300, 1_000, 7_000]) {
        const surelySeen = Math.max(0, deadline - interval);
        for (const from of [0, 1_000, surelySeen, deadline + 1, Infinity]) {
          const time = fakeTime();
          const phone = device(time, bokmalFrom(from));

          const result = await waitForLocale(phone.read, {
            deadline,
            interval,
            now: time.now,
            sleep: time.sleep,
          });
          const at = phone.reads.map((r) => r.at);
          const bokmal = phone.reads.filter((r) => isBokmal(r.reply)).length;
          const where = `deadline ${String(deadline)}, interval ${String(interval)}, bokmål from ${String(from)}; read at ${at.slice(0, 6).join(', ')}${at.length > 6 ? ' …' : ''}`;

          expect(at.length, where).toBeGreaterThanOrEqual(1);
          expect(at.length, where).toBeLessThanOrEqual(Math.floor(deadline / interval) + 2);
          at.slice(1).forEach((t, i) => expect(t, where).toBeGreaterThan(at[i] ?? Infinity));
          expect(at.at(-1), where).toBeLessThanOrEqual(deadline + interval);
          // Passing means the last reading, and only that one, was bokmål.
          expect(bokmal, where).toBe(result.ok ? 1 : 0);
          expect(isBokmal(phone.reads.at(-1)?.reply ?? ''), where).toBe(result.ok);
          if (!result.ok) expect(at.at(-1), where).toBeGreaterThanOrEqual(deadline - interval);
          if (from <= surelySeen) expect(result.ok, where).toBe(true);
          if (from === Infinity) expect(result.ok, where).toBe(false);
        }
      }
    }
  });

  test('INF-06-AC9: the production deadline is at least 60 s, and is the one the wait uses when it is given none', async () => {
    // The language arrived about 20 s after boot on the Mac, and CI's runner is
    // slower. A shorter deadline fails runs that were only slow, so nobody
    // shortens it without this test saying so.
    expect(LOCALE_DEADLINE_MS).toBeGreaterThanOrEqual(60_000);

    const time = fakeTime();
    const phone = device(time, () => 'en-US');
    const result = await waitForLocale(phone.read, { now: time.now, sleep: time.sleep });

    expect(result.ok).toBe(false);
    expect(phone.reads.at(-1)?.at).toBeGreaterThanOrEqual(60_000);
    expect(result.message).toMatch(saysHowLong(LOCALE_DEADLINE_MS));
  });

  test("INF-06-AC9: with the production settings, a device that applies bokmål 20 s after boot, as the Mac's did, passes", async () => {
    const time = fakeTime();
    const phone = device(time, bokmalFrom(20_000));

    const result = await waitForLocale(phone.read, { now: time.now, sleep: time.sleep });

    expect(result.ok, result.message).toBe(true);
    expect(phone.reads.at(-1)?.at).toBeGreaterThanOrEqual(20_000);
  });
});

describe('waitForLocale: bokmål counts only once the restarted framework reports it and can install', () => {
  test("INF-06-AC9: on the Mac's recording, it keeps reading through the framework's restart and passes at the first reading with bokmål in the configuration and the package service found", async () => {
    const time = fakeTime();
    const phone = rawDevice(time, macRecording);

    const result = await waitForLocale(phone.read, {
      deadline: 120_000,
      interval: 1_000,
      now: time.now,
      sleep: time.sleep,
    });

    expect(result.ok, result.message).toBe(true);
    // Not vacuous: it was reading while the package service was gone.
    expect(phone.reads.some((r) => r.at >= 31_000 && r.at < 34_000)).toBe(true);
    // It passed on t+109 s, the first reading with both, and not before.
    expect(phone.reads.at(-1)?.at).toBeGreaterThanOrEqual(36_000);
    expect(phone.reads.at(-1)?.at).toBeLessThan(37_000);
    expect(result.message).toMatch(spelled('nb-NO'));
  });

  test("INF-06-AC9: with the production settings, the Mac's recording passes", async () => {
    const time = fakeTime();
    const phone = rawDevice(time, macRecording);

    const result = await waitForLocale(phone.read, { now: time.now, sleep: time.sleep });

    expect(result.ok, result.message).toBe(true);
    expect(phone.reads.at(-1)?.at).toBeGreaterThanOrEqual(36_000);
  });

  test('INF-06-AC9: of every combination of what the two commands print, only bokmål in the configuration together with the package service found ends the wait', async () => {
    for (const [configIs, config] of Object.entries(CONFIGS)) {
      for (const [packageIs, packageService] of Object.entries(PACKAGE_ANSWERS)) {
        const time = fakeTime();
        const phone = rawDevice(
          time,
          inTurn([
            { config: CONFIGS.english, packageService: FOUND },
            { config, packageService },
          ]),
        );

        const result = await waitForLocale(phone.read, {
          deadline: 5_000,
          interval: 1_000,
          now: time.now,
          sleep: time.sleep,
        });
        const ready = configIs === 'bokmål' && packageIs === 'found';
        const where = `configuration: ${configIs}; package service: ${packageIs}; ${result.message}`;

        expect(result.ok, where).toBe(ready);
        // Passing stops at the second reading; anything else reads on.
        expect(phone.reads.length > 2, where).toBe(!ready);
        expect(phone.reads.length, where).toBeGreaterThanOrEqual(2);
      }
    }
  });

  test.each(READY)(
    'INF-06-AC9: bokmål in $what, with the package service found, ends the wait at once',
    async ({ config }) => {
      const time = fakeTime();
      const phone = rawDevice(time, () => ({ config, packageService: FOUND }));

      const result = await waitForLocale(phone.read, {
        deadline: 5_000,
        interval: 1_000,
        now: time.now,
        sleep: time.sleep,
      });

      expect(result.ok, result.message).toBe(true);
      expect(phone.reads.length).toBe(1);
    },
  );

  test.each(LAST_SEEN)(
    'INF-06-AC9: at the deadline, having last seen $what, the failure says both, names bokmål, and says how long it waited',
    async ({ readings, language, packageMissing }) => {
      const time = fakeTime();
      const phone = rawDevice(time, inTurn(readings));

      const result = await waitForLocale(phone.read, {
        deadline: 30_000,
        interval: 1_000,
        now: time.now,
        sleep: time.sleep,
      });

      expect(result.ok).toBe(false);
      expect(phone.reads.length).toBeGreaterThan(readings.length);
      expect(result.message).toMatch(/bokmål/);
      expect(result.message).toMatch(/\bwait/i);
      expect(result.message).toMatch(saysHowLong(30_000));
      // The configuration's language, as last seen.
      expect(result.message).toMatch(language);
      // And the package service, as last seen: named, and missing only if it was.
      expect(result.message).toMatch(/\bpackage\b/i);
      expect(PACKAGE_MISSING.test(result.message), result.message).toBe(packageMissing);
    },
  );
});

// BUG-17. android-e2e failed three times before the app was installed: #57
// (job 110875720264), #60 (job 111180346250) and #96 (job 118947039610, run
// 39515647691), each with this wait's own message, "Waited 120 s for the
// emulator to be in Norwegian bokmål with its package service up … its package
// service was found, and its configuration's language was en-rUS." CI started
// the emulator with `-change-locale nb-NO`, which the emulator applies after
// boot by restarting Android's framework. #96's failing run and its passing
// re-run (job 119070015215) both logged "Changing locale to nb-NO … Restarting
// framework." at the same point; in the failing one the framework was up, and
// still en-rUS, 120 s later. That switch cannot be watched and sometimes does
// not take, so e2e:android could only wait for it and fail.
//
// So e2e:android makes the switch itself (D-031), and only on a device that is
// not in bokmål already: `adb root`, `adb wait-for-device`, `adb shell setprop
// persist.sys.locale nb-NO`, and `adb shell setprop ctl.restart zygote`, which
// restarts the framework that reads the property. Setting it at boot with
// `-prop persist.sys.locale` is refused by the emulator (D-081, run 8). A step
// that is refused fails at once, naming the step and what adb printed; a wait
// for a switch that cannot happen would only use up the deadline. When the wait
// after the switch runs out, it says what persist.sys.locale said last and
// whether the framework was seen restarting, so the next failure can be read
// (D-070).
//
// `adb` answers as the entry script's `run` does, { ok, status, output }:
// status null when adb could not be run or did not finish, output stdout and
// stderr together.

/** The adb arguments of the switch's four steps, after `-s <serial>`, in order. */
const SWITCH = [
  ['root'],
  ['wait-for-device'],
  ['shell', 'setprop', 'persist.sys.locale', 'nb-NO'],
  ['shell', 'setprop', 'ctl.restart', 'zygote'],
];

/**
 * `adb -s <serial> …` on an emulator, which notes each call's arguments and
 * answers them from `answers`, by the arguments joined with spaces. Any other
 * step it accepts, as a google_apis emulator does: `adb root` says it restarts
 * adbd as root, and the rest print nothing and exit 0.
 */
function emulatorAdb(answers = {}) {
  const calls = [];
  return {
    calls,
    adb: (args) => {
      calls.push(args);
      const step = args.join(' ');
      if (Object.hasOwn(answers, step)) return answers[step];
      return { ok: true, status: 0, output: step === 'root' ? 'restarting adbd as root\n' : '' };
    },
  };
}

/** The two answers of an adbd that is, or now will be, root. */
const ROOT_ACCEPTED = [
  { what: 'restarts adbd as root', output: 'restarting adbd as root\n' },
  { what: 'already runs adbd as root', output: 'adbd is already running as root\n' },
];

/**
 * Each step refused, with what adb printed. `names` is the step's own name,
 * looked for in the message once adb's words are taken out, as they may name
 * it too. adbd's refusal on a production build is adb's own text
 * (restart_root_service), and `adb root` exits 0 with it, as it does whenever
 * its answer lacks "restarting"; "unable to connect for" is adb's when it
 * cannot reach adbd, and "Failed to set property" toolbox's setprop's.
 */
const SWITCH_REFUSED = [
  {
    what: 'adb root is refused, as on a production build, though adb exits 0',
    step: 'root',
    answer: { ok: true, status: 0, output: 'adbd cannot run as root in production builds\n' },
    names: /\broot\b/,
  },
  {
    what: 'adb root exits 1',
    step: 'root',
    answer: { ok: false, status: 1, output: 'adb: unable to connect for root: closed\n' },
    names: /\broot\b/,
  },
  {
    what: 'adb wait-for-device does not finish',
    step: 'wait-for-device',
    answer: { ok: false, status: null, output: 'spawnSync adb ETIMEDOUT' },
    names: /\bwait-for-device\b/,
  },
  {
    what: 'setprop persist.sys.locale exits 1',
    step: 'shell setprop persist.sys.locale nb-NO',
    answer: {
      ok: false,
      status: 1,
      output:
        "Failed to set property 'persist.sys.locale' to 'nb-NO'.\nSee dmesg for error reason.\n",
    },
    names: /\bpersist\.sys\.locale\b/,
  },
  {
    what: 'setprop ctl.restart zygote exits 1',
    step: 'shell setprop ctl.restart zygote',
    answer: {
      ok: false,
      status: 1,
      output: "Failed to set property 'ctl.restart' to 'zygote'.\nSee dmesg for error reason.\n",
    },
    names: /\bctl\.restart\b|\bzygote\b/,
  },
];

/** Each line of what adb printed, as a message may show it: trimmed, and the empty ones left out. */
const printedLines = (output) =>
  output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

describe('BUG-17: switchToBokmal makes the switch to bokmål itself, step by step', () => {
  test.each(ROOT_ACCEPTED)(
    'BUG-17: on an emulator that $what, it runs adb root, wait-for-device, setprop persist.sys.locale nb-NO and setprop ctl.restart zygote, once each and in that order, and passes',
    async ({ output }) => {
      const device = emulatorAdb({ root: { ok: true, status: 0, output } });

      const result = await switchToBokmal(device.adb);

      expect(result.ok, result.message).toBe(true);
      expect(device.calls).toEqual(SWITCH);
    },
  );

  test.each(SWITCH_REFUSED)(
    'BUG-17: when $what, it stops at that step and fails, naming the step and saying what adb printed',
    async ({ step, answer, names }) => {
      const device = emulatorAdb({ [step]: answer });
      const refusedAt = SWITCH.findIndex((args) => args.join(' ') === step);

      const result = await switchToBokmal(device.adb);
      const said = printedLines(answer.output);
      const rest = said.reduce((message, line) => message.split(line).join(''), result.message);

      expect(result.ok, result.message).toBe(false);
      // Nothing after the refused step was run.
      expect(device.calls).toEqual(SWITCH.slice(0, refusedAt + 1));
      for (const line of said) expect(result.message).toContain(line);
      expect(rest, result.message).toMatch(names);
    },
  );
});

/** What `adb shell getprop persist.sys.locale` prints: the value, or an empty line when unset. */
const PROPERTY_NB = 'nb-NO\n';
const PROPERTY_UNSET = '\n';

/** The device as it booted, in its image's language, with persist.sys.locale unset. */
const BOOTED = { config: configOutput('en-rUS'), packageService: FOUND, property: PROPERTY_UNSET };

/** While the framework restarts: no configuration, no package service, the property set. */
const RESTARTING = { config: ACTIVITY_DOWN, packageService: NOT_FOUND, property: PROPERTY_NB };

/** The restarted framework in bokmål, ready to install. */
const IN_BOKMAL = { config: configOutput('nb-rNO'), packageService: FOUND, property: PROPERTY_NB };

/** The property set, and the framework still in English: the switch did not take. */
const NOT_TAKEN = { config: configOutput('en-rUS'), packageService: FOUND, property: PROPERTY_NB };

/** Bokmål in the configuration, and no package service to install with: not ready (D-140). */
const BOKMAL_NO_PACKAGE = {
  config: configOutput('nb-rNO'),
  packageService: NOT_FOUND,
  property: PROPERTY_NB,
};

/**
 * A device that e2e:android switches itself. Each reading is `before` until
 * `switchLocale` is called, and `after(msSinceTheSwitch)` from then on, and
 * the switch answers `switched`. Notes each reading, with when it was taken,
 * and each switch, with when and after how many readings.
 */
function switchedDevice(time, { before, after, switched = { ok: true, message: 'Switched.' } }) {
  const reads = [];
  const switches = [];
  return {
    reads,
    switches,
    read: () => {
      if (reads.length >= MAX_READS) {
        throw new Error(
          `read ${String(MAX_READS)} times: the wait is not following the now and sleep it was given`,
        );
      }
      const at = time.now();
      const reading = switches.length === 0 ? before : after(at - (switches[0]?.at ?? at));
      reads.push({ at, ...reading });
      return reading;
    },
    switchLocale: () => {
      switches.push({ at: time.now(), afterReads: reads.length });
      return switched;
    },
  };
}

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

/**
 * The wait after the switch, run out, and what its failure must then say:
 * persist.sys.locale as last read, and whether the package service was seen
 * missing at least once, the sign of a framework restarting. In each, the last
 * reading has the configuration in en-rUS and the package service found.
 */
const AFTER_THE_SWITCH = [
  {
    what: 'the framework restart and then en-rUS, with persist.sys.locale nb-NO',
    after: (ms) => (ms < 3_000 ? RESTARTING : NOT_TAKEN),
    says: propertySays('nb-NO'),
    doesNotSay: PROPERTY_EMPTY,
    restartSeen: true,
  },
  {
    what: 'no restart, with persist.sys.locale nb-NO',
    after: () => NOT_TAKEN,
    says: propertySays('nb-NO'),
    doesNotSay: PROPERTY_EMPTY,
    restartSeen: false,
  },
  {
    what: 'no restart, with persist.sys.locale still empty',
    after: () => BOOTED,
    says: PROPERTY_EMPTY,
    doesNotSay: propertySays('nb-NO'),
    restartSeen: false,
  },
];

describe('BUG-17: waitForLocale switches a device that is not in bokmål, once, and then waits as before', () => {
  test('BUG-17: a device already in bokmål with its package service up is not switched: it passes on the first reading, and the switch is never made', async () => {
    // Passes before the fix too, which never switches: it fails a fix that
    // switches every device, bokmål or not.
    const time = fakeTime();
    const phone = switchedDevice(time, { before: IN_BOKMAL, after: () => IN_BOKMAL });

    const result = await waitForLocale(phone.read, {
      deadline: 30_000,
      interval: 1_000,
      now: time.now,
      sleep: time.sleep,
      switchLocale: phone.switchLocale,
    });

    expect(result.ok, result.message).toBe(true);
    expect(phone.switches).toEqual([]);
    expect(phone.reads.length).toBe(1);
  });

  test('BUG-17: a device not in bokmål is switched once, straight after the first reading and before any sleep, and then read every interval until the restarted framework reports bokmål with its package service found', async () => {
    // Within the wait, so its deadline is today's, from the first reading,
    // and an interval passes between each two readings, as BUG-21's checks of
    // the entry script hold it to.
    const time = fakeTime();
    const phone = switchedDevice(time, {
      before: BOOTED,
      after: (ms) => (ms < 3_000 ? RESTARTING : IN_BOKMAL),
    });

    const result = await waitForLocale(phone.read, {
      deadline: 30_000,
      interval: 1_000,
      now: time.now,
      sleep: time.sleep,
      switchLocale: phone.switchLocale,
    });

    expect(phone.switches).toEqual([{ at: 0, afterReads: 1 }]);
    expect(result.ok, result.message).toBe(true);
    expect(phone.reads.map((r) => r.at)).toEqual([0, 1_000, 2_000, 3_000]);
    // Not vacuous: it read on through the restart, while the package service was gone.
    expect(phone.reads.map((r) => r.packageService)).toContain(NOT_FOUND);
  });

  test('BUG-17: a device whose first reading is in bokmål but has no package service is not ready either, so it is switched once, straight after that reading, and then passes once the restarted framework has its package service', async () => {
    // D-140: the first reading is not ready when the configuration is not
    // bokmål, or the package service is not found, and either is switched. A
    // switch made only for a language that is wrong passed every test before
    // this one (test-auditor's mutant B4, at 9597d9f). The device stays as it
    // was until it is switched, so a wait that does not switch it runs out.
    const time = fakeTime();
    const phone = switchedDevice(time, {
      before: BOKMAL_NO_PACKAGE,
      after: (ms) => (ms < 3_000 ? RESTARTING : IN_BOKMAL),
    });

    const result = await waitForLocale(phone.read, {
      deadline: 30_000,
      interval: 1_000,
      now: time.now,
      sleep: time.sleep,
      switchLocale: phone.switchLocale,
    });

    expect(phone.switches).toEqual([{ at: 0, afterReads: 1 }]);
    // The guard: switched, it waits as before, an interval between each two
    // readings, and passes on the first with the package service found.
    expect(result.ok, result.message).toBe(true);
    expect(phone.reads.map((r) => r.at)).toEqual([0, 1_000, 2_000, 3_000]);
    expect(phone.reads.at(-1)?.packageService).toBe(FOUND);
  });

  test('BUG-17: when the switch is refused, the wait fails at once with what the switch said: no sleep, and no reading after it', async () => {
    // After the refusal the device would report bokmål, so a wait that read
    // on would pass, and be seen to.
    const time = fakeTime();
    const refused = {
      ok: false,
      message: 'adb root was refused. adb printed:\nadbd cannot run as root in production builds',
    };
    const phone = switchedDevice(time, {
      before: BOOTED,
      after: () => IN_BOKMAL,
      switched: refused,
    });

    const result = await waitForLocale(phone.read, {
      deadline: 30_000,
      interval: 1_000,
      now: time.now,
      sleep: time.sleep,
      switchLocale: phone.switchLocale,
    });

    expect(phone.switches.length).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(refused.message);
    expect(phone.reads.length).toBe(1);
    expect(time.now()).toBe(0);
  });

  test.each(AFTER_THE_SWITCH)(
    'BUG-17: when the wait after the switch runs out, having seen $what, the failure still says what it said before, and adds what persist.sys.locale said last and whether the framework was seen restarting',
    async ({ after, says, doesNotSay, restartSeen }) => {
      const time = fakeTime();
      const phone = switchedDevice(time, { before: BOOTED, after });

      const result = await waitForLocale(phone.read, {
        deadline: 30_000,
        interval: 1_000,
        now: time.now,
        sleep: time.sleep,
        switchLocale: phone.switchLocale,
      });

      // It waited out the deadline as before.
      expect(result.ok).toBe(false);
      expect(phone.reads.at(-1)?.at).toBeGreaterThanOrEqual(30_000 - 1_000);
      expect(time.now()).toBeLessThanOrEqual(30_000 + 1_000);
      // What it said before: it waited, how long, for bokmål, and what the
      // configuration and the package service last said.
      expect(result.message).toMatch(/bokmål/);
      expect(result.message).toMatch(/\bwait/i);
      expect(result.message).toMatch(saysHowLong(30_000));
      expect(result.message).toMatch(spelled('en-US'));
      expect(result.message).toMatch(/\bpackage\b/i);
      expect(PACKAGE_MISSING.test(result.message), result.message).toBe(false);
      // What persist.sys.locale said last.
      expect(result.message).toMatch(says);
      expect(result.message).not.toMatch(doesNotSay);
      // Whether the framework was seen restarting.
      expect(result.message).toMatch(SAYS_RESTART);
      expect(NO_RESTART.test(result.message), result.message).toBe(!restartSeen);
      // Not vacuous: this was the wait after a switch, made once.
      expect(phone.switches.length).toBe(1);
    },
  );
});

// Added 2026-09-28. Run 8 of android-e2e (run 36324362689, job 108634139466),
// on code identical to the green run 7, printed `The device's language is
// nb-rNO, and its package service is up.` Then `adb install -r …` failed:
//
//   adb: failed to install …/app-release.apk:
//   Exception occurred while executing 'install':
//   java.lang.NullPointerException: Attempt to invoke virtual method 'void
//     android.content.pm.PackageManagerInternal.freeStorage(java.lang.String,
//     long, int)' on a null object reference
//   	at com.android.server.StorageManagerService.allocateBytes(StorageManagerService.java:4299)
//
// Run 6 had failed its install with `cmd: Can't find service: package`. On
// the Mac, on fresh CI-identical devices: the language switch makes Android
// restart its framework, and on the first boot in bokmål installs fail for a
// while after the device reports ready. 17 s after boot_completed one failed,
// and 80 s later one succeeded; a reboot after the switch did not help. Past
// that first bokmål boot, installs straight after boot worked 6 of 6, and with
// no language switch at all the install after the first boot worked. The
// emulator refuses `-prop persist.sys.locale=…` ("only 'qemu.*' properties are
// supported"), so the switch cannot be avoided that way.
//
// So the install waits, up to a deadline, while it fails with one of those two
// signatures, and at the time for nothing else. BUG-9 later added a third, the
// session refusal of run 36569778633: a SecurityException saying the caller
// has no access to the session a streamed install had just created. See the
// BUG-9 block below. It waits for the device: a failed flow is still never
// retried, which the test of the flows further down holds.
//
// `install` answers what `adb install -r` printed, stdout and stderr together,
// or null when adb could not be run, as waitForLocale's `read` does.

/** What `adb install -r` prints when it worked. */
const INSTALLED = 'Performing Streamed Install\nSuccess\n';

/** Run 6's install failure, with the runner's path to the APK shortened. */
const PACKAGE_SERVICE_GONE = `adb: failed to install ${APK}: cmd: Can't find service: package\n`;

/** Run 8's install failure, as its job log shows it, the path shortened. */
const PACKAGE_MANAGER_NPE = [
  `adb: failed to install ${APK}: `,
  "Exception occurred while executing 'install':",
  "java.lang.NullPointerException: Attempt to invoke virtual method 'void android.content.pm.PackageManagerInternal.freeStorage(java.lang.String, long, int)' on a null object reference",
  '\tat com.android.server.StorageManagerService.allocateBytes(StorageManagerService.java:4299)',
  '',
].join('\n');

/** What adb prints when the install worked: a Success line. */
const INSTALL_OK = [
  { what: 'a streamed install', output: INSTALLED },
  {
    what: 'an install that pushed the APK first',
    output: `${APK}: 1 file pushed, 0 skipped. 88.1 MB/s (41943040 bytes in 0.454s)\n\tpkg: /data/local/tmp/app-release.apk\nSuccess\n`,
  },
];

/**
 * The two signatures runs 6 and 8 saw while the package manager was not ready.
 * The third row is run 8's exception on another of PackageManagerInternal's
 * methods: what counts is a NullPointerException there, not which call it hit.
 * These are not the only not-ready answers: BUG-9's SESSION_NOT_READY, below,
 * is the third signature.
 */
const INSTALL_NOT_READY = [
  { what: "run 6: Can't find service: package", output: PACKAGE_SERVICE_GONE },
  { what: 'run 8: NPE in PackageManagerInternal', output: PACKAGE_MANAGER_NPE },
  {
    what: 'another NPE in PackageManagerInternal',
    output: PACKAGE_MANAGER_NPE.replace(
      'freeStorage(java.lang.String, long, int)',
      'getPackage(java.lang.String)',
    ),
  },
];

/**
 * Everything else adb can say, each of which fails the install at once, and
 * what the failure must then show of it. All synthetic. INSUFFICIENT_STORAGE is
 * a real lack of space, not run 8's freeStorage; the last four are near misses
 * of the two signatures and of a Success line.
 */
const INSTALL_FAILED = [
  {
    what: 'INSTALL_FAILED_INVALID_APK',
    output: `Performing Streamed Install\nadb: failed to install ${APK}: Failure [INSTALL_FAILED_INVALID_APK: Failed to parse the package]\n`,
    shows: 'INSTALL_FAILED_INVALID_APK',
  },
  {
    what: 'INSTALL_FAILED_INSUFFICIENT_STORAGE',
    output: `Performing Streamed Install\nadb: failed to install ${APK}: Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]\n`,
    shows: 'INSTALL_FAILED_INSUFFICIENT_STORAGE',
  },
  {
    what: 'INSTALL_FAILED_UPDATE_INCOMPATIBLE',
    output: `Performing Streamed Install\nadb: failed to install ${APK}: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package no.example.app signatures do not match previously installed version; ignoring!]\n`,
    shows: 'INSTALL_FAILED_UPDATE_INCOMPATIBLE',
  },
  {
    what: 'a missing APK',
    output: `adb: failed to stat ${APK}: No such file or directory\n`,
    shows: 'No such file or directory',
  },
  { what: 'an empty output', output: '', shows: '' },
  { what: 'no adb at all', output: null, shows: '' },
  {
    what: "Can't find service: activity",
    output: `adb: failed to install ${APK}: cmd: Can't find service: activity\n`,
    shows: "Can't find service: activity",
  },
  {
    what: 'an NPE elsewhere',
    output: PACKAGE_MANAGER_NPE.replace(
      'void android.content.pm.PackageManagerInternal.freeStorage(java.lang.String, long, int)',
      'int android.content.pm.ApplicationInfo.getTargetSdkVersion()',
    ),
    shows: 'ApplicationInfo',
  },
  {
    what: 'PackageManagerInternal, but no NPE',
    output: `adb: failed to install ${APK}: \njava.lang.SecurityException: Permission Denial: PackageManagerInternal.freeStorage from pid=4242, uid=2000\n`,
    shows: 'SecurityException',
  },
  {
    what: 'Success only inside a failure line',
    output: `adb: failed to install /tmp/Success/app-release.apk: Failure [INSTALL_FAILED_INVALID_APK]\n`,
    shows: 'INSTALL_FAILED_INVALID_APK',
  },
];

/**
 * An `adb install -r` that prints `answer(now, installsSoFar)`; notes when each
 * install was tried, and what it printed.
 */
function installer(time, answer) {
  const calls = [];
  return {
    calls,
    install: () => {
      if (calls.length >= MAX_READS) {
        throw new Error(
          `installed ${String(MAX_READS)} times: the wait is not following the now and sleep it was given`,
        );
      }
      const output = answer(time.now(), calls.length);
      calls.push({ at: time.now(), output });
      return output;
    },
  };
}

/** A message that says the install was tried `n` times: "7 attempts", "tried 7 times". */
function saysAttempts(n) {
  return new RegExp(
    `(?<![\\d.])${String(n)} ?(?:install(?:ation)? )?(?:attempts?|tries|times)\\b|\\b(?:attempts?|tries)\\b:? ?${String(n)}(?![\\d.])`,
    'i',
  );
}

/** The last not-ready output before the deadline, after a different one, and a line only it has. */
const LAST_INSTALL = [
  {
    what: 'first as run 8, last as run 6',
    outputs: [PACKAGE_MANAGER_NPE, PACKAGE_SERVICE_GONE],
    only: "Can't find service: package",
  },
  {
    what: 'first as run 6, last as run 8',
    outputs: [PACKAGE_SERVICE_GONE, PACKAGE_MANAGER_NPE],
    only: 'PackageManagerInternal.freeStorage',
  },
];

/** A deadline of zero still installs once, and that one answer decides. */
const INSTALL_AT_ONCE = [
  { what: 'Success', output: INSTALLED, ok: true },
  { what: "run 8's not-ready", output: PACKAGE_MANAGER_NPE, ok: false },
];

// Added 2026-09-29, BUG-9. android-e2e on PR #43, which moves CI to
// ubuntu-26.04 (D-085): run 36569778633, job 109410598303. The emulator
// booted, `-change-locale nb-NO` restarted Android's framework at 12:49:35.61,
// and at 12:49:52.77 e2e:android printed `The device's language is nb-rNO, and
// its package service is up.` 0.46 s later the first `adb install -r` failed:
//
//   Performing Streamed Install
//   adb: failed to install …/app-release.apk:
//   Exception occurred while executing 'install':
//   java.lang.SecurityException: Caller has no access to session 1046719992
//   	at com.android.server.pm.PackageInstallerService.openSessionInternal(PackageInstallerService.java:1448)
//   	at com.android.server.pm.PackageInstallerService.openSession(PackageInstallerService.java:1420)
//   	at com.android.server.pm.PackageManagerShellCommand.doCommitSession(PackageManagerShellCommand.java:4533)
//
// That was neither of the two signatures installVerdict knew, so
// installWhenReady gave up on attempt 1. The newest green run on main, on
// ubuntu-24.04 (job 109379152187), had the same emulator, 37.1.11.0, a full
// boot with no snapshot, and the install about 15 s after the framework's
// restart: Success on attempt 1.
//
// AOSP's PackageInstallerService, read from aosp-mirror's frameworks/base,
// which is older than the emulator's Android 17 so its line numbers differ:
// openSessionInternal throws exactly "Caller has no access to session " +
// sessionId when checkOpenSessionAccess refuses, that is when it holds no such
// session or the caller is not the session's owner. A streamed `adb install`
// creates the session, writes to it and commits it from one shell command, so
// the shell owns the session it was refused. That points at a package manager
// not yet ready, not at the APK, which fails with Failure [INSTALL_FAILED_…]
// or INSTALL_PARSE_FAILED_… instead. It is a third signature of the window
// D-081 item 12 records. The same class throws "Caller has no access to
// package " + packageName when it does refuse a caller, so only a
// SecurityException saying it of a session counts, whatever the session's
// number.

/** Run 36569778633's install failure, all of what adb printed, as its job log shows it. */
const SESSION_REFUSED = [
  'Performing Streamed Install',
  `adb: failed to install ${APK}: `,
  "Exception occurred while executing 'install':",
  'java.lang.SecurityException: Caller has no access to session 1046719992',
  '\tat com.android.server.pm.PackageInstallerService.openSessionInternal(PackageInstallerService.java:1448)',
  '\tat com.android.server.pm.PackageInstallerService.openSession(PackageInstallerService.java:1420)',
  '\tat com.android.server.pm.PackageManagerShellCommand.doCommitSession(PackageManagerShellCommand.java:4533)',
  '\tat com.android.server.pm.PackageManagerShellCommand.doRunInstall(PackageManagerShellCommand.java:1741)',
  '\tat com.android.server.pm.PackageManagerShellCommand.runInstall(PackageManagerShellCommand.java:1662)',
  '\tat com.android.server.pm.PackageManagerShellCommand.onCommand(PackageManagerShellCommand.java:251)',
  '\tat com.android.modules.utils.BasicShellCommandHandler.exec(BasicShellCommandHandler.java:97)',
  '\tat android.os.ShellCommand.exec(ShellCommand.java:40)',
  '\tat com.android.server.pm.PackageManagerService$IPackageManagerImpl.onShellCommand(PackageManagerService.java:7439)',
  '\tat android.os.Binder.shellCommand(Binder.java:1061)',
  '\tat android.os.Binder.onTransact(Binder.java:921)',
  '\tat android.content.pm.IPackageManager$Stub.onTransact(IPackageManager.java:4767)',
  '\tat com.android.server.pm.PackageManagerService$IPackageManagerImpl.onTransact(PackageManagerService.java:7423)',
  '\tat android.os.Binder.execTransactInternal(Binder.java:1347)',
  '\tat android.os.Binder.execTransact(Binder.java:1301)',
  '',
].join('\n');

/**
 * BUG-9's signature: this run's output, and the same refusal of other
 * sessions. The number is whichever session adb had just created, so what
 * counts is the message, not the number or how many digits it has. The last
 * row is this run's output with CRLF line ends, which Success and the other two
 * signatures already allow. It holds the answer, not the pattern's `\r?`: in
 * JavaScript a multiline `$` already stops before a `\r`, so a pattern without
 * `\r?` answers the same, and no row can tell the two apart.
 */
const SESSION_NOT_READY = [
  { what: 'run 36569778633, session 1046719992', output: SESSION_REFUSED },
  {
    what: 'the same refusal of session 1286904417',
    output: SESSION_REFUSED.replace('session 1046719992', 'session 1286904417'),
  },
  {
    what: 'the same refusal of session 42',
    output: SESSION_REFUSED.replace('session 1046719992', 'session 42'),
  },
  {
    what: 'run 36569778633 with CRLF line ends',
    output: SESSION_REFUSED.replaceAll('\n', '\r\n'),
  },
];

/**
 * Near misses of BUG-9's signature, each of which still fails the install at
 * once, and what the failure must then show of it. All synthetic. The first is
 * the refusal PackageInstallerService makes of a package; the next two carry
 * the session's words outside a SecurityException.
 *
 * The last three hold that only the whole line counts, exactly as run
 * 36569778633 printed it: `java.lang.SecurityException: Caller has no access
 * to session ` and a number, with nothing before it on its line and nothing
 * after it. Text after the number, an id that is not a number, and a prefix all
 * fail at once. The prefix is a `Caused by: ` line, as Java prints an exception
 * wrapped in another. That was not observed, and it does not count: the
 * decision is that only the exact line observed waits, and any other refusal
 * fails at once rather than being waited on. Each of the three is the whole
 * of run 36569778633's output with that one line changed.
 */
const SESSION_NEAR_MISSES = [
  {
    what: 'a SecurityException refusing a package',
    output: [
      'Performing Streamed Install',
      `adb: failed to install ${APK}: `,
      "Exception occurred while executing 'install':",
      'java.lang.SecurityException: Caller has no access to package no.example.app',
      '',
    ].join('\n'),
    shows: 'Caller has no access to package no.example.app',
  },
  {
    what: "the session's words in another exception",
    output: SESSION_REFUSED.replace(
      'java.lang.SecurityException: Caller',
      'java.lang.IllegalStateException: Caller',
    ),
    shows: 'IllegalStateException',
  },
  {
    what: "the session's words in a Failure line",
    output: `Performing Streamed Install\nadb: failed to install ${APK}: Failure [INSTALL_FAILED_INTERNAL_ERROR: Caller has no access to session 1046719992]\n`,
    shows: 'INSTALL_FAILED_INTERNAL_ERROR',
  },
  {
    what: "the session's line with text after the number",
    output: SESSION_REFUSED.replace('session 1046719992\n', 'session 1046719992 (abandoned)\n'),
    shows: 'Caller has no access to session 1046719992 (abandoned)',
  },
  {
    what: "the session's line behind a Caused by prefix",
    output: SESSION_REFUSED.replace(
      '\njava.lang.SecurityException: Caller',
      '\nCaused by: java.lang.SecurityException: Caller',
    ),
    shows: 'Caused by: java.lang.SecurityException: Caller has no access to session 1046719992',
  },
  {
    what: "the session's line with an id that is not a number",
    output: SESSION_REFUSED.replace('session 1046719992\n', 'session abc\n'),
    shows: 'Caller has no access to session abc',
  },
];

describe('installVerdict: what `adb install -r` printed', () => {
  test.each(INSTALL_OK)('INF-06-AC9: $what is ok', ({ output }) => {
    expect(installVerdict(output)).toBe('ok');
  });

  test.each(INSTALL_NOT_READY)(
    'INF-06-AC9: $what is not-ready, a device still starting',
    ({ output }) => {
      expect(installVerdict(output)).toBe('not-ready');
    },
  );

  test.each(INSTALL_FAILED)('INF-06-AC9: $what is failed, never not-ready', ({ output }) => {
    expect(installVerdict(output)).toBe('failed');
  });

  test.each(SESSION_NOT_READY)(
    'BUG-9: a SecurityException refusing its own session, $what, is not-ready, a device still starting',
    ({ output }) => {
      expect(installVerdict(output)).toBe('not-ready');
    },
  );

  test.each(SESSION_NEAR_MISSES)('BUG-9: $what is failed, never not-ready', ({ output }) => {
    expect(installVerdict(output)).toBe('failed');
  });
});

describe('installWhenReady: the package manager accepts installs a while after the device reports ready', () => {
  test('INF-06-AC9: installs at once, and on Success passes without waiting or installing again', async () => {
    const time = fakeTime();
    const adb = installer(time, () => INSTALLED);

    const result = await installWhenReady(adb.install, {
      deadline: 30_000,
      interval: 5_000,
      now: time.now,
      sleep: time.sleep,
    });

    expect(result.ok, result.message).toBe(true);
    expect(adb.calls.map((c) => c.at)).toEqual([0]);
    expect(time.now()).toBe(0);
  });

  test('INF-06-AC9: not ready as in run 8, then as in run 6, then Success: it tries again one interval after each, passes, and installs no more', async () => {
    const time = fakeTime();
    const adb = installer(time, inTurn([PACKAGE_MANAGER_NPE, PACKAGE_SERVICE_GONE, INSTALLED]));

    const result = await installWhenReady(adb.install, {
      deadline: 30_000,
      interval: 5_000,
      now: time.now,
      sleep: time.sleep,
    });

    expect(result.ok, result.message).toBe(true);
    expect(adb.calls.map((c) => c.at)).toEqual([0, 5_000, 10_000]);
  });

  test.each(INSTALL_NOT_READY)(
    'INF-06-AC9: after $what, it tries again one interval later',
    async ({ output }) => {
      const time = fakeTime();
      const adb = installer(time, inTurn([output, INSTALLED]));

      const result = await installWhenReady(adb.install, {
        deadline: 30_000,
        interval: 5_000,
        now: time.now,
        sleep: time.sleep,
      });

      expect(result.ok, result.message).toBe(true);
      expect(adb.calls.map((c) => c.at)).toEqual([0, 5_000]);
    },
  );

  test.each(INSTALL_FAILED)(
    'INF-06-AC9: $what stops the install at once, with what adb printed',
    async ({ output, shows }) => {
      // Were it tried again, the second install would pass.
      const time = fakeTime();
      const adb = installer(time, inTurn([output, INSTALLED]));

      const result = await installWhenReady(adb.install, {
        deadline: 30_000,
        interval: 5_000,
        now: time.now,
        sleep: time.sleep,
      });

      expect(result.ok, result.message).toBe(false);
      expect(adb.calls.length, result.message).toBe(1);
      expect(time.now()).toBe(0);
      expect(result.message).toMatch(/\binstall/i);
      if (shows !== '') expect(result.message).toContain(shows);
    },
  );

  test('INF-06-AC9: a failure after a not-ready install stops there too, with what adb printed', async () => {
    const time = fakeTime();
    const storageFull = INSTALL_FAILED.find((c) => c.what.endsWith('INSUFFICIENT_STORAGE'));
    const adb = installer(time, inTurn([PACKAGE_MANAGER_NPE, storageFull?.output, INSTALLED]));

    const result = await installWhenReady(adb.install, {
      deadline: 30_000,
      interval: 5_000,
      now: time.now,
      sleep: time.sleep,
    });

    expect(result.ok, result.message).toBe(false);
    expect(adb.calls.map((c) => c.at)).toEqual([0, 5_000]);
    expect(result.message).toContain('INSTALL_FAILED_INSUFFICIENT_STORAGE');
  });

  test.each(LAST_INSTALL)(
    'INF-06-AC9: not ready until the deadline, $what, it fails there, naming the attempts, how long it waited, and the last output',
    async ({ outputs, only }) => {
      const time = fakeTime();
      const adb = installer(time, inTurn(outputs));

      const result = await installWhenReady(adb.install, {
        deadline: 30_000,
        interval: 5_000,
        now: time.now,
        sleep: time.sleep,
      });

      expect(result.ok).toBe(false);
      // It kept trying up to the deadline, and not an interval past it.
      expect(adb.calls.length).toBeGreaterThan(outputs.length);
      expect(adb.calls.at(-1)?.at).toBeGreaterThanOrEqual(30_000 - 5_000);
      expect(time.now()).toBeLessThanOrEqual(30_000 + 5_000);
      expect(result.message).toMatch(/\bwait/i);
      expect(result.message).toMatch(saysHowLong(30_000));
      expect(result.message).toMatch(saysAttempts(adb.calls.length));
      // The last output, which the first one did not have.
      expect(result.message).toContain(only);
    },
  );

  test.each(INSTALL_AT_ONCE)(
    'INF-06-AC9: with a deadline of zero it still installs once, and $what decides it',
    async ({ output, ok }) => {
      const time = fakeTime();
      const adb = installer(time, () => output);

      const result = await installWhenReady(adb.install, {
        deadline: 0,
        interval: 5_000,
        now: time.now,
        sleep: time.sleep,
      });

      expect(adb.calls.length).toBe(1);
      expect(result.ok, result.message).toBe(ok);
    },
  );

  test('INF-06-AC9: for any deadline and interval, it installs at least once, never faster than the interval, passes only on Success and stops there, and otherwise tries until the deadline', async () => {
    // A sweep in place of fast-check, which the repository root does not have.
    for (const deadline of [0, 5_000, 12_500, 30_000]) {
      for (const interval of [1, 1_000, 5_000, 7_000]) {
        const surelySeen = Math.max(0, deadline - interval);
        for (const from of [0, 5_000, surelySeen, deadline + 1, Infinity]) {
          const time = fakeTime();
          const adb = installer(time, (at) => (at >= from ? INSTALLED : PACKAGE_MANAGER_NPE));

          const result = await installWhenReady(adb.install, {
            deadline,
            interval,
            now: time.now,
            sleep: time.sleep,
          });
          const at = adb.calls.map((c) => c.at);
          const installed = adb.calls.filter((c) => c.output === INSTALLED).length;
          const where = `deadline ${String(deadline)}, interval ${String(interval)}, ready from ${String(from)}; installed at ${at.slice(0, 6).join(', ')}${at.length > 6 ? ' …' : ''}`;

          expect(at.length, where).toBeGreaterThanOrEqual(1);
          expect(at.length, where).toBeLessThanOrEqual(Math.floor(deadline / interval) + 2);
          at.slice(1).forEach((t, i) =>
            expect(t - (at[i] ?? Infinity), where).toBeGreaterThanOrEqual(interval),
          );
          expect(at.at(-1), where).toBeLessThanOrEqual(deadline + interval);
          // Passing means the last install, and only that one, printed Success.
          expect(installed, where).toBe(result.ok ? 1 : 0);
          expect(adb.calls.at(-1)?.output === INSTALLED, where).toBe(result.ok);
          if (!result.ok) expect(at.at(-1), where).toBeGreaterThanOrEqual(deadline - interval);
          if (from <= surelySeen) expect(result.ok, where).toBe(true);
          if (from === Infinity) expect(result.ok, where).toBe(false);
        }
      }
    }
  });

  test('INF-06-AC9: the production deadline is at least 60 s and the interval a few seconds, and they are what the wait uses when it is given none', async () => {
    // The Mac's first bokmål boot accepted an install only some 80 s after an
    // attempt at 17 s had failed, and CI's runner is slower. An interval under
    // a second streams the APK over and over; one over ten seconds leaves a
    // ready device idle.
    expect(INSTALL_DEADLINE_MS).toBeGreaterThanOrEqual(60_000);
    expect(INSTALL_INTERVAL_MS).toBeGreaterThanOrEqual(1_000);
    expect(INSTALL_INTERVAL_MS).toBeLessThanOrEqual(10_000);

    const time = fakeTime();
    const adb = installer(time, () => PACKAGE_MANAGER_NPE);
    const result = await installWhenReady(adb.install, { now: time.now, sleep: time.sleep });

    expect(result.ok).toBe(false);
    expect((adb.calls[1]?.at ?? 0) - (adb.calls[0]?.at ?? 0)).toBe(INSTALL_INTERVAL_MS);
    expect(adb.calls.at(-1)?.at).toBeGreaterThanOrEqual(INSTALL_DEADLINE_MS - INSTALL_INTERVAL_MS);
    expect(result.message).toMatch(saysHowLong(INSTALL_DEADLINE_MS));
  });

  test("INF-06-AC9: with the production settings, a device that first accepts the install 80 s in, as the Mac's first bokmål boot did, passes", async () => {
    const time = fakeTime();
    const adb = installer(time, (at) => (at >= 80_000 ? INSTALLED : PACKAGE_MANAGER_NPE));

    const result = await installWhenReady(adb.install, { now: time.now, sleep: time.sleep });

    expect(result.ok, result.message).toBe(true);
    expect(adb.calls.at(-1)?.at).toBeGreaterThanOrEqual(80_000);
    expect(adb.calls.at(-1)?.at).toBeLessThanOrEqual(80_000 + INSTALL_INTERVAL_MS);
  });

  test('BUG-9: refused its own session as in run 36569778633 on attempt 1, and Success on attempt 2, it tries again one interval later and passes on attempt 2', async () => {
    const time = fakeTime();
    const adb = installer(time, inTurn([SESSION_REFUSED, INSTALLED]));

    const result = await installWhenReady(adb.install, {
      deadline: 30_000,
      interval: 5_000,
      now: time.now,
      sleep: time.sleep,
    });

    expect(result.ok, result.message).toBe(true);
    expect(result.message).toMatch(/\battempt 2\b/);
    expect(adb.calls.map((c) => c.at)).toEqual([0, 5_000]);
  });

  test('BUG-9: not ready as in run 8, then refused its own session as in run 36569778633, then Success: it tries again one interval after each, passes, and installs no more', async () => {
    const time = fakeTime();
    const adb = installer(time, inTurn([PACKAGE_MANAGER_NPE, SESSION_REFUSED, INSTALLED]));

    const result = await installWhenReady(adb.install, {
      deadline: 30_000,
      interval: 5_000,
      now: time.now,
      sleep: time.sleep,
    });

    expect(result.ok, result.message).toBe(true);
    expect(adb.calls.map((c) => c.at)).toEqual([0, 5_000, 10_000]);
  });

  test('BUG-9: refused its own session on every attempt, it keeps trying until the deadline, then fails naming the attempts, how long it waited, and what adb printed', async () => {
    const time = fakeTime();
    const adb = installer(time, () => SESSION_REFUSED);

    const result = await installWhenReady(adb.install, {
      deadline: 30_000,
      interval: 5_000,
      now: time.now,
      sleep: time.sleep,
    });

    expect(result.ok).toBe(false);
    // It kept trying up to the deadline, and not an interval past it.
    expect(adb.calls.length, result.message).toBeGreaterThan(1);
    expect(adb.calls.at(-1)?.at).toBeGreaterThanOrEqual(30_000 - 5_000);
    expect(time.now()).toBeLessThanOrEqual(30_000 + 5_000);
    expect(result.message).toMatch(/\bwait/i);
    expect(result.message).toMatch(saysHowLong(30_000));
    expect(result.message).toMatch(saysAttempts(adb.calls.length));
    expect(result.message).toContain(
      'java.lang.SecurityException: Caller has no access to session 1046719992',
    );
  });

  test.each(SESSION_NEAR_MISSES)(
    'BUG-9: $what stops the install at once, with what adb printed',
    async ({ output, shows }) => {
      // Were it tried again, the second install would pass.
      const time = fakeTime();
      const adb = installer(time, inTurn([output, INSTALLED]));

      const result = await installWhenReady(adb.install, {
        deadline: 30_000,
        interval: 5_000,
        now: time.now,
        sleep: time.sleep,
      });

      expect(result.ok, result.message).toBe(false);
      expect(adb.calls.length, result.message).toBe(1);
      expect(time.now()).toBe(0);
      expect(result.message).toMatch(/\binstall/i);
      expect(result.message).toContain(shows);
    },
  );
});

/** A Maestro JUnit report holding these <testcase> elements. */
function report(...cases) {
  const failures = cases.filter((c) => c.includes('<failure>')).length;
  return [
    "<?xml version='1.0' encoding='UTF-8'?>",
    '<testsuites>',
    `  <testsuite name="Test Suite" device="emulator-5554" tests="${String(cases.length)}" failures="${String(failures)}" time="31" timestamp="2026-09-25T09:00:00">`,
    ...cases,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
}

const flow = (name, status, failure) =>
  failure === undefined
    ? `    <testcase id="${name}" name="${name}" classname="${name}" file="apps/mobile/e2e/${name}.yaml" time="21" timestamp="2026-09-25T09:00:02" status="${status}"/>`
    : `    <testcase id="${name}" name="${name}" classname="${name}" file="apps/mobile/e2e/${name}.yaml" time="9" timestamp="2026-09-25T09:00:02" status="${status}">\n      <failure>${failure}</failure>\n    </testcase>`;

describe('judgeReport: only a report in which every flow ran and passed is a pass', () => {
  test('INF-06-AC9: no report at all is a failure, not an empty pass', () => {
    const result = judgeReport(null);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/report/i);
  });

  test('INF-06-AC9: a report in which no flow ran is a failure that says so', () => {
    const result = judgeReport(report());

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/(no|zero|0) flows?/i);
  });

  test('INF-06-AC9: a failed flow is a failure that names the flow', () => {
    const result = judgeReport(
      report(
        flow('app-starts', 'ERROR', 'Assertion is false: "TryggHverdag" is visible'),
        flow('second-flow', 'SUCCESS'),
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('app-starts');
    expect(result.message).toMatch(/fail/i);
  });

  test('INF-06-AC9: a flow that was cut short did not pass, though it has no <failure> element', () => {
    // Maestro counts only ERROR as a failure in the attribute, so
    // failures="0" here. Reading that number alone would call this a pass.
    const result = judgeReport(report(flow('app-starts', 'CANCELED')));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('app-starts');
  });

  test('INF-06-AC9: when every flow passed, it passes and says how many ran', () => {
    expect(judgeReport(report(flow('app-starts', 'SUCCESS')))).toMatchObject({
      ok: true,
      message: expect.stringMatching(/\b1 of 1 flows? passed/),
    });
    expect(
      judgeReport(report(flow('app-starts', 'SUCCESS'), flow('second-flow', 'SUCCESS'))),
    ).toMatchObject({ ok: true, message: expect.stringMatching(/\b2 of 2 flows passed/) });
  });
});

/**
 * One <testcase> as Maestro 2.10.0 writes it. Read from tag cli-2.10.0 of
 * github.com/mobile-dev-inc/maestro: JUnitTestSuiteReporter.kt and its
 * JUnitTestSuiteReporterTest.kt ("XML - Test failed"), under
 * maestro-cli/src/{main/java,test/kotlin}/maestro/cli/report/. A failed flow's
 * reason is the text of its <failure> element (@JacksonXmlText), never a
 * `message` attribute. It comes after the flow's <properties>, when the flow
 * has any, and only an ERROR flow has one (TestSuiteInteractor.kt). Jackson
 * 2.17.1 writes through Woodstox 6.6.2, whose BufferingXmlWriter escapes < and
 * & in element text always, > at the start or after ], and a carriage return
 * as &#xd;. It leaves " and line breaks as they are. `failure` goes in as it
 * stands in the file, entities and all.
 *
 * @param {string} name
 * @param {string} status
 * @param {{ failure?: string, properties?: Record<string, string> }} [children]
 */
function maestroFlow(name, status, { failure, properties } = {}) {
  const open =
    `    <testcase id="${name}" name="${name}" classname="${name}" ` +
    `file="apps/mobile/e2e/${name}.yaml" time="37.412" timestamp="2026-10-20T09:00:02" status="${status}"`;
  const inside = [
    ...(properties === undefined
      ? []
      : [
          '      <properties>',
          ...Object.entries(properties).map(
            ([key, value]) => `        <property name="${key}" value="${value}"/>`,
          ),
          '      </properties>',
        ]),
    ...(failure === undefined ? [] : [`      <failure>${failure}</failure>`]),
  ];
  return inside.length === 0 ? `${open}/>` : [`${open}>`, ...inside, '    </testcase>'].join('\n');
}

/**
 * A failed <testcase> holding this <failure> element, written as it stands: the
 * shape other JUnit writers use, with the reason in a `message` attribute.
 */
const failedWith = (name, element) =>
  `    <testcase id="${name}" name="${name}" classname="${name}" ` +
  `file="apps/mobile/e2e/${name}.yaml" time="50.204" timestamp="2026-10-20T09:00:02" status="ERROR">\n` +
  `      ${element}\n` +
  '    </testcase>';

/** `text` with every run of white space as one space. */
const squash = (text) => text.replace(/\s+/g, ' ');

/** How many times `text` shows in `message`, white space aside. */
const timesIn = (message, text) => squash(message).split(squash(text)).length - 1;

/**
 * The flow, of `names`, named last before `text` first shows in `message`,
 * white space aside: the flow that text is listed under. Undefined when `text`
 * is not in the message at all.
 *
 * @param {string} message
 * @param {string} text
 * @param {string[]} names
 */
function listedUnder(message, text, names) {
  const flat = squash(message);
  const at = flat.indexOf(squash(text));
  if (at === -1) return undefined;
  const before = flat.slice(0, at);
  let under;
  let last = -1;
  for (const name of names) {
    const where = before.lastIndexOf(name);
    if (where > last) {
      under = name;
      last = where;
    }
  }
  return under;
}

/** The note that a reason was cut short. */
const SAYS_CUT = /\b(cut|truncated|shortened)\b/i;

// CI's job log has to say why a flow failed: the debug artifact with
// report.xml in it is not always within reach (PR #96, first-admin-invites).
// Maestro's reason may hold the flow's typed values. In CI those are the job's
// synthetic bootstrap code, which the log already prints, in the job's env and
// in the `maestro test -e BOOTSTRAP_CODE=…` line scripts/e2e-android.mjs writes
// before the run, so a reason needs no redaction. Every reason below is plain
// words or a pattern from a flow; the one code-shaped value is made at run time.
describe("judgeReport: a failed flow says why, in Maestro's own words", () => {
  const FLOW_NAMES = ['app-starts', 'first-admin-invites', 'wrong-code'];

  test("INF-06-AC9: a failed flow's reason, the text of its <failure>, shows under the flow's name", () => {
    const reason = 'Element not found: Text matching regex: Opprett invitasjon';

    const result = judgeReport(
      report(
        maestroFlow('app-starts', 'SUCCESS'),
        maestroFlow('first-admin-invites', 'ERROR', { failure: reason }),
        maestroFlow('wrong-code', 'SUCCESS'),
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain(
      '1 of 3 flows failed or did not finish: first-admin-invites (ERROR)',
    );
    expect(result.message).toContain(reason);
    expect(listedUnder(result.message, reason, FLOW_NAMES)).toBe('first-admin-invites');
  });

  test('INF-06-AC9: the reason is read as XML: its entities are decoded, once', () => {
    // &lt;, &amp; and &gt; are what Woodstox writes in element text; &quot; and
    // &#10; are as valid there. &amp;lt; is a reason that holds "&lt;" itself.
    const written =
      'Assertion is false: &quot;Inviter &amp; del&quot; is visible&#10;' +
      'Below: &lt;Medlemmer&gt;, written &amp;lt;b&amp;gt; in the pattern';

    const result = judgeReport(
      report(maestroFlow('first-admin-invites', 'ERROR', { failure: written })),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Assertion is false: "Inviter & del" is visible');
    expect(result.message).toContain('Below: <Medlemmer>, written &lt;b&gt; in the pattern');
    expect(result.message).toMatch(/is visible\s+Below:/);
    expect(result.message).not.toContain('&quot;');
    expect(result.message).not.toContain('&amp;');
    expect(result.message).not.toContain('&#10;');
    expect(result.message).not.toContain('&lt;Medlemmer');
  });

  test("INF-06-AC9: a reason after the flow's <properties>, as Maestro writes a tagged flow, shows too", () => {
    const reason = 'Element not found: Text matching regex: Kode';

    const result = judgeReport(
      report(
        maestroFlow('first-admin-invites', 'ERROR', {
          properties: { tags: 'grp, admin' },
          failure: reason,
        }),
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain(reason);
    expect(listedUnder(result.message, reason, FLOW_NAMES)).toBe('first-admin-invites');
  });

  test('INF-06-AC9: a reason in a `message` attribute, as other JUnit writers put it, shows and is decoded', () => {
    // Woodstox writes a line break in an attribute as &#xa;; &#10; is the same
    // character in decimal.
    const element =
      '<failure message="Element not found: Text matching regex: &quot;Kode&quot; &amp; &lt;navn&gt;' +
      '&#10;second line&#xa;third line" type="MaestroException"/>';

    const result = judgeReport(report(failedWith('first-admin-invites', element)));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Element not found: Text matching regex: "Kode" & <navn>');
    expect(result.message).toMatch(/<navn>\s+second line\s+third line/);
    expect(listedUnder(result.message, 'Element not found: Text matching regex:', FLOW_NAMES)).toBe(
      'first-admin-invites',
    );
    expect(result.message).not.toMatch(/&(quot|amp|lt|gt|#10|#xa);/);
  });

  test('INF-06-AC9: a <failure> with both a `message` attribute and text shows both', () => {
    const element =
      '<failure message="Assertion is false: Kode is visible">' +
      'Waited for the join screen, and it never showed</failure>';

    const result = judgeReport(report(failedWith('first-admin-invites', element)));

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Assertion is false: Kode is visible');
    expect(result.message).toContain('Waited for the join screen, and it never showed');
  });

  test('INF-06-AC9: a reason is shown as Maestro wrote it, typed values and all', () => {
    // Made here, so no code-shaped value sits in this file (RG-07). In CI the
    // value would be the job's synthetic bootstrap code, which the log already
    // shows: see the comment above this block.
    const typed = randomBytes(10).toString('hex').toUpperCase();
    const reason = `Assertion is false: "${typed}" is visible`;

    const result = judgeReport(
      report(maestroFlow('first-admin-invites', 'ERROR', { failure: reason })),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain(reason);
  });
});

describe('judgeReport: with more than one failed flow, each says why', () => {
  const FLOW_NAMES = ['app-starts', 'first-admin-invites', 'wrong-code'];

  test("INF-06-AC9: each failed flow's reason is listed under its own name", () => {
    const appStarts = 'Assertion is false: "TryggHverdag" is visible';
    const firstAdmin = 'Element not found: Text matching regex: Opprett invitasjon';

    const result = judgeReport(
      report(
        maestroFlow('app-starts', 'ERROR', { failure: appStarts }),
        maestroFlow('wrong-code', 'SUCCESS'),
        maestroFlow('first-admin-invites', 'ERROR', { failure: firstAdmin }),
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain(
      '2 of 3 flows failed or did not finish: app-starts (ERROR), first-admin-invites (ERROR)',
    );
    expect(result.message).toContain(appStarts);
    expect(result.message).toContain(firstAdmin);
    expect(listedUnder(result.message, appStarts, FLOW_NAMES)).toBe('app-starts');
    expect(listedUnder(result.message, firstAdmin, FLOW_NAMES)).toBe('first-admin-invites');
    expect(timesIn(result.message, appStarts)).toBe(1);
    expect(timesIn(result.message, firstAdmin)).toBe(1);
  });

  test('INF-06-AC9: a cancelled flow before a failed one gets neither its reason nor a placeholder', () => {
    // The cancelled <testcase> closes itself. The next <failure> in the file
    // belongs to the flow after it.
    const firstAdmin = 'Element not found: Text matching regex: Opprett invitasjon';

    const result = judgeReport(
      report(
        maestroFlow('app-starts', 'CANCELED'),
        maestroFlow('first-admin-invites', 'ERROR', { failure: firstAdmin }),
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain(
      '2 of 2 flows failed or did not finish: app-starts (CANCELED), first-admin-invites (ERROR)',
    );
    expect(result.message).toContain(firstAdmin);
    expect(timesIn(result.message, firstAdmin)).toBe(1);
    expect(listedUnder(result.message, firstAdmin, FLOW_NAMES)).toBe('first-admin-invites');
    expect(result.message).not.toMatch(/\bundefined\b|\bnull\b|\[object /);
  });
});

describe('judgeReport: a long reason is cut, so a stack trace cannot flood the log', () => {
  /** A reason with a synthetic stack trace under it, thousands of characters long. */
  const longReason = (first) =>
    [
      first,
      ...Array.from(
        { length: 120 },
        (_, i) =>
          `\tat maestro.orchestra.Orchestra.step${String(i)}(Orchestra.kt:${String(1000 + i)})`,
      ),
      '\tthe last line of the trace',
    ].join('\n');

  test('INF-06-AC9: a long reason shows its start, then says it was cut', () => {
    const reason = longReason('Element not found: Text matching regex: Opprett invitasjon');
    expect(reason.length).toBeGreaterThan(5_000);

    const result = judgeReport(
      report(maestroFlow('first-admin-invites', 'ERROR', { failure: reason })),
    );

    expect(result.ok).toBe(false);
    expect(squash(result.message)).toContain(squash(reason.slice(0, 400)));
    expect(result.message).not.toContain('the last line of the trace');
    expect(result.message).toMatch(SAYS_CUT);
    expect(result.message.length).toBeLessThan(1_000);
  });

  test("INF-06-AC9: each flow's long reason is cut on its own, so every flow's reason still shows", () => {
    const appStarts = longReason('Assertion is false: "TryggHverdag" is visible');
    const firstAdmin = longReason('Element not found: Text matching regex: Opprett invitasjon');

    const result = judgeReport(
      report(
        maestroFlow('app-starts', 'ERROR', { failure: appStarts }),
        maestroFlow('first-admin-invites', 'ERROR', { failure: firstAdmin }),
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Assertion is false: "TryggHverdag" is visible');
    expect(result.message).toContain('Element not found: Text matching regex: Opprett invitasjon');
    expect(result.message).not.toContain('the last line of the trace');
    expect(result.message.length).toBeLessThan(2_000);
  });

  test('INF-06-AC9: a reason within the limit shows whole, with no note that it was cut', () => {
    // What Maestro 2.10.0 says when first-admin-invites' last assertVisible on
    // the code fails: ElementSelector.description() inside Condition's.
    const code =
      '[0-9A-HJKMNP-TV-Z](\\s+[0-9A-HJKMNP-TV-Z]){4}(\\s*[,.;]\\s*[0-9A-HJKMNP-TV-Z](\\s+[0-9A-HJKMNP-TV-Z]){4}){3}';
    const reason = `Assertion is false: "[0-9A-HJKMNP-TV-Z]{5}", Index: 3, Child of: "Kode:\\s*${code}" is visible`;
    expect(reason.length).toBeLessThan(400);

    const result = judgeReport(
      report(maestroFlow('first-admin-invites', 'ERROR', { failure: reason })),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain(reason);
    expect(result.message).not.toMatch(SAYS_CUT);
  });
});

describe('judgeReport: what has no reason, or passed, says what it said before', () => {
  test('INF-06-AC9: a cancelled flow, which has no <failure>, is reported exactly as before', () => {
    expect(
      judgeReport(
        report(
          maestroFlow('app-starts', 'SUCCESS'),
          maestroFlow('first-admin-invites', 'CANCELED'),
          maestroFlow('wrong-code', 'SUCCESS'),
        ),
      ),
    ).toEqual({
      ok: false,
      message: '1 of 3 flows failed or did not finish: first-admin-invites (CANCELED)',
    });
  });

  test('INF-06-AC9: when every flow passed, the verdict is exactly as before', () => {
    expect(judgeReport(report(maestroFlow('app-starts', 'SUCCESS')))).toEqual({
      ok: true,
      message: '1 of 1 flow passed.',
    });
    expect(
      judgeReport(
        report(
          maestroFlow('app-starts', 'SUCCESS'),
          maestroFlow('first-admin-invites', 'SUCCESS', { properties: { tags: 'grp, admin' } }),
          maestroFlow('wrong-code', 'SUCCESS'),
        ),
      ),
    ).toEqual({ ok: true, message: '3 of 3 flows passed.' });
  });
});

describe('buildPlan: the release build, made on this machine', () => {
  const plan = buildPlan({ root: '/repo' });
  const commands = plan.map((step) => step.command.join(' '));
  const prebuild = commands.findIndex((command) => /\bexpo\b.*\bprebuild\b/.test(command));
  const gradle = commands.findIndex((command) =>
    /\bgradlew?\b.*\b(:app:)?assembleRelease\b/.test(command),
  );

  test('INF-06-AC10: the native project is generated from app.config.ts, fresh each time', () => {
    expect(prebuild).toBeGreaterThan(-1);
    expect(commands[prebuild]).toMatch(/--platform[= ]android\b/);
    expect(commands[prebuild]).toMatch(/--clean\b/);
  });

  test('INF-06-AC10: Gradle then builds the release variant', () => {
    expect(gradle).toBeGreaterThan(prebuild);
  });

  test("INF-06-AC10: for x86_64 alone, the emulator's ABI", () => {
    const abis = /reactNativeArchitectures(?:=|":")([^"\s]+)/.exec(JSON.stringify(plan[gradle]));

    expect(abis?.[1]).toBe('x86_64');
  });

  test('INF-06-AC10: with no EAS, no Expo account and no token', () => {
    const everything = JSON.stringify(plan);

    expect(everything).not.toMatch(/\beas\b/i);
    expect(everything).not.toMatch(/EXPO_TOKEN|EAS_BUILD/);
  });

  test('INF-06-AC10: and never the debug variant, which is not what ships', () => {
    expect(JSON.stringify(plan)).not.toMatch(/assembleDebug|installDebug/);
  });
});

/** The -e KEY=VALUE pairs in a Maestro command line. */
function envOf(argv) {
  const pairs = [];
  argv.forEach((arg, i) => {
    if (arg === '-e' || arg === '--env') pairs.push(argv[i + 1] ?? '');
    else if (arg.startsWith('-e=') || arg.startsWith('--env=')) pairs.push(arg.split(/=(.*)/s)[1]);
  });
  return Object.fromEntries(
    pairs.map((pair) => {
      const at = pair.indexOf('=');
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );
}

/**
 * A pattern as Maestro reads a text selector: a Java regular expression that
 * has to match the element's whole text. JavaScript reads backslash escapes of
 * punctuation the same way; Java's \Q…\E quoting is spelled out first, so the
 * test holds whichever of the two the script uses.
 */
function maestroPattern(pattern) {
  const quoted = pattern.replace(/\\Q([\s\S]*?)(?:\\E|$)/g, (_all, text) =>
    text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&'),
  );
  return new RegExp(`^(?:${quoted})$`);
}

/**
 * The text a Maestro pattern stands for when it is a plain literal, or null
 * when it is not: every character that means something to a regular
 * expression has to be escaped, with a backslash or inside \Q…\E.
 */
function literalOf(pattern) {
  let text = '';
  for (let at = 0; at < pattern.length; at += 1) {
    const char = pattern.charAt(at);
    const next = pattern.charAt(at + 1);
    if (char === '\\' && next === 'Q') {
      const end = pattern.indexOf('\\E', at + 2);
      text += pattern.slice(at + 2, end === -1 ? pattern.length : end);
      at = end === -1 ? pattern.length : end + 1;
    } else if (char === '\\' && next !== '' && !/[A-Za-z0-9]/.test(next)) {
      text += next;
      at += 1;
    } else if ('\\^$.*+?()[]{}|'.includes(char)) {
      return null;
    } else {
      text += char;
    }
  }
  return text;
}

/**
 * How Maestro 2.10.0 reads `${…}` in a flow's string, from its source (tag
 * cli-2.10.0; maestro-orchestra-models, maestro/orchestra/util/Env.kt,
 * String.evaluateScripts, lines 10 to 26):
 *
 *     val result = "(?<!\\\\)\\\$\\{([^\$]*)}".toRegex()
 *         .replace(this) { match ->
 *             val script = match.groups[1]?.value ?: ""
 *             if (script.isNotBlank()) {
 *                 jsEngine.evaluateScript(script).toString()
 *             } else {
 *                 ""
 *             }
 *         }
 *     return result
 *         .replace("\\\\\\\$\\{([^\$]*)}".toRegex()) { match ->
 *             match.value.substringAfter('\\')
 *         }
 *
 * As patterns, (?<!\\)\$\{([^$]*)} and \\\$\{([^$]*)}. The script runs from
 * `${` to the last `}` before the next `$`, greedily, not to the first `}`.
 * GraalJsEngine.kt (maestro-client, maestro/js) runs it as
 * `(function(){ return eval(`…`) })()`, in strict mode, with each -e value as
 * a global. Its context reads an undeclared name as undefined, through a Proxy
 * set as globalThis's prototype. A `\${…}` is kept, less its backslash.
 */
const MAESTRO_SCRIPT = /(?<!\\)\$\{([^$]*)\}/g;
const MAESTRO_ESCAPED_SCRIPT = /\\\$\{([^$]*)\}/g;
/** Where Maestro starts a script: a `${` with no backslash before it. */
const MAESTRO_SCRIPT_START = /(?<!\\)\$\{/;
/** What a flow puts inside `${…}`: a bare name, which Maestro's engine reads as the value passed with -e. */
const BARE_NAME = /^[A-Z_][A-Z0-9_]*$/;

/**
 * A flow's string, `value`, with its `${…}` read as Maestro 2.10.0 reads them
 * (MAESTRO_SCRIPT): a script that is a bare name becomes the value `env` has
 * for it. Anything else would go to Maestro's JavaScript engine, and throws
 * here, naming the script Maestro would run. So does a name no -e passes,
 * which Maestro would read as undefined.
 */
function asMaestroInterpolates(value, env, where) {
  const evaluated = value.replace(MAESTRO_SCRIPT, (_all, script) => {
    if (script.trim() === '') return '';
    if (!BARE_NAME.test(script)) {
      throw new Error(
        `${where}: Maestro would evaluate ${JSON.stringify(script)} as JavaScript, not a bare name, in ${JSON.stringify(value)}`,
      );
    }
    if (env[script] === undefined) {
      throw new Error(`${where} names \${${script}}, which no -e passes`);
    }
    return env[script];
  });
  return evaluated.replace(MAESTRO_ESCAPED_SCRIPT, (all) => all.slice(all.indexOf('\\') + 1));
}

/**
 * Texts that read differently as a pattern, each with a text the unescaped
 * pattern would also match. Kept out of the test.each call because HK-05's
 * test counter stops at the first closing bracket inside one.
 */
const LOOKALIKES = [
  { field: 'JOIN_TITLE', text: 'Hjem (trygt)? Ja+', lookalike: 'Hjem trygt Jaaa' },
  { field: 'NOT_VALID', text: 'Klar? 1+1 er [to].', lookalike: 'Kla 11 er tX' },
  { field: 'MEMBER_TITLE', text: 'Nesten (ferdig', lookalike: 'Nesten ferdig' },
  { field: 'JOIN_TITLE', text: 'a.b*c^d$e|f{2}g\\h', lookalike: 'ffgh' },
];

/**
 * GRP-01 (L7): each value a flow names that is a string of the app's, and the
 * key in nb.json it is read from. RG-03 (GRP-01, the spec's "Existing
 * assertions that change by design", INF-06-AC11's item): TITLE and STATUS
 * were placeholder.title and placeholder.status; a cleared app opens on the
 * join screen now, and the placeholder's keys go, so they are JOIN_TITLE and
 * JOIN_INTRO, the join screen's title and the line under it. BOOTSTRAP_CODE is no string
 * of the app's: the job hands it in, synthetic, as the API's
 * ADMIN_BOOTSTRAP_CODE.
 */
const FLOW_TEXTS = {
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
};

/** A translation file holding `text` at every key a flow reads, unless `except` says otherwise. */
function translationsWith(text, except = {}) {
  const tree = {};
  for (const [field, key] of Object.entries(FLOW_TEXTS)) {
    const parts = key.split('.');
    let node = tree;
    for (const part of parts.slice(0, -1)) {
      node[part] ??= {};
      node = node[part];
    }
    node[parts.at(-1)] = except[field] ?? text;
  }
  return tree;
}

/** The value of a dotted key in a translation file. */
const textAt = (tree, key) => key.split('.').reduce((node, part) => node?.[part], tree);

/**
 * A synthetic bootstrap code, as Terraform makes one: 16 random bytes as 32
 * upper-case hex digits. Made at run time, as RG-07 (synthetic test data)
 * asks: no credential-looking literal is written in a file, because gitleaks
 * (CI's `security` job) reads every committed line. Fixed for the run.
 */
const BOOTSTRAP_CODE = randomBytes(16).toString('hex').toUpperCase();

describe('maestroTestCommand: every flow, with a JUnit report', () => {
  // RG-03 (GRP-01): the translations are the join screen's and the admin's,
  // and the job's bootstrap code is handed in beside them (FLOW_TEXTS). Made
  // in each test, not once for the block, so a command that cannot be made
  // fails the tests that need it and no others.
  const argvOf = () =>
    maestroTestCommand({
      maestro: '/cache/maestro/bin/maestro',
      report: '/tmp/e2e/report.xml',
      appId: 'no.example.placeholder',
      translations: translationsWith('Tittel'),
      bootstrapCode: BOOTSTRAP_CODE,
    });

  test('INF-06-AC9: runs the pinned Maestro over every flow in apps/mobile/e2e', () => {
    const argv = argvOf();
    expect(argv[0]).toBe('/cache/maestro/bin/maestro');
    expect(argv).toContain('test');
    expect(argv.some((arg) => arg.replace(/\/$/, '').endsWith(FLOWS))).toBe(true);
  });

  test('INF-06-AC9: writes the JUnit report the run is judged by', () => {
    const argv = argvOf();
    expect(argv.join(' ')).toMatch(/--format[= ]junit\b/i);
    expect(argv.join(' ')).toMatch(/--output[= ]\/tmp\/e2e\/report\.xml\b/);
  });

  test('INF-06-AC11: passes the flow exactly the values it uses, from nb.json and the application ID', () => {
    // The flow names what it needs as ${NAME}. Anything it names and is not
    // given is the text "undefined" to Maestro, and asserting that it is
    // visible is not a test of the screen. (Was "an empty string": Maestro
    // 2.10.0's own Env.evaluateScripts, run on "Tittel ${NOT_PASSED}", gives
    // "Tittel undefined", because GraalJsEngine.kt reads an undeclared name
    // as undefined.)
    const flowText = readdirSync(FLOWS)
      .filter((name) => /\.ya?ml$/.test(name))
      .map((name) => readFileSync(path.join(FLOWS, name), 'utf8'))
      .join('\n');
    const used = [...new Set([...flowText.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map((m) => m[1]))];
    const nb = JSON.parse(readFileSync(NB, 'utf8'));
    const env = envOf(
      maestroTestCommand({
        maestro: 'maestro',
        report: 'report.xml',
        appId: 'no.example.placeholder',
        translations: nb,
        bootstrapCode: BOOTSTRAP_CODE,
      }),
    );

    expect(Object.keys(env).sort()).toEqual(used.sort());
    expect(env.APP_ID).toBe('no.example.placeholder');
    // RG-03 (GRP-01, INF-06-AC11's item): was TITLE and STATUS, from the
    // placeholder's keys; now every string the flows name, each from its key
    // in nb.json (FLOW_TEXTS), and the job's bootstrap code. The strings
    // arrive escaped for Maestro's regular expressions, so what is compared
    // is the text each one stands for: exactly nb.json's. A string that ends
    // in a full stop, unescaped, would match anything there.
    for (const [field, key] of Object.entries(FLOW_TEXTS)) {
      if (used.includes(field)) {
        expect(typeof textAt(nb, key), key).toBe('string');
        expect(literalOf(env[field] ?? ''), field).toBe(textAt(nb, key));
      }
    }
    expect(env.BOOTSTRAP_CODE).toBe(BOOTSTRAP_CODE);
    expect(used).toEqual(expect.arrayContaining(['JOIN_TITLE', 'BOOTSTRAP_CODE', 'NOT_VALID']));
  });

  // Amended 2026-09-26. Maestro reads a text selector as a regular expression.
  // Unescaped, a title with a bracket, a question mark or a plus also matches
  // text the app does not show, so a flow could pass on the wrong screen; an
  // unbalanced bracket stops the flow with a pattern error instead.
  test.each(LOOKALIKES)(
    'INF-06-AC11: $field arrives escaped, so Maestro matches $text and nothing like it',
    ({ field, text, lookalike }) => {
      const other = 'Vanlig tekst';
      const env = envOf(
        maestroTestCommand({
          maestro: 'maestro',
          report: 'report.xml',
          appId: 'no.example.placeholder',
          translations: translationsWith(other, { [field]: text }),
          bootstrapCode: BOOTSTRAP_CODE,
        }),
      );
      const sent = env[field] ?? '';

      expect(literalOf(sent)).toBe(text);
      expect(maestroPattern(sent).test(text)).toBe(true);
      expect(maestroPattern(sent).test(lookalike)).toBe(false);
    },
  );
});

describe('the flows themselves', () => {
  test('INF-06-AC9: there is a flow, and none can pass without checking: no retry, no optional step', () => {
    const flows = readdirSync(FLOWS).filter((name) => /\.ya?ml$/.test(name));

    expect(flows.length).toBeGreaterThan(0);
    for (const name of flows) {
      const text = readFileSync(path.join(FLOWS, name), 'utf8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
      expect(text, `${name} retries a step`).not.toMatch(/^\s*-?\s*retry\s*:/m);
      expect(text, `${name} has an optional step`).not.toMatch(/optional\s*:\s*true/);
    }
  });

  // PR #96's android-e2e (job 118918227742): Maestro takes a `${…}` up to the
  // last `}` before the next `$` (MAESTRO_SCRIPT), so a `${NAME}` followed by
  // a pattern's {4} became one script, and the flow stopped on a SyntaxError
  // at that step on every run. A string with no `${` is not evaluated, and
  // may hold braces. Each flow writes one value per line, in block style, so
  // a line is a string here.
  test('INF-06-AC11: no string in a flow holds a ${…} beside any other brace, so Maestro reads each ${…} as a bare name', () => {
    const flows = readdirSync(FLOWS).filter((name) => /\.ya?ml$/.test(name));
    const read = [];
    const found = [];
    for (const name of flows) {
      readFileSync(path.join(FLOWS, name), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (line.trimStart().startsWith('#') || !MAESTRO_SCRIPT_START.test(line)) return;
          read.push(`${name}:${String(i + 1)}`);
          const scripts = [...line.matchAll(MAESTRO_SCRIPT)].map((match) => match[1]);
          const outsideNames = line.replace(/(?<!\\)\$\{[A-Z_][A-Z0-9_]*\}/g, '');
          if (/[{}]/.test(outsideNames) || !scripts.every((script) => BARE_NAME.test(script))) {
            found.push({ at: `${name}:${String(i + 1)}`, scripts });
          }
        });
    }

    expect(read.length, 'no flow names a ${…}, so nothing was checked').toBeGreaterThan(0);
    expect(
      found,
      'Maestro would evaluate these scripts as JavaScript: write the braces out, or move the value to a string of its own',
    ).toEqual([]);
  });
});

/**
 * GRP-01-AC28 (review loop 2): labels that do not begin with the code field's
 * own name and a colon, each with the code spelled in them as the screen
 * spells it. Kept out of the test.each call, as LOOKALIKES is.
 */
const LABEL_STARTS = [
  {
    case: 'the name with no colon',
    text: ({ codeLabel, spelled }) => `${codeLabel} ${spelled}`,
  },
  {
    case: 'the name after the code',
    text: ({ codeLabel, spelled }) => `${spelled}: ${codeLabel}`,
  },
  {
    case: 'a word before the name',
    text: ({ codeLabel, spelled }) => `Ny ${codeLabel}: ${spelled}`,
  },
  {
    case: 'the name field’s label in its place',
    text: ({ spelled }) =>
      `${String(textAt(JSON.parse(readFileSync(NB, 'utf8')), 'grp.join.nameLabel'))}: ${spelled}`,
  },
  {
    case: 'the English name, which a bokmål phone does not show',
    text: ({ spelled }) =>
      `${String(textAt(JSON.parse(readFileSync(EN, 'utf8')), 'grp.join.codeLabel'))}: ${spelled}`,
  },
];

// GRP-01-AC28 (L7, review loop 1): the invite screen shows the code as four
// Texts of five, inside one element whose screen-reader label spells it
// character by character, group by group, so no element holds the whole code
// as text, and first-admin-invites.yaml finds it by that label and by the
// groups drawn inside it. L7 runs only where an emulator does, so the flow's
// patterns are held here, as Maestro reads them: the whole text, any case.
// The code is synthetic (RG-07), the L5 test's; the label is spelled as the
// screen spells it, and as the L5 test reads it, with a comma, full stop or
// semicolon between groups.
//
// RG-03 (GRP-01-AC28, review loop 2, a11y-i18n-reviewer S1; the spec's "Added
// in review loop 2"): the label now begins with the code field's own name,
// grp.join.codeLabel, and a colon ("Invitasjonskode: K 7 Q 2 M, ..."), and the
// flow's pattern begins with ${CODE_LABEL}, which the script passes in. So
// the flow's values are read as Maestro reads them, each ${NAME} replaced by
// what maestroTestCommand passes, from nb.json; and every text the tests
// below match or refuse carries the name and the colon first (`labelled`),
// so each refusal is still of the code's shape, not of a missing name. What
// they prove is unchanged: twenty of Crockford's characters, in four groups
// of five. The tests after them pin the new start.
describe('GRP-01-AC28: first-admin-invites finds the code by its spelled label and its drawn groups', () => {
  const CODE = 'K7Q2M-9TRVX-4HNPA-62WZE';
  /** The code as the screen's label spells it: each character apart, `between` between groups. */
  const spelled = (code, between = ', ') =>
    code
      .replace(/[^0-9A-Za-z]/g, '')
      .match(/.{1,5}/g)
      .map((group) => Array.from(group).join(' '))
      .join(between);
  const nb = () => JSON.parse(readFileSync(NB, 'utf8'));
  /** The code field's own name, grp.join.codeLabel, as nb.json has it. */
  const codeLabel = () => String(textAt(nb(), 'grp.join.codeLabel'));
  /** A text as the code's label holds it since review loop 2: the code field's name, a colon, a space, then `text`. */
  const labelled = (text) => `${codeLabel()}: ${text}`;
  /** Maestro 2.10.0 matches a text selector against the whole text, ignoring case. */
  const asMaestroReads = (pattern) => new RegExp(maestroPattern(pattern).source, 'is');
  /** What the script passes the flows with -e, from nb.json, as Maestro gets it. */
  const flowEnv = () =>
    envOf(
      maestroTestCommand({
        maestro: 'maestro',
        report: 'report.xml',
        appId: 'no.example.placeholder',
        translations: nb(),
        bootstrapCode: BOOTSTRAP_CODE,
      }),
    );
  /**
   * Every single-quoted value of the flow's steps, comments left out, with
   * its `${…}` read as Maestro 2.10.0 reads them (asMaestroInterpolates): a
   * bare name becomes the value the script passes for it. A name the script
   * does not pass throws, because Maestro would read it as undefined. So does
   * a `${` whose script, by Maestro's rule, runs past its name.
   *
   * RG-03 (INF-06-AC11, PR #96's android-e2e, job 118918227742): this replaced
   * each `${NAME}` up to its own `}`, which Maestro does not do. Maestro takes
   * everything up to the last `}` before the next `$`. So these tests passed a
   * flow whose two label steps Maestro could not run: it took
   * `CODE_LABEL}:\s*…{4}){3` as one script.
   */
  const patterns = () => {
    const env = flowEnv();
    return [
      ...readFileSync(path.join(FLOWS, 'first-admin-invites.yaml'), 'utf8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n')
        .matchAll(/'((?:[^']|'')*)'/g),
    ].map((match) =>
      asMaestroInterpolates(match[1].replaceAll("''", "'"), env, 'first-admin-invites.yaml'),
    );
  };
  const matching = (text) => patterns().filter((p) => asMaestroReads(p).test(text));

  test('GRP-01-AC28: a step of the flow matches the label the screen spells, the code field’s name and a colon first, with a comma, full stop or semicolon between groups', () => {
    for (const between of [', ', '. ', '; ']) {
      expect(matching(labelled(spelled(CODE, between))), JSON.stringify(between)).not.toEqual([]);
    }
  });

  test.each([
    { case: 'the code as one text, hyphens between groups', text: CODE },
    { case: 'the code as one text, spaces between groups', text: CODE.replaceAll('-', ' ') },
    { case: 'three groups', text: spelled('K7Q2M-9TRVX-4HNPA') },
    { case: 'five groups', text: spelled(`${CODE}-ABCDE`) },
    { case: 'a group of six', text: 'K 7 Q 2 M, 9 T R V X Y, 4 H N P A, 6 2 W Z E' },
    { case: 'twenty-one characters', text: spelled(`${CODE}Q`) },
    { case: 'no pause between groups', text: spelled(CODE, ' ') },
    { case: 'an I, which is not Crockford', text: spelled('K7Q2M-9TRVX-4HNPA-62WZI') },
    { case: 'an L', text: spelled('K7Q2L-9TRVX-4HNPA-62WZE') },
    { case: 'an O', text: spelled('K7Q2M-9TOVX-4HNPA-62WZE') },
    { case: 'a U', text: spelled('K7Q2M-9TRVX-4HNUA-62WZE') },
  ])('GRP-01-AC28: every step that matches the spelled label refuses $case', ({ text }) => {
    const label = patterns().filter((p) => asMaestroReads(p).test(labelled(spelled(CODE))));

    expect(label.length).toBeGreaterThan(0);
    for (const pattern of label) {
      expect({ pattern, matches: asMaestroReads(pattern).test(labelled(text)) }).toEqual({
        pattern,
        matches: false,
      });
    }
  });

  test('GRP-01-AC28: a step of the flow matches a drawn group, five of Crockford’s characters and nothing else', () => {
    const groups = CODE.split('-');
    const drawn = patterns().filter((p) => groups.every((group) => asMaestroReads(p).test(group)));

    expect(drawn.length).toBeGreaterThan(0);
    for (const pattern of drawn) {
      for (const text of [
        'K7Q2',
        'K7Q2M9',
        'K7Q 2',
        'K7Q2L',
        spelled(CODE),
        CODE,
        labelled(spelled(CODE)),
      ]) {
        expect({ pattern, text, matches: asMaestroReads(pattern).test(text) }).toEqual({
          pattern,
          text,
          matches: false,
        });
      }
    }
  });

  // GRP-01-AC28, review loop 2: the label's start, pinned. A label that does
  // not begin with the code field's own name and a colon is refused by every
  // step that matches the labelled code, and no step matches the code spelled
  // with nothing before it, as the label read before this loop: a step left
  // with the old pattern would wait for a label the screen no longer gives.
  test('GRP-01-AC28: no step of the flow matches the code spelled with no name before it, the label as it read before review loop 2', () => {
    for (const between of [', ', '. ', '; ']) {
      expect(matching(spelled(CODE, between)), JSON.stringify(between)).toEqual([]);
    }
  });

  test.each(LABEL_STARTS)(
    'GRP-01-AC28: every step that matches the labelled code refuses $case',
    ({ text }) => {
      const label = patterns().filter((p) => asMaestroReads(p).test(labelled(spelled(CODE))));
      const refused = text({ codeLabel: codeLabel(), spelled: spelled(CODE) });

      expect(label.length).toBeGreaterThan(0);
      expect(refused).toMatch(/K 7 Q 2 M/);
      for (const pattern of label) {
        expect({ pattern, refused, matches: asMaestroReads(pattern).test(refused) }).toEqual({
          pattern,
          refused,
          matches: false,
        });
      }
    },
  );
});

describe('the pinned Maestro', () => {
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

  test('INF-06-AC9: is an exact version with a hash to check it against, never "latest"', () => {
    expect(MAESTRO_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(MAESTRO_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("INF-06-AC9: comes from Maestro's own release of that version", () => {
    expect(maestroUrl()).toMatch(
      /^https:\/\/github\.com\/mobile-dev-inc\/maestro\/releases\/download\//i,
    );
    expect(maestroUrl()).toContain(MAESTRO_VERSION);
  });

  test('INF-06-AC9: a download that does not match the pinned hash is refused, and nothing is unpacked', async () => {
    const archive = Buffer.from('not the archive that was pinned');

    expect(sha256(archive)).not.toBe(MAESTRO_SHA256);
    await expect(
      ensureMaestro({
        root: scratch(),
        fetchArchive: () => Promise.resolve(archive),
        extract: () => {
          throw new Error('must not unpack an archive that failed its check');
        },
      }),
    ).rejects.toThrow(/does not match/);
  });

  // Maestro ships as a folder: a launcher under bin/ that starts the jars
  // under lib/. The whole folder has to arrive, or the launcher has nothing to
  // start. pinned-binary.mjs unpacks a single binary and a folder the same way,
  // and these hold that way from outside, through ensureMaestro.

  /** What unzipping Maestro's archive leaves: the launcher and the jars beside it. */
  const unpackMaestro = (_archive, into) => {
    mkdirSync(path.join(into, 'maestro', 'bin'), { recursive: true });
    mkdirSync(path.join(into, 'maestro', 'lib'), { recursive: true });
    writeFileSync(path.join(into, 'maestro', 'bin', 'maestro'), '#!/bin/sh\necho 2.10.0\n');
    writeFileSync(path.join(into, 'maestro', 'lib', 'maestro-cli.jar'), 'pretend jar');
  };

  test('INF-06-AC9: a download that matches is unpacked whole, launcher and jars, and the launcher can be run', async () => {
    const root = scratch();
    const archive = Buffer.from('pretend maestro.zip');

    const maestro = await ensureMaestro({
      root,
      sha256: sha256(archive),
      fetchArchive: () => Promise.resolve(archive),
      extract: unpackMaestro,
    });
    const home = path.dirname(path.dirname(maestro));

    expect(maestro.startsWith(root)).toBe(true);
    expect(maestro).toContain(MAESTRO_VERSION);
    expect(maestro.endsWith(path.join('maestro', 'bin', 'maestro'))).toBe(true);
    expect(statSync(maestro).mode & 0o111).not.toBe(0);
    expect(readFileSync(path.join(home, 'lib', 'maestro-cli.jar'), 'utf8')).toBe('pretend jar');
    // The tool and nothing else: the downloaded archive is not kept beside it.
    expect(readdirSync(path.dirname(home))).toEqual(['maestro']);
  });

  test('INF-06-AC9: once it is there, it is not downloaded again', async () => {
    const root = scratch();
    const archive = Buffer.from('pretend maestro.zip');
    let downloads = 0;
    const options = {
      root,
      sha256: sha256(archive),
      fetchArchive: () => {
        downloads += 1;
        return Promise.resolve(archive);
      },
      extract: unpackMaestro,
    };

    const first = await ensureMaestro(options);
    const second = await ensureMaestro(options);

    expect(second).toBe(first);
    expect(downloads).toBe(1);
  });

  test('INF-06-AC9: what an interrupted run left, with no launcher in it, is replaced rather than mixed in', async () => {
    // A stray jar left beside the new ones would be on Maestro's classpath.
    const root = scratch();
    const archive = Buffer.from('pretend maestro.zip');
    const first = await ensureMaestro({
      root,
      sha256: sha256(archive),
      fetchArchive: () => Promise.resolve(archive),
      extract: unpackMaestro,
    });
    const home = path.dirname(path.dirname(first));
    rmSync(first);
    writeFileSync(path.join(home, 'lib', 'left-over.jar'), 'from an interrupted run');

    const maestro = await ensureMaestro({
      root,
      sha256: sha256(archive),
      fetchArchive: () => Promise.resolve(archive),
      extract: unpackMaestro,
    });

    expect(existsSync(maestro)).toBe(true);
    expect(readdirSync(path.join(home, 'lib'))).toEqual(['maestro-cli.jar']);
  });
});
