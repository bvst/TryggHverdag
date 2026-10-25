/**
 * The app's phone module, recording (CALL-01, CALL-02; M3 task 2).
 *
 * Stands in for `apps/mobile/src/features/call/phone.ts`, the one module that
 * reaches the phone's calling path (CALL-01, approach 1): `callNumber`,
 * `openDialer`, `callPermission`, `askCallPermission` and `openAppSettings`.
 * The app's screens reach the platform through that module and nothing else,
 * so the app's L5 tests fake it, and only it, with this, and read back what
 * the screens asked of the phone, in order.
 *
 * It answers as a test sets it, at any time:
 *   - `permission` is what `callPermission()` answers now, `granted` or
 *     `notGranted`. A request answered `granted` grants it, as Android does,
 *     so the next reading says so;
 *   - `askAnswer` is what `askCallPermission()` answers: `granted`, `denied`,
 *     or `neverAskAgain`, Android's answer once it shows no dialog;
 *   - `fail(name, error)` makes that function reject with `error` until
 *     `recover(name)`, or `reset()`; the call is recorded all the same;
 *   - `holdCalls()` keeps every `callNumber` from settling until the hold is
 *     released (or fails), so a test can tap again while a call is still
 *     being started (CALL-01-AC2);
 *   - `holdPermission()` keeps every `callPermission()` read from settling
 *     until the hold is released; each then answers what `permission` says,
 *     or rejects with the failure set for it, at the release. So a test can
 *     see the app while no read has answered yet (CALL-01-AC4, review
 *     loop 2).
 * It records every call as it is made, whatever it answers, with the number
 * exactly as it was given. With a `journal`, it also writes `phone <name>`
 * into it, so a test can order its calls against another fake's (see
 * fake-secure-store.ts).
 *
 * Matches the module by shape: the test kit has no import from the app.
 */

/** What the phone says of the call permission now. */
export type CallPermission = 'granted' | 'notGranted';

/** What Android answers a request for the call permission. */
export type CallPermissionAnswer = 'granted' | 'denied' | 'neverAskAgain';

/** The phone module's five functions, by name. */
export type PhoneFunction =
  'callNumber' | 'openDialer' | 'callPermission' | 'askCallPermission' | 'openAppSettings';

/** One call the app made to the phone module: which function, and the number it was given, if any. */
export interface PhoneCall {
  readonly fn: PhoneFunction;
  readonly number: string | null;
}

/** The module, as the app imports it. */
export interface FakePhoneModule {
  readonly callNumber: (number: string) => Promise<void>;
  readonly openDialer: (number: string) => Promise<void>;
  readonly callPermission: () => Promise<CallPermission>;
  readonly askCallPermission: () => Promise<CallPermissionAnswer>;
  readonly openAppSettings: () => Promise<void>;
}

/** A hold on `callNumber`: every call made while it holds settles when it is released or failed. */
export interface CallHold {
  readonly release: () => void;
  readonly fail: (error: Error) => void;
  /** How many calls are waiting on it. */
  readonly waiting: () => number;
}

/** A hold on `callPermission`: every read made while it holds settles when it is released. */
export interface PermissionHold {
  /** Settles every held read with what the fake answers now: `permission`, or the failure set. */
  readonly release: () => void;
  /** How many reads are waiting on it. */
  readonly waiting: () => number;
}

export interface FakePhone {
  /** What `jest.mock` hands the app in the module's place. The same object for the fake's life. */
  readonly module: FakePhoneModule;
  /** Every call, in order. A copy. */
  readonly calls: () => readonly PhoneCall[];
  /** The numbers `fn` was given, in order. */
  readonly numbersGivenTo: (fn: 'callNumber' | 'openDialer') => readonly string[];
  /** How many times `fn` was called. */
  readonly timesCalled: (fn: PhoneFunction) => number;
  /** What `callPermission()` answers now. */
  permission: CallPermission;
  /** What `askCallPermission()` answers. */
  askAnswer: CallPermissionAnswer;
  /** Makes `fn` reject with `error`, recording the call all the same. */
  readonly fail: (fn: PhoneFunction, error: Error) => void;
  /** Lets `fn` answer again. */
  readonly recover: (fn: PhoneFunction) => void;
  /** Holds every `callNumber` from now until the hold is released or failed. */
  readonly holdCalls: () => CallHold;
  /** Holds every `callPermission()` read from now until the hold is released. */
  readonly holdPermission: () => PermissionHold;
  /** Forgets every call, every failure and every hold, and answers `notGranted` and `denied` again. */
  readonly reset: () => void;
}

