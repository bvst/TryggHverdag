// CI-01, second half: the workflow files are what they claim to be.
//
// Three things can make a green tick mean nothing, and none of them shows up as
// a failure:
//
//   1. An action referenced by tag. `actions/checkout@v6` is whatever that tag
//      points at today; whoever can move the tag can run code in a job that
//      holds this repository's secrets. A 40-character commit is a fact.
//   2. A job that runs `pnpm run test:system` when no such script exists. That
//      fails with "command not found", which reads like a broken runner rather
//      than a check that was never written.
//   3. A check the merge rules require that no job produces — so the rule waits
//      forever — or a job that runs but that no rule requires, which is work
//      nobody has to pay attention to.
//
// Reading YAML line by line is enough for all three and keeps the gate free of
// a parser dependency. The shapes it has to read are in .github/workflows —
// and, for findUngroupedEcosystems below, .github/dependabot.yml, which is the
// same concern one file over: what .github claims about itself.

const USES = /^\s*-?\s*uses:\s*(?<ref>\S+)/;
const PNPM_RUN = /\bpnpm run (?<script>[\w:@.-]+)/g;
const JOB_ID = /^ {2}(?<id>[A-Za-z_][\w-]*):\s*(?:#.*)?$/;
const FULL_SHA = /@[0-9a-f]{40}$/;
// Four spaces is what makes this unambiguous. A job's own keys sit at four; a
// step's sit at eight or deeper, under `      - `. Matching loosely would read
// a single slow step's bound as the whole job's.
const JOB_TIMEOUT = /^ {4}timeout-minutes:\s*\d+/;

const isComment = (line) => line.trimStart().startsWith('#');

/**
 * Every `uses:` in a workflow, and whether it is pinned to a commit.
 *
 * An action inside this repository (`./...`) has nothing to pin: it is this
 * repository's own code, reviewed like the rest of it.
 *
 * @param {string} text
 */
export function findActionUses(text) {
  const found = [];
  text.split('\n').forEach((line, index) => {
    if (isComment(line)) {
      return;
    }
    const match = USES.exec(line);
    if (match?.groups === undefined) {
      return;
    }
    const ref = match.groups.ref;
    found.push({ line: index + 1, ref, pinned: ref.startsWith('./') || FULL_SHA.test(ref) });
  });
  return found;
}

/**
 * The repository scripts a workflow calls, in the order they first appear.
 *
 * @param {string} text
 */
export function findPnpmScripts(text) {
  const found = [];
  for (const line of text.split('\n')) {
    if (isComment(line)) {
      continue;
    }
    for (const match of line.matchAll(PNPM_RUN)) {
      const script = match.groups?.script;
      if (script !== undefined && !found.includes(script)) {
        found.push(script);
      }
    }
  }
  return found;
}

/**
 * The job identifiers of a workflow: the keys two spaces in, after `jobs:`.
 *
 * @param {string} text
 */
export function findJobIds(text) {
  const ids = [];
  let inJobs = false;
  for (const line of text.split('\n')) {
    if (isComment(line)) {
      continue;
    }
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) {
      continue;
    }
    if (/^\S/.test(line)) {
      inJobs = false;
      continue;
    }
    const match = JOB_ID.exec(line);
    if (match?.groups !== undefined) {
      ids.push(match.groups.id);
    }
  }
  return ids;
}

