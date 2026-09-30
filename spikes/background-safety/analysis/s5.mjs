// SPIKE-01-AC9 (S5): the alert's payload and its shown text match the fixed,
// content-free alert exactly, with no other keys or values. Pure.
//
// Problems name where the payload differs, never what it holds.

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Appends to `problems` every place where `actual` is not exactly `expected`. */
function compare(expected, actual, path, problems) {
  if (isObject(expected)) {
    if (!isObject(actual)) {
      problems.push(`${path} is not an object`);
      return;
    }
    for (const key of Object.keys(expected)) {
      if (!Object.hasOwn(actual, key)) problems.push(`${path}.${key} is missing`);
      else compare(expected[key], actual[key], `${path}.${key}`, problems);
    }
    for (const key of Object.keys(actual)) {
      if (!Object.hasOwn(expected, key)) problems.push(`${path}.${key} is an extra key`);
    }
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      problems.push(`${path} is not the expected list`);
      return;
    }
    expected.forEach((item, i) => compare(item, actual[i], `${path}[${i}]`, problems));
    return;
  }
  if (!Object.is(expected, actual)) problems.push(`${path} differs from the fixed alert`);
}

/**
 * @param {{ expected: { payload: object, text: string },
 *   delivered: { payload: object, shownText: string } }} input
 * @returns {{ status: 'passed' | 'failed', problems: string[] }}
 */
export function checkAlert({ expected, delivered }) {
  if (!isObject(expected?.payload) || typeof expected.text !== 'string') {
    throw new Error('expected must hold the fixed payload and the fixed text');
  }
  if (!isObject(delivered)) throw new Error('delivered must hold what the device received');
  const problems = [];
  compare(expected.payload, delivered.payload, 'payload', problems);
  if (delivered.shownText !== expected.text) {
    problems.push('the text on the screen differs from the fixed text');
  }
  return { status: problems.length === 0 ? 'passed' : 'failed', problems };
}
