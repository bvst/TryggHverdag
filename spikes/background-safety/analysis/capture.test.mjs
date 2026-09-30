// SPIKE-01: the capture reader (analysis/capture.mjs). Its input is the text of
// `tcpdump -nn -r <capture.pcap>` for the emulator's `-tcpdump` capture: tcpdump
// ships with macOS and reads a file without admin rights, and `-nn` keeps it
// from looking names up itself. Names come from the capture's own DNS answers.
//
// The sample lines are written from knowledge of tcpdump's output (verify on
// the Mac). Addresses are from the documentation ranges (192.0.2.0/24,
// 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32); 10.0.2.x is the emulator's
// own network: .15 the device, .2 the Mac (the receiver), .3 its DNS.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const judgeCapture = async (input) => (await import('./capture.mjs')).judgeCapture(input);

const NETWORK = {
  device: ['10.0.2.15', 'fec0::15'],
  receiver: { address: '10.0.2.2', port: 8787 },
  resolver: { address: '10.0.2.3', port: 53 },
};

/** The receiver, Google's platform services and the resolver: nothing else. */
const CLEAN = [
  'reading from file capture.pcap, link-type EN10MB (Ethernet), snapshot length 262144',
  '21:00:00.050000 ARP, Request who-has 10.0.2.2 tell 10.0.2.15, length 28',
  '21:00:00.100000 IP 10.0.2.15.40001 > 10.0.2.3.53: 4101+ A? connectivitycheck.gstatic.com. (47)',
  '21:00:00.110000 IP 10.0.2.3.53 > 10.0.2.15.40001: 4101 1/0/0 A 192.0.2.10 (63)',
  '21:00:00.120000 IP 10.0.2.15.50001 > 192.0.2.10.443: Flags [S], seq 1000, win 65535, options [mss 1460,sackOK,TS val 1 ecr 0,nop,wscale 6], length 0',
  '21:00:00.130000 IP 192.0.2.10.443 > 10.0.2.15.50001: Flags [S.], seq 2000, ack 1001, win 65535, length 0',
  '21:00:00.200000 IP 10.0.2.15.40002 > 10.0.2.3.53: 4102+ AAAA? android.clients.google.com. (44)',
  '21:00:00.210000 IP 10.0.2.3.53 > 10.0.2.15.40002: 4102 2/0/0 CNAME android.l.google.com., AAAA 2001:db8::10 (100)',
  '21:00:00.220000 IP6 fec0::15.50002 > 2001:db8::10.443: Flags [S], seq 3000, win 65535, length 0',
  '21:00:01.000000 IP 10.0.2.15.50003 > 10.0.2.2.8787: Flags [P.], seq 1:301, ack 1, win 502, length 300',
  '21:00:01.010000 IP 10.0.2.2.8787 > 10.0.2.15.50003: Flags [P.], seq 1:20, ack 301, win 502, length 19',
  '21:00:02.000000 IP 10.0.2.15.40003 > 10.0.2.3.53: 4103+ A? time.android.com. (34)',
  '21:00:02.010000 IP 10.0.2.3.53 > 10.0.2.15.40003: 4103 1/0/0 A 192.0.2.11 (50)',
  '21:00:02.020000 IP 10.0.2.15.123 > 192.0.2.11.123: NTPv4, Client, length 48',
];

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

const text = (...extra) => [...CLEAN, ...extra].join('\n') + '\n';
const summary = (destinations) =>
  destinations.map(({ address, port, names, owner }) => ({
    address,
    port,
    names: [...names].sort(),
    owner,
  }));

test("SPIKE-01-AC12: lists every destination the device sent to once, named from the capture's own DNS answers", async () => {
  const result = await judgeCapture({ text: text(), ...NETWORK });
  assert.deepEqual(summary(result.destinations), [
    { address: '10.0.2.3', port: 53, names: [], owner: 'dns' },
    {
      address: '192.0.2.10',
      port: 443,
      names: ['connectivitycheck.gstatic.com'],
      owner: 'platform',
    },
    {
      address: '2001:db8::10',
      port: 443,
      names: ['android.clients.google.com', 'android.l.google.com'],
      owner: 'platform',
    },
    { address: '10.0.2.2', port: 8787, names: [], owner: 'receiver' },
    { address: '192.0.2.11', port: 123, names: ['time.android.com'], owner: 'platform' },
  ]);
});

