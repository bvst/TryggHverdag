// BUG-4: on the owner's Mac (2026-09-25, INF-00) the doctor gave three false
// answers. Docker was green while Testcontainers could find no runtime (Colima
// behind a Docker context), Maestro was "not installed" when it only lacked
// Java 17, and the GitHub CLI was green while logged in as the repository owner
// rather than Claude's own account (A-06, D-042). A false green is the worst
// answer a safety-critical project's doctor can give, so every check here runs
// against a fake system: the real machine is never asked.
import { describe, expect, test } from 'vitest';
import { runChecks } from './doctor.mjs';

const OWNER_REMOTE_HTTPS = 'https://github.com/bvst/TryggHverdag.git\n';
const OWNER_REMOTE_SSH = 'git@github.com:bvst/TryggHverdag.git\n';

const loggedInAs = (account) =>
  `github.com\n  ✓ Logged in to github.com account ${account} (keyring)\n  - Active account: true\n`;

const sshGreeting = (account) =>
  `Hi ${account}! You've successfully authenticated, but GitHub does not provide shell access.\n`;

/**
 * The key an SSH greeting is stored under. A real doctor must pass
 * non-interactive options (`-o BatchMode=yes -o ConnectTimeout=10`, …) so it can
 * never hang on a passphrase or host-key prompt, so any `ssh` call with `-T`
 * that ends in `git@github.com` answers here, whatever options sit in between.
 */
const SSH_GITHUB = 'ssh -T git@github.com';

const isSshToGitHub = (command, args) =>
  command === 'ssh' && args.includes('-T') && args.at(-1) === 'git@github.com';

/**
 * A fake `sys`. `answers` maps "command arg1 arg2" to a partial exec result;
 * anything not listed is not installed (`found: false`). Every exec call is
 * logged so a test can say what was never asked.
 */
function fakeSystem({ answers = {}, probe = { ok: true }, env = {}, paths = [] } = {}) {
  const calls = [];
  return {
    calls,
    exec(command, args = []) {
      calls.push([command, ...args]);
      const key = isSshToGitHub(command, args) ? SSH_GITHUB : [command, ...args].join(' ');
      const answer = answers[key];
      if (answer === undefined) {
        return { found: false, code: null, stdout: '', stderr: '' };
      }
      return { found: true, code: 0, stdout: '', stderr: '', ...answer };
    },
    probeContainerRuntime() {
      return probe;
    },
    env,
    exists(path) {
      return paths.includes(path);
    },
  };
}

function checkNamed(results, fragment) {
  const found = results.filter((result) => result.name.includes(fragment));
  expect(found, `exactly one check whose name contains "${fragment}"`).toHaveLength(1);
  return found[0];
}

const run = (sys, fragment) => checkNamed(runChecks('darwin', sys), fragment);

const text = (result) => `${result.detail ?? ''}\n${result.fix ?? ''}`;

describe('Docker', () => {
  const dockerRunning = {
    'docker --version': { stdout: 'Docker version 27.3.1, build ce12230\n' },
    'docker info': { stdout: 'Client:\n Context: colima\nServer:\n Containers: 0\n' },
  };

  test('BUG-4: docker info works but Testcontainers finds no runtime, so Docker is not ok', () => {
    const sys = fakeSystem({
      answers: dockerRunning,
      probe: { ok: false, error: 'Could not find a working container runtime strategy' },
    });
    const result = run(sys, 'Docker');
    expect(result.status).toBe('missing');
    expect(text(result)).toMatch(/Testcontainers/);
    expect(result.fix).toContain('DOCKER_HOST');
    expect(result.fix).toContain('TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE');
  });

  test('BUG-4: Testcontainers finds a runtime, so Docker is ok', () => {
    const sys = fakeSystem({ answers: dockerRunning, probe: { ok: true } });
    expect(run(sys, 'Docker').status).toBe('ok');
  });

  test('BUG-4: docker not installed is missing, not installed', () => {
    const sys = fakeSystem({
      probe: { ok: false, error: 'Could not find a working container runtime strategy' },
    });
    const result = run(sys, 'Docker');
    expect(result.status).toBe('missing');
    expect(result.detail).toMatch(/not installed/);
  });

  test('BUG-4: docker installed but docker info fails is missing, not running', () => {
    const sys = fakeSystem({
      answers: {
        'docker --version': { stdout: 'Docker version 27.3.1, build ce12230\n' },
        'docker info': {
          code: 1,
          stderr: 'Cannot connect to the Docker daemon. Is the docker daemon running?\n',
        },
      },
      probe: { ok: false, error: 'Could not find a working container runtime strategy' },
    });
    const result = run(sys, 'Docker');
    expect(result.status).toBe('missing');
    expect(result.detail).toMatch(/not running/);
    expect(result.detail).not.toMatch(/not installed/);
  });
});

