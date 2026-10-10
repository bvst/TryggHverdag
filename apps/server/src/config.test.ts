// What a server process needs from its environment, and what it refuses to
// start without. A process that starts with no database would answer every
// request with an error and look, from the outside, like a working deploy —
// so a missing or malformed setting stops it before anything listens.
import {
  SYNTHETIC_CHECK_UUID as CHECK,
  SYNTHETIC_PING_URL as PING_URL,
  fc,
  syntheticCredential,
  syntheticPingUrl,
  syntheticUuid,
} from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_PORT,
  readCanarySetting,
  readHealthchecksCanarySetting,
  readHealthchecksSetting,
  readHealthchecksSmsSetting,
  readServerConfig,
  type HealthchecksSetting,
} from './config.ts';

const DATABASE = 'postgres://example-user@db.example.invalid:5432/staging';

describe('readServerConfig', () => {
  test('reads the database from DATABASE_URL', () => {
    expect(readServerConfig({ DATABASE_URL: DATABASE }).databaseUrl).toBe(DATABASE);
  });

  test('falls back to POSTGRESQL_ADDON_URI, which Clever Cloud injects for a linked database', () => {
    expect(readServerConfig({ POSTGRESQL_ADDON_URI: DATABASE }).databaseUrl).toBe(DATABASE);
  });

  test('DATABASE_URL wins when both are set, so the platform default can be overridden', () => {
    const config = readServerConfig({
      DATABASE_URL: DATABASE,
      POSTGRESQL_ADDON_URI: 'postgres://other@db.example.invalid/elsewhere',
    });

    expect(config.databaseUrl).toBe(DATABASE);
  });

  test('an empty DATABASE_URL counts as unset rather than as a database called ""', () => {
    const config = readServerConfig({ DATABASE_URL: '', POSTGRESQL_ADDON_URI: DATABASE });

    expect(config.databaseUrl).toBe(DATABASE);
  });

  test('refuses to start without a database, naming every variable it looked for', () => {
    expect(() => readServerConfig({})).toThrow(/DATABASE_URL.*POSTGRESQL_ADDON_URI/);
  });

  test('listens on 8080 when PORT is unset — the port Clever Cloud sends traffic to', () => {
    expect(DEFAULT_PORT).toBe(8080);
    expect(readServerConfig({ DATABASE_URL: DATABASE }).port).toBe(8080);
  });

  test('reads PORT', () => {
    expect(readServerConfig({ DATABASE_URL: DATABASE, PORT: '9000' }).port).toBe(9000);
  });

  test('accepts port 0, which asks the operating system for any free port', () => {
    expect(readServerConfig({ DATABASE_URL: DATABASE, PORT: '0' }).port).toBe(0);
  });

  test.each(['8080abc', '-1', '65536', '80.5', ' ', 'eighty'])(
    'refuses PORT=%j rather than guessing what was meant',
    (port) => {
      expect(() => readServerConfig({ DATABASE_URL: DATABASE, PORT: port })).toThrow(/PORT/);
    },
  );

  test('an empty PORT counts as unset', () => {
    expect(readServerConfig({ DATABASE_URL: DATABASE, PORT: '' }).port).toBe(DEFAULT_PORT);
  });
});

// INF-08: where the worker checks in with Healthchecks.io. The one setting that
// breaks the rule above, on purpose: a monitoring setting must never stop the
// watchdog it watches, or put it in a crash loop. So a missing or unusable
// value is not an error but a reason — which the worker writes once at start —
// and the value itself never appears in it: anyone holding a ping URL can keep
// the check green while the worker is dead.

// CHECK is the UUID of a ping URL, all zeros so it names no real check, and
// PING_URL a usable https: one; both from the test kit. Nothing is fetched here.

/** The reason a setting gives for not checking in. Fails the test if it would check in. */
function reasonOf(setting: HealthchecksSetting): string {
  expect(setting.checkingIn).toBe(false);
  return setting.checkingIn ? '' : setting.reason;
}

