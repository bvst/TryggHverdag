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
 * A check asks whether the tool can be *used* the way the project uses it, not
 * whether it merely exists: a doctor that says green when it cannot know is
 * worse than no doctor (BUG-4).
 *
 * Run it with `pnpm run doctor` (`pnpm doctor` is pnpm's own command).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const IS_MACOS = process.platform === 'darwin';

const OK = 'ok';
const MISSING = 'missing';
const SKIPPED = 'skipped';

/** Long enough for a slow `docker info` or simulator list; short enough that the doctor always answers. */
const COMMAND_TIMEOUT_MS = 60_000;
const PROBE_TIMEOUT_MS = 30_000;

/** Where `@testcontainers/postgresql` (and through it `testcontainers`) is installed; pnpm is strict. */
const SERVER_DIR = join(import.meta.dirname, '..', 'apps', 'server');

/**
 * Asks Testcontainers for a container runtime, the call the L3 tests fail in.
 * `docker info` follows Docker contexts and Testcontainers does not, so only
 * Testcontainers itself can say whether `test:integration` will find Docker
 * (BUG-4). `testcontainers` is not a direct dependency of `apps/server`, so it
 * is resolved from `@testcontainers/postgresql`, which depends on it.
 */
const CONTAINER_RUNTIME_PROBE = `
const { createRequire } = require('node:module');
const fromServer = createRequire(process.cwd() + '/package.json');
const fromPostgres = createRequire(fromServer.resolve('@testcontainers/postgresql'));
fromPostgres('testcontainers').getContainerRuntimeClient().then(
  () => process.exit(0),
  (error) => { console.error(String(error?.message ?? error)); process.exit(1); },
);
`;

/** First line of a command's output — most tools put the version there. */
function firstLine(text) {
  return text === null ? null : (text.split('\n')[0] ?? '').trim();
}

/** The first line that says something, for quoting an error in one line. */
function meaningfulLine(text) {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null
  );
}

/**
 * The real machine. Every check reaches the outside world through this and
 * nothing else, so the tests can hand it a fake one instead.
 */
export const realSystem = {
  /** Runs a command. `found` is false only when the command does not exist. */
  exec(command, args = [], options = {}) {
    const timeout = options.timeout ?? COMMAND_TIMEOUT_MS;
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
      timeout,
    });
    const errorCode = /** @type {NodeJS.ErrnoException | undefined} */ (result.error)?.code;
    // A command that hangs is killed and reported as a failure, never as silence.
    const timedOut =
      errorCode === 'ETIMEDOUT'
        ? `\n${command} gave no answer within ${String(timeout / 1000)} s`
        : '';
    return {
      found: errorCode !== 'ENOENT',
      code: result.status,
      stdout: result.stdout ?? '',
      stderr: `${result.stderr ?? ''}${timedOut}`,
    };
  },
  probeContainerRuntime() {
    const result = realSystem.exec(process.execPath, ['-e', CONTAINER_RUNTIME_PROBE], {
      cwd: SERVER_DIR,
      timeout: PROBE_TIMEOUT_MS,
    });
    if (result.code === 0) {
      return { ok: true };
    }
    const error =
      meaningfulLine(`${result.stderr}\n${result.stdout}`) ??
      `the probe exited with ${String(result.code)} and said nothing`;
    return { ok: false, error };
  },
  env: process.env,
  exists: existsSync,
};

