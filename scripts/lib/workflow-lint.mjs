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

/** `ai-review (test-auditor)` → `test-auditor`; anything else → null. */
function reviewerOf(check) {
  return /^ai-review \((?<agent>[\w-]+)\)$/.exec(check)?.groups?.agent ?? null;
}

/**
 * @param {{
 *   files: {path: string, text: string}[],
 *   scripts: Record<string, string>,
 *   required: string[],
 * }} state
 */
export function reviewWorkflows({ files, scripts, required }) {
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
    for (const id of findJobIds(ci.text)) {
      if (!required.includes(id)) {
        problems.push({
          what: `ci.yml runs the job "${id}", but no merge rule requires it, so it can fail without stopping anything.`,
          fix: 'Add it to CHECKS in scripts/lib/merge-rules.mjs and to the required checks, or remove the job.',
        });
      }
    }
  }

  return problems;
}
