/**
 * The phone's secure storage, in memory and recording (GRP-01, GRP-02; M3
 * task 2).
 *
 * Stands in for `expo-secure-store`, which the app reaches through
 * `apps/mobile/src/shared/secure-storage.ts`: the device credential, the join
 * key, and from task 2 the walker's #1 (GRP-02, approach 4). Android keeps
 * them in its Keystore across restarts, so this keeps them across launches of
 * the app in a test: a launch is a fresh module registry, and this fake lives
 * outside it, in the test file.
 *
 * It records every read, write and delete, as it was asked, with the options
 * a write was given, so a test can say under which key and with which
 * accessibility a value was kept. It can be told:
 *   - to refuse a read, a write or a delete of one key, or of every key, by
 *     rejecting with an error the test gives (an error whose message may hold
 *     the very value, as GRP-02-AC9's failure paths need); a refused write
 *     keeps nothing and a refused delete keeps the item, as the Keystore does;
 *   - to hold every read until released, for the app's brief start while
 *     storage is read (CALL-02-AC1).
 * With a `journal`, it writes `secure-store <op> <key>` into it as each call
 * is made, so a test can order its calls against the phone fake's.
 *
 * The constants are the module's names with distinct values; the app passes
 * them through and never reads their value.
 *
 * Matches the module by shape: the test kit has no import from the app or Expo.
 */

/** What a call asked of secure storage. */
export type SecureStoreOp = 'get' | 'set' | 'delete';

/** One call, as it was asked: the key, the value and options given, and whether it was refused. */
export interface SecureStoreCall {
  readonly op: SecureStoreOp;
  readonly key: string;
  readonly value: string | null;
  readonly options: unknown;
  readonly refused: boolean;
}

/** `expo-secure-store` as the app imports it. */
export interface FakeSecureStoreModule {
  readonly getItemAsync: (key: string, options?: unknown) => Promise<string | null>;
  readonly setItemAsync: (key: string, value: string, options?: unknown) => Promise<void>;
  readonly deleteItemAsync: (key: string, options?: unknown) => Promise<void>;
  readonly getItem: (key: string, options?: unknown) => string | null;
  readonly setItem: (key: string, value: string, options?: unknown) => void;
  readonly deleteItem: (key: string, options?: unknown) => void;
  readonly isAvailableAsync: () => Promise<boolean>;
  readonly AFTER_FIRST_UNLOCK: number;
  readonly AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: number;
  readonly ALWAYS: number;
  readonly WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: number;
  readonly ALWAYS_THIS_DEVICE_ONLY: number;
  readonly WHEN_UNLOCKED: number;
  readonly WHEN_UNLOCKED_THIS_DEVICE_ONLY: number;
}

export interface FakeSecureStore {
  /** What `jest.mock` hands the app in the module's place. The same object for the fake's life. */
  readonly module: FakeSecureStoreModule;
  /** What is kept, by key: the test may read it, seed it and change it. */
  readonly items: Map<string, string>;
  /** Every call, in order. A copy. */
  readonly calls: () => readonly SecureStoreCall[];
  /** The calls of one kind for one key, in order. */
  readonly callsFor: (op: SecureStoreOp, key: string) => readonly SecureStoreCall[];
  /** Refuses `op` on `key`, or on every key with '*', with `error`, until allowed. */
  readonly refuse: (op: SecureStoreOp, key: string, error: Error) => void;
  /** Takes back every refusal. */
  readonly allowAll: () => void;
  /** Holds every read from now until the returned function is called. */
  readonly holdReads: () => () => void;
  /** Forgets everything: items, calls, refusals and holds. */
  readonly reset: () => void;
}

/** Every key: a refusal that applies to all of them. */
const EVERY_KEY = '*';

export function fakeSecureStore({ journal }: { journal?: string[] } = {}): FakeSecureStore {
  const items = new Map<string, string>();
  let calls: SecureStoreCall[] = [];
  let refusals = new Map<string, Error>();
  let heldReads: (() => void)[] | null = null;

  const refusalOf = (op: SecureStoreOp, key: string): Error | undefined =>
    refusals.get(`${op} ${key}`) ?? refusals.get(`${op} ${EVERY_KEY}`);

  /** Records the call, and says whether it is refused, and with what. */
  const record = (
    op: SecureStoreOp,
    key: string,
    value: string | null,
    options: unknown,
  ): Error | undefined => {
    const refused = refusalOf(op, key);
    calls.push({ op, key, value, options, refused: refused !== undefined });
    journal?.push(`secure-store ${op} ${key}${refused === undefined ? '' : ' refused'}`);
    return refused;
  };

  const read = (key: string, options: unknown): string | null => {
    const refused = record('get', key, null, options);
    if (refused !== undefined) {
      throw refused;
    }
    return items.get(key) ?? null;
  };
  const write = (key: string, value: string, options: unknown): void => {
    const refused = record('set', key, value, options);
    if (refused !== undefined) {
      throw refused;
    }
    items.set(key, value);
  };
  const remove = (key: string, options: unknown): void => {
    const refused = record('delete', key, null, options);
    if (refused !== undefined) {
      throw refused;
    }
    items.delete(key);
  };

  /** Runs `work` as a promise: its value, or its throw as a rejection. */
  const settle = <T>(work: () => T): Promise<T> => {
    try {
      return Promise.resolve(work());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  return {
    module: {
      getItemAsync: (key, options) => {
        if (heldReads === null) {
          return settle(() => read(key, options));
        }
        const waiting = heldReads;
        return new Promise<string | null>((resolve, reject) => {
          waiting.push(() => {
            settle(() => read(key, options)).then(resolve, reject);
          });
        });
      },
      setItemAsync: (key, value, options) =>
        settle(() => {
          write(key, value, options);
        }),
      deleteItemAsync: (key, options) =>
        settle(() => {
          remove(key, options);
        }),
      getItem: (key, options) => read(key, options),
      setItem: (key, value, options) => {
        write(key, value, options);
      },
      deleteItem: (key, options) => {
        remove(key, options);
      },
      isAvailableAsync: () => Promise.resolve(true),
      AFTER_FIRST_UNLOCK: 0,
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
      ALWAYS: 2,
      WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 3,
      ALWAYS_THIS_DEVICE_ONLY: 4,
      WHEN_UNLOCKED: 5,
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
    },
    items,
    calls: () => [...calls],
    callsFor: (op, key) => calls.filter((call) => call.op === op && call.key === key),
    refuse: (op, key, error) => {
      refusals.set(`${op} ${key}`, error);
    },
    allowAll: () => {
      refusals = new Map();
    },
    holdReads: () => {
      const waiting: (() => void)[] = [];
      heldReads = waiting;
      return () => {
        if (heldReads === waiting) {
          heldReads = null;
        }
        for (const go of waiting.splice(0)) {
          go();
        }
      };
    },
    reset: () => {
      items.clear();
      calls = [];
      refusals = new Map();
      heldReads = null;
    },
  };
}
