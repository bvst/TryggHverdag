// The app's L5 tests prove "#1 is kept in secure storage, under its own key,
// readable after the first unlock, and nowhere else" and "a 401 deletes it"
// by what this fake holds and recorded. A fake that kept a refused write,
// lost a refused delete's item, settled a held read early, or forgot what it
// was given would make those tests pass whatever the app did.
//
// GRP-02-AC2 (review loop 1, safety-reviewer 4; D-100): the fake refuses what
// expo-secure-store refuses, a key that does not match /^[\w.-]+$/ and a
// value that is not a string, so no test of #1 can pass on a key or a value
// the real store would refuse. The store's checks, as read in the installed
// expo-secure-store 57.0.4 (build/SecureStore.js): `ensureValidKey` in every
// read, write and delete, and `isValidValue` in every write, each before the
// native call, each throwing an Error; the async functions are `async`, so
// there they reject. A fake made more lenient than the store quietly weakens
// what the tests prove (D-100). The tests below that name GRP-02-AC2 hold it;
// the others hold the fake's own behaviour.
//
// RG-03 (review loop 1): this file carried the `req-coverage: fixtures-only`
// marker, for a file that proved no requirement. Its GRP-02-AC2 tests now
// prove a part of that criterion (GRP-02.md, AC2 and its test plan name this
// file), so the marker is gone and req:coverage counts the file. No test or
// assertion of the fake's own behaviour changed.
import { describe, expect, test } from 'vitest';
import { fakeSecureStore } from './fake-secure-store.ts';

/** expo-secure-store's own messages, in full (build/SecureStore.js, 57.0.4). */
const INVALID_KEY =
  'Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".';
const INVALID_VALUE =
  'Invalid value provided to SecureStore. Values must be strings; consider JSON-encoding your values if they are serializable.';

/** Keys the store refuses: each fails /^[\w.-]+$/, or is no string. */
const REFUSED_KEYS: [string, unknown][] = [
  ['an empty key', ''],
  ['a space in it', 'first contact'],
  ['a slash in it', 'first/contact'],
  ['a colon in it', 'first:contact'],
  ['a letter outside ASCII', 'førsteKontakt'],
  ['a newline at its end', 'firstContact\n'],
  ['no string at all', undefined],
  ['a number, not a string', 42],
];

/** Values the store refuses on a write: anything that is not a string. */
const REFUSED_VALUES: [string, unknown][] = [
  ['a number', 42],
  ['null', null],
  ['undefined', undefined],
  ['an object, not JSON-encoded', { name: 'Testkontakt', number: '0' }],
  ['a boolean', true],
];

/** A key the store accepts: letters, digits, `_`, `.` and `-`. */
const ACCEPTED_KEY = 'first_Contact.v2-1';

