// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The app's L5 tests prove "#1 is kept in secure storage, under its own key,
// readable after the first unlock, and nowhere else" and "a 401 deletes it"
// by what this fake holds and recorded. A fake that kept a refused write,
// lost a refused delete's item, settled a held read early, or forgot what it
// was given would make those tests pass whatever the app did.
import { describe, expect, test } from 'vitest';
import { fakeSecureStore } from './fake-secure-store.ts';

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
