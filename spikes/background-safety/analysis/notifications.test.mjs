// SPIKE-01: the readers of the platforms' own notification records
// (analysis/notifications.mjs), for S2's reminder and S5's alert.
//
// Android: `adb shell dumpsys notification --noredact`. The dumps built here
// keep the structure of two taken in dry runs on the android-37.2 image
// (2026-09-30), cut down: one 25 s after the S5 alert, and one with the
// reminder posted. Every record, channel and section below is one those dumps
// have; keys, uids, ids and times are made up.
//
// Three things the real dumps showed:
// - the app's alert channel is stored with usage ALARM, but the alert's own
//   record, and the effective channel in it, say NOTIFICATION: the effective
//   one is what the alert used;
// - another package has a channel with the same id ("alert", com.android.phone);
// - the app's group summary sits on the reminder's channel, with no title.
//
// iOS: the app's evidence files: delivered.json, the platform's list of
// delivered notifications as the app reads it when next opened, and
// received.json, the last notification received with its pushed payload.
// Times are ms since the epoch.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const notifications = () => import('./notifications.mjs');
const readAndroidReminders = async (input) => (await notifications()).readAndroidReminders(input);
const readAndroidAlert = async (input) => (await notifications()).readAndroidAlert(input);
const readIosReminders = async (input) => (await notifications()).readIosReminders(input);
const readIosAlert = async (input) => (await notifications()).readIosAlert(input);
const judgeS2 = async (input) => (await import('./s2.mjs')).judgeS2(input);
const checkAlert = async (input) => (await import('./s5.mjs')).checkAlert(input);

const APP = 'org.example.spike.backgroundsafety';
const UID = 10123;
/** The app's fixed texts (app/src/fixed.json): no name, no number, no position. */
const ALERT = { title: 'SPIKE-01 alert', body: 'Open the app now.' };
const REMINDER = {
  title: 'SPIKE-01 reminder',
  body: 'Your journey protection stopped. Open the app.',
};

const S = 1_000;
const MIN = 60 * S;
const WALL0 = Date.UTC(2031, 0, 1, 21, 0, 0);

const PROGRAMMING_ERRORS = [TypeError, ReferenceError, SyntaxError];
/** Rejects on purpose: not a missing module, and not a programming error. */
async function refuses(promise, why) {
  await assert.rejects(
    promise,
    (error) => {
      assert.ok(
        error?.code !== 'ERR_MODULE_NOT_FOUND' &&
          !PROGRAMMING_ERRORS.some((type) => error instanceof type),
        `${why}: it broke instead of refusing (${error?.name}: ${error?.message})`,
      );
      return true;
    },
    why,
  );
}

const attributes = (usage, content = 'CONTENT_TYPE_SONIFICATION') =>
  usage === null
    ? 'null'
    : `AudioAttributes: usage=${usage} content=${content} flags=0x800(FLAG_MUTE_HAPTIC)  tags= bundle=null`;

/** A channel as the dump prints it, in a record or under its package. */
const channel = ({ id, name, importance, bypassDnd, usage, content }) =>
  `NotificationChannel{mId='${id}', mName=${name}, mDescription=, mImportance=${importance}, mBypassDnd=${bypassDnd}, mLockscreenVisibility=-1000, mSound=content://settings/system/notification_sound, mLights=false, mLightColor=0, mVibrationPattern=null, mVibrationEffect=null, mUserLockedFields=0, mUserVisibleTaskShown=false, mVibrationEnabled=true, mShowBadge=true, mDeleted=false, mDeletedTimeMs=-1, mGroup='null', mAudioAttributes=${attributes(usage, content)}, mBlockableSystem=false, mAllowBubbles=-1, mImportanceLockedDefaultApp=false, mOriginalImp=${importance}, mParent=null, mConversationId=null, mDemoted=false, mImportantConvo=false, mLastNotificationUpdateTimeMs=0, isBundle=false, emoji=null}`;

