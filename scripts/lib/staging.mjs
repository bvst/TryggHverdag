// Where staging is, in one place. infra/staging names the same app and address,
// and scripts/infra.test.mjs fails if the two ever disagree.

/** The app's name in the staging organisation; the deploy finds it by this name. */
export const STAGING_APP_NAME = 'trygg-hverdag-staging';

/** Where staging answers (a cleverapps.io address, staging only: D-046). */
export const STAGING_URL = 'https://trygg-hverdag-staging.cleverapps.io';
