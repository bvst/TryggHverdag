// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// HK-05 / RG-03: a failing test must not be "fixed" by making it check less.
// The hook compares the edited file against the version in HEAD.
import { afterEach, describe, expect, test } from 'vitest';
import { ALLOWED, BLOCKED, edit, makeRepo, removeRepo, runHook, write } from './test-helpers.mjs';

const ORIGINAL = `
import { describe, expect, test } from 'vitest';

describe('LOST-02', () => {
  test('LOST-02-AC1: five minutes of silence opens an alert', () => {
    expect(alertOpened).toBe(true);
    expect(responderNotified).toBe(true);
  });

  test('LOST-02-AC2: a heartbeat resolves it', () => {
    expect(alertResolved).toBe(true);
  });
});
`;

const repos = [];
function repoWith(contents) {
  const dir = makeRepo({ 'apps/server/src/journey.test.ts': ORIGINAL });
  repos.push(dir);
  if (contents !== undefined) {
    write(dir, { 'apps/server/src/journey.test.ts': contents });
  }
  return dir;
}

function check(dir, file = 'apps/server/src/journey.test.ts') {
  return runHook('test-weakening.mjs', { input: edit(file), cwd: dir });
}

afterEach(() => {
  while (repos.length > 0) {
    removeRepo(repos.pop());
  }
});

describe('HK-05: weakening is caught the moment it happens', () => {
  test('a skipped test', () => {
    const dir = repoWith(ORIGINAL.replace("test('LOST-02-AC2", "test.skip('LOST-02-AC2"));
    const result = check(dir);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('skipped, focused or todo tests were added');
  });

  test('a focused test, which quietly stops the others from running', () => {
    const dir = repoWith(ORIGINAL.replace("test('LOST-02-AC1", "test.only('LOST-02-AC1"));
    expect(check(dir).status).toBe(BLOCKED);
  });

  test('a deleted test', () => {
    const shorter = ORIGINAL.split("  test('LOST-02-AC2")[0] + '});\n';
    const dir = repoWith(shorter);
    const result = check(dir);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('the number of tests went down');
  });

  test('a removed assertion', () => {
    const dir = repoWith(ORIGINAL.replace('    expect(responderNotified).toBe(true);\n', ''));
    const result = check(dir);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('the number of assertions went down');
  });

  test('and it says RG-03, so the reason is findable', () => {
    const dir = repoWith(ORIGINAL.replace("test('LOST-02-AC2", "test.skip('LOST-02-AC2"));
    expect(check(dir).stderr).toContain('RG-03');
  });
});

describe('HK-05: honest test changes are left alone', () => {
  test('adding a test', () => {
    const more = ORIGINAL.replace(
      '});\n',
      "  test('LOST-02-AC3: escalation', () => {\n    expect(smsSent).toBe(true);\n  });\n});\n",
    );
    expect(check(repoWith(more)).status).toBe(ALLOWED);
  });

  test('changing a test without weakening it', () => {
    const changed = ORIGINAL.replace('toBe(true)', 'toBe(Boolean(1))');
    expect(check(repoWith(changed)).status).toBe(ALLOWED);
  });

  test('a brand new test file, which has nothing to compare against', () => {
    const dir = repoWith();
    write(dir, { 'apps/server/src/new.test.ts': ORIGINAL });
    expect(check(dir, 'apps/server/src/new.test.ts').status).toBe(ALLOWED);
  });

  test('a file that is not a test', () => {
    const dir = repoWith();
    write(dir, { 'apps/server/src/api.ts': 'export const api = 1;' });
    expect(check(dir, 'apps/server/src/api.ts').status).toBe(ALLOWED);
  });
});

// INF-10-AC17 (D-082): a test switched off from inside its body, by a call to
// its context's skip function, with every count unchanged. The call is put
// together at run time: written out, it would count toward this file's own
// skips, and tests:changes would refuse the pull request that adds it.
describe('INF-10-AC17: HK-05 sees a test switched off from inside its body', () => {
  /**
   * The test's body, whose failure says so when the hook it runs is not what
   * HEAD holds: a reviewer's sandbox reverts .claude/** (R5), as
   * scripts/ai-review.test.mjs explains.
   */
  const noted = (body) => async () => {
    try {
      await body();
    } catch (error) {
      const { spawnSync } = await import('node:child_process');
      const hook = ['test-weakening.mjs', 'lib.mjs'];
      const asCommitted =
        spawnSync('git', ['diff', '--quiet', 'HEAD', '--', ...hook], { cwd: import.meta.dirname })
          .status === 0;
      if (asCommitted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}\n\nNOTE: the hook on disk differs from HEAD, so this test ran something other than the committed hook. \`git diff HEAD -- .claude/hooks\` shows what differs.`,
        { cause: error },
      );
    }
  };

  test(
    "INF-10-AC17: HK-05 refuses an edit that makes a test call its context's skip first thing, with every count unchanged",
    noted(() => {
      const call = `${['ctx', ['sk', 'ip'].join('')].join('.')}();`;
      const after = ORIGINAL.replace(
        "resolves it', () => {\n",
        `resolves it', (ctx) => {\n    ${call}\n`,
      );
      const result = check(repoWith(after));

      expect(after).not.toBe(ORIGINAL);
      expect(result.status).toBe(BLOCKED);
      expect(result.stderr).toContain('skipped, focused or todo tests were added');
      expect(result.stderr).toContain('RG-03');
    }),
  );
});
