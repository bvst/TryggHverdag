/**
 * What a server process reads from its environment, read once and checked.
 *
 * Every process — the API, the worker, the migration — starts here, so a
 * missing or malformed setting stops it before it does anything. The
 * alternative is a process that starts, listens, and then fails every request:
 * from the outside that looks like a successful deploy.
 *
 * One exception: where the worker checks in with Healthchecks.io
 * (readHealthchecksSetting). A monitoring setting must never stop the watchdog
 * it watches, or put it in a crash loop.
 */

/** The port Clever Cloud sends traffic to, and checks before a deploy counts as done. */
export const DEFAULT_PORT = 8080;

export interface ServerConfig {
  databaseUrl: string;
  port: number;
}

/**
 * Where the database is. `DATABASE_URL` first, so it can always be overridden;
 * then `POSTGRESQL_ADDON_URI`, which Clever Cloud injects into an application
 * linked to a PostgreSQL add-on.
 */
const DATABASE_VARIABLES = ['DATABASE_URL', 'POSTGRESQL_ADDON_URI'] as const;

/** An empty variable is an unset one: nothing useful is ever called "". */
function present(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

export function readServerConfig(env: Record<string, string | undefined>): ServerConfig {
  const databaseUrl = DATABASE_VARIABLES.map((name) => present(env[name])).find(
    (value) => value !== undefined,
  );
  if (databaseUrl === undefined) {
    throw new Error(
      `No database: set ${DATABASE_VARIABLES.join(' or ')}. ` +
        'On Clever Cloud, linking the PostgreSQL add-on sets POSTGRESQL_ADDON_URI.',
    );
  }

  return { databaseUrl, port: readPort(present(env['PORT'])) };
}

/**
 * Whether the worker checks in with Healthchecks.io, and where (INF-08). Never
 * a throw: a value that cannot be used is a reason, which the worker writes at
 * start. The value is dropped rather than carried in the reason, because anyone
 * holding a ping URL can keep the check green while the worker is dead.
 */
export type HealthchecksSetting =
  { checkingIn: true; url: string } | { checkingIn: false; reason: string };

const HEALTHCHECKS_VARIABLE = 'HEALTHCHECKS_WORKER_URL';

export function readHealthchecksSetting(
  env: Record<string, string | undefined>,
): HealthchecksSetting {
  const value = present(env[HEALTHCHECKS_VARIABLE]);
  if (value === undefined) {
    return { checkingIn: false, reason: `${HEALTHCHECKS_VARIABLE} is not set.` };
  }
  const url = URL.parse(value);
  if (url === null) {
    return { checkingIn: false, reason: `${HEALTHCHECKS_VARIABLE} is not a URL.` };
  }
  // The URL is the secret, so it is never sent in clear text.
  if (url.protocol !== 'https:') {
    return {
      checkingIn: false,
      reason: `${HEALTHCHECKS_VARIABLE} is not an https: URL, and the ping URL is never sent unencrypted.`,
    };
  }
  return { checkingIn: true, url: value };
}

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }
  // Digits only: Number() would accept " 80", "8e3" and "0x50", and each of
  // those is a typo that deserves an error rather than an interpretation.
  const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port > 65_535) {
    throw new Error(`PORT must be a whole number from 0 to 65535, not ${JSON.stringify(value)}.`);
  }
  return port;
}
