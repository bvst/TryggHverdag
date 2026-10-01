// SPIKE-01: judges one run's folder with the tested per-run judge
// (analysis/judge-run.mjs). Thin glue: it reads the files the driver saved and
// hands them over as data; every rule is in the analysis (the code review's
// N4). It never throws.
//
// - meta.json and the receiver's records are parsed; a file that is missing
//   or cannot be parsed is given as null, and the judge says so;
// - screenshots (*.png) are given as bytes, every other file as text;
// - the capture (meta.capture) is given as capture.txt, the text of
//   `tcpdump -tt -nn -r` on it: the judge needs each packet's date.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { judgeRun } from '../../analysis/judge-run.mjs';

const RECEIVER_FILE = /^receiver-\d+\.jsonl$/;

/** The JSON lines of a file; throws when one is not JSON. */
function jsonLines(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** The text `tcpdump -tt -nn -r` prints for a pcap. */
function captureText(file) {
  return execFileSync('tcpdump', ['-tt', '-nn', '-r', file], {
    encoding: 'utf8',
    maxBuffer: 1 << 30,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * The run's folder as the judge takes it: { meta, records, files }, and what
 * could not be read (`unread`), word for word.
 */
export function readRunFolder(dir) {
  const unread = [];
  if (!existsSync(dir)) {
    return { meta: null, records: null, files: {}, unread: ['the run has no folder'] };
  }
  let meta = null;
  try {
    meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') unread.push(`meta.json could not be parsed (${error.name})`);
  }
  let records = null;
  const receiver = readdirSync(dir).find((name) => RECEIVER_FILE.test(name));
  if (receiver !== undefined) {
    try {
      records = jsonLines(join(dir, receiver));
    } catch (error) {
      unread.push(`${receiver} could not be parsed (${error.name})`);
    }
  }
  const files = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isFile() || name === 'meta.json' || RECEIVER_FILE.test(name)) continue;
    if (name.endsWith('.pcap')) continue;
    files[name] = name.endsWith('.png') ? readFileSync(path) : readFileSync(path, 'utf8');
  }
  if (typeof meta?.capture === 'string' && meta.capture !== '') {
    try {
      files['capture.txt'] = captureText(join(dir, meta.capture));
    } catch (error) {
      unread.push(`tcpdump could not read ${meta.capture} (${error.code ?? error.name})`);
    }
  }
  return { meta, records, files, unread };
}

/**
 * Judges the run in `dir`, given how its driver exited ({ code, signal }).
 * Never throws: whatever cannot be judged is an invalid run with the reason.
 * @returns {{ status: 'passed' | 'failed' | 'invalid', evidence: string[], details: object }}
 */
export function judgeRunFolder(dir, exit) {
  try {
    const { meta, records, files, unread } = readRunFolder(dir);
    const result = judgeRun({ meta, records, files, exit });
    if (unread.length === 0) return result;
    // What could not be read is said beside the result, and in an invalid
    // run's evidence; it never changes the status.
    const evidence =
      result.status === 'invalid' ? [...unread, ...result.evidence] : result.evidence;
    return { ...result, evidence, details: { ...result.details, unread } };
  } catch (error) {
    return {
      status: 'invalid',
      evidence: [`the run's folder could not be read: ${error?.message ?? String(error)}`],
      details: {},
    };
  }
}
