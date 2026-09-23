// Every gate asks packageScripts which scripts exist, and skips the steps whose
// script is missing. So if this function ever answers "none" when it means "I
// could not tell", every gate passes having run nothing — quietly, and looking
// exactly like a gate that passed on merit.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { packageScripts } from './proc.mjs';

function repoWith(contents) {
  const dir = mkdtempSync(path.join(tmpdir(), 'proc-test-'));
  if (contents !== null) {
    writeFileSync(path.join(dir, 'package.json'), contents);
  }
  return dir;
}

describe('packageScripts', () => {
  test('reads the scripts of the package.json in that directory', () => {
    const dir = repoWith(JSON.stringify({ name: 'x', scripts: { lint: 'eslint .' } }));

    expect(packageScripts(dir)).toEqual({ lint: 'eslint .' });
  });

  test('a package.json with no scripts is an empty set, which is a real answer', () => {
    expect(packageScripts(repoWith(JSON.stringify({ name: 'x' })))).toEqual({});
  });

  test('a missing package.json throws rather than answering "no scripts"', () => {
    expect(() => packageScripts(repoWith(null))).toThrow(/package\.json/);
  });

  test('an unreadable package.json throws rather than answering "no scripts"', () => {
    expect(() => packageScripts(repoWith('{ not json'))).toThrow(/package\.json/);
  });

  test('a warning printed while reading it cannot turn into "no scripts"', () => {
    // This is not hypothetical: reading package.json used to mean spawning node
    // and parsing its output, and that output was stdout and stderr glued
    // together. One deprecation warning from node — or an environment variable
    // that makes it print one — and every gate in the repository would report
    // every step as "not possible yet", and pass.
    const dir = repoWith(JSON.stringify({ scripts: { 'gate:static': 'x' } }));
    const before = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = '--experimental-loader=data:text/javascript,';
    try {
      expect(packageScripts(dir)).toEqual({ 'gate:static': 'x' });
    } finally {
      if (before === undefined) {
        delete process.env.NODE_OPTIONS;
      } else {
        process.env.NODE_OPTIONS = before;
      }
    }
  });
});
