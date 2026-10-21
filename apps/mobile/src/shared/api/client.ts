/**
 * The app's one way to the API (GRP-01, approach item 14): a request, and its
 * answer read into what the app does with it.
 *
 * Four answers, kept apart on purpose, because they mean different things to
 * a person holding the phone:
 *   - `ok`: the route answered with its success, and its body;
 *   - `refused`: the route refused, with its status and the contract's code
 *     for it, as every refusal of the API is a fixed shape;
 *   - `unauthorized`: a 401, the one answer for a credential the server no
 *     longer takes. Only this signs a phone out (AC29);
 *   - `unreachable`: no answer at all, or a 5xx. A database that blinked must
 *     never sign anyone out, so this keeps everything as it was and is said
 *     plainly, with a retry.
 *
 * The address is fixed at build time (D-046): `EXPO_PUBLIC_API_URL` when the
 * build sets it, as the L7 build does for the server its CI job starts, and
 * staging otherwise. The credential is sent as `Authorization: Bearer` and
 * nowhere else; nothing here logs, keeps or shows it.
 */

/** Staging's API (D-046): where a build that names no other address talks. */
const STAGING_API = 'https://trygg-hverdag-staging.cleverapps.io';

/**
 * The API's origin, as the build fixed it. Read as `process.env[...]` with
 * the name written out: Expo inlines exactly that form at build time.
 */
const API_ORIGIN: string =
  (process.env['EXPO_PUBLIC_API_URL'] as string | undefined) ?? STAGING_API;

/** How long the app waits for an answer before it says the server could not be reached. */
const ANSWER_LIMIT_MS = 20_000;

/** What a request came to. */
export type ApiAnswer<T> =
  | { kind: 'ok'; body: T }
  | { kind: 'refused'; status: number; code: string | null }
  | { kind: 'unauthorized' }
  | { kind: 'unreachable' };

/** A request: its method, its path under /v1, and, if it has them, a credential and a body. */
export interface ApiRequest {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  credential?: string;
  body?: unknown;
}

const UNREACHABLE = { kind: 'unreachable' } as const;

/** The body as JSON, or null when there is none or it is not JSON. */
async function bodyOf(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** The contract's code a refusal carries, or null. */
function codeOf(body: unknown): string | null {
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/** Sends one request and reads its answer. Never rejects: every failure is an answer. */
export async function callApi<T>({
  method,
  path,
  credential,
  body,
}: ApiRequest): Promise<ApiAnswer<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (credential !== undefined) {
    headers['authorization'] = `Bearer ${credential}`;
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, ANSWER_LIMIT_MS);
  });
  try {
    const response = await Promise.race([
      fetch(`${API_ORIGIN}/v1/${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      limit,
    ]);
    if (response === null || response.status >= 500) {
      return UNREACHABLE;
    }
    if (response.status === 401) {
      return { kind: 'unauthorized' };
    }
    const parsed = await bodyOf(response);
    if (response.ok) {
      return { kind: 'ok', body: parsed as T };
    }
    return { kind: 'refused', status: response.status, code: codeOf(parsed) };
  } catch {
    return UNREACHABLE;
  } finally {
    clearTimeout(timer);
  }
}
