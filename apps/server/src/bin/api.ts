/**
 * The API process, as Clever Cloud starts it (`CC_RUN_COMMAND`, infra/staging).
 * The wiring lives in api-process.ts, where it is tested; this only connects it
 * to the real environment and the real signals.
 *
 * It says at start, in one line on stderr, whether the first admin can join
 * with ADMIN_BOOTSTRAP_CODE (GRP-01-AC8), naming the setting and never its
 * value: whoever holds the code can make themself the group's admin while no
 * group exists. Without a usable code the API still serves every walker; only
 * the first admin cannot join.
 */
import process from 'node:process';
import { startApiProcess } from '../api-process.ts';
import { readAdminBootstrapSetting, readServerConfig } from '../config.ts';
import { exitOnSignal, runMain } from '../process.ts';

runMain('API', async () => {
  const config = readServerConfig(process.env);
  const bootstrap = readAdminBootstrapSetting(process.env);
  process.stderr.write(
    bootstrap.usable
      ? 'api: the first admin can join with ADMIN_BOOTSTRAP_CODE while no group exists.\n'
      : `api: the first admin cannot join: ${bootstrap.reason}\n`,
  );
  const api = await startApiProcess(config, {
    bootstrapCode: bootstrap.usable ? bootstrap.code : null,
  });
  exitOnSignal({ name: 'API', signals: process, stop: api.stop });
});
