// SPIKE-01-AC3: the throwaway receiver. It takes the SDK's uploads on the Mac's
// loopback address and keeps only what the checks need: times, IDs and flags.
//
// - Positions are dropped on arrival. Nothing that locates the device is ever
//   stored or printed, and no request body is printed, in error paths either.
// - Times come only from the injected clock: `at` from `clock.now()`,
//   durations from `clock.monotonic()`, and the 10 s tick from
//   `clock.setInterval`.
// - Records are JSON Lines in the injected directory, which must be outside the
//   repository.
//
// Routes (all POST):
//   /upload/android, /upload/ios  an upload from the SDK: 200 once stored
//   /refuse, /accept              refuse uploads (503) until told to accept
//   /mark/<label>                 a driver's mark, on the receiver's clock
import { appendFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY = fileURLToPath(new URL('../../../', import.meta.url));
const LOOPBACK = new Set(['127.0.0.1', '::1']);
const PLATFORMS = new Set(['android', 'ios']);
const TICK_MS = 10_000;
const MAX_BODY_BYTES = 1_000_000;

// What a kept field may look like. None admits a decimal point or a digit
// where a coordinate could hide, except the SDK's own ID and timestamp.
const RECORD_ID = /^[A-Za-z0-9-]{1,64}$/;
const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:?\d\d)$/;
const PERMISSION = /^[A-Za-z][A-Za-z/_-]{0,39}$/;
const LABEL = /^[A-Za-z0-9-]{1,64}$/;

/** A field that does not have the shape the receiver keeps. Its message names the field only. */
class ShapeError extends Error {}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `value` if it matches `test`, null if absent, otherwise a ShapeError naming `field`. */
function kept(value, field, test) {
  if (value === undefined || value === null) return null;
  if (test(value)) return value;
  throw new ShapeError(`${field} is not in the expected shape`);
}

/** The status fields the app adds to each upload. */
function statusFrom(app) {
  if (app !== undefined && app !== null && !isObject(app))
    throw new ShapeError('app is not an object');
  const fields = app ?? {};
  return {
    queueCount: kept(fields.queueCount, 'app.queueCount', (v) => Number.isInteger(v) && v >= 0),
    permission: kept(fields.permission, 'app.permission', (v) => PERMISSION.test(String(v))),
    exempt: kept(fields.exempt, 'app.exempt', (v) => typeof v === 'boolean'),
  };
}

/** The kept fields of one SDK location: never its coordinates, only whether it had any. */
function fromLocation(location, i) {
  if (!isObject(location)) throw new ShapeError(`location ${i} is not an object`);
  const coords = location.coords;
  return {
    recordId: kept(location.uuid, 'uuid', (v) => typeof v === 'string' && RECORD_ID.test(v)),
    recordedAt: kept(location.timestamp, 'timestamp', (v) => TIMESTAMP.test(String(v))),
    hasPosition:
      isObject(coords) && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude),
    moving: kept(location.is_moving, 'is_moving', (v) => typeof v === 'boolean'),
  };
}

/** One arrival record per location in the upload, or one with no position. */
function arrivalsFrom(body, platform, at, mono) {
  if (!isObject(body)) throw new ShapeError('the body is not a JSON object');
  const status = statusFrom(body.app);
  const locations = body.location === undefined ? [] : [body.location].flat();
  const each = locations.length > 0 ? locations.map(fromLocation) : [noPosition()];
  return each.map((fields) => ({ kind: 'arrival', at, mono, platform, ...fields, ...status }));
}

const noPosition = () => ({ recordId: null, recordedAt: null, hasPosition: false, moving: null });

