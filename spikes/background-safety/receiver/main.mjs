#!/usr/bin/env node
// SPIKE-01-AC3: the receiver's command-line entry, on the Mac's real clock.
//
//   node receiver/main.mjs --run <run-id> [--port <port>]
//
// - Records go to ~/spike-runs/<run-id>, outside the repository.
// - It listens on 127.0.0.1 only. The emulator reaches it as 10.0.2.2.
// - Arrival times are the Mac's wall clock; durations come from a monotonic
//   source (performance.now), so a clock correction cannot create or hide a gap.
// - It prints no body and no position: startReceiver prints only counts, paths
//   and reasons.
// - The port defaults to the one bundled into the app (app/src/fixed.json).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { startReceiver } from './receiver.mjs';

const RUN_ID = /^[A-Za-z0-9-]{1,64}$/;
const USAGE = 'usage: node receiver/main.mjs --run <run-id> [--port <port>]';

function fail(message) {
  process.stderr.write(`${message}\n${USAGE}\n`);
  process.exit(2);
}

let values;
try {
  ({ values } = parseArgs({ options: { run: { type: 'string' }, port: { type: 'string' } } }));
} catch (error) {
  fail(error.message);
}
if (values.run === undefined || !RUN_ID.test(values.run)) {
  fail('--run is needed: letters, digits and hyphens only, at most 64');
}
const fixed = JSON.parse(readFileSync(new URL('../app/src/fixed.json', import.meta.url), 'utf8'));
const port = values.port === undefined ? fixed.receiverPort : Number(values.port);

/** The real clock: wall time for `at`, a monotonic source for `mono`. */
const clock = {
  now: () => Date.now(),
  monotonic: () => performance.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle),
};

const receiver = await startReceiver({
  dir: join(homedir(), 'spike-runs', values.run),
  port,
  clock,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    receiver.close().then(() => process.exit(0));
  });
}
