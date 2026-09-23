/**
 * Every route the server serves, in one object. Kept apart from index.ts so
 * that the OpenAPI generator can read it without importing the package's own
 * entry point — see the note in index.ts.
 */
import { health } from './health.ts';

export const contract = { health };