/** The app's channels as they are stored: the alert's with usage ALARM. */
const APP_CHANNELS = {
  alert: { id: 'alert', name: 'Alerts', importance: 5, bypassDnd: true, usage: 'USAGE_ALARM' },
  bggeo: {
    id: 'bggeo',
    name: 'BackgroundGeolocation',
    importance: 3,
    bypassDnd: false,
    usage: null,
  },
  reminder: {
    id: 'journey-reminder',
    name: 'Journey reminder',
    importance: 4,
    bypassDnd: false,
    usage: 'USAGE_NOTIFICATION',
  },
};
/** com.android.phone's own "alert" channel, which never bypasses Do Not Disturb. */
const PHONE_ALERT = {
  id: 'alert',
  name: 'Varsler',
  importance: 3,
  bypassDnd: false,
  usage: 'USAGE_NOTIFICATION',
  content: 'CONTENT_TYPE_UNKNOWN',
};

const IMPORTANCE = { 2: 'LOW', 3: 'DEFAULT', 4: 'HIGH', 5: 'MAX' };

/**
 * One NotificationRecord in the "Notification List". `effective` is the
 * channel as the record carries it; its usage is the record's `mAttributes`.
 * A `title` of null leaves android.title out, as a group summary has it.
 */
function record({
  pkg = APP,
  uid = UID,
  id = 0,
  tag,
  effective,
  flags = 'AUTO_CANCEL',
  title,
  body = null,
  when,
  created = when,
  interrupted = created,
  intercept = false,
}) {
  const key = `0|${pkg}|${id}|${tag}|${uid}`;
  const text = body === null ? [] : [`                android.text=String (${body})`];
  return [
    `    NotificationRecord(0x0a000001: pkg=${pkg} user=UserHandle{0} id=${id} tag=${tag} importance=${effective.importance} key=${key}: Notification(channel=${effective.id} shortcut=null contentView=null vibrate=null sound=null defaults=0 flags=${flags} color=0x00000000 vis=PRIVATE template=android.app.Notification$BigTextStyle))`,
    `      uid=${uid} userId=0`,
    `      opPkg=${pkg}`,
    `      icon=Icon(typ=RESOURCE pkg=${pkg} id=0x7f0d0000)`,
    `      flags=${flags}`,
    `      originalFlags=${flags}`,
    '      pri=1',
    `      key=${key}`,
    '      seen=false',
    `      groupKey=0|${pkg}|g:Aggregate_AlertingSection`,
    '      notification=',
    '            fullscreenIntent=null',
    `            contentIntent=PendingIntent{6dcd010: PendingIntentRecord{40b7106 ${pkg} startActivity (allowlist: f6ede08:+30s0ms/0/NOTIFICATION_SERVICE/NotificationManagerService)}}`,
    '            deleteIntent=null',
    '            number=0',
    '            groupAlertBehavior=0',
    `            when=${when}/${when}`,
    '            tickerText=null',
    '            vis=0',
    '            color=0x00000000',
    '            timeout=PT72H',
    '            extras={',
    ...(title === null ? [] : [`                android.title=String (${title})`]),
    '                android.reduced.images=Boolean (true)',
    '                android.subText=null',
    '                expo.notification_request=byte[] (4)',
    '                  [0] 36',
    '                  [1] 0',
    '                  [2] 0',
    '                  [3] 0',
    '                android.template=String (android.app.Notification$BigTextStyle)',
    ...text,
    `                android.appInfo=ApplicationInfo (ApplicationInfo{93746c2 ${pkg}})`,
    '                android.showWhen=Boolean (true)',
    ...text.map((line) => line.replace('android.text=', 'android.bigText=')),
    '            }',
    '      publicNotification=',
    '            None',
    '      stats=SingleNotificationStats{posttimeElapsedMs=3228845, posttimeToFirstClickMs=-1, posttimeToDismissMs=-1, airtimeCount=0, airtimeMs=0, requestedImportance=4, naturalImportance=4, isNoisy=true}',
    '      mContactAffinity=0.0',
    `      mImportance=${IMPORTANCE[effective.importance]}`,
    '      mImportanceExplanation=app',
    '      mSensitiveContent=false',
    `      mIntercept=${intercept}`,
    '      mHidden==false',
    '      mGlobalSortKey=crtcl=0x0002:intrsv=2:grnk=0x0001:gsmry=1:nsk:rnk=0x0001',
    `      mRankingTimeMs=${when}`,
    `      mCreationTimeMs=${created}`,
    '      mVisibleSinceMs=0',
    `      mUpdateTimeMs=${created}`,
    `      mInterruptionTimeMs=${interrupted}`,
    `      mSuppressedVisualEffects= ${intercept ? 159 : 0}`,
    '      mSound= content://settings/system/notification_sound',
    '      mVibration= null',
    `      mAttributes= ${attributes(effective.usage ?? 'USAGE_NOTIFICATION', effective.content)}`,
    '      mLight= null',
    '      mIsInterruptive=true',
    `      effectiveNotificationChannel=${channel(effective)}`,
    '      mAdjustments=[]',
    '      mUserVisOverride=-1000',
    '      mShouldBreakthroughAllModes=false',
    '      mHighestPriorityMatchingRule=0',
  ];
}

