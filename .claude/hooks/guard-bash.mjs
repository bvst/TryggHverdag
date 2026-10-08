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
  const re = /(\d?)>>?\s*(&?)([^\s;&|)]*)/g;
  let m;
  while ((m = re.exec(c))) {
    if (m[2] === '&') continue; // 2>&1 and similar
    if (!m[3] || m[3] === '/dev/null') continue;
    out.push(m[3]);
  }
  return out;
}
const WRITE_OPS =
  /(^|[\s;&|(])(rm|mv|cp|truncate|tee|touch|mkdir|chmod|chown)\s|\bsed\s+(-[a-zA-Z]*i|--in-place)|\bgit\s+(checkout\s+--|restore|rm|mv)\b/;

if (hasFlag('--global')) {
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
if (denyGlobs.length && (WRITE_OPS.test(cmd) || redirectTargets(cmd).length)) {
  // Per path, not per command: a command that names an exempt path and a
  // protected one is still refused.
  const mainSessionGlobs = isSubagent(input) ? [] : argList('--allow-main-session');
  const tokens = cmd.split(/[\s'"=]+/).filter(Boolean);
  // BUG-36: a redirect needs no space (`>file`, `x>>file`, `2>file`), so the
  // split above leaves `>file`; each redirect target is judged as a path too,
  // and first, so a refusal names the file the shell would write.
  for (const t of [...redirectTargets(cmd), ...tokens]) {
    // BUG-36: with --global, each path is named from the repository, not the
    // session's folder, so a session in a subfolder cannot dodge D-120.
    const rel = hasFlag('--global') ? repoRelPath(t, input.cwd) : relPath(t, input.cwd);
    if (matchesAny(rel, denyGlobs) && !matchesAny(rel, mainSessionGlobs)) {
      block(
        hasFlag('--global')
          ? d120Refusal(rel)
          : `Blocked for ${agent}: this command appears to change ${rel}, which is protected for this role (RG-03). ` +
              `Run the command without writing to files, or stop and explain.`,
      );
    }
  }
}
process.exit(0);
