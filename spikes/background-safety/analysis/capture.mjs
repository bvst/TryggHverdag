// SPIKE-01-AC12: reads the text of `tcpdump -nn -r <capture.pcap>` for the
// emulator's capture of one S1 run, lists every destination the device sent to,
// and flags the SDK's vendor, analytics and advertising. Pure.
//
// Names come only from the capture's own DNS answers. A destination that no
// name places is "unknown", and the capture then does not pass: nothing is
// assumed about an address nobody named.

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
    ],
  ],
];
const FLAGGED = new Set(['vendor', 'analytics', 'advertising']);
const RANK = ['vendor', 'analytics', 'advertising', 'platform'];

const PACKET = /^\d\d:\d\d:\d\d\.\d+\s+(\S+)\s+(.*)$/;
const FLOW = /^(\S+) > (\S+): ?(.*)$/;
const QUERY = /^(\d+)\+?(?:\s+\[[^\]]*\])*\s+(\w+)\?\s+(\S+)/;
const ANSWER = /^(\d+)\S*\s+(?:[A-Za-z]+\s+)?\d+\/\d+\/\d+(.*)$/;

/** The owner a DNS name belongs to, or null. */
function ownerOfName(name) {
  for (const [owner, domains] of OWNERS) {
    if (domains.some((domain) => name === domain || name.endsWith(`.${domain}`))) return owner;
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

const same = (a, b) => a.address === b.address && a.port === b.port;

/**
 * @param {{ text: string, device: string[], receiver: { address: string, port: number },
 *   resolver: { address: string, port: number } }} input
 * @returns {{ status: 'passed' | 'failed', destinations: object[], flagged: object[],
 *   problems: string[] }}
 */
export function judgeCapture({ text, device, receiver, resolver }) {
  if (typeof text !== 'string') throw new Error('the capture must be the text tcpdump printed');
  if (!Array.isArray(device) || device.length === 0) {
    throw new Error("the device's own addresses are needed to read the capture");
  }
  const destinations = new Map();
  const namesOf = new Map();
  const queries = new Map();
  const lookedUp = [];
  let packets = 0;

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.startsWith('reading from file ')) continue;
    const packet = PACKET.exec(line);
    if (packet === null) {
      throw new Error('the text holds a line that is not tcpdump packet output, so it is not read');
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
      if (same(to, resolver)) {
        const query = QUERY.exec(payload);
        if (query !== null) {
          const name = dnsName(query[3]);
          queries.set(`${from.address}|${from.port}|${query[1]}`, name);
          lookedUp.push(name);
        }
      }
    } else if (same(from, resolver) && device.includes(to.address)) {
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
  if (packets === 0) throw new Error('the capture holds no packets, so it shows nothing');
  if (![...destinations.values()].some((to) => same(to, receiver))) {
    throw new Error('the capture holds no upload to the receiver, so it did not capture the run');
  }

  const listed = [...destinations.values()].map(({ address, port }) => {
    const names = [...(namesOf.get(address) ?? [])];
    let owner;
    if (same({ address, port }, resolver)) owner = 'dns';
    else if (same({ address, port }, receiver)) owner = 'receiver';
    else {
      const owners = names.map(ownerOfName).filter((found) => found !== null);
      owner = RANK.find((rank) => owners.includes(rank)) ?? 'unknown';
    }
    return { address, port, names, owner };
  });

  // Each flagged name once, whether it was only looked up or also connected to.
  const flags = new Map();
  const names = [...lookedUp, ...listed.flatMap((destination) => destination.names)];
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
