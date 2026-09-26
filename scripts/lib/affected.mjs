// CI-12: a gate with nothing to check should run, say so, and pass — never be
// skipped.
//
// The distinction is the whole point, and `ci.yml` already states it:
//
//   "a skipped job reports as a green tick, and a green tick for work nobody
//    did is the one thing this repository must not produce"
//
// So this does not gate jobs with `paths:` or a job-level `if:`. Either would
// leave a required check reporting green — or, worse, never reporting at all,
// which deadlocks the pull request: #16 sat unmergeable for half an hour for
// exactly that reason, and it was not obvious why.
//
// Instead each job still runs, asks this, and either does its work or prints
// what it decided and why. `mutation` has worked this way since INF-04
// (`--only-if-safety-paths-changed`); this generalises the same idea.
//
// What it buys: the install and the script, not the runner. A job that skips
// its work still costs a checkout — a few seconds against thirty or forty.
// That is the honest trade, and it is worth naming rather than claiming the
// jobs "do not run".
//
// Node built-ins only: scripts/affected.mjs runs before setup-node, on whatever
// Node the runner ships, and imports this file.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Files that cannot change the outcome of a type check, a lint, a test or an
 * audit — so a diff made only of these leaves those gates nothing to do.
 *
 * Deliberately short. Anything not listed counts as code, because the cost of
 * being wrong is asymmetric: running a gate that had nothing to find wastes a
 * minute, and skipping one that did is a defect reaching `main` with a green
 * tick over it.
 *
 * Notably absent, and none of them by accident:
 *   .claude/hooks/    tested by test:hooks and linted by gate:static
 *   scripts/          the gates themselves
 *   .github/          the workflows, which scripts/gate.test.mjs asserts on,
 *                     and the issue templates, which scripts/daily-status.test.mjs
 *                     does — markdown there is configuration, not prose
 *
 * Markdown and `docs/` are also exactly what `.prettierignore` excludes, for
 * the same underlying reason: prose here is wrapped by hand and no tool reads
 * it. That is agreement, not coupling — if `.prettierignore` changed, this
 * would need its own argument rather than inheriting one.
 */
export const INERT = [
  // Markdown, except under .claude/ — and that exception is the whole subtlety.
  // Most of .claude/ is markdown that is *configuration*: scripts/ai-review.test.mjs
  // reads .claude/agents/*.md and asserts on their contents, so editing a
  // reviewer brief really can fail `unit`. CLAUDE.md is the same kind of file.
  // A blanket "markdown is prose" rule was the first draft here and a test of
  // this module caught it.
  // CLAUDE.md is named alongside /.claude/ here for the reason CODEOWNERS
  // names it: it states the non-negotiables and is loaded into every session.
  // No test reads it today, so it would pass as prose on the letter of the
  // rule — which is an argument for excluding it, not for including it. The
  // cost of being wrong is one avoidable CI run on a file that changes rarely.
  //
  // .github/ is excluded for the same reason as .claude/: its markdown is
  // configuration. scripts/daily-status.test.mjs holds the owner-question
  // issue template's label to the ones the daily report creates, so a change
  // to that template alone can fail `unit` — and would not have been checked.
  (file) =>
    file.endsWith('.md') &&
    !file.startsWith('.claude/') &&
    !file.startsWith('.github/') &&
    file !== 'CLAUDE.md',
  // Written by reviewers between runs, read by nobody else. CODEOWNERS exempts
  // it for the same reason.
  (file) => file.startsWith('.claude/agent-memory/'),
];

// Deliberately NOT "everything under docs/". docs/plan/main-ruleset.json is a
// real file that scripts/gate.test.mjs parses and asserts on, so a `docs/`
// rule would have marked a change to the merge rules as nothing to check.
// Restricting this to markdown excludes it for free — found by grepping the
// suite for what it actually reads, rather than by deciding which directories
// feel like documentation.

/**
 * True when every changed file is inert, so the code gates have nothing to
 * check on this diff.
 *
 * An empty diff answers true: there is genuinely nothing to check. It should
 * not happen on a pull request, and if it does, "nothing changed" is the
 * honest answer rather than a reason to run everything.
 *
 * @param {string[]} files paths, relative to the repository root
 * @returns {boolean}
 */
export function onlyInert(files) {
  return files.every((file) => INERT.some((isInert) => isInert(file)));
}

/**
 * The files that made a diff count as code, for the job log.
 *
 * A gate that decided to run should be able to say what made it decide —
 * otherwise the next person to wonder "why did the whole suite run for a typo
 * fix" has to reconstruct it from the diff.
 *
 * @param {string[]} files
 * @returns {string[]}
 */
export function reasons(files) {
  return files.filter((file) => !INERT.some((isInert) => isInert(file)));
}

