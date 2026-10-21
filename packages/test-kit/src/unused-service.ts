/**
 * A stand-in for a dependency a test never calls (GRP-01).
 *
 * The API takes one service per route family (`createApi`'s dependencies),
 * and GRP-01 adds four: the join, the invitations, the members and the
 * walker's removal of a responder. Every existing test that builds the API
 * for other routes needs something in those places, and what it needs is a
 * dependency that fails loudly if it is ever reached: any method called on
 * this rejects, naming why the test did not expect it and which method it
 * was, so a route that reached it answers 500, never a quiet 2xx.
 *
 * Typed `never`, which every type accepts, so it stands in for a service of
 * any shape without the test kit importing the server's types or naming the
 * service's methods. It is not a thenable: awaiting it gives it back.
 */
export function unusedService(why: string): never {
  const stand = new Proxy(
    {},
    {
      get: (_target, property) =>
        property === 'then'
          ? undefined
          : () =>
              Promise.reject(
                new Error(
                  `${why}: ${String(property)} was called on a service these tests never use`,
                ),
              ),
    },
  );
  return stand as never;
}
