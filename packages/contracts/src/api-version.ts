/**
 * Where the API lives. Its own module, with no imports, so that nothing can
 * form a cycle around it — see the note in index.ts.
 */

/**
 * The API version every route lives under. Breaking changes get a new version
 * rather than changing this one, because phones keep running old app versions
 * (AR-08).
 */
export const API_VERSION = 'v1';

/** Where the routes hang, so neither server nor test hard-codes the version. */
export const API_PREFIX = `/${API_VERSION}` as const;
