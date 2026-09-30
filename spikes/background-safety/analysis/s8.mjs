// SPIKE-01-AC16 (S8): MapLibre draws Kartverket's tiles. Outside the go/no-go.
// Pure: judges bytes and text it is given; reads no clock and no file.
//
// A screenshot is a PNG. The decoder reads 8-bit RGB and RGBA (colour types 2
// and 6), every row filter, split image data and ancillary chunks, and refuses
// anything else rather than measure it.
import { crc32, inflateSync } from 'node:zlib';

/** Each channel may be this far from the sentinel and still count as sentinel. */
const SENTINEL_TOLERANCE = 8;
/** At most this share of the map may be sentinel: 1 %, compared in whole pixels. */
const MAX_SENTINEL_PERCENT = 1;

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const refuse = (why) => new Error(`screenshot refused: ${why}`);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** The IHDR fields this decoder accepts, or a refusal. */
function readHeader(data) {
  if (data.length !== 13) throw refuse('its header chunk has the wrong length');
  const header = {
    width: data.readUInt32BE(0),
    height: data.readUInt32BE(4),
    bitDepth: data[8],
    colourType: data[9],
    compression: data[10],
    filterMethod: data[11],
    interlace: data[12],
  };
  if (header.width === 0 || header.height === 0) throw refuse('it has no pixels');
  if (header.bitDepth !== 8) throw refuse(`bit depth ${header.bitDepth} is not read, only 8`);
  if (header.colourType !== 2 && header.colourType !== 6) {
    throw refuse(`colour type ${header.colourType} is not read, only RGB (2) and RGBA (6)`);
  }
  if (header.compression !== 0 || header.filterMethod !== 0) {
    throw refuse('it uses a compression or filter method PNG does not define');
  }
  if (header.interlace !== 0) throw refuse('interlaced PNGs are not read');
  return header;
}

/**
 * Decodes a PNG into its pixels, row by row.
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number, channels: 3 | 4, pixels: Buffer }}
 */
export function decodePng(bytes) {
  if (!(bytes instanceof Uint8Array)) throw refuse('it is not bytes');
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < SIGNATURE.length || !buf.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
    throw refuse('it is not a PNG');
  }
  let header = null;
  const data = [];
  let offset = SIGNATURE.length;
  for (;;) {
    if (offset + 12 > buf.length) throw refuse('it is cut short');
    const length = buf.readUInt32BE(offset);
    const next = offset + 12 + length;
    if (next > buf.length) throw refuse('it is cut short');
    const type = buf.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw refuse('it has a chunk with no valid name');
    const body = buf.subarray(offset + 4, offset + 8 + length);
    if (crc32(body) !== buf.readUInt32BE(offset + 8 + length)) {
      throw refuse(`its ${type} chunk is damaged`);
    }
    const chunk = buf.subarray(offset + 8, offset + 8 + length);
    offset = next;
    if (header === null && type !== 'IHDR') throw refuse('it does not start with a header');
    if (type === 'IHDR') {
      if (header !== null) throw refuse('it has two headers');
      header = readHeader(chunk);
    } else if (type === 'IDAT') {
      data.push(chunk);
    } else if (type === 'IEND') {
      break;
    } else if (type !== 'PLTE' && type[0] === type[0].toUpperCase()) {
      // PLTE is allowed and ignored in RGB and RGBA; other critical chunks are not understood.
      throw refuse(`it has a critical ${type} chunk this decoder does not read`);
    }
  }
  if (data.length === 0) throw refuse('it has no image data');

  const channels = header.colourType === 6 ? 4 : 3;
  const stride = header.width * channels;
  let raw;
  try {
    raw = inflateSync(Buffer.concat(data));
  } catch {
    throw refuse('its image data cannot be decompressed');
  }
  if (raw.length !== header.height * (stride + 1)) {
    throw refuse('its image data does not match its size');
  }

  const pixels = Buffer.alloc(header.height * stride);
  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride;
    const up = row - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? pixels[row + i - channels] : 0;
      const b = y > 0 ? pixels[up + i] : 0;
      const c = y > 0 && i >= channels ? pixels[up + i - channels] : 0;
      let predictor;
      if (filter === 0) predictor = 0;
      else if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = Math.floor((a + b) / 2);
      else if (filter === 4) predictor = paeth(a, b, c);
      else throw refuse(`row ${y} has filter type ${filter}, which PNG does not define`);
      pixels[row + i] = (line[i] + predictor) & 0xff;
    }
  }
  return { width: header.width, height: header.height, channels, pixels };
}

function checkSentinel(sentinel) {
  const ok =
    Array.isArray(sentinel) &&
    sentinel.length === 3 &&
    sentinel.every((value) => Number.isInteger(value) && value >= 0 && value <= 255);
  if (!ok) throw new Error('the sentinel must be an [r, g, b] colour');
}

/**
 * Whether the map's region of a screenshot shows tiles rather than the
 * style's sentinel background.
 * @param {{ png: Uint8Array, sentinel: number[], region?: { x: number, y: number,
 *   width: number, height: number } }} input
 */
