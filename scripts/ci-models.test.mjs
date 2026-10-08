// BUG-30 and BUG-31: what the two workflows that run Claude in CI tell it.
//
// BUG-30, D-118. CI never named a model, so which one ran was left to the
// Claude Code version the pinned claude-code-action installs, 2.1.283. The
// evidence D-118 cites is job 112942356368, whose log shows
// `"model": "claude-sonnet-5"`: Sonnet 5, not what D-118 wants. D-118:
// "CI names its model by full ID: `ai-review.yml` passes `--model
// claude-opus-5-5`, so the reviewers that inherit get Opus 5.5 in CI too;
// `daily-status.yml` passes `--model claude-sonnet-5-5`. A full ID, not an
// alias, because CI's alias is resolved by the Claude Code version the pinned
// action installs (2.1.283), in which `sonnet` is still Sonnet 5." So the
// tests below take the flag as written, the full ID and only that: an alias,
// a second `--model`, or the `--model=` form are each a different thing from
// what D-118 decided, and each fails.
//
// BUG-31, D-119. "In CI's review jobs, the stop gate and the progress gate
// stand down. ai-review.yml sets `TRYGGHVERDAG_REVIEW_JOB=1` on the review
// step, and both hooks exit at once when that is set together with
// `GITHUB_ACTIONS=true`." A variable that switches gates off is worth exactly
// as much as the narrowness of where it is set. privacy-security-reviewer
// asked for it in the `env:` of the claude-code-action step only — not the
// job's, not the workflow's — and for a test that nothing else sets it. That
// is the third test: the one line, and no other line in any workflow.
//
// D-075: a pull request that changes ai-review.yml cannot be reviewed by the AI
// reviewers, so the owner merges it by hand and these tests are its only
// automated check.
//
// Test names carry no <ID>-ACn: prefix: a bug's tests are named BUG-<n>, and
// BUG- is not a requirement prefix req:coverage collects.
//
// Read as text, like the rest of scripts/: the repository keeps no YAML parser.
// The reading below is small but structural — a step is found by its own `id:`,
// and an `env:` or `claude_args:` is read only where it is that step's own key,
// so the same words in a prompt, a comment or another step do not count.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const WORKFLOWS = path.join(import.meta.dirname, '..', '.github', 'workflows');
const read = (name) => readFileSync(path.join(WORKFLOWS, name), 'utf8');

const ACTION = 'anthropics/claude-code-action@';

const indentOf = (line) => line.length - line.trimStart().length;
const isBlank = (line) => line.trim() === '';
const isComment = (line) => line.trimStart().startsWith('#');

/**
 * A scalar as written on its key's line, without a trailing comment: a quoted
 * one up to its closing quote, quotes kept; anything else up to ` #`.
 */
