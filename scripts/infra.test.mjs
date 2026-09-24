// INF-07: the things that must agree across infra/, the server and the
// workflows — each written in one place and read in another, where nothing but
// a test would notice them drifting apart.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { terraformDirs } from './infra-check.mjs';
import { readOrganisation } from './lib/staging-deploy.mjs';
import { STAGING_APP_NAME, STAGING_URL } from './lib/staging.mjs';
import { TERRAFORM_VERSION } from './lib/terraform.mjs';

const ROOT = path.join(import.meta.dirname, '..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

const main = read('infra/staging/main.tf');

describe('infra/staging', () => {
  test('asks for the same Terraform minor version that scripts/lib/terraform.mjs downloads', () => {
    const [major, minor] = TERRAFORM_VERSION.split('.');

    expect(read('infra/staging/versions.tf')).toContain(
      `required_version = "~> ${String(major)}.${String(minor)}.0"`,
    );
  });

  test('every command the platform runs names a server entry file that exists', () => {
    const files = [...main.matchAll(/(apps\/server\/src\/bin\/[\w-]+\.ts)/g)].map((m) => m[1]);

    expect(files.sort()).toEqual([
      'apps/server/src/bin/api.ts',
      'apps/server/src/bin/migrate.ts',
      'apps/server/src/bin/worker.ts',
    ]);
    for (const file of files) {
      expect(existsSync(path.join(ROOT, String(file)))).toBe(true);
    }
  });

  test('runs Node with the flag the entry-file tests run it with', () => {
    // apps/server/src/bin/bin.test.ts starts the same files the same way; if
    // the two ever differ, those tests stop proving what production does.
    expect(main).toContain('node = "node --experimental-strip-types"');
    expect(read('apps/server/src/bin/bin.test.ts')).toContain(
      "const NODE_ARGS = ['--experimental-strip-types'];",
    );
  });

  test('D-077: one instance, never more — two instances would be two workers on a five-connection database', () => {
    expect(main).toMatch(/min_instance_count\s*=\s*1\b/);
    expect(main).toMatch(/max_instance_count\s*=\s*1\b/);
    expect(main).toMatch(/smallest_flavor\s*=\s*"nano"/);
    expect(main).toMatch(/biggest_flavor\s*=\s*"nano"/);
  });

  test('the deploy counts only when the health endpoint answers', () => {
    expect(main).toContain('CC_HEALTH_CHECK_PATH = "/v1/health"');
  });

  test('its name and address are the ones the deploy and the smoke test use', () => {
    expect(main).toContain(`name        = "${STAGING_APP_NAME}"`);
    expect(main).toContain(`fqdn = "${new URL(STAGING_URL).host}"`);
    expect(read('infra/staging/outputs.tf')).toContain(`value       = "${STAGING_URL}"`);
  });

  test('when its organisation is set, it is an organisation and not a personal space', () => {
    // Filled in from the owner's A-18. Until then there is no file, and the
    // plan fails asking for the variable — loudly, which is the point.
    const file = path.join(ROOT, 'infra/staging/staging.auto.tfvars');
    if (existsSync(file)) {
      expect(readOrganisation(readFileSync(file, 'utf8'))).toMatch(/^orga_/);
    } else {
      expect(readOrganisation('')).toBeNull();
    }
  });
});

describe('terraformDirs', () => {
  test('finds staging, so infra:check has something to check', () => {
    expect(terraformDirs(ROOT)).toContain('infra/staging');
  });
});