/** Storage's notification from the system UI, held back by Do Not Disturb. */
const SYSTEM_UI = record({
  pkg: 'com.android.systemui',
  uid: 10198,
  id: 1397773634,
  tag: 'public:253,80',
  effective: {
    id: 'DSK',
    name: 'Lagring',
    importance: 2,
    bypassDnd: false,
    usage: 'USAGE_NOTIFICATION',
  },
  flags: 'LOCAL_ONLY|CAN_COLORIZE',
  title: 'Virtual SD-kort',
  body: 'For lagring av bilder, videoer, musikk med mer',
  when: WALL0 - 20 * MIN,
  intercept: true,
});

/** The whole dump: the list, then the sections after it, with every package's stored channels. */
function notificationDump({ records, soundKey = null }) {
  return (
    [
      'Current Notification Manager state:',
      '  Notification List:',
      ...records.flat(),
      '  ',
      '  mMaxPackageEnqueueRate=5.0',
      '  hideSilentStatusBar=true',
      '',
      '  Notification attention state:',
      '      mIntelligenceEnabled={0=true}',
      `      mSoundNotificationKey=${soundKey}`,
      '      mVibrateNotificationKey=null',
      '      mDisableNotificationEffects=false',
      '      mCallState=CALL_STATE_IDLE',
      '  mArchive=Archive (0 notifications)',
      '',
      '  Snoozed notifications:',
      '',
      ' Pending snoozed notifications',
      '',
      ' Notification Preferences:',
      '    per-package config version: 4',
      'PackagePreferences:',
      '      AppSettings: com.android.ons (1001) fixedImportance=true',
      `      AppSettings: ${APP} (${UID}) importance=DEFAULT userSet=false`,
      `        ${channel(APP_CHANNELS.alert)}`,
      `        ${channel(APP_CHANNELS.bggeo)}`,
      `        ${channel(APP_CHANNELS.reminder)}`,
      '      AppSettings: com.android.phone (1001) importance=DEFAULT userSet=false fixedImportance=true',
      `        ${channel(PHONE_ALERT)}`,
      'Restored without uid:',
      '',
      '  Notification listeners:',
      '    Allowed notification listeners:',
      '',
      '  Usage Stats:',
      '    AggregatedStats{',
      `      key='${APP}',`,
      '      numEnqueuedByApp=1,',
      '      numPostedByApp=1,',
      '    }',
      '',
      '  Configurable parameters:',
      '    nls_completion_duration_ms=+10s0ms',
    ].join('\n') + '\n'
  );
}

// S5's dump: the alert, and the dump's other "alert" channel, com.android.phone's.

const ALERT_AT = WALL0 + 10 * MIN;
/** The alert's channel as its record carries it: bypassing Do Not Disturb, sent to NOTIFICATION. */
const ALERT_EFFECTIVE = { ...APP_CHANNELS.alert, usage: 'USAGE_NOTIFICATION' };
const alertRecord = (change = {}) =>
  record({
    tag: '00000000-0000-4000-8000-0000000000a1',
    effective: ALERT_EFFECTIVE,
    title: ALERT.title,
    body: ALERT.body,
    when: ALERT_AT - 8,
    created: ALERT_AT,
    interrupted: ALERT_AT + 254,
    ...change,
  });
