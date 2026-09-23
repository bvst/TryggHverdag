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
  : '\n\nNOTE: .claude/agents on disk differs from HEAD, so this test read ' +
    'something other than the committed definitions. `git diff HEAD -- ' +
    '.claude/agents` shows what differs. Draw your own conclusion from it.';

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
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}${REVERTED_HINT}`, { cause: error });
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
    '%s is not told to write the verdict file itself',
    explained((name) => {
      // This file asserted the opposite for one commit. `test-auditor` blocked
      // it, for two reasons that both hold.
      //
      // The governance one: a pull request that edits the instructions of the
      // agent reviewing it, to make that agent write files, is indistinguishable
      // in form from a prompt-injection attempt — whatever the author intended.
      // The read-only boundary is owner-accepted (D-043) and is not Claude's to
      // adjust under D-031, which delegates library and tool choices only.
      //
      // The mechanical one: it could not have worked. Each reviewer's
      // frontmatter runs `guard-bash.mjs --agent <name> --readonly` on Bash,
      // and that hook blocks every output redirection. The instruction was
      // shipped without being exercised end to end.
      expect(agentNamed(name)?.text).not.toMatch(/review-[a-z0-9-]+\.md/i);
      expect(agentNamed(name)?.text).not.toMatch(/heredoc/i);
    }),
  );

  test.each(names)(
    '%s keeps the read-only tool grant the owner decided on',
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
