#!/usr/bin/env node
/**
 * CI-01: the gates are real.
 *
 * Every other gate in this repository assumes it is allowed to stop a merge.
 * This one checks that assumption, through GitHub's API, and fails loudly when
 * it cannot (D-029). Four questions:
 *
 *   1. Which checks must be required today? (scripts/lib/merge-rules.mjs)
 *   2. Do the workflow files actually produce them, with pinned actions and
 *      scripts that exist? (scripts/lib/workflow-lint.mjs)
 *   3. Does main require exactly those checks, review by a code owner, no force
 *      pushes and no deletion?
 *   4. Can anyone bypass all of that?
 *
 * Question 4 is the one D-029 is about, and it needs a token that can read the
 * repository's settings — see docs/plan/merge-rules.md. Without it this gate
 * fails, because "nobody checked" and "nobody can bypass" are not the same
 * answer.
 *
 * Usage: pnpm run gate:integrity
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { packageScripts, run } from './lib/proc.mjs';
import { planChecks, reviewBypass, reviewCodeowners, reviewRuleset } from './lib/merge-rules.mjs';
import { reviewWorkflows } from './lib/workflow-lint.mjs';

const BRANCH = 'main';
const WORKFLOWS = '.github/workflows';
const API = 'https://api.github.com';

/** Which repository this is, without guessing. */
export function repoSlug({ env, remoteUrl }) {
  const fromEnv = /^(?<owner>[\w.-]+)\/(?<repo>[\w.-]+)$/.exec(env.GITHUB_REPOSITORY ?? '');
  if (fromEnv?.groups !== undefined) {
    return { owner: fromEnv.groups.owner, repo: fromEnv.groups.repo };
  }
  const fromRemote = /github\.com[:/](?<owner>[\w.-]+)\/(?<repo>[\w.-]+?)(?:\.git)?$/.exec(
    remoteUrl ?? '',
  );
  if (fromRemote?.groups !== undefined) {
    return { owner: fromRemote.groups.owner, repo: fromRemote.groups.repo };
  }
  return null;
}

/**
 * What a person sees. Sections that passed stay visible: the difference between
 * "checked, and it is fine" and "not checked" is the whole point of this gate.
 *
 * @param {{title: string, problems: {what: string, fix: string}[], notes?: string[]}[]} sections
 */
export function renderReport(sections) {
  const lines = ['', 'gate:integrity — CI-01: are the gates real?', ''];
  let passed = 0;

  for (const section of sections) {
    const problems = section.problems;
    if (problems.length === 0) {
      passed += 1;
      lines.push(`✓ ${section.title}`);
    } else {
      lines.push(`✗ ${section.title}`);
    }
    for (const problem of problems) {
      lines.push(`    · ${problem.what}`, `      → ${problem.fix}`);
    }
    for (const note of section.notes ?? []) {
      lines.push(`    · ${note}`);
    }
  }

  lines.push(
    '',
    `gate:integrity: ${String(passed)} of ${String(sections.length)} checks passed.`,
    '',
  );
  return { text: lines.join('\n'), ok: passed === sections.length };
}

function readOrNull(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function workflowFiles(cwd) {
  const directory = path.join(cwd, WORKFLOWS);
  let names;
  try {
    names = readdirSync(directory).filter((name) => /\.ya?ml$/.test(name));
  } catch {
    return [];
  }
  return names
    .map((name) => ({ path: `${WORKFLOWS}/${name}`, text: readOrNull(path.join(directory, name)) }))
    .filter((file) => file.text !== null);
}

/**
 * One GitHub API call. Anything other than a clean 200 means "unknown", not
 * "fine" — and the status comes back with it, so that a token GitHub rejected
 * can be told apart from a token nobody added.
 *
 * @returns {Promise<{ body: unknown | null, status: number | null }>}
 */
async function api(url, token) {
  if (token === undefined || token === '') {
    return { body: null, status: null };
  }
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
    return { body: response.ok ? await response.json() : null, status: response.status };
  } catch {
    return { body: null, status: null };
  }
}

/**
 * The distinct rulesets covering the branch. Every rule carries the id of the
 * ruleset it came from, and more than one ruleset can cover a branch — reading
 * only the first would print a tick over a bypass entry sitting in the second.
 *
 * @param {{ruleset_id?: number}[] | null} branchRules
 */
export function rulesetIdsOf(branchRules) {
  return [
    ...new Set((branchRules ?? []).map((rule) => rule.ruleset_id).filter((id) => id !== undefined)),
  ];
}

/**
 * What several ruleset reads add up to. One unreadable answer makes the whole
 * thing unknown: reporting the ones that were readable as "nobody can bypass"
 * would be a tick over a ruleset nobody saw.
 *
 * @param {{body: unknown | null, status: number | null}[]} answers
 */