describe('fakeSecureStore refuses what expo-secure-store refuses (D-100)', () => {
  test.each(REFUSED_KEYS)(
    'GRP-02-AC2: a key with %s is refused by every read, write and delete, async and sync, with the store’s own message; nothing is kept, and the item under a good key is untouched',
    async (_what, key) => {
      const store = fakeSecureStore();
      store.items.set(ACCEPTED_KEY, 'kept');
      const bad = key as string;

      await expect(store.module.getItemAsync(bad)).rejects.toThrow(INVALID_KEY);
      await expect(store.module.setItemAsync(bad, 'x')).rejects.toThrow(INVALID_KEY);
      await expect(store.module.deleteItemAsync(bad)).rejects.toThrow(INVALID_KEY);
      expect(() => store.module.getItem(bad)).toThrow(INVALID_KEY);
      expect(() => {
        store.module.setItem(bad, 'x');
      }).toThrow(INVALID_KEY);
      expect(() => {
        store.module.deleteItem(bad);
      }).toThrow(INVALID_KEY);

      expect([...store.items]).toEqual([[ACCEPTED_KEY, 'kept']]);
    },
  );

  test.each(REFUSED_VALUES)(
    'GRP-02-AC2: a value that is %s is refused by a write, async and sync, with the store’s own message, under a good key; nothing is kept, and what was kept stays',
    async (_what, value) => {
      const store = fakeSecureStore();
      store.items.set(ACCEPTED_KEY, 'kept');
      const bad = value as string;

      await expect(store.module.setItemAsync(ACCEPTED_KEY, bad)).rejects.toThrow(INVALID_VALUE);
      expect(() => {
        store.module.setItem(ACCEPTED_KEY, bad);
      }).toThrow(INVALID_VALUE);
      await expect(store.module.setItemAsync('other', bad)).rejects.toThrow(INVALID_VALUE);

      expect([...store.items]).toEqual([[ACCEPTED_KEY, 'kept']]);
    },
  );

  test('GRP-02-AC2: a key of letters, digits, _, . and - with a string value, the empty string among them, is accepted: written, read, and deleted', async () => {
    const store = fakeSecureStore();

    await store.module.setItemAsync(ACCEPTED_KEY, 'one');
    expect(await store.module.getItemAsync(ACCEPTED_KEY)).toBe('one');
    store.module.setItem(ACCEPTED_KEY, '');
    expect(store.module.getItem(ACCEPTED_KEY)).toBe('');
    await store.module.deleteItemAsync(ACCEPTED_KEY);

    expect(store.items.has(ACCEPTED_KEY)).toBe(false);
    expect(store.calls().every(({ refused }) => !refused)).toBe(true);
  });

  test('GRP-02-AC2: the app’s own keys today, deviceCredential, joinKey and firstContact, are keys the store accepts', async () => {
    // Not a check of the app: its keys are its own to name (GRP-02, approach
    // 4). A check that the refusal above leaves today's keys alone, so the
    // app's tests are not refused for keys the store would take.
    const store = fakeSecureStore();

    for (const key of ['deviceCredential', 'joinKey', 'firstContact']) {
      await expect(store.module.setItemAsync(key, 'x')).resolves.toBeUndefined();
    }
    expect(store.items.size).toBe(3);
  });

  test('GRP-02-AC2: a refused key is refused at once, even while reads are held, and before any refusal a test set', async () => {
    const store = fakeSecureStore();
    store.holdReads();
    store.refuse('get', '*', new Error('synthetic: the Keystore refused'));

    await expect(store.module.getItemAsync('bad key')).rejects.toThrow(INVALID_KEY);
  });

  test('GRP-02-AC2: each refused call is recorded, as refused, so a test can see that the app asked', async () => {
    const store = fakeSecureStore();

    await store.module.setItemAsync('bad key', 'x').catch(() => undefined);
    await store.module.setItemAsync(ACCEPTED_KEY, 42 as unknown as string).catch(() => undefined);

    expect(store.calls().map(({ op, key, refused }) => [op, key, refused])).toEqual([
      ['set', 'bad key', true],
      ['set', ACCEPTED_KEY, true],
    ]);
  });
});

async function settled(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await Promise.resolve();
  }
}

