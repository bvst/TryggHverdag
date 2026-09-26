// req-coverage: fixtures-only — the IDs below name the gates, not the product.
//
// The gates are lists of steps, and a list is easy to get quietly wrong: a typo
// in a script name drops a step, and the gate then reports "not possible yet"
// and passes. These tests hold the lists to the repository they describe.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { FULL_STEPS, QUICK_STEPS, availableTools } from './gate.mjs';
import { MUTATION_TIMEOUT_MS, SAFETY_PATHS } from './lib/gate-decisions.mjs';
import { packageScripts } from './lib/proc.mjs';
import { planSteps } from './lib/steps.mjs';
import {
  findActionUses,
  findUnboundedJobs,
  findUngroupedEcosystems,
} from './lib/workflow-lint.mjs';
import {
  OWNER_APPROVAL_PATHS,
  planChecks,
  reviewBypass,
  reviewRuleset,
} from './lib/merge-rules.mjs';

const WORKFLOWS = '.github/workflows';
const scripts = packageScripts(process.cwd());

describe('the gate step lists', () => {
  test('coverage is measured by the one script whose config the baseline came from', () => {
    // Two bugs are pinned here, and both of them passed quietly.
    //
    // `pnpm run test:unit -- --coverage` reaches vitest as `vitest run --
    // --coverage`, where --coverage is read as a path to filter tests by: the
    // suite passes, nothing is written, and the ratchet has nothing to measure.
    //
    // Then `pnpm run test:unit --coverage` measured the right way but the wrong
    // tests. The baseline was recorded from unit *and* system tests, because
    // the API and the health service are reached at L6 and nowhere else, so the
    // unit run alone reported 58.73 % against an 80 % floor — a red gate about
    // nothing. Naming the script, not the flags, is what stops a third version.
    const step = FULL_STEPS.find((s) => s.name.startsWith('coverage'));

    expect(step?.command).toEqual(['pnpm', 'run', 'test:coverage']);
    expect(scripts['test:coverage']).toContain('vitest.coverage.config.mjs');
  });

  test('no step separates its flags with --, which would hide them from the script', () => {
    for (const step of [...QUICK_STEPS, ...FULL_STEPS]) {
      expect(step.command).not.toContain('--');
    }
  });

  test('every step that should be runnable today names a script that exists', () => {
    const shouldRun = [...QUICK_STEPS, ...FULL_STEPS].filter((s) => s.arrivesIn === undefined);

    expect(shouldRun.length).toBeGreaterThan(0);
    for (const step of shouldRun) {
      expect(scripts).toHaveProperty(step.needsScript);
    }
  });

  test('a step that cannot run yet says which task brings it', () => {
    for (const step of FULL_STEPS.filter((s) => s.arrivesIn !== undefined)) {
      expect(step.arrivesIn).toMatch(/^INF-\d\d$/);
    }
  });
});

describe('availableTools', () => {
  test('asks whether the docker daemon answers, not whether the binary exists', () => {
    // A cloud session has /usr/bin/docker and no daemon. `which docker` would
    // say yes and the integration step would then fail inside Testcontainers,
    // which reads as broken code rather than as a machine that cannot run L3.
    //
    // Narrowed to Docker by INF-06, which adds a second probe (an Android
    // device, for L7): the whole list of commands and the whole result object
    // now hold that probe too, so they are asserted on their Docker part. The
    // fake also answers with `output`, as proc.mjs `run` does, because the
    // device probe reads what adb printed.
    const asked = [];
    const tools = availableTools((command, args) => {
      asked.push([command, ...args].join(' '));
      return { ok: true, output: '' };
    }, '/tmp');

    expect(asked.filter((command) => command.startsWith('docker'))).toEqual(['docker info']);
    expect(tools).toMatchObject({ docker: true });
  });

  test('a daemon that does not answer means the tool is not available', () => {
    expect(availableTools(() => ({ ok: false, output: '' }), '/tmp')).toMatchObject({
      docker: false,
    });
  });
});

