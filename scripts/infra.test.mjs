// INF-07: the things that must agree across infra/, the server and the
// workflows — each written in one place and read in another, where nothing but
// a test would notice them drifting apart.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { SYNTHETIC_CHECK_UUID as CHECK } from '../packages/test-kit/src/ping-url.ts';
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

describe('INF-08: the ping URL the worker checks in with', () => {
  // Anyone holding the URL can keep the Healthchecks.io check green while the
  // worker is dead, so it is a secret: it comes from the staging environment,
  // is never committed, and Terraform never prints it. And it must point at
  // Healthchecks.io over https — a check pinged from nowhere never pages.
  const variables = read('infra/staging/variables.tf');

  /** The variable's block, from its header to the closing brace at the start of a line. */
  function variableBlock() {
    const match = /^variable "healthchecks_worker_url" \{\n[\s\S]*?\n\}$/m.exec(variables);
    return match?.[0] ?? '';
  }

  // CHECK, from the test kit, is the all-zero UUID: with it, a well-formed ping
  // URL that names no real check. None is ever fetched here.

  test('INF-08-AC8: it is a required string variable, with no default to fall back on', () => {
    const block = variableBlock();

    expect(block).not.toBe('');
    expect(block).toMatch(/\n\s*type\s*=\s*string\n/);
    expect(block).not.toMatch(/\n\s*default\s*=/);
  });

  test('INF-08-AC8: it is sensitive, so no plan shows it', () => {
    expect(variableBlock()).toMatch(/\n\s*sensitive\s*=\s*true\n/);
  });

  test('INF-08-AC8: its validation refuses anything that does not start https://hc-ping.com/', () => {
    const block = variableBlock();
    const condition =
      /\n\s*condition\s*=\s*can\(regex\("((?:[^"\\]|\\.)*)", var\.healthchecks_worker_url\)\)\n/.exec(
        block,
      );
    expect(condition).not.toBeNull();
    expect(block).toMatch(/\n\s*error_message\s*=\s*"/);

    // Terraform's string escapes undone: `\\.` in the file is `\.` to the
    // regular expression. RE2 and JavaScript agree on a pattern this simple.
    const pattern = new RegExp(String(condition?.[1]).replace(/\\\\/g, '\\'));

    expect(pattern.test(`https://hc-ping.com/${CHECK}`)).toBe(true);
    for (const refused of [
      `http://hc-ping.com/${CHECK}`,
      `https://hc-ping.com.example.invalid/${CHECK}`,
      `https://hc-pingXcom/${CHECK}`,
      `https://example.invalid/https://hc-ping.com/${CHECK}`,
      ` https://hc-ping.com/${CHECK}`,
      'https://hc-ping.com',
      '',
    ]) {
      expect({ value: refused, accepted: pattern.test(refused) }).toEqual({
        value: refused,
        accepted: false,
      });
    }
  });

  test('INF-08-AC8: the app gets it as HEALTHCHECKS_WORKER_URL, from that variable and nowhere else', () => {
    const environment = /\n {2}environment = \{\n([\s\S]*?)\n {2}\}\n/.exec(main)?.[1] ?? '';

    expect(environment).toMatch(
      /^\s*HEALTHCHECKS_WORKER_URL\s*=\s*var\.healthchecks_worker_url\s*$/m,
    );
    expect(main.match(/var\.healthchecks_worker_url\b/g)).toHaveLength(1);
    // Nowhere else: the value comes from the staging environment's secret,
    // through TF_VAR_healthchecks_worker_url, and is never committed.
    expect(read('infra/staging/staging.auto.tfvars')).not.toMatch(/healthchecks|hc-ping/i);
    for (const file of ['main.tf', 'variables.tf', 'versions.tf', 'staging.auto.tfvars']) {
      expect(read(`infra/staging/${file}`)).not.toMatch(/hc-ping\.com\/[0-9a-f]{8}-/i);
    }
  });
});

