// req-coverage: fixtures-only — every ID below is synthetic (DRILL-01) or names a gate, never the product.
//
// INF-10: the gate drills (docs/specs/INF-10.md, D-082).
//
// Each drill is a scripted attempt to get a bad change past one gate, and the
// gate must refuse it. A drill tests the path, not the logic, which the gate's
// own tests already hold: it runs the command the real system runs, read from
// where the real system reads it and never retyped (AC10), on a real bad change
// in a scratch folder, and asks for the refusal in the gate's own words (AC8).
// Beside each attempt is a control that passes through the same gate.
//
// A drill against a working gate is green the first time it runs. So every
// drill here also runs with its gate swapped for a stand-in that always passes,
// and for one that fails with another message, and must say "not blocked" both
// times (AC9): each drill can go red, on every run.
//
// Test names say which drill they belong to, as `INF-10-AC1: RG-03 drill — …`
// does. `pnpm run gate:drills` sorts the results into the roadmap's nine rows
// by the ID in front of " drill" (scripts/lib/gate-drills.test.mjs, AC12). The
// push to main and the merge without the owner's approval are not drilled here:
// only GitHub can enforce them, and gate:integrity reads those rules (D-082).
//
// What a gate refuses, a skip form, a secret or a real-looking phone number, is
// put together at run time, so that no committed file holds one (AC11):
// scan-sensitive would refuse to write it, gitleaks reads every committed line,
// and RG-03 counts this file's own text.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, test } from 'vitest';
import { onlyInert } from './lib/affected.mjs';
import { matchesGlob } from './lib/glob.mjs';
import { CHECKS } from './lib/merge-rules.mjs';
import { TEST_GLOBS, strengthOf } from './lib/test-strength.mjs';

const REPO = realpathSync(path.resolve(import.meta.dirname, '..'));
const CI_YML = '.github/workflows/ci.yml';
const AI_REVIEW_YML = '.github/workflows/ai-review.yml';
const SETTINGS = '.claude/settings.json';
const IMPLEMENTER = '.claude/agents/implementer.md';

/** A repository file's text, as it is on disk now. */
const read = (file) => readFileSync(path.join(REPO, file), 'utf8');

/** Bounds on a hang, never a clock a drill reads (R16). */
const SPAWN_TIMEOUT = 90_000;
const SLOW = 180_000;

/** The repository's git status, which the drills must leave as they found it: AC11. */
const gitStatus = () =>
  execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: REPO,
    encoding: 'utf8',
  });
const STATUS_BEFORE = gitStatus();

// ---------------------------------------------------------------------------
// Text a gate refuses, put together at run time (Approach 6, AC11)
// ---------------------------------------------------------------------------

/** The words RG-03 counts, from their halves. */
const WORD = {
  test: ['te', 'st'].join(''),
  expect: ['exp', 'ect'].join(''),
  skipName: ['sk', 'ip'].join(''),
  runIfName: ['run', 'If'].join(''),
  failsName: ['fa', 'ils'].join(''),
  failingName: ['fa', 'iling'].join(''),
};

/** `a.b.c`, from its parts. */
const dotted = (...parts) => parts.join('.');

/** A synthetic hard-coded key, and the same code reading it from the environment. */
const KEY_NAME = ['api', 'Key'].join('');
const SECRET_LINE = `export const ${KEY_NAME} = "${'drill'.repeat(5)}";\n`;
const SECRET_FROM_ENV = `export const ${KEY_NAME} = process.env.DRILL_API_KEY;\n`;

/** A synthetic number in the shape of a Norwegian mobile one (RG-07), and the same code with none. */
const PHONE = ['+47', '400', '00', '000'].join(' ');
const NUMBER_LINE = `export const contact = "${PHONE}";\n`;
const NO_NUMBER = 'export const contact = process.env.DRILL_CONTACT;\n';

// ---------------------------------------------------------------------------
// Scratch folders, outside the repository and gone after each test · AC11
// ---------------------------------------------------------------------------

/** Every scratch folder this file made, and those still to remove. */
const MADE = [];
let toRemove = [];
/** The stand-in tools of the test that is running, made when first asked for. */
let tools = null;

/** A new folder under the system's temporary folder. */
function scratch(name) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), `inf10-${name}-`)));
  MADE.push(dir);
  toRemove.push(dir);
  return dir;
}

/** Removes every scratch folder made since the last call. */
function removeScratch() {
  for (const dir of toRemove) rmSync(dir, { recursive: true, force: true });
  toRemove = [];
  tools = null;
}

afterEach(removeScratch);

/** Writes `files` (path → text) under `dir`. */
function writeFiles(dir, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
}

/** Runs `make` once, the first time its answer is asked for, and keeps the answer. */
function once(make) {
  let made;
  let done = false;
  return () => {
    if (!done) {
      made = make();
      done = true;
    }
    return made;
  };
}

// ---------------------------------------------------------------------------
// The environment every gate gets: explicit, never inherited (AC11)
// ---------------------------------------------------------------------------

/**
 * The only gh on a drill's PATH. It answers the one call a drill set it up
 * for, through DRILL_GH_EXPECT and DRILL_GH_ANSWER, records every call in
 * DRILL_GH_LOG, and refuses the rest.
 */
const GH_STAND_IN = [
  '#!/bin/sh',
  '[ -z "$DRILL_GH_LOG" ] || printf \'gh %s\\n\' "$*" >> "$DRILL_GH_LOG"',
  'if [ -n "$DRILL_GH_EXPECT" ] && [ "$*" = "$DRILL_GH_EXPECT" ]; then',
  '  cat "$DRILL_GH_ANSWER"',
  '  exit 0',
  'fi',
  'echo "stand-in gh: refused a call it was not set up for: gh $*" >&2',
  'exit 1',
  '',
].join('\n');

/** Where proxy-aware tools are sent: a closed port, so reaching for the network fails at once. */
const NOWHERE = 'http://127.0.0.1:9';

/** The stand-in gh and a home folder of the drill's own. */
function standInTools() {
  if (tools === null) {
    const dir = scratch('tools');
    const bin = path.join(dir, 'bin');
    const home = path.join(dir, 'home');
    mkdirSync(bin);
    mkdirSync(home);
    writeFileSync(path.join(bin, 'gh'), GH_STAND_IN, { mode: 0o755 });
    tools = { bin, home, ghLog: path.join(dir, 'gh.log') };
  }
  return tools;
}

/**
 * What a gate a drill spawns sees, and nothing else: no token, nothing a gate
 * reads from the runner (GITHUB_*, CI), no proxy of the runner's, a home of its
 * own, and the runner's PATH behind the stand-in gh. `extra` is what a drill
 * hands one gate on purpose, the stand-ins for GitHub among it.
 *
 * Node's own fetch ignores the proxy variables unless NODE_USE_ENV_PROXY is
 * set, so it is: a gate's fetch goes to the dead proxy too (AC11). Node then
 * warns, once a process, that the proxy agent is experimental.
 */
function drillEnv(extra = {}) {
  const { bin, home, ghLog } = standInTools();
  return {
    PATH: [bin, ...(process.env.PATH ?? '').split(path.delimiter).filter((dir) => dir !== '')].join(
      path.delimiter,
    ),
    HOME: home,
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    HTTP_PROXY: NOWHERE,
    HTTPS_PROXY: NOWHERE,
    http_proxy: NOWHERE,
    https_proxy: NOWHERE,
    ALL_PROXY: NOWHERE,
    NO_PROXY: '',
    no_proxy: '',
    NODE_USE_ENV_PROXY: '1',
    DRILL_GH_LOG: ghLog,
    ...extra,
  };
}

/** Where pnpm puts the repository's own binaries: first on the PATH of every script it runs. */
const MODULES_BIN = path.join(REPO, 'node_modules', '.bin');

/**
 * What a gate that CI runs through `pnpm run` sees: the drill's environment,
 * with node_modules/.bin first on PATH, as pnpm puts it. A tool there shadows
 * the runner's, in CI as here (AC4).
 */
function gateEnv(extra = {}, modulesBin = MODULES_BIN) {
  const env = drillEnv(extra);
  return { ...env, PATH: `${modulesBin}${path.delimiter}${env.PATH}` };
}

/** Who a drill's own scratch commits are by. */
const GIT_AS_DRILL = {
  GIT_AUTHOR_NAME: 'Drill',
  GIT_AUTHOR_EMAIL: 'drill@example.invalid',
  GIT_COMMITTER_NAME: 'Drill',
  GIT_COMMITTER_EMAIL: 'drill@example.invalid',
};

/**
 * A scratch git repository: a base commit, origin/main at it, as CI's
 * full-history checkout has it, and a head commit on top. Made without
 * `git init -b`, which an old git refuses (R15), and never signed.
 */
function scratchRepo(name, base, head) {
  const dir = scratch(name);
  const git = (...args) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd: dir,
      env: drillEnv(GIT_AS_DRILL),
      stdio: 'pipe',
    });
  git('init', '-q');
  git('symbolic-ref', 'HEAD', 'refs/heads/main');
  writeFiles(dir, base);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFiles(dir, head);
  git('add', '-A');
  git('commit', '-q', '--allow-empty', '-m', 'head');
  return dir;
}

// ---------------------------------------------------------------------------
// Running a gate, and judging what it did (AC8)
// ---------------------------------------------------------------------------

/** Terminal colours, which some tools print even when asked not to. */
const COLOURS = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

