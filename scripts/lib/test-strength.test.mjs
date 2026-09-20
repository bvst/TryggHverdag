// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// RG-03 is the gate that stops "make the test pass" from meaning "make the test
// check less", so its arithmetic is tested directly.
import { describe, expect, test } from 'vitest';
import { strengthOf, weakenings } from './test-strength.mjs';

const BEFORE = `
describe('LOST-02', () => {
  test('LOST-02-AC1: silence opens an alert', () => {
    expect(alert.state).toBe('OPEN');
    expect(responder.notified).toBe(true);
  });
  test('LOST-02-AC2: a heartbeat resolves it', () => {
    expect(alert.state).toBe('RESOLVED');
  });
});
`;

describe('strengthOf', () => {
  test('counts tests, assertions and anything switched off', () => {
    expect(strengthOf(BEFORE)).toEqual({ tests: 2, assertions: 3, skips: 0 });
  });

  test('counts a table-driven test once, as written', () => {
    const source = "test.each([[1], [2]])('LOST-02-AC1: %s', (n) => { expect(n).toBe(n); });";
    expect(strengthOf(source).tests).toBe(1);
  });

  test('sees the ways a test can be switched off', () => {
    const source = "it.skip('a', () => {}); test.only('b', () => {}); xit('c', () => {});";
    expect(strengthOf(source).skips).toBe(3);
  });

  test('counts end-to-end assertions too, which do not use expect()', () => {
    expect(strengthOf('- assertVisible: "Jeg er hjemme"').assertions).toBe(1);
  });
});

describe('weakenings', () => {
  test('a skipped test, which also stops counting as a test', () => {
    const after = BEFORE.replace("test('LOST-02-AC2", "test.skip('LOST-02-AC2");
    expect(weakenings(BEFORE, after)).toEqual([
      'skipped, focused or todo tests were added',
      'the number of tests went down',
    ]);
  });

  test('a deleted test takes its assertion with it, and both are reported', () => {
    const after = BEFORE.split("  test('LOST-02-AC2")[0] + '});\n';
    expect(weakenings(BEFORE, after)).toEqual([
      'the number of tests went down',
      'the number of assertions went down',
    ]);
  });

  test('a removed assertion', () => {
    const after = BEFORE.replace('    expect(responder.notified).toBe(true);\n', '');
    expect(weakenings(BEFORE, after)).toEqual(['the number of assertions went down']);
  });

  test('a deleted test file is the strongest form of weakening', () => {
    expect(weakenings(BEFORE, '').length).toBe(2);
  });

  test('adding tests is not weakening', () => {
    const after = BEFORE.replace(
      '});\n',
      "  test('LOST-02-AC3: escalation', () => {\n    expect(sms.sent).toBe(true);\n  });\n});\n",
    );
    expect(weakenings(BEFORE, after)).toEqual([]);
  });

  test('rewriting a test without losing checks is not weakening', () => {
    expect(weakenings(BEFORE, BEFORE.replaceAll('toBe(', 'toStrictEqual('))).toEqual([]);
  });
});