function scalar(raw) {
  const text = (raw ?? '').trim();
  const quoted = /^(?<quote>['"])(?<inner>.*?)\k<quote>/.exec(text);
  if (quoted !== null) {
    return quoted[0];
  }
  return text.replace(/\s+#.*$/, '').trim();
}

/**
 * Every item of every `steps:` list in a workflow: its lines, each with its
 * 1-based line number, and the column its own keys sit at. The `- ` that opens
 * an item is replaced by spaces, so its first key lines up with the rest.
 */
function steps(text) {
  const lines = text.split('\n');
  const found = [];
  lines.forEach((line, index) => {
    const header = /^(?<indent> *)steps:\s*(?:#.*)?$/.exec(line);
    if (header?.groups === undefined) {
      return;
    }
    let dash = -1;
    let current = null;
    for (let at = index + 1; at < lines.length; at += 1) {
      const row = lines[at] ?? '';
      if (isBlank(row) || isComment(row)) {
        current?.lines.push({ text: row, number: at + 1 });
        continue;
      }
      const indent = indentOf(row);
      const opens = row.trimStart().startsWith('- ');
      if (dash === -1) {
        if (!opens || indent < header.groups.indent.length) {
          break;
        }
        dash = indent;
      }
      if (indent < dash || (indent === dash && !opens)) {
        break;
      }
      if (indent === dash) {
        current = { keyIndent: dash + 2, lines: [] };
        found.push(current);
        current.lines.push({ text: row.replace(/^( *)- /, '$1  '), number: at + 1 });
        continue;
      }
      current?.lines.push({ text: row, number: at + 1 });
    }
  });
  return found.map((step) => ({ ...step, keys: keysOf(step) }));
}

/**
 * A step's own keys — `id`, `uses`, `env`, `with` and the rest — each with the
 * value on its line and the lines of its body. A line at the key column that
 * is a comment is a comment; anything deeper belongs to the key above it,
 * comment-like or not, because inside a block scalar a `#` is text.
 */
function keysOf(step) {
  const keys = [];
  let current = null;
  for (const line of step.lines) {
    const indent = indentOf(line.text);
    if (!isBlank(line.text) && indent <= step.keyIndent && isComment(line.text)) {
      continue;
    }
    const key =
      indent === step.keyIndent
        ? /^ *(?<name>[\w-]+):(?:\s+(?<inline>.*))?$/.exec(line.text)
        : null;
    if (key?.groups !== undefined) {
      current = {
        name: key.groups.name,
        inline: key.groups.inline ?? '',
        number: line.number,
        body: [],
      };
      keys.push(current);
      continue;
    }
    current?.body.push(line);
  }
  return keys;
}

/** The value of a step's own key, as a scalar; undefined when the step has none. */
function own(step, name) {
  const key = step.keys.find((k) => k.name === name);
  return key === undefined ? undefined : scalar(key.inline);
}

/**
 * The entries of a mapping a key holds, block or flow style: each with its
 * name, its value as written, its line number and any lines that continue it
 * (a block scalar's, for one). Comments between entries are left out.
 */
function entries(key) {
  if (key === undefined) {
    return [];
  }
  const inline = scalar(key.inline);
  if (inline.startsWith('{')) {
    return inline
      .replace(/^\{|\}$/g, '')
      .split(',')
      .map((pair) => /^\s*(?<name>[^:\s]+)\s*:\s*(?<value>.*?)\s*$/.exec(pair)?.groups)
      .filter((pair) => pair !== undefined)
      .map(({ name, value }) => ({ name, value, number: key.number, continuation: [] }));
  }
  const first = key.body.find((line) => !isBlank(line.text) && !isComment(line.text));
  if (first === undefined) {
    return [];
  }
  const column = indentOf(first.text);
  const found = [];
  let current = null;
  for (const line of key.body) {
    const indent = indentOf(line.text);
    if (!isBlank(line.text) && indent === column && !isComment(line.text)) {
      const entry = /^ *(?<name>[^:\s]+):(?:\s+(?<value>.*))?$/.exec(line.text)?.groups;
      current =
        entry === undefined
          ? null
          : { name: entry.name, value: scalar(entry.value), number: line.number, continuation: [] };
      if (current !== null) {
        found.push(current);
      }
      continue;
    }
    if (current !== null && (isBlank(line.text) || indent > column)) {
      current.continuation.push(line.text);
    }
  }
  return found;
}

/**
 * A step's `with: claude_args:`, as one line of words: a block scalar's lines
 * (`>-`, `|` and their kin) or a plain scalar's continuation lines, joined by
 * spaces — which is how a folded scalar reads, and how a list of arguments
 * reads whichever way it was folded. Undefined when the step passes none.
 */
function claudeArgs(step) {
  const arg = entries(step.keys.find((k) => k.name === 'with')).find(
    (entry) => entry.name === 'claude_args',
  );
  if (arg === undefined) {
    return undefined;
  }
  const block = /^[>|][+-]?\d*$/.test(arg.value);
  return [block ? '' : arg.value, ...arg.continuation]
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ');
}

/**
 * Every `--model` among the arguments, as written: `--model <next word>` or a
 * `--model=…` word. All of them, so a second flag that would overrule the
 * first is seen rather than passed over.
 */
function modelFlags(args) {
  const words = args.split(/\s+/).filter((word) => word !== '');
  return words.flatMap((word, index) => {
    if (word === '--model') {
      return [`--model ${words[index + 1] ?? ''}`.trimEnd()];
    }
    return word.startsWith('--model') ? [word] : [];
  });
}

/**
 * Words in the arguments that start with `#`. Whether the action reads one as
 * a shell comment, dropping every word after it, was not verified against the
 * pinned version — so either reading could hide a flag, or show one that the
 * CLI never receives, and the model tests below refuse both by refusing these.
 */
function commentWords(args) {
  return args.split(/\s+/).filter((word) => word.startsWith('#'));
}

/** The workflow's claude-code-action steps, with what each passes as `--model`. */
function modelsNamed(name) {
  return steps(read(name))
    .filter((step) => (own(step, 'uses') ?? '').startsWith(ACTION))
    .map((step) => {
      const args = claudeArgs(step);
      return {
        id: own(step, 'id'),
        model: args === undefined ? 'no claude_args at all' : modelFlags(args),
        commented: args === undefined ? [] : commentWords(args),
      };
    });
}

describe('which model CI asks for (D-118)', () => {
  test('BUG-30: the AI reviews in CI name their model in full, claude-opus-5-5', () => {
    const found = modelsNamed('ai-review.yml');

    expect(
      found.map((step) => step.id),
      'the claude-code-action steps in ai-review.yml, by id',
    ).toContain('review');
    expect(
      found.map(({ id, model }) => ({ id, model })),
      'every claude-code-action step in ai-review.yml passes `--model claude-opus-5-5` in its claude_args, once, and no other --model',
    ).toEqual(found.map(({ id }) => ({ id, model: ['--model claude-opus-5-5'] })));
    expect(
      found.flatMap((step) => step.commented),
      'words in claude_args that start with `#`, which could hide a --model or show one the CLI never gets',
    ).toEqual([]);
  });

  test('BUG-30: the daily report names its model in full, claude-sonnet-5-5', () => {
    const found = modelsNamed('daily-status.yml');

    expect(
      found.map((step) => step.id),
      'the claude-code-action steps in daily-status.yml, by id',
    ).toContain('status');
    expect(
      found.map(({ id, model }) => ({ id, model })),
      'every claude-code-action step in daily-status.yml passes `--model claude-sonnet-5-5` in its claude_args, once, and no other --model',
    ).toEqual(found.map(({ id }) => ({ id, model: ['--model claude-sonnet-5-5'] })));
    expect(
      found.flatMap((step) => step.commented),
      'words in claude_args that start with `#`, which could hide a --model or show one the CLI never gets',
    ).toEqual([]);
  });
});

describe('where CI marks a review job (D-119)', () => {
  const NAME = 'TRYGGHVERDAG_REVIEW_JOB';

  test('BUG-31: the review step, and only the review step, marks itself as a review job', () => {
    const review = steps(read('ai-review.yml')).filter((step) => own(step, 'id') === 'review');

    expect(review.length, 'steps in ai-review.yml with `id: review`').toBe(1);
    const [step] = review;
    expect(own(step, 'uses'), 'what the `id: review` step runs').toMatch(
      /^anthropics\/claude-code-action@/,
    );

    // Its own `env:`, at the step's key column — not the job's, not the
    // workflow's, and not words inside `with:`.
    const set = entries(step.keys.find((k) => k.name === 'env')).filter((e) => e.name === NAME);
    expect(
      set.map((entry) => entry.value),
      `${NAME} in the env: of the \`id: review\` step, quoted '1' or "1"`,
    ).toHaveLength(1);
    expect(["'1'", '"1"'], `the value ${NAME} is given in the review step's env:`).toContain(
      set[0]?.value,
    );

    // And nowhere else: no job- or workflow-level env, no other step, no other
    // workflow, no `>> "$GITHUB_ENV"` in a script. Every line that is not a
    // comment and names it, whatever the case — a runner on Windows reads
    // environment names without case — other than the one line above.
    const workflows = readdirSync(WORKFLOWS)
      .filter((name) => /\.ya?ml$/.test(name))
      .sort();
    expect(workflows, 'the workflows this reads').toEqual(
      expect.arrayContaining(['ai-review.yml', 'ci.yml', 'daily-status.yml']),
    );
    const elsewhere = workflows.flatMap((name) =>
      read(name)
        .split('\n')
        .map((line, index) => ({ name, number: index + 1, line }))
        .filter(({ line }) => !isComment(line) && new RegExp(NAME, 'i').test(line))
        .filter(
          ({ name: file, number }) => !(file === 'ai-review.yml' && number === set[0]?.number),
        )
        .map(({ name: file, number, line }) => `${file}:${number}: ${line.trim()}`),
    );
    expect(elsewhere, `lines outside the review step's env: that name ${NAME}`).toEqual([]);
  });
});