/** Runs one gate process: its exit status, what it printed, and why it did not finish if it did not. */
function spawnGate(argv, { cwd, env = drillEnv(), input } = {}) {
  const [command = '', ...args] = argv;
  const result = spawnSync(command, args, {
    cwd,
    env,
    input,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(COLOURS, ''),
    error: result.error?.message ?? (result.signal === null ? '' : `killed by ${result.signal}`),
  };
}

/** The gate finished by itself, and failed: a crash or a timeout is neither. */
const refused = (result) => result.error === '' && result.status !== null && result.status !== 0;

/** The gate finished by itself, and passed. */
const passed = (result) => result.error === '' && result.status === 0;

/** What a gate did, for a message. */
const said = (result) =>
  `exit ${String(result.status)}${result.error === '' ? '' : ` (${result.error})`}, printing:\n${result.output.slice(0, 4000)}`;

const blocked = (why) => ({ verdict: 'blocked', why });
const notBlocked = (why) => ({ verdict: 'not blocked', why });

/** A control's answer: whether it passed, and showed what the gate examined. */
const controlAnswer = (ok, why) => ({ ok, why });

/** What a gate prints when it has nothing to do with the drill. */
const UNRELATED = 'Error: something unrelated went wrong.\n';

/** `result` with `changes` made, to each hook's answer when it is a list of them. */
const changed = (result, changes) =>
  Array.isArray(result)
    ? result.map((each) => ({ ...each, ...changes }))
    : { ...result, ...changes };

/**
 * AC8: "blocked" takes the gate's refusal and its own words together. Its
 * words with a pass, a refusal in other words, a crash and a timeout are each
 * not blocked, and neither is a hook that exits 1: only 2 blocks.
 */
function needsBoth(judge, sample, { verdict = 'blocked', hook = false } = {}) {
  const first = judge(sample);
  expect(first.verdict, first.why).toBe(verdict);
  expect(judge(changed(sample, { status: 0 })).verdict, 'its own words, with a pass').toBe(
    'not blocked',
  );
  expect(judge(changed(sample, { output: UNRELATED })).verdict, 'a refusal in other words').toBe(
    'not blocked',
  );
  expect(
    judge(changed(sample, { status: null, error: 'spawnSync sh ETIMEDOUT' })).verdict,
    'a timeout',
  ).toBe('not blocked');
  expect(
    judge(changed(sample, { status: null, error: 'killed by SIGSEGV' })).verdict,
    'a crash',
  ).toBe('not blocked');
  if (hook) {
    expect(judge(changed(sample, { status: 1 })).verdict, 'a hook that exits 1').toBe(
      'not blocked',
    );
  }
}

/** AC8: a control passes through the same gate and shows what it examined; with that taken out, it is no control. */
function showsWork(judge, sample, emptied) {
  const answer = judge(sample);
  expect(answer.ok, answer.why).toBe(true);
  expect(judge(emptied(sample)).ok, 'a pass that examined nothing').toBe(false);
  expect(judge(changed(sample, { status: 1 })).ok, 'a failure').toBe(false);
}

/** AC9: a gate swapped for a stand-in that always passes, and for one that fails with another message. */
const STAND_INS = [
  { what: 'a stand-in that always passes', script: 'echo "stand-in gate: all fine"' },
  {
    what: 'a stand-in that fails with another message',
    script: 'echo "stand-in gate: something unrelated went wrong" >&2; exit 1',
  },
];

/** The same, as hooks: a hook blocks with 2, so the failing one exits 2 too. */
const STAND_IN_HOOKS = [
  { what: 'a stand-in hook that always passes', command: 'exit 0' },
  {
    what: 'a stand-in hook that blocks with another message',
    command: 'echo "Blocked: something unrelated." >&2; exit 2',
  },
];

// ---------------------------------------------------------------------------
// Reading what the real system runs (AC10)
// ---------------------------------------------------------------------------

/** The steps of `job` in a workflow's text, each as its block of lines; null when there is no such job. */
function stepsOf(text, job) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^ {2}${job}:(\\s|$)`).test(line));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line) || /^\S/.test(line));
  const block = end === -1 ? rest : rest.slice(0, end);
  const at = block.findIndex((line) => /^ {4}steps:\s*$/.test(line));
  if (at === -1) return [];
  return block
    .slice(at + 1)
    .join('\n')
    .split(/\n(?= {6}- )/)
    .filter((step) => /^ {6}- /.test(step));
}

/** A step's `run:` script as the runner gets it, written with `|`, `>` or on one line; '' when there is none. */
function runOf(step) {
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

/** A step's own `env:` block, as name → value with quotes taken off. */
function envOf(step) {
  const lines = step.split('\n');
  const at = lines.findIndex((line) => /^ {8}env:\s*$/.test(line));
  const env = {};
  if (at === -1) return env;
  for (const line of lines.slice(at + 1)) {
    if (line.trim().startsWith('#')) continue;
    if (!/^ {10}\S/.test(line)) break;
    const match = /^ {10}([A-Za-z_]\w*):\s*(.*?)\s*$/.exec(line);
    if (match?.[1] !== undefined) {
      env[match[1]] = (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return env;
}

/** `text` with each ${{ … }} put in from `known`; one the drill does not know fails it, naming the expression. */
function standInFor(text, known, where) {
  return text.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (whole, expression) => {
    const value = known.get(expression);
    if (value === undefined) {
      throw new Error(
        `${where} uses ${whole}, which this drill does not know how to stand in for.`,
      );
    }
    return value;
  });
}

/** The base ref: the scratch repositories keep their base at origin/main. */
const BASE_REF = new Map([["github.base_ref || 'main'", 'main']]);

/**
 * A step's own `key:`, on its first line or at its keys' depth, as GitHub reads
 * it: a trailing comment, the ${{ }} around it and its quotes taken off. ''
 * when the step has none.
 */
function stepKey(step, key) {
  const value = new RegExp(`^(?: {6}- | {8})${key}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec(step)?.[1];
  return (value ?? '')
    .replace(/\s+#.*$/, '')
    .replace(/^\$\{\{\s*(.*?)\s*\}\}$/, '$1')
    .replace(/^(['"])(.*)\1$/, '$2');
}

/** CI-12's guard: the step runs when the diff holds code. */
const CODE_GUARD = "steps.affected.outputs.code == 'true'";

/** The if: each job's gate step has in ci.yml, and the only one it may have (AC10). */
const OWN_GUARD = { traceability: '', unit: CODE_GUARD, contract: CODE_GUARD };

/**
 * How `step` tolerates its gate's failure, in words, or '' when it does not
 * (AC10): a shell operator on the gate's `line` (a ${{ }} expression is
 * GitHub's, not the shell's), another command beside it, continue-on-error, or
 * an if: other than `own`, the step's own.
 */
function tolerance(step, own, line) {
  if (line !== undefined) {
    const operator = /\|\||&&|[;|&]/.exec(line.replace(/\$\{\{.*?\}\}/g, ''))?.[0];
    if (operator !== undefined) {
      return `has the shell operator "${operator}" on its line, "${line}"`;
    }
    const beside = runOf(step)
      .split('\n')
      .map((each) => each.trim())
      .find((each) => each !== '' && !each.startsWith('#') && each !== line);
    if (beside !== undefined) return `runs "${beside}" beside its gate`;
  }
  const excused = stepKey(step, 'continue-on-error');
  if (excused !== '' && excused !== 'false') return `has continue-on-error: ${excused}`;
  const guard = stepKey(step, 'if');
  if (guard !== own) {
    return `${guard === '' ? 'has no if:' : `runs only if: ${guard}`}, where its own is ${own === '' ? 'none' : `if: ${own}`}`;
  }
  return '';
}

/** The step in `job` that runs `pnpm run <script>`: its line as written in ci.yml, its if: and its continue-on-error:. */
function gateStep(job, script, ci = read(CI_YML)) {
  const steps = stepsOf(ci, job);
  if (steps === null) {
    throw new Error(`${CI_YML} has no ${job} job, which this drill reads its command from.`);
  }
  const found = steps.flatMap((step) =>
    runOf(step)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line === `pnpm run ${script}` || line.startsWith(`pnpm run ${script} `))
      .map((line) => ({ step, line })),
  );
  if (found.length !== 1) {
    throw new Error(
      `${CI_YML}'s ${job} job has ${found.length === 0 ? 'no step that runs' : 'more than one step that runs'} "pnpm run ${script}", which this drill looks for.`,
    );
  }
  const [{ step, line }] = found;
  return {
    step,
    line,
    if: stepKey(step, 'if'),
    continueOnError: stepKey(step, 'continue-on-error'),
  };
}

/**
 * The one line in `job`'s steps that runs `pnpm run <script>`, as written in
 * ci.yml, from a step that runs its gate and tolerates nothing: a step made to
 * tolerate its gate's failure no longer runs it, and the drill says so (AC10).
 */
function stepLine(job, script, ci = read(CI_YML)) {
  const { step, line } = gateStep(job, script, ci);
  const own = OWN_GUARD[job];
  if (own === undefined) {
    throw new Error(
      `This drill does not know which if: is the own of ${CI_YML}'s ${job} job's step that runs "pnpm run ${script}", so it cannot tell whether the step tolerates its gate.`,
    );
  }
  const tolerates = tolerance(step, own, line);
  if (tolerates !== '') {
    throw new Error(
      `${CI_YML}'s ${job} job's step that runs "pnpm run ${script}" ${tolerates}. A step made to tolerate its gate's failure no longer runs it, so this drill does not run it either (INF-10-AC10).`,
    );
  }
  return line;
}

/**
 * `pnpm run <script> <args>` as pnpm runs it: package.json's script, with node
 * and the repository's own files made absolute so it can run in a scratch
 * folder, and then the args.
 */
function scriptCommand(line, manifest = read('package.json')) {
  const [pnpm, verb, script, ...args] = line.split(/\s+/);
  if (pnpm !== 'pnpm' || verb !== 'run' || script === undefined) {
    throw new Error(
      `"${line}" is not a pnpm run command, which this drill follows into package.json.`,
    );
  }
  const body = JSON.parse(manifest).scripts?.[script];
  if (typeof body !== 'string') {
    throw new Error(
      `package.json has no "${script}" script, which "${line}" runs and this drill follows.`,
    );
  }
  if (/&&|\|\||[;|]/.test(body)) {
    throw new Error(
      `package.json's "${script}" script chains commands, "${body}", and this drill runs one.`,
    );
  }
  const words = body
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (word === 'node') return process.execPath;
      return /\.[cm]?js$/.test(word) && !path.isAbsolute(word) ? path.join(REPO, word) : word;
    });
  return [...words, ...args];
}

/** The command a ci.yml job runs for `script`, with only its base its own. */
const commandOf = (job, script, { ci, pkg } = {}) =>
  scriptCommand(standInFor(stepLine(job, script, ci), BASE_REF, `${CI_YML}'s ${job} job`), pkg);

/** What `run` threw, as text; '' when it threw nothing. */
function failureOf(run) {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return '';
}

/**
 * The ways a CI step is made to tolerate its gate's failure (AC10), each a
 * change to the step's text, with what the drill must say it found. The last
 * two are the step's own keys, which "Enforce the verdict" can have too.
 */
const OPERATOR = {
  what: '|| true on its line',
  found: 'the shell operator "||"',
  tolerate: (step, script) => step.replace(new RegExp(`(pnpm run ${script}[^\\n]*)`), '$1 || true'),
};
const BESIDE = {
  what: 'set +e before its line and exit 0 after it',
  found: '"set +e"',
  tolerate: (step, script) =>
    step.replace(
      new RegExp(`^( {6}- | {8})run: (pnpm run ${script}[^\\n]*)$`, 'm'),
      '$1run: |\n          set +e\n          $2\n          exit 0',
    ),
};
const CONTINUE_ON_ERROR = {
  what: 'continue-on-error: true',
  found: 'continue-on-error: true',
  tolerate: (step) => step.replace(/^( {6}- .*)$/m, '$1\n        continue-on-error: true'),
};
const IF_FALSE = {
  what: 'an if: of its own, false',
  found: 'if: false',
  tolerate: (step) =>
    /^(?: {6}- | {8})if:/m.test(step)
      ? step.replace(/^( {6}- | {8})if:.*$/m, '$1if: false')
      : step.replace(/^( {6}- .*)$/m, '$1\n        if: false'),
};
const TOLERANCES = [OPERATOR, BESIDE, CONTINUE_ON_ERROR, IF_FALSE];

/** A scratch copy of a workflow's `text`, with the step of `job` that holds `needle` put through `change`. */
function tolerating(text, job, needle, change) {
  const step = (stepsOf(text, job) ?? []).find((each) => each.includes(needle));
  if (step === undefined) {
    throw new Error(`No step of ${job} holds ${needle}, so the drill has no step to change.`);
  }
  const changed = change(step);
  if (changed === step)
    throw new Error(`The change left ${job}'s step holding ${needle} as it was.`);
  const at = text.indexOf(step, text.search(new RegExp(`^ {2}${job}:`, 'm')));
  return `${text.slice(0, at)}${changed}${text.slice(at + step.length)}`;
}

/**
 * AC10: with `job`'s step for `script` made to tolerate its gate in a scratch
 * copy of ci.yml, building the drill's command from that copy fails, naming
 * the step and what it found there.
 */
function refusesTolerance(job, script, build, { tolerate, found }) {
  const ci = tolerating(read(CI_YML), job, `pnpm run ${script}`, (step) => tolerate(step, script));
  const message = failureOf(() => build(ci));

  expect(message, `the drill ran ${job}'s step although it tolerates its gate`).toContain(
    `${job} job's step that runs "pnpm run ${script}"`,
  );
  expect(message, message).toContain(found);
}

/** A file and every repository file it imports, by relative path, for AC14. */
function withImports(files) {
  const found = new Set();
  const queue = [...files];
  while (queue.length > 0) {
    const file = queue.shift() ?? '';
    if (found.has(file)) continue;
    found.add(file);
    if (!/\.[cm]?js$/.test(file) || !existsSync(path.join(REPO, file))) continue;
    for (const [, specifier] of read(file).matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
      queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier ?? '')));
    }
  }
  return [...found];
}

/**
 * Whether what the hook drills read under .claude, the settings, the agent's
 * definition and the hooks with what they import, is on disk as HEAD holds it.
 * A reviewer's sandbox reverts .claude/** (R5), and the drills then read old
 * files. Called only when a drill fails, so the drills are defined by then.
 */
const claudeAsCommitted = () => {
  const claude = [...HK02.sources, ...HK07.sources].filter((file) => file.startsWith('.claude/'));
  const files = withImports(claude).filter((file) => file.startsWith('.claude/'));
  return spawnSync('git', ['diff', '--quiet', 'HEAD', '--', ...files], { cwd: REPO }).status === 0;
};

/** A hook drill's body, whose failure says so when those files are not what was committed, as scripts/ai-review.test.mjs does. */
const explained =
  (body) =>
  (...args) => {
    try {
      return body(...args);
    } catch (error) {
      if (claudeAsCommitted()) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}\n\nNOTE: what this drill read under .claude differs from HEAD, so it read something other than the committed hooks, settings or agent definition. \`git diff HEAD -- .claude\` shows what differs. Draw your own conclusion from it.`,
        { cause: error },
      );
    }
  };

// ---------------------------------------------------------------------------
// Drill 1 · RG-03 · a skip added to a test · AC1
// ---------------------------------------------------------------------------

const SAMPLE_TEST = 'apps/drill/drill-sample.test.ts';

/** Drill 1's base: two tests, each checking one thing. */
const TWO_TESTS = [
  `import { describe, ${WORD.expect}, ${WORD.test} } from 'vitest';`,
  '',
  "describe('drill sample', () => {",
  `  ${WORD.test}('first sample', () => {`,
  `    ${WORD.expect}(1).toBe(1);`,
  '  });',
  '',
  `  ${WORD.test}('second sample', () => {`,
  `    ${WORD.expect}(2).toBe(2);`,
  '  });',
  '});',
  '',
].join('\n');

/** The control's head: a third test, and nothing switched off. */
const THREE_TESTS = TWO_TESTS.replace(
  /\}\);\n$/,
  `\n  ${WORD.test}('third sample', () => {\n    ${WORD.expect}(3).toBe(3);\n  });\n});\n`,
);

/** The describe with `form` in front of its title. */
const wrapped = (form) => (source) =>
  source.replace("describe('drill sample'", `${form}('drill sample'`);

