/**
 * The test kit: in-memory fakes for every adapter, data builders and a clock
 * tests can move by hand (AR-02). Test data is always built here, never copied
 * from real people (RG-07).
 *
 * Nothing here imports the server. The fakes match the server's ports by shape
 * rather than by import, so the test kit stays usable from the app as well and
 * cannot drag server code into a test bundle.
 */
import { API_VERSION } from '@trygghverdag/contracts';

export { fakeClock } from './fake-clock.ts';
export type { FakeClock } from './fake-clock.ts';
export { BEAT_RECORDED, fakeWorkerHeartbeats } from './fake-worker-heartbeats.ts';
export type { FakeWorkerHeartbeats } from './fake-worker-heartbeats.ts';
export { CHECKED_IN, CHECK_IN_ABORTED, fakeCheckIn } from './fake-check-in.ts';
export type { AbortSignalLike, FakeCheckIn } from './fake-check-in.ts';
export { fakeSms } from './fake-sms.ts';
export type { FakeSms, SmsMessage, SmsResult } from './fake-sms.ts';
export { SMS_ALARM_ABORTED, SMS_ALARM_REPORTED, fakeSmsAlarm } from './fake-sms-alarm.ts';
export type { FakeSmsAlarm, SmsAlarmReport, SmsAlarmStatus } from './fake-sms-alarm.ts';
export { MESSAGE_KINDS, PUSH_FAILURE_REASONS, fakePush } from './fake-push.ts';
export type {
  FakePush,
  MessageKind,
  PushFailureReason,
  PushMessage,
  PushResult,
} from './fake-push.ts';
export { SYNTHETIC_CHECK_UUID, SYNTHETIC_PING_URL, syntheticPingUrl } from './ping-url.ts';
export { CREDENTIAL_BYTES, syntheticCredential, syntheticUuid } from './synthetic-ids.ts';
export { fakeDeviceAuthenticator } from './fake-device-authenticator.ts';
export type {
  AuthenticatedDevice,
  FakeDeviceAuthenticator,
  RegisteredDevice,
} from './fake-device-authenticator.ts';
export {
  ALERT_RESOLUTIONS,
  JOURNEY_END_REASONS,
  JOURNEY_MESSAGE_KINDS,
  PUSH_KINDS,
  SMS_KINDS,
  WITHDRAWN_WHEN_ACKNOWLEDGED,
  WITHDRAWN_WHEN_OPENED,
  WITHDRAWN_WHEN_REMOVED,
  WITHDRAWN_WHEN_RESET,
  WITHDRAWN_WHEN_RESOLVED,
  fakeJourneyStore,
} from './fake-journey-store.ts';
export type {
  AcknowledgementNotRecorded,
  AcknowledgementToRecord,
  CanaryObservation,
  StoredDevice,
  AlertForAcknowledgement,
  AlertForClosure,
  AlertMessage,
  AlertRound,
  CloseRefusal,
  ClosureToRecord,
  ExpireAlertResult,
  ExpireRequest,
  ExpiringAlert,
  ExpiringAlerts,
  RecordClosureResult,
  JourneyForRemoval,
  MessageRound,
  RemovalNotRemoved,
  RemovalToRecord,
  RemoveResponderResult,
  StoredJourneyMessage,
  UnheardAlertCount,
  ClaimedMessage,
  ClaimedMessages,
  DueAlert,
  DueAlerts,
  EscalateAlertResult,
  EscalateRequest,
  UnsentSmsCount,
  FakeAlertResolution,
  FakeAlertState,
  FakeJourneyEndReason,
  FakeJourneyState,
  FakeJourneyStore,
  HeartbeatPosition,
  HeartbeatToRecord,
  HomeToRecord,
  InsertStartedResult,
  JourneyEnd,
  JourneyForHeartbeat,
  JourneyStoreCall,
  LatestHeartbeat,
  OpenLostContactAlertResult,
  OpenRequest,
  OverdueJourney,
  OverdueJourneys,
  RecordAcknowledgementResult,
  RecordHeartbeatResult,
  RecordHomeResult,
  StartedJourney,
  StoreClock,
  StoredAlert,
  StoredHeartbeat,
  StoredJourney,
  StoredMessage,
  StoredPosition,
  UnendedJourneyState,
} from './fake-journey-store.ts';
export { JOURNEY_STORE_BEHAVIOUR, RACE_ROUNDS, RACERS } from './journey-store-behaviour.ts';
export { fakeLog } from './fake-log.ts';
export type { FakeLog, FakeLogEvent } from './fake-log.ts';
export { CANARY_IDS, FAKE_CANARY_OUTCOMES } from './canary-ids.ts';
export type { FakeCanaryOutcome } from './canary-ids.ts';
export {
  CANARY_ALARM_ABORTED,
  CANARY_ALARM_REPORTED,
  fakeCanaryAlarm,
} from './fake-canary-alarm.ts';
export type { CanaryAlarmReport, CanaryAlarmStatus, FakeCanaryAlarm } from './fake-canary-alarm.ts';
export { fakeWait } from './fake-wait.ts';
export type { FakeWait } from './fake-wait.ts';
export { CANARY_STORE_BEHAVIOUR } from './canary-store-behaviour.ts';
export type {
  CanaryObservationAsRead,
  CanaryStoreBehaviour,
  CanaryStoreUnderTest,
  DeviceAsStored,
} from './canary-store-behaviour.ts';
export {
  SYNTHETIC_EVENT_ID_PREFIX,
  syntheticAccuracy,
  syntheticBatteryLevel,
  syntheticCoordinate,
  syntheticEventId,
  syntheticHeartbeat,
  syntheticPhoneTime,
  syntheticPosition,
  toStoredPosition,
} from './synthetic-heartbeats.ts';
export type { SyntheticHeartbeat, SyntheticPosition } from './synthetic-heartbeats.ts';
export { ADMIN_SHUTDOWN, endTestPool } from './end-test-pool.ts';
export type { EndablePool } from './end-test-pool.ts';
export { fakePostgres, pgSettingsAnswer } from './fake-postgres.ts';
export type {
  FakePgSetting,
  FakePostgres,
  FakePostgresAnswer,
  FakePostgresConnection,
  FakePostgresFatal,
  FakePostgresHandler,
  FakePostgresQuery,
} from './fake-postgres.ts';
export type {
  AcknowledgementAsStored,
  AlertAsStored,
  EscalationAsStored,
  HeartbeatAsStored,
  JourneyAsStored,
  JourneyEndAsStored,
  JourneyMessageAsStored,
  MessageAsStored,
  JourneyStoreBehaviour,
  JourneyStoreUnderTest,
  PositionAsStored,
  ResolutionAsStored,
  WithdrawalAsStored,
} from './journey-store-behaviour.ts';

/**
 * fast-check, for the rules about time and order that no list of examples can
 * cover: "for any sequence of events, …" (D-039). Handed out here so that every
 * package's tests reach it the same way they reach the fakes.
 */
export * as fc from 'fast-check';

/** The path a test should call for a route, so tests never hard-code the API version. */
export function apiPath(route: string): string {
  return `/${API_VERSION}/${route.replace(/^\/+/, '')}`;
}
