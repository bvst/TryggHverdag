// SPIKE-01: the S6 call-record reader (analysis/s6.mjs), on sample output of
// the Android emulator console's `gsm list` (format to verify on the emulator).
//
// The number is from Ofcom's range reserved for drama (07700 900000 to 900999):
// never an emergency number, never a Norwegian one, and nobody's.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const readGsmList = async (text) => (await import('./s6.mjs')).readGsmList(text);
const callStarted = async (input) => (await import('./s6.mjs')).callStarted(input);

const NUMBER = '+447700900123';
const OTHER = '+447700900456';

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

test("SPIKE-01-AC10: reads an outbound call from the emulator's call list", async () => {
  const text = `  outbound to  ${NUMBER} : dialing\r\nOK\r\n`;
  assert.deepEqual(await readGsmList(text), [
    { direction: 'outbound', number: NUMBER, state: 'dialing' },
  ]);
});

test('SPIKE-01-AC10: reads several calls, inbound and outbound, in their order', async () => {
  const text = [
    `outbound to  ${NUMBER} : active`,
    `inbound from ${OTHER} : incoming`,
    'OK',
    '',
  ].join('\r\n');
  assert.deepEqual(await readGsmList(text), [
    { direction: 'outbound', number: NUMBER, state: 'active' },
    { direction: 'inbound', number: OTHER, state: 'incoming' },
  ]);
});

test('SPIKE-01-AC10: a list with no calls reads as none', async () => {
  assert.deepEqual(await readGsmList('OK\r\n'), []);
});

test('SPIKE-01-AC10: an error from the console is refused, never read as "no call"', async () => {
  await refuses(readGsmList('KO: unknown command, try "help"\r\n'), 'an error reply');
  await refuses(readGsmList('Android Console: Authentication required\r\n'), 'a login prompt');
  await refuses(readGsmList(''), 'no reply at all');
});

test('SPIKE-01-AC10: the call started on the tap only if an outbound call to the number is listed', async () => {
  const outbound = [{ direction: 'outbound', number: NUMBER, state: 'dialing' }];
  assert.equal(await callStarted({ calls: outbound, number: NUMBER }), true);
  assert.equal(
    await callStarted({
      calls: [{ direction: 'outbound', number: '447700900123', state: 'alerting' }],
      number: NUMBER,
    }),
    true,
    'the same number without its plus sign',
  );
  assert.equal(
    await callStarted({
      calls: [{ direction: 'inbound', number: NUMBER, state: 'incoming' }],
      number: NUMBER,
    }),
    false,
    'an inbound call is not the tap',
  );
  assert.equal(await callStarted({ calls: outbound, number: OTHER }), false, 'another number');
  assert.equal(await callStarted({ calls: [], number: NUMBER }), false, 'no call at all');
});

// Telecom's own record (`adb shell dumpsys telecom`). On the android-37.2
// image the console's `gsm list` stays empty during a call, so S6 reads
// Telecom's "Historical Events" instead. The samples below keep the real
// dump's structure, cut down, from a dry run on 2026-09-30: an outgoing call
// is a `CallTC@` record marked "(MO - outgoing)", its CREATED event names the
// package that placed it, and SET_DIALING means it started. Telecom masks the
// address itself (`tel:***********23`). Dates are rewritten to 2031; the
// date's format ("1. jan. 2031") is the emulator's Norwegian locale.

const readTelecom = async (text) => (await import('./s6.mjs')).readTelecom(text);
const telecomCallStarted = async (input) => (await import('./s6.mjs')).telecomCallStarted(input);

const SPIKE_APP = 'org.example.spike.backgroundsafety';
const DIALER = 'com.google.android.dialer';
const TELEPHONY =
  'ComponentInfo{com.android.phone/com.android.services.telephony.TelephonyConnectionService}, 1, UserHandle{0}';

