// req-coverage: fixtures-only — the IDs below name the review agents, not the product.
//
// The verdict line is the one piece of a review that CI reads. Everything else
// a reviewer writes is for a person; this one string decides whether the check
// is green. So the workflow's regex and the five agent definitions have to
// agree about it exactly, and nothing was checking that they did.
//
// They did not. The instruction said "End with exactly one line: `VERDICT:
// PASS` ... followed by your findings" — which tells the reviewer to put the
// findings *after* the verdict, while the gate reads the *last* line. Reviewers
// that read it charitably passed; the ones that took it literally, or wrote
// `Verdict: PASS`, or `**APPROVE**`, were recorded as having produced no
// verdict at all. That happened to safety-reviewer, a blocking reviewer, on a
// review whose verdict was PASS: a passing review turned into a failing check
// by letter case.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const WORKFLOW = readFileSync('.github/workflows/ai-review.yml', 'utf8');
const AGENTS = readdirSync('.claude/agents')
  .filter((name) => name.endsWith('.md'))
  .map((name) => ({ name, text: readFileSync(`.claude/agents/${name}`, 'utf8') }))
  .filter((agent) => agent.text.includes('VERDICT:'));

/** The pattern the workflow actually enforces, read from the workflow itself. */
function enforcedPattern() {
  const match = /grep -qE '(?<pattern>\^[^']*VERDICT[^']*)'/.exec(WORKFLOW);
  if (match?.groups?.pattern === undefined) {
    throw new Error('Could not find the verdict pattern in ai-review.yml.');
  }
  return new RegExp(match.groups.pattern);
}

describe('the verdict line the reviewers must produce', () => {
  test('the workflow still enforces a pattern this test can read', () => {
    expect(enforcedPattern().source).toContain('VERDICT');
  });

  test('there are reviewer definitions to check', () => {
    expect(AGENTS.length).toBeGreaterThanOrEqual(5);
  });

  test.each(AGENTS.map((a) => a.name))('%s spells a verdict the gate accepts', (name) => {
    // Only the indented block — the two strings the reviewer is told to write.
    // The prose around it deliberately quotes the wrong forms (`Verdict: PASS`,
    // `**APPROVE**`) as things the gate rejects, and those must not be mistaken
    // for the instruction itself. Matching case-insensitively is the point:
    // a canonical line in the wrong case is exactly the bug this file exists
    // for, and a scan that only looked for upper case would miss it by passing
    // over the offending line rather than by judging it.
    const agent = AGENTS.find((a) => a.name === name);
    const pattern = enforcedPattern();
    const canonical = (agent?.text.split('\n') ?? [])
      .filter((line) => /^ {4}\S/.test(line) && /verdict:/i.test(line))
      .map((line) => line.trim());

    expect(canonical.length).toBe(2);
    for (const line of canonical) {
      expect({ name, line, accepted: pattern.test(line) }).toMatchObject({ accepted: true });
    }
  });

  test.each(AGENTS.map((a) => a.name))('%s offers both outcomes, not just PASS', (name) => {
    const agent = AGENTS.find((a) => a.name === name);

    expect(agent?.text).toContain('VERDICT: PASS');
    expect(agent?.text).toContain('VERDICT: BLOCK');
  });

  test.each(AGENTS.map((a) => a.name))('%s names the file CI actually reads', (name) => {
    // The other half of the same bug, and the one that cost longer to see.
    // test-auditor posted a pull request comment ending in a perfectly
    // conforming `VERDICT: PASS` and still failed, because the gate does not
    // read the comment — it reads `review-<agent>.md`, and that file was never
    // written. "produced no verdict file" and "did not end with a verdict line"
    // are different failures, and only the second one is about wording.
    const agent = AGENTS.find((a) => a.name === name);
    const expected = `review-${name.replace(/\.md$/, '')}.md`;

    expect(agent?.text).toContain(expected);
  });

  test.each(AGENTS.map((a) => a.name))('%s says the file matters, not just the comment', (name) => {
    const agent = AGENTS.find((a) => a.name === name);

    expect(agent?.text).toMatch(/pull request comment/i);
    expect(agent?.text).toMatch(/what CI reads|the gate reads|CI reads/i);
  });

  test.each(AGENTS.map((a) => a.name))('%s says the verdict goes last, not first', (name) => {
    // The exact contradiction that caused this: "End with ... followed by your
    // findings" put the findings after the verdict, where the gate cannot see
    // it. Any instruction that says something follows the verdict is wrong.
    const agent = AGENTS.find((a) => a.name === name);

    expect(agent?.text).toMatch(/last line/i);
    expect(agent?.text).not.toMatch(/VERDICT[^\n]*\n?[^\n]*followed by your findings/i);
  });
});
