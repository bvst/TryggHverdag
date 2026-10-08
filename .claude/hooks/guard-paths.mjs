#!/usr/bin/env node
// Path guard for the edit tools.
//   --agent <name>                 a role's own guard, in its frontmatter
//   --global                       the guard .claude/settings.json runs for every
//                                  session and subagent: refuses in D-120's words,
//                                  and leaves paths outside the repository alone
//   --allow <glob>                 the only paths this role may change
//   --deny <glob>                  paths refused
//   --allow-main-session <glob>    exempt from --deny when the main session asks
//                                  (no agent_id in the input), never a subagent
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
const file = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
if (!file) process.exit(0);

const everySession = hasFlag('--global');
// BUG-36: the global guard names a path from the repository, not the session's
// folder, so a session in a subfolder cannot dodge D-120.
const rel = everySession ? repoRelPath(file, input.cwd) : relPath(file, input.cwd);
const agent = argValue('--agent', 'this agent');
const allow = argList('--allow');
const deny = argList('--deny');
// BUG-36 review loop 1 (the reviewer): the global guard ignores case, as the
// owner's Mac file system does, in what it protects and in the main session's
// exemption alike; a role's own guard, --allow included, keeps exact case.
const ignoreCase = everySession;
const mainSessionMay =
  !isSubagent(input) && matchesAny(rel, argList('--allow-main-session'), { ignoreCase });

// A role stays inside the repository. The global guard leaves the rest of the
// disk alone: every session's scratchpad and plan files live outside it.
if (!everySession && rel.startsWith('..'))
  block(`Blocked for ${agent}: ${file} is outside the repository.`);
if (deny.length && matchesAny(rel, deny, { ignoreCase }) && !mainSessionMay) {
  block(
    everySession
      ? d120Refusal(rel)
      : `Blocked for ${agent}: ${rel} is protected for this role (separation of duties, RG-03). ` +
          `If this file really must change, stop and explain why in your handoff.`,
  );
}
if (allow.length && !matchesAny(rel, allow)) {
  block(
    `Blocked for ${agent}: this role may only change ${allow.join(', ')}. ${rel} is outside that.`,
  );
}
process.exit(0);
