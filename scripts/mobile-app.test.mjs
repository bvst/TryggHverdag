// req-coverage: fixtures-only — the IDs below name gates and decisions, not product requirements.
//
// INF-06: the app as the rest of the repository sees it.
//
//   AC1   a workspace package that every static gate reads. A gate that passes
//         because it excludes the app is the easiest green there is, so each
//         gate's reach is asserted here rather than inferred from a green run.
//   AC16  a development build: expo-dev-client is declared and linked. The
//         root `dev` script is held in scripts/gate.test.mjs, beside the other
//         root scripts that hand over to the app.
//   AC17  what Android actually links holds no expo-updates, whatever brought
//         it in. apps/mobile/app.config.test.ts checks what is declared.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ESLint } from 'eslint';
import * as prettier from 'prettier';
import { describe, expect, test } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const APP = path.join(ROOT, 'apps/mobile');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const manifest = () => readJson(path.join(APP, 'package.json'));

/** Files the gates must read. They need not exist for the tools to answer. */
const APP_SOURCE = ['apps/mobile/src/app/index.tsx', 'apps/mobile/app.config.ts'];

/**
 * What `expo prebuild` and a local build leave on the Mac's disk. Neither
 * ESLint nor dependency-cruiser reads .gitignore, and `**\/build/**` alone
 * does not cover these.
 */
const GENERATED = [
  'apps/mobile/android/app/src/main/example.js',
  'apps/mobile/ios/TryggHverdag/example.js',
];

describe('the app is a workspace package that every static gate covers', () => {
  test('INF-06-AC1: apps/mobile is @trygghverdag/mobile, private, entered through Expo Router', () => {
    const app = manifest();

    expect(app.name).toBe('@trygghverdag/mobile');
    expect(app.private).toBe(true);
    expect(app.main).toBe('expo-router/entry');
    // Metro, Babel's config lookup and Jest read .js in a React Native project
    // as CommonJS; "type": "module" would change that under all three.
    expect(app.type).toBeUndefined();
  });

  test('INF-06-AC1: pnpm counts it among the workspace packages', () => {
    const result = spawnSync('pnpm', ['ls', '-r', '--depth', '-1', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });

    expect(result.status, result.stderr).toBe(0);
    const packages = JSON.parse(result.stdout).map((p) => [p.name, path.relative(ROOT, p.path)]);
    expect(packages).toContainEqual(['@trygghverdag/mobile', 'apps/mobile']);
  });

  test('INF-06-AC1: its typecheck script runs tsc, so `turbo run typecheck` includes it', () => {
    // turbo runs a task only in packages that define it. Without the script,
    // the app would be left out of the type check with nothing said.
    expect(manifest().scripts?.typecheck).toMatch(/\btsc\b/);
  });

  test("INF-06-AC1: formatting checks the app's source, and not what a build generates", async () => {
    const ignorePath = [path.join(ROOT, '.gitignore'), path.join(ROOT, '.prettierignore')];
    const info = async (file) => prettier.getFileInfo(path.join(ROOT, file), { ignorePath });

    for (const file of APP_SOURCE) {
      expect({ file, ...(await info(file)) }).toMatchObject({ file, ignored: false });
    }
    for (const file of GENERATED) {
      expect({ file, ...(await info(file)) }).toMatchObject({ file, ignored: true });
    }
  });

  test("INF-06-AC1: lint reads the app's source, and not what a build generates", async () => {
    const eslint = new ESLint({ cwd: ROOT });

    for (const file of APP_SOURCE) {
      expect({ file, ignored: await eslint.isPathIgnored(path.join(ROOT, file)) }).toEqual({
        file,
        ignored: false,
      });
    }
    for (const file of GENERATED) {
      expect({ file, ignored: await eslint.isPathIgnored(path.join(ROOT, file)) }).toEqual({
        file,
        ignored: true,
      });
    }
  });
});

/**
 * The package names Expo's autolinking would link into the Android app, asked
 * of the autolinking CLI that the app's own `expo` depends on.
 */
function androidAutolinked() {
  const fromApp = createRequire(path.join(APP, 'package.json'));
  const fromExpo = createRequire(fromApp.resolve('expo/package.json'));
  const autolinkingManifest = fromExpo.resolve('expo-modules-autolinking/package.json');
  const { bin } = readJson(autolinkingManifest);
  const cli = path.join(
    path.dirname(autolinkingManifest),
    typeof bin === 'string' ? bin : bin['expo-modules-autolinking'],
  );
  const result = spawnSync(process.execPath, [cli, 'resolve', '--platform', 'android', '--json'], {
    cwd: APP,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`expo-modules-autolinking failed:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout).modules.map((module) => module.packageName);
}

describe('what Android links', () => {
  test('INF-06-AC17: autolinking links no expo-updates, by exact name', () => {
    // By exact name: expo-dev-client brings in expo-updates-interface, which is
    // not expo-updates and must not fail this.
    const linked = androidAutolinked();

    expect(linked.length).toBeGreaterThan(0);
    expect(linked).not.toContain('expo-updates');
  });

  test('INF-06-AC16: expo-dev-client is declared by the app and linked into Android', () => {
    expect(manifest().dependencies?.['expo-dev-client']).toBeDefined();
    expect(androidAutolinked()).toContain('expo-dev-client');
  });
});

describe('the native project', () => {
  test('INF-06-AC10: is generated from app.config.ts, never committed: git tracks nothing under android/ or ios/', () => {
    // A committed android/ folder would be a second place native settings
    // live, and `expo prebuild --clean` would overwrite it on every build.
    const result = spawnSync('git', ['ls-files', '--', 'apps/mobile/android', 'apps/mobile/ios'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });
});

describe('the development build on the Mac', () => {
  // The run itself, a debug build on the Pixel 8 emulator loading its
  // JavaScript from Metro, is done once on the Mac and quoted in the pull
  // request (spec, test plan). What can be held here is that the script the
  // spec names is the one that builds that variant.
  test("INF-06-AC16: the app's android script builds and installs the debug variant with expo run:android", () => {
    const android = manifest().scripts?.android ?? '';

    expect(android).toMatch(/\bexpo run:android\b/);
    expect(android).not.toMatch(/--variant[= ]release|--configuration[= ]release/i);
  });
});