export function fakePhone({ journal }: { journal?: string[] } = {}): FakePhone {
  let calls: PhoneCall[] = [];
  let failures = new Map<PhoneFunction, Error>();
  let hold: { settlers: { resolve: () => void; reject: (error: Error) => void }[] } | null = null;
  let permissionHold: { answers: (() => void)[] } | null = null;

  const record = (fn: PhoneFunction, number: string | null = null): void => {
    calls.push({ fn, number });
    journal?.push(`phone ${fn}`);
  };

  /** Rejects with the failure set for `fn`, if any. */
  const failure = (fn: PhoneFunction): Promise<never> | null => {
    const error = failures.get(fn);
    return error === undefined ? null : Promise.reject(error);
  };

  const fake: FakePhone = {
    module: {
      callNumber: (number) => {
        record('callNumber', number);
        if (hold !== null) {
          const waiting = hold;
          return new Promise<void>((resolve, reject) => {
            waiting.settlers.push({ resolve, reject });
          });
        }
        return failure('callNumber') ?? Promise.resolve();
      },
      openDialer: (number) => {
        record('openDialer', number);
        return failure('openDialer') ?? Promise.resolve();
      },
      callPermission: () => {
        record('callPermission');
        if (permissionHold !== null) {
          const waiting = permissionHold;
          return new Promise<CallPermission>((resolve, reject) => {
            waiting.answers.push(() => {
              const error = failures.get('callPermission');
              if (error === undefined) {
                resolve(fake.permission);
              } else {
                reject(error);
              }
            });
          });
        }
        return failure('callPermission') ?? Promise.resolve(fake.permission);
      },
      askCallPermission: () => {
        record('askCallPermission');
        const failed = failure('askCallPermission');
        if (failed !== null) {
          return failed;
        }
        if (fake.askAnswer === 'granted') {
          fake.permission = 'granted';
        }
        return Promise.resolve(fake.askAnswer);
      },
      openAppSettings: () => {
        record('openAppSettings');
        return failure('openAppSettings') ?? Promise.resolve();
      },
    },
    calls: () => [...calls],
    numbersGivenTo: (fn) => calls.filter((call) => call.fn === fn).map((call) => call.number ?? ''),
    timesCalled: (fn) => calls.filter((call) => call.fn === fn).length,
    permission: 'notGranted',
    askAnswer: 'denied',
    fail: (fn, error) => {
      failures.set(fn, error);
    },
    recover: (fn) => {
      failures.delete(fn);
    },
    holdCalls: () => {
      const current = { settlers: [] as { resolve: () => void; reject: (error: Error) => void }[] };
      hold = current;
      const end = (settle: (settler: (typeof current.settlers)[number]) => void) => {
        if (hold === current) {
          hold = null;
        }
        for (const settler of current.settlers.splice(0)) {
          settle(settler);
        }
      };
      return {
        release: () => {
          end((settler) => {
            settler.resolve();
          });
        },
        fail: (error) => {
          end((settler) => {
            settler.reject(error);
          });
        },
        waiting: () => current.settlers.length,
      };
    },
    holdPermission: () => {
      const current = { answers: [] as (() => void)[] };
      permissionHold = current;
      return {
        release: () => {
          if (permissionHold === current) {
            permissionHold = null;
          }
          for (const answer of current.answers.splice(0)) {
            answer();
          }
        },
        waiting: () => current.answers.length,
      };
    },
    reset: () => {
      calls = [];
      failures = new Map();
      hold = null;
      permissionHold = null;
      fake.permission = 'notGranted';
      fake.askAnswer = 'denied';
    },
  };
  return fake;
}
