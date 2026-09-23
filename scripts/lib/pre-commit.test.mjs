// HK-09: what the pre-commit hook may and may not do to your files.
//
// Test names carry no <ID>-ACn: prefix. HK- is not a tracked requirement —
// req:coverage does not collect the prefix, and it appears zero times in
// docs/requirements-status.md — so these tests prove nothing it counts. That is
// the exemption D-074 keys to what a test proves rather than to a directory.
import { describe, expect, test } from 'vitest';
import { classify, preCommit } from './pre-commit.mjs';

/** Records what was asked of it, so a test can assert on what did not happen. */
function spy(ok = true, output = '') {
  const calls = [];
  const fn = (files) => {
    calls.push(files);
    return { ok, output };
  };
  fn.calls = calls;
  return fn;
}

function io(overrides = {}) {
  return {
    staged: [],
    unstaged: [],
    format: spy(),
    // By default prettier is taken to have rewritten everything it was handed.
    // Tests that care about the opposite pass their own.
    changed: (files) => files,
    check: spy(),
    lint: spy(),
    stage: spy(),
    ...overrides,
  };
}

describe('classify', () => {
  test('a fully staged file may be rewritten', () => {
    const { writable, partial } = classify(['src/a.ts'], []);
    expect(writable).toEqual(['src/a.ts']);
    expect(partial).toEqual([]);
  });

  test('a file staged with more still in the working tree may not be', () => {
    // git add -p: the commit holds one hunk and the file holds two. Formatting
    // it and running git add would sweep in the hunk that was held back.
    const { writable, partial } = classify(['src/a.ts'], ['src/a.ts']);
    expect(writable).toEqual([]);
    expect(partial).toEqual(['src/a.ts']);
  });

  test('files prettier does not handle are left entirely alone', () => {
    const { writable, partial, lintable } = classify(['assets/logo.png', 'Makefile'], []);
    expect(writable).toEqual([]);
    expect(partial).toEqual([]);
    expect(lintable).toEqual([]);
  });

  test('markdown is offered to prettier, never to eslint', () => {
    // Whether it is then rewritten is .prettierignore's call, not this module's:
    // markdown and everything under docs/ are ignored there, because prose here
    // is wrapped by hand. Duplicating that list would give the repository two
    // answers to one question. See the "leaves alone" test below for the effect.
    const { writable, lintable } = classify(['docs/progress.md'], []);
    expect(writable).toEqual(['docs/progress.md']);
    expect(lintable).toEqual([]);
  });
});

describe('preCommit', () => {
  test('formats a staged file and stages the result', () => {
    const stage = spy();
    const format = spy();
    const result = preCommit(io({ staged: ['src/a.ts'], format, stage }));

    expect(result.ok).toBe(true);
    expect(format.calls).toEqual([['src/a.ts']]);
    expect(stage.calls).toEqual([['src/a.ts']]);
    expect(result.formatted).toEqual(['src/a.ts']);
  });

  test('never rewrites or stages a partly staged file', () => {
    // The guarantee that matters most here: work held back stays held back.
    const format = spy();
    const stage = spy();
    const result = preCommit(
      io({ staged: ['src/a.ts'], unstaged: ['src/a.ts'], format, stage, check: spy(true) }),
    );

    expect(format.calls).toEqual([]);
    expect(stage.calls).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('blocks when a partly staged file is misformatted, and says what to run', () => {
    const result = preCommit(
      io({ staged: ['src/a.ts'], unstaged: ['src/a.ts'], check: spy(false, 'src/a.ts') }),
    );

    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('only partly staged');
    expect(result.problems.join('\n')).toContain('pnpm run format');
  });

  test('blocks on a lint finding instead of fixing it', () => {
    // The owner's decision: prettier writes, eslint only reports. eslint --fix
    // can change behaviour, and a commit must not carry an unread change.
    const result = preCommit(
      io({ staged: ['src/a.ts'], lint: spy(false, "'x' is assigned but never used") }),
    );

    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('never used');
  });

  test('passes the lint output through rather than summarising it', () => {
    const result = preCommit(
      io({ staged: ['src/a.ts'], lint: spy(false, 'src/a.ts:12:3  error  no-shadow') }),
    );
    expect(result.problems.join('\n')).toContain('src/a.ts:12:3');
  });

  test('does not stage anything when prettier fails to parse the file', () => {
    // A syntax error must not end with a half-written file added to the commit.
    const stage = spy();
    const result = preCommit(
      io({ staged: ['src/a.ts'], format: spy(false, 'SyntaxError: Unexpected token'), stage }),
    );

    expect(result.ok).toBe(false);
    expect(stage.calls).toEqual([]);
    expect(result.problems.join('\n')).toContain('SyntaxError');
  });

  test('claims nothing for a file prettier left alone', () => {
    // docs/progress.md is in .prettierignore, so prettier reads it and writes
    // nothing. Reporting it as formatted, or re-staging it, would be a claim
    // about work that did not happen — which is the habit this repository keeps
    // having to correct. Only what git sees as modified counts.
    const stage = spy();
    const result = preCommit(io({ staged: ['docs/progress.md'], changed: () => [], stage }));

    expect(result.ok).toBe(true);
    expect(result.formatted).toEqual([]);
    expect(stage.calls).toEqual([]);
  });

  test('stages only the files prettier actually rewrote', () => {
    const stage = spy();
    const result = preCommit(
      io({
        staged: ['src/a.ts', 'docs/progress.md'],
        changed: () => ['src/a.ts'],
        stage,
      }),
    );

    expect(stage.calls).toEqual([['src/a.ts']]);
    expect(result.formatted).toEqual(['src/a.ts']);
  });

  test('runs nothing at all when no staged file is relevant', () => {
    const format = spy();
    const lint = spy();
    const result = preCommit(io({ staged: ['assets/logo.png'], format, lint }));

    expect(result.ok).toBe(true);
    expect(format.calls).toEqual([]);
    expect(lint.calls).toEqual([]);
  });

  test('reports every problem it found, not just the first', () => {
    // A hook that stops at the first failure costs a round trip per problem.
    const result = preCommit(
      io({
        staged: ['src/a.ts', 'src/b.ts'],
        unstaged: ['src/b.ts'],
        check: spy(false, 'src/b.ts'),
        lint: spy(false, 'no-shadow'),
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(2);
  });
});
