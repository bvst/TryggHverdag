// SPIKE-01: the results renderer (analysis/results.mjs). It writes the summary
// and the numbers of the results document from the analysis's output. It uses
// only the three verdict words, and it refuses anything shaped like a
// coordinate or a phone number, because the repository is public.
//
// The coordinate-shaped numbers and the phone number below are made up (the
// number is from Ofcom's range reserved for drama); each test expects them to
// be refused.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const renderResults = async (input) => (await import('./results.mjs')).renderResults(input);

const NOT_SHOWN = 'not shown on simulators';
const cell = (verdict, valid = 2, invalid = 0) => ({ verdict, valid, invalid });
const SUMMARY = [
  { scenario: 'S1', android: cell('passed', 2, 1), ios: cell('failed') },
  { scenario: 'S6', android: cell('passed'), ios: cell(NOT_SHOWN, 0, 0) },
  { scenario: 'S8', outsideGoNoGo: true, android: cell('passed'), ios: cell('passed') },
];
const NUMBERS = [
  {
    scenario: 'S1',
    platform: 'android',
    run: 'S1-android-1',
    name: 'largest gap',
    value: 61.2,
    unit: 's',
  },
  { scenario: 'S1', platform: 'ios', run: 'S1-ios-2', name: 'gaps over 120 s', value: 1, unit: '' },
];

/** A valid input, changed by `change`. */
function input(change = () => {}) {
  const copy = { summary: structuredClone(SUMMARY), numbers: structuredClone(NUMBERS) };
  change(copy);
  return copy;
}

/** The first table row whose first cell is `first`: the summary comes before the numbers. */
function row(markdown, first) {
  return (
    markdown
      .split('\n')
      .find((line) => line.trim().startsWith('|') && line.split('|')[1]?.trim() === first) ?? ''
  );
}

const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError];
/** The error of a deliberate refusal: not a missing module, and not a programming error. */
async function refusal(promise, why) {
  let caught = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught !== null, `${why}: it was accepted`);
  assert.ok(
    caught.code !== 'ERR_MODULE_NOT_FOUND' &&
      !PROGRAMMING_ERRORS.some((type) => caught instanceof type),
    `${why}: it broke instead of refusing (${caught.name}: ${caught.message})`,
  );
  return caught;
}

test('SPIKE-01-AC14: writes each verdict as passed, failed or not shown on simulators, with its valid and invalid runs', async () => {
  const markdown = await renderResults(input());
  const s1 = row(markdown, 'S1');
  assert.match(s1, /\bpassed\b/);
  assert.match(s1, /\bfailed\b/);
  assert.match(s1, /\b2 valid\b/);
  assert.match(s1, /\b1 invalid\b/);
  assert.ok(row(markdown, 'S6').includes(NOT_SHOWN), 'the "not shown" verdict is missing');
});

test('SPIKE-01-AC14: any other verdict word is refused', async () => {
  for (const word of ['pass', 'ok', 'not shown', 'invalid', 'passed with caveats', '', undefined]) {
    await refusal(
      renderResults(
        input((copy) => {
          copy.summary[0].android.verdict = word;
        }),
      ),
      `the verdict "${word}"`,
    );
  }
});

test('SPIKE-01-AC14: every "not shown" says it will be shown at L9', async () => {
  const markdown = await renderResults(input());
  assert.match(row(markdown, 'S6'), /\bL9\b/);
});

test('SPIKE-01-AC14: every number is written with the run it came from, and a number without one is refused', async () => {
  const lines = (await renderResults(input())).split('\n');
  const gap = lines.find((line) => line.includes('61.2')) ?? '';
  assert.ok(gap.includes('S1-android-1'), 'the largest gap is not tied to its run');
  const over = lines.find((line) => line.includes('gaps over 120 s')) ?? '';
  assert.ok(over.includes('S1-ios-2'), 'the count of gaps is not tied to its run');

  await refusal(
    renderResults(
      input((copy) => {
        delete copy.numbers[0].run;
      }),
    ),
    'a number with no run',
  );
  await refusal(
    renderResults(
      input((copy) => {
        copy.numbers[0].run = '';
      }),
    ),
    'a number with an empty run',
  );
});

test('SPIKE-01-AC14: a number shaped like a coordinate is refused, and the refusal does not repeat it', async () => {
  const shapes = [
    ['a value', (copy) => (copy.numbers[0].value = 12.34567), '34567'],
    ['a negative value', (copy) => (copy.numbers[0].value = -45.67891), '67891'],
    ['a name', (copy) => (copy.numbers[1].name = 'moved to 0.1357913'), '1357913'],
  ];
  for (const [where, change, digits] of shapes) {
    const error = await refusal(renderResults(input(change)), `a coordinate in ${where}`);
    assert.equal(
      error.message.includes(digits),
      false,
      `the refusal repeats the coordinate in ${where}`,
    );
  }
});

test('SPIKE-01-AC14: ordinary numbers are written as they are', async () => {
  const values = [120, 118.25, 2_700_000, 0.5, 99.999];
  const markdown = await renderResults(
    input((copy) => {
      copy.numbers = values.map((value, i) => ({
        scenario: 'S1',
        platform: 'android',
        run: `S1-android-${i + 1}`,
        name: `figure ${i + 1}`,
        value,
        unit: 's',
      }));
    }),
  );
  for (const value of values) {
    assert.ok(markdown.includes(String(value)), `${value} is missing`);
  }
});

test('SPIKE-01-AC14: a phone number is refused, and the refusal does not repeat it', async () => {
  const error = await refusal(
    renderResults(
      input((copy) => {
        copy.numbers[1].name = 'called +44 7700 900123';
      }),
    ),
    'a phone number',
  );
  assert.equal(error.message.includes('900123'), false, 'the refusal repeats the number');
});

test('SPIKE-01-AC14: S8 is marked as outside the go/no-go', async () => {
  const markdown = await renderResults(input());
  assert.match(row(markdown, 'S8'), /outside the go\/no-go/i);
});

/** A table row's cells, trimmed: [scenario, Android, iOS, notes]. */
const cells = (line) =>
  line
    .split('|')
    .slice(1, -1)
    .map((text) => text.trim());

test('SPIKE-01-AC14: "no verdict" is written as such, with its valid and invalid runs, never as passed, failed or not shown, and not as something L9 will show', async () => {
  const markdown = await renderResults(
    input((copy) => {
      copy.summary[0].ios = cell('no verdict', 0, 3);
    }),
  );
  const ios = cells(row(markdown, 'S1'))[2] ?? '';
  assert.match(ios, /\bno verdict\b/, 'the iOS cell does not say "no verdict"');
  assert.match(ios, /\b0 valid\b/);
  assert.match(ios, /\b3 invalid\b/);
  assert.doesNotMatch(ios, /\bpassed\b|\bfailed\b/, 'no verdict was written as a verdict');
  assert.equal(ios.includes(NOT_SHOWN), false, 'no verdict was written as not shown');
  assert.doesNotMatch(ios, /\bL9\b/, 'a harness that broke is not something L9 will show');
});
