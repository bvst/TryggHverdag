/**
 * The API process, as Clever Cloud starts it (`CC_RUN_COMMAND`, infra/staging).
 * The wiring lives in api-process.ts, where it is tested; this only connects it
 * to the real environment and the real signals.
 */
import process from 'node:process';
import { startApiProcess } from '../api-process.ts';
import { readServerConfig } from '../config.ts';
import { exitOnSignal, runMain } from '../process.ts';

runMain('API', async () => {
  const api = await startApiProcess(readServerConfig(process.env));
  exitOnSignal({ name: 'API', signals: process, stop: api.stop });
});
