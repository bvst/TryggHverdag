// Helpers for the hook tests. Hooks are processes that read JSON on stdin and
// answer with an exit code, so the tests run them exactly the way Claude Code
// does: as a child process, never by importing them.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

export const HOOKS_DIR = import.meta.dirname;

/** Exit code 2 is how a hook blocks an action. */
export const BLOCKED = 2;
export const ALLOWED = 0;

/**
 * Runs a hook the way Claude Code runs it.
 *
 * @param {string} hook file name, e.g. 'guard-bash.mjs'
 * @param {{ args?: string[], input?: object, cwd?: string }} options
 */
export function runHook(hook, { args = [], input = {}, cwd = process.cwd() } = {}) {
  // Some tests pass a folder that only exists on paper, to check path maths
  // without touching the disk. The hook still gets it as the session folder;
  // the process itself then runs where the test does.
  const spawnIn = existsSync(cwd) ? cwd : process.cwd();
  const result = spawnSync(process.execPath, [path.join(HOOKS_DIR, hook), ...args], {
    input: JSON.stringify({ cwd, ...input }),
    encoding: 'utf8',
    cwd: spawnIn,
    timeout: 120_000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** An edit of `file` whose new content is `content`, as Claude Code reports it. */
export function edit(file, content = '') {
  return { tool_name: 'Edit', tool_input: { file_path: file, content } };
}

/** A shell command, as Claude Code reports it. */
export function bash(command) {
  return { tool_name: 'Bash', tool_input: { command } };
}

/**
 * A throwaway git repository with one commit, so hooks that compare against
 * HEAD have something to compare with.
 *
 * @param {Record<string, string>} files path → contents, relative to the repo
 */
export function makeRepo(files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hook-test-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Hook test');
  git('config', 'commit.gpgsign', 'false');
  write(dir, files);
  git('add', '-A');
  git('commit', '-q', '-m', 'first');
  return dir;
}

/** A throwaway folder with files in it, for hooks that do not need git. */
export function makeDir(files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hook-test-'));
  write(dir, files);
  return dir;
}

/** Writes files into a directory, creating folders as needed. */
export function write(dir, files) {
  for (const [file, contents] of Object.entries(files)) {
    const full = path.join(dir, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
}

export function removeRepo(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * A package.json whose scripts are real files, so a test can see which script
 * ran, with which arguments, and decide whether it passes or fails.
 *
 * @param {Record<string, { exitCode?: number, output?: string }>} scripts
 */
export function fakeScripts(scripts) {
  const files = {};
  const packageScripts = {};
  for (const [name, options] of Object.entries(scripts)) {
    const { exitCode = 0, output = '' } = options ?? {};
    const fileName = `fake-${name.replace(/[^a-z]/gi, '-')}.mjs`;
    files[fileName] = [
      "import { appendFileSync } from 'node:fs';",
      `appendFileSync('ran.txt', ${JSON.stringify(name)} + ' ' + process.argv.slice(2).join(' ') + '\\n');`,
      output ? `process.stdout.write(${JSON.stringify(output)});` : '',
      `process.exit(${String(exitCode)});`,
    ].join('\n');
    packageScripts[name] = `node ${fileName}`;
  }
  files['package.json'] = JSON.stringify(
    { name: 'fake', private: true, scripts: packageScripts },
    null,
    2,
  );
  return files;
}
