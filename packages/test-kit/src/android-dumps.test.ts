// req-coverage: fixtures-only — the builders of the emulator's dumps, not a requirement's proof.
import { describe, expect, test } from 'vitest';
import {
  DIALER_PACKAGE,
  appWindow,
  callRecord,
  dialerWindow,
  dialledEvents,
  maskedAddress,
  roleHoldersOutput,
  telecomDump,
  windowDump,
} from './android-dumps.ts';

const NUMBER = '+447700900318';

describe('the emulator’s dumps, as the L7 script reads them', () => {
  test('a masked address keeps the number’s length and only its last two characters', () => {
    const masked = maskedAddress(NUMBER);

    expect(masked).toBe(`tel:${'*'.repeat(NUMBER.length - 2)}18`);
    expect(masked.slice(4)).toHaveLength(NUMBER.length);
    expect(masked).not.toContain(NUMBER.slice(0, -2));
  });

  test('Telecom’s dump ends its head with "Historical Events:", and holds each call’s record after it, in order', () => {
    const address = maskedAddress(NUMBER);
    const first = callRecord({ id: 1, address, events: dialledEvents('a.b', address) });
    const second = callRecord({ id: 2, address, events: dialledEvents('c.d', address) });
    const lines = telecomDump([first, second]).split('\n');
    const heading = lines.indexOf('Historical Events:');

    expect(heading).toBeGreaterThan(0);
    expect(lines.slice(heading + 1, heading + 1 + first.length)).toEqual(first);
    expect(lines.join('\n')).toContain('CREATED (c.d;');
    expect(lines.findIndex((line) => line.includes('CallTC@2/'))).toBeGreaterThan(
      lines.findIndex((line) => line.includes('CallTC@1/')),
    );
    expect(telecomDump([])).toMatch(/Historical Events:\n$/);
  });

  test('the window dump names the focused window; the role output names one package per line', () => {
    expect(windowDump(appWindow('a.b'))).toContain(
      'mCurrentFocus=Window{9c8b7a6 u0 a.b/a.b.MainActivity}',
    );
    expect(windowDump(dialerWindow())).toContain(
      `mCurrentFocus=Window{4f3b2a1 u0 ${DIALER_PACKAGE}/`,
    );
    expect(roleHoldersOutput([DIALER_PACKAGE])).toBe(`${DIALER_PACKAGE}\n`);
    expect(roleHoldersOutput([])).toBe('');
  });
});