describe("this repository's own workflows", () => {
  const files = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name));

  test('there are workflow files to check at all', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files)('%s pins every action to a commit', (name) => {
    // gate:integrity checks this too, but it is red until the owner switches
    // the merge rules on — so until then this is the only thing that would
    // notice an unpinned action arriving.
    for (const use of findActionUses(readFileSync(`${WORKFLOWS}/${name}`, 'utf8'))) {
      expect({ ref: use.ref, pinned: use.pinned }).toMatchObject({ pinned: true });
    }
  });

  test('the job that works out which reviewers apply can read the pull request', () => {
    // dorny/paths-filter asks the API which files the pull request touches, so
    // `contents: read` alone fails the job with "Resource not accessible by
    // integration" — and that failure takes all five reviewers down with it.
    // Narrowing this job's permissions is right; narrowing it past this is not.
    const text = readFileSync(`${WORKFLOWS}/ai-review.yml`, 'utf8');
    const changesJob = text.slice(text.indexOf('  changes:'), text.indexOf('  review:'));

    expect(changesJob).toContain('pull-requests: read');
  });

  test('the reviewers are granted the tools their prompt needs', () => {
    // The action gives a plain-text prompt no tools at all unless claude_args
    // lists them, so the reviewer needs its read tools and the comment tool
    // that carries findings to a person.
    //
    // This test required Write as well, for a reason that no longer holds:
    // the verdict used to reach CI as review-<agent>.md, so without Write the
    // review happened and its evidence did not survive. The verdict now comes
    // back through --json-schema, so there is no file and no reason for the
    // harness to hold a write tool. Changed because the premise was removed,
    // not to make a failure go away — and the constraint got stricter, since
    // `ai-review.test.mjs` now asserts Write is *absent* rather than this one
    // merely tolerating it.
    const text = readFileSync(`${WORKFLOWS}/ai-review.yml`, 'utf8');
    const allowed = /--allowedTools\s+"(?<tools>[^"]+)"/.exec(text)?.groups?.tools ?? '';

    expect(allowed.split(',').map((s) => s.trim())).toEqual(
      expect.arrayContaining(['Read', 'Grep', 'Glob', 'Bash', 'mcp__github__add_issue_comment']),
    );
  });

  test('no ci job can be skipped into a green tick (CI-12)', () => {
    // The saving here is real but the failure mode is worse than the cost. A
    // required check that GitHub reports as *skipped* counts as passing, so
    // `paths:` or a job-level `if:` would hand out green ticks for work nobody
    // did — which ci.yml's own header calls the one thing this repository must
    // not produce. And a required check that never reports at all deadlocks
    // the pull request: #16 sat unmergeable on exactly that.
    //
    // So the conditionality lives on steps, never on jobs. This asserts the
    // shape rather than the intent, because intent is what erodes.
    const text = readFileSync(`${WORKFLOWS}/ci.yml`, 'utf8');
    const workflow = text.slice(text.indexOf('\njobs:'));

    // No job-level `if:` anywhere (four spaces of indent = job key).
    expect(workflow).not.toMatch(/^ {4}if:/m);
    // No paths filters, which would stop the workflow producing the check at all.
    expect(workflow).not.toMatch(/^\s*paths(-ignore)?:/m);
  });

  test('every gate that can sit out a diff first asks whether it should', () => {
    // A guarded step with no classify step above it would never run at all —
    // `steps.affected.outputs.code` would simply be empty, and empty is not
    // 'true'. That fails silently in the worst direction: the gate stops
    // running and still reports success.
    const text = readFileSync(`${WORKFLOWS}/ci.yml`, 'utf8');
    const jobs = text.slice(text.indexOf('\njobs:')).split(/(?=^ {2}[a-z-]+:)/m);

    for (const job of jobs) {
      // Either answer the classifier gives: `code` for the code gates, and
      // `app` for android-e2e (INF-06-AC12). A job guarded only on `app` is
      // held to the same order as one guarded on `code`.
      const guards = [
        "steps.affected.outputs.code == 'true'",
        "steps.affected.outputs.app == 'true'",
      ]
        .map((guard) => job.indexOf(guard))
        .filter((at) => at !== -1);
      if (guards.length === 0) continue;
      const firstGuard = Math.min(...guards);
      const name = /^ {2}([a-z-]+):/.exec(job)?.[1];
      const classify = job.indexOf('- id: affected');

      expect(classify, `${name} guards steps without classifying the diff`).toBeGreaterThan(-1);
      // Order, not merely presence. An earlier version of this test asserted
      // only that the classify step existed somewhere in the job, and
      // code-reviewer showed on #17 that moving it below the guarded steps
      // left the test passing — which is the precise bug it exists to catch.
      // A guard that reads steps.affected.outputs.code before the step that
      // sets it reads an empty string, so every guarded step sits out, and the
      // job still reports success: a gate switched off with a green tick over
      // it. Comparing positions is the cheap check that actually holds.
      expect(classify, `${name} classifies the diff after already guarding on it`).toBeLessThan(
        firstGuard,
      );
      // And the classify step itself must never be guarded, or it cannot run:
      // a guard on it would read the output it is supposed to set, find an
      // empty string, skip the step, and leave every guarded step below it
      // skipping too — the job green having done nothing.
      //
      // This began as a regex looking for an `if:` line immediately followed by
      // `- id: affected`, which only ever caught a guard on the *preceding*
      // step. Writing it the natural way, with `if:` under the `id:`, sailed
      // past. test-auditor blocked #17 over it, and was right to: the sibling
      // assertion above had already been found broken the same way one commit
      // earlier, and fixing the instance rather than the class left this one
      // sitting there. Reading the step's own block is not pattern-matching
      // around the problem, so there is no second shape to miss.
      const nextStep = job.indexOf('\n      - ', classify);
      const classifyStep = job.slice(classify, nextStep === -1 ? undefined : nextStep);
      expect(classifyStep, `${name} puts a condition on its own classify step`).not.toMatch(
        /^\s*if:/m,
      );
    }
  });

  test('a verdict is only accepted with the comment that proves a review happened', () => {
    // On 2026-09-23 this gate accepted
    //   {"verdict":"PASS","summary":"Placeholder — waiting for test-auditor
    //    subagent to finish before posting PR comment and final verdict."}
    // and went green. test-auditor is one of the three blocking reviewers, so a
    // blocking check reported success over a review that had not happened —
    // worse than a red, which would have been investigated.
    //
    // The gate asked whether the answer had the right shape. It never asked
    // whether anyone did the work. The comment is what a finished review leaves
    // behind and a cut-off one does not, so commentUrl is what makes the
    // verdict corroborable rather than merely well-formed.
    //
    // ai-review.yml is the one file the reviewers structurally cannot review
    // (D-075), so this test is the only thing standing behind the change.
    const text = readFileSync(`${WORKFLOWS}/ai-review.yml`, 'utf8');
    const schema = /--json-schema\s+'(?<schema>[^']+)'/.exec(text)?.groups?.schema ?? '';

    expect(schema).not.toBe('');
    const parsed = JSON.parse(schema);
    expect(parsed.required).toEqual(expect.arrayContaining(['verdict', 'summary', 'commentUrl']));
    expect(parsed.properties.commentUrl.pattern).toContain('issuecomment-');
  });

  test('the verdict gate reads the comment back rather than trusting the URL', () => {
    // A URL is a claim like any other. Three separate things have to hold, and
    // each closes a different route to passing without reviewing: the comment
    // exists (read back through the API), it is on THIS pull request rather
    // than some other one, and its body names the same verdict — so an agent
    // that posts "I could not finish" and returns PASS is caught by the two
    // artefacts disagreeing.
    const text = readFileSync(`${WORKFLOWS}/ai-review.yml`, 'utf8');
    const enforce = text.slice(text.indexOf('Enforce the verdict'));

    expect(enforce).toContain('issues/comments/');
    expect(enforce).toContain('issue_url');
    expect(enforce).toContain('PR_NUMBER');
    // The body check: whatever verdict was reported has to appear in the
    // comment. Asserted on the shell variable, so rewording the message cannot
    // quietly drop the check.
    expect(enforce).toMatch(/jq -r '\.body[^|]*\| grep -qiE "[^"]*\$\{verdict\}/);
  });

  test('every ecosystem groups its non-major updates into one pull request', () => {
    // Twelve patch bumps as twelve pull requests are reviewed by nobody, and a
    // dependency stream nobody reads is a security gate in name only (SEC-06).
    // Majors stay ungrouped on purpose: that is where behaviour may change.
    expect(findUngroupedEcosystems(readFileSync('.github/dependabot.yml', 'utf8'))).toEqual([]);
  });

  test('every workflow job is bounded by a timeout', () => {
    // Without timeout-minutes a job gets GitHub's six-hour default, and a job
    // that hangs is indistinguishable from one that is working — so it is not
    // investigated, it is waited on. The two jobs that had a bound were the two
    // added last; the other nine inherited the default by nobody deciding.
    const unbounded = readdirSync(WORKFLOWS)
      .filter((name) => name.endsWith('.yml'))
      .flatMap((name) =>
        findUnboundedJobs(readFileSync(`${WORKFLOWS}/${name}`, 'utf8')).map(
          (id) => `${name}: ${id}`,
        ),
      );

    expect(unbounded).toEqual([]);
  });

  test('the mutation run is given time to finish, inside the job that runs it', () => {
    // proc.mjs gives every command 590 s unless told otherwise. On INF-07's
    // first CI run Stryker needed longer, was killed, and the job failed on a
    // score nobody measured. The limit must also stay inside the job's own
    // timeout, with room for checkout and install, or GitHub kills the job
    // first and nothing explains why.
    const ci = readFileSync(`${WORKFLOWS}/ci.yml`, 'utf8');
    const job = /^ {2}mutation:.*\n(?:(?! {2}\S).*\n)*? {4}timeout-minutes: (\d+)/m.exec(ci);

    expect(job).not.toBeNull();
    const jobMinutes = Number(job?.[1]);
    expect(MUTATION_TIMEOUT_MS).toBeGreaterThan(590_000);
    expect(MUTATION_TIMEOUT_MS).toBeLessThanOrEqual((jobMinutes - 3) * 60_000);
  });

  test('the mutation budget stays 25 minutes for all the runs together, inside the 30-minute job', () => {
    // The owner's grouping decision of 2026-09-25 split one Stryker run into
    // several and kept the budget as it was: 25 minutes across all of them,
    // not per run, because the job around them still has 30. A slow run is
    // fixed by making its tests faster, which is what the grouping did; this
    // number moving is a decision for the owner, not a fix.
    const ci = readFileSync(`${WORKFLOWS}/ci.yml`, 'utf8');
    const job = /^ {2}mutation:.*\n(?:(?! {2}\S).*\n)*? {4}timeout-minutes: (\d+)/m.exec(ci);

    expect(MUTATION_TIMEOUT_MS).toBe(25 * 60_000);
    expect(Number(job?.[1])).toBe(30);
  });

  test('the safety filter in ai-review.yml matches the paths the owner must approve', () => {
    // Two copies of the same list: the paths CODEOWNERS holds for the owner,
    // and the paths that summon safety-reviewer. If they drift, a safety change
    // either merges with no safety review, or waits for a review nobody asked
    // for. Either way one of the two is lying.
    const text = readFileSync(`${WORKFLOWS}/ai-review.yml`, 'utf8');
    const safetyPaths = OWNER_APPROVAL_PATHS.filter((p) => p.startsWith('/apps/'));

    expect(safetyPaths.length).toBeGreaterThan(0);
    for (const path of safetyPaths) {
      const glob = path.replace(/^\//, '').replace(/\/$/, '/**');
      expect(text).toContain(`'${glob}'`);
    }
  });

  test('every safety path needs the owner to approve a change to it', () => {
    // Two more copies of one list, and nothing tied them together: the paths
    // the gates treat as safety code, mutated by Stryker and held to the 95 %
    // branch floor, and the paths CODEOWNERS must hold for the owner. A safety
    // path the owner does not approve is a rule that a single pull request can
    // change without them. The Healthchecks.io adapter, a safety path by the
    // owner's decision D-079, reached SAFETY_PATHS and CODEOWNERS but not
    // OWNER_APPROVAL_PATHS, the list CI-01 holds CODEOWNERS to, so its line in
    // CODEOWNERS was one that nothing checked.
    //
    // The two are written differently. An owner path starts with / and is
    // anchored at the root, and one that ends in / covers every file under it.
    const covers = (owned, path) => {
      const relative = owned.replace(/^\//, '');
      return relative === path || (relative.endsWith('/') && path.startsWith(relative));
    };
    const unapproved = SAFETY_PATHS.filter(
      (path) => !OWNER_APPROVAL_PATHS.some((owned) => covers(owned, path)),
    );

    expect(SAFETY_PATHS.length).toBeGreaterThan(0);
    expect(unapproved).toEqual([]);
  });
});

describe('the ruleset the owner imports', () => {
  // docs/plan/main-ruleset.json is what the owner uploads to GitHub, so it is a
  // copy of the required-check list — the kind of copy that goes stale quietly.
  // Rather than compare it field by field, put it through the very functions
  // that will later judge the live repository: if the file would not satisfy
  // gate:integrity, it is wrong now, and this says so before the owner imports
  // it rather than after.
  const ruleset = JSON.parse(readFileSync('docs/plan/main-ruleset.json', 'utf8'));
  const required = planChecks(scripts).required;

  test('it satisfies the same check that CI-01 runs against the live repository', () => {
    expect(reviewRuleset({ branchRules: ruleset.rules, required })).toEqual([]);
  });

  test('nobody may bypass it (D-029)', () => {
    expect(reviewBypass({ rulesets: [ruleset] })).toEqual([]);
  });

  test('it targets the default branch', () => {
    expect(ruleset.target).toBe('branch');
    expect(ruleset.conditions.ref_name.include).toEqual(['~DEFAULT_BRANCH']);
  });

  test('it requires every check that must be required today, and no others', () => {
    const contexts = ruleset.rules
      .find((rule) => rule.type === 'required_status_checks')
      .parameters.required_status_checks.map((entry) => entry.context);

    expect(contexts).toEqual(required);
  });

  // INF-06-AC14. The two tests above already fail on their own once
  // e2e:android exists and this file does not list android-e2e. These say what
  // they are waiting for, by name, so that neither can pass merely because
  // the script was never added.
  test('INF-06-AC14: e2e:android exists, so android-e2e is a check that must be required', () => {
    expect(scripts['e2e:android']).toBeDefined();
    expect(required).toContain('android-e2e');
  });

  test('INF-06-AC14: the ruleset the owner imports requires android-e2e', () => {
    const contexts = ruleset.rules
      .find((rule) => rule.type === 'required_status_checks')
      .parameters.required_status_checks.map((entry) => entry.context);

    expect(contexts).toContain('android-e2e');
  });
});

/** The app's package name: a hand-over names exactly this, and nothing that merely contains "mobile". */
const APP_PACKAGE = '@trygghverdag/mobile';

/**
 * One `pnpm …` command, read the way pnpm reads it: its selectors, its other
 * options before the script, and the script it runs. Null for anything that is
 * not a pnpm command.
 *
 * @param {string} command
 */
function pnpmCall(command) {
  const words = command.trim().split(/\s+/);
  if (words[0] !== 'pnpm') return null;
  const filters = [];
  const dirs = [];
  const flags = [];
  let at = 1;
  while (at < words.length && (words[at] ?? '').startsWith('-')) {
    const word = words[at] ?? '';
    if (word === '--filter' || word === '-F') {
      filters.push(words[at + 1] ?? '');
      at += 2;
    } else if (word === '--dir' || word === '-C') {
      dirs.push(words[at + 1] ?? '');
      at += 2;
    } else {
      if (word.startsWith('--filter=')) filters.push(word.slice('--filter='.length));
      else if (word.startsWith('--dir=')) dirs.push(word.slice('--dir='.length));
      else flags.push(word);
      at += 1;
    }
  }
  if (words[at] === 'run') at += 1;
  return { filters, dirs, flags, script: words[at] };
}

/** The commands a root script chains, each a pnpm call or null. */
const commandsOf = (script) => script.split(/&&|\|\||;/).map(pnpmCall);

/** True when a pnpm call hands over to the app, by its exact package name or its exact folder. */
const toApp = (call) =>
  call !== null &&
  (call.filters.length > 0
    ? call.filters.every((filter) => filter === APP_PACKAGE)
    : call.dirs.length > 0 && call.dirs.every((dir) => dir.replace(/\/$/, '') === 'apps/mobile'));

/**
 * A root script, followed into the app's own scripts wherever it hands over to
 * one: `pnpm --filter @trygghverdag/mobile run test`, `pnpm -C apps/mobile test`.
 * The first entry is the root script itself. A filter that only contains
 * "mobile" is not followed: pnpm would read it as another selector, and a
 * selector that matches nothing runs nothing.
 */
function scriptChain(name) {
  const own = scripts[name] ?? '';
  const appManifest = 'apps/mobile/package.json';
  const app = existsSync(appManifest)
    ? (JSON.parse(readFileSync(appManifest, 'utf8')).scripts ?? {})
    : {};
  const handedOver = commandsOf(own)
    .filter(toApp)
    .map((call) => call?.script ?? '')
    .filter((script) => app[script] !== undefined)
    .map((script) => app[script]);
  return [own, ...handedOver];
}

describe('the unit run covers both test runners', () => {
  test("INF-06-AC6: test:unit runs Vitest and then the app's jest-expo suite, in CI mode", () => {
    const chain = scriptChain('test:unit').join('\n');

    expect(chain).toMatch(/\bvitest run\b/);
    expect(chain).toMatch(/\bjest\b[^\n]*--ci\b/);
  });

  test('INF-06-AC6: a failure in either runner fails it, and "no tests found" is a failure', () => {
    // `&&` stops at the first failure and passes its exit code on; `;` or `||`
    // would each let one runner's failure pass. Jest exits non-zero when it
    // finds no tests unless told otherwise, and nothing may tell it otherwise.
    const [own, ...app] = scriptChain('test:unit');

    expect([own, ...app].join('\n')).toMatch(/\bjest\b/);
    expect(own).not.toMatch(/;|\|\|/);
    expect([own, ...app].join('\n')).not.toMatch(/passWithNoTests/);
  });

  test.each([
    { config: 'vitest.config.mjs', run: 'the unit run' },
    { config: 'vitest.coverage.config.mjs', run: 'the coverage run' },
  ])('INF-06-AC6: Vitest collects no file under apps/mobile in $run', ({ config }) => {
    // Its pattern for app tests, apps/**/src/**/*.test.ts, reaches the app's
    // jest-expo tests too, which Vitest cannot run: they would fail on every
    // run for a reason that has nothing to do with them.
    const result = spawnSync(
      process.execPath,
      [
        path.join('node_modules', 'vitest', 'vitest.mjs'),
        'list',
        '--filesOnly',
        '--json',
        '--config',
        config,
      ],
      { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } },
    );
    const files = JSON.parse(result.stdout).map((entry) =>
      path.relative(process.cwd(), entry.file),
    );

    expect(result.status, result.stderr).toBe(0);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => file.startsWith('apps/mobile/'))).toEqual([]);
  });

  test("INF-06-AC8: test:coverage measures the app with jest-expo, beside Vitest's run", () => {
    const [own, ...app] = scriptChain('test:coverage');
    const chain = [own, ...app].join('\n');

    expect(chain).toContain('vitest.coverage.config.mjs');
    expect(chain).toMatch(/\bjest\b[^\n]*--coverage\b/);
    expect(own).not.toMatch(/;|\|\|/);
    expect(chain).not.toMatch(/passWithNoTests/);
  });

  // Amended 2026-09-26. In pnpm 10 a --filter that matches nothing exits 0, so
  // a renamed package or a typo in the selector would skip jest-expo and the
  // run would still pass. --fail-if-no-match makes that a failure, and it has
  // to come before the script name: after it, pnpm hands it to jest instead.
  test.each(['test:unit', 'test:coverage'])(
    'INF-06-AC6: %s hands over to the app with exactly --filter @trygghverdag/mobile and --fail-if-no-match',
    (name) => {
      const handOvers = commandsOf(scripts[name] ?? '').filter(
        (call) => call !== null && (call.filters.length > 0 || call.dirs.length > 0),
      );

      expect(handOvers).toHaveLength(1);
      expect(handOvers[0]?.filters).toEqual([APP_PACKAGE]);
      expect(handOvers[0]?.dirs).toEqual([]);
      expect(handOvers[0]?.flags).toContain('--fail-if-no-match');
    },
  );

  test.each([
    ['pnpm --filter @trygghverdag/mobile-old run test'],
    ['pnpm --filter ./apps/mobile-legacy run test'],
    ['pnpm --filter *mobile* run test'],
  ])(
    'INF-06-AC6: a selector that only contains mobile is not a hand-over to the app: %s',
    (command) => {
      expect(commandsOf(command).filter(toApp)).toEqual([]);
    },
  );

  test('INF-06-AC6: the exact selector is a hand-over, with its options before the script or not', () => {
    expect(
      commandsOf(
        'vitest run && pnpm --filter @trygghverdag/mobile --fail-if-no-match run test',
      ).filter(toApp),
    ).toEqual([
      { filters: [APP_PACKAGE], dirs: [], flags: ['--fail-if-no-match'], script: 'test' },
    ]);
    expect(commandsOf('pnpm --filter=@trygghverdag/mobile test').filter(toApp)).toHaveLength(1);
  });
});

