// Putting the API on a port. Clever Cloud checks that something listens on
// port 8080 on a public interface before it sends traffic, and fails the
// deploy with "listening on localhost instead of publicly" otherwise — so the
// address is asserted, not assumed.
import { fakeClock, fakeDeviceAuthenticator, fakeWorkerHeartbeats } from '@trygghverdag/test-kit';
import { describe, expect, test } from 'vitest';
import { createApi } from './api.ts';
import { listen } from './http.ts';
import { createHealthService } from './modules/health/service.ts';

const NOW = new Date('2026-09-24T21:00:00.000Z');

function api() {
  return createApi({
    health: createHealthService({ clock: fakeClock(NOW), heartbeats: fakeWorkerHeartbeats(NOW) }),
    // These tests are about the port; they start no journey, so the journey
    // service fails loudly if anything calls it. RG-03: `heartbeat` added
    // because LOST-01 made it part of the journey service; it rejects too.
    // RG-03 (LOST-03): `home` added because "I'm home" (D-110) made it part
    // of the journey service too; it rejects as well, and these tests never
    // call it, so nothing they assert changes.
    journeys: {
      start: () => Promise.reject(new Error('the port tests start no journey')),
      heartbeat: () => Promise.reject(new Error('the port tests send no heartbeat')),
      home: () => Promise.reject(new Error('the port tests end no journey')),
    },
    devices: fakeDeviceAuthenticator(),
  });
}

describe('listen', () => {
  test('listens on every interface, not only on localhost', async () => {
    const server = await listen(api(), 0);

    try {
      expect(server.address).toBe('0.0.0.0');
    } finally {
      await server.close();
    }
  });

  test('reports the port it got, and answers on it', async () => {
    const server = await listen(api(), 0);

    try {
      expect(server.port).toBeGreaterThan(0);
      const response = await fetch(`http://127.0.0.1:${String(server.port)}/v1/health`);
      expect(response.status).toBe(200);
    } finally {
      await server.close();
    }
  });

  test('once closed, it no longer accepts connections', async () => {
    const server = await listen(api(), 0);

    await server.close();

    await expect(fetch(`http://127.0.0.1:${String(server.port)}/v1/health`)).rejects.toThrow();
  });

  test('closing a server that is already closed is reported, not ignored', async () => {
    const server = await listen(api(), 0);
    await server.close();

    await expect(server.close()).rejects.toThrow(/not running/);
  });

  test('a port that is already taken is an error, not a silent second server', async () => {
    const first = await listen(api(), 0);

    try {
      await expect(listen(api(), first.port)).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await first.close();
    }
  });
});
