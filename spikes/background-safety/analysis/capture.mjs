// SPIKE-01-AC12 and AC16: reads the text of `tcpdump -tt -nn -r <capture.pcap>`
// (or of `tcpdump -nn -r`, with a time of day only) for an emulator capture and
// lists every destination the device sent to. Pure.
//
// - judgeCapture (AC12) judges one S1 run: uploads go to the receiver only,
//   and the SDK's vendor, analytics and advertising are flagged.
// - listDestinations (AC16) records S8's map run, with no verdict: Kartverket,
//   the platform and DNS are marked, and everything else is flagged.
//
// Names come only from the capture's own DNS answers. A destination that no
// name places is "unknown": nothing is assumed about an address nobody named.
//
// The emulator's network has both families (the code review's B2): the
// receiver and the resolver are each given with every address they have
// ({ addresses, port }), and the device with all of its own.
//
// The emulator keeps its capture on across runs, so the file grows past the
// run (the safety review's S1). With a window (`from`, `to`: ms since the
// epoch, on the capture's own clock), only the packets inside it are read;
// that needs `-tt` lines, which carry the date.

/** Owners by domain, in the order they are checked: the first match wins. */
const OWNERS = [
  ['vendor', ['transistorsoft.com']],
  [
    'analytics',
    [
      'app-measurement.com',
      'google-analytics.com',
      'analytics.google.com',
      'crashlytics.com',
      'sentry.io',
      'segment.io',
      'mixpanel.com',
      'amplitude.com',
      'appsflyer.com',
      'adjust.com',
      'branch.io',
      'bugsnag.com',
      // Firebase, which expo-notifications links on Android (the privacy
      // review's should-fix 2). These hosts sit under googleapis.com; as
      // analytics comes before the platform, they win over it.
      'firebaseinstallations.googleapis.com',
      'fcm.googleapis.com',
      'fcmtoken.googleapis.com',
      'firebaselogging-pa.googleapis.com',
    ],
  ],
  [
    'advertising',
    [
      'doubleclick.net',
      'googleadservices.com',
      'googlesyndication.com',
      'adservice.google.com',
      'admob.com',
      'applovin.com',
    ],
  ],
  [
    'platform',
    [
      'google.com',
      'googleapis.com',
      'gstatic.com',
      'android.com',
      'googleusercontent.com',
      'gvt1.com',
      'gvt2.com',
      'ggpht.com',
      // The emulator SIM's carrier entitlement service, which the image calls
      // itself: by this name only, never by address.
      'ts43.eas3.msg.t-mobile.com',
    ],
  ],
];
const FLAGGED = new Set(['vendor', 'analytics', 'advertising']);
const RANK = ['vendor', 'analytics', 'advertising', 'kartverket', 'platform'];

/** `tcpdump -nn`: a time of day only. */
const PACKET = /^\d\d:\d\d:\d\d\.\d+\s+(\S+)\s+(.*)$/;
/** `tcpdump -tt -nn`: seconds since the epoch, with microseconds. */
const PACKET_TT = /^(\d+\.\d{6})\s+(\S+)\s+(.*)$/;
const FLOW = /^(\S+) > (\S+): ?(.*)$/;
const QUERY = /^(\d+)\+?(?:\s+\[[^\]]*\])*\s+(\w+)\?\s+(\S+)/;
const ANSWER = /^(\d+)\S*\s+(?:[A-Za-z]+\s+)?\d+\/\d+\/\d+(.*)$/;
/** A host name of two labels or more: a bare top-level domain would cover a whole country. */
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/** Whether `name` is `domain` or one of its subdomains. */
const within = (name, domain) => name === domain || name.endsWith(`.${domain}`);

/** The owner a DNS name belongs to, or null. `owners` is OWNERS unless told otherwise. */
function ownerOfName(name, owners = OWNERS) {
  for (const [owner, domains] of owners) {
    if (domains.some((domain) => within(name, domain))) return owner;
  }
  return null;
}

const dnsName = (name) => name.replace(/\.$/, '').toLowerCase();

/** "10.0.2.15.40001" → address and port; "fec0::15.50002" too; no port when there is none. */
function endpoint(text, ipv6) {
  const dot = text.lastIndexOf('.');
  if (ipv6) {
    if (dot < 0) return { address: text, port: null };
    return { address: text.slice(0, dot), port: Number(text.slice(dot + 1)) };
  }
  const parts = text.split('.');
  if (parts.length === 5) return { address: parts.slice(0, 4).join('.'), port: Number(parts[4]) };
  return { address: text, port: null };
}

