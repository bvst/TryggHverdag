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
import { MUTATION_GROUPS, MUTATION_INPUTS } from './lib/gate-decisions.mjs';

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
  const match = /grep -qE '(?<pattern>\^[^']+\$)'/.exec(WORKFLOW);
  if (match?.groups?.pattern === undefined) {
    throw new Error('Could not find the verdict pattern in ai-review.yml.');
  }
  return new RegExp(match.groups.pattern);
}

/**
 * The verdicts the schema allows, read out of the workflow's --json-schema.
 *
 * The enum is now the first line of defence rather than the prose in a brief.
 * `code-reviewer` returned `VERDICT: APPROVE WITH COMMENTS` on #8 although its
 * own brief named `VERDICT: PASS WITH COMMENTS` as a form that would be
 * rejected — warned by name, and it produced the variant anyway. An enum does
 * not leave the choice open, so this test reads it rather than the prose.
 */
function acceptedVerdicts() {
  const match = /"verdict":\{"type":"string","enum":\[(?<enum>[^\]]+)\]\}/.exec(WORKFLOW);
  if (match?.groups?.enum === undefined) {
    throw new Error('Could not find the verdict enum in ai-review.yml.');
  }
  return match.groups.enum.split(',').map((value) => value.trim().replace(/"/g, ''));
}

const names = AGENTS.map((a) => a.name);
const agentNamed = (name) => AGENTS.find((a) => a.name === name);

describe('the verdict line the reviewers must produce', () => {
  test(
    'the schema allows exactly the two verdicts, and no middle one',
    explained(() => {
      expect(acceptedVerdicts()).toEqual(['PASS', 'BLOCK']);
    }),
  );

  test(
    'the enforced pattern accepts both verdicts and rejects the near-misses',
    explained(() => {
      // The old test only checked that the pattern mentioned VERDICT, so every
      // form that actually broke this gate would have passed it. These are the
      // real ones, from the run logs: an invented middle verdict (#8,
      // code-reviewer), the form its brief named (D-069), wrong case, and the
      // empty string jq yields when the field is missing altogether.
      const pattern = enforcedPattern();

      for (const verdict of acceptedVerdicts()) {
        expect({ verdict, accepted: pattern.test(verdict) }).toMatchObject({ accepted: true });
      }
      for (const wrong of [
        'APPROVE WITH COMMENTS',
        'PASS WITH COMMENTS',
        'Pass',
        'pass',
        'VERDICT: PASS',
        'APPROVE',
        '',
      ]) {
        expect({ wrong, accepted: pattern.test(wrong) }).toMatchObject({ accepted: false });
      }
    }),
  );

  test(
    'no reviewer is asked for a verdict file, and none can write one',
    explained(() => {
      // Both halves of the defect this replaced. The workflow asked the agent
      // to save review-<agent>.md *and* post a comment, in one clause with no
      // ordering; the agent produced the artefact a person would read and
      // dropped the one only a script would, and the gate read only the
      // dropped one. Three reviewers did it on a single commit, two of them
      // blocking. With the verdict coming back through structured output there
      // is nothing to write, so the harness needs no Write tool either.
      expect(WORKFLOW).not.toMatch(/review-\$\{\{ matrix\.agent \}\}\.md/);
      const allowed = /--allowedTools\s+"(?<list>[^"]+)"/.exec(WORKFLOW)?.groups?.list ?? '';
      expect(allowed).toMatch(/\bRead\b/);
      expect(allowed).not.toMatch(/\bWrite\b/);
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
      const accepted = acceptedVerdicts();
      const canonical = (agentNamed(name)?.text.split('\n') ?? [])
        .filter((line) => /^ {4}\S/.test(line) && /verdict:/i.test(line))
        .map((line) => line.trim());

      expect(canonical.length).toBe(2);
      for (const line of canonical) {
        // The brief still names the line the subagent ends its review with —
        // that is how the invoking agent knows which verdict to return. What
        // the gate reads is the structured field, so the two have to agree on
        // the same pair of words, case included.
        const verdict = /^VERDICT: (?<value>.+)$/.exec(line)?.groups?.value;
        expect({ name, line, verdict, known: accepted.includes(verdict) }).toMatchObject({
          known: true,
        });
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

describe("BUG-14: safety-reviewer's brief has something to check in the mutation gate's own files (D-100's amendment)", () => {
  // D-100 and its amendment put the mutation run's own inputs in the safety
  // filter: what builds and judges the runs, the test kit, and the Vitest
  // configurations the groups run under. A change to one now brings
  // safety-reviewer, whose brief named only product safety code, so the
  // review they trigger had nothing to check (D-045). Loose on purpose: the
  // citation and each path, read from the code's own lists as the filter
  // test in gate.test.mjs reads them, and none of the wording around them.
  test(
    "BUG-14: safety-reviewer's brief cites D-100 and names every input of the mutation run, read from MUTATION_INPUTS and every group's config",
    explained(() => {
      const brief = agentNamed('safety-reviewer.md')?.text ?? '';

      expect(brief, 'no safety-reviewer.md with a verdict line in .claude/agents').not.toBe('');
      expect(
        Array.isArray(MUTATION_INPUTS),
        'MUTATION_INPUTS is not exported from scripts/lib/gate-decisions.mjs',
      ).toBe(true);
      const inputs = [
        ...MUTATION_INPUTS,
        ...MUTATION_GROUPS.flatMap((group) => (group.config === undefined ? [] : [group.config])),
      ].map((input) => input.replace(/\/$/, ''));

      expect(inputs.length).toBeGreaterThan(0);
      expect(
        ['D-100', ...inputs].filter((named) => !brief.includes(named)),
        "what safety-reviewer's brief does not name",
      ).toEqual([]);
    }),
  );
});

describe("BUG-18: safety-reviewer's brief has something to check in the database connection and the worker's check-in row (D-105 and its amendment)", () => {
  // D-105 puts apps/server/src/adapters/db.ts in the safety filter: the pools,
  // how many connections each process may hold, and, with LOST-02, the
  // session limits that keep a frozen instance from holding a journey's row
  // lock past the watchdog. Its amendment adds
  // apps/server/src/adapters/worker-heartbeats.ts, the worker's check-in row
  // that /v1/health reads to say whether anything is still watching the
  // journeys. A change to either now brings safety-reviewer, and a brief that
  // does not name it leaves that review nothing to check (D-045), as BUG-14
  // found for D-100's files. Loose on purpose, as the test above: the
  // citation and the paths, none of the wording around them.
  test(
    "BUG-18: safety-reviewer's brief cites D-105 and names apps/server/src/adapters/db.ts and apps/server/src/adapters/worker-heartbeats.ts",
    explained(() => {
      const brief = agentNamed('safety-reviewer.md')?.text ?? '';

      expect(brief, 'no safety-reviewer.md with a verdict line in .claude/agents').not.toBe('');
      expect(
        [
          'D-105',
          'apps/server/src/adapters/db.ts',
          'apps/server/src/adapters/worker-heartbeats.ts',
        ].filter((named) => !brief.includes(named)),
        "what safety-reviewer's brief does not name",
      ).toEqual([]);
    }),
  );
});
