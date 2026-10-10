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
/** Test files, of every kind: unit, integration and system. Never shipped. */
const TEST_FILE = '\\.(test|spec)\\.[cm]?[jt]sx?$';
/** Production code: the apps and the packages, test files aside. */
const PRODUCTION = '^(apps|packages)/';

/**
 * A package, or a subpath of it, in both forms a rule can meet it (D-108,
 * LOST-02-AC25):
 *   - the bare name, which is what depcruise reports for an import it cannot
 *     resolve, such as a package that is not installed yet;
 *   - the path it resolves an installed one to: pnpm's store,
 *     `node_modules/.pnpm/<name>@<version and peers>/node_modules/<name>/…`,
 *     or a flat `node_modules/<name>/…`. A subpath is matched as a folder or
 *     as a file of that name (`node-postgres/index.d.ts`,
 *     `node-postgres.js`), whatever entry the package's exports name.
 * pnpm writes a scoped name's slash as `+` in its store folder. No group with
 * `+` or `*` in it carries a quantifier, so depcruise's check for slow
 * patterns accepts every one.
 */
function packagePatterns(name, subpath) {
  const escape = (text) => text.replace(/[.+]/g, '\\$&');
  const store = escape(name.replace('/', '+'));
  const tail = subpath === undefined ? '' : `${escape(subpath)}(/|\\.)`;
  const bare = subpath === undefined ? escape(name) : `${escape(name)}/${escape(subpath)}`;
  return [
    `^${bare}(/|$)`,
    `(^|/)node_modules/\\.pnpm/${store}@[^/]+/node_modules/${escape(name)}/${tail}`,
    `(^|/)node_modules/${escape(name)}/${tail}`,
  ];
}

/** The packages that can open a connection to the database (D-108). */
const PG = [...packagePatterns('pg'), ...packagePatterns('@types/pg')];
const DRIZZLE_NODE_POSTGRES = packagePatterns('drizzle-orm', 'node-postgres');
const DRIZZLE_MIGRATOR = packagePatterns('drizzle-orm', 'node-postgres/migrator');
const GRAPHILE_WORKER = packagePatterns('graphile-worker');
/** A dev dependency, and its `api` entry builds a pg.Pool of its own: any subpath. */
const DRIZZLE_KIT = packagePatterns('drizzle-kit');
/** The one file that opens connections, the one that migrates through it, and the worker. */
const DATABASE_ADAPTER = '^apps/server/src/adapters/db\\.ts$';
const MIGRATIONS = '^apps/server/src/adapters/migrations\\.ts$';
const WORKER = '^apps/server/src/worker\\.ts$';
/** What the drizzle-kit command reads to generate migrations. */
const DRIZZLE_CONFIG = '^apps/server/drizzle\\.config\\.ts$';
/** The staging canary's adapter: its registration, the one insert of a device credential before the login task (D-128). */
const CANARY_ADAPTER = '^apps/server/src/adapters/canary\\.ts$';
/** The API process's files: the app, the process that serves it, and its entry. */
const API_PROCESS = [
  '^apps/server/src/api\\.ts$',
  '^apps/server/src/api-process\\.ts$',
  '^apps/server/src/bin/api\\.ts$',
];

