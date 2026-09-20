// HK-04: every edit is checked immediately, by the same script CI runs.
import { afterEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ALLOWED,
  BLOCKED,
  edit,
  fakeScripts,
  makeDir,
  removeRepo,
  runHook,
} from './test-helpers.mjs';

const dirs = [];
function dirWith(files) {
  const dir = makeDir(files);
  dirs.push(dir);
  return dir;
}

function ranLog(dir) {
  try {
    return readFileSync(path.join(dir, 'ran.txt'), 'utf8');
  } catch {
    return '';
  }
}

afterEach(() => {
  while (dirs.length > 0) {
    removeRepo(dirs.pop());
  }
});

describe('HK-04: the gate runs after an edit', () => {
  test('and the edited file is handed to it', () => {
    const dir = dirWith(fakeScripts({ 'gate:file': {} }));
    const result = runHook('post-edit.mjs', {
      input: edit(path.join(dir, 'apps/server/src/api.ts')),
      cwd: dir,
    });
    expect(result.status).toBe(ALLOWED);
    expect(ranLog(dir)).toContain('apps/server/src/api.ts');
  });

  test('a failing check stops the work and shows the output', () => {
    const dir = dirWith(
      fakeScripts({ 'gate:file': { exitCode: 1, output: 'journey.ts(3,1): error TS2322' } }),
    );
    const result = runHook('post-edit.mjs', {
      input: edit(path.join(dir, 'apps/server/src/journey.ts')),
      cwd: dir,
    });
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('error TS2322');
  });
});

describe('HK-04: a missing gate is loud, not silent', () => {
  test('because no checks at all is the failure this project must never have', () => {
    const dir = dirWith({ 'package.json': JSON.stringify({ name: 'no-gate', scripts: {} }) });
    const result = runHook('post-edit.mjs', {
      input: edit(path.join(dir, 'apps/server/src/api.ts')),
      cwd: dir,
    });
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain('gate:file');
  });
});

describe('HK-04: edits the gate has nothing to say about', () => {
  test.each([
    ['docs/progress.md', 'a planning document'],
    ['docs/plan/decisions.md', 'the decision log'],
    ['README.md', 'prose'],
  ])('%s (%s) passes without running anything', (file) => {
    const dir = dirWith(fakeScripts({ 'gate:file': {} }));
    const result = runHook('post-edit.mjs', { input: edit(path.join(dir, file)), cwd: dir });
    expect(result.status).toBe(ALLOWED);
    expect(ranLog(dir)).toBe('');
  });

  test('a tool that edits no file at all', () => {
    const dir = dirWith(fakeScripts({ 'gate:file': {} }));
    const result = runHook('post-edit.mjs', {
      input: { tool_name: 'Bash', tool_input: { command: 'ls' } },
      cwd: dir,
    });
    expect(result.status).toBe(ALLOWED);
  });

  test('a folder with no package.json, before the repository is set up', () => {
    const dir = dirWith({});
    const result = runHook('post-edit.mjs', {
      input: edit(path.join(dir, 'apps/server/src/api.ts')),
      cwd: dir,
    });
    expect(result.status).toBe(ALLOWED);
  });
});
