#!/usr/bin/env node
/**
 * Environment check — INF-00.
 *
 * Prints one line per tool the project needs, says what is missing and how to
 * install it, and exits non-zero when something required on this machine is not
 * there. The Mac needs the full list (simulators, emulator, Maestro); a cloud
 * session only needs the toolchain, so machine-specific checks are reported as
 * skipped rather than failed.
 *
 * Run it with `pnpm run doctor` (`pnpm doctor` is pnpm's own command).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const IS_MACOS = process.platform === 'darwin';

const OK = 'ok';
const MISSING = 'missing';
const SKIPPED = 'skipped';

/** Runs a command and returns its trimmed output, or null if it fails or is not installed. */
function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    }).trim();
  } catch {
    return null;
  }
}

/** First line of a command's output — most tools put the version there. */
function firstLine(text) {
  return text === null ? null : (text.split('\n')[0] ?? '').trim();
}

function ok(detail) {
  return { status: OK, detail };
}

function missing(detail, fix) {
  return { status: MISSING, detail, fix };
}

function skipped(detail) {
  return { status: SKIPPED, detail };
}

/**
 * Every check. `platforms` says where the check must pass: 'any' everywhere,
 * 'macos' only on the owner's Mac (D-055: the Mac runs the simulator work).
 */
export const checks = [
  {
    name: 'Node 22',
    platforms: 'any',
    why: 'The whole toolchain is built on Node 22 LTS',
    check: () => {
      const major = Number(process.versions.node.split('.')[0]);
      const minor = Number(process.versions.node.split('.')[1]);
      const good = major === 22 && minor >= 13;
      return good
        ? ok(`v${process.versions.node}`)
        : missing(
            `v${process.versions.node}`,
            'Install Node 22.13 or newer (the repository pins 22 in .node-version)',
          );
    },
  },
  {
    name: 'pnpm 10',
    platforms: 'any',
    why: 'Workspaces and the lockfile CI installs from',
    check: () => {
      const version = firstLine(run('pnpm', ['--version']));
      if (version === null) {
        return missing('not installed', 'corepack enable pnpm');
      }
      const major = Number(version.split('.')[0]);
      return major >= 10
        ? ok(`v${version}`)
        : missing(`v${version}`, 'corepack use pnpm@10 (package.json pins the exact version)');
    },
  },
  {
    name: 'git',
    platforms: 'any',
    why: 'Branches and pull requests',
    check: () => {
      const version = firstLine(run('git', ['--version']));
      return version === null ? missing('not installed', 'Install git') : ok(version);
    },
  },
  {
    name: 'Claude Code',
    platforms: 'any',
    why: 'Writes the code (D-002)',
    check: () => {
      const version = firstLine(run('claude', ['--version']));
      return version === null
        ? missing('not installed', 'See the installer at https://code.claude.com/docs')
        : ok(version);
    },
  },
  {
    name: 'GitHub CLI, logged in',
    platforms: 'macos',
    why: "Pull requests are opened by Claude's own GitHub account (A-06, D-042)",
    check: () => {
      if (firstLine(run('gh', ['--version'])) === null) {
        return missing('not installed', 'Install the GitHub CLI: https://cli.github.com');
      }
      const status = run('gh', ['auth', 'status']);
      if (status === null) {
        return missing('installed but not logged in', "gh auth login  (as Claude's account, A-06)");
      }
      const account = /account (\S+)/.exec(status)?.[1] ?? 'unknown account';
      return ok(`logged in as ${account}`);
    },
  },
  {
    name: 'Docker, running',
    platforms: 'macos',
    why: 'Integration tests start a real PostgreSQL in a container (L3)',
    check: () => {
      if (firstLine(run('docker', ['--version'])) === null) {
        return missing('not installed', 'Install Docker Desktop or Colima (M0-kickoff, Part 2)');
      }
      return run('docker', ['info']) === null
        ? missing('installed but not running', 'Start Docker Desktop, or: colima start')
        : ok('running');
    },
  },
  {
    name: 'Xcode and an iOS simulator',
    platforms: 'macos',
    why: 'Runs the app on a simulator (M1, M3)',
    check: () => {
      const version = firstLine(run('xcodebuild', ['-version']));
      if (version === null) {
        return missing('not installed', 'Install Xcode from the App Store');
      }
      const devices = run('xcrun', ['simctl', 'list', 'devices', 'available']);
      const hasSimulator = devices !== null && /iPhone/.test(devices);
      return hasSimulator
        ? ok(`${version}, iPhone simulator available`)
        : missing(
            `${version}, but no iPhone simulator`,
            'Xcode → Settings → Components → install an iOS simulator runtime',
          );
    },
  },
  {
    name: 'Android SDK with an emulator image',
    platforms: 'macos',
    why: 'Runs the Maestro UI tests on an emulator (L7)',
    check: () => {
      const sdkRoot =
        process.env['ANDROID_HOME'] ??
        process.env['ANDROID_SDK_ROOT'] ??
        join(process.env['HOME'] ?? '', 'Library/Android/sdk');
      if (!existsSync(sdkRoot)) {
        return missing(
          'Android SDK not found',
          'Install Android Studio, then set ANDROID_HOME (M0-kickoff, Part 2)',
        );
      }
      const emulator = join(sdkRoot, 'emulator', 'emulator');
      const avds = existsSync(emulator) ? run(emulator, ['-list-avds']) : null;
      return avds !== null && avds.length > 0
        ? ok(`${avds.split('\n').length} emulator image(s)`)
        : missing('no emulator image', 'Android Studio → Device Manager → create a virtual device');
    },
  },
  {
    name: 'Maestro',
    platforms: 'macos',
    why: 'End-to-end UI tests (L7)',
    check: () => {
      const version = firstLine(run('maestro', ['--version']));
      return version === null
        ? missing('not installed', 'curl -fsSL https://get.maestro.mobile.dev | bash')
        : ok(version);
    },
  },
];

/** Runs every check and adds the status the current platform should hold it to. */
export function runChecks(platform = process.platform) {
  const isMac = platform === 'darwin';
  return checks.map((check) => {
    const applies = check.platforms === 'any' || isMac;
    const result = applies
      ? check.check()
      : skipped('only needed on the Mac, and only checked there (D-055)');
    return { name: check.name, why: check.why, ...result };
  });
}

const SYMBOL = { [OK]: '✅', [MISSING]: '❌', [SKIPPED]: '⏭️ ' };

function main() {
  const results = runChecks();
  const width = Math.max(...results.map((result) => result.name.length));

  console.log('\nTryggHverdag environment check (INF-00)\n');
  for (const result of results) {
    console.log(`${SYMBOL[result.status]} ${result.name.padEnd(width)}  ${result.detail}`);
    if (result.status === MISSING) {
      console.log(`   ${' '.repeat(width)}  why: ${result.why}`);
      console.log(`   ${' '.repeat(width)}  fix: ${result.fix}`);
    }
  }

  console.log('\nℹ️  Remote Control cannot be checked from here. On the Mac, start Claude Code in');
  console.log('   the repository and turn it on, so the Mac shows up in the Claude app (D-055).');

  const failed = results.filter((result) => result.status === MISSING);
  if (failed.length > 0) {
    console.log(
      `\n❌ ${String(failed.length)} of ${String(results.length)} checks need attention before this machine is ready.\n`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `\n✅ This machine has everything ${IS_MACOS ? 'the Mac' : 'a cloud session'} needs.\n`,
  );
}

// Only run when invoked directly, so tests can import the checks (INF-03).
if (import.meta.filename === process.argv[1]) {
  main();
}
