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
import { createHash } from 'node:crypto';
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
  waitForLocale,
} from './e2e-android.mjs';

const FLOWS = 'apps/mobile/e2e';
const NB = 'apps/mobile/src/shared/translations/nb.json';

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
// signatures, and for nothing else. It waits for the device: a failed flow is
// still never retried, which the test of the flows further down holds.
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
 * The two signatures seen while the package manager was not ready, and only
 * those. The third is run 8's exception on another of PackageManagerInternal's
 * methods: what counts is a NullPointerException there, not which call it hit.
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
 * Texts that read differently as a pattern, each with a text the unescaped
 * pattern would also match. Kept out of the test.each call because HK-05's
 * test counter stops at the first closing bracket inside one.
 */
const LOOKALIKES = [
  { field: 'TITLE', text: 'Hjem (trygt)? Ja+', lookalike: 'Hjem trygt Jaaa' },
  { field: 'STATUS', text: 'Klar? 1+1 er [to].', lookalike: 'Kla 11 er tX' },
  { field: 'STATUS', text: 'Nesten (ferdig', lookalike: 'Nesten ferdig' },
  { field: 'TITLE', text: 'a.b*c^d$e|f{2}g\\h', lookalike: 'ffgh' },
];

describe('maestroTestCommand: every flow, with a JUnit report', () => {
  const translations = { placeholder: { title: 'Tittel', status: 'Statuslinje' } };
  const argv = maestroTestCommand({
    maestro: '/cache/maestro/bin/maestro',
    report: '/tmp/e2e/report.xml',
    appId: 'no.example.placeholder',
    translations,
  });

  test('INF-06-AC9: runs the pinned Maestro over every flow in apps/mobile/e2e', () => {
    expect(argv[0]).toBe('/cache/maestro/bin/maestro');
    expect(argv).toContain('test');
    expect(argv.some((arg) => arg.replace(/\/$/, '').endsWith(FLOWS))).toBe(true);
  });

  test('INF-06-AC9: writes the JUnit report the run is judged by', () => {
    expect(argv.join(' ')).toMatch(/--format[= ]junit\b/i);
    expect(argv.join(' ')).toMatch(/--output[= ]\/tmp\/e2e\/report\.xml\b/);
  });

  test('INF-06-AC11: passes the flow exactly the values it uses, from nb.json and the application ID', () => {
    // The flow names what it needs as ${NAME}. Anything it names and is not
    // given is an empty string to Maestro, and asserting that an empty string
    // is visible is not a test of the screen.
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
      }),
    );

    expect(Object.keys(env).sort()).toEqual(used.sort());
    expect(env.APP_ID).toBe('no.example.placeholder');
    // TITLE and STATUS arrive escaped for Maestro's regular expressions, so
    // what is compared is the text each one stands for: exactly nb.json's.
    // The status line ends in a full stop, which unescaped matches anything.
    expect(literalOf(env.TITLE ?? '')).toBe(nb.placeholder.title);
    expect(literalOf(env.STATUS ?? '')).toBe(nb.placeholder.status);
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
          translations: {
            placeholder: {
              title: field === 'TITLE' ? text : other,
              status: field === 'STATUS' ? text : other,
            },
          },
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
