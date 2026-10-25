// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The app's L5 tests prove "one tap places one call to #1" and "112 opens the
// dialer and places no call" by what this fake recorded. A fake that dropped a
// call, recorded the number it was not given, answered a permission it was not
// told to, settled a held call early, or kept a failure past reset would make
// those tests pass, or fail, whatever the app did.
import { describe, expect, test } from 'vitest';
import { fakePhone } from './fake-phone.ts';

/** Lets pending promise callbacks run. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await Promise.resolve();
  }
}

describe('fakePhone', () => {
  test('records every call in order, with each number exactly as it was given', async () => {
    const phone = fakePhone();

    await phone.module.callPermission();
    await phone.module.callNumber(' 12 34 ');
    await phone.module.openDialer('5-6');
    await phone.module.askCallPermission();
    await phone.module.openAppSettings();

    expect(phone.calls()).toEqual([
      { fn: 'callPermission', number: null },
      { fn: 'callNumber', number: ' 12 34 ' },
      { fn: 'openDialer', number: '5-6' },
      { fn: 'askCallPermission', number: null },
      { fn: 'openAppSettings', number: null },
    ]);
    expect(phone.numbersGivenTo('callNumber')).toEqual([' 12 34 ']);
    expect(phone.numbersGivenTo('openDialer')).toEqual(['5-6']);
    expect(phone.timesCalled('callPermission')).toBe(1);
  });

  test('answers notGranted and denied until told otherwise, and a request answered granted grants the permission', async () => {
    const phone = fakePhone();

    expect(await phone.module.callPermission()).toBe('notGranted');
    expect(await phone.module.askCallPermission()).toBe('denied');
    expect(await phone.module.callPermission()).toBe('notGranted');
    phone.askAnswer = 'neverAskAgain';
    expect(await phone.module.askCallPermission()).toBe('neverAskAgain');
    expect(await phone.module.callPermission()).toBe('notGranted');
    phone.askAnswer = 'granted';
    expect(await phone.module.askCallPermission()).toBe('granted');
    expect(await phone.module.callPermission()).toBe('granted');
  });

  test('a function told to fail rejects with the error given, the call recorded all the same, until it recovers', async () => {
    const phone = fakePhone();
    const error = new Error('synthetic: the phone refused');

    phone.fail('callNumber', error);
    phone.fail('openDialer', error);

    await expect(phone.module.callNumber('1')).rejects.toBe(error);
    await expect(phone.module.openDialer('2')).rejects.toBe(error);
    expect(phone.timesCalled('callNumber')).toBe(1);
    expect(phone.timesCalled('openDialer')).toBe(1);
    phone.recover('callNumber');
    await expect(phone.module.callNumber('3')).resolves.toBeUndefined();
    await expect(phone.module.openDialer('4')).rejects.toBe(error);
  });

  test('a held call settles only when the hold is released, every call made while it holds with it; calls after it settle at once', async () => {
    const phone = fakePhone();
    const hold = phone.holdCalls();
    let first = false;
    let second = false;

    void phone.module.callNumber('1').then(() => {
      first = true;
    });
    void phone.module.callNumber('2').then(() => {
      second = true;
    });
    await settled();

    expect({ first, second, waiting: hold.waiting() }).toEqual({
      first: false,
      second: false,
      waiting: 2,
    });
    hold.release();
    await settled();
    expect({ first, second, waiting: hold.waiting() }).toEqual({
      first: true,
      second: true,
      waiting: 0,
    });
    await expect(phone.module.callNumber('3')).resolves.toBeUndefined();
  });

  test('a hold that fails rejects every call it held', async () => {
    const phone = fakePhone();
    const hold = phone.holdCalls();
    const error = new Error('synthetic: neither path started the call');

    const held = phone.module.callNumber('1');
    hold.fail(error);

    await expect(held).rejects.toBe(error);
  });

  // Review loop 2 (CALL-01-AC4): the app's tests see the call button while no
  // read of the permission has answered. A hold that settled early, answered
  // what the fake said when the read was made rather than at the release, or
  // kept holding after it was released would show the app a state it was not
  // in.
  test('a held permission read settles only when the hold is released, with what permission says then; reads after it answer at once', async () => {
    const phone = fakePhone();
    const hold = phone.holdPermission();
    const answers: string[] = [];

    void phone.module.callPermission().then((answer) => answers.push(`first ${answer}`));
    void phone.module.callPermission().then((answer) => answers.push(`second ${answer}`));
    await settled();

    expect({ answers, waiting: hold.waiting(), read: phone.timesCalled('callPermission') }).toEqual(
      { answers: [], waiting: 2, read: 2 },
    );
    phone.permission = 'granted';
    hold.release();
    await settled();
    expect({ answers, waiting: hold.waiting() }).toEqual({
      answers: ['first granted', 'second granted'],
      waiting: 0,
    });
    phone.permission = 'notGranted';
    expect(await phone.module.callPermission()).toBe('notGranted');
  });

  test('a held permission read rejects at the release when a failure is set for callPermission then', async () => {
    const phone = fakePhone();
    const hold = phone.holdPermission();
    const error = new Error('synthetic: the permission could not be read');

    const held = phone.module.callPermission();
    phone.fail('callPermission', error);
    hold.release();

    await expect(held).rejects.toBe(error);
  });

  test('reset forgets a permission hold: a read after it answers at once', async () => {
    const phone = fakePhone();
    phone.holdPermission();

    phone.reset();

    expect(await phone.module.callPermission()).toBe('notGranted');
  });

  test('reset forgets calls, failures, holds and answers', async () => {
    const phone = fakePhone();
    phone.permission = 'granted';
    phone.askAnswer = 'granted';
    phone.fail('openDialer', new Error('synthetic'));
    phone.holdCalls();
    await phone.module.callPermission();

    phone.reset();

    expect(phone.calls()).toEqual([]);
    expect(await phone.module.callPermission()).toBe('notGranted');
    expect(await phone.module.askCallPermission()).toBe('denied');
    await expect(phone.module.openDialer('1')).resolves.toBeUndefined();
    await expect(phone.module.callNumber('1')).resolves.toBeUndefined();
  });

  test('with a journal, writes each call into it in order, beside whatever else writes there', async () => {
    const journal: string[] = ['before'];
    const phone = fakePhone({ journal });

    await phone.module.askCallPermission();
    journal.push('between');
    await phone.module.callNumber('1');

    expect(journal).toEqual(['before', 'phone askCallPermission', 'between', 'phone callNumber']);
  });

  test('the module is one object for the fake’s life, so every launch of the app gets the same fake', () => {
    const phone = fakePhone();
    const module = phone.module;

    phone.reset();

    expect(phone.module).toBe(module);
  });
});
