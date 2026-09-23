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
// a parser dependency. The shapes it has to read are in .github/workflows, and
// the tests below hold them to that.

const USES = /^\s*-?\s*uses:\s*(?<ref>\S+)/;
const PNPM_RUN = /\bpnpm run (?<script>[\w:@.-]+)/g;
const JOB_ID = /^ {2}(?<id>[A-Za-z_][\w-]*):\s*(?:#.*)?$/;
const FULL_SHA = /@[0-9a-f]{40}$/;

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
