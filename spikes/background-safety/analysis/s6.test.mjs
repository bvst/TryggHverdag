// SPIKE-01: the S6 call-record reader (analysis/s6.mjs), on sample output of
// the Android emulator console's `gsm list` (format to verify on the emulator).
//
// The number is from Ofcom's range reserved for drama (07700 900000 to 900999):
// never an emergency number, never a Norwegian one, and nobody's.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const readGsmList = async (text) => (await import('./s6.mjs')).readGsmList(text);
const callStarted = async (input) => (await import('./s6.mjs')).callStarted(input);

const NUMBER = '+447700900123';
const OTHER = '+447700900456';

const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError];
/** Rejects on purpose: not a missing module, and not a programming error. */
async function refuses(promise, why) {
  await assert.rejects(
    promise,
    (error) => {
      assert.ok(
        error?.code !== 'ERR_MODULE_NOT_FOUND' &&
          !PROGRAMMING_ERRORS.some((type) => error instanceof type),
        `${why}: it broke instead of refusing (${error?.name}: ${error?.message})`,
      );
      return true;
    },
    why,
  );
}

test("SPIKE-01-AC10: reads an outbound call from the emulator's call list", async () => {
  const text = `  outbound to  ${NUMBER} : dialing\r\nOK\r\n`;
  assert.deepEqual(await readGsmList(text), [
    { direction: 'outbound', number: NUMBER, state: 'dialing' },
  ]);
});

test('SPIKE-01-AC10: reads several calls, inbound and outbound, in their order', async () => {
  const text = [
    `outbound to  ${NUMBER} : active`,
    `inbound from ${OTHER} : incoming`,
    'OK',
    '',
  ].join('\r\n');
  assert.deepEqual(await readGsmList(text), [
    { direction: 'outbound', number: NUMBER, state: 'active' },
    { direction: 'inbound', number: OTHER, state: 'incoming' },
  ]);
});

test('SPIKE-01-AC10: a list with no calls reads as none', async () => {
  assert.deepEqual(await readGsmList('OK\r\n'), []);
});

test('SPIKE-01-AC10: an error from the console is refused, never read as "no call"', async () => {
  await refuses(readGsmList('KO: unknown command, try "help"\r\n'), 'an error reply');
  await refuses(readGsmList('Android Console: Authentication required\r\n'), 'a login prompt');
  await refuses(readGsmList(''), 'no reply at all');
});

test('SPIKE-01-AC10: the call started on the tap only if an outbound call to the number is listed', async () => {
  const outbound = [{ direction: 'outbound', number: NUMBER, state: 'dialing' }];
  assert.equal(await callStarted({ calls: outbound, number: NUMBER }), true);
  assert.equal(
    await callStarted({
      calls: [{ direction: 'outbound', number: '447700900123', state: 'alerting' }],
      number: NUMBER,
    }),
    true,
    'the same number without its plus sign',
  );
  assert.equal(
    await callStarted({
      calls: [{ direction: 'inbound', number: NUMBER, state: 'incoming' }],
      number: NUMBER,
    }),
    false,
    'an inbound call is not the tap',
  );
  assert.equal(await callStarted({ calls: outbound, number: OTHER }), false, 'another number');
  assert.equal(await callStarted({ calls: [], number: NUMBER }), false, 'no call at all');
});