/** The ways drill 1's head switches the two tests off, in AC1's order, each said in words. */
const SWITCH_OFFS = [
  ['a skip on their describe', wrapped(dotted('describe', WORD.skipName))],
  [
    'a conditional skip whose condition is true',
    wrapped(`${dotted('describe', `${WORD.skipName}If`)}(true)`),
  ],
  [
    'a conditional run whose condition is false',
    wrapped(`${dotted('describe', WORD.runIfName)}(false)`),
  ],
  [
    'a skip behind the concurrent modifier',
    wrapped(dotted('describe', 'concurrent', WORD.skipName)),
  ],
  [
    "the context's skip, called first thing in each test's body",
    (source) =>
      ['first sample', 'second sample'].reduce(
        (text, title) =>
          text.replace(
            `'${title}', () => {\n`,
            `'${title}', (ctx) => {\n    ${dotted('ctx', WORD.skipName)}();\n`,
          ),
        source,
      ),
  ],
];

/** Drill 1's other attempt: the first test marked to expect failure, which turns a failing test into a passing one (D-082). */
const INVERT = (source) =>
  source.replace(
    `${WORD.test}('first sample'`,
    `${dotted(WORD.test, WORD.failsName)}('first sample'`,
  );

/** What tests:changes says of a skip, and of a test inverted to expect failure: each in its own words. */
const SKIP_WORDS = 'skipped, focused or todo tests were added';
const INVERTED_WORDS = `tests were inverted to expect failure (.${WORD.failsName} or .${WORD.failingName})`;

/** The text each switch-off adds, for AC11's search of the repository. */
const SWITCH_OFF_TEXT = [
  `${dotted('describe', WORD.skipName)}(`,
  `${dotted('describe', `${WORD.skipName}If`)}(true)`,
  `${dotted('describe', WORD.runIfName)}(false)`,
  dotted('describe', 'concurrent', WORD.skipName),
  `${dotted('ctx', WORD.skipName)}()`,
  `${dotted(WORD.test, WORD.failsName)}(`,
];

const RG03 = {
  id: 'RG-03',
  sources: [CI_YML, 'package.json', 'scripts/tests-changes.mjs'],
  /** traceability's command: tests:changes against the base. */
  gate: (files) => commandOf('traceability', 'tests:changes', files),
  /** Runs `gate` in a repository whose head changed the sample by `change`, as pnpm runs it. */
  run: (change, gate = RG03.gate()) =>
    spawnGate(gate, {
      cwd: scratchRepo('rg03', { [SAMPLE_TEST]: TWO_TESTS }, { [SAMPLE_TEST]: change(TWO_TESTS) }),
      env: gateEnv(),
    }),
  /** Blocked: tests:changes refused it, naming the sample, saying `words` and giving its RG-03 line. */
  judge(result, words = SKIP_WORDS) {
    const own =
      result.output.includes(SAMPLE_TEST) &&
      result.output.includes(words) &&
      /^RG-03: /m.test(result.output);
    return refused(result) && own
      ? blocked(`tests:changes refused it, naming the file, "${words}" and RG-03`)
      : notBlocked(
          `expected tests:changes to exit non-zero naming ${SAMPLE_TEST}, "${words}" and its RG-03 line; it gave ${said(result)}`,
        );
  },
  evidence: /1 changed test file\(s\), none weakened/,
  controlJudge: (result) =>
    controlAnswer(
      passed(result) && RG03.evidence.test(result.output),
      `expected tests:changes to pass, having checked 1 changed test file; it gave ${said(result)}`,
    ),
};
RG03.sample = once(() => RG03.run(wrapped(dotted('describe', WORD.skipName))));
RG03.controlSample = once(() => RG03.run(() => THREE_TESTS));

describe('RG-03 drill (1 of 9): a skip added in a pull request', () => {
  test.each(SWITCH_OFFS)(
    'INF-10-AC1: RG-03 drill — tests:changes refuses a head commit that switches two tests off with %s',
    (_, change) => {
      const verdict = RG03.judge(RG03.run(change));

      expect(verdict.verdict, verdict.why).toBe('blocked');
    },
  );

  test('INF-10-AC1: RG-03 drill — tests:changes refuses a head commit that marks a test to expect failure, in its own words for an inverted test, with its RG-03 line', () => {
    const verdict = RG03.judge(RG03.run(INVERT), INVERTED_WORDS);

    expect(INVERT(TWO_TESTS)).not.toBe(TWO_TESTS);
    expect(verdict.verdict, verdict.why).toBe('blocked');
  });

  test('INF-10-AC1: RG-03 drill — control: a head commit that adds a third test instead passes, having checked 1 changed test file', () => {
    const answer = RG03.controlJudge(RG03.controlSample());

    expect(answer.ok, answer.why).toBe(true);
  });

  test("INF-10-AC8: RG-03 drill — blocked takes both tests:changes' refusal and its own words, and its control shows what it checked", () => {
    needsBoth((result) => RG03.judge(result), RG03.sample());
    showsWork(RG03.controlJudge, RG03.controlSample(), (result) => ({
      ...result,
      output: result.output.replace(RG03.evidence, ''),
    }));
  });

  test('INF-10-AC9: RG-03 drill — with tests:changes swapped for a stand-in that always passes, and then for one that fails with another message, it says not blocked both times', () => {
    for (const standIn of STAND_INS) {
      const verdict = RG03.judge(RG03.run(SWITCH_OFFS[0][1], ['sh', '-c', standIn.script]));

      expect(verdict.verdict, standIn.what).toBe('not blocked');
    }
  });

  test("INF-10-AC10: RG-03 drill — runs traceability's step through package.json's script, with only the folder and the base its own, and says what it looked for when either is gone", () => {
    const ci = read(CI_YML);

    expect(RG03.gate()).toEqual([
      process.execPath,
      path.join(REPO, 'scripts', 'tests-changes.mjs'),
      '--base',
      'origin/main',
    ]);
    // Read, not retyped: another word in the step is another word in the drill.
    expect(
      RG03.gate({ ci: ci.replace(/(pnpm run tests:changes[^\n]*)/, '$1 --drill') }).at(-1),
    ).toBe('--drill');
    expect(() =>
      RG03.gate({ ci: ci.replaceAll('pnpm run tests:changes', 'pnpm run lint') }),
    ).toThrow(/traceability job has no step that runs "pnpm run tests:changes"/);
    expect(() => RG03.gate({ pkg: JSON.stringify({ scripts: {} }) })).toThrow(
      /package\.json has no "tests:changes" script/,
    );
  });

  test.each(TOLERANCES)(
    "INF-10-AC10: RG-03 drill — traceability's tests:changes step made to tolerate its gate with $what fails the drill, naming the step and what it found",
    (tolerance) => {
      refusesTolerance('traceability', 'tests:changes', (ci) => RG03.gate({ ci }), tolerance);
    },
  );
});

// ---------------------------------------------------------------------------
// Drill 2 · CI-03 · a failing test · AC2
// ---------------------------------------------------------------------------

const FAILING = 'the drill sample fails';
const NEIGHBOUR = 'its neighbour passes';

/** One failing test and its passing neighbour, with or without the Vitest import. */
const failingSample = (imports) =>
  [
    imports ? `import { describe, ${WORD.expect}, ${WORD.test} } from 'vitest';` : '',
    "describe('drill sample', () => {",
    `  ${WORD.test}('${FAILING}', () => {`,
    `    ${WORD.expect}(1 + 1).toBe(3);`,
    '  });',
    `  ${WORD.test}('${NEIGHBOUR}', () => {`,
    `    ${WORD.expect}(1 + 1).toBe(2);`,
    '  });',
    '});',
    '',
  ].join('\n');

/** Vitest's config files, in the order it looks for them. */
const VITEST_CONFIGS = [
  'vitest.config.ts',
  'vitest.config.mts',
  'vitest.config.cts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs',
];

/** Where Jest and Babel read their configuration in a package. */
const JEST_CONFIGS = [
  'package.json',
  'jest.config.js',
  'jest.config.ts',
  'jest.config.mjs',
  'jest.config.cjs',
  'jest.config.json',
  'babel.config.js',
  'babel.config.cjs',
  'babel.config.mjs',
  'babel.config.json',
  '.babelrc',
  '.babelrc.js',
  '.babelrc.json',
];

/**
 * The runners this drill knows: where each reads its configuration, where the
 * drill puts its sample so that configuration collects it, and what the
 * runner's own summary says when the sample failed and its neighbour passed.
 */
const RUNNERS = {
  vitest: {
    name: 'Vitest',
    configFiles(dir) {
      const config = VITEST_CONFIGS.find((file) => existsSync(path.join(REPO, dir, file)));
      if (config === undefined) {
        throw new Error(
          `Vitest runs in ${dir} with no config file there, so the drill cannot tell where it collects tests.`,
        );
      }
      return withImports([path.posix.join(dir, config)]).map((file) =>
        path.posix.relative(dir, file),
      );
    },
    // Beside the drill file, which the unit run must collect (INF-10-AC14).
    sample: { file: 'scripts/drill-sample.test.mjs', text: failingSample(true) },
    summary: /Tests\s+1 failed \| 1 passed \(2\)/,
    named: new RegExp(`FAIL\\s+\\S*drill-sample\\.test\\.mjs > drill sample > ${FAILING}`),
  },
  jest: {
    name: 'jest-expo',
    configFiles: (dir) => JEST_CONFIGS.filter((file) => existsSync(path.join(REPO, dir, file))),
    // Where the app keeps its tests.
    sample: { file: 'src/drill-sample.test.ts', text: failingSample(false) },
    summary: /Tests:\s+1 failed, 1 passed, 2 total/,
    named: new RegExp(`● drill sample › ${FAILING}`),
  },
};

/** The workspace's packages, name → folder and scripts, from the root package.json's workspaces. */
function workspacePackages(root) {
  const found = new Map();
  for (const glob of root.workspaces ?? []) {
    const parent = glob.replace(/\/\*$/, '');
    if (!existsSync(path.join(REPO, parent))) continue;
    for (const entry of readdirSync(path.join(REPO, parent), { withFileTypes: true })) {
      const manifest = path.join(REPO, parent, entry.name, 'package.json');
      if (!entry.isDirectory() || !existsSync(manifest)) continue;
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      found.set(pkg.name, { dir: `${parent}/${entry.name}`, scripts: pkg.scripts ?? {} });
    }
  }
  return found;
}

/** The runner a command starts, or a failure naming the command when the drill does not know it. */
function runnerFor(command, dir) {
  const program = command.trim().split(/\s+/)[0] ?? '';
  const runner = Object.hasOwn(RUNNERS, program) ? RUNNERS[program] : undefined;
  if (runner === undefined) {
    throw new Error(
      `test:unit hands over to a runner this drill does not know: "${command.trim()}"${dir === '.' ? '' : ` in ${dir}`}. Teach the drill where it collects tests and how it reports a failure, or a failing test there is never shown to turn the unit run red.`,
    );
  }
  return { ...runner, command: command.trim(), dir };
}

/** Every runner test:unit hands over to, in order, followed into each package's own script. */
function runnersOf({ ci, pkg, packages } = {}) {
  const script = stepLine('unit', 'test:unit', ci).split(/\s+/)[2] ?? '';
  const root = JSON.parse(pkg ?? read('package.json'));
  const body = root.scripts?.[script];
  if (typeof body !== 'string') {
    throw new Error(`package.json has no "${script}" script, which ${CI_YML}'s unit job runs.`);
  }
  const workspace = packages ?? workspacePackages(root);
  return body.split('&&').map((command) => {
    const words = command.trim().split(/\s+/);
    if (words[0] !== 'pnpm') return runnerFor(command, '.');
    const filter = words[words.indexOf('--filter') + 1] ?? '';
    const target = workspace.get(filter);
    if (target === undefined) {
      throw new Error(
        `"${command.trim()}" hands over to ${filter}, which is no workspace package the drill can find.`,
      );
    }
    const handed = words[words.indexOf('run') + 1] ?? '';
    const own = target.scripts[handed];
    if (typeof own !== 'string') {
      throw new Error(
        `${target.dir}/package.json has no "${handed}" script, which "${command.trim()}" hands over to.`,
      );
    }
    return runnerFor(own, target.dir);
  });
}

/** Caches a runner writes under node_modules: the drill's copy keeps its own, so nothing lands in the repository. */
const CACHES = new Set(['.cache', '.tmp', '.vite', '.vite-temp']);

/** A node_modules folder of links to each entry of `from`, the caches left out. */
function linkModules(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    if (!CACHES.has(entry)) symlinkSync(path.join(from, entry), path.join(to, entry));
  }
}

/**
 * Runs `command` the way a package.json script runs it, node_modules/.bin
 * first on PATH and the line handed to sh, in a scratch copy of the runner's
 * folder: its configuration files as they are, node_modules linked, and the
 * failing sample where that configuration collects tests.
 */
function runRunner(runner, command = runner.command) {
  const dir = scratch(`ci03-${runner.name}`);
  const from = path.join(REPO, runner.dir);
  for (const file of runner.configFiles(runner.dir)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    copyFileSync(path.join(from, file), path.join(dir, file));
  }
  linkModules(path.join(from, 'node_modules'), path.join(dir, 'node_modules'));
  writeFiles(dir, { [runner.sample.file]: runner.sample.text });
  const env = drillEnv({ TMPDIR: scratch('ci03-tmp') });
  env.PATH = `${path.join(dir, 'node_modules', '.bin')}${path.delimiter}${env.PATH}`;
  return spawnGate(['sh', '-c', command], { cwd: dir, env });
}

