#!/usr/bin/env node
// Per-agent path guard (used in agent frontmatter hooks).
// Usage: guard-paths.mjs --agent <name> [--allow <glob>]... [--deny <glob>]...
import { readInput, relPath, matchesAny, argList, argValue, block } from './lib.mjs';

const input = await readInput();
const file = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
if (!file) process.exit(0);

const rel = relPath(file, input.cwd);
const agent = argValue('--agent', 'this agent');
const allow = argList('--allow');
const deny = argList('--deny');

if (rel.startsWith('..')) block(`Blocked for ${agent}: ${file} is outside the repository.`);
if (deny.length && matchesAny(rel, deny)) {
  block(`Blocked for ${agent}: ${rel} is protected for this role (separation of duties, RG-03). ` +
        `If this file really must change, stop and explain why in your handoff.`);
}
if (allow.length && !matchesAny(rel, allow)) {
  block(`Blocked for ${agent}: this role may only change ${allow.join(', ')}. ${rel} is outside that.`);
}
process.exit(0);