describe('readHealthchecksSetting', () => {
  test('INF-08-AC6: a usable https: address means checking in, at exactly that address', () => {
    expect(readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: PING_URL })).toEqual({
      checkingIn: true,
      url: PING_URL,
    });
  });

  test.each([
    ['unset', {}],
    ['empty', { HEALTHCHECKS_WORKER_URL: '' }],
    ['an http: address', { HEALTHCHECKS_WORKER_URL: `http://hc-ping.com/${CHECK}` }],
    ['not an address at all', { HEALTHCHECKS_WORKER_URL: `hc-ping.com/${CHECK}` }],
    ['another scheme', { HEALTHCHECKS_WORKER_URL: `ftp://hc-ping.com/${CHECK}` }],
  ])(
    'INF-08-AC6: %s means not checking in, with a reason that names the variable — never a throw',
    (_what, env: Record<string, string>) => {
      const setting = readHealthchecksSetting(env);

      expect(reasonOf(setting)).toContain('HEALTHCHECKS_WORKER_URL');
      // The value is dropped, not carried along: nothing downstream can print
      // what the setting does not hold.
      expect(JSON.stringify(setting)).not.toContain(CHECK);
    },
  );

  test('INF-08-AC6: the reason says which is wrong: unset, not https:, or not an address', () => {
    const [unset, http, notAnAddress] = [
      {},
      { HEALTHCHECKS_WORKER_URL: `http://hc-ping.com/${CHECK}` },
      { HEALTHCHECKS_WORKER_URL: `hc-ping.com/${CHECK}` },
    ].map((env) => reasonOf(readHealthchecksSetting(env)));

    expect(new Set([unset, http, notAnAddress]).size).toBe(3);
    // http: would send the secret in clear text; the reason should say what is wanted instead.
    expect(http).toContain('https');
  });

  test('INF-08-AC6: an empty value counts as unset, as every other setting here does', () => {
    expect(readHealthchecksSetting({ HEALTHCHECKS_WORKER_URL: '' })).toEqual(
      readHealthchecksSetting({}),
    );
  });

  test('INF-08-AC6: reads HEALTHCHECKS_WORKER_URL and nothing else', () => {
    // Clever Cloud gives the API and the worker the same environment; another
    // variable that happens to hold a ping URL is not this setting.
    expect(
      readHealthchecksSetting({ DATABASE_URL: PING_URL, HEALTHCHECKS_URL: PING_URL }).checkingIn,
    ).toBe(false);
  });
});

// LOST-07-AC11: where the SMS check reports. The same rules as the worker's
// check-in (D-079): never a throw, a reason that names the variable and never
// the value, and only https:. A setting of its own: the worker's check-in and
// the SMS check are two checks, and one address must never stand in for the
// other.

