// Import rules — AR-10: the structure is enforced by tooling, not by memory.
//
// Every rule below names the architecture rule it protects, so a blocked import
// tells whoever hit it why the boundary exists. The rules describe the finished
// layout from docs/plan/05-architecture.md; folders that milestone M0 has not
// created yet are simply not matched by anything, and the rule starts working
// the day the folder appears.

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const REPO_ROOT = join(__dirname, '..', '..');

/**
 * pnpm takes its workspace list from pnpm-workspace.yaml; dependency-cruiser
 * takes it from the npm-style "workspaces" field in package.json. If the two
 * ever disagree, imports between packages quietly stop being classified — and a
 * rule that checks nothing is worse than no rule. So they are compared here, on
 * every run, and a mismatch stops the check instead of weakening it.
 */
function workspaceGlobsFromPnpm() {
  const lines = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === 'packages:');
  if (start === -1) {
    throw new Error('pnpm-workspace.yaml has no "packages:" list');
  }
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    const entry = /^\s+-\s*['"]?([^'"#]+?)['"]?\s*$/.exec(line);
    if (entry?.[1] !== undefined) {
      globs.push(entry[1]);
    } else if (line.trim() !== '' && !line.trimStart().startsWith('#')) {
      break; // end of the packages: block
    }
  }
  return globs;
}

function assertWorkspaceListsAgree() {
  // Order is not meaningful in either file, so compare them sorted: a gate that
  // fails for the wrong reason is a gate people learn to ignore.
  const fromPnpm = workspaceGlobsFromPnpm().sort();
  const fromManifest = [...(require(join(REPO_ROOT, 'package.json')).workspaces ?? [])].sort();
  const same =
    fromPnpm.length === fromManifest.length &&
    fromPnpm.every((glob, i) => glob === fromManifest[i]);
  if (!same) {
    throw new Error(
      `The workspace lists disagree, so import rules would stop covering some packages.\n` +
        `  pnpm-workspace.yaml: ${JSON.stringify(fromPnpm)}\n` +
        `  package.json:        ${JSON.stringify(fromManifest)}`,
    );
  }
}

assertWorkspaceListsAgree();

/** Domain code is pure TypeScript: rules and data, no input or output (AR-02). */
const DOMAIN = '^apps/server/src/domain/';
/** The narrow interface the UI talks to; everything behind it is off limits (AR-09). */
const SAFETY_CORE = '^apps/mobile/src/safety-core/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular imports make it impossible to reason about start-up order and to test a module on its own.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-stays-pure',
      severity: 'error',
      comment:
        'AR-02: the journey state machine and the alert rules must run in milliseconds with no database, network or clock. Adapters and modules depend on the domain, never the other way around.',
      from: { path: DOMAIN },
      to: { path: '^apps/server/src/(adapters|modules)/' },
    },
    {
      name: 'domain-has-no-io',
      severity: 'error',
      comment:
        'AR-02: domain code must not reach the outside world. Node built-ins and third-party packages belong in adapters; zod is allowed because contracts are shared with the domain.',
      from: { path: DOMAIN },
      to: {
        dependencyTypes: ['core', 'npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled'],
        pathNot: ['^zod(/|$)', '^@trygghverdag/contracts(/|$)'],
      },
    },
    {
      name: 'ui-cannot-reach-the-safety-core',
      severity: 'error',
      comment:
        'AR-09: screens talk to the safety core only through its public interface (its index file), so UI work cannot break background location or heartbeats.',
      // Everything in the app except the safety core itself: routes under
      // src/app/ included, and any folder added later without an edit here.
      // Naming features/ and shared/ alone let a route reach past the index.
      from: { path: '^apps/mobile/src/', pathNot: SAFETY_CORE },
      to: { path: SAFETY_CORE, pathNot: `${SAFETY_CORE}index\\.tsx?$` },
    },
    {
      name: 'location-sdk-only-in-the-safety-core',
      severity: 'error',
      comment:
        'AR-09: only the safety core may import the background-location SDK, so it stays replaceable (the D-023 fallback).',
      from: { pathNot: SAFETY_CORE },
      to: { path: '^react-native-background-geolocation' },
    },
    {
      name: 'no-cross-feature-internals',
      severity: 'error',
      comment:
        'AR-10: a feature may use another feature only through its public interface, so features can be changed one at a time.',
      from: { path: '^apps/mobile/src/features/([^/]+)/' },
      to: {
        path: '^apps/mobile/src/features/([^/]+)/',
        pathNot: ['^apps/mobile/src/features/$1/', '^apps/mobile/src/features/[^/]+/index\\.tsx?$'],
      },
    },
    {
      name: 'contracts-depend-on-nothing-of-ours',
      severity: 'error',
      comment:
        'AR-07: the contract package is the shared truth between app and server, so it must not depend on either of them.',
      from: { path: '^packages/contracts/' },
      to: { path: '^(apps/|packages/(?!contracts/))' },
    },
    {
      name: 'test-kit-belongs-in-tests',
      severity: 'error',
      comment:
        'RG-07: fakes and synthetic data are for tests. Shipping code must never import them.',
      from: { pathNot: ['\\.(test|spec)\\.[cm]?[jt]sx?$', '^packages/test-kit/'] },
      to: { path: '^packages/test-kit/' },
    },
    {
      name: 'spikes-are-throwaway',
      severity: 'error',
      comment:
        'Spikes are experiments that are never shipped, so nothing outside spikes/ may import them.',
      from: { pathNot: '^spikes/' },
      to: { path: '^spikes/' },
    },
    {
      name: 'no-deprecated-core',
      severity: 'error',
      comment: 'Deprecated Node built-ins lose security fixes.',
      from: {},
      to: { dependencyTypes: ['core'], path: '^(punycode|domain|sys|_linklist|constants)$' },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'An import that cannot be resolved is a broken build waiting to happen.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-undeclared-dependencies',
      severity: 'error',
      comment:
        "A package must declare what it imports, or it breaks as soon as someone else's package.json changes.",
      from: {},
      to: { dependencyTypes: ['unknown', 'undetermined', 'npm-no-pkg', 'npm-unknown'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // apps/mobile/android and ios are what `expo prebuild` generates: on disk
    // after a local build, never committed, and not ours to check (INF-06).
    exclude: {
      path: [
        '(^|/)(node_modules|dist|build|coverage|\\.turbo|\\.expo)/',
        '^apps/mobile/(android|ios)/',
      ],
    },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['types', 'import', 'require', 'node', 'default'],
      mainFields: ['types', 'main'],
      extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
