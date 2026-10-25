/**
 * The API as the app's fetch meets it, recording (GRP-01, GRP-02, CALL-01,
 * CALL-02; M3 task 2).
 *
 * The app's one way to the server is `fetch` (D-138), so its L5 tests put a
 * fake fetch in its place. This is that fake's core, with no fetch, Request
 * or Response of its own (the test kit has no DOM types): the test file reads
 * each request the app sends into a `FakeApiRequest`, hands it to `answer`,
 * and turns what comes back into a Response, a promise that never settles, or
 * a thrown network error, as the comments on `FakeApiReply` say.
 *
 * It records every request, with its path, every header and its body, and the
 * time the test file's clock gave it, so a test can say what reached the
 * server, and when (GRP-02-AC6: #1 never does; CALL-01-AC6, CALL-02-AC4: no
 * request between a tap and the call). Each route answers from its queue
 * first, then its default; a route with neither throws, naming it, so a
 * request a test did not expect fails that test rather than hanging it.
 *
 * Routes are keyed `METHOD /v1/path`, with any UUID in the path as `:id`.
 */

/** An answer: a status and a body, or a network failure (fetch rejects). */
export type FakeApiAnswer =
  { readonly status: number; readonly body?: unknown } | 'network failure';

/**
 * How the fake answers one request: an answer at once; no answer, ever, as a
 * server that hangs (the app gives up after its own 20 s); or an answer held
 * until the test lets it go.
 */
export type FakeApiReply = FakeApiAnswer | 'no answer' | { readonly held: Promise<FakeApiAnswer> };

/** A request as the fake read it. */
export interface FakeApiRequest {
  readonly method: string;
  /** The URL's path, `/v1/…`. */
  readonly path: string;
  /** Every header, by lower-case name. */
  readonly headers: Readonly<Record<string, string>>;
  /** The body as JSON, or as the text it is, or null when there is none. */
  readonly body: unknown;
  /** When it was sent, by the test file's clock. */
  readonly at: number;
}

/** A reply the test lets go of: the reply to queue, and the way to answer it. */
export interface HeldReply {
  readonly reply: FakeApiReply;
  readonly release: (answer: FakeApiAnswer) => void;
}

export interface FakeApi {
  /** Records a request and gives the reply its route has. Throws for a route with none. */
  readonly answer: (request: FakeApiRequest) => FakeApiReply;
  /** Every request, in order. A copy. */
  readonly sent: () => readonly FakeApiRequest[];
  /** The requests to one route, in order. */
  readonly to: (route: string) => readonly FakeApiRequest[];
  /** Queues replies for a route, after any already queued. */
  readonly reply: (route: string, ...replies: FakeApiReply[]) => void;
  /** The reply a route gives once its queue is empty. */
  readonly always: (route: string, reply: FakeApiReply) => void;
  /** A reply held until released. */
  readonly held: () => HeldReply;
  /** Forgets the record, though not the routes' replies. */
  readonly forget: () => void;
  /** Forgets everything. */
  readonly reset: () => void;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** A request's route, as the fake keys it: the method, and the path from /v1/ on with UUIDs as `:id`. */
export function routeOf(method: string, path: string): string {
  const under = path.replace(/^.*?\/v1\//, '/v1/');
  return `${method.toUpperCase()} ${under.replace(UUID, ':id')}`;
}

/** A body's text as JSON, or as the text it is, or null when there is none. */
export function parsedOrText(text: string): unknown {
  if (text === '') {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function fakeApi(): FakeApi {
  let sent: FakeApiRequest[] = [];
  const queued = new Map<string, FakeApiReply[]>();
  const defaults = new Map<string, FakeApiReply>();

  return {
    answer: (request) => {
      sent.push(request);
      const route = routeOf(request.method, request.path);
      const given = queued.get(route)?.shift() ?? defaults.get(route);
      if (given === undefined) {
        throw new Error(`the fake API has no answer for ${route}`);
      }
      return given;
    },
    sent: () => [...sent],
    to: (route) => sent.filter((request) => routeOf(request.method, request.path) === route),
    reply: (route, ...replies) => {
      queued.set(route, [...(queued.get(route) ?? []), ...replies]);
    },
    always: (route, reply) => {
      defaults.set(route, reply);
    },
    held: () => {
      let release: (answer: FakeApiAnswer) => void = () => undefined;
      const answer = new Promise<FakeApiAnswer>((resolve) => {
        release = resolve;
      });
      return {
        reply: { held: answer },
        release: (given) => {
          release(given);
        },
      };
    },
    forget: () => {
      sent = [];
    },
    reset: () => {
      sent = [];
      queued.clear();
      defaults.clear();
    },
  };
}
