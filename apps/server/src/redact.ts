/**
 * What a server process may print when it fails: what went wrong and why, in
 * one line, and never the database password.
 *
 * `pg` and `graphile-worker` errors can carry the connection string, and the
 * connection string carries the password (D-068). Everything the entry points
 * write about a failure goes through `describeFailure`.
 *
 * What this does not cover, stated so nobody assumes it does (D-077): output
 * that never passes through here — Graphile Worker's own logger, Hono's and
 * the Node server's default error printing, and Node's printer for an uncaught
 * exception. Choosing those is the job of the task that decides how logging
 * works (D-068).
 */
import { inspect } from 'node:util';

/**
 * `scheme://user:password@host` — everything between the user's colon and the
 * last @ before the path, so a password containing @ is covered too. No `\b`
 * in front: a scheme glued to `_` or a digit is still a scheme.
 */
const URL_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)[^\s/]*@/gi;

/**
 * A password named as such: libpq's `password=…`, the variables that end in it
 * (`PGPASSWORD`, Clever Cloud's `POSTGRESQL_ADDON_PASSWORD`), `password: '…'`
 * as `inspect` prints an object, and JSON. Quoted values may hold spaces and
 * escaped quotes.
 */
const NAMED_PASSWORD =
  /(password['"]?\s*[:=]\s*)('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|[^\s,;}&]+)/gi;

export function redactCredentials(text: string): string {
  return text.replace(URL_PASSWORD, '$1***@').replace(NAMED_PASSWORD, '$1***');
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
  return redactCredentials(parts.join(' ← ')).replace(/\s*\n\s*/g, ' ');
}

/** An Error by its name and message; anything else thrown as itself, never "[object Object]". */
function describeOne(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  return typeof value === 'string' ? value : inspect(value, { depth: 2, breakLength: Infinity });
}
