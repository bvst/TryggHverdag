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
  test('BUG-2: the state backend sends no checksum Cellar would refuse', () => {
    // Staging's first apply created the app and the database, then could not
    // save its state: "PutObject … 400 … XAmzContentSHA256Mismatch". Terraform
    // 1.16 asks for a SHA-256 checksum on every state upload unless
    // skip_s3_checksum is set, and an algorithm asked for explicitly is sent
    // whatever AWS_REQUEST_CHECKSUM_CALCULATION says. Planning only reads the
    // state, so no plan could have shown this; only a real write to Cellar
    // proves the fix, and a session has no route there.
    const backend = /backend "s3" \{[\s\S]*?\n {2}\}/.exec(read('infra/staging/versions.tf'));

    expect(backend?.[0]).toMatch(/\n\s*skip_s3_checksum\s*=\s*true\n/);
  });

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

  test('every name staging gets on Clever Cloud is spelled trygg-hverdag', () => {
    // The owner's choice (2026-09-25), matching the state bucket
    // trygg-hverdag-staging-tfstate. The spelling is what shows in the console
    // and in the address, so it is held for every name Terraform sends and for
    // the two the deploy and the smoke test use.
    const names = [...main.matchAll(/\b(?:name|fqdn)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);

    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const name of [...names, STAGING_APP_NAME, new URL(STAGING_URL).host]) {
      expect(name).toMatch(/^trygg-hverdag-/);
    }
  });

  test('its name and address are the ones the deploy and the smoke test use', () => {
    // Written twice, here and in scripts/lib/staging.mjs. There are no
    // Terraform outputs repeating them: a third copy is one more to drift.
    expect(main).toContain(`name        = "${STAGING_APP_NAME}"`);
    expect(main).toContain(`fqdn = "${new URL(STAGING_URL).host}"`);
    expect(existsSync(path.join(ROOT, 'infra/staging/outputs.tf'))).toBe(false);
  });

  test('its organisation is an organisation, and a personal space is refused before any plan', () => {
    // The owner's A-18. The deploy reads the organisation from this same file,
    // so Terraform and the deploy find staging in the same place.
    expect(readOrganisation(read('infra/staging/staging.auto.tfvars'))).toMatch(
      /^orga_[0-9a-f-]{36}$/,
    );
    expect(read('infra/staging/variables.tf')).toContain(
      'condition     = can(regex("^orga_[0-9a-f-]{36}$", var.organisation))',
    );
  });
});

describe('terraformDirs', () => {
  test('finds staging, so infra:check has something to check', () => {
    expect(terraformDirs(ROOT)).toContain('infra/staging');
  });
});
