/**
 * What an Android emulator prints when the L7 script asks it about calls and
 * the dialer (CALL-01-AC2, CALL-01-AC4 and CALL-02-AC3): Telecom's record in
 * `adb shell dumpsys telecom`, the focused window in `adb shell dumpsys window`,
 * and the dialer role's holders in `adb shell cmd role get-role-holders
 * android.app.role.DIALER`; and, for CALL-01's approach 9 after PR #101's
 * first android-e2e, the phone's wakefulness in `adb shell dumpsys power`.
 *
 * Shared by the tests of scripts/lib/call-records.mjs, which read these
 * dumps, and by the stand-in emulator of scripts/e2e-android.test.mjs, which
 * prints them between the flows (CALL-01, approach 9), so both hold one shape.
 *
 * The shapes are the real dumps', cut down: Telecom's from SPIKE-01's dry run
 * on 2026-09-30 (spikes/background-safety/analysis/s6.test.mjs), with its
 * dates rewritten to 2031 and its locale's date format; the window's and the
 * role's as Android 14 prints them. Every package name and number put in them
 * is the caller's, and synthetic (RG-07).
 */

/** The dialer the emulator's image holds the dialer role with. */
export const DIALER_PACKAGE = 'com.google.android.dialer';

/** The phone account every call on the emulator goes through. */
const TELEPHONY =
  'ComponentInfo{com.android.phone/com.android.services.telephony.TelephonyConnectionService}, 1, UserHandle{0}';

/** A number as Telecom shows it in its record: `tel:`, then all but its last two characters masked. */
export function maskedAddress(number: string): string {
  return `tel:${'*'.repeat(Math.max(number.length - 2, 0))}${number.slice(-2)}`;
}

/** The dump down to its "Historical Events:" heading, as the emulator prints it. */
export function telecomHead(dialer: string = DIALER_PACKAGE): string[] {
  return [
    'Init Path: On mainline',
    'TelecomUI package: com.google.android.telecomui',
    'CallsManager: ',
    '  mCalls: ',
    '  mCallAudioManager:',
    '    All calls:',
    '    Foreground call:',
    '    null',
    '  mDefaultDialerCache:',
    `    User 0: ${dialer}`,
    'PhoneAccountRegistrar: ',
    `  defaultOutgoing: ${TELEPHONY}`,
    'TransactionManager: ',
    '  Completed Transactions:',
    'Historical Events:',
  ];
}

/**
 * A call's events from CREATED to SET_DIALING, as the sample has them: placed
 * and dialling, and not yet ended, so a call still in progress (CALL-01,
 * approach 9: the end-call key only while Telecom shows one). `by` is the
 * package that placed it.
 */
export function dialingEvents(by: string, address: string): string[] {
  return [
    `21:00:00.556 - CREATED (${by};requestedAcct:none, selfMgd:false):TSI.pC(cgat)@AOA`,
    `21:00:00.575 - SET_CONNECTING (${TELEPHONY}):TSI.pC->CM.fOCP(cgat)@AOA`,
    `21:00:01.436 - START_CONNECTION (${address} via:com.android.phone):SBC.oSC(cap)@AOM`,
    '21:00:02.599 - SET_DIALING (dialing set explicitly):(...->CS.crCo)->CSW.hCCC(cap/cast)@E-E-AOM',
  ];
}

/**
 * The events Telecom adds to a call's record as it ends, as the sample has
 * them: disconnected (there, by the network, REMOTE, 0.14 s after dialling),
 * logged, and destroyed. SET_DISCONNECTED and DESTROYED are Telecom's own
 * names for a call that has ended (SPIKE-01's s6.test.mjs).
 */
export function endingEvents(address: string): string[] {
  return [
    '21:00:02.743 - SET_DISCONNECTED (disconnected set explicitly> DisconnectCause [ Code: (REMOTE) ]):CSW.sDc(cap)@AQA',
    `21:00:02.818 - LOG_CALL (number=${address.slice(4)},postDial=,pres=1,code=REMOTE):CSW.sDc(cap)@AQA`,
    '21:00:03.007 - DESTROYED:CSW.rC->CM.pR(cap)@AQ0',
  ];
}

