/**
 * Device credentials: issued, and checked against the `devices` table
 * (SEC-07, GRP-01).
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
 * This adapter issues a credential and checks one; it creates no user and no
 * device of its own. `issueCredential` takes 32 bytes of
 * `crypto.randomBytes` (D-091), and the join's store (`adapters/groups.ts`)
 * writes the device with its hash, under an ID the database makes, never a
 * constant (GRP-01, approach item 4). The one other thing in the code that
 * creates a device is the worker's registration of the staging canary's three
 * fixed identities, in `adapters/canary.ts`, which only `worker.ts` may import
 * and the API cannot reach (D-091 as D-128 amends it, held by an import rule).
 * A freshly migrated database holds no user and no device.
 *
 * Membership is the session (GRP-01, approach item 5, D-137). One query
 * answers the device, its user, and how far it is admitted: FULL while its
 * user is a current member, or it is the canary's device, which has no
 * membership (D-128); WALKER_ONLY while it is a removed member's device that
 * started a journey not yet ended (D-136, answer 5); otherwise not at all, as
 * a credential no device has. So removing a membership signs out every device
 * of that user at its commit, with no column to forget.
 */
import { and, eq, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { devices, journeys, memberships, unended } from '../db/schema.ts';
import { CANARY_DEVICE_ID } from '../domain/canary.ts';
import type { AuthenticatedDevice, DeviceAuthenticator } from '../ports.ts';
import type { Database } from './db.ts';

/** What the `devices` table keeps of a credential: its SHA-256, as hex. */
export function hashCredential(credential: string): string {
  return createHash('sha256').update(credential, 'utf8').digest('hex');
}

/** How many random bytes a credential is (D-091): 256 bits, on which a plain SHA-256 rests. */
const CREDENTIAL_BYTES = 32;

/**
 * A new device credential (GRP-01-AC7, D-091): 32 bytes of
 * `crypto.randomBytes`, base64url, 43 characters, and the SHA-256 the table
 * keeps of it. A failure of the random source is thrown, never answered with
 * a credential made some other way.
 */
export function issueCredential(): { credential: string; hash: string } {
  const credential = randomBytes(CREDENTIAL_BYTES).toString('base64url');
  return { credential, hash: hashCredential(credential) };
}

export function databaseDeviceAuthenticator(db: Database): DeviceAuthenticator {
  return {
    // Rejects when the database cannot answer, rather than answering null:
    // null means "not a valid credential", and the API answers that with 401.
    async authenticate(credential: string): Promise<AuthenticatedDevice | null> {
      // One statement: the device, its user's membership (the user is that
      // table's key, so one row at most), and the journey it started that
      // has not ended (a walker has one at most), joined, never read apart.
      const rows = await db
        .select({
          deviceId: devices.id,
          userId: devices.userId,
          access: sql<string | null>`case
            when ${memberships.userId} is not null or ${devices.id} = ${CANARY_DEVICE_ID} then 'FULL'
            when ${journeys.id} is not null then 'WALKER_ONLY'
          end`,
        })
        .from(devices)
        .leftJoin(memberships, eq(memberships.userId, devices.userId))
        .leftJoin(journeys, and(eq(journeys.deviceId, devices.id), unended(journeys.state)))
        .where(eq(devices.credentialHash, hashCredential(credential)))
        .limit(1);

      const [row] = rows;
      if (row === undefined) {
        return null;
      }
      const { deviceId, userId, access } = row;
      if (access === 'FULL' || access === 'WALKER_ONLY') {
        return { deviceId, userId, access };
      }
      // A device whose user is no member and that walks no journey: admitted
      // nowhere, the same as a credential no device has.
      return null;
    },
  };
}