/** Whether `point` is one of the role's addresses on its port; any port when `port` is null. */
const isAt = (point, role, port = role.port) =>
  role.addresses.includes(point.address) && (port === null || point.port === port);

/** A role's every address and its port: { addresses: string[], port: number }. */
function checkRole(role, name) {
  const ok =
    Array.isArray(role?.addresses) &&
    role.addresses.length > 0 &&
    role.addresses.every((address) => typeof address === 'string' && address !== '') &&
    Number.isInteger(role?.port);
  if (!ok) throw new Error(`the ${name}'s addresses (both families) and port are needed`);
}

/** The window, if given: both ends in ms since the epoch, the start first. */
function checkWindow({ from, to }) {
  if (from === undefined && to === undefined) return null;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    throw new Error("the run's window must be two times in ms since the epoch, the start first");
  }
  return { from, to };
}

/**
 * Reads tcpdump's text: where the device sent to, the names the capture's DNS
 * answers give each address, every name the device looked up, and how many
 * packets were read. With a window, only packets inside it are read. Throws on
 * text that is not tcpdump's packet output, and on a window over lines that
 * carry no date.
 */
function readCapture({ text, device, resolver, from, to }) {
  if (typeof text !== 'string') throw new Error('the capture must be the text tcpdump printed');
  if (!Array.isArray(device) || device.length === 0) {
    throw new Error("the device's own addresses are needed to read the capture");
  }
  checkRole(resolver, 'resolver');
  const window = checkWindow({ from, to });
  const destinations = new Map();
  const namesOf = new Map();
  const queries = new Map();
  const lookedUp = [];
  let packets = 0;

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.startsWith('reading from file ')) continue;
    const dated = PACKET_TT.exec(line);
    const packet = dated === null ? PACKET.exec(line) : [line, dated[2], dated[3]];
    if (packet === null) {
      throw new Error('the text holds a line that is not tcpdump packet output, so it is not read');
    }
    if (window !== null) {
      if (dated === null) {
        throw new Error(
          'a window needs the date of each packet: read the capture with `tcpdump -tt`, ' +
            'whose lines carry seconds since the epoch',
        );
      }
      const at = Number(dated[1]) * 1000;
      if (at < window.from || at > window.to) continue;
    }
    packets += 1;
    const [, protocol, rest] = packet;
    if (protocol !== 'IP' && protocol !== 'IP6') continue;
    const flow = FLOW.exec(rest);
    if (flow === null) continue;
    const from = endpoint(flow[1], protocol === 'IP6');
    const to = endpoint(flow[2], protocol === 'IP6');
    const payload = flow[3];

    if (device.includes(from.address)) {
      const key = `${to.address}|${to.port}`;
      if (!destinations.has(key)) destinations.set(key, to);
      if (isAt(to, resolver)) {
        const query = QUERY.exec(payload);
        if (query !== null) {
          const name = dnsName(query[3]);
          queries.set(`${from.address}|${from.port}|${query[1]}`, name);
          lookedUp.push(name);
        }
      }
    } else if (isAt(from, resolver) && device.includes(to.address)) {
      const answer = ANSWER.exec(payload);
      if (answer === null) continue;
      const asked = queries.get(`${to.address}|${to.port}|${answer[1]}`);
      const names = asked === undefined ? [] : [asked];
      const addresses = [];
      const records = answer[2].replace(/\s*\(\d+\)\s*$/, '').split(',');
      for (const record of records) {
        const [type, value] = record.trim().split(/\s+/);
        if (type === 'CNAME' && value) names.push(dnsName(value));
        if ((type === 'A' || type === 'AAAA') && value) addresses.push(value);
      }
      for (const address of addresses) {
        const known = namesOf.get(address) ?? new Set();
        for (const name of names) known.add(name);
        namesOf.set(address, known);
      }
    }
  }
  return { destinations: [...destinations.values()], namesOf, lookedUp, packets, window };
}

/** A capture with no packets (in its window, if it has one) shows nothing: refused. */
function checkPackets({ packets, window }) {
  if (packets > 0) return;
  throw new Error(
    window === null
      ? 'the capture holds no packets, so it shows nothing'
      : "the capture holds no packets inside the run's window, so it shows nothing",
  );
}

/**
 * Each destination with its names and owner, in this order:
 * - the receiver itself, any of its addresses on its port (judgeCapture only);
 * - a vendor, analytics or advertising name: nothing below can hide one;
 * - any of the resolver's addresses on any port: DNS, and DNS over TLS on 853;
 * - any of the receiver's addresses on another port: the harness (the Mac,
 *   such as the debug build probing it for Metro), in judgeCapture only;
 * - the owner its names give, else unknown.
 */
