#!/usr/bin/env node
// Shell command guard.
//   --global                    rules for every session and agent
//   --readonly                  for reviewer agents: no state-changing commands
//   --deny-write-glob <glob>    block commands that write to matching paths (heuristic)
//   --agent <name>              used in messages
import { readInput, relPath, matchesAny, argList, argValue, hasFlag, block } from './lib.mjs';

const input = await readInput();
const cmd = String(input?.tool_input?.command ?? '');
if (!cmd) process.exit(0);
const agent = argValue('--agent', 'this session');

const GLOBAL = [
  [/\bgit\s+push\b[^\n]*(\bmain\b|\bmaster\b|HEAD:main)/, 'Pushing to main is not allowed (D-029). Push a feature branch and open a pull request.'],
  [/\bgit\s+push\b[^\n]*\s(--force(-with-lease)?|-f)\b/, 'Force pushing is not allowed.'],
  [/--no-verify\b|\bgit\s+commit\b[^\n]*\s-n\b/, 'Skipping git hooks is not allowed.'],
  [/(^|[\s;&|(])(cat|less|more|head|tail|source|grep|\.)\s+[^\n]*\.env(\.|\b)/, 'Reading .env files is not allowed.'],
  [/\bclever\s+deploy\b/, 'Deploys run from CI only (Section 8).'],
  [/\bterraform\s+apply\b/, 'terraform apply needs the owner.'],
  [/\bgh\s+pr\s+merge\b[^\n]*--admin\b/, 'Admin merges bypass the gates (D-042).'],
];

function redirectTargets(c) {
  const out = [];
  const re = /(\d?)>>?\s*(&?)([^\s;&|)]*)/g;
  let m;
  while ((m = re.exec(c))) {
    if (m[2] === '&') continue;           // 2>&1 and similar
    if (!m[3] || m[3] === '/dev/null') continue;
    out.push(m[3]);
  }
  return out;
}
const WRITE_OPS = /(^|[\s;&|(])(rm|mv|cp|truncate|tee|touch|mkdir|chmod|chown)\s|\bsed\s+(-[a-zA-Z]*i|--in-place)|\bgit\s+(checkout\s+--|restore|rm|mv)\b/;

if (hasFlag('--global')) {
  for (const [re, msg] of GLOBAL) if (re.test(cmd)) block(`Blocked: ${msg}`);
}

if (hasFlag('--readonly')) {
  const RO = [
    [/\bgit\s+(commit|push|add|reset|restore|checkout|switch|rebase|merge|cherry-pick|revert|tag|stash|clean|rm|mv)\b/, 'git write commands'],
    [WRITE_OPS, 'file-changing commands'],
    [/\b(pnpm|npm|yarn)\s+(add|remove|install|i|up|update)\b/, 'dependency changes'],
  ];
  for (const [re, what] of RO) if (re.test(cmd)) block(`Blocked for ${agent}: read-only role, ${what} are not allowed.`);
  if (redirectTargets(cmd).length) block(`Blocked for ${agent}: read-only role, output redirection to files is not allowed.`);
}

const denyGlobs = argList('--deny-write-glob');
if (denyGlobs.length && (WRITE_OPS.test(cmd) || redirectTargets(cmd).length)) {
  const tokens = cmd.split(/[\s'"=]+/).filter(Boolean);
  for (const t of tokens) {
    const rel = relPath(t, input.cwd);
    if (matchesAny(rel, denyGlobs)) {
      block(`Blocked for ${agent}: this command appears to change ${rel}, which is protected for this role (RG-03). ` +
            `Run the command without writing to files, or stop and explain.`);
    }
  }
}
process.exit(0);