/**
 * The jobs in this workflow that no timeout bounds.
 *
 * A job without `timeout-minutes` inherits GitHub's six-hour default, which is
 * not so much a bound as most of a day of a runner spent on something that
 * stopped making progress. The shape of that failure is the real cost: a stuck
 * job is indistinguishable from a working one, so nobody looks until a pull
 * request has been "still running" all afternoon — and a gate people wait on
 * without trusting is the failure mode this repository keeps paying for.
 *
 * `ai-review` is the sharpest case, because it hands control to a language
 * model, where "thinking" and "hung" genuinely look alike from outside.
 * `mutation` is next: Stryker legitimately runs long, so a hang there is the
 * most believable, and therefore the least likely to be investigated.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function findUnboundedJobs(text) {
  const unbounded = [];
  let inJobs = false;
  let current = null;
  const close = () => {
    if (current !== null && !current.bounded) {
      unbounded.push(current.id);
    }
    current = null;
  };

  for (const line of text.split('\n')) {
    if (isComment(line)) {
      continue;
    }
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) {
      continue;
    }
    if (/^\S/.test(line)) {
      close();
      inJobs = false;
      continue;
    }
    const match = JOB_ID.exec(line);
    if (match?.groups !== undefined) {
      close();
      current = { id: match.groups.id, bounded: false };
      continue;
    }
    if (current !== null && JOB_TIMEOUT.test(line)) {
      current.bounded = true;
    }
  }
  close();
  return unbounded;
}

/**
 * Ecosystems in `.github/dependabot.yml` whose non-major updates are not grouped.
 *
 * Covered means **one single group** takes every package and both `minor` and
 * `patch`, and does *not* take `major`. All four are read per group: tracking
 * them per ecosystem let a majors group and an `eslint*` group add up to a
 * false pass, which is the failure this exists to catch. Why it matters, and
 * what the grouping costs, is in docs/progress.md.
 *
 * Known limits, both of which fail loud rather than silent — an over-strict red
 * gate, never a missed ecosystem: flow style (`patterns: ["*"]` on one line) is
 * not read, and `exclude-patterns` is not accounted for, so a group narrowed
 * that way would still read as covering everything.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function findUngroupedEcosystems(text) {
  const ungrouped = [];
  let current = null;
  let inGroups = false;
  let group = null;

  const close = () => {
    if (current !== null && !current.groups.some((g) => g.all && g.minor && g.patch && !g.major)) {
      ungrouped.push(current.name);
    }
    current = null;
    inGroups = false;
    group = null;
  };

  for (const line of text.split('\n')) {
    if (isComment(line)) {
      continue;
    }
    const start = /^\s*-\s*package-ecosystem:\s*(?<name>\S+)/.exec(line);
    if (start?.groups !== undefined) {
      close();
      current = { name: start.groups.name, groups: [] };
      continue;
    }
    if (current === null) {
      continue;
    }
    if (/^ {4}groups:/.test(line)) {
      inGroups = true;
      group = null;
      continue;
    }
    // Any other key at ecosystem depth ends the groups block. `commit-message:`
    // puts `prefix:` at exactly the depth a group name sits at, so without this
    // the real group would be silently split in two.
    if (/^ {4}\S/.test(line)) {
      inGroups = false;
      group = null;
      continue;
    }
    if (inGroups && /^ {6}\S[^:]*:\s*$/.test(line)) {
      group = { all: false, minor: false, patch: false, major: false };
      current.groups.push(group);
      continue;
    }
    if (group === null) {
      continue;
    }
    // Quoting is the author's taste, not a difference in meaning, so every
    // scalar here tolerates it. Accepting it for `'*'` alone was an
    // inconsistency that would have read a quoted `- 'minor'` as absent.
    const item = /^\s*-\s*['"]?(?<value>\*|minor|patch|major)['"]?\s*$/.exec(line);
    if (item?.groups !== undefined) {
      const key = { '*': 'all', minor: 'minor', patch: 'patch', major: 'major' }[item.groups.value];
      group[key] = true;
    }
  }
  close();
  return ungrouped;
}

/**
 * A job's own lines, comment lines dropped, or null when the workflow has no
 * job with that id.
 *
 * @param {string} text
 * @param {string} id
 */
function jobLines(text, id) {
  const lines = text.split('\n');
  // Under `jobs:` only: `  group:` under `concurrency:` is not a job.
  const jobs = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  const start = lines.findIndex(
    (line, index) => index > jobs && (line === `  ${id}:` || line.startsWith(`  ${id}: `)),
  );
  if (start === -1) {
    return null;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {0,2}\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => !isComment(line));
}

/**
 * The jobs a job needs, in any of YAML's three forms: `needs: a`,
 * `needs: [a, b]`, or a list under `needs:`.
 *
 * @param {string[]} lines — from jobLines
 */
function needsOf(lines) {
  const at = lines.findIndex((line) => /^ {4}needs:/.test(line));
  if (at === -1) {
    return [];
  }
  const inline = lines[at].replace(/^ {4}needs:\s*/, '').trim();
  if (inline !== '') {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '');
  }
  const listed = [];
  for (const line of lines.slice(at + 1)) {
    const item = /^ {6}-\s*(?<name>\S+)\s*$/.exec(line);
    if (item?.groups === undefined) {
      break;
    }
    listed.push(item.groups.name);
  }
  return listed;
}

/**
 * The jobs of ci.yml no rule requires that are accepted all the same: those a
 * required check fans out into (`fanOut` in CHECKS), while that check's job
 * needs each of them and has `if: always()`. Without `if: always()`, a failed
 * or cancelled fan-out job would skip the check's job, and a skipped required
 * check reads as passing; without the need, the check could pass before, or
 * without, the work it stands for (BUG-45, D-129).
 *
 * @param {{ text: string, required: string[], fanOut: Record<string, string[]> }} state
 * @returns {{ accepted: string[], problems: { what: string, fix: string }[] }}
 */
