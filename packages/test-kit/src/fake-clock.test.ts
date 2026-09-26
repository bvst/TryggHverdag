// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The fake clock is what every later safety test will say "five minutes later"
// with, so a fault in it does not fail: it makes other tests pass. The guard
// against time running backwards is the part that matters most and the part
// least likely to be noticed if it stopped working, because nothing would go
// red — a journey would simply appear to be younger than it was.
import { describe, expect, test } from 'vitest';
import { fakeClock } from './fake-clock.ts';

const START = new Date('2026-01-01T22:00:00.000Z');

describe('fakeClock', () => {
  test('starts at the moment it was given', async () => {
    await expect(fakeClock(START).now()).resolves.toEqual(START);
  });

  test('advancing moves time forward by exactly that much', async () => {
    const clock = fakeClock(START);

    clock.advance(5 * 60_000);

    await expect(clock.now()).resolves.toEqual(new Date('2026-01-01T22:05:00.000Z'));
  });

  test('advancing twice accumulates', async () => {
    const clock = fakeClock(START);

    clock.advance(60_000);
    clock.advance(60_000);

    await expect(clock.now()).resolves.toEqual(new Date('2026-01-01T22:02:00.000Z'));
  });

  test('advancing by zero is allowed, and changes nothing', async () => {
    const clock = fakeClock(START);

    clock.advance(0);

    await expect(clock.now()).resolves.toEqual(START);
  });

  test('advancing backwards throws rather than quietly rewinding', async () => {
    const clock = fakeClock(START);

    expect(() => {
      clock.advance(-1);
    }).toThrow(/time does not go backwards/);
    await expect(clock.now()).resolves.toEqual(START);
  });

  test('set() is how a test jumps back on purpose, so the intent is visible', async () => {
    const clock = fakeClock(START);
    clock.advance(60_000);

    clock.set(START);

    await expect(clock.now()).resolves.toEqual(START);
  });

  test('a failing clock fails with exactly the error it was given', async () => {
    // The database clock fails when the database is gone, and whatever reads
    // the time has to be tested against that too.
    const clock = fakeClock(START);
    const error = new Error('the database did not answer');

    clock.failWith(error);

    await expect(clock.now()).rejects.toBe(error);
  });

  test('time still moves while the clock fails, and reads true once it recovers', async () => {
    const clock = fakeClock(START);
    clock.failWith(new Error('the database did not answer'));

    clock.advance(60_000);
    clock.recover();

    await expect(clock.now()).resolves.toEqual(new Date('2026-01-01T22:01:00.000Z'));
  });

  test('the Date it returns cannot be mutated from under a later reading', async () => {
    // now() hands out a Date, and a Date is mutable. If it handed out the same
    // one every time, a test that called setTime() on it — or any helper that
    // did — would move the clock without touching it.
    const clock = fakeClock(START);

    (await clock.now()).setTime(0);

    await expect(clock.now()).resolves.toEqual(START);
  });
});