describe('fakeSecureStore', () => {
  test('keeps what is written, reads it back, deletes it, and records each call with its options', async () => {
    const store = fakeSecureStore();
    const options = { keychainAccessible: store.module.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

    await store.module.setItemAsync('a', 'one', options);
    expect(await store.module.getItemAsync('a', options)).toBe('one');
    await store.module.deleteItemAsync('a', options);
    expect(await store.module.getItemAsync('a')).toBeNull();

    expect(store.calls()).toEqual([
      { op: 'set', key: 'a', value: 'one', options, refused: false },
      { op: 'get', key: 'a', value: null, options, refused: false },
      { op: 'delete', key: 'a', value: null, options, refused: false },
      { op: 'get', key: 'a', value: null, options: undefined, refused: false },
    ]);
    expect(store.callsFor('set', 'a')).toHaveLength(1);
  });

  test('a refused write keeps nothing, a refused delete keeps the item, and a refused read rejects; each with the error given, and recorded as refused', async () => {
    const store = fakeSecureStore();
    store.items.set('kept', 'value');
    const error = new Error('synthetic: the Keystore refused');

    store.refuse('set', 'new', error);
    store.refuse('delete', 'kept', error);
    store.refuse('get', 'kept', error);

    await expect(store.module.setItemAsync('new', 'x')).rejects.toBe(error);
    await expect(store.module.deleteItemAsync('kept')).rejects.toBe(error);
    await expect(store.module.getItemAsync('kept')).rejects.toBe(error);
    expect(store.items.has('new')).toBe(false);
    expect(store.items.get('kept')).toBe('value');
    expect(store.calls().map(({ op, refused }) => [op, refused])).toEqual([
      ['set', true],
      ['delete', true],
      ['get', true],
    ]);
    store.allowAll();
    await expect(store.module.getItemAsync('kept')).resolves.toBe('value');
  });

  test('a refusal of every key applies to each key, and to that operation alone', async () => {
    const store = fakeSecureStore();
    const error = new Error('synthetic');
    store.refuse('get', '*', error);

    await expect(store.module.getItemAsync('any')).rejects.toBe(error);
    await expect(store.module.setItemAsync('any', 'x')).resolves.toBeUndefined();
  });

  test('held reads settle only when released, with what is kept then', async () => {
    const store = fakeSecureStore();
    const release = store.holdReads();
    let read: string | null | undefined;

    void store.module.getItemAsync('a').then((value) => {
      read = value;
    });
    await settled();
    expect(read).toBeUndefined();
    store.items.set('a', 'later');
    release();
    await settled();

    expect(read).toBe('later');
    expect(await store.module.getItemAsync('a')).toBe('later');
  });

  // test-auditor's audit of review loop 2 (GRP-02-AC6): the app's tests see
  // the app while #1's delete at a start with no credential has not settled.
  // A hold that settled early, removed the item before the release, held the
  // reads and writes too, or kept holding after it was released would show
  // the app a state it was not in.
  test('held deletes settle only when released: the item is kept and the delete unrecorded until then, each is carried out at the release in the order asked, and deletes after it settle at once', async () => {
    const journal: string[] = [];
    const store = fakeSecureStore({ journal });
    store.items.set('a', 'one');
    store.items.set('b', 'two');
    store.items.set('c', 'three');
    const hold = store.holdDeletes();
    const settledDeletes: string[] = [];

    void store.module.deleteItemAsync('a').then(() => settledDeletes.push('a'));
    void store.module.deleteItemAsync('b').then(() => settledDeletes.push('b'));
    await settled();

    expect({
      settledDeletes,
      waiting: hold.waiting(),
      kept: [...store.items.keys()],
      deletes: store.calls().filter(({ op }) => op === 'delete'),
      journal,
    }).toEqual({ settledDeletes: [], waiting: 2, kept: ['a', 'b', 'c'], deletes: [], journal: [] });
    hold.release();
    await settled();

    expect({
      settledDeletes,
      waiting: hold.waiting(),
      kept: [...store.items.keys()],
      journal,
    }).toEqual({
      settledDeletes: ['a', 'b'],
      waiting: 0,
      kept: ['c'],
      journal: ['secure-store delete a', 'secure-store delete b'],
    });
    await expect(store.module.deleteItemAsync('c')).resolves.toBeUndefined();
    expect(store.items.size).toBe(0);
  });

  test('while deletes are held, reads and writes settle at once, and a delete of a key the store refuses is refused at once', async () => {
    const store = fakeSecureStore();
    const hold = store.holdDeletes();

    await expect(store.module.setItemAsync('a', 'one')).resolves.toBeUndefined();
    await expect(store.module.getItemAsync('a')).resolves.toBe('one');
    await expect(store.module.deleteItemAsync('bad key')).rejects.toThrow(INVALID_KEY);
    expect(hold.waiting()).toBe(0);
  });

  test('a held delete rejects at the release when a refusal is set for it then, and the item is kept', async () => {
    const store = fakeSecureStore();
    store.items.set('kept', 'value');
    const hold = store.holdDeletes();
    const error = new Error('synthetic: the Keystore refused');

    const held = store.module.deleteItemAsync('kept');
    store.refuse('delete', 'kept', error);
    hold.release();

    await expect(held).rejects.toBe(error);
    expect(store.items.get('kept')).toBe('value');
    expect(store.callsFor('delete', 'kept').map(({ refused }) => refused)).toEqual([true]);
  });

  test('reset forgets a delete hold: a delete after it settles at once', async () => {
    const store = fakeSecureStore();
    store.holdDeletes();

    store.reset();
    store.items.set('a', 'one');

    await expect(store.module.deleteItemAsync('a')).resolves.toBeUndefined();
    expect(store.items.has('a')).toBe(false);
  });

  test('with a journal, writes each call into it, refused ones marked', async () => {
    const journal: string[] = [];
    const store = fakeSecureStore({ journal });
    store.refuse('delete', 'b', new Error('synthetic'));

    await store.module.setItemAsync('a', 'x');
    await store.module.deleteItemAsync('b').catch(() => undefined);

    expect(journal).toEqual(['secure-store set a', 'secure-store delete b refused']);
  });

  test('reset forgets items, calls, refusals and holds; the module stays one object', async () => {
    const store = fakeSecureStore();
    const module = store.module;
    store.items.set('a', 'x');
    store.refuse('get', '*', new Error('synthetic'));
    store.holdReads();

    store.reset();

    expect(store.items.size).toBe(0);
    expect(store.calls()).toEqual([]);
    await expect(store.module.getItemAsync('a')).resolves.toBeNull();
    expect(store.module).toBe(module);
  });
});