test("SPIKE-01-AC12: uploads to the receiver only, with Google's services listed as the platform's, pass", async () => {
  const result = await judgeCapture({ text: text(), ...NETWORK });
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.flagged, []);
});

test("SPIKE-01-AC12: a connection to the SDK vendor's host is flagged, and the capture fails", async () => {
  const result = await judgeCapture({
    text: text(
      '21:00:03.000000 IP 10.0.2.15.40004 > 10.0.2.3.53: 4104+ A? tracker.transistorsoft.com. (44)',
      '21:00:03.010000 IP 10.0.2.3.53 > 10.0.2.15.40004: 4104 1/0/0 A 198.51.100.20 (60)',
      '21:00:03.020000 IP 10.0.2.15.50004 > 198.51.100.20.443: Flags [S], seq 1, win 65535, length 0',
    ),
    ...NETWORK,
  });
  assert.equal(result.status, 'failed');
  const vendor = result.destinations.find((d) => d.address === '198.51.100.20');
  assert.equal(vendor?.owner, 'vendor');
  assert.ok(
    result.flagged.some((flag) => flag.owner === 'vendor'),
    'the vendor host is not flagged',
  );
});

test("SPIKE-01-AC12: a lookup of the vendor's host is flagged even when no connection follows", async () => {
  const result = await judgeCapture({
    text: text(
      '21:00:04.000000 IP 10.0.2.15.40005 > 10.0.2.3.53: 4105+ A? license.transistorsoft.com. (44)',
    ),
    ...NETWORK,
  });
  assert.equal(result.status, 'failed');
  assert.ok(
    result.flagged.some((flag) => flag.owner === 'vendor'),
    'the lookup of a vendor host is not flagged',
  );
});

test('SPIKE-01-AC12: analytics and advertising hosts are flagged, and the capture fails', async () => {
  const result = await judgeCapture({
    text: text(
      '21:00:05.000000 IP 10.0.2.15.40006 > 10.0.2.3.53: 4106+ A? app-measurement.com. (37)',
      '21:00:05.010000 IP 10.0.2.3.53 > 10.0.2.15.40006: 4106 1/0/0 A 198.51.100.30 (53)',
      '21:00:05.020000 IP 10.0.2.15.50006 > 198.51.100.30.443: Flags [S], seq 1, win 65535, length 0',
      '21:00:06.000000 IP 10.0.2.15.40007 > 10.0.2.3.53: 4107+ A? googleads.g.doubleclick.net. (45)',
      '21:00:06.010000 IP 10.0.2.3.53 > 10.0.2.15.40007: 4107 1/0/0 A 198.51.100.31 (61)',
      '21:00:06.020000 IP 10.0.2.15.50007 > 198.51.100.31.443: Flags [S], seq 1, win 65535, length 0',
    ),
    ...NETWORK,
  });
  assert.equal(result.status, 'failed');
  const owners = Object.fromEntries(result.destinations.map((d) => [d.address, d.owner]));
  assert.equal(owners['198.51.100.30'], 'analytics');
  assert.equal(owners['198.51.100.31'], 'advertising');
  assert.deepEqual(result.flagged.map((flag) => flag.owner).sort(), ['advertising', 'analytics']);
});

test('SPIKE-01-AC12: a destination the capture cannot place is listed as unknown, and the capture does not pass', async () => {
  const result = await judgeCapture({
    text: text(
      '21:00:07.000000 IP 10.0.2.15.50008 > 203.0.113.40.443: Flags [S], seq 1, win 65535, length 0',
    ),
    ...NETWORK,
  });
  assert.notEqual(result.status, 'passed', 'an unnamed destination was passed unseen');
  const unknown = result.destinations.find((d) => d.address === '203.0.113.40');
  assert.equal(unknown?.owner, 'unknown');
});

test('SPIKE-01-AC12: text that is not a capture of the run is refused, never read as "nothing sent"', async () => {
  await refuses(
    judgeCapture({ text: 'tcpdump: capture.pcap: No such file or directory\n', ...NETWORK }),
    "tcpdump's own error",
  );
  await refuses(judgeCapture({ text: '', ...NETWORK }), 'an empty capture');
  const noUpload = CLEAN.filter((line) => !line.includes('10.0.2.2.8787')).join('\n');
  await assert.rejects(
    judgeCapture({ text: noUpload, ...NETWORK }),
    /receiver/i,
    'a capture with no upload to the receiver did not capture the run',
  );
});
