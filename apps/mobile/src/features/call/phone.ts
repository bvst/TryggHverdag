/**
 * The phone's calling path, and the one module that reaches it (CALL-01,
 * approach 1): place a call, open the dialer, read and ask for Android's call
 * permission, open the app's settings. Screens never touch the platform for
 * a call, so the app's L5 tests fake this module and nothing else.
 *
 * What it does with a number, whatever number it is given (CALL-01, approach
 * 2; D-141 (a), (e), (f)). It leans on no other module's normalisation, so
 * this file alone, an owned path, decides what reaches ACTION_CALL:
 *   - it cleans the number: whitespace, `-`, `.`, `(` and `)` go, nothing
 *     else changes, and every `tel:` URI is built from what is left;
 *   - what is then not a plain number (`^\+?[0-9]+$`, ASCII digits) goes to
 *     the dialer, every character but the digits and a first `+`
 *     percent-encoded, so Android reads no `,`, `;` or `#` as a delimiter, and
 *     no letter or other script's digit as a digit, on the way to ACTION_CALL;
 *   - a plain number is reduced for the emergency check, in a loop until
 *     nothing changes: a leading +47 goes, else 0047, else +;
 *   - an emergency number goes to the dialer with the reduced digits:
 *     exactly 112, 911, 110, 113, 000, 08, 118, 119 or 999, or one of 110,
 *     112, 113, 000, 118 and 119 followed by more digits. 911, 999 and 08
 *     followed by more are the shapes of real Norwegian numbers, and call.
 *     Android's documented rule is that ACTION_CALL "cannot be used to call
 *     emergency numbers"; what it does with one anyway is undocumented, so it
 *     is never given one;
 *   - any other number, with CALL_PHONE held, is called at once with
 *     ACTION_CALL through expo-intent-launcher (SPIKE-01, S6); without it, or
 *     when ACTION_CALL is refused, it opens the dialer with the number in it,
 *     where the walker taps call; when both fail, the promise rejects, so the
 *     screen can say so with the number.
 * It never asks `Linking.canOpenURL` first: on Android 11 and later that
 * answers false without a <queries> entry, which would turn a working button
 * into a refusal.
 *
 * Nothing here logs, and nothing here holds a number after it returns
 * (PRIV-07).
 */
import { startActivityAsync } from 'expo-intent-launcher';
import { Linking, PermissionsAndroid, Platform } from 'react-native';

/** Android's ACTION_CALL, which places the call with no second tap. */
const ACTION_CALL = 'android.intent.action.CALL';

/** What phone.ts removes from a number, and nothing else. */
const SEPARATORS = /[\s\-.()]/g;

/** A plain number: an optional first +, then ASCII digits only. */
const PLAIN = /^\+?[0-9]+$/;

/** Emergency numbers, exactly (CALL-01, approach 2). */
const EMERGENCY = new Set(['112', '911', '110', '113', '000', '08', '118', '119', '999']);

/** Emergency numbers that send a longer number to the dialer too. 911, 999 and 08 do not. */
const EMERGENCY_PREFIXES = ['110', '112', '113', '000', '118', '119'];

/** The prefixes the reduction drops, in the order it tries them. */
const REDUCED_PREFIXES = ['+47', '0047', '+'];

/** What the phone says of the call permission now. */
export type CallPermission = 'granted' | 'notGranted';

/** What Android answers a request for it; `neverAskAgain` once it shows no dialog any more. */
export type CallPermissionAnswer = 'granted' | 'denied' | 'neverAskAgain';

/** The number as typed, with phone.ts's own separators gone. */
function cleaned(number: string): string {
  return number.replace(SEPARATORS, '');
}

/** A plain number with every leading +47, 0047 or + dropped, until nothing changes. */
function reduced(plain: string): string {
  let number = plain;
  for (;;) {
    const prefix = REDUCED_PREFIXES.find((each) => number.startsWith(each));
    if (prefix === undefined) {
      return number;
    }
    number = number.slice(prefix.length);
  }
}

function isEmergency(number: string): boolean {
  return (
    EMERGENCY.has(number) ||
    EMERGENCY_PREFIXES.some((prefix) => number.length > prefix.length && number.startsWith(prefix))
  );
}

/** One character, percent-encoded as its UTF-8 bytes, whatever it is. */
function percentEncoded(character: string): string {
  const encoded = encodeURIComponent(character);
  if (encoded !== character) {
    return encoded;
  }
  // encodeURIComponent leaves letters and a few marks as they are.
  return `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
}

/** A `tel:` URI holding `number`, every character but the digits and a first + percent-encoded. */
function telUri(number: string): string {
  const encoded = Array.from(number)
    .map((character, at) =>
      /^[0-9]$/.test(character) || (at === 0 && character === '+')
        ? character
        : percentEncoded(character),
    )
    .join('');
  return `tel:${encoded}`;
}

/** The dialer, with `uri` in it: Android opens a `tel:` link as ACTION_VIEW, and the dialer answers. */
async function dial(uri: string): Promise<void> {
  await Linking.openURL(uri);
}

/** Whether the app holds Android's CALL_PHONE now. Not asked: read. */
export async function callPermission(): Promise<CallPermission> {
  if (Platform.OS !== 'android') {
    return 'notGranted';
  }
  const held = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CALL_PHONE);
  return held ? 'granted' : 'notGranted';
}

/** Asks Android for CALL_PHONE, with Android's own dialog, unless it will no longer show one. */
export async function askCallPermission(): Promise<CallPermissionAnswer> {
  if (Platform.OS !== 'android') {
    return 'denied';
  }
  const answer = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CALL_PHONE);
  if (answer === PermissionsAndroid.RESULTS.GRANTED) {
    return 'granted';
  }
  return answer === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'neverAskAgain' : 'denied';
}

/** The app's own page in Android's settings, where the permission is given by hand. */
export async function openAppSettings(): Promise<void> {
  await Linking.openSettings();
}

/** The phone's own dialer with `number` in it, cleaned. It places no call: the walker does (112, CALL-02). */
export async function openDialer(number: string): Promise<void> {
  await dial(telUri(cleaned(number)));
}

/**
 * Calls `number` (CALL-01-AC2, AC4, AC5): on the tap with CALL_PHONE, through
 * the dialer without it or for an emergency number. Rejects only when neither
 * way started.
 */
export async function callNumber(number: string): Promise<void> {
  const plain = cleaned(number);
  if (!PLAIN.test(plain)) {
    await dial(telUri(plain));
    return;
  }
  const digits = reduced(plain);
  if (isEmergency(digits)) {
    await dial(telUri(digits));
    return;
  }
  const uri = telUri(plain);
  if ((await callPermission()) === 'granted') {
    try {
      await startActivityAsync(ACTION_CALL, { data: uri });
      return;
    } catch {
      // Refused, though the permission was read as held: the dialer instead.
    }
  }
  await dial(uri);
}
