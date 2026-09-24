// What a server process needs from its environment, and what it refuses to
// start without. A process that starts with no database would answer every
// request with an error and look, from the outside, like a working deploy —
// so a missing or malformed setting stops it before anything listens.
import { describe, expect, test } from 'vitest';
import { DEFAULT_PORT, readServerConfig } from './config.ts';

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
