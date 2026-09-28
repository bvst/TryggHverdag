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

// INF-10-AC17 (D-082): the pattern also sees conditional, chained and in-body
// skips, each of which switches tests off with every count unchanged. Every
// form below is put together at run time: written out, each would count toward
// this file's own skips, and tests:changes would refuse the pull request that
// adds it: Approach 6.
const SKIP = ['sk', 'ip'].join('');
const ONLY = ['on', 'ly'].join('');
const TODO = ['to', 'do'].join('');
const TEST = ['te', 'st'].join('');
const EXPECT = ['exp', 'ect'].join('');
const on = (...parts) => parts.join('.');

/** `form` used the way a test file uses it: on a titled callback. */
const used = (form) => `${form}('a', () => {});`;

/** Forms D-082 adds: conditional ones, and a skip, focus or todo behind another modifier. */
const WIDENED = [
  ['a conditional skip on describe', `${on('describe', `${SKIP}If`)}(true)`],
  ['a conditional skip on a test', `${on(TEST, `${SKIP}If`)}(process.platform === 'win32')`],
  ['a conditional skip on it', `${on('it', `${SKIP}If`)}(true)`],
  ['a conditional run on describe', `${on('describe', `run${'If'}`)}(false)`],
  ['a conditional run on a test', `${on(TEST, `run${'If'}`)}(Boolean(process.env.NEVER))`],
  ['a conditional run on it', `${on('it', `run${'If'}`)}(false)`],
  ['a skip behind concurrent, on describe', on('describe', 'concurrent', SKIP)],
  ['a skip behind concurrent, on a test', on(TEST, 'concurrent', SKIP)],
  ['a skip behind sequential, on it', on('it', 'sequential', SKIP)],
  ['a skip behind two modifiers', on('describe', 'shuffle', 'concurrent', SKIP)],
  ['a focus behind concurrent, on a test', on(TEST, 'concurrent', ONLY)],
  ['a focus behind concurrent, on describe', on('describe', 'concurrent', ONLY)],
  ['a todo behind concurrent, on it', on('it', 'concurrent', TODO)],
];

/** The skip call from a test's body, whatever its context is named. */
const IN_BODY = [
  ['ctx', `${TEST}('a', (ctx) => {\n  ${on('ctx', SKIP)}();\n});`],
  [
    'context, with a reason',
    `${TEST}('a', (context) => {\n  ${on('context', SKIP)}('later');\n});`,
  ],
  ['t', `${TEST}('a', (t) => {\n  ${on('t', SKIP)}();\n});`],
  ['a destructured one', `${TEST}('a', ({ ${SKIP} }) => {\n  ${SKIP}();\n});`],
  [
    'ctx, behind a condition',
    `${TEST}('a', (ctx) => {\n  if (!process.env.READY) ${on('ctx', SKIP)}();\n});`,
  ],
];

/** Forms counted before D-082: each still counts. */
const TODAY = [
  on('it', SKIP),
  on(TEST, SKIP),
  on('describe', SKIP),
  on('it', ONLY),
  on(TEST, ONLY),
  on('describe', ONLY),
  on('it', TODO),
  on(TEST, TODO),
  on('describe', TODO),
  `x${'it'}`,
  `x${TEST}`,
  `x${'describe'}`,
  `f${'it'}`,
  `f${'describe'}`,
];

/** Names that only contain those words: none switches a test off. */
const NOT_SWITCHES = [
  `${SKIP}IfMissing('docker', () => {});`,
  `run${'If'}Ready(task);`,
  `const ${SKIP}ped = results.filter((each) => each.${SKIP}ped);`,
  `should${'Skip'}();`,
  `options.${SKIP} = true;`,
  `${TEST}('never ${SKIP}s a step', () => {});`,
];

describe('INF-10-AC17: the widened skip pattern', () => {
  test.each(WIDENED)('INF-10-AC17: %s counts as switching a test off, once', (_, form) => {
    expect(strengthOf(used(form)).skips).toBe(1);
  });

  test.each(IN_BODY)(
    "INF-10-AC17: a call to the context's skip, as %s, counts as switching a test off, once",
    (_, source) => {
      expect(strengthOf(source).skips).toBe(1);
    },
  );

  test.each(TODAY)('INF-10-AC17: %s, counted before D-082, still counts, once', (form) => {
    expect(strengthOf(used(form)).skips).toBe(1);
  });

  test.each(NOT_SWITCHES)('INF-10-AC17: %s does not count', (source) => {
    expect(strengthOf(source).skips).toBe(0);
  });

  test('INF-10-AC17: weakenings reports tests switched off by each new form, with every other count unchanged', () => {
    const before = [
      "describe('DEMO-01', () => {",
      `  ${TEST}('DEMO-01-AC1: a synthetic check', () => {`,
      `    ${EXPECT}(1).toBe(1);`,
      '  });',
      '});',
      '',
    ].join('\n');
    const switchedOff = [
      ...WIDENED.filter(([, form]) => form.startsWith('describe')).map(([, form]) =>
        before.replace("describe('DEMO-01'", `${form}('DEMO-01'`),
      ),
      before.replace("check', () => {\n", `check', (ctx) => {\n    ${on('ctx', SKIP)}();\n`),
    ];

    expect(switchedOff.every((after) => after !== before)).toBe(true);
    for (const after of switchedOff) {
      expect(weakenings(before, after), after).toEqual([
        'skipped, focused or todo tests were added',
      ]);
    }
  });
});
