#!/usr/bin/env node
// Shell command guard.
//   --global                    rules for every session and agent
//   --readonly                  for reviewer agents: no state-changing commands
//   --deny-write-glob <glob>    block commands that write to matching paths (heuristic);
//                               with --global, refused in D-120's words
//   --allow-main-session <glob> exempt from --deny-write-glob when the main session
//                               asks (no agent_id in the input), never a subagent
//   --agent <name>              used in messages
import {
  readInput,
  relPath,
  repoRelPath,
  matchesAny,
  argList,
  argValue,
  hasFlag,
  isSubagent,
  d120Refusal,
  block,
} from './lib.mjs';

const input = await readInput();
const cmd = String(input?.tool_input?.command ?? '');
if (!cmd) process.exit(0);
const agent = argValue('--agent', 'this session');
// BUG-36 review loop 1 (code-reviewer): the global mode, named once, as
// guard-paths names it.
const everySession = hasFlag('--global');

const GLOBAL = [
  [
    /\bgit\s+push\b[^\n]*(\bmain\b|\bmaster\b|HEAD:main)/,
    'Pushing to main is not allowed (D-029). Push a feature branch and open a pull request.',
  ],
  [/\bgit\s+push\b[^\n]*\s(--force(-with-lease)?|-f)\b/, 'Force pushing is not allowed.'],
  [/--no-verify\b|\bgit\s+commit\b[^\n]*\s-n\b/, 'Skipping git hooks is not allowed.'],
  [
    /(^|[\s;&|(])(cat|less|more|head|tail|source|grep|\.)\s+[^\n]*\.env(\.|\b)/,
    'Reading .env files is not allowed.',
  ],
  [/\bclever\s+deploy\b/, 'Deploys run from CI only (Section 8).'],
  // The same deploy, through the script deploy-staging.yml runs (INF-07).
  [/\bscripts\/staging-deploy\.mjs\b/, 'Deploys run from CI only (Section 8).'],
  // Anything named terraform, with anything between it and the verb: flags
  // such as -chdir= sit there, and so does the path when the pinned binary or
  // its wrapper (scripts/terraform.mjs, INF-07) is called directly.
  [/\bterraform\b[^\n]*\s(apply|destroy)\b/, 'terraform apply and destroy need the owner.'],
  // Staging is applied by two workflow runs the owner starts (D-077). GitHub
  // sees a session's tools as the owner, so it could not tell the difference —
  // which is why a session must not start a run at all, nor re-run one, by
  // any route: gh with any flags first (-R names another repository), or the
  // REST endpoints behind it.
  [
    /\bgh\b[^\n]*\bworkflow\s+run\b|\bgh\b[^\n]*\brun\s+rerun\b|\/actions\/workflows\/\S*\/dispatches\b|\/actions\/(runs|jobs)\/\d+\/rerun/,
    'Starting or re-running a workflow run is for the owner (D-077): GitHub cannot tell this session from the owner.',
  ],
  [/\bgh\s+pr\s+merge\b[^\n]*--admin\b/, 'Admin merges bypass the gates (D-042).'],
];

function redirectTargets(c) {
  const out = [];
  // BUG-36 review loop 1: a target ends where the shell ends the word, at `<`
  // and a backtick too. m[4] is the backtick the target stops at, if any.
  const re = /(\d?)>>?\s*(&?)\s*([^\s;&|)<`]*)(`?)/g;
  let m;
  while ((m = re.exec(c))) {
    // BUG-36 review loop 1: quotes are the shell's, not the file's name, so a
    // refusal names the file (`> .claude/state/x"` in a quoted message).
    // BUG-36 review loop 3 (test-auditor): stripped before the descriptor
    // test too, so the closing quote of bash -c "… 2>&1" does not turn
    // descriptor 1 into a file named `1"`.
    const target = m[3].replaceAll(/["']/g, '');
    // BUG-36 review loop 2 (privacy-security-reviewer, test-auditor): `>&`
    // only copies or closes a file descriptor when a number or `-` follows
    // (2>&1, >&2, 1>&-); followed by anything else, bash writes that file.
    if (m[2] === '&' && /^(\d+|-)$/.test(target)) continue;
    // BUG-36 review loop 3 (privacy-security-reviewer): a target that starts
    // with a backtick, quoted or not, is a command substitution, and bash
    // writes the file it prints. It is still a redirect: --readonly refuses
    // it and the deny-write check runs, judging the words inside it, which
    // the tokens split at the backtick. The backtick stands for the target;
    // no deny glob matches it.
    if (!target && m[4]) {
      out.push('`');
      continue;
    }
    if (!target || target === '/dev/null') continue;
    out.push(target);
  }
  return out;
}
// BUG-36 review loop 1 (test-author): a command right after a backtick is a
// command too; `$(rm` is already seen at its `(`.
const WRITE_OPS =
  /(^|[\s;&|(`])(rm|mv|cp|truncate|tee|touch|mkdir|chmod|chown)\s|\bsed\s+(-[a-zA-Z]*i|--in-place)|\bgit\s+(checkout\s+--|restore|rm|mv)\b/;
// BUG-36 review loop 1 (privacy-security-reviewer): ln, install and dd write
// the path they are given as surely as cp does. Counted only where deny-write
// globs are judged, not in --readonly's list: a reviewer's `rg install docs`
// only reads.
// BUG-36 review loop 2 (privacy-security-reviewer): so does unlink. And each
// counts only as the command word, where the shell runs it: at the start, or
// after `;`, `&`, `|`, `(` (so `$(` too), a backtick or a newline, or after
// `then`, `do` or `else` there. After mere whitespace it is an argument, as in
// `pnpm install` or `grep -rn install`, and refusing those beside a protected
// path refused commands that write nothing.
const DENY_WRITE_OPS = /(^|[;&|(`\n])\s*((then|do|else)\s+)?(ln|install|dd|unlink)\s/;

if (everySession) {
  for (const [re, msg] of GLOBAL) if (re.test(cmd)) block(`Blocked: ${msg}`);
}

if (hasFlag('--readonly')) {
  const RO = [
    [
      /\bgit\s+(commit|push|add|reset|restore|checkout|switch|rebase|merge|cherry-pick|revert|tag|stash|clean|rm|mv)\b/,
      'git write commands',
    ],
    [WRITE_OPS, 'file-changing commands'],
    [/\b(pnpm|npm|yarn)\s+(add|remove|install|i|up|update)\b/, 'dependency changes'],
  ];
  for (const [re, what] of RO)
    if (re.test(cmd)) block(`Blocked for ${agent}: read-only role, ${what} are not allowed.`);
  if (redirectTargets(cmd).length)
    block(`Blocked for ${agent}: read-only role, output redirection to files is not allowed.`);
}

const denyGlobs = argList('--deny-write-glob');
if (
  denyGlobs.length &&
  (WRITE_OPS.test(cmd) || DENY_WRITE_OPS.test(cmd) || redirectTargets(cmd).length)
) {
  // Per path, not per command: a command that names an exempt path and a
  // protected one is still refused.
  const mainSessionGlobs = isSubagent(input) ? [] : argList('--allow-main-session');
  // BUG-36 review loop 1 (privacy-security-reviewer): the shell ends a word at
  // `;`, `&`, `|`, `<`, `>`, a bracket, a backtick and `$` too, so the guard
  // splits there and judges the word the shell sees: in
  // `rm .claude/settings.local.json; echo done` that is the file, not
  // `.claude/settings.local.json;`. `=` splits `dd of=PATH`, so PATH is judged.
  const tokens = cmd.split(/[\s'"=;&|()<>`$]+/).filter(Boolean);
  // BUG-36: each redirect target is judged as a path too, and first, so a
  // refusal names the file the shell would write.
  // BUG-36 review loop 1 (the reviewer): with --global, case is ignored, as
  // the owner's Mac file system ignores it; a role's guard keeps exact case.
  const ignoreCase = everySession;
  for (const t of [...redirectTargets(cmd), ...tokens]) {
    // BUG-36: with --global, each path is named from the repository, not the
    // session's folder, so a session in a subfolder cannot dodge D-120.
    const rel = everySession ? repoRelPath(t, input.cwd) : relPath(t, input.cwd);
    if (
      matchesAny(rel, denyGlobs, { ignoreCase }) &&
      !matchesAny(rel, mainSessionGlobs, { ignoreCase })
    ) {
      block(
        everySession
          ? d120Refusal(rel)
          : `Blocked for ${agent}: this command appears to change ${rel}, which is protected for this role (RG-03). ` +
              `Run the command without writing to files, or stop and explain.`,
      );
    }
  }
}
process.exit(0);
