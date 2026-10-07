/**
 * The worker process, as Clever Cloud starts it (`CC_WORKER_COMMAND`,
 * infra/staging). What it does on a stop signal, why a runner that ends on its
 * own exits with 1, and why it starts nothing on the build machine
 * (INSTANCE_TYPE, BUG-3) is runWorkerProcess in ../worker.ts, where it is tested.
 * So is what it does with HEALTHCHECKS_WORKER_URL (INF-08) and
 * HEALTHCHECKS_SMS_URL (LOST-07), which only the worker reads.
 */
import process from 'node:process';
import {
  readHealthchecksSetting,
  readHealthchecksSmsSetting,
  readServerConfig,
} from '../config.ts';
import { runMain } from '../process.ts';
import { runWorkerProcess } from '../worker.ts';

runMain('worker', () =>
  runWorkerProcess(readServerConfig(process.env).databaseUrl, {
    instanceType: process.env['INSTANCE_TYPE'],
    healthchecks: readHealthchecksSetting(process.env),
    healthchecksSms: readHealthchecksSmsSetting(process.env),
  }),
);
