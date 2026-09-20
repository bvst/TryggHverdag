// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-07: secrets, real personal data and location logging never reach the
// repository (PRIV-07, RG-07). The examples below are invented for these tests.
import { describe, expect, test } from 'vitest';
import { ALLOWED, BLOCKED, edit, runHook } from './test-helpers.mjs';

const scan = (file, content) => runHook('scan-sensitive.mjs', { input: edit(file, content) });

const FAKE_NUMBER = ['+47', '912', '34', '567'].join(' ');

describe('HK-07: secrets', () => {
  test('blocks a private key', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----';
    const result = scan('apps/server/src/config.ts', key);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('private key');
  });

  test('blocks a hard-coded key and points at the secret store', () => {
    const result = scan('apps/server/src/push.ts', 'const apiKey = "abcd1234abcd1234abcd";');
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('secret');
  });

  test('allows a key that is read from the environment', () => {
    const line = 'const apiKey = process.env.PUSH_API_KEY;';
    expect(scan('apps/server/src/push.ts', line).status).toBe(ALLOWED);
  });
});

describe('HK-07: location in logs (PRIV-07)', () => {
  test('blocks logging a position', () => {
    const line = 'logger.info({ latitude, longitude }, "heartbeat");';
    const result = scan('apps/server/src/modules/journeys/heartbeat.ts', line);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('PRIV-07');
  });

  test('allows logging without a position', () => {
    const line = 'logger.info({ journeyId }, "heartbeat");';
    expect(scan('apps/server/src/modules/journeys/heartbeat.ts', line).status).toBe(ALLOWED);
  });
});

describe('HK-07: real-looking personal data (RG-07)', () => {
  test('blocks a Norwegian mobile number in ordinary code', () => {
    const result = scan('apps/server/src/modules/identity/sms.ts', `send("${FAKE_NUMBER}")`);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('RG-07');
  });

  test('allows it in the one file that may hold invented numbers', () => {
    const fixtures = 'packages/test-kit/src/fixtures/phone-numbers.ts';
    const result = scan(fixtures, `export const numbers = ["${FAKE_NUMBER}"];`);
    expect(result.status).toBe(ALLOWED);
  });
});

describe('HK-07: edits that carry no new text', () => {
  test('pass through', () => {
    const result = runHook('scan-sensitive.mjs', {
      input: { tool_name: 'Edit', tool_input: { file_path: 'a.ts' } },
    });
    expect(result.status).toBe(ALLOWED);
  });

  test('an Edit is scanned through new_string as well as content', () => {
    const result = runHook('scan-sensitive.mjs', {
      input: {
        tool_name: 'Edit',
        tool_input: {
          file_path: 'apps/server/src/push.ts',
          new_string: 'const token = "abcd1234abcd1234abcd";',
        },
      },
    });
    expect(result.status).toBe(BLOCKED);
  });
});
