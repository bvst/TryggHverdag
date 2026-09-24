#!/usr/bin/env node
/**
 * Terraform's own checks on infra/, offline: is it formatted, and is each
 * configuration valid against the pinned provider? No credentials, no state,
 * nothing planned or applied — that needs the staging keys and happens only in
 * infra-staging.yml (D-077).
 *
 * Part of gate:static, so a session, the Mac and CI all run it. The first run
 * downloads the pinned Terraform (scripts/lib/terraform.mjs) and the provider.
 *
 * Usage: pnpm run infra:check
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { TERRAFORM_ENV, ensureTerraform } from './lib/terraform.mjs';

/** Every folder under infra/ that holds Terraform, relative to the repository root. */
export function terraformDirs(root) {
  const infra = path.join(root, 'infra');
  if (!existsSync(infra)) {
    return [];
  }
  return readdirSync(infra, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `infra/${entry.name}`)
    .filter((dir) => readdirSync(path.join(root, dir)).some((file) => file.endsWith('.tf')))
    .sort();
}

async function main() {
  const root = process.cwd();
  const dirs = terraformDirs(root);
  if (dirs.length === 0) {
    process.stdout.write('infra:check: no Terraform under infra/, so there is nothing to check.\n');
    return;
  }

  const terraform = await ensureTerraform({ root });
  const pluginCache = path.join(root, 'node_modules', '.cache', 'terraform', 'plugins');
  mkdirSync(pluginCache, { recursive: true });
  const env = { ...process.env, ...TERRAFORM_ENV, TF_PLUGIN_CACHE_DIR: pluginCache };

  const steps = [
    { what: 'formatting', args: ['fmt', '-check', '-recursive', '-diff', 'infra'] },
    ...dirs.flatMap((dir) => [
      {
        what: `${dir}: providers match the lock file`,
        args: [`-chdir=${dir}`, 'init', '-backend=false', '-input=false', '-lockfile=readonly'],
      },
      { what: `${dir}: valid`, args: [`-chdir=${dir}`, 'validate', '-no-color'] },
    ]),
  ];

  for (const step of steps) {
    const result = spawnSync(terraform, step.args, { cwd: root, env, encoding: 'utf8' });
    if (result.status !== 0) {
      process.stdout.write(
        `infra:check: ${step.what} — failed\n${result.stdout ?? ''}${result.stderr ?? ''}\n`,
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`infra:check: ${step.what} — ok\n`);
  }
}

if (import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    process.stdout.write(
      `infra:check: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