export function judgeTiles({ png, sentinel, region }) {
  checkSentinel(sentinel);
  const image = decodePng(png);
  const area = region ?? { x: 0, y: 0, width: image.width, height: image.height };
  const fits =
    [area.x, area.y, area.width, area.height].every(Number.isInteger) &&
    area.x >= 0 &&
    area.y >= 0 &&
    area.width > 0 &&
    area.height > 0 &&
    area.x + area.width <= image.width &&
    area.y + area.height <= image.height;
  if (!fits) throw new Error('the map region is not inside the screenshot');

  const [r, g, b] = sentinel;
  let count = 0;
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) {
      const at = (y * image.width + x) * image.channels;
      if (
        Math.abs(image.pixels[at] - r) <= SENTINEL_TOLERANCE &&
        Math.abs(image.pixels[at + 1] - g) <= SENTINEL_TOLERANCE &&
        Math.abs(image.pixels[at + 2] - b) <= SENTINEL_TOLERANCE
      ) {
        count += 1;
      }
    }
  }
  const total = area.width * area.height;
  return {
    status: count * 100 <= total * MAX_SENTINEL_PERCENT ? 'passed' : 'failed',
    sentinelShare: count / total,
  };
}

const LOGCAT_LINE =
  /^(?:\d{4}-)?\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}\s+\d+\s+\d+\s+[VDIWEFAS]\s+([^:]*?)\s*:\s?(.*)$/;
const JAVA_PROCESS = /^Process: (\S+), PID: \d+/;
const NATIVE_PROCESS = /^pid: \d+, tid: \d+, name: .*>>> (\S+) <<<$/;

function readAndroidCrashes(text, app) {
  const crashes = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || /^-{9} beginning of /.test(line)) continue;
    const match = LOGCAT_LINE.exec(line);
    if (match === null) {
      throw new Error('the crash log holds a line that is not logcat output, so it is not read');
    }
    const [, tag, message] = match;
    const java = tag === 'AndroidRuntime' ? JAVA_PROCESS.exec(message) : null;
    if (java !== null && java[1] === app) crashes.push({ kind: 'java', process: app });
    const native = NATIVE_PROCESS.exec(message);
    if (native !== null && native[1] === app) crashes.push({ kind: 'native', process: app });
  }
  return crashes;
}

function readIosReport(text, app) {
  const notReport = 'the text is not an .ips crash report (a JSON header line, then JSON)';
  const newline = text.indexOf('\n');
  if (newline < 0) throw new Error(notReport);
  let header;
  let body;
  try {
    header = JSON.parse(text.slice(0, newline));
    body = JSON.parse(text.slice(newline + 1));
  } catch {
    throw new Error(notReport);
  }
  if (typeof header !== 'object' || header === null || !('bug_type' in header)) {
    throw new Error('the text is not an .ips crash report (its header has no bug_type)');
  }
  const names = [header.bundleID, body?.bundleInfo?.CFBundleIdentifier];
  return names.includes(app) ? [{ kind: 'ips', process: app }] : [];
}

/**
 * The app's crashes in Android's crash log (`adb logcat -b crash -d`) or in one
 * iOS `.ips` report. Text that is neither is refused, never read as "no crash".
 * @param {{ platform: 'android' | 'ios', text: string, app: string }} input
 * @returns {{ kind: string, process: string }[]}
 */
export function readCrashes({ platform, text, app }) {
  if (typeof text !== 'string') throw new Error('the crash log must be text');
  if (typeof app !== 'string' || app === '') throw new Error('the app id is missing');
  if (platform === 'android') return readAndroidCrashes(text, app);
  if (platform === 'ios') return readIosReport(text, app);
  throw new Error('platform must be android or ios');
}

/**
 * One device's S8 run: three zoom levels drawn, no crash, the app still running,
 * and on Android the native libraries aligned for 16 KB pages.
 * @param {{ platform: 'android' | 'ios', shots: { zoom: number, png: Uint8Array,
 *   region?: object }[], sentinel: number[], crashes: object[],
 *   processRunning: boolean, aligned16k?: boolean }} run
 */
export function judgeS8(run) {
  const { platform, shots, sentinel, crashes, processRunning, aligned16k } = run;
  if (platform !== 'android' && platform !== 'ios') {
    throw new Error('platform must be android or ios');
  }
  if (!Array.isArray(shots) || shots.length !== 3) {
    throw new Error('an S8 run needs screenshots at exactly three zoom levels');
  }
  const zooms = shots.map((shot) => shot.zoom);
  if (!zooms.every(Number.isInteger) || new Set(zooms).size !== 3) {
    throw new Error('the three screenshots must be at three different zoom levels');
  }
  if (!Array.isArray(crashes)) throw new Error('crashes must be the list readCrashes returned');
  if (typeof processRunning !== 'boolean') {
    throw new Error('processRunning must say whether the app was still running');
  }
  if (platform === 'android' && typeof aligned16k !== 'boolean') {
    throw new Error('an Android run needs the result of the 16 KB alignment check');
  }

  const judged = shots.map((shot) => ({
    zoom: shot.zoom,
    ...judgeTiles({ png: shot.png, sentinel, region: shot.region }),
  }));
  const problems = [];
  for (const shot of judged) {
    if (shot.status !== 'passed') problems.push(`zoom ${shot.zoom}: the tiles were not drawn`);
  }
  if (crashes.length > 0) problems.push(`${crashes.length} crash(es) of the app`);
  if (!processRunning) problems.push('the app was no longer running');
  if (platform === 'android' && !aligned16k) {
    problems.push('the native libraries are not aligned for 16 KB pages');
  }
  return {
    status: problems.length === 0 ? 'passed' : 'failed',
    platform,
    shots: judged,
    problems,
  };
}