/** CI-03's judgement of one runner's answer: red, in its own summary, with the neighbour green. */
function judgeRunner(runner, result) {
  const own = runner.summary.test(result.output) && runner.named.test(result.output);
  return refused(result) && own
    ? blocked(`${runner.name} failed the run: "${FAILING}" failed and "${NEIGHBOUR}" passed`)
    : notBlocked(
        `expected ${runner.name} to exit non-zero, its own summary saying "${FAILING}" failed and "${NEIGHBOUR}" passed; it gave ${said(result)}`,
      );
}

const CI03 = {
  id: 'CI-03',
  sources: [
    CI_YML,
    'package.json',
    'apps/mobile/package.json',
    'vitest.config.mjs',
    'vitest.shared.mjs',
  ],
};
CI03.sample = once(() => {
  const [first] = runnersOf();
  if (first === undefined) throw new Error('test:unit hands over to no runner at all.');
  return { runner: first, result: runRunner(first) };
});

describe('CI-03 drill (2 of 9): a failing test', () => {
  test.each(['Vitest', 'jest-expo'])(
    'INF-10-AC2: CI-03 drill — a failing test turns %s red, run as test:unit runs it, with its passing neighbour as the control',
    (name) => {
      const runner = runnersOf().find((each) => each.name === name);
      if (runner === undefined) throw new Error(`test:unit no longer hands over to ${name}.`);
      const verdict = judgeRunner(runner, runRunner(runner));

      expect(verdict.verdict, verdict.why).toBe('blocked');
    },
    SLOW,
  );

  test('INF-10-AC2: CI-03 drill — test:unit hands over to Vitest, then to jest-expo in the app, and to no runner the drill does not know', () => {
    expect(runnersOf().map((runner) => [runner.name, runner.dir, runner.command])).toEqual([
      ['Vitest', '.', 'vitest run'],
      ['jest-expo', 'apps/mobile', 'jest --ci'],
    ]);
  });

  test('INF-10-AC2: CI-03 drill — a runner the drill does not know makes it fail, naming the runner', () => {
    const root = JSON.parse(read('package.json'));
    const withUnit = (script) =>
      JSON.stringify({ ...root, scripts: { ...root.scripts, 'test:unit': script } });
    const packages = workspacePackages(root);
    const app = packages.get('@trygghverdag/mobile');
    packages.set('@trygghverdag/mobile', {
      dir: app?.dir ?? 'apps/mobile',
      scripts: { ...app?.scripts, test: 'node --test' },
    });

    expect(() =>
      runnersOf({ pkg: withUnit(`${root.scripts['test:unit']} && mocha --recursive`) }),
    ).toThrow(/a runner this drill does not know: "mocha --recursive"/);
    expect(() => runnersOf({ packages })).toThrow(
      /a runner this drill does not know: "node --test" in apps\/mobile/,
    );
  });

  test(
    "INF-10-AC8: CI-03 drill — red takes both the runner's failure and its own summary, and without the neighbour's pass it proves nothing",
    () => {
      const { runner, result } = CI03.sample();
      const judge = (answer) => judgeRunner(runner, answer);

      needsBoth(judge, result);
      expect(
        judge(changed(result, { output: result.output.replace('1 passed', '0 passed') })).verdict,
        'a run whose neighbour did not pass',
      ).toBe('not blocked');
    },
    SLOW,
  );

  test(
    'INF-10-AC9: CI-03 drill — with each runner swapped for a stand-in that always passes, and then for one that fails with another message, it says not blocked both times',
    () => {
      for (const runner of runnersOf()) {
        for (const standIn of STAND_INS) {
          const verdict = judgeRunner(runner, runRunner(runner, standIn.script));

          expect(verdict.verdict, `${runner.name}, ${standIn.what}`).toBe('not blocked');
        }
      }
    },
    SLOW,
  );

  test("INF-10-AC10: CI-03 drill — reads test:unit from the unit job and package.json, follows the hand-over into the app's package.json, copies each configuration as it is, and says what it looked for when the step or the script is gone", () => {
    const [vitest, jest] = runnersOf();

    expect(vitest?.configFiles(vitest.dir)).toEqual(['vitest.config.mjs', 'vitest.shared.mjs']);
    expect(jest?.configFiles(jest.dir)).toContain('package.json');
    expect(() =>
      runnersOf({ ci: read(CI_YML).replaceAll('pnpm run test:unit', 'pnpm run lint') }),
    ).toThrow(/unit job has no step that runs "pnpm run test:unit"/);
    expect(() => runnersOf({ pkg: JSON.stringify({ workspaces: [], scripts: {} }) })).toThrow(
      /package\.json has no "test:unit" script/,
    );
  });

  test.each(TOLERANCES)(
    "INF-10-AC10: CI-03 drill — unit's test:unit step made to tolerate its gate with $what fails the drill, naming the step and what it found",
    (tolerance) => {
      refusesTolerance('unit', 'test:unit', (ci) => runnersOf({ ci }), tolerance);
    },
  );
});

// ---------------------------------------------------------------------------
// Drill 3 · RG-01 · a new acceptance criterion without a test · AC3
// ---------------------------------------------------------------------------

const PLAN = 'docs/plan/01b-mvp-scope.md';
const STORY = 'DRILL-01';
const OTHER_STORY = 'DRILL-02';
const criterion = (n, story = STORY) => `${story}-AC${String(n)}`;

/** A scratch plan listing these stories, written the way the real one writes them. */
const planOf = (...stories) =>
  [
    "# MVP scope, a drill's scratch copy",
    '',
    ...stories.map(([id, title]) => `**${id} · ${title}** (Must)`),
    '',
  ].join('\n');

/** A spec naming its story and these criteria. */
const specNaming = (story, ...criteria) =>
  [
    `# ${story} · a synthetic spec`,
    '',
    ...criteria.map((id) => `**${id}** — a synthetic acceptance criterion.`),
    '',
  ].join('\n');

/** A test file whose tests name these criteria, and count: it carries no fixtures-only marker. */
const testsNaming = (...criteria) =>
  [
    `import { ${WORD.expect}, ${WORD.test} } from 'vitest';`,
    '',
    ...criteria.flatMap((id) => [
      `${WORD.test}('${id}: a synthetic check', () => {`,
      `  ${WORD.expect}(1).toBe(1);`,
      '});',
      '',
    ]),
  ].join('\n');

const STORY_TITLE = 'A synthetic story for the drill';

/** Drill 3's base: one story, a spec naming its first criterion, and a test naming it. */
const RG01_BASE = {
  [PLAN]: planOf([STORY, STORY_TITLE]),
  'docs/specs/DRILL-01.md': specNaming(STORY, criterion(1)),
  'apps/drill/drill.test.ts': testsNaming(criterion(1)),
};

/** The heads drill 3 tries, each a change of its base. */
const RG01_HEADS = {
  criterion: { 'docs/specs/DRILL-01.md': specNaming(STORY, criterion(1), criterion(2)) },
  control: {
    'docs/specs/DRILL-01.md': specNaming(STORY, criterion(1), criterion(2)),
    'apps/drill/drill.test.ts': testsNaming(criterion(1), criterion(2)),
  },
  story: {
    [PLAN]: planOf([STORY, STORY_TITLE], [OTHER_STORY, 'A second synthetic story']),
    'docs/specs/DRILL-02.md': specNaming(OTHER_STORY),
  },
};

const RG01 = {
  id: 'RG-01',
  sources: [CI_YML, 'package.json', 'scripts/req-coverage.mjs'],
  /** traceability's command: req:coverage, failing on uncovered changes. */
  gate: (files) => commandOf('traceability', 'req:coverage', files),
  run: (head, gate = RG01.gate()) =>
    spawnGate(gate, { cwd: scratchRepo('rg01', RG01_BASE, RG01_HEADS[head]), env: gateEnv() }),
  judge(result, named = OTHER_STORY) {
    const rule = result.output.indexOf('RG-01:');
    const own = rule !== -1 && result.output.slice(rule).includes(named);
    return refused(result) && own
      ? blocked(`req:coverage refused it, naming ${named} under its RG-01 line`)
      : notBlocked(
          `expected req:coverage to exit non-zero with its RG-01 line naming ${named}; it gave ${said(result)}`,
        );
  },
  evidence: /1 of 1 live requirements have a test that names them/,
  controlJudge: (result) =>
    controlAnswer(
      passed(result) && RG01.evidence.test(result.output),
      `expected req:coverage to pass, having found the story's tests; it gave ${said(result)}`,
    ),
};
RG01.sample = once(() => RG01.run('story'));
RG01.controlSample = once(() => RG01.run('control'));

describe('RG-01 drill (3 of 9): a new acceptance criterion without a test', () => {
  test("INF-10-AC3: RG-01 drill — req:coverage refuses a head that adds a criterion to a story's spec when no test names it, naming the criterion", () => {
    const verdict = RG01.judge(RG01.run('criterion'), criterion(2));

    expect(verdict.verdict, verdict.why).toBe('blocked');
  });

  test('INF-10-AC3: RG-01 drill — control: the same head with a test naming that criterion passes', () => {
    const answer = RG01.controlJudge(RG01.controlSample());

    expect(answer.ok, answer.why).toBe(true);
  });

  test('INF-10-AC3: RG-01 drill — a spec naming a second story that no test names is refused the same way, naming the story', () => {
    const verdict = RG01.judge(RG01.sample(), OTHER_STORY);

    expect(verdict.verdict, verdict.why).toBe('blocked');
  });

  test("INF-10-AC8: RG-01 drill — blocked takes both req:coverage's refusal and its own words, and its control shows the requirement it examined", () => {
    needsBoth((result) => RG01.judge(result), RG01.sample());
    showsWork(RG01.controlJudge, RG01.controlSample(), (result) => ({
      ...result,
      output: result.output.replace(RG01.evidence, ''),
    }));
  });

  test('INF-10-AC9: RG-01 drill — with req:coverage swapped for a stand-in that always passes, and then for one that fails with another message, it says not blocked both times', () => {
    for (const standIn of STAND_INS) {
      const verdict = RG01.judge(RG01.run('story', ['sh', '-c', standIn.script]));

      expect(verdict.verdict, standIn.what).toBe('not blocked');
    }
  });

  test("INF-10-AC10: RG-01 drill — runs traceability's step through package.json's script, with only the folder its own, and says what it looked for when either is gone", () => {
    const ci = read(CI_YML);

    expect(RG01.gate()).toEqual([
      process.execPath,
      path.join(REPO, 'scripts', 'req-coverage.mjs'),
      '--fail-on-uncovered-changed',
    ]);
    expect(
      RG01.gate({ ci: ci.replace(/(pnpm run req:coverage[^\n]*)/, '$1 --drill') }).at(-1),
    ).toBe('--drill');
    expect(() =>
      RG01.gate({ ci: ci.replaceAll('pnpm run req:coverage', 'pnpm run lint') }),
    ).toThrow(/traceability job has no step that runs "pnpm run req:coverage"/);
    expect(() => RG01.gate({ pkg: JSON.stringify({ scripts: {} }) })).toThrow(
      /package\.json has no "req:coverage" script/,
    );
  });

  test.each(TOLERANCES)(
    "INF-10-AC10: RG-01 drill — traceability's req:coverage step made to tolerate its gate with $what fails the drill, naming the step and what it found",
    (tolerance) => {
      refusesTolerance('traceability', 'req:coverage', (ci) => RG01.gate({ ci }), tolerance);
    },
  );
});

// ---------------------------------------------------------------------------
// Drill 4 · CI-06 · a breaking API change (AC4)
// ---------------------------------------------------------------------------

const CONTRACT = 'packages/contracts/openapi.json';
const RELEASED = 'drill-0.0.1.json';

/** The committed description with its first path gone, and every operation on it with it. */
function withoutFirstPath(description) {
  const copy = structuredClone(description);
  const [first] = Object.keys(copy.paths ?? {});
  if (first === undefined) {
    throw new Error(`${CONTRACT} has no path to remove, so the drill has nothing to break.`);
  }
  delete copy.paths[first];
  return copy;
}