/** A command's trimmed standard output, or null if it is not installed or failed. */
function output(sys, command, args) {
  const result = sys.exec(command, args);
  return result.found && result.code === 0 ? result.stdout.trim() : null;
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

/** Android Studio's bundled Java 17+, which Maestro can use (M0-kickoff, Part 2). */
const ANDROID_STUDIO_JAVA = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';

/** The two variables that let Testcontainers find Colima (M0-kickoff, Part 2). */
const TESTCONTAINERS_FIX =
  'With Colima, add to ~/.zshrc and open a new terminal: ' +
  'export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock" and ' +
  'export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock (M0-kickoff, Part 2)';

/** The account a GitHub remote belongs to: `https://github.com/<owner>/…` or `git@github.com:<owner>/…`. */
function repositoryOwner(remote) {
  return /github\.com[/:]([^/\s]+)\/[^/\s]+?(?:\.git)?\s*$/.exec(remote)?.[1] ?? null;
}

/** GitHub logins are case-insensitive. */
const sameAccount = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * Which account git pushes as over SSH. GitHub answers `Hi <account>!` and exits
 * 1 even on success. BatchMode, so a passphrase or host-key prompt fails instead
 * of hanging the doctor.
 */
function sshAccount(sys) {
  const result = sys.exec('ssh', [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-T',
    'git@github.com',
  ]);
  const said = `${result.stdout}\n${result.stderr}`;
  return { account: /Hi ([^!\s]+)!/.exec(said)?.[1] ?? null, said };
}

/**
 * Every check. `platforms` says where the check must pass: 'any' everywhere,
 * 'macos' only on the owner's Mac (D-055: the Mac runs the simulator work).
 * Each check gets `sys` and reaches the machine through it only.
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
    check: (sys) => {
      const version = firstLine(output(sys, 'pnpm', ['--version']));
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
    check: (sys) => {
      const version = firstLine(output(sys, 'git', ['--version']));
      return version === null ? missing('not installed', 'Install git') : ok(version);
    },
  },
  {
    name: 'Claude Code',
    platforms: 'any',
    why: 'Writes the code (D-002)',
    check: (sys) => {
      const version = firstLine(output(sys, 'claude', ['--version']));
      return version === null
        ? missing('not installed', 'See the installer at https://code.claude.com/docs')
        : ok(version);
    },
  },
  {
    name: "GitHub, as Claude's account",
    platforms: 'macos',
    why: "Pull requests are opened and pushed by Claude's own GitHub account, not the owner's (A-06, D-042)",
    check: (sys) => {
      if (output(sys, 'gh', ['--version']) === null) {
        return missing('gh not installed', 'Install the GitHub CLI: https://cli.github.com');
      }
      const status = sys.exec('gh', ['auth', 'status']);
      if (status.code !== 0) {
        return missing(
          'gh installed but not logged in',
          "gh auth login as Claude's account (A-06), then gh auth setup-git",
        );
      }
      const account = /account (\S+)/.exec(`${status.stdout}\n${status.stderr}`)?.[1];
      if (account === undefined) {
        return missing(
          'gh is logged in, but its account could not be read from gh auth status',
          "Run gh auth status and check that it is logged in as Claude's account (A-06)",
        );
      }
      const remote = output(sys, 'git', ['remote', 'get-url', 'origin']) ?? '';
      const owner = repositoryOwner(remote);
      if (owner === null) {
        return missing(
          `gh is logged in as ${account}, but the repository owner could not be read from the origin remote`,
          'Run the doctor from the repository, whose origin must be a github.com remote',
        );
      }
      const switchAccount =
        "gh auth login as Claude's account (not the owner's), then gh auth setup-git";
      if (sameAccount(account, owner)) {
        return missing(
          `gh is logged in as ${account}, the repository owner's account, not Claude's (A-06, D-042)`,
          switchAccount,
        );
      }
      if (!/^(?:ssh:\/\/)?git@/.test(remote)) {
        return ok(`gh logged in as ${account}; origin is HTTPS, so git pushes through gh`);
      }
      const toHttps = `switch origin to HTTPS (git remote set-url origin https://github.com/${owner}/<repo>.git), then ${switchAccount}`;
      const ssh = sshAccount(sys);
      if (ssh.account === null) {
        return missing(
          `origin is an SSH remote, and SSH to GitHub did not say which account the key belongs to: ${meaningfulLine(ssh.said) ?? 'no output'}`,
          `Load Claude's SSH key into ssh-agent, or ${toHttps}`,
        );
      }
      if (sameAccount(ssh.account, owner)) {
        return missing(
          `origin is an SSH remote, and the SSH key belongs to ${ssh.account}, the repository owner's account, not Claude's (A-06, D-042)`,
          `Use Claude's own SSH key for github.com, or ${toHttps}`,
        );
      }
      return ok(`gh logged in as ${account}; SSH key belongs to ${ssh.account}`);
    },
  },
  {
    name: 'Docker, reachable by Testcontainers',
    platforms: 'macos',
    why: 'Integration tests start a real PostgreSQL in a container through Testcontainers (L3)',
    check: (sys) => {
      if (output(sys, 'docker', ['--version']) === null) {
        return missing('not installed', 'Install Docker Desktop or Colima (M0-kickoff, Part 2)');
      }
      if (output(sys, 'docker', ['info']) === null) {
        return missing('installed but not running', 'Start Docker Desktop, or: colima start');
      }
      // `docker info` follows Docker contexts; Testcontainers does not (BUG-4).
      const probe = sys.probeContainerRuntime();
      return probe.ok
        ? ok('running, and Testcontainers finds it')
        : missing(
            `docker info works, but Testcontainers cannot find the runtime: ${meaningfulLine(probe.error) ?? 'no reason given'}`,
            TESTCONTAINERS_FIX,
          );
    },
  },
  {
    name: 'Xcode and an iOS simulator',
    platforms: 'macos',
    why: 'Runs the app on a simulator (M1, M3)',
    check: (sys) => {
      const version = firstLine(output(sys, 'xcodebuild', ['-version']));
      if (version === null) {
        return missing('not installed', 'Install Xcode from the App Store');
      }
      const devices = output(sys, 'xcrun', ['simctl', 'list', 'devices', 'available']);
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
    check: (sys) => {
      const sdkRoot =
        sys.env['ANDROID_HOME'] ??
        sys.env['ANDROID_SDK_ROOT'] ??
        join(sys.env['HOME'] ?? '', 'Library/Android/sdk');
      if (!sys.exists(sdkRoot)) {
        return missing(
          'Android SDK not found',
          'Install Android Studio, then set ANDROID_HOME (M0-kickoff, Part 2)',
        );
      }
      const emulator = join(sdkRoot, 'emulator', 'emulator');
      const avds = sys.exists(emulator) ? output(sys, emulator, ['-list-avds']) : null;
      return avds !== null && avds.length > 0
        ? ok(`${String(avds.split('\n').length)} emulator image(s)`)
        : missing('no emulator image', 'Android Studio → Device Manager → create a virtual device');
    },
  },
  {
    name: 'Maestro',
    platforms: 'macos',
    why: 'End-to-end UI tests (L7)',
    check: (sys) => {
      const result = sys.exec('maestro', ['--version']);
      if (!result.found) {
        return missing('not installed', 'curl -fsSL https://get.maestro.mobile.dev | bash');
      }
      if (result.code !== 0) {
        const said = `${result.stdout}\n${result.stderr}`;
        return missing(
          `installed, but maestro --version failed: ${meaningfulLine(said) ?? `exit ${String(result.code)}, no output`}`,
          /java/i.test(said)
            ? `Install Java 17 or newer and set JAVA_HOME to it, e.g. Android Studio's own: export JAVA_HOME="${ANDROID_STUDIO_JAVA}"`
            : 'Run maestro --version and fix what it reports',
        );
      }
      return ok(firstLine(result.stdout.trim()));
    },
  },
];

/** Runs every check and adds the status the current platform should hold it to. */
export function runChecks(platform = process.platform, sys = realSystem) {
  const isMac = platform === 'darwin';
  return checks.map((check) => {
    const applies = check.platforms === 'any' || isMac;
    const result = applies
      ? check.check(sys)
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
