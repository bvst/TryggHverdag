/**
 * Every route the server serves, in one object. Kept apart from index.ts so
 * that the OpenAPI generator can read it without importing the package's own
 * entry point — see the note in index.ts.
 */
import { acknowledgeAlert } from './alerts.ts';
import { health } from './health.ts';
import { recordHeartbeat } from './heartbeats.ts';
import { reportHome } from './home.ts';
import { startJourney } from './journeys.ts';

export const contract = { health, startJourney, recordHeartbeat, reportHome, acknowledgeAlert };
