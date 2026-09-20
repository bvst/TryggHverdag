// Shared helpers for hook scripts. No dependencies; Node 22+.
import path from 'node:path';

export async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    block('Hook could not parse its input. Failing closed.');
  }
}

export function relPath(file, cwd = process.cwd()) {
  const abs = path.resolve(cwd, file);
  return path.relative(cwd, abs).split(path.sep).join('/');
}

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('\\^$+.()|{}[]'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

export function matchesAny(rel, globs) {
  return globs.some((g) => globToRegExp(g).test(rel));
}

export function argList(name) {
  const out = [];
  const a = process.argv;
  for (let i = 0; i < a.length; i++) if (a[i] === name && a[i + 1]) out.push(a[i + 1]);
  return out;
}

export function argValue(name, fallback = '') {
  return argList(name)[0] ?? fallback;
}

export function hasFlag(name) {
  return process.argv.includes(name);
}

// Exit code 2 blocks the action (PreToolUse) or feeds the message back to Claude.
export function block(message) {
  process.stderr.write(message.trim() + '\n');
  process.exit(2);
}

export function tail(text, max = 4000) {
  return text.length > max ? '…' + text.slice(-max) : text;
}
