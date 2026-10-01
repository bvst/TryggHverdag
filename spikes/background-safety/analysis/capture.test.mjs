// SPIKE-01: the capture reader (analysis/capture.mjs). Its input is the text of
// `tcpdump -nn -r <capture.pcap>` for the emulator's `-tcpdump` capture: tcpdump
// ships with macOS and reads a file without admin rights, and `-nn` keeps it
// from looking names up itself. Names come from the capture's own DNS answers.
//
// The sample lines are written from knowledge of tcpdump's output (verify on
// the Mac). Addresses are from the documentation ranges (192.0.2.0/24,
// 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32); 10.0.2.x is the emulator's
// own network: .15 the device, .2 the Mac (the receiver), .3 its DNS.
//
// The emulator's network has both families (the code review's B2,
// 2026-10-01): fec0::2 and fec0::3 play the roles of 10.0.2.2 and 10.0.2.3,
// and the device has an IPv6 address of its own. So the receiver and the
// resolver are each given as { addresses, port }, every address the role has.
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** Imported per call, so that each test reports a missing module on its own. */
const judgeCapture = async (input) => (await import('./capture.mjs')).judgeCapture(input);
const listDestinations = async (input) => (await import('./capture.mjs')).listDestinations(input);

const NETWORK = {
  device: ['10.0.2.15', 'fec0::15'],
  receiver: { addresses: ['10.0.2.2', 'fec0::2'], port: 8787 },
  resolver: { addresses: ['10.0.2.3', 'fec0::3'], port: 53 },
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

// S8's capture (AC16, "recorded, not judged"). The map screen uploads nothing,
// so this capture has no receiver in it, and only Kartverket is expected.
// Kartverket's tile host is not verified yet: it is the caller's input, and the
// samples use a made-up name under the reserved .example domain.

const TILE_HOST = 'tiles.kartverket.example';
const MAP_NETWORK = { device: NETWORK.device, resolver: NETWORK.resolver };

/** One map run: the platform's connectivity check, then tiles through a CDN name. */
const MAP = [
  'reading from file map.pcap, link-type EN10MB (Ethernet), snapshot length 262144',
  '21:00:00.100000 IP 10.0.2.15.40001 > 10.0.2.3.53: 5101+ A? connectivitycheck.gstatic.com. (47)',
  '21:00:00.110000 IP 10.0.2.3.53 > 10.0.2.15.40001: 5101 1/0/0 A 192.0.2.10 (63)',
  '21:00:00.120000 IP 10.0.2.15.50001 > 192.0.2.10.443: Flags [S], seq 1000, win 65535, length 0',
  '21:00:01.000000 IP 10.0.2.15.40002 > 10.0.2.3.53: 5102+ A? tiles.kartverket.example. (42)',
  '21:00:01.010000 IP 10.0.2.3.53 > 10.0.2.15.40002: 5102 2/0/0 CNAME edge.tilecdn.example., A 192.0.2.50 (88)',
  '21:00:01.020000 IP 10.0.2.15.50002 > 192.0.2.50.443: Flags [S], seq 1, win 65535, length 0',
  '21:00:01.030000 IP 192.0.2.50.443 > 10.0.2.15.50002: Flags [S.], seq 2, ack 2, win 65535, length 0',
  '21:00:01.100000 IP 10.0.2.15.50002 > 192.0.2.50.443: Flags [P.], seq 1:518, ack 1, win 502, length 517',
];
const mapText = (...extra) => [...MAP, ...extra].join('\n') + '\n';
const byAddress = (a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
const ownerOf = (result) =>
  Object.fromEntries(result.destinations.map((d) => [d.address, d.owner]));
const FINE = new Set(['kartverket', 'platform', 'dns']);

test('SPIKE-01-AC16: a map capture with no upload to the receiver is read, recorded rather than judged, with Kartverket, the platform and DNS marked', async () => {
  const result = await listDestinations({
    text: mapText(),
    ...MAP_NETWORK,
    kartverket: [TILE_HOST],
  });
  assert.deepEqual(summary(result.destinations).sort(byAddress), [
    { address: '10.0.2.3', port: 53, names: [], owner: 'dns' },
    {
      address: '192.0.2.10',
      port: 443,
      names: ['connectivitycheck.gstatic.com'],
      owner: 'platform',
    },
    {
      address: '192.0.2.50',
      port: 443,
      names: ['edge.tilecdn.example', 'tiles.kartverket.example'],
      owner: 'kartverket',
    },
  ]);
  assert.deepEqual(result.flagged, []);
  assert.ok(!('status' in result), "S8's capture is recorded, not judged: it has no verdict");
});

test('SPIKE-01-AC16: in the map capture, the vendor, analytics, advertising and anything the capture cannot place are flagged, lookups included', async () => {
  const result = await listDestinations({
    text: mapText(
      '21:00:02.000000 IP 10.0.2.15.40003 > 10.0.2.3.53: 5103+ A? license.transistorsoft.com. (44)',
      '21:00:03.000000 IP 10.0.2.15.40004 > 10.0.2.3.53: 5104+ A? app-measurement.com. (37)',
      '21:00:03.010000 IP 10.0.2.3.53 > 10.0.2.15.40004: 5104 1/0/0 A 198.51.100.30 (53)',
      '21:00:03.020000 IP 10.0.2.15.50003 > 198.51.100.30.443: Flags [S], seq 1, win 65535, length 0',
      '21:00:04.000000 IP 10.0.2.15.40005 > 10.0.2.3.53: 5105+ A? googleads.g.doubleclick.net. (45)',
      '21:00:04.010000 IP 10.0.2.3.53 > 10.0.2.15.40005: 5105 1/0/0 A 198.51.100.31 (61)',
      '21:00:04.020000 IP 10.0.2.15.50004 > 198.51.100.31.443: Flags [S], seq 1, win 65535, length 0',
      '21:00:05.000000 IP 10.0.2.15.50005 > 203.0.113.40.443: Flags [S], seq 1, win 65535, length 0',
      '21:00:06.000000 IP 10.0.2.15.40006 > 10.0.2.3.53: 5106+ A? demotiles.maplibre.org. (40)',
    ),
    ...MAP_NETWORK,
    kartverket: [TILE_HOST],
  });
  assert.deepEqual(ownerOf(result), {
    '10.0.2.3': 'dns',
    '192.0.2.10': 'platform',
    '192.0.2.50': 'kartverket',
    '198.51.100.30': 'analytics',
    '198.51.100.31': 'advertising',
    '203.0.113.40': 'unknown',
  });
  assert.deepEqual([...new Set(result.flagged.map((flag) => flag.owner))].sort(), [
    'advertising',
    'analytics',
    'unknown',
    'vendor',
  ]);
  assert.ok(
    result.flagged.some(
      (flag) => flag.name === 'license.transistorsoft.com' && flag.owner === 'vendor',
    ),
    'a lookup of the vendor, with no connection after it, is not flagged',
  );
  assert.ok(
    result.flagged.some(
      (flag) => flag.name === 'demotiles.maplibre.org' && flag.owner === 'unknown',
    ),
    'a lookup of a host nobody expected (a map demo server) is not flagged',
  );
  assert.ok(
    result.flagged.some((flag) => flag.address === '203.0.113.40' && flag.owner === 'unknown'),
    'a destination no DNS answer places is not flagged',
  );
  assert.ok(
    result.flagged.every((flag) => !FINE.has(flag.owner)),
    'Kartverket, the platform or DNS was flagged',
  );
});

test("SPIKE-01-AC16: Kartverket's host is the caller's input: a name covers itself and its subdomains, and a name it was not given is flagged", async () => {
  const text = mapText(
    '21:00:02.000000 IP 10.0.2.15.40003 > 10.0.2.3.53: 5103+ A? cache.kartverket.no. (37)',
    '21:00:02.010000 IP 10.0.2.3.53 > 10.0.2.15.40003: 5103 1/0/0 A 198.51.100.60 (53)',
    '21:00:02.020000 IP 10.0.2.15.50003 > 198.51.100.60.443: Flags [S], seq 1, win 65535, length 0',
    '21:00:03.000000 IP 10.0.2.15.40004 > 10.0.2.3.53: 5104+ A? notkartverket.example. (39)',
    '21:00:03.010000 IP 10.0.2.3.53 > 10.0.2.15.40004: 5104 1/0/0 A 198.51.100.61 (55)',
    '21:00:03.020000 IP 10.0.2.15.50004 > 198.51.100.61.443: Flags [S], seq 1, win 65535, length 0',
  );
  const domain = ownerOf(
    await listDestinations({ text, ...MAP_NETWORK, kartverket: ['kartverket.example'] }),
  );
  assert.equal(domain['192.0.2.50'], 'kartverket', 'a subdomain of the name given');
  assert.equal(
    domain['198.51.100.60'],
    'unknown',
    'a Kartverket-looking name that was not given counts for nothing: no host is built in',
  );
  assert.equal(domain['198.51.100.61'], 'unknown', 'a name that only ends in the same letters');

  const elsewhere = await listDestinations({
    text: mapText(),
    ...MAP_NETWORK,
    kartverket: ['maps.elsewhere.example'],
  });
  assert.equal(ownerOf(elsewhere)['192.0.2.50'], 'unknown');
  assert.ok(
    elsewhere.flagged.some((flag) => flag.address === '192.0.2.50'),
    "tiles from a host not given as Kartverket's are not flagged",
  );
});

test('SPIKE-01-AC16: a map capture that cannot be read, or no Kartverket host to read it with, is refused, never read as "only Kartverket"', async () => {
  const ok = { text: mapText(), ...MAP_NETWORK, kartverket: [TILE_HOST] };
  await refuses(listDestinations({ ...ok, text: '' }), 'an empty capture');
  await refuses(
    listDestinations({ ...ok, text: 'tcpdump: map.pcap: No such file or directory\n' }),
    "tcpdump's own error",
  );
  await refuses(listDestinations({ ...ok, kartverket: undefined }), 'no Kartverket host given');
  await refuses(listDestinations({ ...ok, kartverket: [] }), 'an empty list of Kartverket hosts');
});

// The dry S1 capture (android-37.2, Wi-Fi off, 2026-09-30) failed on four
// destinations nobody had placed, all of them the platform's or the harness's:
// DNS over TLS to the emulator's resolver (port 853), the debug build probing
// the Mac for Metro (port 8081), and the emulator SIM's carrier entitlement
// service, named by the capture's own DNS as ts43.eas3.msg.t-mobile.com. The
// lines keep that capture's format; the carrier's addresses are replaced with
// documentation ones, since the rule goes by the name, never the address.

const ENTITLEMENT = 'ts43.eas3.msg.t-mobile.com';

/** The dry run's four "unknown" destinations, in the capture's own lines. */
const DRY_RUN = [
  '21:00:10.000000 IP 10.0.2.15.45074 > 10.0.2.3.853: Flags [S], seq 1080971292, win 65448, options [mss 1212,sackOK,TS val 1496964593 ecr 0,nop,wscale 7,tfo  cookiereq,nop,nop], length 0',
  '21:00:10.001000 IP 10.0.2.3.853 > 10.0.2.15.45074: Flags [R.], seq 0, ack 1080971293, win 0, length 0',
  `21:00:11.000000 IP 10.0.2.15.12656 > 10.0.2.3.53: 19576+ AAAA? ${ENTITLEMENT}. (44)`,
  `21:00:11.000100 IP 10.0.2.15.17569 > 10.0.2.3.53: 10978+ A? ${ENTITLEMENT}. (44)`,
  '21:00:11.180000 IP 10.0.2.3.53 > 10.0.2.15.12656: 19576 1/0/0 AAAA 2001:db8::98 (72)',
  '21:00:11.200000 IP 10.0.2.3.53 > 10.0.2.15.17569: 10978 1/0/0 A 198.51.100.98 (60)',
  '21:00:11.220000 IP 10.0.2.15.58018 > 198.51.100.98.443: Flags [S], seq 3863964492, win 65535, options [mss 1460,sackOK,TS val 233846138 ecr 0,nop,wscale 9], length 0',
  '21:00:11.380000 IP 198.51.100.98.443 > 10.0.2.15.58018: Flags [S.], seq 256001, ack 3863964493, win 8192, options [mss 1460], length 0',
  '21:00:12.000000 IP 10.0.2.15.39070 > 10.0.2.2.8081: Flags [S], seq 665417719, win 65535, options [mss 1460,sackOK,TS val 3436156711 ecr 0,nop,wscale 9], length 0',
  '21:00:12.000200 IP 10.0.2.2.8081 > 10.0.2.15.39070: Flags [R.], seq 0, ack 665417720, win 0, length 0',
  `21:04:00.000000 IP 10.0.2.15.45254 > 10.0.2.3.53: 53912+ A? ${ENTITLEMENT}. (44)`,
  '21:04:00.020000 IP 10.0.2.3.53 > 10.0.2.15.45254: 53912 1/0/0 A 198.51.100.122 (60)',
  '21:04:00.040000 IP 10.0.2.15.48366 > 198.51.100.122.443: Flags [S], seq 1035259364, win 65535, options [mss 1460,sackOK,TS val 3940744971 ecr 0,nop,wscale 9], length 0',
];

/** The owner of the destination at `address` and `port`. */
const ownerAt = (result, address, port) =>
  result.destinations.find((d) => d.address === address && d.port === port)?.owner;

test("SPIKE-01-AC12: the emulator's resolver is DNS on any port: DNS over TLS on 853 as much as 53", async () => {
  const result = await judgeCapture({ text: text(...DRY_RUN), ...NETWORK });
  assert.equal(ownerAt(result, '10.0.2.3', 853), 'dns');
  assert.equal(ownerAt(result, '10.0.2.3', 53), 'dns');
});

test("SPIKE-01-AC12: the Mac's address on a port other than the receiver's is the harness's, listed and never unknown, and the receiver stays the receiver", async () => {
  const result = await judgeCapture({ text: text(...DRY_RUN), ...NETWORK });
  assert.equal(ownerAt(result, '10.0.2.2', 8081), 'harness', "Metro's port on the Mac");
  assert.equal(ownerAt(result, '10.0.2.2', 8787), 'receiver');
});

test("SPIKE-01-AC12: the emulator SIM's carrier entitlement host is the platform's, by the name the capture's DNS gives it", async () => {
  const result = await judgeCapture({ text: text(...DRY_RUN), ...NETWORK });
  for (const address of ['198.51.100.98', '198.51.100.122']) {
    const destination = result.destinations.find((d) => d.address === address);
    assert.deepEqual(destination?.names, [ENTITLEMENT], address);
    assert.equal(destination?.owner, 'platform', address);
  }
});

test("SPIKE-01-AC12: with the resolver, the harness and the carrier placed, the dry run's capture passes: nothing unknown, nothing flagged", async () => {
  const result = await judgeCapture({ text: text(...DRY_RUN), ...NETWORK });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.flagged, []);
  assert.equal(result.status, 'passed');
  assert.ok(
    result.destinations.every((d) => d.owner !== 'unknown'),
    'a destination is still unknown',
  );
});

test("SPIKE-01-AC12: the carrier rule goes by the name alone: the carrier's address with no name, or a name that only looks like the carrier's, stays unknown", async () => {
  const result = await judgeCapture({
    text: text(
      ...DRY_RUN,
      '21:05:00.000000 IP 10.0.2.15.50010 > 198.51.100.99.443: Flags [S], seq 1, win 65535, length 0',
      `21:05:01.000000 IP 10.0.2.15.40010 > 10.0.2.3.53: 6101+ A? ${ENTITLEMENT}.example. (52)`,
      '21:05:01.010000 IP 10.0.2.3.53 > 10.0.2.15.40010: 6101 1/0/0 A 203.0.113.70 (68)',
      '21:05:01.020000 IP 10.0.2.15.50011 > 203.0.113.70.443: Flags [S], seq 1, win 65535, length 0',
      '21:05:02.000000 IP 10.0.2.15.40011 > 10.0.2.3.53: 6102+ A? ts43.eas3.msg.not-t-mobile.com. (48)',
      '21:05:02.010000 IP 10.0.2.3.53 > 10.0.2.15.40011: 6102 1/0/0 A 203.0.113.71 (64)',
      '21:05:02.020000 IP 10.0.2.15.50012 > 203.0.113.71.443: Flags [S], seq 1, win 65535, length 0',
    ),
    ...NETWORK,
  });
  assert.equal(ownerAt(result, '198.51.100.99', 443), 'unknown', 'no name places it');
  assert.equal(
    ownerAt(result, '203.0.113.70', 443),
    'unknown',
    'the carrier name with more after it',
  );
  assert.equal(ownerAt(result, '203.0.113.71', 443), 'unknown', 'a name that only ends the same');
  assert.notEqual(result.status, 'passed');
});

test("SPIKE-01-AC12: none of them can hide a vendor, analytics or advertising host: a flagged name wins over the carrier's and the Mac's", async () => {
  const shared = await judgeCapture({
    text: text(
      ...DRY_RUN,
      '21:06:00.000000 IP 10.0.2.15.40020 > 10.0.2.3.53: 6201+ A? googleads.g.doubleclick.net. (45)',
      '21:06:00.010000 IP 10.0.2.3.53 > 10.0.2.15.40020: 6201 1/0/0 A 198.51.100.98 (61)',
    ),
    ...NETWORK,
  });
  assert.equal(
    ownerAt(shared, '198.51.100.98', 443),
    'advertising',
    'an address the carrier shares with an advertising host',
  );
  assert.equal(shared.status, 'failed');

  const onTheMac = await judgeCapture({
    text: text(
      ...DRY_RUN,
      '21:07:00.000000 IP 10.0.2.15.40021 > 10.0.2.3.53: 6202+ A? tracker.transistorsoft.com. (44)',
      '21:07:00.010000 IP 10.0.2.3.53 > 10.0.2.15.40021: 6202 1/0/0 A 10.0.2.2 (60)',
      '21:07:00.020000 IP 10.0.2.15.50021 > 10.0.2.2.443: Flags [S], seq 1, win 65535, length 0',
    ),
    ...NETWORK,
  });
  assert.equal(
    ownerAt(onTheMac, '10.0.2.2', 443),
    'vendor',
    "the vendor's name answered with the Mac's address",
  );
  assert.equal(onTheMac.status, 'failed');
  assert.ok(
    onTheMac.flagged.some((flag) => flag.owner === 'vendor'),
    'the vendor is not flagged',
  );
});

// IPv6 (the code review's B2, the safety review's S1). The night's S1 capture
// (night-20260930-s1-android-1) holds 55 packets from the device's IPv6
// address, which a reader given only 10.0.2.15 dropped without a word. The
// device's addresses are the caller's input: here fec0::15; the emulator's
// own was fec0::5054:ff:fe12:3456.

test('SPIKE-01-AC12: over IPv6, the device is its own address as given, fec0::3 is the resolver and fec0::2 the receiver, on the same ports and rules as over IPv4', async () => {
  const result = await judgeCapture({
    text: text(
      '21:01:00.000000 IP6 fec0::15.40010 > fec0::3.53: 7101+ AAAA? play.googleapis.com. (37)',
      '21:01:00.010000 IP6 fec0::3.53 > fec0::15.40010: 7101 1/0/0 AAAA 2001:db8::20 (65)',
      '21:01:00.020000 IP6 fec0::15.50010 > 2001:db8::20.443: Flags [S], seq 1, win 65535, length 0',
      '21:01:01.000000 IP6 fec0::15.50011 > fec0::2.8787: Flags [P.], seq 1:301, ack 1, win 502, length 300',
      '21:01:01.010000 IP6 fec0::2.8787 > fec0::15.50011: Flags [P.], seq 1:20, ack 301, win 502, length 19',
      '21:01:02.000000 IP6 fec0::15.50012 > fec0::2.8081: Flags [S], seq 1, win 65535, length 0',
      '21:01:03.000000 IP6 fec0::15.45000 > fec0::3.853: Flags [S], seq 1, win 65535, length 0',
    ),
    ...NETWORK,
  });
  assert.equal(ownerAt(result, '2001:db8::20', 443), 'platform', 'named by the IPv6 resolver');
  assert.deepEqual(result.destinations.find((d) => d.address === '2001:db8::20')?.names, [
    'play.googleapis.com',
  ]);
  assert.equal(ownerAt(result, 'fec0::2', 8787), 'receiver');
  assert.equal(ownerAt(result, 'fec0::2', 8081), 'harness');
  assert.equal(ownerAt(result, 'fec0::3', 53), 'dns');
  assert.equal(ownerAt(result, 'fec0::3', 853), 'dns');
  assert.deepEqual(result.problems, []);
  assert.equal(result.status, 'passed');
});

test("SPIKE-01-AC12: the vendor reached from the device's IPv6 address is listed and flagged, and the capture fails", async () => {
  const result = await judgeCapture({
    text: text(
      '21:02:00.000000 IP 10.0.2.15.40011 > 10.0.2.3.53: 7102+ AAAA? tracker.transistorsoft.com. (44)',
      '21:02:00.010000 IP 10.0.2.3.53 > 10.0.2.15.40011: 7102 1/0/0 AAAA 2001:db8::66 (72)',
      '21:02:00.020000 IP6 fec0::15.50013 > 2001:db8::66.443: Flags [S], seq 1, win 65535, length 0',
    ),
    ...NETWORK,
  });
  assert.equal(ownerAt(result, '2001:db8::66', 443), 'vendor', 'the IPv6 connection was dropped');
  assert.ok(result.flagged.some((flag) => flag.owner === 'vendor'));
  assert.equal(result.status, 'failed');
});

test("SPIKE-01-AC12: a capture that only reached the receiver over IPv6 still has its upload: the receiver's addresses are both families", async () => {
  const ipv4Upload = (line) => line.includes('10.0.2.2.8787');
  const result = await judgeCapture({
    text: [
      ...CLEAN.filter((line) => !ipv4Upload(line)),
      '21:01:01.000000 IP6 fec0::15.50011 > fec0::2.8787: Flags [P.], seq 1:301, ack 1, win 502, length 300',
    ].join('\n'),
    ...NETWORK,
  });
  assert.equal(result.status, 'passed');
  assert.equal(ownerAt(result, 'fec0::2', 8787), 'receiver');
});

// Firebase (the privacy review's should-fix 2). expo-notifications links
// Firebase Messaging on Android, and its installation, token and logging
// hosts live under googleapis.com, which the platform rule covers. They are
// analytics, never the platform's: the rules are checked in order, the first
// match wins, and analytics comes before the platform, so these four names
// win over googleapis.com. The platform rule still covers Google's other hosts
// there. An address that a Firebase name and a platform name share counts as
// analytics, since a flagged owner always wins.

const FIREBASE = [
  ['firebaseinstallations.googleapis.com', '198.51.100.81'],
  ['fcm.googleapis.com', '198.51.100.82'],
  ['fcmtoken.googleapis.com', '198.51.100.83'],
  ['firebaselogging-pa.googleapis.com', '198.51.100.84'],
];

/** A lookup of `name`, its answer `address`, and a connection to it, `n` making each unique. */
const reached = (name, address, n) => [
  `21:03:0${n}.000000 IP 10.0.2.15.4012${n} > 10.0.2.3.53: 720${n}+ A? ${name}. (50)`,
  `21:03:0${n}.010000 IP 10.0.2.3.53 > 10.0.2.15.4012${n}: 720${n} 1/0/0 A ${address} (66)`,
  `21:03:0${n}.020000 IP 10.0.2.15.5012${n} > ${address}.443: Flags [S], seq 1, win 65535, length 0`,
];

test("SPIKE-01-AC12: Firebase's installation, messaging, token and logging hosts are analytics and flagged, never the platform's, while Google's other googleapis.com hosts stay the platform's", async () => {
  const result = await judgeCapture({
    text: text(
      ...FIREBASE.flatMap(([name, address], i) => reached(name, address, i + 1)),
      ...reached('android.googleapis.com', '198.51.100.85', 5),
    ),
    ...NETWORK,
  });
  for (const [name, address] of FIREBASE) {
    assert.equal(ownerAt(result, address, 443), 'analytics', `${name} is not analytics`);
    assert.ok(
      result.flagged.some((flag) => flag.name === name && flag.owner === 'analytics'),
      `${name} is not flagged`,
    );
  }
  assert.equal(ownerAt(result, '198.51.100.85', 443), 'platform', 'android.googleapis.com');
  assert.equal(result.status, 'failed');
});

test('SPIKE-01-AC12: an address that a Firebase host shares with a platform host counts as analytics', async () => {
  const result = await judgeCapture({
    text: text(
      ...reached('www.googleapis.com', '198.51.100.86', 1),
      '21:04:00.000000 IP 10.0.2.15.40130 > 10.0.2.3.53: 7301+ A? fcm.googleapis.com. (36)',
      '21:04:00.010000 IP 10.0.2.3.53 > 10.0.2.15.40130: 7301 1/0/0 A 198.51.100.86 (52)',
    ),
    ...NETWORK,
  });
  assert.equal(ownerAt(result, '198.51.100.86', 443), 'analytics');
  assert.equal(result.status, 'failed');
});

test("SPIKE-01-AC16: in S8's map capture, a Firebase host is flagged too", async () => {
  const result = await listDestinations({
    text: mapText(...reached('fcmtoken.googleapis.com', '198.51.100.83', 1)),
    ...MAP_NETWORK,
    kartverket: [TILE_HOST],
  });
  assert.equal(ownerOf(result)['198.51.100.83'], 'analytics');
  assert.ok(result.flagged.some((flag) => flag.owner === 'analytics'));
});

// Only the run's window (the safety review's S1). The emulator keeps its
// -tcpdump on for every later run, so the file grows past the run: the night's
// S1 pcap was last written hours after that run ended. The reader takes the
// text of `tcpdump -tt -nn -r` (a time in seconds since the epoch, with
// microseconds, at the start of each line) and a window `from`/`to` in ms
// since the epoch, on the capture's own clock, and reads only the packets
// inside it.

const T0 = Date.UTC(2031, 0, 1, 20, 0, 0);
const IN = { from: T0, to: T0 + 45 * 60_000 };
/** A `tcpdump -tt` line at `ms` since the epoch. */
const tt = (ms, rest) => `${(ms / 1000).toFixed(6)} ${rest}`;

/** The run inside its window, then a later run's traffic two hours after it. */
const GROWN = [
  'reading from file capture.pcap, link-type EN10MB (Ethernet), snapshot length 262144',
  tt(T0 + 5_000, 'ARP, Request who-has 10.0.2.3 tell 10.0.2.15, length 28'),
  tt(T0 + 6_000, 'IP 10.0.2.15.40001 > 10.0.2.3.53: 4101+ A? connectivitycheck.gstatic.com. (47)'),
  tt(T0 + 6_010, 'IP 10.0.2.3.53 > 10.0.2.15.40001: 4101 1/0/0 A 192.0.2.10 (63)'),
  tt(T0 + 6_020, 'IP 10.0.2.15.50001 > 192.0.2.10.443: Flags [S], seq 1000, win 65535, length 0'),
  tt(
    T0 + 60_000,
    'IP 10.0.2.15.50003 > 10.0.2.2.8787: Flags [P.], seq 1:301, ack 1, win 502, length 300',
  ),
  tt(
    T0 + 60_010,
    'IP 10.0.2.2.8787 > 10.0.2.15.50003: Flags [P.], seq 1:20, ack 301, win 502, length 19',
  ),
  tt(
    IN.to + 120 * 60_000,
    'IP 10.0.2.15.40002 > 10.0.2.3.53: 4102+ A? license.transistorsoft.com. (44)',
  ),
  tt(
    IN.to + 120 * 60_000 + 10,
    'IP 10.0.2.3.53 > 10.0.2.15.40002: 4102 1/0/0 A 198.51.100.20 (60)',
  ),
  tt(
    IN.to + 120 * 60_000 + 20,
    'IP 10.0.2.15.50004 > 198.51.100.20.443: Flags [S], seq 1, win 65535, length 0',
  ),
  tt(
    IN.to + 121 * 60_000,
    'IP 10.0.2.15.50005 > 203.0.113.40.443: Flags [S], seq 1, win 65535, length 0',
  ),
].join('\n');

test('SPIKE-01-AC12: reads `tcpdump -tt` lines, and a window cuts a capture that kept growing to the run: what came after it is neither listed nor flagged', async () => {
  const cut = await judgeCapture({ text: GROWN, ...NETWORK, ...IN });
  assert.equal(cut.status, 'passed', 'traffic after the run decided the capture');
  assert.deepEqual(cut.flagged, []);
  const addresses = cut.destinations.map((d) => d.address);
  assert.ok(addresses.includes('192.0.2.10'), "the run's own destination is missing");
  assert.ok(addresses.includes('10.0.2.2'), 'the upload to the receiver is missing');
  for (const later of ['198.51.100.20', '203.0.113.40']) {
    assert.equal(addresses.includes(later), false, `${later}, from after the run, is listed`);
  }

  const whole = await judgeCapture({ text: GROWN, ...NETWORK });
  assert.equal(whole.status, 'failed', 'without a window, the whole file is read');
  assert.ok(whole.flagged.some((flag) => flag.owner === 'vendor'));
});

test('SPIKE-01-AC12: what came before the window is not read either', async () => {
  const before = [
    tt(T0 - 30 * 60_000, 'IP 10.0.2.15.40009 > 10.0.2.3.53: 4109+ A? app-measurement.com. (37)'),
    GROWN,
  ].join('\n');
  const result = await judgeCapture({ text: before, ...NETWORK, ...IN });
  assert.deepEqual(result.flagged, [], 'a lookup before the run was flagged');
  assert.equal(result.status, 'passed');
});

test('SPIKE-01-AC12: a window over lines with only a time of day, or a window that holds no upload to the receiver, is refused, never read as "nothing sent"', async () => {
  await assert.rejects(
    judgeCapture({ text: text(), ...NETWORK, ...IN }),
    /window|date|epoch|-tt/i,
    'lines without a date cannot be placed in the window',
  );
  await assert.rejects(
    judgeCapture({
      text: GROWN,
      ...NETWORK,
      from: IN.to + 60 * 60_000,
      to: IN.to + 90 * 60_000,
    }),
    /receiver/i,
    'a window that holds none of the run, on the wrong clock, did not capture the run',
  );
});