function isInside(path, parent) {
  const rel = relative(parent, path);
  return rel === '' || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/** The real path of `path`, resolving symbolic links in the part of it that exists. */
function realPath(path) {
  let existing = resolve(path);
  const missing = [];
  while (!existsSync(existing)) {
    missing.unshift(basename(existing));
    existing = dirname(existing);
  }
  return join(realpathSync(existing), ...missing);
}

function checkOptions({ dir, host, port, clock }) {
  if (typeof dir !== 'string' || dir === '') {
    throw new Error('dir is missing: the receiver needs a directory for its records');
  }
  if (isInside(realPath(dir), realpathSync(REPOSITORY))) {
    throw new Error('dir is inside the repository: records must be kept outside it');
  }
  if (!LOOPBACK.has(host)) {
    throw new Error('the receiver listens on loopback only (127.0.0.1 or ::1)');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('port is not a port');
  const needs = ['now', 'monotonic', 'setInterval', 'clearInterval'];
  if (!needs.every((name) => typeof clock?.[name] === 'function')) {
    throw new Error(`clock must provide ${needs.join(', ')}`);
  }
}

/** The whole body, or null if it is larger than the receiver accepts. */
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on('end', () => resolveBody(size <= MAX_BODY_BYTES ? Buffer.concat(chunks) : null));
    req.on('error', reject);
  });
}

/**
 * @param {{ dir: string, host?: string, port: number,
 *   clock: { now(): number, monotonic(): number, setInterval(fn: () => void, ms: number): unknown,
 *     clearInterval(handle: unknown): void },
 *   print?: (line: string) => void }} options
 * @returns {Promise<{ address: string, port: number, file: string, close(): Promise<void> }>}
 */
export async function startReceiver({
  dir,
  host = '127.0.0.1',
  port,
  clock,
  print = (line) => process.stdout.write(`${line}\n`),
}) {
  checkOptions({ dir, host, port, clock });
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `receiver-${clock.now()}.jsonl`);
  writeFileSync(file, '', { flag: 'wx' });
  const write = (record) => appendFileSync(file, `${JSON.stringify(record)}\n`);
  let refusing = false;

  async function handle(req, res) {
    const reply = (status) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(status === 200 ? '{}' : '');
    };
    const body = await readBody(req);
    const path = (req.url ?? '').split('?')[0];
    if (req.method !== 'POST') return reply(405);
    if (body === null) {
      print(`rejected a request to ${path}: its body is larger than ${MAX_BODY_BYTES} bytes`);
      return reply(413);
    }
    if (path === '/refuse' || path === '/accept') {
      refusing = path === '/refuse';
      print(refusing ? 'refusing uploads' : 'accepting uploads');
      return reply(200);
    }
    if (path.startsWith('/mark/')) {
      const label = path.slice('/mark/'.length);
      if (!LABEL.test(label)) return reply(400);
      write({ kind: 'mark', label, at: clock.now(), mono: clock.monotonic() });
      return reply(200);
    }
    const platform = path.startsWith('/upload/') ? path.slice('/upload/'.length) : null;
    if (!PLATFORMS.has(platform)) return reply(404);
    if (refusing) return reply(503);
    let parsed;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      // The parser's message quotes the body, so it is never printed.
      print(`rejected an upload to ${path}: its body is not JSON`);
      return reply(400);
    }
    let arrivals;
    try {
      arrivals = arrivalsFrom(parsed, platform, clock.now(), clock.monotonic());
    } catch (error) {
      if (!(error instanceof ShapeError)) throw error;
      print(`rejected an upload to ${path}: ${error.message}`);
      return reply(400);
    }
    arrivals.forEach(write);
    return reply(200);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      // Only the error's code or name: a message could quote what was received.
      print(`the receiver failed on a request: ${error?.code ?? error?.name ?? 'unknown error'}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolveListen();
    });
  });
  const ticker = clock.setInterval(() => {
    write({ kind: 'tick', at: clock.now(), mono: clock.monotonic() });
  }, TICK_MS);
  const bound = server.address();
  print(`receiver listening on ${bound.address}:${bound.port}; records in ${file}`);

  return {
    address: bound.address,
    port: bound.port,
    file,
    close: () =>
      new Promise((resolveClose) => {
        clock.clearInterval(ticker);
        server.close(() => resolveClose());
        server.closeIdleConnections();
      }),
  };
}
