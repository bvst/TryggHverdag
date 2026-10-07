// What a server process needs from its environment, and what it refuses to
// start without. A process that starts with no database would answer every
// request with an error and look, from the outside, like a working deploy —
// so a missing or malformed setting stops it before anything listens.
import {
  SYNTHETIC_CHECK_UUID as CHECK,
  SYNTHETIC_PING_URL as PING_URL,
} from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_PORT,
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