describe('LOST-07: the ping URL the SMS check reports to', () => {
  // As the worker's (INF-08): anyone holding the URL can keep the SMS check
  // green while every SMS fails, so it is a secret from the staging
  // environment, never committed and never printed, and it must point at
  // Healthchecks.io over https: a check reported from nowhere never pages.
  const variables = read('infra/staging/variables.tf');

  /** The variable's block, from its header to the closing brace at the start of a line. */
  function variableBlock() {
    const match = /^variable "healthchecks_sms_url" \{\n[\s\S]*?\n\}$/m.exec(variables);
    return match?.[0] ?? '';
  }

  test('LOST-07-AC20: it is a required string variable, with no default to fall back on', () => {
    const block = variableBlock();

    expect(block).not.toBe('');
    expect(block).toMatch(/\n\s*type\s*=\s*string\n/);
    expect(block).not.toMatch(/\n\s*default\s*=/);
  });

  test('LOST-07-AC20: it is sensitive, so no plan shows it', () => {
    expect(variableBlock()).toMatch(/\n\s*sensitive\s*=\s*true\n/);
  });

  test('LOST-07-AC20: its validation refuses anything that does not start https://hc-ping.com/, and its error message says where to set it', () => {
    const block = variableBlock();
    const condition =
      /\n\s*condition\s*=\s*can\(regex\("((?:[^"\\]|\\.)*)", var\.healthchecks_sms_url\)\)\n/.exec(
        block,
      );
    expect(condition).not.toBeNull();
    const message = /\n\s*error_message\s*=\s*"((?:[^"\\]|\\.)*)"\n/.exec(block)?.[1] ?? '';
    expect(message).toContain('HEALTHCHECKS_SMS_URL');
    expect(message).toMatch(/\bstaging\b/);

    // Terraform's string escapes undone, as INF-08-AC8's test does.
    const pattern = new RegExp(String(condition?.[1]).replace(/\\\\/g, '\\'));

    expect(pattern.test(`https://hc-ping.com/${CHECK}`)).toBe(true);
    for (const refused of [
      `http://hc-ping.com/${CHECK}`,
      `https://hc-ping.com.example.invalid/${CHECK}`,
      `https://hc-pingXcom/${CHECK}`,
      `https://example.invalid/https://hc-ping.com/${CHECK}`,
      ` https://hc-ping.com/${CHECK}`,
      'https://hc-ping.com',
      '',
    ]) {
      expect({ value: refused, accepted: pattern.test(refused) }).toEqual({
        value: refused,
        accepted: false,
      });
    }
  });

  test('LOST-07-AC20: the app gets it as HEALTHCHECKS_SMS_URL, from that variable, which main.tf names nowhere else', () => {
    const environment = /\n {2}environment = \{\n([\s\S]*?)\n {2}\}\n/.exec(main)?.[1] ?? '';

    expect(environment).toMatch(/^\s*HEALTHCHECKS_SMS_URL\s*=\s*var\.healthchecks_sms_url\s*$/m);
    expect(main.match(/var\.healthchecks_sms_url\b/g)).toHaveLength(1);
    // The worker's address and the SMS check's never stand in for each other.
    expect(environment).not.toMatch(/^\s*HEALTHCHECKS_SMS_URL\s*=\s*var\.healthchecks_worker_url/m);
    expect(read('infra/staging/staging.auto.tfvars')).not.toMatch(/healthchecks|hc-ping/i);
    for (const file of ['main.tf', 'variables.tf', 'versions.tf', 'staging.auto.tfvars']) {
      expect(read(`infra/staging/${file}`)).not.toMatch(/hc-ping\.com\/[0-9a-f]{8}-/i);
    }
  });
});

describe('LOST-07: the two ping URLs are each a plain check address, and never the same one', () => {
  // LOST-07 review loop 1 (safety-reviewer and code-reviewer, REL-07,
  // REL-08). The SMS check reports `failing` to its URL with /fail appended,
  // so a query, a fragment or a trailing slash would misplace it and page
  // nobody; the worker's URL is held to the same rule, so both are read
  // alike. And the two must differ: one check behind both would make "worker
  // down" and "SMS failing" one page, and an ok from one would clear the
  // other's failing.
  const variables = read('infra/staging/variables.tf');
  const RID = '0f0e0d0c';

  /** The variable's block, from its header to the closing brace at the start of a line. */
  function variableBlock(name) {
    const match = new RegExp(`^variable "${name}" \\{\\n[\\s\\S]*?\\n\\}$`, 'm').exec(variables);
    return match?.[0] ?? '';
  }

  /**
   * Whether Terraform would take this value: every `can(regex(…))` condition
   * in the variable's validation blocks matches it. Terraform's string escapes
   * undone, as INF-08-AC8's test does; RE2 and JavaScript agree on patterns
   * this simple.
   */
  function takes(name, value) {
    const patterns = [
      ...variableBlock(name).matchAll(
        new RegExp(
          `\\n\\s*condition\\s*=\\s*can\\(regex\\("((?:[^"\\\\]|\\\\.)*)", var\\.${name}\\)\\)\\n`,
          'g',
        ),
      ),
    ].map(([, pattern]) => new RegExp(String(pattern).replace(/\\\\/g, '\\')));
    expect(patterns.length, name).toBeGreaterThan(0);
    return patterns.every((pattern) => pattern.test(value));
  }

  test.each(['healthchecks_sms_url', 'healthchecks_worker_url'])(
    'LOST-07-AC20: %s refuses an address with a query, a fragment or a trailing slash, and still takes the plain ping URL',
    (name) => {
      expect(takes(name, `https://hc-ping.com/${CHECK}`)).toBe(true);
      for (const refused of [
        `https://hc-ping.com/${CHECK}/`,
        `https://hc-ping.com/${CHECK}?rid=${RID}`,
        `https://hc-ping.com/${CHECK}?`,
        `https://hc-ping.com/${CHECK}#${RID}`,
        `https://hc-ping.com/${CHECK}#`,
      ]) {
        expect({ value: refused, accepted: takes(name, refused) }).toEqual({
          value: refused,
          accepted: false,
        });
      }
    },
  );

  test('LOST-07-AC20: a validation refuses the SMS check’s URL when it is the worker’s, and its error message names both secrets', () => {
    const blocks = [
      variableBlock('healthchecks_sms_url'),
      variableBlock('healthchecks_worker_url'),
    ];
    const validations = blocks.flatMap((block) =>
      [...block.matchAll(/\n {2}validation \{\n([\s\S]*?)\n {2}\}/g)].map(([, body]) => body ?? ''),
    );
    const differing = validations.filter((body) =>
      /\n?\s*condition\s*=\s*(var\.healthchecks_sms_url\s*!=\s*var\.healthchecks_worker_url|var\.healthchecks_worker_url\s*!=\s*var\.healthchecks_sms_url)\s*(\n|$)/.test(
        body,
      ),
    );

    expect(differing).toHaveLength(1);
    const message =
      /\n?\s*error_message\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(differing[0] ?? '')?.[1] ?? '';
    expect(message).toContain('HEALTHCHECKS_SMS_URL');
    expect(message).toContain('HEALTHCHECKS_WORKER_URL');
  });
});
