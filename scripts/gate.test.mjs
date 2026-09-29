// req-coverage: fixtures-only — the IDs below name the gates, not the product.
//
// The gates are lists of steps, and a list is easy to get quietly wrong: a typo
// in a script name drops a step, and the gate then reports "not possible yet"
// and passes. These tests hold the lists to the repository they describe.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { FULL_STEPS, QUICK_STEPS, availableTools } from './gate.mjs';
import { APK } from './lib/e2e-android.mjs';
import { MUTATION_TIMEOUT_MS, SAFETY_PATHS } from './lib/gate-decisions.mjs';
import { packageScripts } from './lib/proc.mjs';
import { planSteps, runPlan, summarize } from './lib/steps.mjs';
import {
  findActionUses,
  findUnboundedJobs,
  findUngroupedEcosystems,
} from './lib/workflow-lint.mjs';
import {
  OWNER_APPROVAL_PATHS,
  planChecks,
  reviewBypass,
  reviewCodeowners,
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

  // INF-10-AC18 (D-082 item 6): the root Vitest configurations decide, by
  // their include and exclude lists, whether the drills run at all. A change to
  // one that stopped them would otherwise be caught only by the AI reviewers.
  const VITEST_CONFIGS = ['vitest.config.mjs', 'vitest.shared.mjs', 'vitest.coverage.config.mjs'];

  test('INF-10-AC18: the three root Vitest configurations, which decide whether the drills run at all, are paths the owner must approve', () => {
    for (const file of VITEST_CONFIGS) {
      expect(existsSync(file), file).toBe(true);
      expect(OWNER_APPROVAL_PATHS, file).toContain(`/${file}`);
    }
  });

  test('INF-10-AC18: .github/CODEOWNERS gives each of them to the owner: gate:integrity finds every owner-approval path owned, and the last line matching each names an owner', () => {
    const text = readFileSync('.github/CODEOWNERS', 'utf8');
    const rules = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => {
        const [pattern = '', ...owners] = line.split(/\s+/);
        return { pattern, owners };
      });
    // CODEOWNERS reads its patterns as .gitignore does, and the last line that
    // matches a file decides its owners: a later line with none un-owns it,
    // as the reviewer-memory line at the end of the file does on purpose.
    const matches = (pattern, file) => {
      const directory = pattern.endsWith('/');
      const bare = pattern.replace(/^\//, '').replace(/\/$/, '');
      const anchored = pattern.startsWith('/') || bare.includes('/');
      const body = bare
        .split('**')
        .map((part) =>
          part
            .split('*')
            .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
            .join('[^/]*'),
        )
        .join('.*');
      return new RegExp(
        `^${anchored ? '' : '(?:.*/)?'}${body}${directory ? '/.*' : '(?:/.*)?'}$`,
      ).test(file);
    };
    const ownersOf = (file) =>
      rules.filter((rule) => matches(rule.pattern, file)).at(-1)?.owners ?? [];

    expect(reviewCodeowners(text)).toEqual([]);
    // The reading is checked on the file's own lines first.
    expect(ownersOf('.claude/settings.json').length).toBeGreaterThan(0);
    expect(ownersOf('.claude/agent-memory/notes.md')).toEqual([]);
    for (const file of VITEST_CONFIGS) {
      expect(ownersOf(file), file).not.toEqual([]);
    }
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

/** android-e2e's KVM step: the one that runs udevadm and checks /dev/kvm, or ''. */
const kvmStep = () =>
  ciSteps('android-e2e').find((step) => step.includes('/dev/kvm') && step.includes('udevadm')) ??
  '';

/** A test of whether /dev/kvm can be read or written: `[ ! -r /dev/kvm ]`, `test -w /dev/kvm`. */
const KVM_USABLE = /(?:\[\[?|\btest)\s+(?:!\s+)?-[rw]\s+\/dev\/kvm\b/;

/** The step's `udevadm trigger` for the kvm device, with its arguments in [1], or undefined. */
const kvmTrigger = (step) =>
  [...step.matchAll(/\budevadm\s+trigger\b([^\n;&|]*)/g)].find((match) =>
    /--name-match[= ](?:\/dev\/)?kvm\b/.test(match[1] ?? ''),
  );

/** Output that says a device is not there, in the words a script or `ls` would use. */
const ABSENT =
  /\b(?:does not|doesn't|did not|didn't) exist\b|\bno such file\b|\bmissing\b|\bnot present\b|\babsent\b/i;

/** A step's `run: |` script with its YAML indentation taken off, or '' when it has none. */
function runScript(step) {
  const lines = step.split('\n');
  const at = lines.findIndex((line) => /^\s*run:\s*\|\s*$/.test(line));
  if (at === -1) return '';
  const body = lines.slice(at + 1);
  const depth = (line) => /^ */.exec(line)?.[0].length ?? 0;
  const indent = depth(body.find((line) => line.trim() !== '') ?? '');
  const end = body.findIndex((line) => line.trim() !== '' && depth(line) < indent);
  return `${(end === -1 ? body : body.slice(0, end)).map((line) => line.slice(indent)).join('\n')}\n`;
}

/**
 * Runs the KVM step's script on a runner that has no /dev/kvm at all, and
 * returns its exit status and everything it printed. GitHub runs a step's
 * script with `bash -e`, or with `-eo pipefail` under `shell: bash`, so this
 * does too: evidence that itself fails ends the step there. sudo, udevadm and
 * tee are fakes on PATH that change nothing, and `/dev/kvm` in the script is
 * moved into a temporary directory where nothing is created.
 */
function runWithoutKvm(step) {
  const shell = /^\s*shell:\s*(\S+)\s*$/m.exec(step)?.[1];
  const flags =
    shell === undefined
      ? ['-e']
      : shell === 'bash'
        ? ['--noprofile', '--norc', '-eo', 'pipefail']
        : ['-c', `echo "the test does not know how GitHub runs shell: ${shell}"; exit 99`];
  const dir = mkdtempSync(path.join(tmpdir(), 'kvm-step-'));
  try {
    const bin = path.join(dir, 'bin');
    mkdirSync(bin);
    mkdirSync(path.join(dir, 'dev'));
    writeFileSync(path.join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
    writeFileSync(path.join(bin, 'udevadm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(path.join(bin, 'tee'), '#!/bin/sh\ncat > /dev/null\n', { mode: 0o755 });
    const script = path.join(dir, 'step.sh');
    writeFileSync(script, runScript(step).replace(/\/dev\/kvm\b/g, path.join(dir, 'dev', 'kvm')));
    const result = spawnSync('bash', [...flags, script], {
      encoding: 'utf8',
      env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: dir, LC_ALL: 'C' },
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Freeing disk space before the emulator (added 2026-09-27). Run 36300860646,
// job 108568110574, built the release app in 10 min 14 s, and then in "Boot the
// emulator in bokmål and run every flow" the action's SDK install stopped:
//   Warning: An error occurred while preparing SDK package 16 KB Page Size
//   Google APIs Intel x86_64 Atom System Image: No space left on device.
// No emulator started. The checks below read the steps as text and also run
// them on a fake runner, because the one thing worse than a full disk is a
// cleanup that deletes what the flows need: the APK, Gradle's cache, the SDK,
// Java or Node.

/** Where things are on GitHub's ubuntu-latest runner. The rm check and the fake runner use this layout. */
const RUNNER = {
  home: '/home/runner',
  workspace: '/home/runner/work/TryggHverdag/TryggHverdag',
  temp: '/home/runner/work/_temp',
  sdk: '/usr/local/lib/android/sdk',
  toolCache: '/opt/hostedtoolcache',
};
const RUNNER_JAVA = `${RUNNER.toolCache}/Java_Temurin-Hotspot_jdk/17.0.16-8/x64`;
const RUNNER_NODE = `${RUNNER.toolCache}/node/24.8.0/x64`;
const RUNNER_NDK = `${RUNNER.sdk}/ndk/27.3.13750724`;

/** The variables a step can name those places by, and where each points on the runner. */
const RUNNER_VARS = {
  HOME: RUNNER.home,
  GITHUB_WORKSPACE: RUNNER.workspace,
  RUNNER_TEMP: RUNNER.temp,
  ANDROID_HOME: RUNNER.sdk,
  ANDROID_SDK_ROOT: RUNNER.sdk,
  ANDROID_NDK: RUNNER_NDK,
  ANDROID_NDK_HOME: RUNNER_NDK,
  ANDROID_NDK_ROOT: RUNNER_NDK,
  ANDROID_NDK_LATEST_HOME: RUNNER_NDK,
  AGENT_TOOLSDIRECTORY: RUNNER.toolCache,
  RUNNER_TOOL_CACHE: RUNNER.toolCache,
  JAVA_HOME: RUNNER_JAVA,
  JAVA_HOME_17_X64: RUNNER_JAVA,
};

/**
 * What the emulator step and the steps after it need. Freeing space may remove
 * none of these, nothing inside one, and no directory that holds one. `path` is
 * the thing on the runner, `file` a file in it for the fake runner, and `built`
 * says the build makes it, so it is not there before.
 */
const KEPT = [
  {
    what: 'the APK the flows install',
    path: `${RUNNER.workspace}/${APK}`,
    file: `${RUNNER.workspace}/${APK}`,
    built: true,
  },
  {
    what: "Gradle's cache, which the job saves from main after the flows",
    path: `${RUNNER.home}/.gradle`,
    file: `${RUNNER.home}/.gradle/caches/modules-2/files-2.1/fake.jar`,
    built: false,
  },
  {
    what: "the SDK's emulator",
    path: `${RUNNER.sdk}/emulator`,
    file: `${RUNNER.sdk}/emulator/emulator`,
    built: false,
  },
  {
    what: "the SDK's platform-tools, adb among them",
    path: `${RUNNER.sdk}/platform-tools`,
    file: `${RUNNER.sdk}/platform-tools/adb`,
    built: false,
  },
  {
    what: "the SDK's platforms",
    path: `${RUNNER.sdk}/platforms`,
    file: `${RUNNER.sdk}/platforms/android-36/android.jar`,
    built: false,
  },
  {
    what: "the SDK's system images",
    path: `${RUNNER.sdk}/system-images`,
    file: `${RUNNER.sdk}/system-images/android-36/google_apis/fake/system.img`,
    built: false,
  },
  {
    what: 'the Java setup-java installed, which sdkmanager and Maestro run on',
    path: RUNNER_JAVA,
    file: `${RUNNER_JAVA}/bin/java`,
    built: false,
  },
  {
    what: "the runner's own Java",
    path: '/usr/lib/jvm',
    file: '/usr/lib/jvm/temurin-17-jdk-amd64/bin/java',
    built: false,
  },
  {
    what: 'the Node setup-node installed, which runs pnpm run e2e:android',
    path: RUNNER_NODE,
    file: `${RUNNER_NODE}/bin/node`,
    built: false,
  },
  {
    what: "the workspace's installed packages",
    path: `${RUNNER.workspace}/node_modules`,
    file: `${RUNNER.workspace}/node_modules/.modules.yaml`,
    built: false,
  },
  {
    what: "the app's installed packages, which the flow step reads the app's config with",
    path: `${RUNNER.workspace}/apps/mobile/node_modules`,
    file: `${RUNNER.workspace}/apps/mobile/node_modules/expo/package.json`,
    built: false,
  },
];

/** What freeing space must remove. A `built` one only exists after the build, so only a step after it removes it. */
const FREED = [
  { what: '.NET, /usr/share/dotnet', file: '/usr/share/dotnet/dotnet', built: false },
  { what: 'GHC, /opt/ghc', file: '/opt/ghc/9.12.2/bin/ghc', built: false },
  {
    what: "the app's Gradle intermediates",
    file: `${RUNNER.workspace}/apps/mobile/android/app/build/intermediates/dex/release/classes.dex`,
    built: true,
  },
  {
    what: "the app's .cxx",
    file: `${RUNNER.workspace}/apps/mobile/android/app/.cxx/RelWithDebInfo/fake/build.ninja`,
    built: true,
  },
];

// The emulator's cores and the runner's hardware (BUG-6, added 2026-09-28).
// Run 36418631362, job 108915697746, the first android-e2e run on main after
// INF-06 merged, booted the emulator and failed in the flow:
//   [Failed] app-starts (49s) (Assertion is false: "TryggHverdag" is visible)
// Both emulator steps logged `cores: 2`, the pinned action's default, as
// ci.yml sets none, and then:
//   printf 'hw.cpu.ncore=2\n' >> /home/runner/.android/avd/test.avd/config.ini
//   USER_WARNING | AVD 'test' will run more smoothly with 4 CPU cores (currently using 2).
// The step that made the snapshot saved it with
//   Cache saved with key: avd-37.2-google_apis_ps16k-x86_64-pixel_8-nb-NO
// a key that says nothing of the 2 cores the device had. Maestro's screenshot
// showed Android's "System-UI svarer ikke" over an app that had drawn (from
// the run's debug artefact, not read by this file). The repository is public
// now, and GitHub's docs give a public repository's standard Linux runner 4
// CPUs, 16 GB of memory and 14 GB of SSD, where a private one's had 2 and 8.
// Nothing in the log says which machine the run had. So the emulator is given
// 4 cores, written once, and the job prints the CPUs and memory it got.

/** The cores the emulator asks for, in every run's log: "will run more smoothly with 4 CPU cores". */
const EMULATOR_ADVISED_CORES = 4;

/**
 * The CPUs of GitHub's standard Linux runner for a public repository (GitHub's
 * docs, 2026-09-28). A private repository's has 2: if this one goes private
 * again, this number changes, and EMULATOR_CORES with it.
 */
const RUNNER_CPUS = 4;

/**
 * What the fake runner's nproc, free and /proc/meminfo say: 6 CPUs and 23 GiB,
 * numbers no step prints by itself, so a step that prints them has read them.
 */
const FAKE_HARDWARE = {
  cpus: '6',
  free: [
    '               total        used        free      shared  buff/cache   available',
    'Mem:            23Gi       1.2Gi        19Gi       2.0Mi       2.3Gi        21Gi',
    'Swap:          3.0Gi          0B       3.0Gi',
  ].join('\n'),
  meminfo: [
    'MemTotal:       24117248 kB',
    'MemFree:        19922944 kB',
    'MemAvailable:   22020096 kB',
  ].join('\n'),
  /** The total, as free -h or /proc/meminfo prints it. */
  memory: /(?<![\w.])(?:23Gi|24117248)(?![\w.])/,
};

// Android's command-line tools (added 2026-09-27). Run 36303366850, job
// 108575130560, passed the KVM step and printed `/dev/root 72G 51G 22G 71% /`
// before the emulator, and then the emulator action stopped with:
//   Error: No device found matching --device pixel_8.
// The runner image (ubuntu-24.04 20260920.314) ships the command-line tools
// 12.0, whose avdmanager knows pixel_6 to pixel_7_pro and no pixel_8. The
// pinned action (a421e43, src/sdk-installer.ts) installs its own 20.0 only when
// $ANDROID_HOME/cmdline-tools does not exist, and puts cmdline-tools/latest/bin
// first on PATH either way, so whatever is in latest is the avdmanager it runs.
// 20.0's knows pixel_8. So a step before the emulator puts 20.0 in latest,
// from Google's archive, checked against a pinned SHA-256. The archive's size
// (172789259) and SHA-1 (48833c34b761c10cb20bcd16582129395d121b27) match
// Google's repository2-3.xml; the SHA-256 was computed from that download.
// It unpacks to one top-level folder, cmdline-tools/.
const CMDLINE_TOOLS = {
  archive: 'commandlinetools-linux-14742923_latest.zip',
  url: 'https://dl.google.com/android/repository/commandlinetools-linux-14742923_latest.zip',
  sha256: '04453066b540409d975c676d781da1477479dde3761310f1a7eb92a1dfb15af7',
  latest: `${RUNNER.sdk}/cmdline-tools/latest`,
};

/**
 * A fake folder of command-line tools, as file in the folder to
 * [executable, content]. `from` marks every file, so a file of one set is
 * never mistaken for the same file of another.
 */
const cmdlineToolsFiles = (version, from) => ({
  'source.properties': [
    false,
    `Pkg.Revision=${version}\nPkg.Path=cmdline-tools;${version}\nPkg.Desc=Android SDK Command-line Tools\n#${from}\n`,
  ],
  'bin/sdkmanager': [
    true,
    `#!/bin/sh\n#${from}\ncase "$1" in --version) echo ${version} ;; *) echo "fake sdkmanager: $*" ;; esac\n`,
  ],
  'bin/avdmanager': [true, `#!/bin/sh\n#${from}\necho "fake avdmanager: $*"\n`],
  [`lib/${from}.jar`]: [false, `${from}\n`],
  'NOTICE.txt': [false, `${from}\n`],
});

/** What the runner has in cmdline-tools/latest before the job changes it: 12.0, with a file 20.0 does not have. */
const OLD_CMDLINE_TOOLS = cmdlineToolsFiles('12.0', 'runner-12.0');

/** More of the runner's SDK: in no rm check's KEPT, and still not the command-line tools step's to touch. */
const SDK_FILES = [
  `${RUNNER.sdk}/licenses/android-sdk-license`,
  `${RUNNER.sdk}/build-tools/36.0.0/aapt2`,
  `${RUNNER_NDK}/source.properties`,
];

/** The step that builds the app. */
const builds = (step) => /pnpm run e2e:android --build-only\b/.test(step);

/** Words that only run the command after them: `sudo rm` is an rm. */
const PREFIXES = new Set([
  'sudo',
  'xargs',
  'command',
  'exec',
  'nice',
  'time',
  'then',
  'do',
  'else',
]);

/**
 * The shell commands in a step's text, in order, each as its words: line
 * continuations joined, `${{ … }}` kept as one word, `$(…)` read as a command
 * of its own, a leading `run:`,
 * `script:`, `(` or `{` taken off, sudo and the like dropped with their
 * options, and a trailing `# comment` dropped.
 */
function shellCommands(step) {
  return step
    .replace(/\\\n/g, ' ')
    .replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, '${{$1}}')
    .split(/\n|;|&&|\|\|?|\$\(|`/)
    .map((command) => {
      const words = command
        .replace(/^\s*(?:-\s+)?(?:run|script):\s*(?:[|>][-+]?)?/, '')
        .replace(/^\s*(?:[({]\s*)+/, '')
        .replace(/[\s)]+$/, '')
        .split(/\s+/)
        .filter((word) => word !== '');
      const comment = words.findIndex((word) => word.startsWith('#'));
      if (comment !== -1) words.length = comment;
      while (words.length > 0 && PREFIXES.has(words[0] ?? '')) {
        words.shift();
        while ((words[0] ?? '').startsWith('-')) words.shift();
      }
      return words;
    })
    .filter((words) => words.length > 0);
}

const REMOVERS = new Set(['rm', 'rmdir', 'unlink']);

/** A command that removes files: rm, rmdir or unlink, a find that deletes, an rsync --delete. */
const isRemoval = (words) =>
  REMOVERS.has(words[0] ?? '') ||
  (words[0] === 'find' &&
    (words.includes('-delete') ||
      (words.some((word) => /^-(?:exec|execdir|ok|okdir)$/.test(word)) &&
        words.some((word) => REMOVERS.has(word))))) ||
  (words[0] === 'rsync' && words.some((word) => word.startsWith('--delete')));

/** A step with at least one command that removes files. */
const removesFiles = (step) => shellCommands(step).some(isRemoval);

/**
 * A shell word as a path on the runner: quotes off, runner variables and `~`
 * put in, and a relative path read from the workspace. A variable this does not
 * know stays as it is, and so matches nothing.
 */
function onRunner(word) {
  const named = word
    .replace(/["']/g, '')
    .replace(/\$\{\{\s*github\.workspace\s*\}\}/g, RUNNER.workspace)
    .replace(/\$\{\{\s*runner\.tool_cache\s*\}\}/g, RUNNER.toolCache)
    .replace(/\$\{\{\s*runner\.temp\s*\}\}/g, RUNNER.temp)
    .replace(/\$\{(\w+)(?:[:?=+-][^}]*)?\}/g, '$$$1')
    .replace(/^~(?=\/|$)/, RUNNER.home)
    .replace(/\$(\w+)/g, (whole, name) =>
      Object.hasOwn(RUNNER_VARS, name) ? RUNNER_VARS[name] : whole,
    );
  const absolute =
    named.startsWith('/') || named.startsWith('$') ? named : `${RUNNER.workspace}/${named}`;
  const normal = path.posix.normalize(absolute);
  return normal === '/' ? normal : normal.replace(/\/+$/, '');
}

/** What an rm, rmdir or unlink names, each as a path on the runner. */
const removedBy = (words) =>
  REMOVERS.has(words[0] ?? '')
    ? words
        .slice(1)
        .filter((word) => !word.startsWith('-') && word.replace(/["']/g, '') !== '')
        .map(onRunner)
    : [];

/** Whether removing `target`, a path on the runner that may hold * or ?, removes `kept` or part of it. */
function removesPartOf(target, kept) {
  const glob = new RegExp(
    `^${target
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')}$`,
  );
  const holders = kept.split('/').map((_, at, parts) => parts.slice(0, at + 1).join('/') || '/');
  const literal = target.split(/[*?[]/)[0] ?? '';
  return holders.some((holder) => glob.test(holder)) || literal.startsWith(`${kept}/`);
}

/** Every rm in a step's text that removes something in KEPT, as "word removes what". */
const endangered = (step) =>
  shellCommands(step).flatMap((words) =>
    removedBy(words).flatMap((target, at) =>
      KEPT.filter((kept) => removesPartOf(target, kept.path)).map(
        (kept) =>
          `${words.slice(1).filter((word) => !word.startsWith('-'))[at]} removes ${kept.what}`,
      ),
    ),
  );

/** `./gradlew --stop`, `gradle --stop`, or a pkill or killall of Gradle. */
const stopsGradle = (words) =>
  (/(?:^|\/)gradlew?$/.test(words[0] ?? '') && words.includes('--stop')) ||
  (/^(?:pkill|killall)$/.test(words[0] ?? '') && words.some((word) => /gradle/i.test(word)));

/** `df -h` of every filesystem, or with `/` among those it names. */
function printsRootSpace(words) {
  if (words[0] !== 'df') return false;
  const rest = words.slice(1);
  const human = rest.some(
    (word) => /^-[A-Za-z]*[hH]/.test(word) || word === '--human-readable' || word === '--si',
  );
  const named = rest
    .filter((word, at) => !word.startsWith('-') && !/^-[xt]$/.test(rest[at - 1] ?? ''))
    .map((word) => word.replace(/["']/g, ''));
  return human && (named.length === 0 || named.includes('/'));
}

/** `nproc`, also as `$(nproc)` inside an echo, whose `)` stays on the word. */
const countsCpus = (words) => /^nproc(?![\w.-])/.test(words[0] ?? '');

/** `free`, or any command that reads /proc/meminfo. */
const showsMemory = (words) =>
  /^free(?![\w.-])/.test(words[0] ?? '') ||
  words.some((word) => /\/proc\/meminfo(?![\w.-])/.test(word));

/** A step that runs nproc or free, or reads /proc/meminfo. */
const printsHardware = (step) =>
  shellCommands(step).some((words) => countsCpus(words) || showsMemory(words));

/** android-e2e's steps before its first emulator step, and the build's index among them. */
function beforeTheEmulator() {
  const steps = ciSteps('android-e2e');
  const emulator = steps.findIndex(bootsEmulator);
  const before = steps.slice(0, emulator === -1 ? steps.length : emulator);
  return { steps: before, build: before.findIndex(builds) };
}

/** The commands before the first emulator step, in order, each with its step's index. */
function commandsBeforeTheEmulator() {
  const { steps, build } = beforeTheEmulator();
  return {
    build,
    commands: steps.flatMap((step, at) =>
      shellCommands(step).map((words) => ({ step: at, words })),
    ),
  };
}

/** A step's `run:` script in any YAML form (`|`, `>`, one line), or '' when it has none. */
function scriptOf(step) {
  const lines = step.split('\n');
  const at = lines.findIndex((line) => /^\s*(?:-\s+)?run:/.test(line));
  if (at === -1) return '';
  const head = (lines[at] ?? '').replace(/^\s*(?:-\s+)?run:\s*/, '');
  if (!/^[|>][-+]?\s*$/.test(head)) return `${head}\n`;
  const body = lines.slice(at + 1);
  const depth = (line) => /^ */.exec(line)?.[0].length ?? 0;
  const indent = depth(body.find((line) => line.trim() !== '') ?? '');
  const end = body.findIndex((line) => line.trim() !== '' && depth(line) < indent);
  const text = (end === -1 ? body : body.slice(0, end)).map((line) => line.slice(indent));
  return `${text.join(head.startsWith('>') ? ' ' : '\n')}\n`;
}

/** A step's own `env:` block, as name to value, or an empty object. */
function stepEnv(step) {
  const lines = step.split('\n');
  const at = lines.findIndex((line) => /^ {8}env:\s*$/.test(line));
  const env = {};
  if (at === -1) return env;
  for (const line of lines.slice(at + 1)) {
    if (!/^ {10}\S/.test(line)) break;
    const match = /^ {10}([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (match?.[1] !== undefined) env[match[1]] = (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

/** How GitHub runs a step's script: `bash -e`, or `-eo pipefail` under `shell: bash`. */
function shellFlags(step) {
  const shell = /^\s*shell:\s*(\S+)\s*$/m.exec(step)?.[1];
  if (shell === undefined) return ['-e'];
  if (shell === 'bash') return ['--noprofile', '--norc', '-eo', 'pipefail'];
  return ['-c', `echo "the test does not know how GitHub runs shell: ${shell}"; exit 99`];
}

/**
 * The text with every absolute path but /dev, /proc and /sys, and every runner
 * expression, moved under `root`. /proc/meminfo is moved too (BUG-6): the fake
 * runner has its own, FAKE_HARDWARE's, and macOS has no /proc.
 */
const intoFakeRunner = (text, root) =>
  text
    .replace(/\$\{\{\s*github\.workspace\s*\}\}/g, RUNNER.workspace)
    .replace(/\$\{\{\s*runner\.tool_cache\s*\}\}/g, RUNNER.toolCache)
    .replace(/\$\{\{\s*runner\.temp\s*\}\}/g, RUNNER.temp)
    .replace(
      /(^|[\s"'=:(<>])\/(?!(?:dev|sys)(?![\w.-])|proc(?![\w.-])(?!\/meminfo(?![\w.-])))(?=[\w.~-])/gm,
      (_, before) => `${before}${root}/`,
    );

/**
 * Tools that remove, move, unpack or change files. On the fake runner they are
 * the real ones behind a fence, and each call is recorded. tar joined them for
 * oasdiff's archive, a tar.gz (INF-10-AC16), as unzip is here for Google's.
 */
const FENCED = ['rm', 'rmdir', 'unlink', 'find', 'mv', 'rsync', 'cp', 'unzip', 'chmod', 'tar'];

/**
 * Tools a step may call to free space or report on it. On the fake runner they
 * only record the call. df, nproc and free also print what FAKE_HARDWARE and
 * a full disk would (fakeToolsDir).
 */
const RECORDED = [
  'docker',
  'podman',
  'gradle',
  'pkill',
  'killall',
  'apt-get',
  'apt',
  'snap',
  'systemctl',
  'swapoff',
  'du',
  'java',
  'jps',
  'chown',
];

/** A tool script that records its call in the fake runner's calls.log, then runs `then`. */
const recorder = (then = '') =>
  `#!/bin/sh\necho "$(basename "$0") $*" >> "$FAKE_RUNNER/calls.log"\n${then}`;

/** The real `name`, behind a fence: any path it is given outside $FAKE_RUNNER stops the step with 97. */
function fenced(name) {
  const real = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' }).stdout.trim();
  return [
    '#!/bin/sh',
    '[ -n "$FAKE_RUNNER" ] || { echo "fake runner: FAKE_RUNNER is not set" >&2; exit 97; }',
    `echo "${name} $*" >> "$FAKE_RUNNER/calls.log"`,
    'for arg in "$@"; do',
    '  case "$arg" in -*) continue ;; esac',
    '  if [ -d "$arg" ]; then dir="$arg"; else dir=$(dirname -- "$arg"); fi',
    '  real=$(cd -- "$dir" 2>/dev/null && pwd -P) || continue',
    '  case "$real/" in "$FAKE_RUNNER"/*) ;; *)',
    `    echo "fake runner: refused ${name} $arg, which is outside the fake runner" >&2`,
    '    exit 97 ;;',
    '  esac',
    'done',
    real === ''
      ? `echo "fake runner: this machine has no ${name}" >&2; exit 127`
      : `exec '${real}' "$@"`,
    '',
  ].join('\n');
}

/**
 * A fake download tool. It records its call, then serves $FAKE_DOWNLOAD at
 * $FAKE_DOWNLOAD_URL and fails for any other URL, as curl -f does for a 404.
 * It writes to stdout or to a file inside the fake runner, nowhere else.
 * `init` and `parse` are shell: `parse` is the `case` that reads its arguments
 * into url, out (the file) and remote (a directory to save under the URL's own
 * name).
 */
const downloader = (name, init, parse) =>
  [
    recorder(),
    `url=''; out=''; ${init}`,
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    ...parse.map((line) => `    ${line}`),
    '  esac',
    '  shift',
    'done',
    `[ -n "$url" ] || { echo "fake runner: ${name} was given no URL" >&2; exit 2; }`,
    'if [ "$url" != "$FAKE_DOWNLOAD_URL" ] || [ -z "$FAKE_DOWNLOAD" ]; then',
    `  echo "fake runner: ${name}: nothing to download at $url, the fake runner serves only the pinned archive" >&2`,
    '  exit 22',
    'fi',
    'if [ -z "$out" ] && [ -n "$remote" ]; then out="$remote/$(basename "$url")"; fi',
    'if [ -z "$out" ] || [ "$out" = - ]; then exec cat "$FAKE_DOWNLOAD"; fi',
    `dir=$(cd -- "$(dirname -- "$out")" 2>/dev/null && pwd -P) || { echo "fake runner: ${name} cannot write $out" >&2; exit 23; }`,
    'case "$dir/" in "$FAKE_RUNNER"/*) ;; *)',
    `  echo "fake runner: refused ${name} to $out, which is outside the fake runner" >&2`,
    '  exit 97 ;;',
    'esac',
    'cat "$FAKE_DOWNLOAD" > "$out"',
    '',
  ].join('\n');

/**
 * sdkmanager or avdmanager called by name. runner-images'
 * images/ubuntu/scripts/build/install-android-sdk.sh (read 2026-09-27) sets
 * ANDROID_HOME and ANDROID_SDK_ROOT and puts nothing on PATH; its own tests
 * call sdkmanager by its full path.
 */
const notOnPath = (name) =>
  recorder(
    `echo "fake runner: ${name} is not on the runner's PATH; call it by its path, $ANDROID_HOME/cmdline-tools/latest/bin/${name}" >&2\nexit 127\n`,
  );

/**
 * The fake runner's tools, written once per run of this file and shared by
 * every fake runner: macOS checks each new executable the first time it runs,
 * at about 300 ms apiece. Each reads its fake runner from $FAKE_RUNNER, and
 * the fake build what to make from $FAKE_RUNNER_BUILT.
 */
let fakeTools = '';
function fakeToolsDir() {
  if (fakeTools !== '') return fakeTools;
  const bin = realpathSync(mkdtempSync(path.join(tmpdir(), 'fake-runner-tools-')));
  const tool = (name, text) => writeFileSync(path.join(bin, name), text, { mode: 0o755 });
  const skipOptions = 'while [ $# -gt 0 ]; do case "$1" in -*) shift ;; *) break ;; esac; done\n';
  for (const name of FENCED) tool(name, fenced(name));
  for (const name of RECORDED) tool(name, recorder());
  tool('sudo', recorder(`${skipOptions}exec "$@"\n`));
  tool('timeout', recorder(`${skipOptions}shift\nexec "$@"\n`));
  tool(
    'df',
    recorder(
      'echo "Filesystem Size Used Avail Use% Mounted on"\necho "/dev/root 72G 70G 2.0G 98% /"\n',
    ),
  );
  // BUG-6: macOS has neither, and a step that prints the hardware next to df
  // must still run to the end here.
  tool('nproc', recorder(`echo ${FAKE_HARDWARE.cpus}\n`));
  tool('free', recorder(`cat <<'EOF'\n${FAKE_HARDWARE.free}\nEOF\n`));
  tool(
    'pnpm',
    recorder(
      'case "$*" in *e2e:android*--build-only*)\n  for built in $FAKE_RUNNER_BUILT; do mkdir -p "$(dirname "$built")" && : > "$built"; done ;;\nesac\n',
    ),
  );
  tool('gradlew', recorder());
  tool(
    'curl',
    downloader('curl', "remote=''", [
      '-o|--output) out="$2"; shift ;;',
      '--output=*) out="${1#--output=}" ;;',
      '-O|--remote-name) remote=. ;;',
      'http://*|https://*) url="$1" ;;',
      '--*) ;;',
      '-*o) out="$2"; shift ;;',
      '-*O*) remote=. ;;',
    ]),
  );
  tool(
    'wget',
    downloader('wget', 'remote=.', [
      '-O|--output-document) out="$2"; shift ;;',
      '--output-document=*) out="${1#*=}" ;;',
      '-P|--directory-prefix) remote="$2"; shift ;;',
      '--directory-prefix=*) remote="${1#*=}" ;;',
      'http://*|https://*) url="$1" ;;',
      '--*) ;;',
      '-*O) out="$2"; shift ;;',
      '-*O?*) out="${1#*O}" ;;',
    ]),
  );
  for (const name of ['sdkmanager', 'avdmanager']) tool(name, notOnPath(name));
  // mktemp as GNU's on the runner: with no template, or with -p, --tmpdir or
  // -t, it creates in $TMPDIR, which is inside the fake runner. macOS's mktemp
  // ignores TMPDIR and would create outside it.
  const mktemp = spawnSync('sh', ['-c', 'command -v mktemp'], { encoding: 'utf8' }).stdout.trim();
  tool(
    'mktemp',
    [
      '#!/bin/sh',
      "flags=''; base=''; template=''",
      'while [ $# -gt 0 ]; do',
      '  case "$1" in',
      '    -p) base="$2"; shift ;;',
      '    --tmpdir=*) base="${1#*=}" ;;',
      '    --tmpdir|-t) base="$TMPDIR" ;;',
      '    -*) flags="$flags $1" ;;',
      '    *) template="$1" ;;',
      '  esac',
      '  shift',
      'done',
      'if [ -z "$template" ]; then template=tmp.XXXXXXXXXX; base="${base:-$TMPDIR}"; fi',
      'case "$template" in /*) ;; *) [ -z "$base" ] || template="$base/$template" ;; esac',
      `exec '${mktemp}' $flags "$template"`,
      '',
    ].join('\n'),
  );
  fakeTools = bin;
  return bin;
}

/**
 * Fake archives of command-line tools, each zipped once per run of this file,
 * laid out like Google's: one top-level cmdline-tools/ folder.
 *
 * @returns {{ zip: string, sha256: string, files: ReturnType<typeof cmdlineToolsFiles> }}
 */
const fakeArchives = new Map();
let fakeArchiveDir = '';
function fakeCmdlineTools(version, from) {
  const made = fakeArchives.get(from);
  if (made !== undefined) return made;
  if (fakeArchiveDir === '') {
    fakeArchiveDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'fake-cmdline-tools-')));
  }
  const dir = path.join(fakeArchiveDir, from);
  const files = cmdlineToolsFiles(version, from);
  for (const [name, [executable, content]] of Object.entries(files)) {
    const file = path.join(dir, 'cmdline-tools', name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content, { mode: executable ? 0o755 : 0o644 });
  }
  const zip = path.join(fakeArchiveDir, `${from}.zip`);
  const zipped = spawnSync('zip', ['-qrX', zip, 'cmdline-tools'], { cwd: dir, encoding: 'utf8' });
  if (zipped.status !== 0) {
    throw new Error(
      `zip could not make the fake archive ${from}: ${zipped.stderr ?? ''}${zipped.error?.message ?? ''}`,
    );
  }
  const archive = {
    zip,
    sha256: createHash('sha256').update(readFileSync(zip)).digest('hex'),
    files,
  };
  fakeArchives.set(from, archive);
  return archive;
}

/** Every file and symlink under `root`, as its path from there ('/usr/...') to "x content", "- content" or "-> target". */
function treeOf(root) {
  const tree = /** @type {Record<string, string>} */ ({});
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    const file = path.join(entry.parentPath, entry.name);
    const where = `/${path.relative(root, file).split(path.sep).join('/')}`;
    if (where === '/calls.log' || where === '/step.sh') continue;
    if (entry.isSymbolicLink()) tree[where] = `-> ${readlinkSync(file)}`;
    else if (entry.isFile()) {
      tree[where] =
        `${(statSync(file).mode & 0o111) === 0 ? '-' : 'x'} ${readFileSync(file, 'utf8')}`;
    }
  }
  return tree;
}

/** A set of cmdlineToolsFiles as treeOf writes it, by file in the folder. */
const asTree = (files) =>
  Object.fromEntries(
    Object.entries(files).map(([name, [executable, content]]) => [
      name,
      `${executable ? 'x' : '-'} ${content}`,
    ]),
  );

/** What cmdline-tools/latest holds in a tree, by file in the folder. */
const latestIn = (tree) =>
  Object.fromEntries(
    Object.entries(tree)
      .filter(([where]) => where.startsWith(`${CMDLINE_TOOLS.latest}/`))
      .map(([where, what]) => [where.slice(CMDLINE_TOOLS.latest.length + 1), what]),
  );

afterAll(() => {
  if (fakeTools !== '') rmSync(fakeTools, { recursive: true, force: true });
  if (fakeArchiveDir !== '') rmSync(fakeArchiveDir, { recursive: true, force: true });
});

/**
 * Runs the given android-e2e steps' scripts, in order, on a fake runner: a
 * temporary directory laid out like GitHub's (RUNNER), holding a file for each
 * of KEPT and FREED that is there before the build. Every absolute path and
 * runner variable in a script is moved into it. `pnpm run e2e:android
 * --build-only` makes what a build leaves (the APK, intermediates, .cxx) and
 * nothing else; sudo and timeout run their command; docker, gradle and the
 * other RECORDED tools record the call; the FENCED ones (rm, find, mv, rsync,
 * unzip and the like) are the real ones behind a fence, so nothing here can
 * touch the machine the test runs on. The runner's command-line tools, 12.0,
 * are in cmdline-tools/latest. curl and wget serve `download` at the pinned
 * archive's URL and nothing else, so no step downloads anything for real.
 * Stops at the first step that fails, as GitHub does.
 *
 * @param {string[]} steps
 * @param {Record<string, string>} [jobVars]
 * @param {{ download?: string, url?: string }} [options] `download`: the file served at `url`,
 *   which is CMDLINE_TOOLS.url unless a test names another (oasdiff's, INF-10-AC16).
 * @returns {{ status: number | null, output: string, present: string[], calls: string, tree: Record<string, string> }}
 *   `present`: the files of KEPT and FREED that are there afterwards. `tree`:
 *   everything that is there afterwards, as treeOf reads it.
 */
function onFakeRunner(steps, jobVars = {}, { download = '', url = CMDLINE_TOOLS.url } = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'fake-runner-')));
  const at = (where) => path.join(root, where);
  const log = at('calls.log');
  const tracked = [...KEPT, ...FREED];
  try {
    const bin = fakeToolsDir();
    for (const dir of [
      at(RUNNER.temp),
      at('/tmp'),
      at(`${RUNNER.workspace}/apps/mobile/android`),
    ]) {
      mkdirSync(dir, { recursive: true });
    }
    for (const file of [
      ...tracked.filter((entry) => !entry.built).map(({ file }) => file),
      ...SDK_FILES,
    ]) {
      mkdirSync(path.dirname(at(file)), { recursive: true });
      writeFileSync(at(file), '');
    }
    for (const [name, [executable, content]] of Object.entries(OLD_CMDLINE_TOOLS)) {
      const file = at(`${CMDLINE_TOOLS.latest}/${name}`);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content, { mode: executable ? 0o755 : 0o644 });
    }
    symlinkSync(path.join(bin, 'gradlew'), at(`${RUNNER.workspace}/apps/mobile/android/gradlew`));
    mkdirSync(at('/proc'));
    writeFileSync(at('/proc/meminfo'), `${FAKE_HARDWARE.meminfo}\n`);
    const env = {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      LC_ALL: 'C',
      CI: 'true',
      USER: 'runner',
      TMPDIR: at('/tmp'),
      FAKE_RUNNER: root,
      FAKE_RUNNER_BUILT: tracked
        .filter((entry) => entry.built)
        .map(({ file }) => at(file))
        .join(' '),
      FAKE_DOWNLOAD: download,
      FAKE_DOWNLOAD_URL: url,
      ...Object.fromEntries(
        Object.entries(jobVars).map(([name, value]) => [name, intoFakeRunner(value, root)]),
      ),
      ...Object.fromEntries(Object.entries(RUNNER_VARS).map(([name, where]) => [name, at(where)])),
      ...Object.fromEntries(
        ['GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_PATH', 'GITHUB_STEP_SUMMARY'].map((name) => [
          name,
          at(`${RUNNER.temp}/${name}`),
        ]),
      ),
    };
    let status = /** @type {number | null} */ (0);
    let output = '';
    for (const step of steps) {
      const script = at('step.sh');
      // `${{ env.NAME }}` in a step reads the step's own env as well as the job's.
      const vars = { ...jobVars, ...stepEnv(step) };
      writeFileSync(script, intoFakeRunner(resolveEnv(scriptOf(step), vars), root));
      const own = Object.fromEntries(
        Object.entries(stepEnv(step)).map(([name, value]) => [
          name,
          intoFakeRunner(resolveEnv(value, jobVars), root),
        ]),
      );
      const dir = /^\s*working-directory:\s*(.+?)\s*$/m.exec(step)?.[1];
      const result = spawnSync('bash', [...shellFlags(step), script], {
        cwd: at(dir === undefined ? RUNNER.workspace : onRunner(dir)),
        env: { ...env, ...own },
        encoding: 'utf8',
        timeout: 60_000,
      });
      output += `${step.split('\n')[0]}\n${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}\n`;
      status = result.status;
      if (status !== 0) break;
    }
    return {
      status,
      output,
      present: tracked.filter(({ file }) => existsSync(at(file))).map(({ file }) => file),
      calls: existsSync(log) ? readFileSync(log, 'utf8') : '',
      tree: treeOf(root),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The text with each of `vars` read as `${{ env.NAME }}`, `$NAME` or `${NAME…}` replaced by its value. */
const withVars = (text, vars) =>
  resolveEnv(text, vars).replace(
    /\$(?:\{(\w+)(?:[:?=+-][^}]*)?\}|(\w+))/g,
    (whole, braced, bare) => {
      const name = braced ?? bare;
      return Object.hasOwn(vars, name) ? vars[name] : whole;
    },
  );

/** A step whose text names the pinned archive, read with the job's env and its own. */
const usesTheArchive = (step, env) =>
  withVars(step, { ...env, ...stepEnv(step) }).includes(CMDLINE_TOOLS.archive);

/** android-e2e's steps that use the pinned archive. */
const cmdlineToolsSteps = () => {
  const env = jobEnv('android-e2e');
  return ciSteps('android-e2e').filter((step) => usesTheArchive(step, env));
};

/** android-e2e's step that installs the command-line tools, or ''. */
const cmdlineToolsStep = () => cmdlineToolsSteps()[0] ?? '';

const NO_STEP = `android-e2e has no step that uses the pinned archive, ${CMDLINE_TOOLS.archive}`;

/** The pinned archive's stand-in on the fake runner: 20.0, as Google's is. */
const pinnedTools = () => fakeCmdlineTools('20.0', 'archive-20.0');

/** The text with the pinned SHA-256 swapped for `sha256`: a fake archive stands in for Google's, and its hash for the pin. */
const repinned = (text, sha256) => text.replaceAll(CMDLINE_TOOLS.sha256, sha256);

/** Env with the pinned SHA-256 swapped for `sha256` in every value. */
const repinnedEnv = (env, sha256) =>
  Object.fromEntries(Object.entries(env).map(([name, value]) => [name, repinned(value, sha256)]));

/**
 * Runs `step` alone on a fake runner that serves `served` at the pinned URL,
 * with the pin swapped for the hash of `pinned`: by default `served`'s own, so
 * the download matches the pin, as Google's does.
 */
const installRun = (step, env, served, pinned = served) =>
  onFakeRunner([repinned(step, pinned.sha256)], repinnedEnv(env, pinned.sha256), {
    download: served.zip,
  });

/** What a single step printed: its output without the first line, which is the step's own, written by onFakeRunner. */
const printedBy = (run) => run.output.slice(run.output.indexOf('\n') + 1);

/** The files where two sets of files, by name, differ: missing, extra or changed. */
const differing = (got, want) =>
  [...new Set([...Object.keys(got), ...Object.keys(want)])]
    .filter((name) => got[name] !== want[name])
    .sort();

/**
 * The checks of a command-line tools step, each on fake runners. Each returns
 * '' when it holds, or what is wrong. The tests below run them on ci.yml's
 * step, and on steps done right and wrong, so each is known to notice what it
 * is for.
 */
const CMDLINE_TOOLS_CHECKS = {
  /** It downloads the pinned archive and leaves latest holding exactly its cmdline-tools folder. */
  installs(step, env) {
    if (step === '') return NO_STEP;
    const archive = pinnedTools();
    const run = installRun(step, env, archive);
    if (run.status !== 0) {
      return `with the pinned archive served, the step failed with ${run.status}:\n${run.output}`;
    }
    if (
      !run.calls
        .split('\n')
        .some((line) => /^(?:curl|wget) /.test(line) && line.includes(CMDLINE_TOOLS.url))
    ) {
      return `nothing downloaded ${CMDLINE_TOOLS.url}. The calls:\n${run.calls}`;
    }
    const wrong = differing(latestIn(run.tree), asTree(archive.files));
    return wrong.length === 0
      ? ''
      : `cmdline-tools/latest does not hold exactly the archive's cmdline-tools folder; these differ:\n${wrong.join('\n')}\n${run.output}`;
  },

  /** It prints the version it installed, read from latest: with an archive of another version, that version. */
  prints(step, env) {
    if (step === '') return NO_STEP;
    for (const version of ['20.0', '19.0']) {
      const run = installRun(step, env, fakeCmdlineTools(version, `archive-${version}`));
      const shown = new RegExp(`(?<![\\w.])${version.replace('.', '\\.')}(?![\\w.])`);
      if (!shown.test(printedBy(run))) {
        return `with an archive of version ${version} served and pinned, the step does not print ${version}:\n${run.output}`;
      }
    }
    return '';
  },

  /**
   * A download that does not match the pin fails the step before anything is
   * unpacked, and leaves latest as the runner had it. A pinned download that
   * passes is the control: without it, a step that always fails would pass.
   */
  verifiesFirst(step, env) {
    if (step === '') return NO_STEP;
    const pinned = pinnedTools();
    const control = installRun(step, env, pinned);
    if (control.status !== 0) {
      return `with the download that matches the pin, the step already fails, so its failing on one that does not would prove nothing:\n${control.output}`;
    }
    const run = installRun(step, env, fakeCmdlineTools('20.0', 'tampered-20.0'), pinned);
    if (run.status === 0) {
      return `a download whose SHA-256 is not the pin passed the step:\n${run.output}`;
    }
    const unpacked = [
      ...run.calls.split('\n').filter((line) => /^unzip /.test(line)),
      ...Object.entries(run.tree)
        .filter(
          ([, what]) =>
            what.includes('tampered-20.0') && !what.slice(2).startsWith('PK\u0003\u0004'),
        )
        .map(([where]) => where),
    ];
    if (unpacked.length > 0) {
      return `with a download whose SHA-256 is not the pin, the step unpacked it before it failed:\n${unpacked.join('\n')}`;
    }
    const wrong = differing(latestIn(run.tree), asTree(OLD_CMDLINE_TOOLS));
    return wrong.length === 0
      ? ''
      : `with a download whose SHA-256 is not the pin, cmdline-tools/latest did not keep the runner's own tools; these differ:\n${wrong.join('\n')}`;
  },

  /** It changes nothing outside cmdline-tools/latest. */
  touchesOnlyLatest(step, env) {
    if (step === '') return NO_STEP;
    const before = onFakeRunner([]).tree;
    const run = installRun(step, env, pinnedTools());
    if (run.status !== 0) {
      return `with the pinned archive served, the step failed with ${run.status}:\n${run.output}`;
    }
    const changed = Object.keys(before).filter(
      (where) => !where.startsWith(`${CMDLINE_TOOLS.latest}/`) && run.tree[where] !== before[where],
    );
    return changed.length === 0
      ? ''
      : `the step removed or changed what is not cmdline-tools/latest:\n${changed.join('\n')}`;
  },
};

/**
 * The steps the fake runner runs from android-e2e: before the first emulator,
 * the build, every step that removes files, and the one that installs the
 * command-line tools, served a stand-in for the pinned archive.
 */
const freeingRun = () => {
  const { steps } = beforeTheEmulator();
  const env = jobEnv('android-e2e');
  const tools = pinnedTools();
  return onFakeRunner(
    steps
      .filter((step) => builds(step) || removesFiles(step) || usesTheArchive(step, env))
      .map((step) => repinned(step, tools.sha256)),
    repinnedEnv(env, tools.sha256),
    { download: tools.zip },
  );
};

/** A step written the way ci.yml writes one, around `script`, for the checks' own tests. */
const stepAround = (name, script) =>
  [
    `      - name: ${name}`,
    "        if: steps.affected.outputs.app == 'true'",
    '        run: |',
    ...script.split('\n').map((line) => `          ${line}`),
  ].join('\n');

const BUILD_STEP = stepAround('Build the release app', 'pnpm run e2e:android --build-only');

/** Freeing that is right: what the checks below must all accept. */
const GOOD_FREEING = [
  'sudo rm -rf /usr/share/dotnet /opt/ghc /usr/local/.ghcup "$AGENT_TOOLSDIRECTORY/CodeQL" \\',
  '  "$ANDROID_HOME/ndk"',
  '(cd apps/mobile/android && ./gradlew --stop)',
  'rm -rf apps/mobile/android/app/build/intermediates apps/mobile/android/app/.cxx',
  'df -h /',
].join('\n');

/** rm commands that take something the flows need: the rm check must name each. */
const ENDANGERING = [
  'rm -rf "$ANDROID_HOME"',
  'sudo rm -rf /usr/local/lib/android',
  'rm -rf "${ANDROID_SDK_ROOT:?}/system-images"',
  'sudo rm -rf /usr/share/dotnet \\\n  /usr/local/lib/android/sdk/emulator',
  'rm -rf apps/mobile/android',
  'rm -rf ./apps/mobile/android/app/build',
  'rm -rf "${{ github.workspace }}/apps/mobile/android/app/build/outputs"',
  'rm -rf ~/.gradle',
  'rm -rf "$HOME/.gradle/caches/transforms-4"',
  'sudo rm -rf "$AGENT_TOOLSDIRECTORY"',
  'sudo rm -rf /opt/hostedtoolcache/*',
  'rm -rf "$JAVA_HOME"',
  'sudo rm -rf /usr/lib/jvm',
  'rm -rf node_modules',
];

/**
 * Freeing that takes something the flows need, some of it in ways no rm check
 * can read (a cd first, find, `$(…)`): the fake runner must notice each.
 */
const HARMFUL_FREEING = [
  'rm -rf apps/mobile/android/app/build',
  'cd apps/mobile/android && find . -type d -name build -prune -exec rm -rf {} +',
  'cd "$ANDROID_HOME" && rm -rf -- *',
  'sudo rm -rf "$(dirname "$JAVA_HOME")"',
  'rm -rf ~/.gradle/caches',
  'sudo rm -rf /usr/lib/jvm',
];

/** Shell that lets a failed command pass: `|| true`, `|| :`, `|| exit 0`, `set +e`, continue-on-error. */
const TOLERATES_FAILURE = /\|\|\s*(?:true\b|:(?=\s|$)|exit\s+0\b)|\bset\s+\+e\b|continue-on-error/;

/** The pin as job env, the way the examples below read it. */
const TOOLS_ENV = {
  CMDLINE_TOOLS_ARCHIVE: CMDLINE_TOOLS.archive,
  CMDLINE_TOOLS_SHA256: CMDLINE_TOOLS.sha256,
};

/** The lines of a command-line tools step done right, for the examples to rearrange. */
const TOOLS_LINE = {
  download: 'curl -fsSLo "$zip" "https://dl.google.com/android/repository/$CMDLINE_TOOLS_ARCHIVE"',
  check: 'echo "$CMDLINE_TOOLS_SHA256  $zip" | sha256sum -c -',
  unpack: 'unzip -q "$zip" -d "$RUNNER_TEMP/cmdline-tools-new"',
  remove: 'rm -rf "$ANDROID_HOME/cmdline-tools/latest"',
  move: 'mv "$RUNNER_TEMP/cmdline-tools-new/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"',
  print: 'grep "^Pkg.Revision=" "$ANDROID_HOME/cmdline-tools/latest/source.properties"',
};

/** A command-line tools step's script: `lines` after naming the download. */
const toolsScript = (...lines) =>
  ['zip="$RUNNER_TEMP/$CMDLINE_TOOLS_ARCHIVE"', ...lines].join('\n');

/** Installing done right: what every check must accept. */
const GOOD_TOOLS = toolsScript(
  TOOLS_LINE.download,
  TOOLS_LINE.check,
  TOOLS_LINE.unpack,
  TOOLS_LINE.remove,
  TOOLS_LINE.move,
  TOOLS_LINE.print,
);

/** Installing done wrong, each with the check that must notice and what it must say. */
const BAD_TOOLS = [
  {
    what: 'unpacks before it checks the SHA-256',
    check: 'verifiesFirst',
    says: /unpacked it before it failed/,
    script: toolsScript(
      TOOLS_LINE.download,
      TOOLS_LINE.unpack,
      TOOLS_LINE.check,
      TOOLS_LINE.remove,
      TOOLS_LINE.move,
      TOOLS_LINE.print,
    ),
  },
  {
    what: 'unpacks before it checks, into a directory a trap removes',
    check: 'verifiesFirst',
    says: /unpacked it before it failed/,
    script: toolsScript(
      'tmp=$(mktemp -d)',
      'trap \'rm -rf "$tmp"\' EXIT',
      TOOLS_LINE.download,
      'unzip -q "$zip" -d "$tmp"',
      TOOLS_LINE.check,
      TOOLS_LINE.remove,
      'mv "$tmp/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"',
      TOOLS_LINE.print,
    ),
  },
  {
    what: 'lets a mismatch pass with || true',
    check: 'verifiesFirst',
    says: /passed the step/,
    script: toolsScript(
      TOOLS_LINE.download,
      `${TOOLS_LINE.check} || true`,
      TOOLS_LINE.unpack,
      TOOLS_LINE.remove,
      TOOLS_LINE.move,
      TOOLS_LINE.print,
    ),
  },
  {
    what: 'checks no SHA-256 at all',
    check: 'verifiesFirst',
    says: /passed the step/,
    script: toolsScript(
      TOOLS_LINE.download,
      TOOLS_LINE.unpack,
      TOOLS_LINE.remove,
      TOOLS_LINE.move,
      TOOLS_LINE.print,
    ),
  },
  {
    what: "removes the runner's tools before the check",
    check: 'verifiesFirst',
    says: /did not keep the runner's own tools/,
    script: toolsScript(
      TOOLS_LINE.remove,
      TOOLS_LINE.download,
      TOOLS_LINE.check,
      TOOLS_LINE.unpack,
      TOOLS_LINE.move,
      TOOLS_LINE.print,
    ),
  },
  {
    what: 'copies 20.0 over 12.0, so what only 12.0 has stays',
    check: 'installs',
    says: /does not hold exactly[^]*lib\/runner-12\.0\.jar/,
    script: toolsScript(
      TOOLS_LINE.download,
      TOOLS_LINE.check,
      TOOLS_LINE.unpack,
      'cp -R "$RUNNER_TEMP/cmdline-tools-new/cmdline-tools/." "$ANDROID_HOME/cmdline-tools/latest/"',
      TOOLS_LINE.print,
    ),
  },
  {
    what: 'unpacks the cmdline-tools folder inside latest',
    check: 'installs',
    says: /does not hold exactly[^]*cmdline-tools\/source\.properties/,
    script: toolsScript(
      TOOLS_LINE.download,
      TOOLS_LINE.check,
      TOOLS_LINE.remove,
      'unzip -q "$zip" -d "$ANDROID_HOME/cmdline-tools/latest"',
      'grep "^Pkg.Revision=" "$ANDROID_HOME/cmdline-tools/latest/cmdline-tools/source.properties"',
    ),
  },
  {
    what: 'downloads the archive from somewhere else',
    check: 'installs',
    says: /nothing to download at https:\/\/mirror\.example\.org\//,
    script: toolsScript(
      TOOLS_LINE.download.replace('dl.google.com', 'mirror.example.org'),
      TOOLS_LINE.check,
      TOOLS_LINE.unpack,
      TOOLS_LINE.remove,
      TOOLS_LINE.move,
      TOOLS_LINE.print,
    ),
  },
  {
    what: 'calls sdkmanager by name, which is not on the runner PATH',
    check: 'installs',
    says: /sdkmanager is not on the runner's PATH/,
    script: toolsScript(
      TOOLS_LINE.download,
      TOOLS_LINE.check,
      TOOLS_LINE.unpack,
      TOOLS_LINE.remove,
      TOOLS_LINE.move,
      'sdkmanager --version',
    ),
  },
  {
    what: 'says 20.0 without reading it from latest',
    check: 'prints',
    says: /does not print 19\.0/,
    script: toolsScript(
      TOOLS_LINE.download,
      TOOLS_LINE.check,
      TOOLS_LINE.unpack,
      TOOLS_LINE.remove,
      TOOLS_LINE.move,
      'echo "Installed the command-line tools 20.0"',
    ),
  },
  {
    what: 'prints the version before it replaces latest',
    check: 'prints',
    says: /does not print 20\.0/,
    script: toolsScript(
      TOOLS_LINE.download,
      TOOLS_LINE.check,
      TOOLS_LINE.print,
      TOOLS_LINE.unpack,
      TOOLS_LINE.remove,
      TOOLS_LINE.move,
    ),
  },
  {
    what: 'removes more of the SDK than cmdline-tools/latest',
    check: 'touchesOnlyLatest',
    says: /licenses\/android-sdk-license/,
    script: toolsScript(
      TOOLS_LINE.download,
      TOOLS_LINE.check,
      TOOLS_LINE.unpack,
      `${TOOLS_LINE.remove} "$ANDROID_HOME/licenses"`,
      TOOLS_LINE.move,
      TOOLS_LINE.print,
    ),
  },
];

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

  test('INF-06-AC12: the KVM step waits for udev to apply its rule before it checks /dev/kvm', () => {
    // `udevadm trigger` queues its events and returns without waiting for
    // them. Run 36298902708 wrote the rule at 06:02:08.1375 and found /dev/kvm
    // unusable at 06:02:08.1757, 38 ms later, on the image whose first run had
    // passed this step. Either wait is accepted: --settle (or its short form
    // -w) on the trigger itself, or `udevadm settle` after the trigger and
    // before the check.
    const step = kvmStep();
    const trigger = kvmTrigger(step);
    const after = (trigger?.index ?? 0) + (trigger?.[0].length ?? 0);
    const check = step.search(KVM_USABLE);
    const waits =
      /(?:^|\s)(?:--settle|-w)(?=\s|$)/.test(trigger?.[1] ?? '') ||
      /\budevadm\s+settle\b/.test(step.slice(after, check));

    expect(trigger, 'no `udevadm trigger --name-match=kvm` in the KVM step').toBeDefined();
    expect(check).toBeGreaterThan(after);
    expect(waits, `nothing waits for udev between the trigger and the check:\n${step}`).toBe(true);
  });

  test('INF-06-AC12: before it stops, the KVM step prints the ls -l line of /dev/kvm, with its mode and group', () => {
    // So a red run tells wrong permissions (the rule did not take) apart from
    // a device that is not there (the runner has no KVM). Printed after the
    // trigger and before `exit 1`: on failure only, or always.
    const step = kvmStep();
    const from = kvmTrigger(step)?.index ?? -1;
    const check = step.search(KVM_USABLE);
    const exit = check + step.slice(check).search(/\bexit 1\b/);

    expect(from).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(from);
    expect(exit).toBeGreaterThan(check);
    expect(step.slice(from, exit)).toMatch(/\bls\s+-[A-Za-z]*l[A-Za-z]*\b[^\n;&|]*\/dev\/kvm\b/);
  });

  test('INF-06-AC12: with no /dev/kvm at all, the KVM step says the device does not exist, then stops with its ::error and exit 1', () => {
    // Run as GitHub runs it, under `bash -e`: an `ls -l` of a device that is
    // not there fails, and unguarded it would end the step before the ::error
    // line, so the run would be red without its reason.
    const { status, output } = runWithoutKvm(kvmStep());

    expect(status, output).toBe(1);
    expect(output).toMatch(/::error::/);
    expect(output).toMatch(ABSENT);
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
    // Amended 2026-09-28 (BUG-6): and the core count, one more setting the
    // device is made with. The evidence is above EMULATOR_ADVISED_CORES.
    expect(settings, 'the snapshot key does not read EMULATOR_CORES').toContain('EMULATOR_CORES');
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

  test('INF-06-AC12: one API level, EMULATOR_API_LEVEL, is the api-level of every emulator step, and none sets system-image-api-level', () => {
    // Added 2026-09-27, after the first real run (below). The job had two
    // levels, api-level '37' and system-image-api-level '37.2'. The action
    // installs `platforms;android-<api-level>` and takes the image's level
    // from system-image-api-level, so the two could name different Androids,
    // and the first one named a platform that does not exist. One level for
    // both leaves no second value to drift (docs/specs/INF-06.md: one API
    // level only).
    const env = jobEnv('android-e2e');
    const emulators = ciSteps('android-e2e').filter(bootsEmulator);

    expect(Object.keys(env).filter((name) => /API_LEVEL/.test(name))).toEqual([
      'EMULATOR_API_LEVEL',
    ]);
    expect(emulators.length).toBeGreaterThan(0);
    for (const step of emulators) {
      expect(step, step.split('\n')[0]).toMatch(
        /^\s*api-level:\s*\$\{\{\s*env\.EMULATOR_API_LEVEL\s*\}\}\s*$/m,
      );
      expect(step, step.split('\n')[0]).not.toMatch(/^\s*system-image-api-level:/m);
    }
  });

  test('INF-06-AC12: EMULATOR_API_LEVEL is major.minor, because a bare major names a platform package that does not exist', () => {
    // Added 2026-09-27. Run 36267216821, job 108474077955, step "Boot the
    // emulator in bokmål and run every flow", with api-level '37':
    //   sdkmanager --install 'build-tools;37.0.0' platform-tools 'platforms;android-37'
    //   Warning: Failed to find package 'platforms;android-37'
    // and the step failed before any emulator started. Since API levels
    // gained minor versions, Google's index (repository2-3.xml) lists
    // platforms;android-37.0, 37.1 and 37.2, and no android-37. A beta
    // (37.2-beta3) is not stable, and fails this too.
    expect(jobEnv('android-e2e').EMULATOR_API_LEVEL).toMatch(/^\d+\.\d+$/);
  });

  test('INF-06-AC12: the snapshot key reads every setting the emulator steps read, the API level included', () => {
    // Added 2026-09-27 (code review): the key read the image's level but not
    // api-level, the level the emulator steps install. Every setting that
    // shapes the device belongs in the key, or a snapshot made on one device
    // is restored for another.
    const steps = ciSteps('android-e2e');
    const read = [...new Set(steps.filter(bootsEmulator).flatMap(envNames))];
    const keyReads = steps
      .filter((step) => step.includes('~/.android/avd'))
      .flatMap((step) => envNames(/^\s*key:\s*(.+)$/m.exec(step)?.[1] ?? ''));

    expect(read).toContain('EMULATOR_API_LEVEL');
    // Amended 2026-09-28 (BUG-6): the core count too. Run 36418631362 saved
    // the snapshot of a 2-core device under
    // avd-37.2-google_apis_ps16k-x86_64-pixel_8-nb-NO; under a key that does
    // not read the cores, a 4-core job would restore that snapshot.
    expect(read, 'no emulator step reads EMULATOR_CORES').toContain('EMULATOR_CORES');
    for (const name of read) {
      expect(keyReads, `the snapshot key does not read ${name}`).toContain(name);
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

  // Freeing disk space before the emulator: the evidence is above RUNNER.

  test('INF-06-AC12: before the emulator, a step removes the .NET and GHC toolchains the job never uses, /usr/share/dotnet and /opt/ghc', () => {
    // Before or after the build, as long as it is before the emulator.
    const removed = commandsBeforeTheEmulator().commands.flatMap(({ words }) => removedBy(words));

    expect(removed).toContain('/usr/share/dotnet');
    expect(removed).toContain('/opt/ghc');
  });

  test('INF-06-AC12: after the build and before the emulator, a step stops the Gradle daemon', () => {
    // `./gradlew --stop`, `gradle --stop`, or a pkill or killall of Gradle.
    const { build, commands } = commandsBeforeTheEmulator();

    expect(build, 'no step builds the app before the emulator').toBeGreaterThan(-1);
    expect(
      commands.filter(({ step, words }) => step > build && stopsGradle(words)),
      'nothing between the build and the emulator stops the Gradle daemon',
    ).not.toEqual([]);
  });

  test("INF-06-AC12: after the build, and after anything is freed, the job prints the root filesystem's free space with df -h, before the emulator", () => {
    // In the step that frees space or in one of its own. After the freeing,
    // because a number printed before it says nothing about what the
    // emulator's SDK install will have.
    const { build, commands } = commandsBeforeTheEmulator();
    const lastRemoval = commands.findLastIndex(({ words }) => isRemoval(words));
    const shown = commands.flatMap(({ step, words }, at) =>
      step > build && printsRootSpace(words) ? [at] : [],
    );

    expect(build, 'no step builds the app before the emulator').toBeGreaterThan(-1);
    expect(shown, 'no `df -h` of / between the build and the emulator').not.toEqual([]);
    expect(Math.max(...shown), 'the free space is printed only before the freeing').toBeGreaterThan(
      lastRemoval,
    );
  });

  test("INF-06-AC12: on a fake runner, the steps up to the emulator remove .NET and GHC, and after the build the app's intermediates and .cxx", () => {
    // The fake build makes the intermediates and .cxx, so removing them
    // before the build does not count: the build would only make them again.
    const run = freeingRun();

    expect(run.status, run.output).toBe(0);
    for (const freed of FREED) {
      expect(run.present, `${freed.what} is still there:\n${run.output}`).not.toContain(freed.file);
    }
  });

  test("INF-06-AC12: on a fake runner, the steps up to the emulator leave the APK, ~/.gradle, the SDK's emulator, platform-tools, platforms and system-images, Java, Node and node_modules", () => {
    // Whatever removes them, rm or find or a cd first, which the rm check
    // below cannot read. Deleting the APK would fail loudly at install, but
    // only after a whole build; deleting ~/.gradle would have main save an
    // empty cache for every later run.
    const { steps } = beforeTheEmulator();
    const run = freeingRun();

    expect(
      steps.filter(removesFiles).length,
      'no step before the emulator removes anything, so nothing was put at risk and nothing is shown',
    ).toBeGreaterThan(0);
    expect(run.status, run.output).toBe(0);
    for (const kept of KEPT) {
      expect(run.present, `${kept.what} is gone:\n${run.output}`).toContain(kept.file);
    }
  });

  test('INF-06-AC12: no rm in the job names the APK, ~/.gradle, the SDK\'s emulator, platform-tools, platforms or system-images, Java, Node or node_modules, nor a directory that holds one, such as "$ANDROID_HOME" or apps/mobile/android', () => {
    const steps = ciSteps('android-e2e');
    const removals = steps.flatMap(shellCommands).filter((words) => REMOVERS.has(words[0] ?? ''));

    expect(
      removals.length,
      'android-e2e removes nothing, so there is nothing here to check',
    ).toBeGreaterThan(0);
    expect(steps.flatMap(endangered)).toEqual([]);
  });

  test('INF-06-AC12: the steps that free space, and the one that prints it, run whenever the flows do: guarded by exactly the app answer', () => {
    // A narrower guard (main only, say) would leave pull requests with a full
    // disk again.
    const { steps } = beforeTheEmulator();
    const freeing = steps.filter(
      (step) => removesFiles(step) || shellCommands(step).some(printsRootSpace),
    );

    expect(freeing.length, 'no step before the emulator frees space').toBeGreaterThan(0);
    for (const step of freeing) {
      expect(guardOf(step), step.split('\n')[0]).toBe("steps.affected.outputs.app == 'true'");
    }
  });

  test('INF-06-AC12: freeing space cannot let the job pass without the emulator: the build and the flows tolerate no failure', () => {
    // A build step that goes on to free space is where `|| true` or `set +e`
    // would creep in, and a failed build would then look like a finished one.
    const steps = ciSteps('android-e2e');
    const build = steps.filter(builds);
    const flows = steps.filter(runsFlows);

    expect(build).toHaveLength(1);
    expect(flows).toHaveLength(1);
    for (const step of [...build, ...flows]) {
      expect(step).not.toMatch(TOLERATES_FAILURE);
    }
  });

  // The checks' own tests: each check accepts a right way of freeing space,
  // and notices a wrong one.

  test('INF-06-AC12: the checks accept freeing done right, and the fake runner runs it to the end', () => {
    const step = stepAround('Free disk space for the emulator', GOOD_FREEING);
    const commands = shellCommands(step);
    const run = onFakeRunner([BUILD_STEP, step]);

    expect(commands.flatMap(removedBy)).toEqual(
      expect.arrayContaining(['/usr/share/dotnet', '/opt/ghc']),
    );
    expect(commands.some(stopsGradle)).toBe(true);
    expect(commands.some(printsRootSpace)).toBe(true);
    expect(endangered(step)).toEqual([]);
    expect(run.status, run.output).toBe(0);
    expect(run.present.sort()).toEqual(KEPT.map(({ file }) => file).sort());
    expect(run.calls).toMatch(/^gradlew --stop$/m);
  });

  test.each(ENDANGERING)('INF-06-AC12: the rm check notices %s', (script) => {
    expect(endangered(stepAround('Free disk space', script))).not.toEqual([]);
  });

  test.each(HARMFUL_FREEING)(
    'INF-06-AC12: the fake runner notices what the flows need is gone after %s',
    (script) => {
      const run = onFakeRunner([BUILD_STEP, stepAround('Free disk space', script)]);

      expect(run.status, run.output).toBe(0);
      expect(KEPT.filter(({ file }) => !run.present.includes(file))).not.toEqual([]);
    },
  );

  test('INF-06-AC12: the fake runner stops a step that reaches outside it, before rm runs', () => {
    // A path the script rewrite cannot see: relative, after a cd to /. The
    // file does not exist, so even without the fence nothing would be lost.
    const run = onFakeRunner([
      stepAround('Reach outside', 'cd / && rm -f trygghverdag-fake-runner-probe'),
    ]);

    expect(run.status, run.output).toBe(97);
    expect(run.output).toMatch(/outside the fake runner/);
  });

  // The command-line tools: the evidence is above CMDLINE_TOOLS.

  test("INF-06-AC12: one run step before the first emulator step uses the pinned command-line tools archive, since the runner's own 12.0 knows no pixel_8", () => {
    const steps = ciSteps('android-e2e');
    const tools = cmdlineToolsSteps();
    const emulator = steps.findIndex(bootsEmulator);

    expect(tools, NO_STEP).toHaveLength(1);
    expect(emulator).toBeGreaterThan(-1);
    expect(steps.indexOf(tools[0] ?? '')).toBeLessThan(emulator);
    expect(scriptOf(tools[0] ?? ''), 'the step has no run: script').not.toBe('');
    expect(tools[0]).not.toMatch(/^\s*-?\s*uses:/m);
  });

  test('INF-06-AC12: the command-line tools step is guarded by exactly the app answer', () => {
    // Narrower (main only, say), pull requests would boot the emulator on 12.0
    // and fail on pixel_8 again; wider, a diff that cannot change the app would
    // download 170 MB for nothing.
    const step = cmdlineToolsStep();

    expect(step, NO_STEP).not.toBe('');
    expect(guardOf(step)).toBe("steps.affected.outputs.app == 'true'");
  });

  test('INF-06-AC12: the archive name and its SHA-256 are each written once in ci.yml, both in the job env or both in that one step', () => {
    // So a new version is one edit, and the name and the hash cannot drift
    // apart. Comment lines do not count.
    const text = readFileSync(`${WORKFLOWS}/ci.yml`, 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    const env = Object.values(jobEnv('android-e2e')).join('\n');
    const step = cmdlineToolsStep();
    const pin = [CMDLINE_TOOLS.archive, CMDLINE_TOOLS.sha256];

    for (const value of pin) {
      expect(text.split(value).length - 1, `${value} is not written exactly once`).toBe(1);
    }
    expect(
      pin.every((value) => env.includes(value)) || pin.every((value) => step.includes(value)),
      'the archive name and its SHA-256 are not written in one place',
    ).toBe(true);
  });

  test('INF-06-AC12: the command-line tools step tolerates no failure', () => {
    const step = cmdlineToolsStep();

    expect(step, NO_STEP).not.toBe('');
    expect(step).not.toMatch(TOLERATES_FAILURE);
  });

  test('INF-06-AC12: on a fake runner, the command-line tools step downloads the pinned archive from dl.google.com and leaves cmdline-tools/latest holding exactly its cmdline-tools folder, 20.0, with nothing left of 12.0', () => {
    // The action puts latest/bin first on PATH, so latest is what it runs.
    expect(CMDLINE_TOOLS_CHECKS.installs(cmdlineToolsStep(), jobEnv('android-e2e'))).toBe('');
  });

  test('INF-06-AC12: on a fake runner, the command-line tools step prints the version now in cmdline-tools/latest, read from there', () => {
    // Served an archive of 19.0 as well, pinned to its hash: a step that says
    // "20.0" without reading it would print 20.0 there too. So a red emulator
    // step can be read against the version its log shows (D-070).
    expect(CMDLINE_TOOLS_CHECKS.prints(cmdlineToolsStep(), jobEnv('android-e2e'))).toBe('');
  });

  test('INF-06-AC12: on a fake runner, a download whose SHA-256 is not the pin fails the command-line tools step before anything is unpacked, and cmdline-tools/latest keeps 12.0', () => {
    expect(CMDLINE_TOOLS_CHECKS.verifiesFirst(cmdlineToolsStep(), jobEnv('android-e2e'))).toBe('');
  });

  test('INF-06-AC12: on a fake runner, the command-line tools step changes nothing outside cmdline-tools/latest', () => {
    // The emulator, platform-tools, platforms, system-images, the rest of the
    // SDK, the APK, ~/.gradle, Java and Node among them.
    expect(CMDLINE_TOOLS_CHECKS.touchesOnlyLatest(cmdlineToolsStep(), jobEnv('android-e2e'))).toBe(
      '',
    );
  });

  // The command-line tools checks' own tests.

  test('INF-06-AC12: the command-line tools checks accept a step done right', () => {
    const step = stepAround('Install the command-line tools', GOOD_TOOLS);

    expect(usesTheArchive(step, TOOLS_ENV)).toBe(true);
    expect(step).not.toMatch(TOLERATES_FAILURE);
    for (const [name, check] of Object.entries(CMDLINE_TOOLS_CHECKS)) {
      expect(check(step, TOOLS_ENV), name).toBe('');
    }
  });

  test.each(BAD_TOOLS)(
    'INF-06-AC12: the command-line tools checks notice a step that $what',
    ({ check, says, script }) => {
      const step = stepAround('Install the command-line tools', script);

      expect(CMDLINE_TOOLS_CHECKS[check](step, TOOLS_ENV)).toMatch(says);
    },
  );

  test('INF-06-AC12: every command-line tools check reports a job with no such step', () => {
    for (const [name, check] of Object.entries(CMDLINE_TOOLS_CHECKS)) {
      expect(check('', TOOLS_ENV), name).toBe(NO_STEP);
    }
  });

  // The emulator's cores and the runner's hardware: the evidence is above
  // EMULATOR_ADVISED_CORES. That the snapshot key reads the cores, and that
  // their value is written once, is in the two settings tests above.

  test('BUG-6: one core count, EMULATOR_CORES, is the cores of every emulator step, and nothing else sets how many cores the emulator has', () => {
    // Run 36418631362 logged `cores: 2` in both emulator steps: the pinned
    // action's default, because no step said otherwise. A -cores in
    // emulator-options, or an hw.cpu.ncore written by hand, would be a second
    // count that the snapshot key does not read.
    const env = jobEnv('android-e2e');
    const emulators = ciSteps('android-e2e').filter(bootsEmulator);

    expect(Object.keys(env).filter((name) => /CORE|CPU/.test(name))).toEqual(['EMULATOR_CORES']);
    expect(emulators.length).toBeGreaterThan(0);
    for (const step of emulators) {
      expect(step, step.split('\n')[0]).toMatch(
        /^\s*cores:\s*\$\{\{\s*env\.EMULATOR_CORES\s*\}\}\s*$/m,
      );
      expect(step, step.split('\n')[0]).not.toMatch(/(?:^|\s)-cores(?=[\s=]|$)/m);
    }
    expect(ciJob('android-e2e')).not.toMatch(/\bhw\.cpu\.ncore\b/);
  });

  test("BUG-6: EMULATOR_CORES is at least the 4 cores the emulator asks for, and at most the runner's 4 CPUs", () => {
    // At least: every run's emulator warned "AVD 'test' will run more smoothly
    // with 4 CPU cores (currently using 2)", and with 2, run 36418631362's
    // System UI stopped responding. At most: the emulator's cores are threads
    // on the runner's CPUs, which it shares with adb, Maestro and Node, so
    // more than the runner has are not more CPU, only more threads waiting
    // for it. Both bounds are 4, so it is '4' for now. RUNNER_CPUS is a public
    // repository's runner; a private one's has 2.
    const cores = jobEnv('android-e2e').EMULATOR_CORES ?? '';

    expect(cores, 'EMULATOR_CORES is not a whole number').toMatch(/^[1-9]\d*$/);
    expect(Number(cores), 'fewer cores than the emulator asks for').toBeGreaterThanOrEqual(
      EMULATOR_ADVISED_CORES,
    );
    expect(Number(cores), 'more cores than the runner has CPUs').toBeLessThanOrEqual(RUNNER_CPUS);
  });

  test('BUG-6: before the emulator, the job prints the CPUs it got with nproc and its memory with free or /proc/meminfo, in steps guarded by exactly the app answer', () => {
    // Nothing in run 36418631362's log says which machine it had, a public
    // repository's 4 CPUs and 16 GB or a private one's 2 and 8, so its red
    // could not be read against them (D-070). Guarded as the freeing steps
    // are: narrower (main only, say), a pull request's red run would show no
    // numbers.
    const { steps } = beforeTheEmulator();
    const cpus = steps.filter((step) => shellCommands(step).some(countsCpus));
    const memory = steps.filter((step) => shellCommands(step).some(showsMemory));

    expect(cpus, 'no step before the emulator runs nproc').not.toEqual([]);
    expect(memory, 'no step before the emulator runs free or reads /proc/meminfo').not.toEqual([]);
    for (const step of new Set([...cpus, ...memory])) {
      expect(guardOf(step), step.split('\n')[0]).toBe("steps.affected.outputs.app == 'true'");
    }
  });

  test('BUG-6: on a fake runner, those steps print the CPU count nproc gives and the memory total free or /proc/meminfo gives, and pass', () => {
    // nproc into a variable, or free with its output thrown away, would pass
    // the check above and print nothing. The fake runner has 6 CPUs and
    // 23 GiB (FAKE_HARDWARE), numbers no step prints by itself. The steps'
    // own first lines are taken out of the output, so a name cannot count.
    const steps = beforeTheEmulator().steps.filter(printsHardware);

    expect(
      steps,
      'no step before the emulator runs nproc or free, or reads /proc/meminfo',
    ).not.toEqual([]);
    const run = onFakeRunner(steps, jobEnv('android-e2e'));
    const printed = steps.reduce(
      (output, step) => output.replace(step.split('\n')[0] ?? '', ''),
      run.output,
    );

    expect(run.status, run.output).toBe(0);
    expect(printed, `nproc's ${FAKE_HARDWARE.cpus} is not printed:\n${run.output}`).toMatch(
      new RegExp(`(?<![\\w.])${FAKE_HARDWARE.cpus}(?![\\w.])`),
    );
    expect(printed, `the memory total is not printed:\n${run.output}`).toMatch(
      FAKE_HARDWARE.memory,
    );
  });
});

// The gate drills (INF-10, D-082). scripts/drills.test.mjs holds the seven
// offline drills and runs in the unit run, and `pnpm run gate:drills` reports
// them in the roadmap's nine rows. What follows holds where they run: in
// gate:full after the unit tests (AC13), in the unit run and not in the
// coverage run (AC14), and, for the CI-06 drill and its gate, beside an oasdiff
// that ci.yml installs from one pin (AC16).

describe('the gate drills in gate:full (INF-10)', () => {
  const drills = FULL_STEPS.find((step) => step.name === 'gate drills (INF-10)');

  test('INF-10-AC13: gate:full has a step "gate drills (INF-10)" that runs pnpm run gate:drills, after the unit tests', () => {
    const at = FULL_STEPS.findIndex((step) => step.name === 'gate drills (INF-10)');
    const unit = FULL_STEPS.findIndex((step) => step.command.join(' ') === 'pnpm run test:unit');

    expect(drills?.command).toEqual(['pnpm', 'run', 'gate:drills']);
    expect(drills?.needsScript).toBe('gate:drills');
    expect(unit).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(unit);
  });

  test('INF-10-AC13: the step needs nothing but its script, which runs scripts/gate-drills.mjs, so a session with no oasdiff and no token runs it too', () => {
    expect(scripts['gate:drills']).toMatch(/\bnode scripts\/gate-drills\.mjs\b/);
    expect(drills).toBeDefined();
    expect(drills?.needsTool).toBeUndefined();
    expect(drills?.needsEnv).toBeUndefined();
  });

  test('INF-10-AC13: the summary counts it like any other step: a pass as passed, a failure as failed', () => {
    if (drills === undefined)
      throw new Error('gate:full has no step named "gate drills (INF-10)".');
    const plan = planSteps([drills], scripts, {}, {});
    const passing = summarize(
      runPlan(plan, () => ({ ok: true, output: '' })),
      'gate:full',
    );
    const failing = summarize(
      runPlan(plan, () => ({ ok: false, output: 'CI-11 drill: ✗ got through' })),
      'gate:full',
    );

    expect(plan[0]?.willRun).toBe(true);
    expect(passing.text).toContain('gate:full: 1 passed, 0 failed, 0 not possible yet.');
    expect(passing.ok).toBe(true);
    expect(failing.text).toContain('gate:full: 0 passed, 1 failed, 0 not possible yet.');
    expect(failing.text).toContain('CI-11 drill: ✗ got through');
    expect(failing.ok).toBe(false);
  });
});

/** The test files a Vitest config collects, as `vitest list` reports them, relative to the repository. */
function collectedBy(config) {
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
  if (result.status !== 0) {
    throw new Error(`vitest list --config ${config} failed:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout).map((entry) => path.relative(process.cwd(), entry.file));
}

describe('the drills run in the unit run, and only there (INF-10)', () => {
  test('INF-10-AC14: the unit run collects the drill file, scripts/drills.test.mjs, so the required unit check runs it', () => {
    expect(collectedBy('vitest.config.mjs')).toContain('scripts/drills.test.mjs');
  });

  test('INF-10-AC14: the coverage run leaves the drill file out: coverage cannot see the gates a drill spawns, and traceability has no oasdiff', () => {
    const files = collectedBy('vitest.coverage.config.mjs');

    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('scripts/lib/gate-drills.test.mjs');
    expect(files).not.toContain('scripts/drills.test.mjs');
  });
});

// oasdiff, pinned (INF-10-AC16, D-082). api:diff compares the current API with
// every released version through oasdiff, and nothing installed it: once a
// version is released, the gate could only refuse to run. D-082 installs it the
// way the security job installs gitleaks, in the two jobs that need it: unit,
// where the CI-06 drill runs, and contract, where the gate runs. Version 1.32.1,
// Apache-2.0; the SHA-256 is the one the release's checksums.txt publishes for
// the archive, and the archive passed `sha256sum -c` against it in session on
// 2026-09-28.
const OASDIFF = {
  version: '1.32.1',
  archive: 'oasdiff_1.32.1_linux_amd64.tar.gz',
  url: 'https://github.com/oasdiff/oasdiff/releases/download/v1.32.1/oasdiff_1.32.1_linux_amd64.tar.gz',
  sha256: '7c8939fc49b75ee11fec66a5b83b37a2fca6aee109fed85013b1ba2ac2a1ee7f',
};

/** The jobs that need oasdiff, and the command there that needs it. */
const OASDIFF_JOBS = [
  { job: 'unit', needs: 'pnpm run test:unit' },
  { job: 'contract', needs: 'pnpm run api:diff' },
];

/** ci.yml's workflow-level env, which every job reads, as name to value with quotes taken off. */
function workflowEnv() {
  const lines = readFileSync(`${WORKFLOWS}/ci.yml`, 'utf8').split('\n');
  const at = lines.findIndex((line) => /^env:\s*$/.test(line));
  const env = {};
  if (at === -1) return env;
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^ {2}\S/.test(line)) break;
    const match = /^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (match?.[1] !== undefined) env[match[1]] = (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

/** The env a job's steps get: the workflow's, then the job's own. */
const envOfJob = (job) => ({ ...workflowEnv(), ...jobEnv(job) });

/** The steps of `job` that use the pinned oasdiff archive, read with the env each gets. */
const oasdiffSteps = (job) =>
  ciSteps(job).filter((step) =>
    withVars(step, { ...envOfJob(job), ...stepEnv(step) }).includes(OASDIFF.archive),
  );

/** `job`'s step that installs oasdiff, or ''. */
const oasdiffStep = (job) => oasdiffSteps(job)[0] ?? '';

/** The step of `job` whose script runs `command`, or ''. */
const stepRunning = (job, command) =>
  ciSteps(job).find((step) =>
    scriptOf(step)
      .split('\n')
      .some((line) => line.trim() === command),
  ) ?? '';

const noOasdiffStep = (job) =>
  `${job} has no step that uses the pinned oasdiff archive, ${OASDIFF.archive}`;
const NO_OASDIFF_STEP = `no step uses the pinned oasdiff archive, ${OASDIFF.archive}`;

/**
 * Fake oasdiff release archives, each tarred once per run of this file: an
 * oasdiff that says `marker` in its version, and a LICENSE, as the release's
 * archive holds.
 */
const fakeOasdiffs = new Map();
function fakeOasdiff(marker) {
  const made = fakeOasdiffs.get(marker);
  if (made !== undefined) return made;
  if (fakeArchiveDir === '') {
    fakeArchiveDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'fake-cmdline-tools-')));
  }
  const dir = path.join(fakeArchiveDir, `oasdiff-${marker.replaceAll(' ', '-')}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'oasdiff'),
    `#!/bin/sh\necho "oasdiff version ${OASDIFF.version} (${marker})"\n`,
    { mode: 0o755 },
  );
  writeFileSync(path.join(dir, 'LICENSE'), `Apache License, Version 2.0 (${marker})\n`);
  const archive = `${dir}.tar.gz`;
  const tarred = spawnSync('tar', ['-czf', archive, 'LICENSE', 'oasdiff'], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (tarred.status !== 0) {
    throw new Error(
      `tar could not make the fake oasdiff archive ${marker}: ${tarred.stderr ?? ''}${tarred.error?.message ?? ''}`,
    );
  }
  const value = {
    archive,
    marker,
    sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
  };
  fakeOasdiffs.set(marker, value);
  return value;
}

/** The folders on the ubuntu-latest runner's PATH that a step could put a tool in. */
const RUNNER_PATH_DIRS = [
  '/home/runner/.local/bin',
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/sbin',
  '/usr/bin',
  '/sbin',
  '/bin',
];

/** A first step making those folders in the fake runner, as the real runner has them. */
const RUNNER_PATH_STEP = stepAround(
  'The folders on the runner PATH, as ubuntu-latest has them',
  `mkdir -p ${RUNNER_PATH_DIRS.join(' ')}`,
);

/**
 * A later step asking for oasdiff by name, on the PATH GitHub gives a later
 * step: the folders the job wrote to GITHUB_PATH first, then the runner's own.
 */
const ASKS_FOR_OASDIFF = stepAround(
  'Ask for oasdiff by name, as test:unit and api:diff will',
  [
    `PATH="${RUNNER_PATH_DIRS.join(':')}:$PATH"`,
    'if [ -f "$GITHUB_PATH" ]; then',
    '  while IFS= read -r dir || [ -n "$dir" ]; do',
    '    if [ -n "$dir" ]; then PATH="$dir:$PATH"; fi',
    '  done < "$GITHUB_PATH"',
    'fi',
    'oasdiff --version || echo "no oasdiff on the PATH a later step gets"',
  ].join('\n'),
);

/** The text with the pinned SHA-256 swapped for `sha256`: a fake archive stands in for the release's, and its hash for the pin. */
const oasdiffRepinned = (text, sha256) => text.replaceAll(OASDIFF.sha256, sha256);

/**
 * Runs `steps` on a fake runner that serves `served` at the release's URL,
 * with the pin swapped for `pinned`'s hash: `served`'s own by default, so the
 * download matches the pin, as the release's does.
 */
const oasdiffRun = (steps, env, served, pinned = served) =>
  onFakeRunner(
    steps.map((step) => oasdiffRepinned(step, pinned.sha256)),
    Object.fromEntries(
      Object.entries(env).map(([name, value]) => [name, oasdiffRepinned(value, pinned.sha256)]),
    ),
    { download: served.archive, url: OASDIFF.url },
  );

/** What `step` printed in `run`: the output after the step's own first line. */
const printedByStep = (run, step) => {
  const first = step.split('\n')[0] ?? '';
  const at = run.output.lastIndexOf(first);
  return at === -1 ? run.output : run.output.slice(at + first.length);
};

/**
 * The checks of an oasdiff step, each on fake runners. Each returns '' when it
 * holds, or what is wrong. The tests below run them on ci.yml's two steps, and
 * on steps done right and wrong, so each is known to notice what it is for.
 */
const OASDIFF_CHECKS = {
  /** It downloads the pinned archive from the release, and a later step finds that archive's oasdiff by name. */
  landsOnPath(step, env) {
    if (step === '') return NO_OASDIFF_STEP;
    const pinned = fakeOasdiff('pinned stand-in');
    const run = oasdiffRun([RUNNER_PATH_STEP, step, ASKS_FOR_OASDIFF], env, pinned);
    if (run.status !== 0) {
      return `with the pinned archive served, the step failed with ${String(run.status)}:\n${run.output}`;
    }
    if (
      !run.calls
        .split('\n')
        .some((line) => /^(?:curl|wget) /.test(line) && line.includes(OASDIFF.url))
    ) {
      return `nothing downloaded ${OASDIFF.url}. The calls:\n${run.calls}`;
    }
    return printedByStep(run, ASKS_FOR_OASDIFF).includes(`(${pinned.marker})`)
      ? ''
      : `a later step does not find the archive's oasdiff on its PATH:\n${run.output}`;
  },

  /**
   * A download whose SHA-256 is not the pin stops the step, with a message,
   * before anything is unpacked. A pinned download that passes is the
   * control: without it, a step that always fails would pass.
   */
  verifiesFirst(step, env) {
    if (step === '') return NO_OASDIFF_STEP;
    const pinned = fakeOasdiff('pinned stand-in');
    const control = oasdiffRun([RUNNER_PATH_STEP, step], env, pinned);
    if (control.status !== 0) {
      return `with the download that matches the pin, the step already fails, so its failing on one that does not would prove nothing:\n${control.output}`;
    }
    const run = oasdiffRun([RUNNER_PATH_STEP, step], env, fakeOasdiff('tampered stand-in'), pinned);
    if (run.status === 0)
      return `a download whose SHA-256 is not the pin passed the step:\n${run.output}`;
    const unpacked = [
      ...run.calls.split('\n').filter((line) => /^tar /.test(line)),
      ...Object.entries(run.tree)
        .filter(
          ([, what]) => what.includes('(tampered stand-in)') && !what.slice(2).startsWith('\u001f'),
        )
        .map(([where]) => where),
    ];
    if (unpacked.length > 0) {
      return `with a download whose SHA-256 is not the pin, the step unpacked it before it failed:\n${unpacked.join('\n')}`;
    }
    return /checksum|sha-?256|FAILED|did not match/i.test(printedByStep(run, step))
      ? ''
      : `with a download whose SHA-256 is not the pin, the step stopped without saying why:\n${run.output}`;
  },
};

/** The pin as the workflow env gives it, the way the examples below read it. */
const OASDIFF_ENV = { OASDIFF_VERSION: OASDIFF.version, OASDIFF_SHA256: OASDIFF.sha256 };

/** The lines of an oasdiff step done right, for the examples to rearrange. */
const OASDIFF_LINE = {
  download:
    'curl -fsSLo "$archive" "https://github.com/oasdiff/oasdiff/releases/download/v${OASDIFF_VERSION}/oasdiff_${OASDIFF_VERSION}_linux_amd64.tar.gz"',
  check: 'echo "${OASDIFF_SHA256}  $archive" | sha256sum -c -',
  unpack: 'tar -xzf "$archive" -C "$RUNNER_TEMP/oasdiff" oasdiff',
  onPath: 'echo "$RUNNER_TEMP/oasdiff" >> "$GITHUB_PATH"',
};

/** An oasdiff step's script: `lines` after naming the download and making its folder. */
const oasdiffScript = (...lines) =>
  [
    'set -euo pipefail',
    'archive="$RUNNER_TEMP/oasdiff.tar.gz"',
    'mkdir -p "$RUNNER_TEMP/oasdiff"',
    ...lines,
  ].join('\n');

/** Installing done right: what every check must accept. */
const GOOD_OASDIFF = oasdiffScript(
  OASDIFF_LINE.download,
  OASDIFF_LINE.check,
  OASDIFF_LINE.unpack,
  OASDIFF_LINE.onPath,
);

/** Installing done wrong, each with the check that must notice and what it must say. */
const BAD_OASDIFF = [
  {
    what: 'unpacks before it checks the SHA-256',
    check: 'verifiesFirst',
    says: /unpacked it before it failed/,
    script: oasdiffScript(
      OASDIFF_LINE.download,
      OASDIFF_LINE.unpack,
      OASDIFF_LINE.check,
      OASDIFF_LINE.onPath,
    ),
  },
  {
    what: 'unpacks before it checks, into a folder a trap removes',
    check: 'verifiesFirst',
    says: /unpacked it before it failed/,
    script: oasdiffScript(
      'tmp=$(mktemp -d)',
      'trap \'rm -rf "$tmp"\' EXIT',
      OASDIFF_LINE.download,
      'tar -xzf "$archive" -C "$tmp" oasdiff',
      OASDIFF_LINE.check,
      'cp "$tmp/oasdiff" "$RUNNER_TEMP/oasdiff/oasdiff"',
      OASDIFF_LINE.onPath,
    ),
  },
  {
    what: 'lets a mismatch pass with || true',
    check: 'verifiesFirst',
    says: /passed the step/,
    script: oasdiffScript(
      OASDIFF_LINE.download,
      `${OASDIFF_LINE.check} || true`,
      OASDIFF_LINE.unpack,
      OASDIFF_LINE.onPath,
    ),
  },
  {
    what: 'checks no SHA-256 at all',
    check: 'verifiesFirst',
    says: /passed the step/,
    script: oasdiffScript(OASDIFF_LINE.download, OASDIFF_LINE.unpack, OASDIFF_LINE.onPath),
  },
  {
    what: 'leaves oasdiff off the PATH a later step gets',
    check: 'landsOnPath',
    says: /does not find the archive's oasdiff on its PATH/,
    script: oasdiffScript(OASDIFF_LINE.download, OASDIFF_LINE.check, OASDIFF_LINE.unpack),
  },
  {
    what: 'downloads the archive from somewhere else',
    check: 'landsOnPath',
    says: /nothing to download at https:\/\/mirror\.example\.org\//,
    script: oasdiffScript(
      OASDIFF_LINE.download.replace('github.com', 'mirror.example.org'),
      OASDIFF_LINE.check,
      OASDIFF_LINE.unpack,
      OASDIFF_LINE.onPath,
    ),
  },
];

describe('oasdiff in ci.yml, pinned (INF-10-AC16, D-082)', () => {
  test.each(OASDIFF_JOBS)(
    'INF-10-AC16: $job has one step that uses the pinned oasdiff archive, after it classifies the diff and before the step that runs $needs',
    ({ job, needs }) => {
      const steps = ciSteps(job);
      const install = oasdiffSteps(job);
      const classify = steps.findIndex((step) => /^\s*- id: affected\b/m.test(step));
      const needed = steps.indexOf(stepRunning(job, needs));

      expect(install, noOasdiffStep(job)).toHaveLength(1);
      expect(classify, `${job} does not classify the diff`).toBeGreaterThan(-1);
      expect(needed, `${job} has no step that runs ${needs}`).toBeGreaterThan(-1);
      expect(steps.indexOf(install[0] ?? '')).toBeGreaterThan(classify);
      expect(steps.indexOf(install[0] ?? '')).toBeLessThan(needed);
    },
  );

  test.each(OASDIFF_JOBS)(
    "INF-10-AC16: $job's oasdiff step is guarded by exactly the code answer, the guard of the step that needs it",
    ({ job, needs }) => {
      const install = oasdiffStep(job);

      expect(install, noOasdiffStep(job)).not.toBe('');
      expect(guardOf(install)).toBe("steps.affected.outputs.code == 'true'");
      expect(guardOf(install)).toBe(guardOf(stepRunning(job, needs)));
    },
  );

  test('INF-10-AC16: the version and the SHA-256 are each written once in ci.yml, in the workflow env both jobs read, and they are the pin D-082 records', () => {
    const text = readFileSync(`${WORKFLOWS}/ci.yml`, 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    const env = Object.values(workflowEnv());

    for (const value of [OASDIFF.version, OASDIFF.sha256]) {
      expect(text.split(value).length - 1, `${value} is not written exactly once`).toBe(1);
      expect(env, `${value} is not in the workflow env`).toContain(value);
    }
  });

  test.each(OASDIFF_JOBS)(
    'INF-10-AC16: $job checks out without persisting credentials, as android-e2e does, since a downloaded binary runs there',
    ({ job }) => {
      const checkouts = ciSteps(job).filter((step) => /uses: actions\/checkout@/.test(step));

      expect(checkouts.length, `${job} has no checkout step`).toBeGreaterThan(0);
      for (const checkout of checkouts) {
        expect(checkout, `${job}'s checkout keeps its credentials`).toMatch(
          /\bpersist-credentials:\s*false\b/,
        );
      }
    },
  );

  test.each(OASDIFF_JOBS)(
    "INF-10-AC16: $job's oasdiff step is a plain run step: no action, no secret, and it tolerates no failure",
    ({ job }) => {
      const install = oasdiffStep(job);

      expect(install, noOasdiffStep(job)).not.toBe('');
      expect(scriptOf(install), 'the step has no run: script').not.toBe('');
      expect(install).not.toMatch(/^\s*-?\s*uses:/m);
      expect(install).not.toMatch(/secrets\./);
      expect(install).not.toMatch(TOLERATES_FAILURE);
    },
  );

  test.each(OASDIFF_JOBS)(
    "INF-10-AC16: on a fake runner, $job's oasdiff step downloads the pinned archive from its release, and a later step finds a stand-in with the pinned hash on its PATH",
    ({ job }) => {
      expect(OASDIFF_CHECKS.landsOnPath(oasdiffStep(job), envOfJob(job))).toBe('');
    },
  );

  test.each(OASDIFF_JOBS)(
    "INF-10-AC16: on a fake runner, $job's oasdiff step stops, with a message, before it unpacks an archive whose SHA-256 is not the pin",
    ({ job }) => {
      expect(OASDIFF_CHECKS.verifiesFirst(oasdiffStep(job), envOfJob(job))).toBe('');
    },
  );

  // The oasdiff checks' own tests.

  test('INF-10-AC16: the oasdiff checks accept a step done right', () => {
    const step = stepAround('Install oasdiff', GOOD_OASDIFF);

    expect(withVars(step, OASDIFF_ENV)).toContain(OASDIFF.archive);
    for (const [name, check] of Object.entries(OASDIFF_CHECKS)) {
      expect(check(step, OASDIFF_ENV), name).toBe('');
    }
  });

  test.each(BAD_OASDIFF)(
    'INF-10-AC16: the oasdiff checks notice a step that $what',
    ({ check, says, script }) => {
      expect(OASDIFF_CHECKS[check](stepAround('Install oasdiff', script), OASDIFF_ENV)).toMatch(
        says,
      );
    },
  );

  test('INF-10-AC16: every oasdiff check reports a job with no such step', () => {
    for (const [name, check] of Object.entries(OASDIFF_CHECKS)) {
      expect(check('', OASDIFF_ENV), name).toBe(NO_OASDIFF_STEP);
    }
  });
});