describe('readHealthchecksSmsSetting', () => {
  test('LOST-07-AC11: a usable https: address means reporting, at exactly that address', () => {
    expect(readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: PING_URL })).toEqual({
      checkingIn: true,
      url: PING_URL,
    });
  });

  test.each([
    ['unset', {}],
    ['empty', { HEALTHCHECKS_SMS_URL: '' }],
    ['an http: address', { HEALTHCHECKS_SMS_URL: `http://hc-ping.com/${CHECK}` }],
    ['not an address at all', { HEALTHCHECKS_SMS_URL: `hc-ping.com/${CHECK}` }],
    ['another scheme', { HEALTHCHECKS_SMS_URL: `ftp://hc-ping.com/${CHECK}` }],
  ])(
    'LOST-07-AC11: %s means not reporting, with a reason that names the variable and never the value — never a throw',
    (_what, env: Record<string, string>) => {
      const setting = readHealthchecksSmsSetting(env);

      expect(reasonOf(setting)).toContain('HEALTHCHECKS_SMS_URL');
      expect(JSON.stringify(setting)).not.toContain(CHECK);
    },
  );

  test('LOST-07-AC11: the reason says which is wrong: unset, not https:, or not an address', () => {
    const [unset, http, notAnAddress] = [
      {},
      { HEALTHCHECKS_SMS_URL: `http://hc-ping.com/${CHECK}` },
      { HEALTHCHECKS_SMS_URL: `hc-ping.com/${CHECK}` },
    ].map((env) => reasonOf(readHealthchecksSmsSetting(env)));

    expect(new Set([unset, http, notAnAddress]).size).toBe(3);
    expect(http).toContain('https');
  });

  test('LOST-07-AC11: an empty value counts as unset', () => {
    expect(readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: '' })).toEqual(
      readHealthchecksSmsSetting({}),
    );
  });

  test('LOST-07-AC11: reads HEALTHCHECKS_SMS_URL and nothing else: not the worker’s check-in address, and the worker’s setting does not read it either', () => {
    expect(
      readHealthchecksSmsSetting({ HEALTHCHECKS_WORKER_URL: PING_URL, HEALTHCHECKS_URL: PING_URL })
        .checkingIn,
    ).toBe(false);
    expect(readHealthchecksSetting({ HEALTHCHECKS_SMS_URL: PING_URL }).checkingIn).toBe(false);
  });

  test('LOST-07-AC11: no reason says Healthchecks.io, so INF-08’s count of the worker’s lines that do keeps its meaning', () => {
    for (const env of [
      {},
      { HEALTHCHECKS_SMS_URL: `http://hc-ping.com/${CHECK}` },
      { HEALTHCHECKS_SMS_URL: `hc-ping.com/${CHECK}` },
    ]) {
      expect(reasonOf(readHealthchecksSmsSetting(env))).not.toContain('Healthchecks.io');
    }
  });
});

// LOST-07 review loop 1 (safety-reviewer, REL-07, D-079). A URL with a query,
// a fragment or a trailing slash still names the same check, so each is
// refused at start, with a reason of its own: each check then has one
// spelling, and the two settings can be compared (D-116). Since loop 1 the SMS
// check's alarm builds /fail on the URL's path (adapters/healthchecks.ts), so
// none of them misplaces /fail any more; for the failure signal the refusal is
// a second guard. The worker's setting is refused alike, so the two addresses
// are read by one rule.

describe('LOST-07: a ping URL with a query, a fragment or a trailing slash is refused at start, so each check has one spelling', () => {
  const RID = syntheticUuid();
  /** A ping key as Healthchecks.io's slug form carries one: credential-like, never a real one (RG-07). */
  const PING_KEY = syntheticCredential().slice(0, 22);

  test.each([
    ['HEALTHCHECKS_SMS_URL', readHealthchecksSmsSetting],
    ['HEALTHCHECKS_WORKER_URL', readHealthchecksSetting],
  ] as const)(
    'LOST-07-AC11: %s with a query, a fragment or a trailing slash is refused, each with a reason of its own that names the variable and never the value; the plain ping URL is still taken',
    (variable, read) => {
      const refused = {
        query: [`https://hc-ping.com/${CHECK}?rid=${RID}`, `https://hc-ping.com/${CHECK}?`],
        fragment: [`https://hc-ping.com/${CHECK}#${RID}`, `https://hc-ping.com/${CHECK}#`],
        'trailing slash': [`https://hc-ping.com/${CHECK}/`],
      };
      const reasons = new Map<string, string>();
      for (const [what, values] of Object.entries(refused)) {
        for (const value of values) {
          const setting = read({ [variable]: value });

          expect(setting.checkingIn, value).toBe(false);
          const reason = setting.checkingIn ? '' : setting.reason;
          expect(reason, value).toContain(variable);
          expect(JSON.stringify(setting), value).not.toContain(CHECK);
          expect(JSON.stringify(setting), value).not.toContain(RID);
          reasons.set(what, reason);
        }
      }
      // Each its own reason, and none of the reasons for unset, not a URL or
      // not https:, nor the one-spelling rule's (review loop 2). The slug form
      // has no query, no fragment and no trailing slash, so only that general
      // rule refuses it (review loop 3): a trailing slash that fell through to
      // the general rule would still be refused, but with its own reason gone.
      const others = [
        {},
        { [variable]: `http://hc-ping.com/${CHECK}` },
        { [variable]: `hc-ping.com/${CHECK}` },
        { [variable]: `https://hc-ping.com/${PING_KEY}/staging-worker` },
      ].map((env) => reasonOf(read(env)));
      expect(new Set([...reasons.values(), ...others]).size).toBe(reasons.size + others.length);

      expect(read({ [variable]: `https://hc-ping.com/${CHECK}` })).toEqual({
        checkingIn: true,
        url: `https://hc-ping.com/${CHECK}`,
      });
    },
  );
});