/** A notification of com.android.phone on its own "alert" channel, listed first. */
const PHONE_RECORD = record({
  pkg: 'com.android.phone',
  uid: 1001,
  id: 1,
  tag: 'null',
  effective: PHONE_ALERT,
  flags: 'ONGOING_EVENT',
  title: 'Mobilnettverket er ikke tilgjengelig',
  body: 'Trykk for å velge et nettverk',
  when: WALL0 - 30 * MIN,
  intercept: true,
});
const ALERT_DUMP = notificationDump({ records: [PHONE_RECORD, alertRecord(), SYSTEM_UI] });

// S2's dump: the reminder, the app's group summary on the same channel, the
// journey's own notification, and the same title from another package.

/** The reminder's alarm fired late: the app's `when` says one time, the platform posted it later. */
const REMINDER_WHEN = WALL0 + 11 * MIN;
const REMINDER_POSTED = WALL0 + 12 * MIN + 30 * S + 292;
const REMINDER_RECORD = record({
  tag: 'journey-reminder',
  effective: APP_CHANNELS.reminder,
  title: REMINDER.title,
  body: REMINDER.body,
  when: REMINDER_WHEN,
  created: REMINDER_POSTED,
  interrupted: REMINDER_POSTED + 261,
});
const GROUP_SUMMARY = record({
  tag: `0|${APP}|g:Aggregate_AlertingSection`,
  effective: APP_CHANNELS.reminder,
  flags: 'ONGOING_EVENT|NO_CLEAR|LOCAL_ONLY|GROUP_SUMMARY|AUTOGROUP_SUMMARY',
  title: null,
  when: REMINDER_POSTED + 257,
});
const JOURNEY = record({
  id: 9942585,
  tag: 'null',
  effective: APP_CHANNELS.bggeo,
  flags: 'ONGOING_EVENT|ONLY_ALERT_ONCE|NO_CLEAR|FOREGROUND_SERVICE',
  title: 'SPIKE-01 journey',
  body: 'Location is shared with the spike receiver.',
  when: WALL0 + 20 * S,
});
/** Another package, whose id only starts with the app's, with the reminder's title. */
const LOOK_ALIKE = record({
  pkg: `${APP}.other`,
  uid: 10124,
  tag: 'journey-reminder',
  effective: APP_CHANNELS.reminder,
  title: REMINDER.title,
  body: REMINDER.body,
  when: WALL0 + 13 * MIN,
});
const reminderDump = (...records) =>
  notificationDump({
    records,
    soundKey: `0|${APP}|0|journey-reminder|${UID}`,
  });
const REMINDER_DUMP = reminderDump(GROUP_SUMMARY, REMINDER_RECORD, JOURNEY, LOOK_ALIKE, SYSTEM_UI);

const NOT_A_DUMP = [
  ['no notification service', "Can't find service: notification\n"],
  [
    'a permission error',
    "Permission Denial: can't dump NotificationManager from from pid=4321, uid=2000\n",
  ],
  ["adb's error", 'error: no devices/emulators found\n'],
  ['no output at all', ''],
];

test("SPIKE-01-AC6: Android: the reminder's delivery is its record's post time on the platform (mCreationTimeMs), not the app's own `when`", async () => {
  assert.deepEqual(
    await readAndroidReminders({ text: REMINDER_DUMP, app: APP, title: REMINDER.title }),
    [{ at: REMINDER_POSTED }],
  );
});

test("SPIKE-01-AC6: Android: only the app's notification with the fixed reminder title counts: not the group summary on its channel, the journey's notification, nor another package's", async () => {
  const others = reminderDump(GROUP_SUMMARY, JOURNEY, LOOK_ALIKE, SYSTEM_UI);
  assert.deepEqual(
    await readAndroidReminders({ text: others, app: APP, title: REMINDER.title }),
    [],
  );
  assert.deepEqual(
    await readAndroidReminders({ text: ALERT_DUMP, app: APP, title: REMINDER.title }),
    [],
    'the alert is not the reminder',
  );
});

test('SPIKE-01-AC6: Android: output that is not the notification dump is refused, never read as "no reminder"', async () => {
  for (const [what, text] of NOT_A_DUMP) {
    await refuses(readAndroidReminders({ text, app: APP, title: REMINDER.title }), what);
  }
});