/** The oasdiff version ci.yml pins in its workflow env (D-082), read, never retyped. */
function pinnedOasdiffVersion(ci = read(CI_YML)) {
  const lines = ci.split('\n');
  const at = lines.findIndex((line) => /^env:\s*$/.test(line));
  const block = at === -1 ? [] : lines.slice(at + 1);
  const end = block.findIndex((line) => /^\S/.test(line));
  const version = (end === -1 ? block : block.slice(0, end))
    .map((line) => /^ {2}OASDIFF_VERSION:[ \t]*(.*?)[ \t]*$/.exec(line)?.[1])
    .find((value) => value !== undefined)
    ?.replace(/\s+#.*$/, '')
    .replace(/^(['"])(.*)\1$/, '$2');
  if (version === undefined || version === '') {
    throw new Error(
      `${CI_YML}'s workflow env pins no OASDIFF_VERSION, which the CI-06 drill holds oasdiff to in CI (INF-10-AC4).`,
    );
  }
  return version;
}

/**
 * Whether oasdiff answers here, asked by running it on the gate's own PATH,
 * node_modules/.bin first, as gate:full asks Docker. In CI it must, and it must
 * be the version ci.yml pins: CI installs that one (D-082), and a binary that
 * shadows it proves nothing. Elsewhere the drill holds api:diff to refusing to
 * pass unchecked, and the report says "fail-closed only".
 */
function oasdiffMode({
  ci = read(CI_YML),
  inCI = process.env.CI === 'true',
  modulesBin = MODULES_BIN,
} = {}) {
  const env = gateEnv({}, modulesBin);
  const probe = spawnSync('oasdiff', ['--version'], { env, encoding: 'utf8', timeout: 30_000 });
  if (!inCI) return probe.status === 0 ? 'detects' : 'fail-closed';
  const where = spawnSync('sh', ['-c', 'command -v oasdiff'], {
    env,
    encoding: 'utf8',
  }).stdout.trim();
  if (probe.status !== 0) {
    throw new Error(
      `In CI the CI-06 drill runs with oasdiff on the gate's PATH, which ci.yml installs from the version and SHA-256 D-082 pins (INF-10-AC16), and ${where === '' ? 'there is none here' : `${where} did not answer --version`}. Without it the drill cannot show api:diff finding a break.`,
    );
  }
  const pinned = pinnedOasdiffVersion(ci);
  const printed = `${probe.stdout ?? ''}${probe.stderr ?? ''}`.trim();
  if (/oasdiff version (\S+)/.exec(printed)?.[1] !== pinned) {
    throw new Error(
      `In CI the CI-06 drill runs the oasdiff ${CI_YML} pins, version ${pinned}, and the one first on the gate's PATH, ${where}, printed "${printed}". A binary that shadows the pinned one is not what CI installed (INF-10-AC4).`,
    );
  }
  return 'detects';
}

/** The oasdiff version ci.yml's workflow env pins, as a test reads it, beside the drill's own reader. */
const pinInCi = () =>
  /^ {2}OASDIFF_VERSION:[ \t]*['"]?([^'"\s]+)['"]?/m.exec(read(CI_YML))?.[1] ?? '';

/** A stand-in oasdiff in `dir` that answers --version with `answer`, or, when that is null, fails as a broken one does. */
function standInOasdiff(dir, answer) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'oasdiff'),
    answer === null
      ? '#!/bin/sh\necho "oasdiff: a stand-in that does not answer" >&2\nexit 127\n'
      : `#!/bin/sh\necho "${answer}"\n`,
    { mode: 0o755 },
  );
  return dir;
}

const CI06 = {
  id: 'CI-06',
  sources: [CI_YML, 'package.json', 'scripts/api-diff.mjs', CONTRACT],
  /** contract's command: api:diff. */
  gate: (files) => commandOf('contract', 'api:diff', files),
  /** Runs `gate` where the released version is the committed description, and the current one is that, broken or not. */
  run(breaking, gate = CI06.gate()) {
    const committed = JSON.parse(read(CONTRACT));
    const current = breaking ? withoutFirstPath(committed) : committed;
    const dir = scratch('ci06');
    writeFiles(dir, {
      [`packages/contracts/released/${RELEASED}`]: `${JSON.stringify(committed, null, 2)}\n`,
      [CONTRACT]: `${JSON.stringify(current, null, 2)}\n`,
    });
    return spawnGate(gate, { cwd: dir, env: gateEnv() });
  },
  judge(result, mode) {
    if (mode === 'fail-closed') {
      return refused(result) && result.output.includes('compatibility was NOT checked')
        ? { verdict: 'fail-closed', why: 'no oasdiff here, and api:diff refused to pass unchecked' }
        : notBlocked(
            `with no oasdiff here, expected api:diff to exit non-zero saying "compatibility was NOT checked"; it gave ${said(result)}`,
          );
    }
    const own =
      new RegExp(`^AR-08: .*${RELEASED.replaceAll('.', '\\.')}`, 'm').test(result.output) &&
      result.output.includes('api-path-removed-without-deprecation');
    return refused(result) && own
      ? blocked('api:diff refused it, with oasdiff finding the path removed')
      : notBlocked(
          `expected api:diff to exit non-zero with its AR-08 line naming ${RELEASED} and oasdiff's api-path-removed-without-deprecation; it gave ${said(result)}`,
        );
  },
  evidence: /comparing the current API with 1 released version\(s\)/,
  controlJudge: (result) =>
    controlAnswer(
      passed(result) &&
        CI06.evidence.test(result.output) &&
        result.output.includes(`--- ${RELEASED} ---`),
      `expected api:diff to pass, having compared ${RELEASED}; it gave ${said(result)}`,
    ),
};
CI06.sample = once(() => CI06.run(true));
CI06.controlSample = once(() => CI06.run(false));

describe('CI-06 drill (4 of 9): a breaking API change', () => {
  test('INF-10-AC4: CI-06 drill — api:diff refuses a current description with an operation removed: oasdiff finds it where it is installed, as it must be in CI, and elsewhere api:diff fails closed', () => {
    const mode = oasdiffMode();
    const verdict = CI06.judge(CI06.sample(), mode);

    expect(verdict.verdict, verdict.why).toBe(mode === 'detects' ? 'blocked' : 'fail-closed');
  });

  test('INF-10-AC4: CI-06 drill — control: the unchanged description passes, having compared 1 released version; with no oasdiff it too is refused unchecked', () => {
    const mode = oasdiffMode();
    if (mode === 'detects') {
      const answer = CI06.controlJudge(CI06.controlSample());

      expect(answer.ok, answer.why).toBe(true);
    } else {
      const verdict = CI06.judge(CI06.controlSample(), mode);

      expect(verdict.verdict, verdict.why).toBe('fail-closed');
    }
  });

  test("INF-10-AC8: CI-06 drill — blocked takes both api:diff's refusal and its own words, and its control shows the released version it compared", () => {
    const mode = oasdiffMode();

    needsBoth((result) => CI06.judge(result, mode), CI06.sample(), {
      verdict: mode === 'detects' ? 'blocked' : 'fail-closed',
    });
    if (mode === 'detects') {
      showsWork(CI06.controlJudge, CI06.controlSample(), (result) => ({
        ...result,
        output: result.output.replace(CI06.evidence, ''),
      }));
    }
  });

  test('INF-10-AC9: CI-06 drill — with api:diff swapped for a stand-in that always passes, and then for one that fails with another message, it says not blocked both times', () => {
    const mode = oasdiffMode();
    for (const standIn of STAND_INS) {
      const verdict = CI06.judge(CI06.run(true, ['sh', '-c', standIn.script]), mode);

      expect(verdict.verdict, standIn.what).toBe('not blocked');
    }
  });

  test("INF-10-AC10: CI-06 drill — runs contract's step through package.json's script, with only the folder its own, and says what it looked for when either is gone", () => {
    const ci = read(CI_YML);

    expect(CI06.gate()).toEqual([process.execPath, path.join(REPO, 'scripts', 'api-diff.mjs')]);
    expect(CI06.gate({ ci: ci.replace(/(pnpm run api:diff[^\n]*)/, '$1 --drill') }).at(-1)).toBe(
      '--drill',
    );
    expect(() => CI06.gate({ ci: ci.replaceAll('pnpm run api:diff', 'pnpm run lint') })).toThrow(
      /contract job has no step that runs "pnpm run api:diff"/,
    );
    expect(() => CI06.gate({ pkg: JSON.stringify({ scripts: {} }) })).toThrow(
      /package\.json has no "api:diff" script/,
    );
  });

  test("INF-10-AC4: CI-06 drill — the oasdiff version it holds CI to is read from ci.yml's workflow env, never retyped, and a copy with none fails it, naming OASDIFF_VERSION", () => {
    const ci = read(CI_YML);
    const pin = /^ {2}OASDIFF_VERSION:[ \t]*['"]?([^'"\s]+)['"]?[ \t]*$/m;

    expect(pinnedOasdiffVersion()).toBe(pin.exec(ci)?.[1]);
    expect(pinnedOasdiffVersion(ci.replace(pin, "  OASDIFF_VERSION: '9.9.9-drill'"))).toBe(
      '9.9.9-drill',
    );
    expect(() => pinnedOasdiffVersion(ci.replace(pin, ''))).toThrow(/OASDIFF_VERSION/);
  });

  test("INF-10-AC4: CI-06 drill — in CI, an oasdiff first on the gate's PATH that is not the pinned version fails the drill, naming where it was, what it printed and the pin: one in node_modules/.bin shadowing the pinned one is caught", () => {
    const pinned = pinInCi();
    standInOasdiff(standInTools().bin, `oasdiff version ${pinned}`);
    const shadow = standInOasdiff(
      path.join(scratch('ci06-modules'), '.bin'),
      'oasdiff version 0.0.1-drill',
    );
    const message = failureOf(() => oasdiffMode({ inCI: true, modulesBin: shadow }));

    expect(message, 'in CI, the drill ran with an oasdiff that is not the pinned one').toContain(
      path.join(shadow, 'oasdiff'),
    );
    expect(message).toContain('oasdiff version 0.0.1-drill');
    expect(message).toContain(pinned);
  });

  test("INF-10-AC4: CI-06 drill — in CI, the pinned oasdiff first on the gate's PATH is detection, and one there that does not answer fails the drill", () => {
    const pinned = pinInCi();
    const modules = path.join(scratch('ci06-modules'), '.bin');
    mkdirSync(modules);
    standInOasdiff(standInTools().bin, `oasdiff version ${pinned}`);

    expect(oasdiffMode({ inCI: true, modulesBin: modules })).toBe('detects');
    expect(
      failureOf(() =>
        oasdiffMode({
          inCI: true,
          modulesBin: standInOasdiff(path.join(scratch('ci06-broken'), '.bin'), null),
        }),
      ),
      'in CI, the drill ran with an oasdiff that does not answer',
    ).toMatch(/^In CI the CI-06 drill runs with oasdiff/);
  });

  test.each(TOLERANCES)(
    "INF-10-AC10: CI-06 drill — contract's api:diff step made to tolerate its gate with $what fails the drill, naming the step and what it found",
    (tolerance) => {
      refusesTolerance('contract', 'api:diff', (ci) => CI06.gate({ ci }), tolerance);
    },
  );
});

// ---------------------------------------------------------------------------
// The hooks: every PreToolUse hook Claude Code would run, as it runs them
// ---------------------------------------------------------------------------

/** The hook commands settings.json declares for `event`, each with its matcher. */
function settingsHooks(event, text = read(SETTINGS)) {
  return (JSON.parse(text).hooks?.[event] ?? []).flatMap((entry) =>
    (entry.hooks ?? [])
      .filter((hook) => hook.type === 'command')
      .map((hook) => ({ source: SETTINGS, matcher: entry.matcher ?? '', command: hook.command })),
  );
}

/** A frontmatter scalar with its quotes taken off. */
function unquoted(value) {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  return value;
}

/** The hook commands an agent's frontmatter declares for `event`, each with its matcher. */
function agentHooks(event, text = read(IMPLEMENTER), file = IMPLEMENTER) {
  const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1];
  if (front === undefined) {
    throw new Error(`${file} has no frontmatter, where the drill reads the agent's hooks.`);
  }
  const lines = front.split('\n');
  const at = lines.findIndex((line) => /^hooks:\s*$/.test(line));
  const found = [];
  let inEvent = false;
  let matcher = '';
  for (const line of at === -1 ? [] : lines.slice(at + 1)) {
    if (/^\S/.test(line)) break;
    const key = /^ {2}(\w+):\s*$/.exec(line);
    if (key !== null) {
      inEvent = key[1] === event;
      continue;
    }
    if (!inEvent) continue;
    const matched = /^\s*-\s*matcher:\s*(.+?)\s*$/.exec(line);
    if (matched !== null) {
      matcher = unquoted(matched[1] ?? '');
      continue;
    }
    const command = /^\s*command:\s*(.+?)\s*$/.exec(line);
    if (command !== null)
      found.push({ source: file, matcher, command: unquoted(command[1] ?? '') });
  }
  if (found.length === 0) {
    throw new Error(
      `${file} declares no ${event} hook, which the drill looks for in its frontmatter.`,
    );
  }
  return found;
}

/** Whether a matcher picks `tool`, as Claude Code reads one: a pattern over the whole tool name, and everything when empty or *. */
const picks = (matcher, tool) =>
  matcher === '' || matcher === '*' || new RegExp(`^(?:${matcher})$`).test(tool);

/** Runs each hook that picks the attempt's tool as Claude Code runs a PreToolUse hook: through the shell, the call on stdin. */
function runHooks(hooks, attempt) {
  const picked = hooks.filter((hook) => picks(hook.matcher, attempt.tool));
  if (picked.length === 0) {
    const where = [...new Set(hooks.map((hook) => hook.source))].join(' or ') || 'nowhere';
    throw new Error(
      `No PreToolUse hook in ${where} picks ${attempt.tool}, so nothing would stop ${attempt.what}.`,
    );
  }
  const input = JSON.stringify({
    session_id: 'inf-10-drill',
    transcript_path: '',
    cwd: REPO,
    permission_mode: 'default',
    hook_event_name: 'PreToolUse',
    tool_name: attempt.tool,
    tool_input: attempt.input,
  });
  return picked.map((hook) => ({
    hook: hook.command,
    ...spawnGate(['sh', '-c', hook.command], {
      cwd: REPO,
      env: drillEnv({ CLAUDE_PROJECT_DIR: REPO }),
      input,
    }),
  }));
}

