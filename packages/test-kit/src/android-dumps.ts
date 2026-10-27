/**
 * What an Android emulator prints when the L7 script asks it about calls and
 * the dialer (CALL-01-AC2, CALL-01-AC4 and CALL-02-AC3): Telecom's record in
 * `adb shell dumpsys telecom`, the focused window in `adb shell dumpsys window`,
 * and the dialer role's holders in `adb shell cmd role get-role-holders
 * android.app.role.DIALER`; and, for CALL-01's approach 9 after PR #101's
 * first android-e2e, the phone's wakefulness in `adb shell dumpsys power`; and,
 * for BUG-70, the screen in `adb shell uiautomator dump` (hierarchyDump).
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

/*
 * BUG-70: the screen as `adb shell uiautomator dump <file>` writes it, so the
 * L7 script can name the screen a flow failed on (scripts/lib/screen-dump.mjs)
 * without printing what is on it (PRIV-07).
 *
 * The shape is AOSP's AccessibilityNodeInfoDumper's, cut down: one line, the
 * XML declaration, a <hierarchy rotation="0"> root, and a <node> per view, in
 * the tree's order, each with the attributes that dumper writes, in its order;
 * a node with no children closed as ` />`, as Android's XML serializer (kxml)
 * closes an empty element. Every node has the same bounds here, which nothing
 * reads. Not captured from CI's image: no session has read that image's dump.
 *
 * How a React Native view shows in it, from react-native 0.86.3's Android code
 * in apps/mobile/node_modules: a testID is the node's resource-id, as it is
 * (no package in front); an accessibilityLabel is its content-desc, alone (the
 * hint goes to the node's tooltip, not into content-desc); a Pressable with
 * the role "button" is an android.widget.Button. That an app's window holds
 * Android's content frame, `android:id/content`, is from Android apps' dumps
 * in general, not from this app's. Every text and number put in them is the
 * caller's, and synthetic (RG-07).
 */

/** A view in a uiautomator dump. Unset text, resource-id and content-desc are written empty, as the dumper writes them. */
export interface UiNode {
  /** The resource-id: React Native's testID, or a system app's `package:id/name`. */
  resourceId?: string;
  text?: string;
  /** The content-desc: React Native's accessibilityLabel. */
  contentDesc?: string;
  /** The class; android.view.ViewGroup when unset. */
  className?: string;
  /** The package; its parent's when unset, and the dump's for a root. */
  package?: string;
  clickable?: boolean;
  children?: readonly UiNode[];
}

/** What every node's bounds are said to be. */
const NODE_BOUNDS = '[0,0][1080,2400]';

/** The characters Android's XML serializer (kxml) writes as an entity in an attribute's value. */
const ATTRIBUTE_ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\n': '&#10;',
  '\r': '&#13;',
  '\t': '&#9;',
};

/** `value` as an attribute's value in the dump: &, <, > and " by name, a line break or a tab by its number. */
function xmlAttribute(value: string): string {
  return value.replace(/[&<>"\n\r\t]/g, (character) => ATTRIBUTE_ENTITIES[character] ?? character);
}

function nodeXml(node: UiNode, index: number, inherited: string): string {
  const pack = node.package ?? inherited;
  const clickable = String(node.clickable ?? false);
  const attributes: [string, string][] = [
    ['index', String(index)],
    ['text', node.text ?? ''],
    ['resource-id', node.resourceId ?? ''],
    ['class', node.className ?? 'android.view.ViewGroup'],
    ['package', pack],
    ['content-desc', node.contentDesc ?? ''],
    ['checkable', 'false'],
    ['checked', 'false'],
    ['clickable', clickable],
    ['enabled', 'true'],
    ['focusable', clickable],
    ['focused', 'false'],
    ['scrollable', 'false'],
    ['long-clickable', 'false'],
    ['password', 'false'],
    ['selected', 'false'],
    ['bounds', NODE_BOUNDS],
  ];
  const open = `<node ${attributes.map(([name, value]) => `${name}="${xmlAttribute(value)}"`).join(' ')}`;
  const children = node.children ?? [];
  if (children.length === 0) return `${open} />`;
  return `${open}>${children.map((child, at) => nodeXml(child, at, pack)).join('')}</node>`;
}

/**
 * The file `uiautomator dump` writes: these root views, each with its
 * children, every node without a package of its own in `pack`, the phone
 * upright (rotation 0).
 */
export function hierarchyDump(pack: string, roots: readonly UiNode[]): string {
  return [
    "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
    '<hierarchy rotation="0">',
    ...roots.map((root, at) => nodeXml(root, at, pack)),
    '</hierarchy>',
  ].join('');
}

/** A view with no resource-id, text or label: a layout, holding `children`. */
export function layoutNode(
  children: readonly UiNode[] = [],
  className = 'android.view.ViewGroup',
): UiNode {
  return { className, children };
}

/** React Native's <Text>: a TextView with its text, and its accessibilityLabel as content-desc when it has one. */
export function textNode(text: string, contentDesc = ''): UiNode {
  return { className: 'android.widget.TextView', text, contentDesc };
}

/** A Pressable with the role "button": its testID, its accessibilityLabel, and the texts drawn in it. */
export function buttonNode({
  id = '',
  label,
  texts = [],
}: {
  id?: string;
  label: string;
  texts?: readonly string[];
}): UiNode {
  return {
    className: 'android.widget.Button',
    resourceId: id,
    contentDesc: label,
    clickable: true,
    children: texts.map((text) => textNode(text)),
  };
}

/** React Native's ActivityIndicator with an accessibilityLabel: a ProgressBar. */
export function progressNode(label: string): UiNode {
  return { className: 'android.widget.ProgressBar', contentDesc: label };
}

/** React Native's TextInput: an EditText with its accessibilityLabel and the text typed in it. */
export function editTextNode(label: string, text = ''): UiNode {
  return { className: 'android.widget.EditText', contentDesc: label, text, clickable: true };
}

/**
 * An app's window: the decor view's frames, Android's content frame
 * (`android:id/content`) and React Native's root view, with `children` in it.
 */
export function appWindowNode(children: readonly UiNode[]): UiNode {
  return layoutNode(
    [
      layoutNode(
        [
          {
            className: 'android.widget.FrameLayout',
            resourceId: 'android:id/content',
            children: [layoutNode(children)],
          },
        ],
        'android.widget.LinearLayout',
      ),
    ],
    'android.widget.FrameLayout',
  );
}
