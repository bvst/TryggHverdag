// req-coverage: fixtures-only — the IDs below are sample data for testing the gates.
// These two gates spend milestone M0 with nothing to check. The tests are mostly
// about the difference between "checked, and it is fine" and "could not check" —
// which is the difference between a gate and a decoration.
import { describe, expect, test } from 'vitest';
import { decideApiDiff, decideMutation } from './gate-decisions.mjs';

describe('decideApiDiff', () => {
  test('no released versions: nothing can break, and it says why', () => {
    const decision = decideApiDiff({ releasedSpecs: [], currentSpec: null, toolAvailable: false });
    expect(decision).toMatchObject({ ok: true, action: 'skip' });
    expect(decision.message).toContain('no released API versions yet');
  });

  test('released versions but no current description: refuses to pass', () => {
    const decision = decideApiDiff({
      releasedSpecs: ['v1-app-1.0.0.json'],
      currentSpec: null,
      toolAvailable: true,
    });
    expect(decision.ok).toBe(false);
  });

  test('released versions but no oasdiff: refuses to pass, rather than skipping quietly', () => {
    const decision = decideApiDiff({
      releasedSpecs: ['v1-app-1.0.0.json'],
      currentSpec: 'packages/contracts/openapi.json',
      toolAvailable: false,
    });
    expect(decision.ok).toBe(false);
    expect(decision.message).toContain('NOT checked');
  });

  test('everything present: compare', () => {
    const decision = decideApiDiff({
      releasedSpecs: ['v1-app-1.0.0.json', 'v1-app-1.1.0.json'],
      currentSpec: 'packages/contracts/openapi.json',
      toolAvailable: true,
    });
    expect(decision).toMatchObject({ ok: true, action: 'compare' });
    expect(decision.message).toContain('2 released version(s)');
  });
});

describe('decideMutation', () => {
  const safetyChange = ['apps/server/src/domain/journey.ts'];

  test('a change with no safety code in it has nothing to mutate', () => {
    const decision = decideMutation({
      changed: ['docs/progress.md', 'apps/mobile/src/features/help/Help.tsx'],
      onlyIfSafetyPathsChanged: true,
      configured: false,
    });
    expect(decision).toMatchObject({ ok: true, action: 'skip' });
  });

  test.each([
    ['apps/server/src/domain/journey.ts'],
    ['apps/server/src/modules/alerts/escalate.ts'],
    ['apps/server/src/worker.ts'],
    ['apps/mobile/src/safety-core/heartbeat.ts'],
  ])('%s counts as safety code', (file) => {
    const decision = decideMutation({
      changed: [file],
      onlyIfSafetyPathsChanged: true,
      configured: false,
    });
    expect(decision.ok).toBe(false);
  });

  test('safety code changed but Stryker missing: fails, and names the files', () => {
    const decision = decideMutation({
      changed: safetyChange,
      onlyIfSafetyPathsChanged: true,
      configured: false,
    });
    expect(decision.ok).toBe(false);
    expect(decision.message).toContain('apps/server/src/domain/journey.ts');
    expect(decision.message).toContain('D-036');
  });

  test('safety code changed and Stryker set up: run it', () => {
    const decision = decideMutation({
      changed: safetyChange,
      onlyIfSafetyPathsChanged: true,
      configured: true,
    });
    expect(decision).toMatchObject({ ok: true, action: 'run' });
  });

  test('asked for without the filter, with no setup: still refuses to pass', () => {
    const decision = decideMutation({
      changed: ['docs/progress.md'],
      onlyIfSafetyPathsChanged: false,
      configured: false,
    });
    expect(decision.ok).toBe(false);
  });
});
