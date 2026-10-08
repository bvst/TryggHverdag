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

export function relPath(file, cwd = process.cwd(), root = cwd) {
  const abs = path.resolve(cwd, file);
  return path.relative(root, abs).split(path.sep).join('/');
}

// BUG-36 (D-120): how the global guards name a path. A relative path starts
// from the session's folder, where the write would land, and is then named
// from the repository, CLAUDE_PROJECT_DIR, which Claude Code sets for every
// hook (code.claude.com/docs/en/hooks): from apps/server, both
// <repo>/.claude/state/gate-passed and ../../.claude/state/gate-passed are
// .claude/state/gate-passed. If CLAUDE_PROJECT_DIR is unset, the session's
// folder stands in for the repository, as it did before BUG-36.
export function repoRelPath(file, cwd = process.cwd(), env = process.env) {
  return relPath(file, cwd, env.CLAUDE_PROJECT_DIR || cwd);
}

export function globToRegExp(glob, { ignoreCase = false } = {}) {
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
  return new RegExp('^' + re + '$', ignoreCase ? 'i' : '');
}

// BUG-36 review loop 1 (privacy-security-reviewer): the owner's Mac file
// system ignores case, so there `.CLAUDE/settings.local.json` is the file
// D-120 protects; the global guards pass ignoreCase. A role's guard does not:
// on an --allow list, ignoring case would widen what the role may change.
export function matchesAny(rel, globs, { ignoreCase = false } = {}) {
  return globs.some((g) => globToRegExp(g, { ignoreCase }).test(rel));
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
    `the one exception is .claude/state/phase, which only the main session may change, never a subagent. ` +
    // BUG-36 review loop 1 (privacy-security-reviewer): the shell guard reads
    // the whole command, so text that only quotes the path is refused too;
    // say what to do, so a session does not hunt for a phrasing it misses.
    `If the command only quotes the path in its text (a commit message, a search pattern), ` +
    `pass that text from a file instead, for example git commit -F <file>. ` +
    // BUG-36 review loop 2 (privacy-security-reviewer): a command that only
    // names the .claude folder, such as git diff -- .claude > /tmp/d.txt, is
    // refused too, and a file does not help there; naming the subfolder does.
    `If it only names a folder D-120 protects, such as .claude, name the subfolder you mean instead, ` +
    `for example .claude/agents.`
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
