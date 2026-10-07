/**
 * The SMS port, recording (LOST-07, D-019, D-086).
 *
 * Stands in for the SMS provider M3's adapter will reach (LINK Mobility,
 * D-086). A system test hands this to the SMS sender and reads back exactly
 * which messages reached the port, in order, and with what in them: "every
 * responder got an SMS" is proven by what was accepted here, and "content-free"
 * by the keys each message carried. In M2 nothing composes text: the port is
 * handed the message's opaque ID, the recipient's user ID and the kind, as the
 * push port is, so no location, name or number can reach it (the spec's
 * reading 9). No phone number exists in M2 (D-115), so none is handed here.
 *
 * It behaves exactly as `fakePush()` does, and is built from it, so the two
 * fakes cannot drift apart: it records every message it is handed, as given,
 * whatever it answers; it accepts every message unless told otherwise; it can
 * be told to answer one of the port's four reasons (`NO_TARGET` is "no
 * confirmed number" for SMS) for one recipient or for all, to throw, to
 * recover, and to hold its answers until released, for a provider that is
 * slow or never answers. It counts a message as accepted only once its answer
 * has settled. Each `fakeSms()` keeps its own record, apart from any push
 * fake's.
 *
 * Matches the server's Sms port by shape, so the test kit needs no import
 * from the server.
 */
import { fakePush, type FakePush, type PushMessage, type PushResult } from './fake-push.ts';

/** A message as the SMS sender hands it to the port: who and what kind, and nothing personal. */
export type SmsMessage = PushMessage;

/** Accepted, or not, and why: the push port's four reasons (the spec's approach item 7). */
export type SmsResult = PushResult;

/** The recording SMS port: what `fakePush()` offers, for SMS. */
export type FakeSms = FakePush;

export function fakeSms(): FakeSms {
  return fakePush();
}
