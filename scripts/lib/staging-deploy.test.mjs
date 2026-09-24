// How deploy-staging.yml finds staging and pushes to it. Small, but it is the
// part that decides where code goes, so it is tested rather than assumed.
import { describe, expect, test } from 'vitest';
import { deployCommands, readOrganisation } from './staging-deploy.mjs';
import { STAGING_APP_NAME } from './staging.mjs';

const ORG = 'orga_12345678-90ab-cdef-1234-567890abcdef';

describe('readOrganisation', () => {
  test('reads the organisation from the committed Terraform variables', () => {
    expect(readOrganisation(`organisation = "${ORG}"\n`)).toBe(ORG);
  });

  test('ignores a line that has been commented out', () => {
    expect(readOrganisation(`# organisation = "${ORG}"\n`)).toBeNull();
  });

  test('is null when nothing names it, so the caller can say what is missing', () => {
    expect(readOrganisation('')).toBeNull();
  });
});

describe('deployCommands', () => {
  const CLEVER = '/cache/clever-tools/5.0.2/clever';
  const [link, deploy] = deployCommands(ORG, CLEVER);

  test('finds the app by name inside the staging organisation, and nowhere else', () => {
    expect(link).toEqual([CLEVER, 'link', STAGING_APP_NAME, '--org', ORG, '--alias', 'staging']);
  });

  test('pushes to that app, restarting it when the commit is already there', () => {
    expect(deploy).toEqual([
      CLEVER,
      'deploy',
      '--alias',
      'staging',
      '--same-commit-policy',
      'restart',
    ]);
  });

  test('never forces a push, so history staging did not expect fails loudly', () => {
    expect(deploy).not.toContain('--force');
  });

  test('runs the binary it is given, which is the pinned one checked by hash', () => {
    // The pin and the hash are held in clever-tools.test.mjs; `npx` and
    // "latest" are both gone.
    expect([link[0], deploy[0]]).toEqual([CLEVER, CLEVER]);
    expect([...link, ...deploy].join(' ')).not.toMatch(/npx|latest/);
  });
});