// A path that does not run through `node_modules`: neither starting with it
// nor holding it as a folder further down. Written as two alternatives, not
// as one optional group (`(.*/)?node_modules/`), because depcruise refuses to
// run a pattern whose quantified group holds a `*`, as one that could run
// very slowly.
const OUTSIDE_NODE_MODULES = '^(?!node_modules/|.*/node_modules/)';

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
        'AR-02: domain code must not reach the outside world. Node built-ins and third-party packages belong in adapters; zod is allowed because contracts are shared with the domain. Domain tests are not shipped, so they may import their test runner and the test kit (LOST-02-AC25).',
      from: { path: DOMAIN, pathNot: TEST_FILE },
      to: {
        dependencyTypes: ['core', 'npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled'],
        // Both forms of each: the bare name, and where it resolves. The
        // contracts resolve to the workspace's own folder.
        pathNot: [
          ...packagePatterns('zod'),
          '^@trygghverdag/contracts(/|$)',
          '^packages/contracts/',
        ],
      },
    },
    {
      name: 'only-the-process-wires-the-log',
      severity: 'error',
      comment:
        "AR-10, D-102: apps/server/src/log.ts is the server's one log adapter. Only the two processes, api-process.ts and worker.ts, which wire the real log, and tests may import it. Every module gets the Log port, so nothing can write to the log past its closed event types (PRIV-07).",
      from: {
        pathNot: ['^apps/server/src/api-process\\.ts$', '^apps/server/src/worker\\.ts$', TEST_FILE],
      },
      to: { path: '^apps/server/src/log\\.ts$' },
    },
    {
      name: 'only-db-ts-opens-the-database',
      severity: 'error',
      comment:
        "AR-10, D-108: only apps/server/src/adapters/db.ts imports pg or drizzle-orm/node-postgres, so every pool is made by createPool, inside the connection budget and with the session limits and the error listeners. A pool made anywhere else could hold a journey's row for ever, or print the connection string. Tests are exempt.",
      from: { path: PRODUCTION, pathNot: [DATABASE_ADAPTER, MIGRATIONS, TEST_FILE] },
      to: { path: [...PG, ...DRIZZLE_NODE_POSTGRES] },
    },
    {
      name: 'migrations-take-only-the-migrator',
      severity: 'error',
      comment:
        'AR-10, D-108: apps/server/src/adapters/migrations.ts may import drizzle-orm/node-postgres/migrator, which runs over the database db.ts built and opens no connection of its own, and nothing else that opens one.',
      from: { path: MIGRATIONS },
      to: { path: [...PG, ...DRIZZLE_NODE_POSTGRES], pathNot: DRIZZLE_MIGRATOR },
    },
    {
      name: 'only-the-worker-runs-graphile-worker',
      severity: 'error',
      comment:
        "AR-10, D-108: only apps/server/src/worker.ts imports graphile-worker, and hands it db.ts's pool. Anywhere else it would build a pool of its own from a connection string. Tests are exempt.",
      from: { path: PRODUCTION, pathNot: [WORKER, TEST_FILE] },
      to: { path: GRAPHILE_WORKER },
    },
    {
      name: 'drizzle-kit-only-in-its-config',
      severity: 'error',
      comment:
        "AR-10, D-108: drizzle-kit's api entry builds a pg.Pool of its own, outside createPool's connection budget, session limits and error listeners. Only apps/server/drizzle.config.ts imports it, for defineConfig, which the drizzle-kit command reads to generate migrations; that file opens no connection. Tests are exempt.",
      from: { path: PRODUCTION, pathNot: [DRIZZLE_CONFIG, TEST_FILE] },
      to: { path: DRIZZLE_KIT },
    },
    {
      name: 'only-the-worker-registers-the-canary',
      severity: 'error',
      comment:
        "AR-10, D-128: only apps/server/src/worker.ts imports apps/server/src/adapters/canary.ts, which registers the staging canary's three fixed identities: the one insert of a device credential before the login task, D-091's one exception. Nothing else in the code may reach it, so no route, seed or module can make a credential. Tests are exempt.",
      from: { pathNot: [WORKER, TEST_FILE] },
      to: { path: CANARY_ADAPTER },
    },
    {
      name: 'the-api-cannot-reach-the-canary',
      severity: 'error',
      comment:
        'AR-10, D-128: the API process reaches apps/server/src/adapters/canary.ts by no path at all, through worker.ts or any module, so no request can register a device or make a credential before the login task.',
      from: { path: API_PROCESS },
      to: { path: CANARY_ADAPTER, reachable: true },
    },
    {
      name: 'production-imports-no-test-file',
      severity: 'error',
      comment:
        "AR-10, D-108: production code imports no file named like a test. Every rule that exempts tests exempts that file's own imports too, so a production file could otherwise reach pg, graphile-worker or the test kit through a helper it imports from a .test.ts.",
      from: { path: PRODUCTION, pathNot: TEST_FILE },
      to: { path: TEST_FILE },
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
      // Both forms: the bare name, while the SDK is not installed, and the
      // path it resolves to once it is (LOST-02-AC25). The first pattern,
      // with no end after the name, stays on purpose: it also catches, by
      // name, a sibling package whose name begins the same, such as a
      // platform's or a licence's own variant of the SDK. packagePatterns
      // ends the name, so it matches the SDK alone.
      to: {
        path: [
          '^react-native-background-geolocation',
          ...packagePatterns('react-native-background-geolocation'),
        ],
      },
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
      from: { pathNot: [TEST_FILE, '^packages/test-kit/'] },
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
    // An installed package is a target every rule can match, but its own
    // imports are not cruised.
    doNotFollow: { path: 'node_modules' },
    // What is not ours to check:
    //   - build output (dist, build, coverage, .turbo, .expo), but only where
    //     the path does not run through node_modules;
    //   - apps/mobile/android and ios, which `expo prebuild` generates: on
    //     disk after a local build, and never committed (INF-06).
    // Nothing inside node_modules is excluded (LOST-02-AC25, D-108).
    // depcruise resolves an installed package to its real path under pnpm's
    // store, and an excluded module is not a target any rule can match. So
    // excluding node_modules, or a dist/ inside it, would leave every rule
    // that names a package matching nothing.
    exclude: {
      path: [
        `${OUTSIDE_NODE_MODULES}.*(^|/)(dist|build|coverage|\\.turbo|\\.expo)/`,
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
