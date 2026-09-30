// SPIKE-01-AC10 (S6): reads the Android emulator console's `gsm list`, and says
// whether the tap started an outbound call to the synthetic number. Pure.
//
// Errors never repeat the console's text: it may hold a number.

const CALL = /^(outbound to|inbound from)\s+(\S+)\s*:\s*(\w+)$/;

/**
 * @param {string} text the console's reply to `gsm list`
 * @returns {{ direction: 'outbound' | 'inbound', number: string, state: string }[]}
 */
export function readGsmList(text) {
  if (typeof text !== 'string') throw new Error('the call list must be the console text');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.at(-1) !== 'OK') {
    throw new Error('the console did not answer "gsm list" with OK, so its call list is unknown');
  }
  return lines.slice(0, -1).map((line, i) => {
    const match = CALL.exec(line);
    if (match === null) {
      throw new Error(`line ${i + 1} of the call list is not a call, so the list is not read`);
    }
    const [, direction, number, state] = match;
    return { direction: direction === 'outbound to' ? 'outbound' : 'inbound', number, state };
  });
}

const digits = (number) => String(number).replace(/\D/g, '');

/** Whether the list shows an outbound call to `number`, with or without its plus sign. */
export function callStarted({ calls, number }) {
  if (!Array.isArray(calls)) throw new Error('calls must be the list readGsmList returned');
  const wanted = digits(number);
  if (wanted === '') throw new Error('the number to look for is empty');
  return calls.some((call) => call.direction === 'outbound' && digits(call.number) === wanted);
}
