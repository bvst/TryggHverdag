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
  MAESTRO_SHA256,
  MAESTRO_VERSION,
  buildPlan,
  checkDevices,
  checkJava,
  checkLocale,
  checkMaestro,
  ensureMaestro,
  judgeReport,
  maestroTestCommand,
  maestroUrl,
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
