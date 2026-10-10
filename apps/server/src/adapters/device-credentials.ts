/**
 * Device credentials, checked against the `devices` table (SEC-07).
 *
 * A credential is 32 random bytes the device holds; the table holds only its
 * SHA-256. A copy of the database therefore holds no working credential: the
 * server hashes whatever it is given, so presenting a stored hash gets nothing.
 * A plain SHA-256 is enough for a 256-bit random secret; a slow password hash
 * would only slow every request.
 *
 * The credential itself is never bound into a query or written anywhere: only
 * its hash is. A failed query can carry its parameters into an error message,
 * and the hash in there opens nothing.
 *
 * This adapter can only check a credential. Until the login task, one thing in
 * the code creates a user, a device or a credential, and it is not here: the
 * worker's registration of the staging canary's three fixed identities, in
 * `adapters/canary.ts`, which only `worker.ts` may import and the API cannot
 * reach (D-091 as D-128 amends it, held by an import rule). Nothing else can:
 * a freshly migrated database holds no user and no device, and tests insert
 * rows directly, through `hashCredential`.
 */
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { devices } from '../db/schema.ts';
import type { AuthenticatedDevice, DeviceAuthenticator } from '../ports.ts';
import type { Database } from './db.ts';

/** What the `devices` table keeps of a credential: its SHA-256, as hex. */
export function hashCredential(credential: string): string {
  return createHash('sha256').update(credential, 'utf8').digest('hex');
}

export function databaseDeviceAuthenticator(db: Database): DeviceAuthenticator {
  return {
    // Rejects when the database cannot answer, rather than answering null:
    // null means "not a valid credential", and the API answers that with 401.
    async authenticate(credential: string): Promise<AuthenticatedDevice | null> {
      const rows = await db
        .select({ deviceId: devices.id, userId: devices.userId })
        .from(devices)
        .where(eq(devices.credentialHash, hashCredential(credential)))
        .limit(1);

      return rows[0] ?? null;
    },
  };
}
