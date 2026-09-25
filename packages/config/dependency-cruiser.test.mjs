// req-coverage: fixtures-only — the IDs below name architecture rules, not product requirements.
//
// INF-06-AC18, and the part of AC1 that belongs to the import check: the rules
// in dependency-cruiser.cjs, run the way `pnpm run imports:check` runs them
// (the repository's config, the real depcruise binary) against a small app
// written for each case in a temporary folder.
//
// No rule in that file had a test before this one. The rules are path
// patterns, so a rule that stops matching fails nothing: the boundary it held
// simply stops existing, and imports:check stays green. The AR-09 rule was in
// exactly that state for routes. It named features/ and shared/ as the only
// sources, so a screen under src/app/ could reach into the safety core's
// internals and pass.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DEPCRUISE = path.join(ROOT, 'node_modules', '.bin', 'depcruise');
const RULE = 'ui-cannot-reach-the-safety-core';

const INTERNAL = 'apps/mobile/src/safety-core/location.ts';
const reachesIn = (from) => `import { start } from '${from}';\nexport default start;\n`;

/** A small app. Each importer outside the safety core tries one way in. */
const APP = {
  'apps/mobile/src/safety-core/index.ts': "export { start } from './location';\n",
  [INTERNAL]: 'export const start = (): number => 1;\n',
  'apps/mobile/src/safety-core/heartbeat.ts': reachesIn('./location'),
  'apps/mobile/src/app/index.tsx': reachesIn('../safety-core/location'),
  'apps/mobile/src/app/settings/about.tsx': reachesIn('../../safety-core/location'),
  'apps/mobile/src/app/_layout.tsx': reachesIn('../safety-core'),
  'apps/mobile/src/shared/banner.ts': reachesIn('../safety-core/location'),
  'apps/mobile/src/features/sharing/index.ts': reachesIn('../../safety-core/index'),
  'apps/mobile/src/somewhere-new/thing.ts': reachesIn('../safety-core/location'),
  // What `expo prebuild` and a local build leave on disk. Not ours to check.
  'apps/mobile/android/app/src/main/Generated.js': reachesIn('./does-not-exist'),
  'apps/mobile/ios/TryggHverdag/Generated.js': reachesIn('./does-not-exist'),
};

const made = [];

/** Writes `files` into a fresh folder and runs the import check over its apps/. */
function importCheck(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'import-rules-'));
  made.push(dir);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  const result = spawnSync(
    DEPCRUISE,
    ['--config', path.join(ROOT, '.dependency-cruiser.cjs'), 'apps'],
    { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME } },
  );
  const output = `${result.stdout}${result.stderr}`;
  const violations = [...output.matchAll(/^\s*error (\S+): (\S+) → (\S+)$/gm)].map(
    ([, rule, from, to]) => ({ rule, from, to }),
  );
  return { status: result.status, output, violations };
}

afterAll(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('the safety core is reached through its index, from anywhere in the app', () => {
  let check;
  beforeAll(() => {
    check = importCheck(APP);
  });

  const refused = (from) => check.violations.filter((v) => v.rule === RULE && v.from === from);

  test('INF-06-AC18: a route under src/app/ may not import a safety-core file other than its index', () => {
    expect(refused('apps/mobile/src/app/index.tsx')).toEqual([
      { rule: RULE, from: 'apps/mobile/src/app/index.tsx', to: INTERNAL },
    ]);
  });

  test('INF-06-AC18: nor may a nested route', () => {
    expect(refused('apps/mobile/src/app/settings/about.tsx')).toHaveLength(1);
  });

  test('INF-06-AC18: nor a folder nobody has made yet, so the next one needs no edit to the rule', () => {
    expect(refused('apps/mobile/src/somewhere-new/thing.ts')).toHaveLength(1);
  });

  test('INF-06-AC18: shared/ is still held to it', () => {
    expect(refused('apps/mobile/src/shared/banner.ts')).toHaveLength(1);
  });

  test('INF-06-AC18: the index is the way in, for a route and for a feature', () => {
    expect(refused('apps/mobile/src/app/_layout.tsx')).toEqual([]);
    expect(refused('apps/mobile/src/features/sharing/index.ts')).toEqual([]);
  });

  test('INF-06-AC18: the safety core may use its own files', () => {
    expect(refused('apps/mobile/src/safety-core/heartbeat.ts')).toEqual([]);
  });

  test('INF-06-AC1: what a native build generates under android/ and ios/ is not cruised', () => {
    const generated = check.violations.filter(
      (v) => v.from.startsWith('apps/mobile/android/') || v.from.startsWith('apps/mobile/ios/'),
    );

    expect(generated).toEqual([]);
  });
});

describe('pnpm run imports:check', () => {
  test('INF-06-AC18: fails on a route that reaches past the index, naming the rule, and the rule names AR-09', () => {
    const check = importCheck({
      'apps/mobile/src/safety-core/index.ts': "export { start } from './location';\n",
      [INTERNAL]: 'export const start = (): number => 1;\n',
      'apps/mobile/src/app/index.tsx': reachesIn('../safety-core/location'),
    });
    const rule = createRequire(import.meta.url)('./dependency-cruiser.cjs').forbidden.find(
      (r) => r.name === RULE,
    );

    expect(check.status, check.output).not.toBe(0);
    expect(check.output).toContain(`error ${RULE}: apps/mobile/src/app/index.tsx`);
    expect(rule?.comment).toContain('AR-09');
  });

  test('INF-06-AC1: cruises apps/, where the app lives', () => {
    const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;

    expect(scripts['imports:check'].split(/\s+/)).toContain('apps');
  });
});
