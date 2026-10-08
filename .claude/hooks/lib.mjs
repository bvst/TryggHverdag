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

// D-120: Claude Code puts agent_id in a hook's input only when a subagent made
// the call (code.claude.com/docs/en/hooks, "Common input fields"), so only its
// absence marks the main session. Any agent_id at all, even an empty one, is a
// subagent: the exemption it decides is the main session's alone.
export function isSubagent(input) {
  return input?.agent_id !== undefined;
}

// D-120: what the global guards say when a tool call would change a path they
// protect. One message for both guards and every such path.
export function d120Refusal(rel) {
  return (
    `Blocked: this would change ${rel}, which D-120 protects. ` +
    `No tool call changes .claude/settings.local.json: the owner changes it by hand. ` +
    `The files in .claude/state/ are the hooks' own records, which the hooks write themselves; ` +
    `the one exception is .claude/state/phase, which only the main session may change, never a subagent.`
  );
}

// D-119: a CI review job changes no code, and CI's required checks run the
// same gates on the same commit, so the gates stand down there. Both variables,
// so neither another CI job nor a local session can turn a gate off by accident.
export function inReviewJob(env = process.env) {
  return env.GITHUB_ACTIONS === 'true' && env.TRYGGHVERDAG_REVIEW_JOB === '1';
}

// Exit code 2 blocks the action (PreToolUse) or feeds the message back to Claude.
export function block(message) {
  process.stderr.write(message.trim() + '\n');
  process.exit(2);
}

export function tail(text, max = 4000) {
  return text.length > max ? '…' + text.slice(-max) : text;
}
