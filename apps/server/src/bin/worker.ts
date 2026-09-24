/**
 * The worker process, as Clever Cloud starts it (`CC_WORKER_COMMAND`,
 * infra/staging). If the runner ends for any reason other than a stop signal,
 * `untilStopped` rejects and the process exits with 1, so the platform restarts
 * it rather than leaving the journeys unwatched.
 */
import process from 'node:process';
import { readServerConfig } from '../config.ts';
import { exitOnSignal, runMain } from '../process.ts';
import { startWorker } from '../worker.ts';

runMain('worker', async () => {
  const worker = await startWorker(readServerConfig(process.env).databaseUrl);
  exitOnSignal({ name: 'worker', signals: process, stop: worker.stop });
  await worker.untilStopped();
});
