// INF-07, D-077: the two staging workflows, held to what makes them safe.
//
// Neither can run from a pull request — GitHub runs them only from main, and
// only with the staging keys — so a mistake in them is found in production or
// not at all. These tests are the review that runs before that.
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, test } from 'vitest';
import { PLAN_JOB, WORKFLOW } from './lib/plan-approval.mjs';
import { findJobIds } from './lib/workflow-lint.mjs';

const read = (name) =>
  readFileSync(path.join(import.meta.dirname, '..', '.github', 'workflows', name), 'utf8');

const deploy = read('deploy-staging.yml');
const infra = read('infra-staging.yml');

/** The lines of one job, from its id to the next job or the end. */
function job(text, id) {
  const lines = text.split('\n');
  const start = lines.indexOf(`  ${id}:`);
  if (start === -1) {
    throw new Error(`No job "${id}".`);
  }
  const end = lines.findIndex((line, index) => index > start && /^ {2}[\w-]+:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** A step's `run: |` script, as the runner would execute it. */
function stepScript(text, jobId, stepName) {
  const lines = job(text, jobId).split('\n');
  const at = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  const runAt = lines.findIndex((line, index) => index > at && /^\s+run: \|$/.test(line));
  if (at === -1 || runAt === -1) {
    throw new Error(`No step "${stepName}" with a run: | block in ${jobId}.`);
  }
  const indent = (lines[runAt] ?? '').indexOf('run:') + 2;
  const body = [];
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim() !== '' && line.search(/\S/) < indent) {
      break;
    }
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

/**
 * Runs a step's script the way GitHub does (`bash -e`), with a stand-in
 * `node` that answers for the two scripts it calls: the wrapper prints `{}`
 * and exits with `terraform`, plan-approval swallows its input and exits with
 * `approval`.
 */
function runStep(script, { terraform = 0, approval = 0 }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'workflow-step-'));
  try {
    const node = path.join(dir, 'node');
    writeFileSync(
      node,
      [
        '#!/bin/sh',
        'case "$*" in',
        `  *plan-approval.mjs*) cat >/dev/null; exit ${String(approval)} ;;`,
        `  *terraform.mjs*) echo '{}'; exit ${String(terraform)} ;;`,
        'esac',
        'exit 99',
      ].join('\n'),
    );
    chmodSync(node, 0o755);
    return spawnSync('bash', ['-e', '-c', script], {
      encoding: 'utf8',
      env: { PATH: `${dir}:${process.env['PATH'] ?? ''}`, PLAN_RUN: '123' },
    }).status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The top-level `on:` block. */
function triggers(text) {
  const match = /^on:\n((?: {2}.*\n|\s*\n)+)/m.exec(text);
  return match?.[1] ?? '';
}

describe('deploy-staging.yml', () => {
  test('runs on merges to main, and by hand — never on a pull request', () => {
    expect(triggers(deploy)).toContain('push:\n    branches: [main]');
    expect(triggers(deploy)).toContain('workflow_dispatch:');
    expect(triggers(deploy)).not.toContain('pull_request');
  });

  test('reads its key from the staging environment, which only main can reach', () => {
    expect(job(deploy, 'deploy')).toContain('environment: staging');
  });

  test('never cancels a deploy halfway', () => {
    expect(deploy).toContain('cancel-in-progress: false');
  });

  test('checks out the whole history, which a push to Clever Cloud needs', () => {
    expect(job(deploy, 'deploy')).toContain('fetch-depth: 0');
  });

  test('deploys, then runs the smoke test — a deploy is not done until the worker beats', () => {
    const steps = job(deploy, 'deploy');
    const deployed = steps.indexOf('node scripts/staging-deploy.mjs');
    const smoked = steps.indexOf('node scripts/smoke.mjs');

    expect(deployed).toBeGreaterThan(-1);
    expect(smoked).toBeGreaterThan(deployed);
  });
});

describe('infra-staging.yml', () => {
  test('D-077: only the owner starts it — no push, no pull request, no schedule', () => {
    const on = triggers(infra);

    expect(on).toContain('workflow_dispatch:');
    for (const other of ['push:', 'pull_request', 'schedule:']) {
      expect(on).not.toContain(other);
    }
  });

  test('has one job for each action, and nothing else', () => {
    expect(findJobIds(infra)).toEqual(['plan', 'apply']);
    expect(job(infra, 'plan')).toContain("if: inputs.action == 'plan'");
    expect(job(infra, 'apply')).toContain("if: inputs.action == 'apply'");
  });

  test('carries the names plan-approval checks a run against', () => {
    // A rename here would pass every other test and refuse every apply.
    expect(infra).toMatch(new RegExp(`^name: ${WORKFLOW}$`, 'm'));
    expect(findJobIds(infra)).toContain(PLAN_JOB);
  });

  test.each(['plan', 'apply'])('the %s job reads its keys from the staging environment', (id) => {
    expect(job(infra, id)).toContain('environment: staging');
  });

  test('the plan job never applies anything', () => {
    expect(job(infra, 'plan')).not.toMatch(/\bapply\b.*staging\.tfplan|-auto-approve/);
  });

  test('the plan job publishes the fingerprint, and shows the plan with secrets masked', () => {
    const plan = job(infra, 'plan');

    expect(plan).toContain('node scripts/plan-approval.mjs fingerprint');
    expect(plan).toContain('show -no-color staging.tfplan');
  });

  test("SEC-03: the plan's JSON, which holds secrets, only ever goes into plan-approval", () => {
    // Any `show` with -json, however it is spelled, and at least one per job,
    // so the test cannot pass by finding nothing to look at.
    for (const id of ['plan', 'apply']) {
      const lines = job(infra, id).split('\n');
      const shows = lines
        .map((line, index) => ({ line, index }))
        .filter(
          ({ line }) =>
            !line.trim().startsWith('#') && /\bshow\b/.test(line) && /-json\b/.test(line),
        );
      expect(shows.length).toBeGreaterThan(0);
      for (const { line, index } of shows) {
        const next = `${line}\n${lines[index + 1] ?? ''}`;
        expect(next).toMatch(/\|\s*node scripts\/plan-approval\.mjs (fingerprint|matches)/);
      }
    }
  });

  test('every checkout leaves no GitHub token behind in the steps that hold the keys', () => {
    for (const text of [infra, deploy]) {
      const checkouts = text.split('\n').filter((line) => line.includes('actions/checkout@'));
      const withoutToken = text.match(/persist-credentials: false/g) ?? [];
      expect(checkouts.length).toBeGreaterThan(0);
      expect(withoutToken.length).toBe(checkouts.length);
    }
  });

  test('a fingerprint that cannot be made fails the plan run, rather than publishing none', () => {
    const script = stepScript(infra, 'plan', 'Fingerprint');

    expect(runStep(script, { terraform: 1 })).not.toBe(0);
    expect(runStep(script, {})).toBe(0);
  });

  test('a refused approval fails its own step — the failure the first version hid', () => {
    // An earlier version echoed the approval into $GITHUB_OUTPUT, and a
    // failure inside $(…) does not stop bash -e: the step passed and the apply
    // was refused later, for the wrong reason.
    const script = stepScript(infra, 'apply', 'The plan the owner read, or nothing');

    expect(runStep(script, { approval: 1 })).not.toBe(0);
    expect(runStep(script, { terraform: 1 })).not.toBe(0);
    expect(runStep(script, {})).toBe(0);
  });

  test('no plan file leaves the run', () => {
    expect(infra).not.toMatch(/upload-artifact|actions\/cache/);
  });

  test('apply re-plans, checks the named plan run against it, and only then applies that plan', () => {
    const apply = job(infra, 'apply');
    const order = [
      'plan -input=false -out=staging.tfplan',
      'node scripts/plan-approval.mjs matches "$PLAN_RUN"',
      'apply -input=false staging.tfplan',
    ].map((text) => apply.indexOf(text));

    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(apply).not.toContain('-auto-approve');
  });

  test('one run at a time, never cancelled, because the state has no lock', () => {
    expect(infra).toContain('group: infra-staging');
    expect(infra).toContain('cancel-in-progress: false');
  });

  test('can read runs only where it needs to, and write nothing', () => {
    expect(infra).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(job(infra, 'apply')).toContain('actions: read');
    expect(infra).not.toMatch(/:\s*write\b/);
  });
});

describe('INF-08: the Healthchecks.io ping URL reaches Terraform, and nothing else', () => {
  // The URL is a secret: anyone holding it can keep the worker's check green
  // while the worker is dead. It lives in the staging environment, which only
  // main can reach, and reaches Terraform through a job's env — in both jobs,
  // because apply plans again and compares that plan's fingerprint with the
  // one the owner read.
  const LINE = 'TF_VAR_healthchecks_worker_url: ${{ secrets.HEALTHCHECKS_WORKER_URL }}';

  /** A job's own `env:` block — not a step's — as its trimmed lines, comments left out. */
  function jobEnv(text, id) {
    const lines = job(text, id).split('\n');
    const at = lines.indexOf('    env:');
    if (at === -1) {
      return [];
    }
    const body = [];
    for (const line of lines.slice(at + 1)) {
      if (line.trim() === '' || line.trim().startsWith('#')) {
        continue;
      }
      if (!line.startsWith('      ')) {
        break;
      }
      body.push(line.trim());
    }
    return body;
  }

  /** The job a line belongs to, or "outside any job". */
  function jobAt(lines, index) {
    const jobsAt = lines.indexOf('jobs:');
    for (let at = index; jobsAt !== -1 && at > jobsAt; at -= 1) {
      const id = /^ {2}([\w-]+):\s*$/.exec(lines[at] ?? '')?.[1];
      if (id !== undefined) {
        return id;
      }
    }
    return 'outside any job';
  }

  test.each(['plan', 'apply'])(
    'INF-08-AC9: the %s job sets TF_VAR_healthchecks_worker_url from the staging secret, in its own env',
    (id) => {
      expect(jobEnv(infra, id)).toContain(LINE);
    },
  );

  test('INF-08-AC9: those two lines are the only places any workflow reads the secret', () => {
    // GitHub's secret names are case-insensitive, and a secret can be read by
    // index as well as by name, or all at once through toJSON(secrets).
    const reads = [];
    const workflows = readdirSync(path.join(import.meta.dirname, '..', '.github', 'workflows'))
      .filter((name) => /\.ya?ml$/.test(name))
      .sort();
    expect(workflows).toContain('infra-staging.yml');
    for (const name of workflows) {
      const lines = read(name).split('\n');
      lines.forEach((line, index) => {
        if (line.trim().startsWith('#')) {
          return;
        }
        if (
          /secrets\s*(\.\s*HEALTHCHECKS_WORKER_URL\b|\[\s*['"]HEALTHCHECKS_WORKER_URL['"]\s*\])/i.test(
            line,
          )
        ) {
          reads.push(`${name} ${jobAt(lines, index)}: ${line.trim()}`);
        }
        if (/toJSON\(\s*secrets\s*\)/i.test(line)) {
          reads.push(`${name} ${jobAt(lines, index)}: every secret at once`);
        }
      });
    }

    expect(reads).toEqual([`infra-staging.yml plan: ${LINE}`, `infra-staging.yml apply: ${LINE}`]);
  });
});