/** The dump down to its "Historical Events:" heading, as the emulator prints it. */
const TELECOM_HEAD = [
  'Init Path: On mainline',
  'TelecomUI package: com.google.android.telecomui',
  'CallsManager: ',
  '  mCalls: ',
  '  mCallAudioManager:',
  '    All calls:',
  '    Active dialing, or connecting calls:',
  '    Ringing calls:',
  '    Holding calls:',
  '    Foreground call:',
  '    null',
  '  mDefaultDialerCache:',
  '    System Dialer: ComponentInfo{com.google.android.dialer/com.android.incallui.InCallServiceImpl}',
  '    User 0: com.google.android.dialer',
  '  mConnectionSvrFocusMgr:',
  '    Call Focus History:',
  'PhoneAccountRegistrar: ',
  '  xmlVersion: 10',
  `  defaultOutgoing: ${TELEPHONY}`,
  'Flag Configurations (framework - com.android.server.telecom): ',
  '  \t[✅]: addCallUriForMissedCalls                     add_call_uri_for_missed_calls',
  '  \t[❌]: callSequencingMetrics                        call_sequencing_metrics',
  'TransactionManager: ',
  '  Pending Transactions:',
  '  Ongoing Transaction:',
  '  Completed Transactions:',
  'Historical Events:',
];

/** Events of a call the tap placed, from CREATED to DESTROYED, as the sample has them. */
const dialled = (by) => [
  `21:00:00.556 - CREATED (${by};requestedAcct:none, selfMgd:false):TSI.pC(cgat)@AOA`,
  `21:00:00.575 - SET_CONNECTING (${TELEPHONY}):TSI.pC->CM.fOCP->CM.sOCPA->CM.sOPA.iCA->CM.dSPA->CM.dMRFC->CM.mROC->CM.pASP(cgat)@AOA`,
  '21:00:01.417 - AUDIO_ROUTE (Entering audio route: AudioRoute[Type=TYPE_SPEAKER, Address=invalid, HA Pair Device=invalid] (active=true)):ICSBC.oSC->ICSBC.oSC->CAMSM.pM_2001->CARC.pM_SWITCH_FOCUS->CARC.pM_EXIT_PENDING_ROUTE(cgab)@AOE',
  '21:00:01.436 - START_CONNECTION (tel:***********23 via:com.android.phone):SBC.oSC(cap)@AOM',
  '21:00:02.572 - CAPABILITY_CHANGE (Current: [[ sup_hld mutsep_cnfdis_cnf !v2a]], Removed [[]], Added [[ sup_hld mutsep_cnfdis_cnf !v2a]]):(...->CS.crCo->H.CS.crCo->H.CS.crCo.pICR)->CSW.hCCC(cap/cast)@E-E-AOM',
  '21:00:02.599 - SET_DIALING (dialing set explicitly):(...->CS.crCo->H.CS.crCo->H.CS.crCo.pICR)->CSW.hCCC(cap/cast)@E-E-AOM',
  '21:00:02.743 - SET_DISCONNECTED (disconnected set explicitly> DisconnectCause [ Code: (REMOTE) Label: () Description: () Reason: (NORMAL) Tone: (27)  TelephonyCause: 2/-1 ImsReasonInfo: null]):CSW.sDc(cap)@AQA',
  '21:00:02.818 - LOG_CALL (number=***********23,postDial=,pres=1,code=REMOTE):CSW.sDc(cap)@AQA',
  '21:00:02.876 - CONF_CALLS_CHANGED ():CSW.sCC(cap)@AQg',
  '21:00:02.891 - CONF_CALLS_CHANGED ():CSW.sCC(cap)@AQo',
  '21:00:03.007 - DESTROYED:CSW.rC->CM.pR(cap)@AQ0',
];
const DIALLED_EVENTS = [
  'CREATED',
  'SET_CONNECTING',
  'AUDIO_ROUTE',
  'START_CONNECTION',
  'CAPABILITY_CHANGE',
  'SET_DIALING',
  'SET_DISCONNECTED',
  'LOG_CALL',
  'CONF_CALLS_CHANGED',
  'CONF_CALLS_CHANGED',
  'DESTROYED',
];

