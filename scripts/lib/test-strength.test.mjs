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
    expect(strengthOf(BEFORE)).toEqual({ tests: 2, assertions: 3, skips: 0, inverted: 0 });
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

// D-082 item 5 (the owner's sixth answer, 2026-09-29): the same forms on
// `suite`, on any test object, and through bracket access, and tests inverted
// to expect failure, which are counted on their own and said in their own
// words. Put together at run time, like every form above.
const FAILS = ['fa', 'ils'].join('');
const FAILING = ['fa', 'iling'].join('');

/** What weakenings says of a skip, and of a test inverted to expect failure. */
const SKIPPED = 'skipped, focused or todo tests were added';
const INVERTED = `tests were inverted to expect failure (.${FAILS} or .${FAILING})`;

/** The same forms on suite, Vitest's other name for describe. */
const ON_SUITE = [
  on('suite', SKIP),
  on('suite', ONLY),
  on('suite', TODO),
  `${on('suite', `${SKIP}If`)}(true)`,
  `${on('suite', `run${'If'}`)}(false)`,
  on('suite', 'concurrent', ONLY),
];

/** The same forms on any test object, such as one made with test.extend. */
const ON_ANY_TEST = [
  on('myTest', SKIP),
  on('myTest', ONLY),
  on('myTest', TODO),
  `${on('anyName', `${SKIP}If`)}(true)`,
  `${on('anyName', `run${'If'}`)}(false)`,
  on('myTest', 'concurrent', ONLY),
  `${on('myTest', 'sequential', `${SKIP}If`)}(true)`,
];

/** The same forms through bracket access, in each kind of quote. */
const BRACKETED = [
  `${TEST}['${SKIP}']`,
  `describe["${ONLY}"]`,
  `it[\`${TODO}\`]`,
  `suite['${SKIP}If'](true)`,
  `myTest['run${'If'}'](false)`,
  `${on(TEST, 'concurrent')}['${ONLY}']`,
];

/** Behind two modifiers or more: each counts once. */
const DEEP = [
  on('describe', 'shuffle', 'concurrent', ONLY),
  `${on(TEST, 'concurrent', 'sequential', `${SKIP}If`)}(true)`,
];

/** A test inverted to expect failure, on test, it or any test object, and through bracket access. */
const INVERTED_FORMS = [
  on(TEST, FAILS),
  on('it', FAILS),
  on(TEST, 'concurrent', FAILS),
  on('myTest', FAILS),
  on(TEST, FAILING),
  on('it', FAILING),
  `${TEST}['${FAILS}']`,
  `it["${FAILING}"]`,
];

/** Names that only contain those words, from this repository's own tests and others: none inverts a test. */
const NOT_INVERTED = [
  `if (database.${FAILING} === 'time') {`,
  `database.${FAILING} = null;`,
  `${EXPECT}(summary.${FAILS}).toBe(0);`,
  `const count = report.${FAILING}Tests.length;`,
  `retry.${FAILS}afe();`,
];

/** Two synthetic tests, each checking one thing. */
const DEMO = [
  "describe('DEMO-01', () => {",
  `  ${TEST}('DEMO-01-AC1: a synthetic check', () => {`,
  `    ${EXPECT}(1).toBe(1);`,
  '  });',
  `  ${TEST}('DEMO-01-AC2: another synthetic check', () => {`,
  `    ${EXPECT}(2).toBe(2);`,
  '  });',
  '});',
  '',
].join('\n');

/** DEMO with its first test's name made `form`. */
const firstAs = (form) => DEMO.replace(`${TEST}('DEMO-01-AC1`, `${form}('DEMO-01-AC1`);

describe('INF-10-AC17: suite, any test object, bracket access, and tests inverted to expect failure', () => {
  test.each(ON_SUITE)('INF-10-AC17: %s, on suite, counts as switching a test off, once', (form) => {
    expect(strengthOf(used(form)).skips).toBe(1);
  });

  test.each(ON_ANY_TEST)(
    'INF-10-AC17: %s, on a test object of any name, counts as switching a test off, once',
    (form) => {
      expect(strengthOf(used(form)).skips).toBe(1);
    },
  );

  test.each(BRACKETED)(
    'INF-10-AC17: %s, through bracket access, counts as switching a test off, once',
    (form) => {
      expect(strengthOf(used(form)).skips).toBe(1);
    },
  );

  test.each(DEEP)('INF-10-AC17: %s, behind two modifiers, counts once', (form) => {
    expect(strengthOf(used(form)).skips).toBe(1);
  });

  test('INF-10-AC17: a call to a longer lowercase name that only ends in the word, un and the word joined, does not count', () => {
    expect(strengthOf(`un${SKIP}(x);`)).toMatchObject({ skips: 0 });
  });

  test.each(INVERTED_FORMS)(
    'INF-10-AC17: %s counts as a test inverted to expect failure, once, and not as a skip',
    (form) => {
      expect(strengthOf(used(form))).toMatchObject({ skips: 0, inverted: 1 });
    },
  );

  test('INF-10-AC17: a test both focused and inverted counts once as each', () => {
    expect(strengthOf(used(on(TEST, ONLY, FAILING)))).toMatchObject({ skips: 1, inverted: 1 });
  });

  test.each(NOT_INVERTED)('INF-10-AC17: %s inverts nothing', (source) => {
    expect(strengthOf(source)).toMatchObject({ skips: 0, inverted: 0 });
  });

  test('INF-10-AC17: nothing inverted in a file counts as 0 inverted', () => {
    expect(strengthOf(DEMO)).toEqual({ tests: 2, assertions: 2, skips: 0, inverted: 0 });
  });

  test('INF-10-AC17: weakenings reports a test inverted to expect failure in its own words, after any skip and before the counts', () => {
    for (const form of [on(TEST, FAILS), on('it', FAILING)]) {
      expect(weakenings(DEMO, firstAs(form)), form).toEqual([
        INVERTED,
        'the number of tests went down',
      ]);
    }
    const both = firstAs(on(TEST, FAILS)).replace(
      `${TEST}('DEMO-01-AC2`,
      `${on(TEST, SKIP)}('DEMO-01-AC2`,
    );

    expect(weakenings(DEMO, both)).toEqual([SKIPPED, INVERTED, 'the number of tests went down']);
  });

  test('INF-10-AC17: a skip keeps its own words, and is never called inverted', () => {
    expect(weakenings(DEMO, firstAs(on(TEST, SKIP)))).toEqual([
      SKIPPED,
      'the number of tests went down',
    ]);
  });

  test('INF-10-AC17: weakenings reports tests switched off by a suite, test-object or bracket form, with every other count unchanged', () => {
    for (const form of [...ON_SUITE, ...ON_ANY_TEST, ...BRACKETED, ...DEEP]) {
      const after = DEMO.replace("describe('DEMO-01'", `${form}('DEMO-01'`);

      expect(after, form).not.toBe(DEMO);
      expect(weakenings(DEMO, after), form).toEqual([SKIPPED]);
    }
  });

  test('INF-10-AC17: an unchanged inverted test is not reported again', () => {
    const inverted = firstAs(on(TEST, FAILS));

    expect(weakenings(inverted, inverted)).toEqual([]);
  });
});
