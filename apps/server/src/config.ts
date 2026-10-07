/**
 * What a server process reads from its environment, read once and checked.
 *
 * Every process — the API, the worker, the migration — starts here, so a
 * missing or malformed setting stops it before it does anything. The
 * alternative is a process that starts, listens, and then fails every request:
 * from the outside that looks like a successful deploy.
 *
 * One exception: where the worker checks in with Healthchecks.io
 * (readHealthchecksSetting), and where its SMS check reports
 * (readHealthchecksSmsSetting). A monitoring setting must never stop the
 * watchdog it watches, or put it in a crash loop.
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

export function readHealthchecksSetting(
  env: Record<string, string | undefined>,
): HealthchecksSetting {
  return readPingSetting(env, 'HEALTHCHECKS_WORKER_URL');
}

/**
 * Whether the worker's SMS check reports to its own Healthchecks.io check, and
 * where (LOST-07, D-115): read by the same rules as the check-in's, from a
 * variable of its own, so neither address can stand in for the other.
 */
export function readHealthchecksSmsSetting(
  env: Record<string, string | undefined>,
): HealthchecksSetting {
  return readPingSetting(env, 'HEALTHCHECKS_SMS_URL');
}

/**
 * The path of a check's ping URL: "/" and the check's UUID, in lower case, as
 * Healthchecks.io shows it (D-116, review loop 2).
 */
const CHECK_PATH = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A ping URL from `variable`: usable only when set, a URL, https:, and the
 * check's address in its one spelling, so the worker can compare the two
 * settings (D-116, review loops 1 and 2): no query, no fragment, no trailing
 * slash, the value exactly its own parsed spelling, and its path "/" and a
 * lower-case UUID. Healthchecks.io reads `/<uuid>` and `/<uuid>/` as one
 * check, a query or fragment leaves the check unchanged, and the slug form
 * names a check its UUID also names; the URL parser drops spaces, tabs and
 * newlines, reads a backslash as a slash, and lower-cases the host. So two
 * settings that differ as strings could still name one check, and a green
 * ping to one would keep the other's check green. Any https: host is taken,
 * as INF-08 takes it.
 *
 * The SMS check's alarm builds /fail on the URL's path
 * (adapters/healthchecks.ts), so for the failure signal this refusal is a
 * second guard, not the only one (LOST-07, D-079).
 *
 * The worker's URL is read by the same rule, so the two are read alike. Each
 * refusal names the variable, never the value.
 */
function readPingSetting(
  env: Record<string, string | undefined>,
  variable: string,
): HealthchecksSetting {
  const value = present(env[variable]);
  if (value === undefined) {
    return { checkingIn: false, reason: `${variable} is not set.` };
  }
  const url = URL.parse(value);
  if (url === null) {
    return { checkingIn: false, reason: `${variable} is not a URL.` };
  }
  // The URL is the secret, so it is never sent in clear text.
  if (url.protocol !== 'https:') {
    return {
      checkingIn: false,
      reason: `${variable} is not an https: URL, and the ping URL is never sent unencrypted.`,
    };
  }
  // Read in the value itself: a bare "?" or "#" leaves the parsed URL's search
  // and hash empty, and the spelling check below takes any query or fragment,
  // since the parser spells both back as given.
  if (value.includes('?')) {
    return {
      checkingIn: false,
      reason: `${variable} has a query ("?"); the ping URL is the check's address with nothing after it.`,
    };
  }
  if (value.includes('#')) {
    return {
      checkingIn: false,
      reason: `${variable} has a fragment ("#"); the ping URL is the check's address with nothing after it.`,
    };
  }
  if (value.endsWith('/')) {
    return {
      checkingIn: false,
      reason: `${variable} ends in a slash; the ping URL is the check's address with nothing after it.`,
    };
  }
  if (url.href !== value || !CHECK_PATH.test(url.pathname)) {
    return {
      checkingIn: false,
      reason: `${variable} is not the check's address in its one spelling: expected https://, the host, "/" and the check's UUID in lower case, and nothing else.`,
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