function reviewFanOut({ text, required, fanOut }) {
  const accepted = [];
  const problems = [];
  for (const [check, jobs] of Object.entries(fanOut)) {
    const lines = jobLines(text, check);
    // A check no rule requires accepts nothing; one with no job is already
    // reported as a required check nothing produces.
    if (!required.includes(check) || lines === null) {
      continue;
    }
    const always = lines.some((line) => /^ {4}if:\s*always\(\)\s*$/.test(line));
    if (!always) {
      problems.push({
        what: `ci.yml's ${check} job fans out, but has no job-level if: always(), so a failed or cancelled job it needs would skip it, and a skipped required check reads as passing.`,
        fix: `Give the ${check} job \`if: always()\`, and let its own step judge what the jobs it needs left.`,
      });
    }
    const needs = needsOf(lines);
    for (const job of jobs) {
      if (jobLines(text, job) === null) {
        problems.push({
          what: `CHECKS says ${check} fans out into ${job}, but ci.yml has no ${job} job.`,
          fix: `Add the ${job} job, or take it out of ${check}'s fanOut in scripts/lib/merge-rules.mjs.`,
        });
      } else if (!needs.includes(job)) {
        problems.push({
          what: `ci.yml's ${check} job does not need ${job}, one of the jobs it fans out into, so it can pass before that job has finished, or without it.`,
          fix: `Add ${job} to the needs of the ${check} job.`,
        });
      } else if (always) {
        accepted.push(job);
      }
    }
  }
  return { accepted, problems };
}

/** `ai-review (test-auditor)` → `test-auditor`; anything else → null. */
function reviewerOf(check) {
  return /^ai-review \((?<agent>[\w-]+)\)$/.exec(check)?.groups?.agent ?? null;
}

/**
 * @param {{
 *   files: {path: string, text: string}[],
 *   scripts: Record<string, string>,
 *   required: string[],
 *   fanOut?: Record<string, string[]>,
 * }} state — `fanOut`: a required check's id, to the ci.yml jobs it fans out
 *   into, as CHECKS declares them (reviewFanOut)
 */
export function reviewWorkflows({ files, scripts, required, fanOut = {} }) {
  if (files.length === 0) {
    return [
      {
        what: 'No workflow files in .github/workflows, so nothing checks a pull request at all.',
        fix: 'Restore the workflows. Every gate in this repository runs there as well as locally.',
      },
    ];
  }

  const problems = [];

  for (const file of files) {
    for (const use of findActionUses(file.text)) {
      if (!use.pinned) {
        problems.push({
          what: `${file.path}:${String(use.line)} uses ${use.ref}, which is a tag or a branch, not a commit.`,
          fix: "Pin it to the full 40-character commit SHA, with the version as a trailing comment. Whoever can move that tag can otherwise run their code in a job that holds this repository's secrets.",
        });
      }
    }
    for (const script of findPnpmScripts(file.text)) {
      if (scripts[script] === undefined) {
        problems.push({
          what: `${file.path} runs "pnpm run ${script}", but package.json has no such script.`,
          fix: `Add the script, or take the step out. As it is, the job fails with "command not found", which reads like a broken runner rather than a check nobody wrote.`,
        });
      }
    }
  }

  const everything = files.map((file) => file.text).join('\n');
  const jobIds = new Set(files.flatMap((file) => findJobIds(file.text)));
  for (const check of required) {
    const reviewer = reviewerOf(check);
    const produced =
      reviewer === null
        ? jobIds.has(check)
        : new RegExp(`agent:\\s*${reviewer}\\b`).test(everything);
    if (!produced) {
      problems.push({
        what: `The merge rules are to require "${check}", but no job in .github/workflows produces it.`,
        fix: 'Add the job, or take the check out of the required list. A required check that nothing produces leaves every pull request waiting for a tick that will never arrive.',
      });
    }
  }

  const ci = files.find((file) => file.path.endsWith('/ci.yml'));
  if (ci !== undefined) {
    const { accepted, problems: fanOutProblems } = reviewFanOut({
      text: ci.text,
      required,
      fanOut,
    });
    problems.push(...fanOutProblems);
    for (const id of findJobIds(ci.text)) {
      if (!required.includes(id) && !accepted.includes(id)) {
        problems.push({
          what: `ci.yml runs the job "${id}", but no merge rule requires it, so it can fail without stopping anything.`,
          fix: 'Add it to CHECKS in scripts/lib/merge-rules.mjs and to the required checks, or remove the job.',
        });
      }
    }
  }

  return problems;
}