/** A run in which arrivals stop at 10 min 10 s after the app is ended at 10 min; ticks every 10 s. */
function stoppedRun() {
  const mark = (label, t) => ({ kind: 'mark', label, at: WALL0 + t, mono: 7_000_000 + t });
  const at = (kind, t, fields = {}) => ({ kind, at: WALL0 + t, mono: 7_000_000 + t, ...fields });
  const times = (step, from, to) =>
    Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);
  const arrivals = [...times(MIN, 30 * S, 9 * MIN + 30 * S), 10 * MIN + 10 * S].map((t) =>
    at('arrival', t, { platform: 'android', recordId: `rec-${t}`, hasPosition: true }),
  );
  return [
    mark('journey-started', 0),
    mark('app-ended', 10 * MIN),
    ...times(10 * S, -5 * S, 20 * MIN + 5 * S).map((t) => at('tick', t)),
    ...arrivals,
    mark('journey-ended', 20 * MIN),
  ].sort((a, b) => a.mono - b.mono);
}

test("SPIKE-01-AC6: the readers' reminders, from either platform, are what judgeS2 takes", async () => {
  const android = await readAndroidReminders({
    text: REMINDER_DUMP,
    app: APP,
    title: REMINDER.title,
  });
  const fromAndroid = await judgeS2({ records: stoppedRun(), reminders: android });
  assert.equal(fromAndroid.status, 'passed');
  assert.equal(fromAndroid.reminderDelayMs, REMINDER_POSTED - (WALL0 + 10 * MIN + 10 * S));

  const ios = await readIosReminders({
    text: deliveredFile([reminderEntry()]),
    title: REMINDER.title,
  });
  assert.equal((await judgeS2({ records: stoppedRun(), reminders: ios })).status, 'passed');
});

test("SPIKE-01-AC9: Android: reads the alert's record: posted, not intercepted, its channel, and that record's mBypassDnd and effective usage, never the stored channel's or another package's", async () => {
  assert.deepEqual(await readAndroidAlert({ text: ALERT_DUMP, app: APP, title: ALERT.title }), {
    posted: true,
    intercepted: false,
    channel: 'alert',
    bypassDnd: true,
    usage: 'USAGE_NOTIFICATION',
  });
});

test('SPIKE-01-AC9: Android: an alert that Do Not Disturb intercepted reads as intercepted', async () => {
  const text = notificationDump({
    records: [PHONE_RECORD, alertRecord({ intercept: true }), SYSTEM_UI],
  });
  const alert = await readAndroidAlert({ text, app: APP, title: ALERT.title });
  assert.equal(alert.posted, true);
  assert.equal(alert.intercepted, true);
});

test('SPIKE-01-AC9: Android: a dump without the alert reads as not posted', async () => {
  const alert = await readAndroidAlert({ text: REMINDER_DUMP, app: APP, title: ALERT.title });
  assert.equal(alert.posted, false);
});

test('SPIKE-01-AC9: Android: output that is not the notification dump is refused, never read as "not posted"', async () => {
  for (const [what, text] of NOT_A_DUMP) {
    await refuses(readAndroidAlert({ text, app: APP, title: ALERT.title }), what);
  }
});

// iOS: the app's evidence files, in the form the dry runs wrote them.

/** delivered.json: the platform's delivered list, as the app read it when next opened. */
const deliveredFile = (delivered, writtenAt = WALL0 + 15 * MIN) =>
  `${JSON.stringify({ delivered, writtenAt }, null, 2)}\n`;
/** When the reminder was delivered on iOS, in ms. */
const REMINDER_IOS = WALL0 + 12 * MIN + 639;
const reminderEntry = (deliveredAt = REMINDER_IOS) => ({
  id: 'journey-reminder',
  title: REMINDER.title,
  deliveredAt,
});
const alertEntry = (id, deliveredAt) => ({ id, title: ALERT.title, deliveredAt });

/** The fixed alert exactly as the driver pushes it with `simctl push`. */
const PUSHED = {
  aps: {
    alert: { title: ALERT.title, body: ALERT.body },
    sound: 'default',
    'interruption-level': 'time-sensitive',
  },
};
const FOREGROUND_ID = '00000000-0000-4000-8000-0000000000F5';
const BACKGROUND_ID = '00000000-0000-4000-8000-0000000000A3';
/** received.json: the pushed alert, received with the app in front. */
const receivedFile = (change = {}) =>
  `${JSON.stringify(
    {
      notification: {
        id: FOREGROUND_ID,
        title: ALERT.title,
        body: ALERT.body,
        data: null,
        payload: PUSHED,
        deliveredAt: WALL0 + 5 * MIN,
        ...change,
      },
      writtenAt: WALL0 + 5 * MIN + 105,
    },
    null,
    2,
  )}\n`;