/** One call's record under "Historical Events:". */
const callRecord = ({ id = 1, events = dialled(SPIKE_APP) } = {}) => [
  `  CallTC@${id}/1112 [1. jan. 2031 21:00:00](MO - outgoing)(User=UserHandle{0})`,
  `  \t>>>Target PhoneAccount: ${TELEPHONY} (T-Mobile)`,
  `  \t>>>Conn mgr: ${TELEPHONY}`,
  '  \tTo address: tel:***********23 Presentation: Allowed',
  ...events.map((event) => `    ${event}`),
  '    Timings (average for this call, milliseconds):',
  '      outgoing_time_to_dialing: 1163,00',
];

const telecomDump = (...calls) => [...TELECOM_HEAD, ...calls.flat()].join('\n') + '\n';
/** One tap without CALL_PHONE: the dialer opened, and Telecom has no call. */
const NO_CALL = telecomDump();
/** One tap with CALL_PHONE: the app's call, dialled, then ended by the network. */
const APP_CALL = telecomDump(callRecord());

test("SPIKE-01-AC10: reads an outgoing call from Telecom's own record, with the package that placed it and its events in order", async () => {
  const calls = await readTelecom(APP_CALL);
  assert.equal(calls.length, 1, 'one CallTC@ record, one call');
  const [call] = calls;
  assert.match(String(call.id), /TC@1\b/, "the call's id is Telecom's own");
  assert.equal(call.direction, 'outgoing', '"(MO - outgoing)"');
  assert.equal(call.createdBy, SPIKE_APP, 'the package its CREATED event names');
  assert.deepEqual(call.events, DIALLED_EVENTS);
});

test('SPIKE-01-AC10: a Telecom dump with no call record reads as no call: the case without CALL_PHONE', async () => {
  assert.deepEqual(await readTelecom(NO_CALL), []);
});

test('SPIKE-01-AC10: the call started on the tap alone only if Telecom shows a new outgoing call the app placed that reached SET_DIALING', async () => {
  const none = await readTelecom(NO_CALL);
  const tapped = await readTelecom(APP_CALL);
  assert.equal(
    await telecomCallStarted({ before: none, after: tapped, app: SPIKE_APP }),
    true,
    'with CALL_PHONE: the app placed the call and it dialled',
  );
  assert.equal(
    await telecomCallStarted({ before: none, after: none, app: SPIKE_APP }),
    false,
    'without CALL_PHONE: the dialer waits for a second tap, and Telecom has no call',
  );
});

test("SPIKE-01-AC10: a call already in Telecom's history before the tap, one the dialer placed, or one that never dialled is not the tap's call", async () => {
  const earlier = await readTelecom(APP_CALL);
  assert.equal(
    await telecomCallStarted({ before: earlier, after: earlier, app: SPIKE_APP }),
    false,
    "an earlier run's call stays in Telecom's history until the emulator restarts",
  );
  const none = await readTelecom(NO_CALL);
  const secondTap = await readTelecom(telecomDump(callRecord({ id: 2, events: dialled(DIALER) })));
  assert.equal(
    await telecomCallStarted({ before: none, after: secondTap, app: SPIKE_APP }),
    false,
    'a call the dialer placed took a second tap',
  );
  const neverDialled = await readTelecom(
    telecomDump(
      callRecord({
        id: 3,
        events: dialled(SPIKE_APP).filter((event) => !event.includes(' - SET_DIALING ')),
      }),
    ),
  );
  assert.equal(
    await telecomCallStarted({ before: none, after: neverDialled, app: SPIKE_APP }),
    false,
    'a call that never reached SET_DIALING did not start',
  );
});

test('SPIKE-01-AC10: output that is not a Telecom dump is refused, never read as "no call"', async () => {
  await refuses(readTelecom("Can't find service: telecom\n"), 'no telecom service');
  await refuses(readTelecom('error: no devices/emulators found\n'), "adb's error");
  await refuses(readTelecom(''), 'no output at all');
  await refuses(
    readTelecom(TELECOM_HEAD.slice(0, -1).join('\n') + '\n'),
    'a dump cut off before its "Historical Events:" heading',
  );
});
