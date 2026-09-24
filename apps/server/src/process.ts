/**
 * How a server process ends — a safety path (D-077): whether a worker that
 * stopped is restarted depends on the exit code this chooses.
 *
 * Two rules. On the platform's signal it stops what it started and exits with
 * 0, so a deploy or a restart never cuts a query in half. On any failure it
 * exits with 1 and says what failed, in one line with any password removed
 * (redact.ts), so the platform restarts it and whoever reads the log knows why.
 */
import process from 'node:process';
import { describeFailure } from './redact.ts';

export interface Reporting {
  write?: (text: string) => void;
  exit?: (code: number) => void;
}

const defaults = {
  write: (text: string) => {
    process.stderr.write(text);
  },
  exit: (code: number) => {
    process.exit(code);
  },
};

/**
 * Runs a process's start-up. If it throws — no database, a port already
 * taken, a worker that crashed — the process reports it and exits with 1.
 */
export function runMain(name: string, main: () => Promise<void>, reporting: Reporting = {}): void {
  const { write = defaults.write, exit = defaults.exit } = reporting;
  main().catch((error: unknown) => {
    write(`${name} failed: ${describeFailure(error)}\n`);
    exit(1);
  });
}

/** Anything that can deliver a signal: `process`, or an EventEmitter in a test. */
export interface Signals {
  once(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

/**
 * On SIGTERM or SIGINT, stops once, then exits. The platform sends SIGTERM to
 * stop an instance and may follow with SIGINT; stopping twice would end the
 * connection pool twice, which throws.
 */
export function exitOnSignal({
  name,
  signals,
  stop,
  write = defaults.write,
  exit = defaults.exit,
}: {
  name: string;
  signals: Signals;
  stop: () => Promise<void>;
} & Reporting): void {
  let stopping = false;
  const onSignal = () => {
    if (stopping) {
      return;
    }
    stopping = true;
    stop().then(
      () => {
        exit(0);
      },
      (error: unknown) => {
        write(`${name} failed while stopping: ${describeFailure(error)}\n`);
        exit(1);
      },
    );
  };
  signals.once('SIGTERM', onSignal);
  signals.once('SIGINT', onSignal);
}
