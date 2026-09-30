// SPIKE-01: the S5 payload check (analysis/s5.mjs): the alert's payload and
// its shown text match the fixed, content-free alert exactly, with no other
// keys or values. The text below is made up for the test and names no one.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const checkAlert = async (input) => (await import('./s5.mjs')).checkAlert(input);

const TEXT = 'Test alert. Open the app.';
/** The fixed alert, as `simctl push` delivers it at the Time Sensitive level. */
const EXPECTED = {
  payload: {
    aps: {
      alert: { title: 'Spike alert', body: TEXT },
      'interruption-level': 'time-sensitive',
      sound: 'default',
    },
  },
  text: TEXT,
};

/** What was delivered, starting from an exact copy of the fixed alert and changed by `change`. */
function delivered(change = () => {}) {
  const copy = { payload: structuredClone(EXPECTED.payload), shownText: TEXT };
  change(copy);
  return copy;
}

async function assertFails(change, why) {
  const result = await checkAlert({ expected: EXPECTED, delivered: delivered(change) });
  assert.equal(result.status, 'failed', why);
  assert.ok(result.problems.length > 0, `${why}: no problem was named`);
}

test('SPIKE-01-AC9: a payload and shown text that match the fixed alert exactly pass', async () => {
  const result = await checkAlert({ expected: EXPECTED, delivered: delivered() });
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.problems, []);
});

test('SPIKE-01-AC9: an extra key fails, at the top of the payload or inside it', async () => {
  await assertFails((d) => {
    d.payload.journey = 'j-1';
  }, 'an extra key at the top');
  await assertFails((d) => {
    d.payload.aps.alert.subtitle = '';
  }, 'an extra key in the alert');
  await assertFails((d) => {
    d.payload.aps['thread-id'] = 'group';
  }, 'an extra key in aps');
});

test('SPIKE-01-AC9: any change to the fixed text fails, in the payload or on the screen', async () => {
  const changes = [
    ['one character', (text) => text.replace('Open', 'Opne')],
    ['a trailing space', (text) => `${text} `],
    ['a change of case', (text) => text.toUpperCase()],
    ['an empty text', () => ''],
  ];
  for (const [what, change] of changes) {
    await assertFails((d) => {
      d.payload.aps.alert.body = change(TEXT);
    }, `${what} in the payload`);
    await assertFails((d) => {
      d.shownText = change(TEXT);
    }, `${what} on the screen`);
  }
});

test('SPIKE-01-AC9: a missing key or a changed value fails', async () => {
  await assertFails((d) => {
    delete d.payload.aps.sound;
  }, 'a missing key');
  await assertFails((d) => {
    d.payload.aps['interruption-level'] = 'active';
  }, 'a lower interruption level');
  await assertFails((d) => {
    d.payload.aps.alert.title = 'Spike alert.';
  }, 'a changed title');
});