export function combineRulesetAnswers(answers) {
  const status = answers.find((a) => a.status !== null && a.status !== 200)?.status ?? null;
  const readable = answers.length > 0 && answers.every((a) => a.body !== null);
  return { rulesets: readable ? answers.map((a) => a.body) : null, status };
}

/**
 * The report's sections, from everything that was read. Kept pure and separate
 * from the reading, because the difference between "read it, and there is
 * nothing" and "could not read it" lives in here — and that difference is what
 * the whole gate turns on.
 *
 * @param {{
 *   plan: ReturnType<typeof planChecks>,
 *   workflowProblems: {what: string, fix: string}[],
 *   codeownersText: string | null,
 *   slug: {owner: string, repo: string} | null,
 *   branchRules: {type: string}[] | null,
 *   rulesets: object[] | null,
 *   rulesetStatus?: number | null,
 * }} state
 */
export function sectionsFor({
  plan,
  workflowProblems,
  codeownersText,
  slug,
  branchRules,
  rulesets,
  rulesetStatus = null,
}) {
  const sections = [
    {
      title: `the checks that must be required today (${String(plan.required.length)})`,
      problems: [],
      notes: [
        ...plan.required.map((check) => `${check} — required today`),
        ...plan.waiting.map((w) => `${w.check} — ${w.reason}, so it is not required yet`),
        ...plan.advisory.map((check) => `${check} — advisory, never required (D-043)`),
      ],
    },
    {
      title: 'the workflow files produce them, with pinned actions',
      problems: workflowProblems,
    },
    {
      title: 'CODEOWNERS covers every path that needs the owner (D-042)',
      problems: reviewCodeowners(codeownersText),
    },
  ];

  if (slug === null) {
    sections.push({
      title: "main's merge rules",
      problems: [
        {
          what: 'Could not tell which GitHub repository this is, so the merge rules were not checked.',
          fix: 'Run this in CI, or from a clone whose origin is the GitHub repository.',
        },
      ],
    });
    return sections;
  }

  sections.push(
    {
      title: `${BRANCH} requires review, the checks, and no rewriting of history`,
      problems: reviewRuleset({ branchRules, required: plan.required }),
    },
    {
      title: 'nobody can bypass those rules (D-029)',
      // null means the rules could not be read, which is not the same as having
      // read them and found none. Only an answer we actually got can say a
      // ruleset is missing.
      problems: reviewBypass({
        rulesets,
        rulesExist: branchRules === null || branchRules.length > 0,
        status: rulesetStatus,
      }),
    },
  );
  return sections;
}

async function main() {
  const cwd = process.cwd();
  const env = process.env;
  const remote = run('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 20_000 });
  const slug = repoSlug({ env, remoteUrl: remote.ok ? remote.output.trim() : null });
  const scripts = packageScripts(cwd);
  const plan = planChecks(scripts);

  let branchRules = null;
  let rulesets = null;
  let rulesetStatus = null;
  if (slug !== null) {
    const base = `${API}/repos/${slug.owner}/${slug.repo}`;
    // The branch's own rules are readable with ordinary repository access, so
    // GITHUB_TOKEN is enough. Who may bypass them is a repository setting, and
    // needs a token that can read those — deliberately a different, narrower
    // secret than the one Claude's account uses to open pull requests.
    branchRules = (await api(`${base}/rules/branches/${BRANCH}`, env.GITHUB_TOKEN)).body;

    // Every rule carries the id of the ruleset it came from, and more than one
    // ruleset can cover a branch. All of them, or the answer is worthless.
    // A ruleset owned by an organisation lives at /orgs/{org}/rulesets/{id}, so
    // this call 404s for it — which surfaces as "could not be checked", not as
    // a pass. Worth revisiting if the repository moves to an AS (D-029).
    const ids = [
      ...new Set(
        (branchRules ?? []).map((rule) => rule.ruleset_id).filter((id) => id !== undefined),
      ),
    ];
    if (ids.length > 0) {
      const answers = await Promise.all(
        ids.map((id) => api(`${base}/rulesets/${String(id)}`, env.RULES_READ_TOKEN)),
      );
      rulesetStatus = answers.find((a) => a.status !== null && a.status !== 200)?.status ?? null;
      rulesets = answers.every((a) => a.body !== null) ? answers.map((a) => a.body) : null;
    }
  }

  const report = renderReport(
    sectionsFor({
      plan,
      workflowProblems: reviewWorkflows({
        files: workflowFiles(cwd),
        scripts,
        required: plan.required,
      }),
      codeownersText: readOrNull(path.join(cwd, '.github/CODEOWNERS')),
      slug,
      branchRules,
      rulesets,
      rulesetStatus,
    }),
  );
  process.stdout.write(report.text);
  if (!report.ok) {
    process.exitCode = 1;
  }
}

if (import.meta.filename === process.argv[1]) {
  await main();
}
