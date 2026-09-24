// How deploy-staging.yml finds staging and pushes to it. Small, but it is the
// part that decides where code goes, so it is tested rather than assumed.
import { describe, expect, test } from 'vitest';
import { CLEVER_TOOLS, deployCommands, readOrganisation } from './staging-deploy.mjs';
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
  const [link, deploy] = deployCommands(ORG);

  test('finds the app by name inside the staging organisation, and nowhere else', () => {
    expect(link).toEqual([
      ...CLEVER_TOOLS,
      'link',
      STAGING_APP_NAME,
      '--org',
      ORG,
      '--alias',
      'staging',
    ]);
  });

  test('pushes to that app, restarting it when the commit is already there', () => {
    expect(deploy).toEqual([
      ...CLEVER_TOOLS,
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

  test('runs a pinned version of the command-line tool, never "latest"', () => {
    expect(CLEVER_TOOLS.join(' ')).toMatch(/clever-tools@\d+\.\d+\.\d+$/);
  });
});
