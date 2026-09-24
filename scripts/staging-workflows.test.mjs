// INF-07, D-077: the two staging workflows, held to what makes them safe.
//
// Neither can run from a pull request — GitHub runs them only from main, and
// only with the staging keys — so a mistake in them is found in production or
// not at all. These tests are the review that runs before that.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
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

  test("SEC-03: the plan's JSON, which holds secrets, only ever goes into the fingerprint", () => {
    for (const id of ['plan', 'apply']) {
      const lines = job(infra, id).split('\n');
      lines.forEach((line, index) => {
        if (line.includes('show -json')) {
          const next = `${line}\n${lines[index + 1] ?? ''}`;
          expect(next).toMatch(/\|\s*node scripts\/plan-approval\.mjs fingerprint/);
        }
      });
    }
  });

  test('no plan file leaves the run', () => {
    expect(infra).not.toMatch(/upload-artifact|actions\/cache/);
  });

  test('apply checks the named plan run, re-plans, compares, and only then applies that plan', () => {
    const apply = job(infra, 'apply');
    const order = [
      'node scripts/plan-approval.mjs approved',
      'plan -input=false -out=staging.tfplan',
      'if [ "$now" != "TRYGGHVERDAG_PLAN_FINGERPRINT=$APPROVED" ]',
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