/** What the hooks answered, for a message. */
const answered = (runs) => runs.map((each) => `${each.hook}\n  ${said(each)}`).join('\n');

// ---------------------------------------------------------------------------
// Drill 5 · HK-02 · implementer editing a test file (AC5)
// ---------------------------------------------------------------------------

/** A path of the kind `glob` names. */
function samplePathFor(glob) {
  const sample = glob
    .replace(/^\*\*\//, 'apps/drill/')
    .replace(/\/\*\*$/, '/drill-sample.yaml')
    .replaceAll('*', 'drill-sample');
  if (!matchesGlob(sample, glob)) throw new Error(`The drill could not make a path for ${glob}.`);
  return sample;
}

/** One path of each kind of test file TEST_GLOBS names, read at run time. */
const TEST_SAMPLES = TEST_GLOBS.map(samplePathFor);
const PRODUCTION_FILE = 'apps/drill/drill-sample.ts';

/** An Edit, a Write, sed -i and a redirect on `file`, each as Claude Code sends it. */
const attemptsOn = (file) => [
  {
    what: `an Edit of ${file}`,
    tool: 'Edit',
    input: { file_path: path.join(REPO, file), old_string: 'one', new_string: 'two' },
  },
  {
    what: `a Write of ${file}`,
    tool: 'Write',
    input: { file_path: path.join(REPO, file), content: '// the drill was here\n' },
  },
  { what: `sed -i on ${file}`, tool: 'Bash', input: { command: `sed -i 's/one/two/' ${file}` } },
  { what: `a redirect into ${file}`, tool: 'Bash', input: { command: `echo drill > ${file}` } },
];

const HK02 = {
  id: 'HK-02',
  sources: [
    SETTINGS,
    IMPLEMENTER,
    '.claude/hooks/guard-paths.mjs',
    '.claude/hooks/guard-bash.mjs',
    '.claude/hooks/scan-sensitive.mjs',
    'scripts/lib/test-strength.mjs',
  ],
  /** What Claude Code runs for implementer: settings.json's PreToolUse hooks, then its own. */
  hooks: ({ settings, agent } = {}) => [
    ...settingsHooks('PreToolUse', settings),
    ...agentHooks('PreToolUse', agent),
  ],
  judge(runs, file = TEST_SAMPLES[0] ?? '') {
    const refusing = runs.find(
      (each) =>
        each.error === '' &&
        each.status === 2 &&
        each.output.includes('Blocked for implementer') &&
        each.output.includes(file) &&
        each.output.includes('RG-03'),
    );
    return refusing === undefined
      ? notBlocked(
          `expected a hook to exit 2 with guard-paths' or guard-bash's message naming implementer, ${file} and RG-03; the hooks answered:\n${answered(runs)}`,
        )
      : blocked(`a hook refused it: ${refusing.output.trim()}`);
  },
  controlJudge: (runs) =>
    controlAnswer(
      runs.length > 0 && runs.every(passed),
      `expected every hook to pass a production file; the hooks answered:\n${answered(runs)}`,
    ),
};
HK02.sample = once(() => runHooks(HK02.hooks(), attemptsOn(TEST_SAMPLES[0] ?? '')[0]));
HK02.controlSample = once(() => runHooks(HK02.hooks(), attemptsOn(PRODUCTION_FILE)[0]));

describe('HK-02 drill (5 of 9): implementer editing a test file', () => {
  test.each(TEST_SAMPLES)(
    "INF-10-AC5: HK-02 drill — the hooks Claude Code runs for implementer refuse an Edit, a Write, sed -i and a redirect on %s, in guard-paths' or guard-bash's words",
    explained((file) => {
      const hooks = HK02.hooks();
      for (const attempt of attemptsOn(file)) {
        const verdict = HK02.judge(runHooks(hooks, attempt), file);

        expect(verdict.verdict, `${attempt.what}: ${verdict.why}`).toBe('blocked');
      }
    }),
    SLOW,
  );

  test(
    'INF-10-AC5: HK-02 drill — control: the same Edit, Write, sed -i and redirect on a production file pass every hook',
    explained(() => {
      const hooks = HK02.hooks();
      for (const attempt of attemptsOn(PRODUCTION_FILE)) {
        const answer = HK02.controlJudge(runHooks(hooks, attempt));

        expect(answer.ok, `${attempt.what}: ${answer.why}`).toBe(true);
      }
    }),
    SLOW,
  );

  test(
    "INF-10-AC8: HK-02 drill — blocked takes a hook's exit 2 and the guard's own words together, and its control is every hook passing",
    explained(() => {
      needsBoth((runs) => HK02.judge(runs), HK02.sample(), { hook: true });
      showsWork(HK02.controlJudge, HK02.controlSample(), () => []);
    }),
  );

  test('INF-10-AC9: HK-02 drill — with the hooks swapped for a stand-in that always passes, and then for one that blocks with another message, it says not blocked both times', () => {
    const attempt = attemptsOn(TEST_SAMPLES[0] ?? '')[0];
    for (const standIn of STAND_IN_HOOKS) {
      const hooks = [{ source: 'a stand-in', matcher: '', command: standIn.command }];
      const verdict = HK02.judge(runHooks(hooks, attempt));

      expect(verdict.verdict, standIn.what).toBe('not blocked');
    }
  });

  test(
    'INF-10-AC10: HK-02 drill — runs the PreToolUse hooks settings.json and implementer.md declare, as written there, notices a narrowed hook line, and says what it looked for when implementer.md declares none',
    explained(() => {
      const settings = read(SETTINGS);
      const agent = read(IMPLEMENTER);
      const hooks = HK02.hooks();

      for (const tool of ['Edit', 'Write', 'Bash']) {
        expect(
          hooks.filter((hook) => picks(hook.matcher, tool)).map((hook) => hook.source),
          tool,
        ).toEqual([SETTINGS, IMPLEMENTER]);
      }
      for (const hook of hooks) {
        if (hook.source === SETTINGS) expect(settings).toContain(JSON.stringify(hook.command));
        else expect(agent).toContain(hook.command);
      }
      // The drift the spec found in guard-paths.test.mjs's hand-copied arguments:
      // a line without the .tsx pattern lets a .tsx test through, and the drill says so.
      const narrowed = agent
        .replaceAll(' --deny "**/*.test.tsx"', '')
        .replaceAll(' --deny-write-glob "**/*.test.tsx"', '');
      const tsx = TEST_SAMPLES.find((file) => file.endsWith('.tsx')) ?? '';
      const verdict = HK02.judge(
        runHooks(HK02.hooks({ agent: narrowed }), attemptsOn(tsx)[0]),
        tsx,
      );

      expect(narrowed).not.toBe(agent);
      expect(verdict.verdict).toBe('not blocked');
      expect(verdict.why).toContain(tsx);
      expect(() => HK02.hooks({ agent: agent.replace(/^hooks:[\s\S]*?(?=^---)/m, '') })).toThrow(
        /implementer\.md declares no PreToolUse hook/,
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// Drill 7 · HK-07 · a secret or a real-looking phone number (AC6)
// ---------------------------------------------------------------------------

const SENSITIVE_FILE = 'apps/drill/push.ts';

/** A Write and an Edit putting `text` into `file`, as Claude Code sends each. */
const writesOf = (file, text) => [
  { what: 'a Write', tool: 'Write', input: { file_path: path.join(REPO, file), content: text } },
  {
    what: 'an Edit',
    tool: 'Edit',
    input: { file_path: path.join(REPO, file), old_string: '// placeholder', new_string: text },
  },
];

/** What scan-sensitive must say, by what it refused. */
const SCAN_WORDS = {
  secret: ['hard-coded secret'],
  number: ['Norwegian mobile number', 'RG-07'],
};

const HK07 = {
  id: 'HK-07',
  sources: [SETTINGS, '.claude/hooks/scan-sensitive.mjs'],
  /** Every PreToolUse hook settings.json declares, for every session. */
  hooks: ({ settings } = {}) => settingsHooks('PreToolUse', settings),
  judge(runs, kind = 'secret') {
    const words = SCAN_WORDS[kind] ?? [];
    const refusing = runs.find(
      (each) =>
        each.error === '' && each.status === 2 && words.every((word) => each.output.includes(word)),
    );
    return refusing === undefined
      ? notBlocked(
          `expected a hook to exit 2 with scan-sensitive's message, ${words.join(' and ')}; the hooks answered:\n${answered(runs)}`,
        )
      : blocked(`a hook refused it: ${refusing.output.trim()}`);
  },
  controlJudge: (runs) =>
    controlAnswer(
      runs.length > 0 && runs.every(passed),
      `expected every hook to pass the same code without it; the hooks answered:\n${answered(runs)}`,
    ),
};
HK07.sample = once(() => runHooks(HK07.hooks(), writesOf(SENSITIVE_FILE, SECRET_LINE)[0]));
HK07.controlSample = once(() =>
  runHooks(HK07.hooks(), writesOf(SENSITIVE_FILE, SECRET_FROM_ENV)[0]),
);

describe('HK-07 drill (7 of 9): a secret or a real-looking phone number', () => {
  test(
    "INF-10-AC6: HK-07 drill — a Write and an Edit holding a hard-coded secret are refused in scan-sensitive's words",
    explained(() => {
      for (const attempt of writesOf(SENSITIVE_FILE, SECRET_LINE)) {
        const verdict = HK07.judge(runHooks(HK07.hooks(), attempt), 'secret');

        expect(verdict.verdict, `${attempt.what}: ${verdict.why}`).toBe('blocked');
      }
    }),
  );

  test(
    "INF-10-AC6: HK-07 drill — a Write and an Edit holding a real-looking Norwegian mobile number are refused in scan-sensitive's words, with RG-07",
    explained(() => {
      for (const attempt of writesOf(SENSITIVE_FILE, NUMBER_LINE)) {
        const verdict = HK07.judge(runHooks(HK07.hooks(), attempt), 'number');

        expect(verdict.verdict, `${attempt.what}: ${verdict.why}`).toBe('blocked');
      }
    }),
  );

  test(
    'INF-10-AC6: HK-07 drill — control: the same code reading the key from the environment, and with no number, passes every hook',
    explained(() => {
      for (const text of [SECRET_FROM_ENV, NO_NUMBER]) {
        for (const attempt of writesOf(SENSITIVE_FILE, text)) {
          const answer = HK07.controlJudge(runHooks(HK07.hooks(), attempt));

          expect(answer.ok, `${attempt.what}: ${answer.why}`).toBe(true);
        }
      }
    }),
  );

  test(
    "INF-10-AC8: HK-07 drill — blocked takes a hook's exit 2 and scan-sensitive's own words together, and its control is every hook passing",
    explained(() => {
      needsBoth((runs) => HK07.judge(runs), HK07.sample(), { hook: true });
      showsWork(HK07.controlJudge, HK07.controlSample(), () => []);
    }),
  );

  test('INF-10-AC9: HK-07 drill — with the hooks swapped for a stand-in that always passes, and then for one that blocks with another message, it says not blocked both times', () => {
    const attempt = writesOf(SENSITIVE_FILE, SECRET_LINE)[0];
    for (const standIn of STAND_IN_HOOKS) {
      const hooks = [{ source: 'a stand-in', matcher: '', command: standIn.command }];
      const verdict = HK07.judge(runHooks(hooks, attempt));

      expect(verdict.verdict, standIn.what).toBe('not blocked');
    }
  });

  test(
    "INF-10-AC10: HK-07 drill — runs settings.json's Edit and Write hooks as written there, and says what it looked for when there are none",
    explained(() => {
      const settings = read(SETTINGS);
      const hooks = HK07.hooks();

      for (const tool of ['Edit', 'Write']) {
        const picked = hooks.filter((hook) => picks(hook.matcher, tool));

        expect(picked.length, tool).toBeGreaterThan(0);
        for (const hook of picked) expect(settings).toContain(JSON.stringify(hook.command));
      }
      const parsed = JSON.parse(settings);
      parsed.hooks.PreToolUse = parsed.hooks.PreToolUse.filter(
        (entry) => !picks(entry.matcher ?? '', 'Write'),
      );
      const without = HK07.hooks({ settings: JSON.stringify(parsed) });

      expect(() => runHooks(without, writesOf(SENSITIVE_FILE, SECRET_LINE)[0])).toThrow(
        /No PreToolUse hook in \.claude\/settings\.json picks Write/,
      );
    }),
  );
});

// ---------------------------------------------------------------------------
// Drill 9 · CI-11 · a blocking AI review verdict (AC7)
// ---------------------------------------------------------------------------

/** This pull request, as the drill's stand-ins for GitHub have it. */
const PULL = { repo: 'drill-owner/drill-repo', number: '4242', comment: '4343' };
const COMMENT_URL = `https://github.com/${PULL.repo}/pull/${PULL.number}#issuecomment-${PULL.comment}`;
const READ_BACK = `gh api repos/${PULL.repo}/issues/comments/${PULL.comment}`;

/** The blocking reviewers, as merge-rules.mjs lists their checks. */
const BLOCKING_REVIEWERS = CHECKS.filter(
  (check) => check.blocking && /^ai-review \(.+\)$/.test(check.check),
).map((check) => check.check.slice('ai-review ('.length, -1));

/** The if: ai-review.yml gives "Enforce the verdict", and the only one it may have (AC10). */
const VERDICT_GUARD = "steps.applies.outputs.run == 'true'";

/**
 * The step "Enforce the verdict", read from ai-review.yml's review job, with
 * its own if: and continue-on-error:. One that tolerates a BLOCK, by
 * continue-on-error or an if: other than its own, fails the drill: the drill
 * runs its script, and GitHub, not the script, reads those (AC10).
 */
function verdictStep(text = read(AI_REVIEW_YML)) {
  const steps = stepsOf(text, 'review');
  if (steps === null) {
    throw new Error(
      `${AI_REVIEW_YML} has no review job, where the drill looks for "Enforce the verdict".`,
    );
  }
  const step = steps.find((each) => /^\s*(?:-\s+)?name:\s*Enforce the verdict\s*$/m.test(each));
  if (step === undefined) {
    throw new Error(
      `${AI_REVIEW_YML}'s review job has no step named "Enforce the verdict", which this drill runs.`,
    );
  }
  const tolerates = tolerance(step, VERDICT_GUARD);
  if (tolerates !== '') {
    throw new Error(
      `${AI_REVIEW_YML}'s step "Enforce the verdict" ${tolerates}. A step made to tolerate a BLOCK no longer enforces it, so this drill does not run it either (INF-10-AC10).`,
    );
  }
  return {
    script: runOf(step),
    env: envOf(step),
    shell: /^\s*shell:\s*(\S+)\s*$/m.exec(step)?.[1],
    if: stepKey(step, 'if'),
    continueOnError: stepKey(step, 'continue-on-error'),
  };
}

/** The review job's matrix, each entry as its keys and values. */
function reviewMatrix(text = read(AI_REVIEW_YML)) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => /^\s+include:\s*$/.test(line));
  const found = [];
  for (const line of at === -1 ? [] : lines.slice(at + 1)) {
    if (line.trim().startsWith('#')) continue;
    const entry = /^\s*-\s*\{(.*)\}\s*$/.exec(line);
    if (entry === null) break;
    found.push(
      Object.fromEntries(
        (entry[1] ?? '').split(',').map((pair) => pair.split(':').map((part) => part.trim())),
      ),
    );
  }
  if (found.length === 0) {
    throw new Error(
      `${AI_REVIEW_YML} has no matrix of reviewers, where the drill reads matrix.agent and matrix.blocking.`,
    );
  }
  return found;
}

/** The --json-schema ai-review.yml hands the reviewers. */
function reviewSchema(text = read(AI_REVIEW_YML)) {
  const schema = /--json-schema\s+'(?<schema>[^']+)'/.exec(text)?.groups?.schema;
  if (schema === undefined) {
    throw new Error(
      `${AI_REVIEW_YML} passes no --json-schema, which the drill's structured output must satisfy.`,
    );
  }
  return JSON.parse(schema);
}

/** What in `value` does not satisfy `schema`, for the keywords the workflow's schema uses. */
function schemaProblems(schema, value, at = 'the structured output') {
  const known = new Set([
    'type',
    'properties',
    'required',
    'enum',
    'pattern',
    'additionalProperties',
  ]);
  const problems = Object.keys(schema)
    .filter((key) => !known.has(key))
    .map((key) => `${at}: the drill does not know the schema keyword ${key}`);
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null) return [...problems, `${at} is not an object`];
    for (const name of schema.required ?? []) {
      if (!(name in value)) problems.push(`${at} has no ${name}`);
    }
    for (const [name, inner] of Object.entries(schema.properties ?? {})) {
      if (name in value) problems.push(...schemaProblems(inner, value[name], `${at}.${name}`));
    }
    if (schema.additionalProperties === false) {
      for (const name of Object.keys(value)) {
        if (!(name in (schema.properties ?? {})))
          problems.push(`${at} has ${name}, which it may not`);
      }
    }
  }
  if (schema.type === 'string' && typeof value !== 'string') problems.push(`${at} is not a string`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    problems.push(`${at} is not one of ${schema.enum.join(', ')}`);
  }
  if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(String(value))) {
    problems.push(`${at} does not match ${schema.pattern}`);
  }
  return problems;
}

