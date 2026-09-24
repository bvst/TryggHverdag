/**
 * The schema migration, as Clever Cloud runs it before every start
 * (`CC_PRE_RUN_HOOK`, infra/staging). Exiting with 1 stops the deploy, which is
 * the point: new code must never start against an old schema.
 */
import process from 'node:process';
import { migrateDatabase } from '../adapters/migrations.ts';
import { readServerConfig } from '../config.ts';
import { runMain } from '../process.ts';

runMain('migration', async () => {
  await migrateDatabase(readServerConfig(process.env).databaseUrl);
});
