/**
 * The one shared contract between app and server (AR-07).
 *
 * The schemas themselves arrive with the server skeleton (INF-05); this package
 * exists from the start so nothing can grow a private copy of the API shape.
 */

/**
 * The API version every route lives under. Breaking changes get a new version
 * rather than changing this one, because phones keep running old app versions
 * (AR-08).
 */
export const API_VERSION = 'v1';
