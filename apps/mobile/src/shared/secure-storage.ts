/**
 * What the phone keeps of its place in the group, in secure storage and
 * nowhere else (GRP-01, approach item 4): the device credential the join
 * answered with, and the join key the app made for its join. Android keeps
 * them in its Keystore; `allowBackup: false` keeps them out of any backup, so
 * a restore cannot move a login bound to one phone onto another (D-081).
 *
 * Readable after the phone's first unlock, so a journey's heartbeats can run
 * while it is locked, and never moved to another device.
 */
import * as SecureStore from 'expo-secure-store';

const CREDENTIAL = 'deviceCredential';
const JOIN_KEY = 'joinKey';

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
};