describe('the development build', () => {
  test('INF-06-AC16: pnpm run dev starts Metro for the development client', () => {
    expect(scriptChain('dev').join('\n')).toMatch(/\bexpo start\b[^\n]*--dev-client\b/);
  });
});

describe('L7 in gate:full', () => {
  const l7 = FULL_STEPS.find((step) => step.command.join(' ') === 'pnpm run e2e:android');

  /** proc.mjs `run`, as a machine whose adb reports these device lines answers it. */
  const machine = (devices) => (command, args) => {
    if (command !== 'adb') return { ok: true, output: '' };
    if (args[0] === 'devices') {
      return { ok: true, output: `List of devices attached\n${devices}\n` };
    }
    if (args[0] === 'get-state') {
      return devices.includes('\tdevice')
        ? { ok: true, output: 'device\n' }
        : { ok: false, output: 'error: no devices/emulators found' };
    }
    return { ok: false, output: '' };
  };

  const planned = (runCommand) => {
    if (l7 === undefined) {
      throw new Error('gate:full has no step that runs pnpm run e2e:android.');
    }
    const [step] = planSteps(
      [l7],
      { 'e2e:android': 'node scripts/e2e-android.mjs' },
      {},
      availableTools(runCommand, '/tmp'),
    );
    return step;
  };

  test('INF-06-AC15: gate:full has an L7 step, and it runs pnpm run e2e:android', () => {
    expect(l7).toBeDefined();
    expect(l7?.needsScript).toBe('e2e:android');
  });

  test('INF-06-AC15: with no Android device it is not possible here, and says android-e2e is where it runs', () => {
    const step = planned(machine(''));

    expect(step?.willRun).toBe(false);
    expect(step?.reason).toContain('android-e2e');
  });

  test('INF-06-AC15: a device that is offline is no device', () => {
    expect(planned(machine('emulator-5554\toffline'))?.willRun).toBe(false);
  });

  test('INF-06-AC15: no adb at all is no device, not a crash', () => {
    const noAdb = (command) =>
      command === 'adb' ? { ok: false, output: 'spawnSync adb ENOENT' } : { ok: true, output: '' };

    expect(planned(noAdb)?.willRun).toBe(false);
  });

  test('INF-06-AC15: with a device connected, it runs e2e:android', () => {
    expect(planned(machine('emulator-5554\tdevice'))).toMatchObject({
      willRun: true,
      step: { command: ['pnpm', 'run', 'e2e:android'] },
    });
  });
});