// LOST-07 review loop 2 (safety-reviewer should-fix 1, D-116 amended): one
// spelling per check. "Different" compared spellings, not checks.
// Healthchecks.io reads /<uuid> and /<uuid>/ as one success ping, and the slug
// form (/<ping-key>/<slug>) names a check its UUID also names; and the URL
// parser drops a leading or trailing space, a tab or a newline, reads a
// backslash as a slash, and lower-cases the host, so a value and the address
// fetched can differ. Any of them as the SMS secret could keep the worker's
// check green while the watchdog was down, and the SMS check would never be
// pinged. So a ping URL is taken only when the value is exactly its own parsed
// spelling and its path is / and a lower-case UUID. Any https: host stays
// allowed, as in INF-08, so tests keep their loopback address.

describe('LOST-07: one spelling per check', () => {
  // Fresh each run (RG-07), and the markers no refusal may hold. The UUID
  // starts with a letter, so it has an upper-case spelling, and a percent-
  // encoded one of that letter; the ping key is credential-like, as a real
  // one is.
  const check = `a${syntheticUuid().slice(1)}`;
  const pingKey = syntheticCredential().slice(0, 22);
  const HOST = 'https://hc-ping.com';

  const refused: readonly (readonly [string, string])[] = [
    ['a trailing slash', `${HOST}/${check}/`],
    ['a trailing space', `${HOST}/${check} `],
    ['a trailing tab', `${HOST}/${check}\t`],
    ['a trailing newline', `${HOST}/${check}\n`],
    ['a trailing backslash', `${HOST}/${check}\\`],
    ['a leading space', ` ${HOST}/${check}`],
    ['an upper-case UUID', `${HOST}/${check.toUpperCase()}`],
    ['a percent-encoded character in the UUID', `${HOST}/%61${check.slice(1)}`],
    // The UUID's length is part of its one spelling (review loop 3): its last
    // group one hex digit short, or one long.
    ['a UUID one hex digit too short', `${HOST}/${check.slice(0, -1)}`],
    ['a UUID one hex digit too long', `${HOST}/${check}0`],
    ['the slug form, /<ping-key>/<slug>', `${HOST}/${pingKey}/staging-worker`],
    ['an upper-case host', `https://HC-PING.COM/${check}`],
    ['a path of two segments, the UUID first', `${HOST}/${check}/fail`],
    ['a path of two segments, the UUID second', `${HOST}/ping/${check}`],
    // The marker in the host here, as the path is empty: any https: host is taken.
    ['an empty path', `https://${check}.hc-ping.com`],
  ];

  /**
   * Whether `text` holds any marker: the UUID in any case or spelling, or the
   * ping key. The UUID's marker leaves out its first digit, which the
   * percent-encoded spelling changes, and its last, which the UUID one digit
   * too short drops (review loop 3), so every refused value holds it.
   */
  const holdsAMarker = (text: string) =>
    [check.slice(1, -1), pingKey].some((marker) =>
      text.toLowerCase().includes(marker.toLowerCase()),
    );

  describe.each([
    ['HEALTHCHECKS_WORKER_URL', readHealthchecksSetting],
    ['HEALTHCHECKS_SMS_URL', readHealthchecksSmsSetting],
  ] as const)('%s', (variable, read) => {
    test.each(refused)(
      `LOST-07-AC11: ${variable} with %s is refused, with a reason that names the variable and never the value`,
      (_what, value) => {
        expect(holdsAMarker(value), 'the value holds a marker').toBe(true);

        const setting = read({ [variable]: value });

        expect(setting.checkingIn).toBe(false);
        expect(setting.checkingIn ? '' : setting.reason).toContain(variable);
        expect(holdsAMarker(JSON.stringify(setting))).toBe(false);
      },
    );

    test(`LOST-07-AC11: ${variable} takes a ping URL on any https: host whose path is / and a lower-case UUID, at exactly that address: hc-ping.com, the test kit’s loopback address and localhost`, () => {
      for (const value of [
        `${HOST}/${check}`,
        PING_URL,
        syntheticPingUrl(check),
        `https://localhost:1/${check}`,
      ]) {
        expect(read({ [variable]: value }), value).toEqual({ checkingIn: true, url: value });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// REL-10: the staging canary's three settings (the spec's approach items 9
// and 10). Each is read once, never throws, and is never written out: a
// refusal names the variable, never the value. CANARY_API_URL is where the
// canary calls the public API, an https: origin and nothing else, since the
// client sends its credential there; CANARY_CREDENTIAL is the canary device's
// credential, 43 or more base64url characters, as Terraform's random_password
// makes it (letters and digits); HEALTHCHECKS_CANARY_URL is the canary's own
// check, read by the ping-URL rule the other two checks are read by (D-116).
// None of them may stop the worker (D-079): worker.test.ts holds that.
// ---------------------------------------------------------------------------

/** Staging's origin, as Terraform sets CANARY_API_URL from the vhost. */
const STAGING_API = 'https://trygg-hverdag-staging.cleverapps.io';

/** The reason a canary setting gives for not running. Fails the test if it would run. */
function canaryReasonOf(setting: ReturnType<typeof readCanarySetting>): string {
  expect(setting.running).toBe(false);
  return setting.running ? '' : setting.reason;
}

describe('REL-10: readCanarySetting', () => {
  test('REL-10-AC13: an https: origin and a credential of 43 base64url characters mean the canary runs, with exactly those values', () => {
    const credential = syntheticCredential();

    expect(
      readCanarySetting({ CANARY_API_URL: STAGING_API, CANARY_CREDENTIAL: credential }),
    ).toEqual({ running: true, apiUrl: STAGING_API, credential });
  });

  test('REL-10-AC13: it takes an origin with a port, a credential longer than 43 characters, and one of letters and digits only, as Terraform makes it', () => {
    const port = 'https://127.0.0.1:8443';
    const long = `${syntheticCredential()}${syntheticCredential()}`;
    const lettersAndDigits = syntheticCredential().replace(/[-_]/g, 'a');

    expect(readCanarySetting({ CANARY_API_URL: port, CANARY_CREDENTIAL: long })).toEqual({
      running: true,
      apiUrl: port,
      credential: long,
    });
    expect(
      readCanarySetting({ CANARY_API_URL: STAGING_API, CANARY_CREDENTIAL: lettersAndDigits }),
    ).toEqual({ running: true, apiUrl: STAGING_API, credential: lettersAndDigits });
  });

  /** A host that holds a marker of its own, made at run time (RG-07), and names nothing real. */
  const marker = syntheticUuid();
  const HOST = `canary-${marker}.invalid`;

  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['an http: address', `http://${HOST}`],
    ['another scheme', `ftp://${HOST}`],
    ['not an address at all', HOST],
    ['a path', `https://${HOST}/v1`],
    ['a query', `https://${HOST}?probe=${marker}`],
    ['an empty query', `https://${HOST}?`],
    ['a fragment', `https://${HOST}#${marker}`],
    ['user info', `https://${marker}:secret@${HOST}`],
    ['an upper-case host, which is not its own spelling', `https://${HOST.toUpperCase()}`],
    ['the default port written out, which is not its own spelling', `https://${HOST}:443`],
    ['a trailing space', `https://${HOST} `],
    ['a leading space', ` https://${HOST}`],
    ['a backslash', `https:\\${HOST}`],
  ])(
    'REL-10-AC13: CANARY_API_URL %s means not running, with a reason that names the variable and never the value; never a throw',
    (_what, value) => {
      const setting = readCanarySetting({
        ...(value === undefined ? {} : { CANARY_API_URL: value }),
        CANARY_CREDENTIAL: syntheticCredential(),
      });

      expect(canaryReasonOf(setting)).toContain('CANARY_API_URL');
      expect(JSON.stringify(setting).toLowerCase()).not.toContain(marker);
    },
  );

  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['one character too short', () => syntheticCredential().slice(0, 42)],
    ['holding a plus', () => `${syntheticCredential().slice(0, 42)}+`],
    ['holding a slash', () => `${syntheticCredential().slice(0, 42)}/`],
    ['padded with =', () => `${syntheticCredential()}=`],
    ['holding a space', () => `${syntheticCredential().slice(0, 21)} ${syntheticCredential()}`],
    ['holding a full stop', () => `${syntheticCredential()}.`],
    ['holding a letter outside ASCII', () => `${syntheticCredential()}æ`],
    ['ending in a newline', () => `${syntheticCredential()}\n`],
  ])(
    'REL-10-AC13: CANARY_CREDENTIAL %s means not running, with a reason that names the variable and never the value; never a throw',
    (_what, make) => {
      const value = typeof make === 'function' ? make() : make;
      const setting = readCanarySetting({
        CANARY_API_URL: STAGING_API,
        ...(value === undefined ? {} : { CANARY_CREDENTIAL: value }),
      });

      expect(canaryReasonOf(setting)).toContain('CANARY_CREDENTIAL');
      if (value !== undefined && value.length > 8) {
        expect(JSON.stringify(setting)).not.toContain(value.slice(0, 8));
      }
    },
  );

  test('REL-10-AC13: with both unset, it does not run, and its reason names a variable it read', () => {
    expect(canaryReasonOf(readCanarySetting({}))).toMatch(/\bCANARY_(?:API_URL|CREDENTIAL)\b/);
  });

  test('REL-10-AC13: it reads CANARY_API_URL and CANARY_CREDENTIAL and nothing else: a URL or a credential under another name is not the canary’s', () => {
    const credential = syntheticCredential();

    expect(readCanarySetting({ API_URL: STAGING_API, CANARY_CREDENTIAL: credential }).running).toBe(
      false,
    );
    expect(
      readCanarySetting({ CANARY_API_URL: STAGING_API, DEVICE_CREDENTIAL: credential }).running,
    ).toBe(false);
  });

  test('REL-10-AC13: for any values of the two variables it never throws, and never holds a refused value in its reason', () => {
    fc.assert(
      fc.property(
        fc.option(fc.string({ maxLength: 80 }), { nil: undefined }),
        fc.option(fc.string({ minLength: 0, maxLength: 80 }), { nil: undefined }),
        (url, credential) => {
          const env: Record<string, string> = {};
          if (url !== undefined) env['CANARY_API_URL'] = url;
          if (credential !== undefined) env['CANARY_CREDENTIAL'] = credential;
          const setting = readCanarySetting(env);
          if (!setting.running && credential !== undefined && credential.length >= 12) {
            expect(setting.reason).not.toContain(credential);
          }
        },
      ),
    );
  });

  test('REL-10-AC13: no reason says Healthchecks.io, so INF-08’s count of the worker’s lines that do keeps its meaning', () => {
    for (const env of [
      {},
      { CANARY_API_URL: `http://${HOST}`, CANARY_CREDENTIAL: syntheticCredential() },
      { CANARY_API_URL: STAGING_API, CANARY_CREDENTIAL: 'short' },
    ]) {
      expect(canaryReasonOf(readCanarySetting(env))).not.toContain('Healthchecks.io');
    }
  });
});

describe('REL-10: readHealthchecksCanarySetting', () => {
  test('REL-10-AC13: a usable https: address means reporting, at exactly that address', () => {
    expect(readHealthchecksCanarySetting({ HEALTHCHECKS_CANARY_URL: PING_URL })).toEqual({
      checkingIn: true,
      url: PING_URL,
    });
    expect(
      readHealthchecksCanarySetting({ HEALTHCHECKS_CANARY_URL: `https://hc-ping.com/${CHECK}` }),
    ).toEqual({ checkingIn: true, url: `https://hc-ping.com/${CHECK}` });
  });

  const check = `a${syntheticUuid().slice(1)}`;

  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['an http: address', `http://hc-ping.com/${check}`],
    ['not an address at all', `hc-ping.com/${check}`],
    ['a query', `https://hc-ping.com/${check}?rid=1`],
    ['a fragment', `https://hc-ping.com/${check}#1`],
    ['a trailing slash', `https://hc-ping.com/${check}/`],
    ['an upper-case UUID', `https://hc-ping.com/${check.toUpperCase()}`],
    ['the slug form', `https://hc-ping.com/${syntheticCredential().slice(0, 22)}/staging-canary`],
    ['a path of two segments', `https://hc-ping.com/${check}/fail`],
  ])(
    'REL-10-AC13: HEALTHCHECKS_CANARY_URL %s, refused by the ping-URL rule the other checks are read by, means not reporting, with a reason that names the variable and never the value',
    (_what, value) => {
      const setting = readHealthchecksCanarySetting(
        value === undefined ? {} : { HEALTHCHECKS_CANARY_URL: value },
      );

      expect(reasonOf(setting)).toContain('HEALTHCHECKS_CANARY_URL');
      expect(JSON.stringify(setting).toLowerCase()).not.toContain(check.slice(1, -1));
    },
  );

  test('REL-10-AC13: the same value read by each of the three settings is judged alike, each naming its own variable', () => {
    for (const value of [
      PING_URL,
      `http://hc-ping.com/${check}`,
      `https://hc-ping.com/${check}/`,
    ]) {
      const canary = readHealthchecksCanarySetting({ HEALTHCHECKS_CANARY_URL: value });
      const sms = readHealthchecksSmsSetting({ HEALTHCHECKS_SMS_URL: value });

      expect(canary.checkingIn, value).toBe(sms.checkingIn);
      if (!canary.checkingIn && !sms.checkingIn) {
        expect(canary.reason.replaceAll('HEALTHCHECKS_CANARY_URL', 'X')).toBe(
          sms.reason.replaceAll('HEALTHCHECKS_SMS_URL', 'X'),
        );
      }
    }
  });

  test('REL-10-AC13: it reads HEALTHCHECKS_CANARY_URL and nothing else, and the other two settings do not read it', () => {
    expect(
      readHealthchecksCanarySetting({
        HEALTHCHECKS_WORKER_URL: PING_URL,
        HEALTHCHECKS_SMS_URL: PING_URL,
        HEALTHCHECKS_URL: PING_URL,
      }).checkingIn,
    ).toBe(false);
    expect(readHealthchecksSetting({ HEALTHCHECKS_CANARY_URL: PING_URL }).checkingIn).toBe(false);
    expect(readHealthchecksSmsSetting({ HEALTHCHECKS_CANARY_URL: PING_URL }).checkingIn).toBe(
      false,
    );
  });

  test('REL-10-AC13: no reason says Healthchecks.io', () => {
    for (const env of [{}, { HEALTHCHECKS_CANARY_URL: `http://hc-ping.com/${check}` }]) {
      expect(reasonOf(readHealthchecksCanarySetting(env))).not.toContain('Healthchecks.io');
    }
  });
});
