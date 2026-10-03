/**
 * The one 400 every route with a body declares: a body that is not JSON, or
 * that fails the route's request schema (SEC-07, LOST-01).
 *
 * One object, used by each route's error map, so the routes cannot describe
 * their 400 in different words. The server answers every 400 with exactly
 * this status and message, and never with `data`: oRPC would put the
 * validator's issues there, and those name the keys and values a request held
 * (04b-spike-results.md §4.5).
 */
export const badRequestError = {
  status: 400,
  message: 'Input validation failed',
};
