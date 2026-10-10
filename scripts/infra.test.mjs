// INF-07: the things that must agree across infra/, the server and the
// workflows — each written in one place and read in another, where nothing but
// a test would notice them drifting apart.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { SYNTHETIC_CHECK_UUID as CHECK } from '../packages/test-kit/src/ping-url.ts';
import { syntheticCredential, syntheticUuid } from '../packages/test-kit/src/synthetic-ids.ts';
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
  // REL-08). A query, a fragment or a trailing slash still names the same
  // check, so each is refused: each check then has one spelling, and the two
  // URLs can be compared (D-116). The SMS check's alarm builds /fail on the
  // URL's path, since loop 1, so none of them misplaces it; for the failure
  // signal the refusal is a second guard. The worker's URL is held to the same
  // rule, so both are read alike. And the two must differ: one check behind
  // both would make "worker down" and "SMS failing" one page, and an ok from
  // one would clear the other's failing.
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

  // LOST-07 review loop 2 (safety-reviewer should-fix 1, D-116 amended): one
  // spelling per check, so the `!=` below compares checks. Healthchecks.io
  // reads /<uuid> and /<uuid>/ as the same check, and the slug form
  // (/<ping-key>/<slug>) names a check its UUID also names, so either secret
  // could name the other's check by a spelling of its own, and `!=` would
  // pass. Each variable is taken only as https://hc-ping.com/ and the UUID in
  // lower case. The UUID starts with a letter, so it has an upper-case
  // spelling and a percent-encoded one; fresh each run (RG-07).
  test.each(['healthchecks_sms_url', 'healthchecks_worker_url'])(
    'LOST-07-AC20: %s takes https://hc-ping.com/ and a lower-case UUID, and no other spelling of a check: no trailing or leading character, no upper case, no percent-encoding, no slug form, one path segment',
    (name) => {
      const check = `a${syntheticUuid().slice(1)}`;
      const pingKey = syntheticCredential().slice(0, 22);
      const host = 'https://hc-ping.com';

      expect(takes(name, `${host}/${check}`)).toBe(true);
      expect(takes(name, `${host}/${CHECK}`)).toBe(true);
      const refused = [
        ['a trailing slash', `${host}/${check}/`],
        ['a trailing space', `${host}/${check} `],
        ['a trailing tab', `${host}/${check}\t`],
        ['a trailing newline', `${host}/${check}\n`],
        ['a trailing backslash', `${host}/${check}\\`],
        ['a leading space', ` ${host}/${check}`],
        ['an upper-case UUID', `${host}/${check.toUpperCase()}`],
        ['a percent-encoded character in the UUID', `${host}/%61${check.slice(1)}`],
        ['the slug form', `${host}/${pingKey}/staging-worker`],
        ['an upper-case host', `https://HC-PING.COM/${check}`],
        ['a path of two segments, the UUID first', `${host}/${check}/fail`],
        ['a path of two segments, the UUID second', `${host}/ping/${check}`],
        ['an empty path', host],
        ['a UUID too short', `${host}/${check.slice(0, -1)}`],
        // Its last group one hex digit long (review loop 3), as config.ts's
        // one-spelling test refuses it: a hex digit, so no other entry here
        // stands in for it.
        ['a UUID one hex digit too long', `${host}/${check}0`],
        ['not a UUID', `${host}/${pingKey}`],
      ];

      // Every spelling Terraform would take, by what it is, so a failure names them all.
      expect(refused.filter(([, value]) => takes(name, value)).map(([what]) => what)).toEqual([]);
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

describe('REL-10: staging is configured for the canary by Terraform, and refuses a plan without its check', () => {
  // The canary's check (staging-canary, A-34) is paged by its own ping URL, a
  // secret as the other two are: anyone holding it can keep the check green
  // while every alert is missed. Its credential is made by Terraform and lives
  // only in Terraform's state and the app's environment (D-128), never in a
  // GitHub secret. Its address is the staging vhost, written once, so the
  // canary cannot be pointed somewhere staging is not. Each is written in
  // infra/ and read by the worker (config.ts), where nothing but a test would
  // notice them drifting apart.
  const variables = read('infra/staging/variables.tf');
  const versions = read('infra/staging/versions.tf');
  const lock = read('infra/staging/.terraform.lock.hcl');
  const NAME = 'healthchecks_canary_url';
  const OTHERS = [
    ['healthchecks_worker_url', 'HEALTHCHECKS_WORKER_URL'],
    ['healthchecks_sms_url', 'HEALTHCHECKS_SMS_URL'],
  ];

  /** A variable's block, from its header to the closing brace at the start of a line. */
  function variableBlock(name) {
    const match = new RegExp(`^variable "${name}" \\{\\n[\\s\\S]*?\\n\\}$`, 'm').exec(variables);
    return match?.[0] ?? '';
  }

  /** The bodies of a block's validation blocks. */
  function validations(block) {
    return [...block.matchAll(/\n {2}validation \{\n([\s\S]*?)\n {2}\}/g)].map(
      ([, body]) => body ?? '',
    );
  }

  /** A validation's error message, Terraform's string as written. */
  function messageOf(body) {
    return /\n?\s*error_message\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(body)?.[1] ?? '';
  }

  /** The `can(regex(…))` patterns that validate the variable, as JavaScript expressions. */
  function patternsOf(name) {
    return [
      ...variableBlock(name).matchAll(
        new RegExp(
          `\\n\\s*condition\\s*=\\s*can\\(regex\\("((?:[^"\\\\]|\\\\.)*)", var\\.${name}\\)\\)\\n`,
          'g',
        ),
      ),
      // Terraform's string escapes undone, as INF-08-AC8's test does; RE2 and
      // JavaScript agree on patterns this simple.
    ].map(([, pattern]) => new RegExp(String(pattern).replace(/\\\\/g, '\\')));
  }

  /** Whether Terraform would take this value: every pattern matches it. */
  function takes(value) {
    const patterns = patternsOf(NAME);
    expect(patterns.length, `no can(regex(…)) validation of ${NAME}`).toBeGreaterThan(0);
    return patterns.every((pattern) => pattern.test(value));
  }

  /** The app's environment in main.tf. */
  const environment = () => /\n {2}environment = \{\n([\s\S]*?)\n {2}\}\n/.exec(main)?.[1] ?? '';

  /** main.tf without its comment lines. */
  const code = () =>
    main
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');

  test('REL-10-AC17: healthchecks_canary_url is a required string variable, with no default, and sensitive, so no plan shows it', () => {
    const block = variableBlock(NAME);

    expect(block, `variables.tf declares no variable "${NAME}"`).not.toBe('');
    expect(block).toMatch(/\n\s*type\s*=\s*string\n/);
    expect(block).not.toMatch(/\n\s*default\s*=/);
    expect(block).toMatch(/\n\s*sensitive\s*=\s*true\n/);
  });

  test('REL-10-AC17: healthchecks_canary_url takes https://hc-ping.com/ and a lower-case UUID, and no other spelling of a check', () => {
    const check = `a${syntheticUuid().slice(1)}`;
    const pingKey = syntheticCredential().slice(0, 22);
    const host = 'https://hc-ping.com';

    expect(takes(`${host}/${check}`)).toBe(true);
    expect(takes(`${host}/${CHECK}`)).toBe(true);
    const refused = [
      ['http, not https', `http://hc-ping.com/${check}`],
      ['another host ending in the host', `https://hc-ping.com.example.invalid/${check}`],
      ['a dot read as any character', `https://hc-pingXcom/${check}`],
      ['the host inside another URL', `https://example.invalid/${host}/${check}`],
      ['a trailing slash', `${host}/${check}/`],
      ['a query', `${host}/${check}?rid=0f0e0d0c`],
      ['a fragment', `${host}/${check}#0f0e0d0c`],
      ['a trailing space', `${host}/${check} `],
      ['a trailing newline', `${host}/${check}\n`],
      ['a leading space', ` ${host}/${check}`],
      ['an upper-case UUID', `${host}/${check.toUpperCase()}`],
      ['a percent-encoded character in the UUID', `${host}/%61${check.slice(1)}`],
      ['the slug form', `${host}/${pingKey}/staging-canary`],
      ['an upper-case host', `https://HC-PING.COM/${check}`],
      ['the failure signal', `${host}/${check}/fail`],
      ['a path of two segments, the UUID second', `${host}/ping/${check}`],
      ['an empty path', host],
      ['a UUID too short', `${host}/${check.slice(0, -1)}`],
      ['a UUID one hex digit too long', `${host}/${check}0`],
      ['not a UUID', `${host}/${pingKey}`],
      ['nothing', ''],
    ];

    // Every spelling Terraform would take, by what it is, so a failure names them all.
    expect(refused.filter(([, value]) => takes(value)).map(([what]) => what)).toEqual([]);
  });

  test('REL-10-AC17: each of its validations’ error messages names the secret, HEALTHCHECKS_CANARY_URL, and the owner’s to-do, A-34', () => {
    const bodies = validations(variableBlock(NAME));

    expect(bodies.length, `no validation of ${NAME}`).toBeGreaterThan(0);
    for (const body of bodies) {
      const message = messageOf(body);
      expect(message, body).toContain('HEALTHCHECKS_CANARY_URL');
      expect(message, body).toMatch(/\bA-34\b/);
    }
  });

  test.each(OTHERS)(
    'REL-10-AC17: one validation refuses healthchecks_canary_url when it is %s, and its error message names HEALTHCHECKS_CANARY_URL and A-34',
    (other) => {
      const bodies = [NAME, ...OTHERS.map(([name]) => name)].flatMap((name) =>
        validations(variableBlock(name)),
      );
      const differing = bodies.filter((body) =>
        new RegExp(
          `\\n?\\s*condition\\s*=\\s*(var\\.${NAME}\\s*!=\\s*var\\.${other}|var\\.${other}\\s*!=\\s*var\\.${NAME})\\s*(\\n|$)`,
        ).test(body),
      );

      expect(differing).toHaveLength(1);
      const message = messageOf(differing[0] ?? '');
      expect(message).toContain('HEALTHCHECKS_CANARY_URL');
      expect(message).toMatch(/\bA-34\b/);
    },
  );

  test('REL-10-AC17: main.tf makes the canary’s credential with random_password.canary_credential: 43 characters, letters and digits only', () => {
    const resource = /^resource "random_password" "canary_credential" \{\n([\s\S]*?)\n\}$/m.exec(
      main,
    )?.[1];

    expect(resource, 'main.tf declares no random_password "canary_credential"').toBeDefined();
    expect(resource).toMatch(/^\s*length\s*=\s*43\s*$/m);
    expect(resource).toMatch(/^\s*special\s*=\s*false\s*$/m);
    // Letters and digits only: nothing turns special characters back on.
    expect(resource).not.toMatch(/^\s*override_special\s*=/m);
    expect(resource).not.toMatch(/^\s*(upper|lower|numeric|number)\s*=\s*false\s*$/m);
  });

  // The rotation route (REL-10 review loop 1; D-128's loop-1 amendment).
  // infra-staging.yml runs a fixed plan and applies that plan, with no
  // `-replace`, so "replace the resource" was a rotation no one could run.
  // Instead a committed generation number is the password's one keeper:
  // raising it in a pull request, then the plan and the apply, replaces the
  // password, and the worker registers the new hash at its restart. A string
  // of digits, since keepers is a map of strings. Nothing else is kept: a
  // secret there would sit in the plan, and a value that changes by itself
  // would replace the credential, cutting off a run in flight, on every apply.
  test('REL-10-AC17: the canary’s credential is rotated by a committed generation number: random_password.canary_credential keeps only generation = local.canary_credential_generation, a quoted string of digits declared once in main.tf’s locals', () => {
    const resource =
      /^resource "random_password" "canary_credential" \{\n([\s\S]*?)\n\}$/m.exec(main)?.[1] ?? '';
    const keepers = [...resource.matchAll(/^\s*keepers\s*=\s*\{([^}]*)\}/gm)].map(
      ([, body]) => body ?? '',
    );

    expect(keepers, 'random_password.canary_credential’s keepers').toHaveLength(1);
    const entries = String(keepers[0])
      .split(/[\n,]/)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '' && !entry.startsWith('#'))
      .map((entry) => entry.split(/\s*=\s*/));
    expect(entries, 'what the credential keeps').toEqual([
      ['generation', 'local.canary_credential_generation'],
    ]);

    const locals = [...main.matchAll(/^locals \{\n([\s\S]*?)\n\}$/gm)]
      .map(([, body]) => body ?? '')
      .join('\n');
    const declared = [...locals.matchAll(/^\s*canary_credential_generation\s*=\s*(.*?)\s*$/gm)].map(
      ([, value]) => value,
    );
    expect(declared, 'canary_credential_generation in main.tf’s locals').toHaveLength(1);
    expect(declared[0]).toMatch(/^"\d+"$/);
    expect(main.match(/^\s*canary_credential_generation\s*=/gm)).toHaveLength(1);
  });

  test('REL-10-AC17: the app’s environment sets CANARY_API_URL to https:// and the staging vhost, from the one local the vhosts use, written once', () => {
    const local = /\bvhosts\s*=\s*\[\{\s*fqdn\s*=\s*local\.(\w+)\s*\}\]/.exec(main)?.[1];
    expect(local, 'the vhosts do not take their address from a local').toBeDefined();
    const locals = /^locals \{\n([\s\S]*?)\n\}$/m.exec(main)?.[1] ?? '';
    const host = new URL(STAGING_URL).host;

    expect(locals).toMatch(
      new RegExp(`^\\s*${String(local)}\\s*=\\s*"${host.replace(/\./g, '\\.')}"\\s*$`, 'm'),
    );
    expect(environment()).toMatch(
      new RegExp(
        `^\\s*CANARY_API_URL\\s*=\\s*"https://\\$\\{local\\.${String(local)}\\}"\\s*$`,
        'm',
      ),
    );
    // The address the deploy and the smoke test use, as an origin: what the
    // canary calls is staging itself.
    expect(`https://${host}`).toBe(new URL(STAGING_URL).origin);
    // Written once: the vhost and the canary's address cannot differ.
    expect(code().split(host).length - 1, `${host} is written more than once`).toBe(1);
  });

  test('REL-10-AC17: the app gets CANARY_CREDENTIAL from the password and HEALTHCHECKS_CANARY_URL from the variable, each named nowhere else', () => {
    expect(environment()).toMatch(
      /^\s*CANARY_CREDENTIAL\s*=\s*random_password\.canary_credential\.result\s*$/m,
    );
    expect(environment()).toMatch(
      /^\s*HEALTHCHECKS_CANARY_URL\s*=\s*var\.healthchecks_canary_url\s*$/m,
    );
    expect(main.match(/\brandom_password\.canary_credential\b/g)).toHaveLength(1);
    expect(main.match(/var\.healthchecks_canary_url\b/g)).toHaveLength(1);
    // The other checks' URLs never stand in for the canary's.
    for (const [other] of OTHERS) {
      expect(environment()).not.toMatch(
        new RegExp(`^\\s*HEALTHCHECKS_CANARY_URL\\s*=\\s*var\\.${other}\\b`, 'm'),
      );
    }
    // Nowhere else: the URL comes from the staging environment's secret, the
    // credential from Terraform's state; neither is committed.
    expect(read('infra/staging/staging.auto.tfvars')).not.toMatch(/canary|hc-ping/i);
    for (const file of ['main.tf', 'variables.tf', 'versions.tf', 'staging.auto.tfvars']) {
      expect(read(`infra/staging/${file}`)).not.toMatch(/hc-ping\.com\/[0-9a-f]{8}-/i);
    }
  });

  test('REL-10-AC17: versions.tf requires hashicorp/random as a ~> constraint, and the lock file records that constraint, one exact version within it, and its hashes', () => {
    const required = /\n\s*required_providers \{\n([\s\S]*?)\n\s{2}\}\n/.exec(versions)?.[1] ?? '';
    const random = /\n?\s*random = \{\n([\s\S]*?)\n\s*\}/.exec(required)?.[1];
    expect(random, 'versions.tf requires no provider named random').toBeDefined();
    expect(random).toMatch(/^\s*source\s*=\s*"hashicorp\/random"\s*$/m);
    const constraint = /^\s*version\s*=\s*"(~> (\d+)\.(\d+)(?:\.(\d+))?)"\s*$/m.exec(random ?? '');
    expect(constraint, 'its version is not a ~> constraint').not.toBeNull();

    const locked =
      /^provider "registry\.terraform\.io\/hashicorp\/random" \{\n([\s\S]*?)\n\}$/m.exec(lock)?.[1];
    expect(locked, 'the lock file records no hashicorp/random').toBeDefined();
    expect(locked).toContain(`constraints = "${String(constraint?.[1])}"`);
    const version = /^\s*version\s*=\s*"(\d+)\.(\d+)\.(\d+)"\s*$/m.exec(locked ?? '');
    expect(version, 'the lock file records no exact version').not.toBeNull();
    expect(locked).toMatch(/"h1:[A-Za-z0-9+/]{43}="/);
    expect(locked).toMatch(/"zh:[0-9a-f]{64}"/);

    // ~> a.b allows a.x for x >= b; ~> a.b.c allows a.b.x for x >= c.
    const [, , major, minor, patch] = constraint ?? [];
    const [, vMajor, vMinor, vPatch] = (version ?? []).map(Number);
    expect(vMajor).toBe(Number(major));
    if (patch === undefined) {
      expect(vMinor).toBeGreaterThanOrEqual(Number(minor));
    } else {
      expect(vMinor).toBe(Number(minor));
      expect(vPatch).toBeGreaterThanOrEqual(Number(patch));
    }
  });
});