// INF-06: can this diff change the app? android-e2e asks, because its full run
// costs ten minutes or more and a "no" costs one.
//
// A wrong "no" is the expensive mistake: an app-breaking change would merge
// with a green android-e2e over it. So nothing here is a list kept by hand. The
// app's dependency closure is read from the package.json files, and the e2e
// script's import closure from its source, every time this runs: a dependency
// or an import added later is followed without an edit here.

/** Where the app lives. */
const APP_DIR = 'apps/mobile/';

/** Root files that decide what is installed, and with which Node. */
const INSTALL_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  '.nvmrc',
  '.node-version',
];

/** The workflow that runs android-e2e: a change to it changes how the app is tested. */
const CI_WORKFLOW = '.github/workflows/ci.yml';

/** The package.json script that runs the flows (CI-09). */
const E2E_SCRIPT = 'e2e:android';

/** A JSON file under `root`, or null when it is not there. */
function readJson(root, file) {
  const at = path.join(root, file);
  return existsSync(at) ? JSON.parse(readFileSync(at, 'utf8')) : null;
}

/**
 * The workspace packages, as package name → folder (with a trailing slash),
 * from the root package.json's "workspaces" globs. Only `folder/*` and plain
 * folders are written there; anything else is refused loudly, because a glob
 * this cannot read would leave packages out of the closure without a word.
 *
 * @param {string} root
 * @returns {Map<string, string>}
 */
function workspacePackages(root) {
  const packages = new Map();
  for (const glob of readJson(root, 'package.json')?.workspaces ?? []) {
    let folders;
    if (glob.endsWith('/*') && !glob.slice(0, -2).includes('*')) {
      const parent = glob.slice(0, -2);
      folders = existsSync(path.join(root, parent))
        ? readdirSync(path.join(root, parent), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => `${parent}/${entry.name}`)
        : [];
    } else if (!glob.includes('*')) {
      folders = [glob.replace(/\/$/, '')];
    } else {
      throw new Error(
        `affected: cannot read the workspace glob "${glob}", so the app's dependency closure cannot be worked out.`,
      );
    }
    for (const folder of folders) {
      const name = readJson(root, `${folder}/package.json`)?.name;
      if (typeof name === 'string') packages.set(name, `${folder}/`);
    }
  }
  return packages;
}

const namesIn = (manifest, fields) =>
  fields.flatMap((field) => Object.keys(manifest?.[field] ?? {}));

/**
 * The folders of the workspace packages the app is built from: what it
 * depends on, dev dependencies included, and what those depend on in turn.
 * A dependency's own dev dependencies are not installed with it, so the walk
 * past the app follows only what is.
 *
 * @param {string} root
 * @returns {string[]}
 */
function appClosure(root) {
  const packages = workspacePackages(root);
  const folders = new Set();
  const queue = namesIn(readJson(root, `${APP_DIR}package.json`), [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]);
  while (queue.length > 0) {
    const folder = packages.get(queue.shift() ?? '');
    if (folder === undefined || folders.has(folder)) continue;
    folders.add(folder);
    queue.push(
      ...namesIn(readJson(root, `${folder}package.json`), [
        'dependencies',
        'optionalDependencies',
        'peerDependencies',
      ]),
    );
  }
  return [...folders];
}

/** Specifiers of every static import, re-export, side-effect import and dynamic import. */
const IMPORTS = [
  /\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/**
 * The e2e script and every repository module it imports, directly or through
 * another one, relative to `root`. Empty when there is no such script.
 *
 * @param {string} root
 * @returns {Set<string>}
 */
function e2eClosure(root) {
  const command = readJson(root, 'package.json')?.scripts?.[E2E_SCRIPT] ?? '';
  const entry = /\bnode\s+(\S+\.[cm]?js)\b/.exec(command)?.[1];
  const found = new Set();
  const queue = entry === undefined ? [] : [path.normalize(entry)];
  while (queue.length > 0) {
    const file = queue.shift() ?? '';
    if (found.has(file) || !existsSync(path.join(root, file))) continue;
    found.add(file);
    const source = readFileSync(path.join(root, file), 'utf8');
    for (const pattern of IMPORTS) {
      for (const [, specifier] of source.matchAll(pattern)) {
        if (specifier?.startsWith('./') || specifier?.startsWith('../')) {
          queue.push(path.normalize(path.join(path.dirname(file), specifier)));
        }
      }
    }
  }
  return found;
}

/**
 * True when any changed file can change the app or how android-e2e tests it.
 *
 * An empty diff answers false: there is nothing for android-e2e to check.
 *
 * @param {string[]} files paths, relative to the repository root
 * @param {{ root: string }} options root is the repository to read the closures from
 * @returns {boolean}
 */
export function touchesApp(files, { root }) {
  if (files.length === 0) return false;
  const dependencies = appClosure(root);
  const e2e = e2eClosure(root);
  return files.some(
    (file) =>
      file.startsWith(APP_DIR) ||
      INSTALL_FILES.includes(file) ||
      file === CI_WORKFLOW ||
      dependencies.some((folder) => file.startsWith(folder)) ||
      e2e.has(file),
  );
}