/** A call's events, from CREATED on, as the sample has them, ended; `by` is the package that placed it. */
export function dialledEvents(by: string, address: string): string[] {
  return [...dialingEvents(by, address), ...endingEvents(address)];
}

/** One call's record under "Historical Events:". */
export function callRecord({
  id,
  direction = 'MO - outgoing',
  address,
  events,
}: {
  id: number | string;
  direction?: string;
  address: string;
  events: string[];
}): string[] {
  return [
    `  CallTC@${String(id)}/1112 [1. jan. 2031 21:00:00](${direction})(User=UserHandle{0})`,
    `  \t>>>Target PhoneAccount: ${TELEPHONY} (T-Mobile)`,
    `  \tTo address: ${address} Presentation: Allowed`,
    ...events.map((event) => `    ${event}`),
    '    Timings (average for this call, milliseconds):',
    '      outgoing_time_to_dialing: 1163,00',
  ];
}

/** `adb shell dumpsys telecom` holding these calls' records, oldest first. */
export function telecomDump(calls: readonly string[][], dialer: string = DIALER_PACKAGE): string {
  return `${[...telecomHead(dialer), ...calls.flat()].join('\n')}\n`;
}

/** `adb shell dumpsys window`, cut down to what the reader reads, with `focus` as the focused window. */
export function windowDump(focus: string, app: string = focus): string {
  return [
    'WINDOW MANAGER WINDOWS (dumpsys window windows)',
    '  Window #0 Window{1a2b3c4 u0 NavigationBar0}:',
    '  Window #1 Window{5d6e7f8 u0 StatusBar}:',
    `  mCurrentFocus=${focus}`,
    `  mFocusedApp=${app}`,
    '',
  ].join('\n');
}

/** The dialer's main window, focused. */
export function dialerWindow(dialer: string = DIALER_PACKAGE): string {
  return `Window{4f3b2a1 u0 ${dialer}/com.google.android.dialer.extensions.GoogleDialtactsActivity}`;
}

/** An app's main window, focused. */
export function appWindow(app: string): string {
  return `Window{9c8b7a6 u0 ${app}/${app}.MainActivity}`;
}

/** `adb shell cmd role get-role-holders <role>`: one package per line. */
export function roleHoldersOutput(packages: readonly string[]): string {
  return packages.map((name) => `${name}\n`).join('');
}

/**
 * The values `mWakefulness=` takes in `adb shell dumpsys power`, as
 * PowerManagerInternal.wakefulnessToString names them. Only `Awake` is a phone
 * whose screen Maestro can read (CALL-01, approach 9).
 */
export const WAKEFULNESS = ['Awake', 'Asleep', 'Dreaming', 'Dozing'] as const;

/**
 * `adb shell dumpsys power`, cut down to its head and the lines around the
 * wakefulness, in the order AOSP's PowerManagerService prints them. Not
 * captured from CI's image: no session has read that image's dump, so the
 * shape is AOSP's, and the one line the script reads is `mWakefulness=`
 * (CALL-01, approach 9). `mWakefulnessChanging=` stays beside it, so a reader
 * that matches only the line's start is caught. With `wakefulness` null, the
 * `mWakefulness=` line is left out and nothing else changes.
 */
export function powerDump(wakefulness: string | null): string {
  return [
    'POWER MANAGER (dumpsys power)',
    '',
    'Power Manager State:',
    '  Settings power_manager_constants:',
    '    no_cached_wake_locks=true',
    '  mDirty=0x0',
    ...(wakefulness === null ? [] : [`  mWakefulness=${wakefulness}`]),
    '  mWakefulnessChanging=false',
    '  mIsPowered=true',
    '  mPlugType=1',
    '  mBootCompleted=true',
    '  mSystemReady=true',
    '  mHalAutoSuspendModeEnabled=false',
    '  mHalInteractiveModeEnabled=true',
    '  mWakeLockSummary=0x0',
    '',
    'Wake Locks: size=0',
    '',
  ].join('\n');
}