describe('Maestro', () => {
  test('BUG-4: Maestro that needs Java 17 is missing Java, not missing Maestro', () => {
    const sys = fakeSystem({
      answers: {
        'maestro --version': {
          code: 1,
          stderr:
            'ERROR: Java 17 or higher is required.\n' +
            'Please update Java, see https://maestro.dev/blog/introducing-maestro-2-0-0\n',
        },
      },
    });
    const result = run(sys, 'Maestro');
    expect(result.status).toBe('missing');
    expect(result.detail).not.toMatch(/not installed/);
    expect(result.detail).toContain('Java 17 or higher is required');
    expect(result.fix).toMatch(/Java 17/);
    expect(result.fix).toContain('JAVA_HOME');
  });

  test('BUG-4: Maestro not found is missing, not installed, with the installer as the fix', () => {
    const result = run(fakeSystem(), 'Maestro');
    expect(result.status).toBe('missing');
    expect(result.detail).toMatch(/not installed/);
    expect(result.fix).toMatch(/curl .*maestro/);
  });

  test('BUG-4: a working Maestro is ok and reports its version', () => {
    const sys = fakeSystem({ answers: { 'maestro --version': { stdout: '\n2.10.0\n' } } });
    const result = run(sys, 'Maestro');
    expect(result.status).toBe('ok');
    expect(result.detail).toBe('2.10.0');
  });
});

describe('GitHub', () => {
  const gh = (status, remote, ssh) => {
    const answers = {
      'gh --version': { stdout: 'gh version 2.63.0 (2024-11-27)\n' },
      'gh auth status': status,
      'git remote get-url origin': { stdout: remote },
    };
    if (ssh !== undefined) {
      answers[SSH_GITHUB] = { code: 1, stderr: ssh };
    }
    return answers;
  };

  const sshCalls = (sys) => sys.calls.filter(([command]) => command === 'ssh');

  test("BUG-4: gh logged in as the repository owner is not Claude's account", () => {
    const sys = fakeSystem({
      answers: gh({ stdout: loggedInAs('bvst') }, OWNER_REMOTE_HTTPS),
    });
    const result = run(sys, 'GitHub');
    expect(result.status).toBe('missing');
    expect(result.detail).toContain('bvst');
    expect(result.detail).toMatch(/owner/i);
  });

  test("BUG-4: gh as Claude's account with an HTTPS remote is ok, and SSH is never asked", () => {
    const sys = fakeSystem({
      answers: gh({ stdout: loggedInAs('urso-agent') }, OWNER_REMOTE_HTTPS, sshGreeting('bvst')),
    });
    const result = run(sys, 'GitHub');
    expect(result.status).toBe('ok');
    expect(result.detail).toContain('urso-agent');
    expect(sshCalls(sys)).toEqual([]);
  });

  test('BUG-4: an SSH remote whose key belongs to the repository owner is not ok', () => {
    const sys = fakeSystem({
      answers: gh({ stdout: loggedInAs('urso-agent') }, OWNER_REMOTE_SSH, sshGreeting('bvst')),
    });
    const result = run(sys, 'GitHub');
    expect(result.status).toBe('missing');
    expect(text(result)).toMatch(/SSH/i);
    expect(text(result)).toContain('bvst');
    expect(sshCalls(sys).length).toBeGreaterThan(0);
    // A doctor that waits on a passphrase or host-key prompt never answers.
    for (const [, ...args] of sshCalls(sys)) {
      expect(args.some((arg) => arg.includes('BatchMode=yes'))).toBe(true);
    }
  });

  test("BUG-4: an SSH remote whose key belongs to Claude's account is ok", () => {
    const sys = fakeSystem({
      answers: gh(
        { stdout: loggedInAs('urso-agent') },
        OWNER_REMOTE_SSH,
        sshGreeting('urso-agent'),
      ),
    });
    const result = run(sys, 'GitHub');
    expect(result.status).toBe('ok');
    expect(sshCalls(sys).length).toBeGreaterThan(0);
  });

  test('BUG-4: gh not installed is missing, not installed', () => {
    const result = run(fakeSystem(), 'GitHub');
    expect(result.status).toBe('missing');
    expect(result.detail).toMatch(/not installed/);
  });

  test('BUG-4: gh installed but not logged in is missing, not logged in', () => {
    const sys = fakeSystem({
      answers: gh(
        {
          code: 1,
          stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n',
        },
        OWNER_REMOTE_HTTPS,
      ),
    });
    const result = run(sys, 'GitHub');
    expect(result.status).toBe('missing');
    expect(result.detail).toMatch(/not logged in/);
  });
});

describe('platform', () => {
  test('BUG-4: off the Mac, the Mac-only checks are skipped and the fake is not asked about them', () => {
    const sys = fakeSystem();
    const results = runChecks('linux', sys);
    for (const fragment of ['Docker', 'GitHub', 'Maestro']) {
      expect(checkNamed(results, fragment).status).toBe('skipped');
    }
    const asked = sys.calls.map(([command]) => command);
    expect(asked).not.toContain('docker');
    expect(asked).not.toContain('maestro');
    expect(asked).not.toContain('ssh');
  });
});
