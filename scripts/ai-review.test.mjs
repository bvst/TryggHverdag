// req-coverage: fixtures-only — the IDs below name the review agents, not the product.
//
// The verdict line is the one piece of a review that CI reads. Everything else
// a reviewer writes is for a person; this one string decides whether the check
// is green. So the workflow's pattern and the five agent definitions have to
// agree about it exactly, and nothing was checking that they did.
//
// They did not. The instruction said "End with exactly one line: `VERDICT:
// PASS` ... followed by your findings" — which tells the reviewer to put the
// findings *after* the verdict, while the gate reads the *last* line. Reviewers
// that read it charitably passed; the ones that took it literally, or wrote
// `Verdict: PASS`, or `**APPROVE**`, were recorded as having produced no
// verdict at all. That happened to safety-reviewer, a blocking reviewer, on a
// review whose verdict was PASS: a passing review turned into a failing check
// by letter case. See D-069.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const WORKFLOW = readFileSync('.github/workflows/ai-review.yml', 'utf8');
const AGENTS = readdirSync('.claude/agents')
  .filter((name) => name.endsWith('.md'))
  .map((name) => ({ name, text: readFileSync(`.claude/agents/${name}`, 'utf8') }))
  .filter((agent) => agent.text.includes('VERDICT:'));

/**
 * Whether the definitions on disk are the ones that were committed.
 *
 * They are not, inside an AI reviewer's own sandbox: that harness reverts
 * `.claude/agents/*.md` to their pre-pull-request contents, so a pull request
 * cannot rewrite the instructions of the agent reviewing it. Sound protection —
 * and it makes this file, which reads those very files, fail about twenty
 * assertions for a reason that has nothing to do with the code.
 *
 * `test-auditor` hit exactly that, worked out what it was, and said so. The
 * next reviewer might instead report it as a finding, and a required check now
 * blocks a merge. So the failure explains itself rather than being rediscovered.
 */
function definitionsMatchCommitted() {
  try {
    execFileSync('git', ['diff', '--quiet', 'HEAD', '--', '.claude/agents'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const REVERTED_HINT = definitionsMatchCommitted()
  ? ''
  : '\n\nNOTE: .claude/agents differs from HEAD. If you are an AI reviewer, your ' +
    'harness reverts those files so a pull request cannot rewrite your own ' +
    'instructions — in which case this failure is that, not the code. Check with ' +
    '`git diff HEAD -- .claude/agents` and read the committed copies instead. ' +
    'CI checks out the real tree and does not see this.';

/**
 * Wraps a test body so any failure carries the note above.
 *
 * A wrapper rather than a custom assertion, so that it covers every failure in
 * the file without each one remembering to opt in — the whole point is that it
 * fires when someone is already confused.
 */
const explained =
  (body) =>
  (...args) => {
    try {
      return body(...args);
    } catch (error) {
      if (REVERTED_HINT === '') throw error;
      throw new Error(`${error instanceof Error ? error.message : String(error)}${REVERTED_HINT}`);
    }
  };

/** The pattern the workflow actually enforces, read from the workflow itself. */
function enforcedPattern() {
  const match = /grep -qE '(?<pattern>\^[^']*VERDICT[^']*)'/.exec(WORKFLOW);
  if (match?.groups?.pattern === undefined) {
    throw new Error('Could not find the verdict pattern in ai-review.yml.');
  }
  return new RegExp(match.groups.pattern);
}

const names = AGENTS.map((a) => a.name);
const agentNamed = (name) => AGENTS.find((a) => a.name === name);

describe('the verdict line the reviewers must produce', () => {
  test(
    'the workflow still enforces a pattern this test can read',
    explained(() => {
      expect(enforcedPattern().source).toContain('VERDICT');
    }),
  );

  test(
    'there are reviewer definitions to check',
    explained(() => {
      expect(AGENTS.length).toBeGreaterThanOrEqual(5);
    }),
  );

  test.each(names)(
    '%s spells a verdict the gate accepts',
    explained((name) => {
      // Only the indented block — the two strings the reviewer is told to
      // write. The prose around it deliberately quotes the wrong forms
      // (`Verdict: PASS`, `**APPROVE**`) as things the gate rejects, and those
      // must not be mistaken for the instruction. Matching case-insensitively
      // is the point: a canonical line in the wrong case is the bug this file
      // exists for, and a scan that looked only for upper case would miss it by
      // passing over the offending line rather than by judging it.
      const pattern = enforcedPattern();
      const canonical = (agentNamed(name)?.text.split('\n') ?? [])
        .filter((line) => /^ {4}\S/.test(line) && /verdict:/i.test(line))
        .map((line) => line.trim());

      expect(canonical.length).toBe(2);
      for (const line of canonical) {
        expect({ name, line, accepted: pattern.test(line) }).toMatchObject({ accepted: true });
      }
    }),
  );

  test.each(names)(
    '%s offers both outcomes, not just PASS',
    explained((name) => {
      expect(agentNamed(name)?.text).toContain('VERDICT: PASS');
      expect(agentNamed(name)?.text).toContain('VERDICT: BLOCK');
    }),
  );

  test.each(names)(
    '%s is not told to write the verdict file',
    explained((name) => {
      // Not because it is impossible — `Bash` can write a file, and a reviewer
      // that shelled out would succeed. Because it is the wrong place. Every
      // reviewer's frontmatter grants `Read, Grep, Glob, Bash` and no `Write`,
      // since a reviewer that edits the code it reviews is not an independent
      // one (D-043 calls them read-only), and routing around that with a shell
      // redirect makes the property a formality. The file belongs to the agent
      // that invokes them, which has `Write` and is told to use it.
      expect(agentNamed(name)?.text).not.toMatch(/write it with the Write tool/i);
      expect(agentNamed(name)?.text).not.toMatch(/review-[a-z0-9-]+\.md/i);
    }),
  );

  test.each(names)(
    '%s is read-only, which is why that is the wrong place',
    explained((name) => {
      const tools =
        /^tools:\s*(?<list>.+)$/m.exec(agentNamed(name)?.text ?? '')?.groups?.list ?? '';

      expect(tools).not.toMatch(/\bWrite\b/);
      expect(tools).toMatch(/\bRead\b/);
    }),
  );

  test.each(names)(
    '%s says the verdict goes last, not first',
    explained((name) => {
      // The exact contradiction that caused this: "End with ... followed by
      // your findings" put the findings after the verdict, where the gate
      // cannot see it. Any instruction saying something follows it is wrong.
      expect(agentNamed(name)?.text).toMatch(/last line/i);
      expect(agentNamed(name)?.text).not.toMatch(
        /VERDICT[^\n]*\n?[^\n]*followed by your findings/i,
      );
    }),
  );
});