/** How GitHub runs a step's script: `bash -e`, or `-eo pipefail` under shell: bash. */
function bashFlags(shell) {
  if (shell === undefined) return ['-e'];
  if (shell === 'bash') return ['--noprofile', '--norc', '-eo', 'pipefail'];
  throw new Error(
    `"Enforce the verdict" runs under shell: ${shell}, which this drill does not know how GitHub runs.`,
  );
}

/**
 * Runs "Enforce the verdict" as GitHub runs it, for `agent` as the workflow's
 * matrix has it, after a review that returned `verdict` in output that
 * satisfies the workflow's own schema, and a comment on this pull request that
 * says `says`. gh is the stand-in, set up to answer the one read-back; jq is
 * the real one. There is no token at all: the stand-in needs none.
 */
function runVerdict(agent, verdict, { says = verdict, script, text = read(AI_REVIEW_YML) } = {}) {
  const step = verdictStep(text);
  const entry = reviewMatrix(text).find((each) => each.agent === agent);
  if (entry === undefined) {
    throw new Error(`${AI_REVIEW_YML}'s matrix has no ${agent}, whose verdict the drill enforces.`);
  }
  const body = standInFor(
    script ?? step.script,
    new Map([
      ['matrix.agent', entry.agent ?? ''],
      ['matrix.blocking', entry.blocking ?? ''],
    ]),
    '"Enforce the verdict"',
  );
  const structured = {
    verdict,
    summary: `A synthetic ${verdict} from the drill.`,
    commentUrl: COMMENT_URL,
  };
  const problems = schemaProblems(reviewSchema(text), structured);
  if (problems.length > 0) {
    throw new Error(
      `The drill's structured output does not satisfy ${AI_REVIEW_YML}'s own schema: ${problems.join('; ')}.`,
    );
  }
  const env = {};
  for (const [name, value] of Object.entries(step.env)) {
    const expression = /^\$\{\{\s*(.*?)\s*\}\}$/.exec(value)?.[1];
    if (expression === 'steps.review.outputs.structured_output')
      env[name] = JSON.stringify(structured);
    else if (expression === 'github.event.pull_request.number') env[name] = PULL.number;
    else if (expression !== 'secrets.GITHUB_TOKEN') {
      throw new Error(
        `"Enforce the verdict" sets ${name} from ${value}, which this drill does not know how to stand in for.`,
      );
    }
  }
  if (spawnSync('jq', ['--version'], { env: drillEnv(), encoding: 'utf8' }).status !== 0) {
    throw new Error(
      'The CI-11 drill runs "Enforce the verdict" with the real jq, and there is no jq on PATH (R15).',
    );
  }
  const dir = scratch('ci11');
  const answer = path.join(dir, 'comment.answer.json');
  writeFileSync(
    answer,
    JSON.stringify({
      id: Number(PULL.comment),
      issue_url: `https://api.github.com/repos/${PULL.repo}/issues/${PULL.number}`,
      body: `${agent}, reviewing for the drill.\n\nVerdict: ${says}\n`,
    }),
  );
  writeFileSync(path.join(dir, 'step.sh'), body);
  const { ghLog } = standInTools();
  rmSync(ghLog, { force: true });
  const result = spawnGate(['bash', ...bashFlags(step.shell), 'step.sh'], {
    cwd: dir,
    env: drillEnv({
      ...env,
      GITHUB_REPOSITORY: PULL.repo,
      DRILL_GH_EXPECT: READ_BACK.slice('gh '.length),
      DRILL_GH_ANSWER: answer,
    }),
  });
  return { ...result, gh: existsSync(ghLog) ? readFileSync(ghLog, 'utf8') : '' };
}

/** A stand-in for the step: one that always passes, and one that fails with another message. */
const STAND_IN_STEPS = [
  { what: 'a stand-in step that always passes', script: 'echo "stand-in step: all fine"\n' },
  {
    what: 'a stand-in step that fails with another message',
    script: 'echo "::error::stand-in step: something unrelated"\nexit 1\n',
  },
];

const FIRST_REVIEWER = BLOCKING_REVIEWERS[0] ?? '';

/**
 * The ways "Enforce the verdict" is made to tolerate a BLOCK (AC10), and what
 * the drill must say it found. A shell operator in its script is run, as GitHub
 * runs it, so the drill finds what it did; the step's own keys are read.
 */
const VERDICT_TOLERANCES = [
  {
    what: 'its script run in a subshell with || true after it',
    found: 'exit 0',
    tolerate: (step) =>
      step
        .replace(/^( {8}run: \|\n)/m, '$1          (\n')
        .replace(/\n*$/, '\n          ) || true\n'),
  },
  CONTINUE_ON_ERROR,
  IF_FALSE,
];

/** What the CI-11 drill says of a BLOCK with ai-review.yml as `text`: why it is not blocked, or '' when it is. */
function verdictFailure(text) {
  let why = '';
  const thrown = failureOf(() => {
    const verdict = CI11.judge(runVerdict(FIRST_REVIEWER, 'BLOCK', { text }));
    why = verdict.verdict === 'blocked' ? '' : verdict.why;
  });
  return thrown === '' ? why : thrown;
}

const CI11 = {
  id: 'CI-11',
  sources: [AI_REVIEW_YML, 'scripts/lib/merge-rules.mjs'],
  judge(result, agent = FIRST_REVIEWER) {
    const own =
      result.output.includes(`::error::${agent} blocks this pull request`) &&
      result.gh.includes(READ_BACK);
    return refused(result) && own
      ? blocked(`"Enforce the verdict" failed the check: ${agent} blocks this pull request`)
      : notBlocked(
          `expected "Enforce the verdict" to exit non-zero with its error "${agent} blocks this pull request", after reading the comment back; it gave ${said(result)}\nand gh was asked:\n${result.gh || '(nothing)'}`,
        );
  },
  controlJudge: (result, agent = FIRST_REVIEWER) =>
    controlAnswer(
      passed(result) &&
        result.output.includes(`${agent}: PASS, corroborated by ${COMMENT_URL}`) &&
        result.gh.includes(READ_BACK),
      `expected "Enforce the verdict" to pass, "PASS, corroborated by" the comment it read back; it gave ${said(result)}\nand gh was asked:\n${result.gh || '(nothing)'}`,
    ),
};
CI11.sample = once(() => runVerdict(FIRST_REVIEWER, 'BLOCK'));
CI11.controlSample = once(() => runVerdict(FIRST_REVIEWER, 'PASS'));

