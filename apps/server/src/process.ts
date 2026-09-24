/**
 * How a server process ends.
 *
 * Two rules. On the platform's signal it stops what it started and exits with
 * 0, so a deploy or a restart never cuts a query in half. On any failure it
 * exits with 1 and says what failed, so the platform restarts it and whoever
 * reads the log knows why.
 *
 * What it says is chosen, never the raw error object. `pg` and
 * `graphile-worker` errors can carry the connection string, and the connection
 * string carries the database password (D-068). Every message leaving a
 * process goes through `redactCredentials` first.
 */
import process from 'node:process';
import { inspect } from 'node:util';

/** `scheme://user:password@` — the password is whatever sits between the colon and the @. */
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)[^\s@/]*@/gi;

/** libpq's other form: `password=secret` among `host=… dbname=…`. */
const KEYWORD_PASSWORD = /\b(password\s*=\s*)('[^']*'|\S+)/gi;

export function redactCredentials(text: string): string {
  return text.replace(URL_PASSWORD, '$1***@').replace(KEYWORD_PASSWORD, '$1***');
}

/**
 * One line: what kind of failure, what it said, and what caused it — with any
 * password removed. The cause matters: Drizzle reports a refused connection as
 * "Failed query: …" and keeps the refusal in `cause`, so leaving the chain out
 * would report that something failed and hide why.
 */
export function describeFailure(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    parts.push(describeOne(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return redactCredentials(parts.join(' ← '));
}

/** An Error by its name and message; anything else thrown as itself, never "[object Object]". */
function describeOne(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  return typeof value === 'string' ? value : inspect(value, { depth: 2, breakLength: Infinity });
}

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
