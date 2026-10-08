// BUG-38: four reviewers kept a memory file Claude Code never loads.
//
// For an agent with `memory: project`, Claude Code loads one file at the start
// of its run: .claude/agent-memory/<agent>/MEMORY.md, its first 200 lines or
// 25 KB (code.claude.com/docs/en/sub-agents#enable-persistent-memory). The
// other files in that folder are read only when MEMORY.md points at them.
// .claude/agent-memory/{code-reviewer,privacy-security-reviewer,
// safety-reviewer,test-auditor}.md sat beside those folders, so what was
// written there was never loaded. A lesson saved where it is never read looks
// like memory and is not, which is the silent kind of failure.
//
// These read the folder's layout, not its prose.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const MEMORY = path.join(ROOT, '.claude', 'agent-memory');
const AGENTS = path.join(ROOT, '.claude', 'agents');

/** Claude Code's limits on what it loads of MEMORY.md. 25 KB read as 25,000 bytes, the stricter reading. */
const MAX_LINES = 200;
const MAX_BYTES = 25_000;

const entries = readdirSync(MEMORY, { withFileTypes: true });
const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

/** The value of a top-level key in an agent's frontmatter, quotes removed, or undefined. */
function frontmatterValue(text, key) {
  const lines = text.split('\n');
  if (lines[0]?.trim() !== '---') return undefined;
  const end = lines.findIndex((line, at) => at > 0 && line.trim() === '---');
  const front = end === -1 ? [] : lines.slice(1, end);
  const value = front
    .map((line) => new RegExp(`^${key}:\\s*(?<value>.*?)\\s*$`).exec(line)?.groups?.value)
    .find((found) => found !== undefined);
  return value?.replace(/^(["'])(?<inner>.*)\1$/, '$<inner>');
}

/** The agents whose frontmatter says `memory: project`. */
const projectMemoryAgents = readdirSync(AGENTS)
  .filter((name) => name.endsWith('.md'))
  .filter(
    (name) =>
      frontmatterValue(readFileSync(path.join(AGENTS, name), 'utf8'), 'memory') === 'project',
  )
  .map((name) => name.replace(/\.md$/, ''));

/** The number of lines in `text`, a final newline not counting as one more. */
const lineCount = (text) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

describe('BUG-38: .claude/agent-memory/ holds only what Claude Code loads', () => {
  test('BUG-38: .claude/agent-memory/ holds README.md and one folder per agent, and no other file', () => {
    const files = entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);

    expect(
      files.filter((name) => name !== 'README.md'),
      'files beside the folders, which Claude Code never loads',
    ).toEqual([]);
    expect(files).toContain('README.md');
  });

  test('BUG-38: every folder belongs to an agent in .claude/agents/ with memory: project', () => {
    // Passes today, on purpose. It holds that moving the flat files into
    // folders does not make a folder for an agent that does not exist, or
    // for one whose memory Claude Code would not load.
    expect(projectMemoryAgents.length).toBeGreaterThan(0);
    expect(
      folders.filter((folder) => !projectMemoryAgents.includes(folder)),
      `folders with no agent with memory: project; those agents are ${projectMemoryAgents.join(', ')}`,
    ).toEqual([]);
  });

  test.each(folders)(
    'BUG-38: %s/MEMORY.md exists and fits in what Claude Code loads: 200 lines and 25 KB',
    (folder) => {
      // Passes today, on purpose. Merging a flat file into MEMORY.md is how
      // a fix could push it past the limit, and what lies past it is not
      // loaded either.
      const file = path.join(MEMORY, folder, 'MEMORY.md');

      expect(existsSync(file), `${folder} has no MEMORY.md`).toBe(true);
      const text = readFileSync(file, 'utf8');
      expect({ folder, lines: lineCount(text) <= MAX_LINES }).toEqual({ folder, lines: true });
      expect({ folder, bytes: statSync(file).size <= MAX_BYTES }).toEqual({ folder, bytes: true });
    },
  );

  test.each(folders)(
    'BUG-38: every link in %s/MEMORY.md points at a file in that folder',
    (folder) => {
      // Passes today, on purpose. A link to a file that is not there is the
      // same failure in a smaller place: a note that looks saved and is never
      // read.
      const file = path.join(MEMORY, folder, 'MEMORY.md');
      const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
      // Links to the web, or to a heading, name no file, so they are left out.
      const targets = [...text.matchAll(/\]\((?<target>[^)\s]+)\)/g)]
        .map((match) => match.groups?.target ?? '')
        .filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('#'));
      const broken = targets.filter(
        (target) => target.includes('/') || !existsSync(path.join(MEMORY, folder, target)),
      );

      expect(broken, `links in ${folder}/MEMORY.md that point at no file beside it`).toEqual([]);
    },
  );
});