/** A ci.yml job's own lines with comment lines dropped, or null when there is no such job. */
function ciJob(id) {
  const lines = readFileSync(`${WORKFLOWS}/ci.yml`, 'utf8').split('\n');
  const start = lines.findIndex((line) => new RegExp(`^ {2}${id}:(\\s|$)`).test(line));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line) || /^\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end))
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

/** The job's steps in order, each as the text of its block. */
function ciSteps(id) {
  const job = ciJob(id) ?? '';
  const at = job.indexOf('    steps:');
  return at === -1
    ? []
    : job
        .slice(at)
        .split(/\n(?= {6}- )/)
        .slice(1);
}

/** A step's `if:` condition, or '' when it has none. */
const guardOf = (step) => /^\s*-?\s*if:\s*(.+)$/m.exec(step)?.[1] ?? '';

/** The step that boots an emulator: the pinned action, or a script of our own. */
const bootsEmulator = (step) =>
  /uses: reactivecircus\/android-emulator-runner@/.test(step) || /\bemulator\s+(-avd|@)/.test(step);

/**
 * A ci.yml job's own `env:` block, as name to value with any quotes taken off,
 * or an empty object when the job has none.
 */
function jobEnv(id) {
  const lines = (ciJob(id) ?? '').split('\n');
  const at = lines.findIndex((line) => /^ {4}env:\s*$/.test(line));
  const env = {};
  if (at === -1) return env;
  for (const line of lines.slice(at + 1)) {
    if (!/^ {6}\S/.test(line)) break;
    const match = /^ {6}([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (match?.[1] !== undefined) env[match[1]] = (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

/** The names a piece of workflow text reads as `${{ env.NAME }}`. */
const envNames = (text) => [...text.matchAll(/\$\{\{\s*env\.(\w+)\s*\}\}/g)].map((m) => m[1] ?? '');

/** The text with every `${{ env.NAME }}` replaced by that job env value. */
const resolveEnv = (text, env) =>
  text.replace(/\$\{\{\s*env\.(\w+)\s*\}\}/g, (whole, name) => env[name] ?? whole);

/** The step that runs the flows: the one that runs e2e:android and is not the build. */
const runsFlows = (step) => /pnpm run e2e:android\b/.test(step) && !/--build-only\b/.test(step);

describe('the android-e2e job in ci.yml', () => {
  test('INF-06-AC12: there is a job named exactly android-e2e, the check the merge rules expect', () => {
    expect(ciJob('android-e2e')).not.toBeNull();
  });

  test('INF-06-AC12: it checks out full history, then classifies the diff before any other step', () => {
    const [checkout, classify] = ciSteps('android-e2e');

    expect(checkout).toMatch(/uses: actions\/checkout@/);
    expect(checkout).toMatch(/fetch-depth: 0/);
    expect(classify).toMatch(/id: affected/);
    expect(classify).toMatch(/run: node scripts\/affected\.mjs --base /);
    expect(guardOf(classify ?? '')).toBe('');
  });

  test('INF-06-AC12: a diff that cannot change the app is reported as such, and the job passes', () => {
    const nothing = ciSteps('android-e2e').filter((step) =>
      guardOf(step).includes("steps.affected.outputs.app != 'true'"),
    );

    expect(nothing).toHaveLength(1);
    expect(nothing[0]).toContain('android-e2e');
    expect(nothing[0]).toMatch(/nothing to check/);
    expect(nothing[0]).not.toMatch(/exit 1/);
  });

  test('INF-06-AC12: every other step works only when the diff can change the app', () => {
    const rest = ciSteps('android-e2e')
      .slice(2)
      .filter((step) => !guardOf(step).includes("steps.affected.outputs.app != 'true'"));

    expect(rest.length).toBeGreaterThan(0);
    for (const step of rest) {
      expect(guardOf(step), step.split('\n')[0]).toContain("steps.affected.outputs.app == 'true'");
    }
  });

  test('INF-06-AC12: KVM is switched on and checked before the emulator, and failing that it stops with a message', () => {
    const steps = ciSteps('android-e2e');
    const kvm = steps.findIndex((step) => step.includes('/dev/kvm') && step.includes('udevadm'));
    const emulator = steps.findIndex(bootsEmulator);

    expect(kvm).toBeGreaterThan(1);
    expect(emulator).toBeGreaterThan(kvm);
    expect(steps[kvm]).toMatch(/::error/);
    expect(steps[kvm]).toMatch(/exit 1/);
  });

  test('INF-06-AC12: the app is built before the emulator boots, which then runs pnpm run e2e:android', () => {
    const steps = ciSteps('android-e2e');
    const e2e = steps.flatMap((step, at) => (/pnpm run e2e:android\b/.test(step) ? [at] : []));
    const emulator = steps.findIndex(bootsEmulator);

    expect(emulator).toBeGreaterThan(-1);
    expect(e2e.length).toBeGreaterThanOrEqual(2);
    expect(e2e[0]).toBeLessThan(emulator);
    expect(e2e.at(-1)).toBeGreaterThanOrEqual(emulator);
  });

  test('INF-06-AC10: the emulator is x86_64, the one ABI the build contains', () => {
    // Read through the job's env, where the emulator settings are written once.
    const env = jobEnv('android-e2e');
    const emulators = ciSteps('android-e2e').filter(bootsEmulator);

    expect(emulators.length).toBeGreaterThan(0);
    for (const step of emulators) {
      expect(/^\s*arch:\s*(\S+)\s*$/m.exec(resolveEnv(step, env))?.[1]).toBe('x86_64');
    }
  });

  test('INF-06-AC12: the step that runs the flows is guarded by exactly the app answer, and by nothing narrower', () => {
    // Amended 2026-09-26. A guard that also asked for main would still contain
    // the app answer, so a contains-check would pass, while on a pull request
    // the flows would never run and the check would be green all the same.
    const flows = ciSteps('android-e2e').filter(runsFlows);

    expect(flows).toHaveLength(1);
    expect(guardOf(flows[0] ?? '')).toBe("steps.affected.outputs.app == 'true'");
  });

  test('INF-06-AC20: Maestro is told to send nothing: MAESTRO_DISABLE_UPDATE_CHECK is exactly true, and MAESTRO_CLI_NO_ANALYTICS is set', () => {
    // Maestro reads MAESTRO_DISABLE_UPDATE_CHECK with Boolean.parseBoolean, so
    // "1" leaves the update check on, and every run sends a persistent ID to
    // api.copilot.mobile.dev.
    const env = jobEnv('android-e2e');

    expect(env.MAESTRO_DISABLE_UPDATE_CHECK).toBe('true');
    expect(env.MAESTRO_CLI_NO_ANALYTICS).toBeDefined();
    expect(env.MAESTRO_CLI_NO_ANALYTICS).not.toBe('');
  });

  test('INF-06-AC12: its checkout keeps no credentials behind for later steps', () => {
    const [checkout] = ciSteps('android-e2e');

    expect(checkout).toMatch(/uses: actions\/checkout@/);
    expect(checkout).toMatch(/\bpersist-credentials:\s*false\b/);
  });

  test('INF-06-AC12: the emulator settings are written once, as job env, which the snapshot key and every emulator step read', () => {
    // Amended 2026-09-26. Written out in each place, a change to one copy
    // leaves a snapshot cached under a key that no longer says what it holds.
    const env = jobEnv('android-e2e');
    const steps = ciSteps('android-e2e');
    const emulators = steps.filter(bootsEmulator);
    const keys = steps
      .filter((step) => step.includes('~/.android/avd'))
      .map((step) => /^\s*key:\s*(.+)$/m.exec(step)?.[1] ?? '');
    const settings = [...new Set(keys.flatMap(envNames))];
    const text = (ciJob('android-e2e') ?? '')
      .split('\n')
      .filter((line) => !/^\s*-?\s*name:/.test(line))
      .join('\n');
    const timesWritten = (value) =>
      text.split(new RegExp(`(?<![\\w.])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.])`))
        .length - 1;

    expect(emulators.length).toBeGreaterThan(0);
    expect(keys.length).toBeGreaterThan(0);
    // At least the image, the target, the ABI, the profile and the locale.
    expect(settings.length).toBeGreaterThanOrEqual(5);
    for (const name of settings) {
      expect(env[name], `${name} is not in the job's env`).toBeDefined();
      for (const step of emulators) {
        expect(step, `an emulator step does not read ${name}`).toMatch(
          new RegExp(`\\benv\\.${name}\\b`),
        );
      }
      expect(timesWritten(env[name] ?? ''), `${name}'s value is written more than once`).toBe(1);
    }
  });

  test('INF-06-AC12: it is bounded, holds no secret, and never tolerates or retries a failure', () => {
    const job = ciJob('android-e2e');

    expect(job).toMatch(/^ {4}timeout-minutes: \d+/m);
    expect(job).not.toMatch(/secrets\./);
    expect(job).not.toMatch(/continue-on-error/);
    expect(job).not.toMatch(/uses: [^\n]*retry/i);
    expect(job).not.toMatch(/:\s*write\b/);
  });

  test("INF-06-AC12: ci.yml's header no longer calls android-e2e missing", () => {
    const text = readFileSync(`${WORKFLOWS}/ci.yml`, 'utf8');

    expect(text.slice(0, text.indexOf('\nname:'))).not.toMatch(/android-e2e[^\n]*INF-06 adds it/);
  });
});