const BOTH_ALERTS = deliveredFile([
  alertEntry(BACKGROUND_ID, WALL0 + 5 * MIN + 4_898),
  alertEntry(FOREGROUND_ID, WALL0 + 5 * MIN),
]);

test('SPIKE-01-AC6: iOS: reads the reminder from the delivered list, with its delivery time in ms, and only the fixed reminder title', async () => {
  const text = deliveredFile([
    alertEntry(BACKGROUND_ID, WALL0 + 5 * MIN),
    reminderEntry(),
    { id: 'other', title: 'SPIKE-01 journey', deliveredAt: WALL0 + 20 * S },
  ]);
  assert.deepEqual(await readIosReminders({ text, title: REMINDER.title }), [{ at: REMINDER_IOS }]);
  assert.deepEqual(
    await readIosReminders({ text: BOTH_ALERTS, title: REMINDER.title }),
    [],
    'a delivered list without the reminder reads as none',
  );
});

test("SPIKE-01-AC6: iOS: a delivery time in seconds, or a file that is not the delivered list, is refused, never read as 'no reminder'", async () => {
  const cases = [
    ['a time in seconds, as iOS gives it', deliveredFile([reminderEntry(REMINDER_IOS / 1000)])],
    ['a time in whole seconds', deliveredFile([reminderEntry(Math.round(REMINDER_IOS / 1000))])],
    ['no time', deliveredFile([{ id: 'journey-reminder', title: REMINDER.title }])],
    ['no delivered list', `${JSON.stringify({ writtenAt: WALL0 })}\n`],
    [
      'not JSON',
      'An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=2)\n',
    ],
    ['nothing', ''],
  ];
  for (const [what, text] of cases) {
    await refuses(readIosReminders({ text, title: REMINDER.title }), what);
  }
});

test('SPIKE-01-AC9: iOS: reads the payload as delivered and the shown text from received.json, and "presented" from the delivered list; checkAlert takes them', async () => {
  const result = await readIosAlert({
    received: receivedFile(),
    delivered: BOTH_ALERTS,
    title: ALERT.title,
  });
  assert.deepEqual(result.alert, { payload: PUSHED, shownText: ALERT.body });
  assert.equal(result.presented, true);
  const checked = await checkAlert({
    expected: { payload: PUSHED, text: ALERT.body },
    delivered: result.alert,
  });
  assert.equal(checked.status, 'passed');
});

test('SPIKE-01-AC9: iOS: a changed text on the screen reaches checkAlert as it was received', async () => {
  const result = await readIosAlert({
    received: receivedFile({ body: `${ALERT.body} ` }),
    delivered: BOTH_ALERTS,
    title: ALERT.title,
  });
  const checked = await checkAlert({
    expected: { payload: PUSHED, text: ALERT.body },
    delivered: result.alert,
  });
  assert.equal(checked.status, 'failed');
});

test('SPIKE-01-AC9: iOS: an alert missing from the delivered list is not presented', async () => {
  const result = await readIosAlert({
    received: receivedFile(),
    delivered: deliveredFile([reminderEntry()]),
    title: ALERT.title,
  });
  assert.equal(result.presented, false);
});

test('SPIKE-01-AC9: iOS: a received notification with no pushed payload is refused: it is not the pushed alert', async () => {
  const cases = [
    ['a local notification, payload null', receivedFile({ payload: null })],
    [
      'a local notification, no payload key',
      `${JSON.stringify({ notification: { id: 'journey-reminder', title: REMINDER.title, body: REMINDER.body, data: null, deliveredAt: WALL0 }, writtenAt: WALL0 })}\n`,
    ],
    ['not JSON', ''],
    ['no notification', `${JSON.stringify({ writtenAt: WALL0 })}\n`],
  ];
  for (const [what, received] of cases) {
    await refuses(readIosAlert({ received, delivered: BOTH_ALERTS, title: ALERT.title }), what);
  }
});
