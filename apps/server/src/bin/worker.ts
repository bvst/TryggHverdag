/**
 * The worker process, as Clever Cloud starts it (`CC_WORKER_COMMAND`,
 * infra/staging). What it does on a stop signal, and why a runner that ends on
 * its own exits with 1, is runWorkerProcess in ../worker.ts, where it is tested.
 */
import process from 'node:process';
import { readServerConfig } from '../config.ts';
import { runMain } from '../process.ts';
import { runWorkerProcess } from '../worker.ts';

runMain('worker', () => runWorkerProcess(readServerConfig(process.env).databaseUrl));