describe('CI-11 drill (9 of 9): a blocking AI review verdict', () => {
  test('INF-10-AC7: CI-11 drill — the reviewers ai-review.yml marks blocking are exactly the blocking ai-review checks in merge-rules.mjs', () => {
    const blocking = reviewMatrix()
      .filter((entry) => entry.blocking === 'true')
      .map((entry) => entry.agent)
      .sort();

    expect(BLOCKING_REVIEWERS).toHaveLength(3);
    expect(blocking).toEqual([...BLOCKING_REVIEWERS].sort());
  });

  test.each(BLOCKING_REVIEWERS)(
    'INF-10-AC7: CI-11 drill — a BLOCK from %s, with its comment on this pull request saying BLOCK, fails "Enforce the verdict" in its own words',
    (agent) => {
      const verdict = CI11.judge(runVerdict(agent, 'BLOCK'), agent);

      expect(verdict.verdict, verdict.why).toBe('blocked');
    },
  );

  test.each(BLOCKING_REVIEWERS)(
    'INF-10-AC7: CI-11 drill — control: a PASS from %s, with a comment saying PASS, passes, corroborated by the comment it read back',
    (agent) => {
      const answer = CI11.controlJudge(runVerdict(agent, 'PASS'), agent);

      expect(answer.ok, answer.why).toBe(true);
    },
  );

  test('INF-10-AC8: CI-11 drill — blocked takes both the failed step and its own error, and its control shows the verdict it read back', () => {
    needsBoth((result) => CI11.judge(result), CI11.sample());
    showsWork(CI11.controlJudge, CI11.controlSample(), (result) => ({ ...result, gh: '' }));
  });

  test('INF-10-AC9: CI-11 drill — with the step swapped for a stand-in that always passes, and then for one that fails with another message, it says not blocked both times', () => {
    for (const standIn of STAND_IN_STEPS) {
      const verdict = CI11.judge(runVerdict(FIRST_REVIEWER, 'BLOCK', { script: standIn.script }));

      expect(verdict.verdict, standIn.what).toBe('not blocked');
    }
  });

  test('INF-10-AC10: CI-11 drill — runs the step named "Enforce the verdict" from ai-review.yml, and says what it looked for when the step, the reviewer or a stand-in is missing', () => {
    const text = read(AI_REVIEW_YML);

    expect(verdictStep().script).toContain('blocks this pull request');
    expect(() =>
      runVerdict(FIRST_REVIEWER, 'BLOCK', {
        text: text.replace('name: Enforce the verdict', 'name: Something else'),
      }),
    ).toThrow(/no step named "Enforce the verdict"/);
    expect(() =>
      runVerdict(FIRST_REVIEWER, 'BLOCK', {
        text: text.replace(`agent: ${FIRST_REVIEWER},`, 'agent: someone-else,'),
      }),
    ).toThrow(`matrix has no ${FIRST_REVIEWER}`);
    expect(() =>
      runVerdict(FIRST_REVIEWER, 'BLOCK', {
        text: text.replace(
          /(name: Enforce the verdict[\s\S]*?run: \|\n)/,
          '$1          echo "${{ github.actor }}"\n',
        ),
      }),
    ).toThrow(/does not know how to stand in for/);
  });

  test('INF-10-AC10: CI-11 drill — the step reader gives "Enforce the verdict"\'s own if:, the one ai-review.yml gives it, and no continue-on-error', () => {
    const { if: guard, continueOnError } = verdictStep();

    expect({ if: guard, continueOnError }).toEqual({
      if: "steps.applies.outputs.run == 'true'",
      continueOnError: '',
    });
  });

  test.each(VERDICT_TOLERANCES)(
    'INF-10-AC10: CI-11 drill — "Enforce the verdict" made to tolerate a BLOCK with $what fails the drill, naming the step and what it found',
    ({ tolerate, found }) => {
      const text = tolerating(read(AI_REVIEW_YML), 'review', 'name: Enforce the verdict', tolerate);
      const message = verdictFailure(text);

      expect(message, 'the drill said blocked for a step that tolerates a BLOCK').toContain(
        '"Enforce the verdict"',
      );
      expect(message, message).toContain(found);
    },
  );
});

// ---------------------------------------------------------------------------
// Every drill
// ---------------------------------------------------------------------------

/** The seven offline drills, in the roadmap's order. */
const DRILLS = [RG03, CI03, RG01, CI06, HK02, HK07, CI11];

describe('every drill: the CI steps it reads', () => {
  test("INF-10-AC10: the step reader gives each gate step's line, if: and continue-on-error: as ci.yml has them: no if: for traceability's, the CI-12 code guard for unit's and contract's", () => {
    const code = "steps.affected.outputs.code == 'true'";
    const stepOf = (job, script) => {
      const { line, if: guard, continueOnError } = gateStep(job, script);
      return { line, if: guard, continueOnError };
    };

    expect(stepOf('traceability', 'tests:changes')).toEqual({
      line: "pnpm run tests:changes --base origin/${{ github.base_ref || 'main' }}",
      if: '',
      continueOnError: '',
    });
    expect(stepOf('traceability', 'req:coverage')).toEqual({
      line: 'pnpm run req:coverage --fail-on-uncovered-changed',
      if: '',
      continueOnError: '',
    });
    expect(stepOf('unit', 'test:unit')).toEqual({
      line: 'pnpm run test:unit',
      if: code,
      continueOnError: '',
    });
    expect(stepOf('contract', 'api:diff')).toEqual({
      line: 'pnpm run api:diff',
      if: code,
      continueOnError: '',
    });
  });

  test("INF-10-AC10: tests:changes, req:coverage and api:diff each run as pnpm runs a script: the repository's node_modules/.bin first on PATH, and the stand-in gh next", () => {
    const printPath = ['sh', '-c', 'echo "PATH=$PATH"'];
    const runs = {
      'tests:changes': RG03.run(() => THREE_TESTS, printPath),
      'req:coverage': RG01.run('control', printPath),
      'api:diff': CI06.run(false, printPath),
    };

    for (const [gate, result] of Object.entries(runs)) {
      const entries = (/^PATH=(.*)$/m.exec(result.output)?.[1] ?? '').split(path.delimiter);

      expect(entries.slice(0, 2), `${gate}: ${said(result)}`).toEqual([
        path.join(REPO, 'node_modules', '.bin'),
        standInTools().bin,
      ]);
    }
  });
});

describe('every drill: run by unit whenever a gate changes', () => {
  test.each(DRILLS)(
    'INF-10-AC14: $id drill — every file it reads or runs exists, and CI-12 calls a change to any of them code, so unit runs the drills',
    (drill) => {
      const files = withImports(drill.sources);

      expect(files.length).toBeGreaterThanOrEqual(drill.sources.length);
      expect(files.filter((file) => !existsSync(path.join(REPO, file)))).toEqual([]);
      expect(files.filter((file) => onlyInert([file]))).toEqual([]);
    },
  );
});

/**
 * AC11: no value of the runner's tokens, and none of its proxies, reached a
 * gate that printed `seen` and was given `gate`. Each check asserts true or
 * false, so a failure names the variable and never prints its value.
 */
function expectNoLeak(seen, gate, runner = process.env) {
  for (const [name, value = ''] of Object.entries(runner)) {
    if (/TOKEN|SECRET|PASSWORD|_KEY$/i.test(name) && value.length > 8) {
      expect(seen.includes(value), `${name}'s value reached the gate`).toBe(false);
    }
    if (/PROXY/i.test(name) && value !== '') {
      expect(gate.get(name) === value, `the runner's ${name} reached the gate`).toBe(false);
    }
  }
}

/** Runs `node -e script ...args` in `env` without blocking this process, which may be answering it: its exit status and what it printed. */
function nodeRun(script, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    const bound = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.on('error', reject);
    child.on('close', (status, signal) => {
      clearTimeout(bound);
      resolve({ status, signal, output });
    });
  });
}

/** A server on this machine that counts who reached it: where the network test sends a gate's fetch. */
async function countingServer() {
  let hits = 0;
  const server = http.createServer((_, response) => {
    hits += 1;
    response.end('reached');
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(undefined));
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}/`,
    hits: () => hits,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve(undefined));
      }),
  };
}

/** Node's own fetch, from a spawned process: what it fetched, or why it could not. */
const FETCH = [
  'fetch(process.argv[1])',
  '  .then((response) => response.text())',
  "  .then((text) => console.log('fetched: ' + text), (error) => {",
  "    console.log('refused: ' + String(error.cause?.code ?? error.message));",
  '    process.exitCode = 3;',
  '  });',
].join('\n');

/** Where AC11 looks for a skip form: the files RG-03 counts, as TEST_GLOBS names them, read at run time. */
const SKIP_FORM_PATHSPECS = TEST_GLOBS.map((glob) => `:(glob)${glob}`);

/** The files under `cwd`, tracked or not, that hold `needle`, one a line, searched in `pathspecs` or everywhere. */
function holding(needle, pathspecs = [], cwd = REPO) {
  const found = spawnSync(
    'git',
    ['grep', '-l', '-F', '--untracked', '-e', needle, '--', ...pathspecs],
    { cwd, encoding: 'utf8' },
  );
  if (found.status !== 0 && found.status !== 1) {
    throw new Error(`git grep could not search for ${needle}: ${found.stderr}`);
  }
  return found.stdout.trim();
}

describe('every drill: offline, synthetic and tidy', () => {
  test('INF-10-AC11: a gate a drill spawns sees an explicit environment: no token, no GITHUB_ or CI variable, no proxy of the runner, and a home of its own', () => {
    const seen = spawnSync('sh', ['-c', 'env'], { env: drillEnv(), encoding: 'utf8' }).stdout;
    const gate = new Map(
      seen
        .split('\n')
        .filter((line) => line.includes('='))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );

    expect(
      [...gate.keys()].filter((name) =>
        /^(GITHUB_|GH_|RUNNER_|ACTIONS_)|^CI$|TOKEN|SECRET|PASSWORD|_KEY$/i.test(name),
      ),
    ).toEqual([]);
    expectNoLeak(seen, gate);
    expect(gate.get('HOME')).toBe(standInTools().home);
  });

  test("INF-10-AC11: the check that no token or proxy reaches a gate asserts true or false, so its failure names the variable and never prints the variable's value", () => {
    const value = ['drill', 'leak', 'probe', 'value'].join('-');
    const proxy = `http://${['drill', 'proxy'].join('-')}.invalid:3128`;
    const leaks = [
      [
        'DRILL_TOKEN',
        value,
        () => expectNoLeak(`DRILL_TOKEN=${value}\n`, new Map(), { DRILL_TOKEN: value }),
      ],
      [
        'DRILL_PROXY',
        proxy,
        () => expectNoLeak('', new Map([['DRILL_PROXY', proxy]]), { DRILL_PROXY: proxy }),
      ],
    ];

    for (const [name, secret, check] of leaks) {
      let caught;
      try {
        check();
      } catch (error) {
        caught = error;
      }
      const shown = [caught?.message, caught?.stack, caught?.actual, caught?.expected]
        .map((part) => String(part))
        .join('\n');

      expect(caught === undefined, `a leak of ${name} got through the check`).toBe(false);
      expect(shown.includes(name), `the failure does not name ${name}`).toBe(true);
      expect(shown.includes(secret), `the failure prints ${name}'s value`).toBe(false);
    }
  });

  test("INF-10-AC11: Node's own fetch in a spawned gate cannot reach the network: NODE_USE_ENV_PROXY sends it to the dead proxy, as a server on this machine that counts its visitors shows", async () => {
    const server = await countingServer();
    try {
      const env = drillEnv();
      const direct = { ...env };
      delete direct.NODE_USE_ENV_PROXY;
      // The control: without the variable, fetch goes past every proxy variable
      // to the server, so this test can go red.
      const control = await nodeRun(FETCH, [server.url], direct);

      expect(control.output, 'the control could not reach the server').toContain(
        'fetched: reached',
      );
      expect(server.hits()).toBe(1);

      const gate = await nodeRun(FETCH, [server.url], env);

      expect(gate.output, "a spawned gate's fetch reached the network").not.toContain('fetched:');
      expect(server.hits(), "a spawned gate's fetch reached the server").toBe(1);
      expect(gate.output).toMatch(/^refused: /m);
      expect(env.NODE_USE_ENV_PROXY).toBe('1');
    } finally {
      await server.close();
    }
  });

  test('INF-10-AC11: the search for skip forms reads TEST_GLOBS, so it covers every kind of test file RG-03 counts, and only those', () => {
    for (const glob of TEST_GLOBS) {
      expect(SKIP_FORM_PATHSPECS, glob).toContain(`:(glob)${glob}`);
    }
    const needle = ['drill', 'needle', 'for', 'the', 'search'].join('-');
    const outside = 'docs/drill-sample.md';
    const dir = scratchRepo(
      'ac11-search',
      Object.fromEntries([...TEST_SAMPLES, outside].map((file) => [file, `${needle}\n`])),
      {},
    );

    expect(holding(needle, SKIP_FORM_PATHSPECS, dir).split('\n').sort()).toEqual(
      [...TEST_SAMPLES].sort(),
    );
  });

  test('INF-10-AC11: the only gh a spawned gate reaches is the stand-in, which refuses any call it was not set up for', () => {
    const env = drillEnv();
    const call = spawnSync('gh', ['api', 'user'], { env, encoding: 'utf8' });

    expect(spawnSync('sh', ['-c', 'command -v gh'], { env, encoding: 'utf8' }).stdout.trim()).toBe(
      path.join(standInTools().bin, 'gh'),
    );
    expect(call.status).not.toBe(0);
    expect(call.stderr).toContain('refused a call it was not set up for: gh api user');
  });

  test(
    'INF-10-AC11: no committed file holds the secret or the number, and no test file holds a skip form',
    explained(() => {
      const own = readFileSync(import.meta.filename, 'utf8');
      const write = {
        what: 'a Write of the drill file',
        tool: 'Write',
        input: { file_path: import.meta.filename, content: own },
      };

      expect(strengthOf(own).skips, 'RG-03 counts a skip in the drill file itself').toBe(0);
      for (const each of runHooks(settingsHooks('PreToolUse'), write)) {
        expect(each.status, each.output).toBe(0);
      }
      for (const needle of [SECRET_LINE.trim(), PHONE]) expect(holding(needle), needle).toBe('');
      for (const needle of SWITCH_OFF_TEXT) {
        expect(holding(needle, SKIP_FORM_PATHSPECS), needle).toBe('');
      }
    }),
  );

  // Last in the file, so it sees what every drill before it left behind.
  test('INF-10-AC11: every scratch folder was outside the repository and is gone, and git status is as it was', () => {
    RG03.run(() => THREE_TESTS);
    const made = [...MADE];
    removeScratch();

    expect(made.length).toBeGreaterThan(0);
    for (const dir of made) {
      expect(path.relative(REPO, dir).startsWith('..'), dir).toBe(true);
      expect(existsSync(dir), dir).toBe(false);
    }
    expect(gitStatus()).toBe(STATUS_BEFORE);
  });
});