function ownDestinations(
  { destinations, namesOf },
  { resolver, receiver = null },
  owners = OWNERS,
) {
  return destinations.map(({ address, port }) => {
    const names = [...(namesOf.get(address) ?? [])];
    const found = names.map((name) => ownerOfName(name, owners)).filter((o) => o !== null);
    const byName = RANK.find((rank) => found.includes(rank)) ?? null;
    let owner = byName ?? 'unknown';
    const point = { address, port };
    if (receiver !== null && isAt(point, receiver)) owner = 'receiver';
    else if (FLAGGED.has(byName)) owner = byName;
    else if (isAt(point, resolver, null)) owner = 'dns';
    else if (receiver !== null && isAt(point, receiver, null)) owner = 'harness';
    return { address, port, names, owner };
  });
}

/**
 * @param {{ text: string, device: string[], receiver: { addresses: string[], port: number },
 *   resolver: { addresses: string[], port: number }, from?: number, to?: number }} input
 *   `from`/`to`: the run's window in ms since the epoch, on the capture's clock;
 *   it needs the text of `tcpdump -tt`
 * @returns {{ status: 'passed' | 'failed', destinations: object[], flagged: object[],
 *   problems: string[] }}
 */
export function judgeCapture({ text, device, receiver, resolver, from, to }) {
  checkRole(receiver, 'receiver');
  const capture = readCapture({ text, device, resolver, from, to });
  // The receiver first: a window on the wrong clock holds none of the run, and that is what to say.
  if (!capture.destinations.some((point) => isAt(point, receiver))) {
    if (capture.packets === 0 && capture.window === null) checkPackets(capture);
    throw new Error('the capture holds no upload to the receiver, so it did not capture the run');
  }
  const listed = ownDestinations(capture, { resolver, receiver });

  // Each flagged name once, whether it was only looked up or also connected to.
  const flags = new Map();
  const names = [...capture.lookedUp, ...listed.flatMap((destination) => destination.names)];
  for (const name of names) {
    const owner = ownerOfName(name);
    if (FLAGGED.has(owner) && !flags.has(name)) flags.set(name, { name, owner });
  }
  const flagged = [...flags.values()];

  const problems = flagged.map(({ name, owner }) => `${name}: ${owner}`);
  const unknown = listed.filter((destination) => destination.owner === 'unknown');
  for (const { address, port } of unknown) {
    problems.push(`${address} port ${port ?? 'none'}: no DNS answer in the capture places it`);
  }
  return {
    status: problems.length === 0 ? 'passed' : 'failed',
    destinations: listed,
    flagged,
    problems,
  };
}

/**
 * S8's map capture: recorded, not judged, so there is no verdict and no
 * receiver. Kartverket's hosts are the caller's input, since none is verified
 * yet: each name covers itself and its subdomains.
 *
 * `flagged` holds every vendor, analytics, advertising or unknown destination;
 * every lookup of a vendor, analytics or advertising name, even with no
 * connection after it; and every looked-up name that nothing places.
 *
 * @param {{ text: string, device: string[], resolver: { addresses: string[], port: number },
 *   kartverket: string[], from?: number, to?: number }} input
 * @returns {{ destinations: { address: string, port: number | null, names: string[],
 *   owner: string }[], flagged: object[] }}
 */
export function listDestinations({ text, device, resolver, kartverket, from, to }) {
  if (!Array.isArray(kartverket) || kartverket.length === 0) {
    throw new Error("Kartverket's host names are needed: without them every tile host is unknown");
  }
  const hosts = kartverket.map((name) => (typeof name === 'string' ? dnsName(name) : ''));
  if (hosts.some((name) => !HOST.test(name))) {
    throw new Error("each of Kartverket's hosts must be a DNS name such as tiles.example.no");
  }
  const at = OWNERS.findIndex(([owner]) => owner === 'platform');
  const owners = [...OWNERS.slice(0, at), ['kartverket', hosts], ...OWNERS.slice(at)];

  const capture = readCapture({ text, device, resolver, from, to });
  checkPackets(capture);
  const destinations = ownDestinations(capture, { resolver }, owners);

  const flagged = destinations.filter(
    (destination) => destination.owner === 'unknown' || FLAGGED.has(destination.owner),
  );
  const seen = new Set();
  for (const name of capture.lookedUp) {
    if (seen.has(name)) continue;
    seen.add(name);
    const owner = ownerOfName(name, owners) ?? 'unknown';
    if (owner === 'unknown' || FLAGGED.has(owner)) flagged.push({ name, owner });
  }
  return { destinations, flagged };
}
