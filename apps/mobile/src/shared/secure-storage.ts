/**
 * What the phone keeps, in secure storage and nowhere else:
 *   - of its place in the group (GRP-01, approach item 4): the device
 *     credential the join answered with, and the join key the app made for its
 *     join;
 *   - the walker's #1 contact (GRP-02, approach item 4; Q1, D-141: on the
 *     phone only), as one JSON value `{ name, number }` under its own key.
 *     Never sent to the server, and written nowhere else.
 * Android keeps them in its Keystore; `allowBackup: false` keeps them out of
 * any backup, so a restore cannot move a login bound to one phone onto
 * another (D-081), and a new phone starts with no #1.
 *
 * Readable after the phone's first unlock, so a journey's heartbeats can run
 * while it is locked, and the call button works on a phone that restarted in a
 * pocket; and never moved to another device.
 */
import * as SecureStore from 'expo-secure-store';

const CREDENTIAL = 'deviceCredential';
const JOIN_KEY = 'joinKey';
const FIRST_CONTACT = 'firstContact';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const secureStorage = {
  readCredential: (): Promise<string | null> => SecureStore.getItemAsync(CREDENTIAL, OPTIONS),
  saveCredential: (credential: string): Promise<void> =>
    SecureStore.setItemAsync(CREDENTIAL, credential, OPTIONS),
  deleteCredential: (): Promise<void> => SecureStore.deleteItemAsync(CREDENTIAL, OPTIONS),
  readJoinKey: (): Promise<string | null> => SecureStore.getItemAsync(JOIN_KEY, OPTIONS),
  saveJoinKey: (joinKey: string): Promise<void> =>
    SecureStore.setItemAsync(JOIN_KEY, joinKey, OPTIONS),
  /** #1 as stored, unread: the caller decides whether it is a #1 at all. */
  readFirstContact: (): Promise<string | null> => SecureStore.getItemAsync(FIRST_CONTACT, OPTIONS),
  /** Exactly `{ name, number }`, and nothing else the caller's object might hold. */
  saveFirstContact: ({ name, number }: { name: string; number: string }): Promise<void> =>
    SecureStore.setItemAsync(FIRST_CONTACT, JSON.stringify({ name, number }), OPTIONS),
  deleteFirstContact: (): Promise<void> => SecureStore.deleteItemAsync(FIRST_CONTACT, OPTIONS),
};
