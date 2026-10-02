// req-coverage: fixtures-only — this tests the test kit, not a requirement.
//
// The API's system tests prove "every request comes from a known device" by
// what this fake answers. A fake that accepted a removed device, answered
// null where it should reject, or could not fail at all would not go red: it
// would make those tests pass whatever the middleware did.
import { describe, expect, test } from 'vitest';
import { fakeDeviceAuthenticator } from './fake-device-authenticator.ts';
import * as kit from './index.ts';
import { syntheticCredential, syntheticUuid } from './synthetic-ids.ts';

describe('fakeDeviceAuthenticator', () => {
  test('a registered device’s credential names that device and its user', async () => {
    const devices = fakeDeviceAuthenticator();
    const { credential, deviceId, userId } = devices.register();

    await expect(devices.authenticate(credential)).resolves.toEqual({ deviceId, userId });
  });

  test('each registration is a new device, a new user and a new credential', () => {
    const devices = fakeDeviceAuthenticator();

    const first = devices.register();
    const second = devices.register();

    expect(second.credential).not.toBe(first.credential);
    expect(second.deviceId).not.toBe(first.deviceId);
    expect(second.userId).not.toBe(first.userId);
  });

  test('a second device for an existing user is that user’s, with its own credential', async () => {
    const devices = fakeDeviceAuthenticator();
    const first = devices.register();

    const second = devices.register({ userId: first.userId });

    expect(second.credential).not.toBe(first.credential);
    await expect(devices.authenticate(second.credential)).resolves.toEqual({
      deviceId: second.deviceId,
      userId: first.userId,
    });
  });

  test('a credential no device has is null, not an error', async () => {
    const devices = fakeDeviceAuthenticator();
    devices.register();

    await expect(devices.authenticate(syntheticCredential())).resolves.toBeNull();
    await expect(devices.authenticate('')).resolves.toBeNull();
  });

  test('a removed device’s credential is null from then on, and the others still work', async () => {
    const devices = fakeDeviceAuthenticator();
    const gone = devices.register();
    const kept = devices.register();

    devices.remove(gone.deviceId);

    await expect(devices.authenticate(gone.credential)).resolves.toBeNull();
    await expect(devices.authenticate(kept.credential)).resolves.toEqual({
      deviceId: kept.deviceId,
      userId: kept.userId,
    });
  });

  test('removing a device that was never registered throws, rather than proving nothing', () => {
    const devices = fakeDeviceAuthenticator();

    expect(() => {
      devices.remove(syntheticUuid());
    }).toThrow(/no device/);
  });

  test('while failing, every check rejects with exactly the error given, known credential or not', async () => {
    const devices = fakeDeviceAuthenticator();
    const { credential } = devices.register();
    const error = new Error('the database did not answer');

    devices.failWith(error);

    await expect(devices.authenticate(credential)).rejects.toBe(error);
    await expect(devices.authenticate(syntheticCredential())).rejects.toBe(error);
  });

  test('answers again after recovering', async () => {
    const devices = fakeDeviceAuthenticator();
    const { credential, deviceId, userId } = devices.register();
    devices.failWith(new Error('the database did not answer'));

    devices.recover();

    await expect(devices.authenticate(credential)).resolves.toEqual({ deviceId, userId });
  });

  test('counts every check it was asked for, answered, null or failed', async () => {
    const devices = fakeDeviceAuthenticator();
    const { credential } = devices.register();
    expect(devices.calls).toBe(0);

    await devices.authenticate(credential);
    await devices.authenticate(syntheticCredential());
    devices.failWith(new Error('the database did not answer'));
    await devices.authenticate(credential).catch(() => undefined);

    expect(devices.calls).toBe(3);
  });

  test('what it hands back cannot change what it holds', async () => {
    const devices = fakeDeviceAuthenticator();
    const registered = devices.register();
    const found = await devices.authenticate(registered.credential);

    if (found !== null) {
      found.userId = syntheticUuid();
    }

    await expect(devices.authenticate(registered.credential)).resolves.toEqual({
      deviceId: registered.deviceId,
      userId: registered.userId,
    });
  });

  test('the test kit hands it out', () => {
    expect(kit.fakeDeviceAuthenticator).toBe(fakeDeviceAuthenticator);
  });
});
