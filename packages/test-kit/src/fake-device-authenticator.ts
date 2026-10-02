/**
 * Device credentials, in memory (SEC-07, AR-02).
 *
 * Stands in for the adapter that looks a credential's hash up in the
 * `devices` table. A test registers a device and gets back the credential the
 * app would send, the device's ID and its user's ID; the API's middleware
 * then asks this fake who a credential belongs to, exactly as it asks the
 * real adapter.
 *
 * It answers the three ways the real adapter answers, and no other:
 *   - the device and its user, for a credential a device has;
 *   - `null`, for one no device has, including one whose device was removed;
 *   - a rejection, when it cannot check at all (`failWith`), as the adapter
 *     does when the database does not answer. That is the case that must be a
 *     500 and never a 401: a 401 tells the app its credential is bad.
 *
 * Credentials are generated at run time (RG-07); none is ever written out.
 * Matches the server's DeviceAuthenticator port by shape, so the test kit
 * needs no import from the server.
 */
import { syntheticCredential, syntheticUuid } from './synthetic-ids.ts';

/** Who a credential belongs to. */
export interface AuthenticatedDevice {
  deviceId: string;
  userId: string;
}

/** A device a test registered: what the app would hold, and who it is. */
export interface RegisteredDevice extends AuthenticatedDevice {
  credential: string;
}

export interface FakeDeviceAuthenticator {
  /** The device and its user, `null` for a credential no device has; rejects while failing. */
  authenticate(credential: string): Promise<AuthenticatedDevice | null>;
  /**
   * A new device with a fresh credential. Its user is new too, unless a test
   * names an existing one: a second phone for the same person.
   */
  register(options?: { userId?: string }): RegisteredDevice;
  /** The device's row is gone: its credential is from now on one no device has. */
  remove(deviceId: string): void;
  /** How many credentials it was asked to check, answered or not. */
  readonly calls: number;
  /** From now on every check rejects with this error, as when the database is gone. */
  failWith(error: Error): void;
  /** Checks answer again. */
  recover(): void;
}

export function fakeDeviceAuthenticator(): FakeDeviceAuthenticator {
  const byCredential = new Map<string, AuthenticatedDevice>();
  let calls = 0;
  let failure: Error | null = null;

  return {
    authenticate(credential: string): Promise<AuthenticatedDevice | null> {
      calls += 1;
      if (failure !== null) {
        return Promise.reject(failure);
      }
      const device = byCredential.get(credential);
      return Promise.resolve(device === undefined ? null : { ...device });
    },
    register({ userId = syntheticUuid() }: { userId?: string } = {}): RegisteredDevice {
      const credential = syntheticCredential();
      const device = { deviceId: syntheticUuid(), userId };
      byCredential.set(credential, device);
      return { credential, ...device };
    },
    remove(deviceId: string): void {
      for (const [credential, device] of byCredential) {
        if (device.deviceId === deviceId) {
          byCredential.delete(credential);
          return;
        }
      }
      throw new Error(
        `fakeDeviceAuthenticator.remove: no device ${deviceId} was registered, so the test ` +
          'would prove nothing about a removed one.',
      );
    },
    get calls(): number {
      return calls;
    },
    failWith(error: Error): void {
      failure = error;
    },
    recover(): void {
      failure = null;
    },
  };
}
