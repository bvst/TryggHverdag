// LOST-02-AC24: one way to the database (AR-10; D-108, approach item 13).
//
// The session limits (approach item 7) and the pool listeners (approach item
// 8) hold only for pools made by createPool in apps/server/src/adapters/db.ts.
// Nothing stopped a new file from opening a pool of its own: one outside the
// connection budget, the session limits and the listeners, which could hold a
// journey's row for ever or print the connection string. So the import rules
// hold it, and these tests hold the rules:
//   - only adapters/db.ts imports `pg` or `drizzle-orm/node-postgres`, any
//     subpath included;
//   - one named exception: adapters/migrations.ts imports
//     `drizzle-orm/node-postgres/migrator`, and nothing else from that list;
//   - only worker.ts imports `graphile-worker`;
//   - in production code, apps/ and packages/; test files are exempt.
//
// Run the way `pnpm run imports:check` runs them: the real depcruise binary
// and the repository's .dependency-cruiser.cjs, over a small server written
// for each case into a temporary folder, as dependency-cruiser.test.mjs does
// for the log rule. Each case runs twice: once with the packages laid out as
// pnpm lays them out, so depcruise resolves each import to
// node_modules/.pnpm/<name>@<version>/node_modules/<name>/…, and once with no
// node_modules at all, so it cannot resolve them. A rule that matched only
// one form would pass its fixture and miss the other in the repository.
//
// The rule's name is the implementer's: the rules that hold this are the
// ones whose comment cites D-108, and each refusal must name one of them.
//
// LOST-02-AC25 (approach item 13, D-108): none of that, nor any other rule
// that names a package, can work while the import check cannot see an
// installed package. depcruise resolves one to its real path under pnpm's
// store, and the configuration's exclude hid every path through node_modules,
// and every dist/ folder, graphile-worker's entry among them. The tests below
// install packages in the fixture as pnpm installs them (the real folder
// under node_modules/.pnpm, its entry under dist/, and node_modules/<name> as
// a link to it), declare them in the fixture's package.json, and check that:
//   - an installed package is a target the rules match, and the exclude
//     hides nothing inside node_modules;
//   - the location SDK's rule holds whether the SDK is installed or not;
//   - domain-has-no-io refuses an installed package, but not installed zod,
//     nor installed vitest in a domain test;
//   - AC24's packages, installed, are refused where AC24 refuses them;
//   - and, as the control, that the rules' patterns match what depcruise
//     really resolves the repository's own imports of pg and graphile-worker
//     to, through a probe configuration built in a temporary folder.
//
// This file is counted by req:coverage (no fixtures-only marker), unlike
// dependency-cruiser.test.mjs: LOST-02-AC24 and AC25 are criteria of their
// task, and the traceability job needs a counted test to name them. It names
// no other tracked requirement, even as sample data, so it counts for
// nothing else.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DEPCRUISE = path.join(ROOT, 'node_modules', '.bin', 'depcruise');

/** The three packages that can open a connection, and the subpaths the server uses. */
const PG = 'pg';
const DRIZZLE_NODE_POSTGRES = 'drizzle-orm/node-postgres';
const MIGRATOR = 'drizzle-orm/node-postgres/migrator';
const GRAPHILE = 'graphile-worker';
const RESTRICTED = [PG, DRIZZLE_NODE_POSTGRES, GRAPHILE];

/**
 * The packages as pnpm lays them out, mirroring each one's real entry points
 * (read in node_modules on 2026-10-04): pg's conditional exports, drizzle-orm's
 * exports with their types, graphile-worker's main under dist/. Each store
 * folder carries the version, and drizzle-orm's its peers, as pnpm names them.
 */
const PNPM_LAYOUT = {
  'pg@8.23.0/node_modules/pg': {
    'package.json': JSON.stringify({
      name: 'pg',
      version: '8.23.0',
      main: './lib',
      exports: {
        '.': { import: './esm/index.mjs', require: './lib/index.js', default: './lib/index.js' },
      },
    }),
    'esm/index.mjs': 'export default {};\n',
    'lib/index.js': 'module.exports = {};\n',
  },
  'drizzle-orm@0.45.3_@types+pg@8.23.1_pg@8.23.0/node_modules/drizzle-orm': {
    'package.json': JSON.stringify({
      name: 'drizzle-orm',
      version: '0.45.3',
      type: 'module',
      exports: Object.fromEntries(
        ['.', './pg-core', './node-postgres', './node-postgres/migrator'].map((entry) => {
          const file =
            entry === '.' ? './index' : entry.endsWith('migrator') ? entry : `${entry}/index`;
          return [entry, { types: `${file}.d.ts`, default: `${file}.js` }];
        }),
      ),
    }),
    ...Object.fromEntries(
      ['index', 'pg-core/index', 'node-postgres/index', 'node-postgres/migrator'].flatMap(
        (file) => [
          [`${file}.js`, 'export const x = 1;\n'],
          [`${file}.d.ts`, 'export declare const x: number;\n'],
        ],
      ),
    ),
  },
  'graphile-worker@0.18.0_typescript@6.0.3/node_modules/graphile-worker': {
    'package.json': JSON.stringify({
      name: 'graphile-worker',
      version: '0.18.0',
      main: 'dist/index.js',
      exports: './dist/index.js',
    }),
    'dist/index.js': 'module.exports = {};\n',
  },
  // RG-03 (LOST-02, review loop 1): drizzle-kit joins the layout, as 0.31.11
  // lays itself out (its root and its api entry, types first), for the rule
  // that refuses it in production code (approach item 13). Added only: every
  // package above is as it was, and no case above imports drizzle-kit.
  'drizzle-kit@0.31.11/node_modules/drizzle-kit': {
    'package.json': JSON.stringify({
      name: 'drizzle-kit',
      version: '0.31.11',
      exports: {
        '.': { types: './index.d.mts', default: './index.mjs' },
        './api': { types: './api.d.mts', default: './api.mjs' },
      },
    }),
    'index.mjs': 'export const x = 1;\n',
    'index.d.mts': 'export declare const x: number;\n',
    'api.mjs': 'export const x = 1;\n',
    'api.d.mts': 'export declare const x: number;\n',
  },
};

/** A static import of `from`, or one loaded with import(); `n` keeps the names apart in one file. */
const FORMS = {
  static: (from, n) =>
    `import imported${n} from '${from}';\nexport const value${n} = imported${n};\n`,
  dynamic: (from, n) =>
    `export const load${n} = async (): Promise<unknown> => await import('${from}');\n`,
};

/**
 * Whether a violation's target is this import: the name itself when depcruise
 * could not resolve it, or where it resolved, under pnpm's layout or a flat
 * one. So a file holding several imports has each judged on its own.
 */
function aims(to, from) {
  if (to === from) {
    return true;
  }
  const [name, ...rest] = from.split('/');
  const subpath = rest.join('/');
  const store = `node_modules/(?:\\.pnpm/${name}@[^/]+/node_modules/)?${name}/`;
  const tail =
    subpath === ''
      ? name === 'drizzle-orm'
        ? 'index\\.'
        : ''
      : subpath === 'node-postgres'
        ? 'node-postgres/index\\.'
        : `${subpath}(?:/|\\.)`;
  return new RegExp(`^${store}${tail}`).test(to);
}

/** A file name for a package: `drizzle-orm/node-postgres` becomes `drizzle-orm-node-postgres`. */
const slug = (from) => from.replaceAll('/', '-');

const made = [];

/** Writes `files` into a fresh folder, with the pnpm layout if asked, and runs the import check over it. */
function importCheck(files, { pnpm }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'database-imports-'));
  made.push(dir);
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  };
  for (const [file, text] of Object.entries(files)) {
    write(file, text);
  }
  if (pnpm) {
    for (const [store, packageFiles] of Object.entries(PNPM_LAYOUT)) {
      for (const [file, text] of Object.entries(packageFiles)) {
        write(path.join('node_modules', '.pnpm', store, file), text);
      }
      const name = store.slice(store.lastIndexOf('/node_modules/') + '/node_modules/'.length);
      symlinkSync(path.join('.pnpm', store), path.join(dir, 'node_modules', name));
    }
  }
  const roots = ['apps', 'packages'].filter((root) =>
    Object.keys(files).some((file) => file.startsWith(`${root}/`)),
  );
  const result = spawnSync(
    DEPCRUISE,
    ['--config', path.join(ROOT, '.dependency-cruiser.cjs'), ...roots],
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

/** The repository's rules that hold one way to the database: those whose comment cites D-108. */
function databaseRules() {
  return createRequire(import.meta.url)('./dependency-cruiser.cjs').forbidden.filter((rule) =>
    String(rule.comment ?? '').includes('D-108'),
  );
}

/** A case: a file, the package it imports, and how. */
function caseOf(file, from, form = 'static') {
  return { file, from, form };
}

/**
 * The cases split into as few runs as can hold them, each run a set of files,
 * each file with one or more imports. A file never imports one package twice
 * in a run: depcruise reports a static and a dynamic import of the same
 * package as one dependency, which would let one form's refusal stand in for
 * the other's.
 */
function runsOf(cases) {
  const rounds = [];
  for (const each of cases) {
    let round = rounds.find(
      (candidate) => !candidate.some(({ file, from }) => file === each.file && from === each.from),
    );
    if (round === undefined) {
      round = [];
      rounds.push(round);
    }
    round.push(each);
  }
  return rounds.map((round) => {
    const files = {};
    round.forEach(({ file, from, form }, n) => {
      files[file] = `${files[file] ?? ''}${FORMS[form](from, n)}`;
    });
    return { cases: round, files };
  });
}

/** Each importer, of each package, in each form, as its own file, so no two imports merge. */
function everyWay(folder, packages = RESTRICTED) {
  return packages.flatMap((from) =>
    Object.keys(FORMS).map((form) => caseOf(`${folder}/${slug(from)}-${form}.ts`, from, form)),
  );
}

/** Imports that must be refused, naming a rule that holds one way to the database. */
const REFUSED = [
  // A module, a domain file and an adapter other than db.ts: every package, both forms.
  ...everyWay('apps/server/src/modules/alerts'),
  ...everyWay('apps/server/src/domain'),
  ...everyWay('apps/server/src/adapters'),
  // Only named like an allowed file, in another folder.
  caseOf('apps/server/src/modules/db.ts', PG),
  caseOf('apps/server/src/adapters/journeys/db.ts', DRIZZLE_NODE_POSTGRES),
  caseOf('apps/server/src/db.ts', PG),
  caseOf('apps/other/src/adapters/db.ts', PG),
  caseOf('apps/server/src/modules/worker.ts', GRAPHILE),
  caseOf('apps/server/src/adapters/worker.ts', GRAPHILE),
  caseOf('apps/server/src/domain/migrations.ts', MIGRATOR),
  caseOf('apps/server/src/migrations.ts', MIGRATOR),
  // migrations.ts may take the migrator, and nothing else from the list.
  caseOf('apps/server/src/adapters/migrations.ts', PG),
  caseOf('apps/server/src/adapters/migrations.ts', DRIZZLE_NODE_POSTGRES),
  caseOf('apps/server/src/adapters/migrations.ts', DRIZZLE_NODE_POSTGRES, 'dynamic'),
  // Each allowed file only for its own package.
  caseOf('apps/server/src/adapters/db.ts', GRAPHILE),
  caseOf('apps/server/src/worker.ts', PG),
  caseOf('apps/server/src/worker.ts', DRIZZLE_NODE_POSTGRES),
  // Production code in packages/ too.
  caseOf('packages/contracts/src/pool.ts', PG),
];

/** Imports that must pass: the three allowed, and test files of every kind. */
const ALLOWED = [
  caseOf('apps/server/src/adapters/db.ts', PG),
  caseOf('apps/server/src/adapters/db.ts', DRIZZLE_NODE_POSTGRES),
  caseOf('apps/server/src/adapters/migrations.ts', MIGRATOR),
  caseOf('apps/server/src/worker.ts', GRAPHILE),
  caseOf('apps/server/src/worker.ts', GRAPHILE, 'dynamic'),
  caseOf('apps/server/src/adapters/journeys.integration.test.ts', PG),
  caseOf('apps/server/src/adapters/database.integration.test.ts', MIGRATOR),
  caseOf('apps/server/src/alerts.system.test.ts', GRAPHILE),
  caseOf('apps/server/src/worker.test.ts', DRIZZLE_NODE_POSTGRES, 'dynamic'),
  caseOf('packages/test-kit/src/pool.test.ts', PG),
  // The rest of drizzle-orm is not the database's way in: its root and pg-core stay open.
  caseOf('apps/server/src/adapters/journeys.ts', 'drizzle-orm'),
  caseOf('apps/server/src/db/schema.ts', 'drizzle-orm/pg-core'),
];

describe.each([
  { layout: 'resolved under pnpm’s layout', pnpm: true },
  { layout: 'unresolvable, with no node_modules', pnpm: false },
])(
  'only db.ts opens the database, and only worker.ts uses Graphile Worker — $layout',
  ({ pnpm }) => {
    /**
     * The run each case was checked in. A refusal is matched to its case by
     * the rule, the importing file and the import's target, so one import's
     * refusal can never stand in for another's.
     */
    const runs = new Map();
    beforeAll(() => {
      for (const { cases, files } of runsOf([...REFUSED, ...ALLOWED])) {
        const check = importCheck(files, { pnpm });
        for (const each of cases) {
          runs.set(each, check);
        }
      }
    }, 120_000);

    const names = () => databaseRules().map((rule) => rule.name);
    const refusals = (each) =>
      runs
        .get(each)
        .violations.filter(
          (violation) =>
            names().includes(violation.rule) &&
            violation.from === each.file &&
            aims(violation.to, each.from),
        );

    test('LOST-02-AC24: the rules exist, and each says why: AR-10 and D-108', () => {
      const rules = databaseRules();

      expect(rules.length).toBeGreaterThan(0);
      for (const rule of rules) {
        expect(rule.severity, rule.name).toBe('error');
        expect(rule.comment, rule.name).toContain('AR-10');
      }
    });

    test.each(REFUSED)(
      'LOST-02-AC24: $file importing $from ($form) is refused, naming a rule of one way to the database',
      (each) => {
        const check = runs.get(each);

        expect(refusals(each), check.output).toHaveLength(1);
        expect(check.status, check.output).not.toBe(0);
      },
    );

    test.each(ALLOWED)('LOST-02-AC24: $file importing $from ($form) is not refused', (each) => {
      expect(refusals(each), runs.get(each).output).toEqual([]);
    });
  },
);

describe('pnpm run imports:check, on the repository itself', () => {
  // RG-03 (LOST-02, review loop 1, spec item 4e): the control now also
  // names, and checks it covers, the importers the two new rules leave alone:
  // drizzle.config.ts, which imports drizzle-kit, and the test files that
  // import today's test-named helpers. The check that the run passes is
  // unchanged; what was added only makes "passes" mean those were looked at.
  test('LOST-02-AC24: (control) passes: the rules leave today’s importers alone, db.ts, migrations.ts, worker.ts and drizzle.config.ts, and the test files that import capture.test.ts and fake-postgres-server.test.ts', () => {
    const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
    const [program, ...args] = scripts['imports:check'].split(/\s+/);

    expect(program).toBe('depcruise');
    const run = (extra) =>
      spawnSync(path.join(ROOT, 'node_modules', '.bin', program), [...args, ...extra], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
        maxBuffer: 64 * 1024 * 1024,
      });
    const result = run([]);

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);

    // The same run, as JSON: what it looked at.
    const { modules } = JSON.parse(run(['--output-type', 'json']).stdout);
    const dependenciesOf = (source) =>
      (modules.find((module) => module.source === source)?.dependencies ?? []).map(
        (dependency) => dependency.module,
      );
    expect(dependenciesOf('apps/server/drizzle.config.ts')).toContain('drizzle-kit');
    for (const helper of ['./capture.test.ts', './fake-postgres-server.test.ts']) {
      expect(
        modules.filter(
          (module) =>
            /\.test\.ts$/.test(module.source) &&
            module.dependencies.some((dependency) => dependency.module === helper),
        ).length,
        helper,
      ).toBeGreaterThan(0);
    }
  }, 120_000);
});

// ===========================================================================
// LOST-02-AC24, review loop 1 (approach item 13): drizzle-kit, whose api
// entry builds a pg.Pool, is refused in production code but for
// drizzle.config.ts; and production code imports no file named like a test,
// whose own imports every test exemption would otherwise let through.
// ===========================================================================

const DRIZZLE_KIT = 'drizzle-kit';
const DRIZZLE_KIT_API = 'drizzle-kit/api';

/** How `importer` imports `target`, both repository paths: a relative specifier. */
function specifierFor(importer, target) {
  const relative = path.posix.relative(path.posix.dirname(importer), target);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

describe.each([
  { layout: 'installed under pnpm’s layout', pnpm: true },
  { layout: 'not installed', pnpm: false },
])('drizzle-kit in production code — $layout', ({ pnpm }) => {
  const REFUSED_KIT = [
    ...everyWay('apps/server/src/modules/alerts', [DRIZZLE_KIT, DRIZZLE_KIT_API]),
    ...everyWay('apps/server/src/domain', [DRIZZLE_KIT, DRIZZLE_KIT_API]),
    ...everyWay('apps/server/src/adapters', [DRIZZLE_KIT, DRIZZLE_KIT_API]),
  ];
  const CONFIG_CASES = [
    { ...caseOf('apps/server/drizzle.config.ts', DRIZZLE_KIT), verdict: 'allowed' },
    { ...caseOf('apps/other/drizzle.config.ts', DRIZZLE_KIT), verdict: 'refused' },
    { ...caseOf('apps/server/src/drizzle.config.ts', DRIZZLE_KIT), verdict: 'refused' },
    { ...caseOf('packages/contracts/drizzle.config.ts', DRIZZLE_KIT), verdict: 'refused' },
    { ...caseOf('apps/server/src/db/schema.test.ts', DRIZZLE_KIT), verdict: 'allowed' },
    {
      ...caseOf(
        'apps/server/src/adapters/migrations.integration.test.ts',
        DRIZZLE_KIT_API,
        'dynamic',
      ),
      verdict: 'allowed',
    },
  ];
  const runs = new Map();
  beforeAll(() => {
    for (const { cases, files } of runsOf([...REFUSED_KIT, ...CONFIG_CASES])) {
      const check = importCheck(files, { pnpm });
      for (const each of cases) {
        runs.set(each, check);
      }
    }
  }, 120_000);

  const refusals = (each) => {
    const names = databaseRules().map((rule) => rule.name);
    return runs
      .get(each)
      .violations.filter(
        (violation) =>
          names.includes(violation.rule) &&
          violation.from === each.file &&
          aims(violation.to, each.from),
      );
  };

  test.each(REFUSED_KIT)(
    'LOST-02-AC24: drizzle-kit and drizzle-kit/api, installed and not installed, are refused from a module, a domain file and an adapter, naming the rule — $file importing $from ($form)',
    (each) => {
      const check = runs.get(each);

      expect(refusals(each), check.output).toHaveLength(1);
      expect(check.status, check.output).not.toBe(0);
    },
  );

  test.each(CONFIG_CASES)(
    'LOST-02-AC24: apps/server/drizzle.config.ts may import drizzle-kit; a file only named drizzle.config.ts in another folder may not; test files may — $file importing $from ($form): $verdict',
    (each) => {
      expect(refusals(each), runs.get(each).output).toHaveLength(
        each.verdict === 'refused' ? 1 : 0,
      );
    },
  );
});

describe('production code imports no file named like a test', () => {
  const HELPER = 'apps/server/src/helper.test.ts';
  const SPEC = 'apps/server/src/helper.spec.ts';
  const TOOLING = 'apps/server/src/tooling.test.mjs';
  const TARGETS = {
    [HELPER]: 'export default 1;\n',
    [SPEC]: 'export default 1;\n',
    [TOOLING]: 'export default 1;\n',
  };
  const PRODUCTION = [
    'apps/server/src/modules/alerts/uses-helper.ts',
    'apps/server/src/domain/uses-helper.ts',
    'apps/server/src/adapters/uses-helper.ts',
    'apps/server/src/api-process.ts',
    'apps/server/src/worker.ts',
  ];
  const importing = (file, target, form, verdict) => ({
    ...caseOf(file, specifierFor(file, target), form),
    target,
    verdict,
  });
  const CASES = [
    ...PRODUCTION.flatMap((file) =>
      ['static', 'dynamic'].map((form) => importing(file, HELPER, form, 'refused')),
    ),
    ...[SPEC, TOOLING].flatMap((target) =>
      ['static', 'dynamic'].map((form) => importing(PRODUCTION[0], target, form, 'refused')),
    ),
    importing('apps/server/src/alerts.system.test.ts', HELPER, 'static', 'allowed'),
    importing('apps/server/src/worker.test.ts', HELPER, 'dynamic', 'allowed'),
    importing('apps/server/src/adapters/journeys.integration.test.ts', SPEC, 'static', 'allowed'),
  ];
  const runs = new Map();
  beforeAll(() => {
    for (const { cases, files } of runsOf(CASES)) {
      const check = importCheck({ ...TARGETS, ...files }, { pnpm: false });
      for (const each of cases) {
        runs.set(each, check);
      }
    }
  }, 120_000);

  const refusals = (each) => {
    const names = databaseRules().map((rule) => rule.name);
    return runs
      .get(each)
      .violations.filter(
        (violation) =>
          names.includes(violation.rule) &&
          violation.from === each.file &&
          violation.to === each.target,
      );
  };

  test.each(CASES)(
    'LOST-02-AC24: production code importing a file named like a test (.test.ts, .spec.ts, .test.mjs), by static import or import(), is refused, naming the rule; a test file importing one is not — $file importing $from ($form): $verdict',
    (each) => {
      const check = runs.get(each);

      expect(refusals(each), check.output).toHaveLength(each.verdict === 'refused' ? 1 : 0);
      // The target is there, so nothing but the rule under test refuses it.
      expect(
        check.violations.filter(
          ({ rule, from }) => from === each.file && rule === 'not-to-unresolvable',
        ),
        check.output,
      ).toEqual([]);
    },
  );

  test('LOST-02-AC24: (control) a production file that imports a test-named helper which imports pg is refused by the test-file rule, so the helper’s pg cannot escape the database rule', () => {
    const production = 'apps/server/src/modules/alerts/sneaky.ts';
    const helper = 'apps/server/src/pool.test.ts';
    const check = importCheck(
      {
        [production]: FORMS.static(specifierFor(production, helper), 0),
        [helper]: FORMS.static(PG, 0),
      },
      { pnpm: true },
    );
    const names = databaseRules().map((rule) => rule.name);
    const byTheRules = check.violations.filter(({ rule }) => names.includes(rule));

    // The helper's own pg is a test file's, which the database rule exempts…
    expect(
      byTheRules.filter(({ from }) => from === helper),
      check.output,
    ).toEqual([]);
    // …so what stops it reaching production is the refusal of the import itself.
    expect(
      byTheRules.filter(({ from, to }) => from === production && to === helper),
      check.output,
    ).toHaveLength(1);
  }, 60_000);
});

// ===========================================================================
// LOST-02-AC25: installed packages reach the import rules.
// ===========================================================================

/**
 * What AC25's fixtures install, as pnpm installs them: each package's own
 * folder under node_modules/.pnpm/<name>@<version>/node_modules/<name>/, its
 * entry under dist/, and node_modules/<name> as a link to that folder. A
 * subpath the server imports keeps its own place beside dist/, as
 * drizzle-orm's does. Versions are synthetic: only the layout matters.
 */
const INSTALLABLE = {
  'react-native-background-geolocation': { version: '4.18.0' },
  zod: { version: '4.1.0' },
  vitest: { version: '5.0.1', dev: true },
  dayjs: { version: '1.11.13' },
  [PG]: { version: '8.23.0' },
  'drizzle-orm': { version: '0.45.3', subpaths: ['node-postgres', 'node-postgres/migrator'] },
  [GRAPHILE]: { version: '0.18.0' },
};

const SDK = 'react-native-background-geolocation';
const SDK_RULE = 'location-sdk-only-in-the-safety-core';
const NO_IO_RULE = 'domain-has-no-io';

/** A fresh temporary folder holding `files`, removed after the run. */
function fixtureWith(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'installed-imports-'));
  made.push(dir);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

/** Installs these packages in `dir` as pnpm installs them, and declares them in its package.json. */
function install(dir, names) {
  const manifest = { name: 'installed-imports-fixture', private: true, dependencies: {} };
  for (const name of names) {
    const { version, subpaths = [], dev = false } = INSTALLABLE[name];
    const store = `${name}@${version}/node_modules/${name}`;
    const folder = path.join(dir, 'node_modules', '.pnpm', store);
    const packageJson = { name, version, main: 'dist/index.js' };
    if (subpaths.length > 0) {
      packageJson.exports = {
        '.': './dist/index.js',
        ...Object.fromEntries(subpaths.map((sub) => [`./${sub}`, `./${sub}.js`])),
      };
    }
    for (const [file, text] of [
      ['package.json', JSON.stringify(packageJson)],
      ['dist/index.js', 'module.exports = {};\n'],
      ...subpaths.map((sub) => [`${sub}.js`, 'module.exports = {};\n']),
    ]) {
      mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
      writeFileSync(path.join(folder, file), text);
    }
    symlinkSync(path.join('.pnpm', store), path.join(dir, 'node_modules', name));
    const field = dev ? 'devDependencies' : 'dependencies';
    manifest[field] = { ...manifest[field], [name]: version };
  }
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
}

/** The real depcruise, with this configuration, over these folders of `cwd`. */
function cruise(cwd, config, roots) {
  const result = spawnSync(DEPCRUISE, ['--config', config, ...roots], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  const output = `${result.stdout}${result.stderr}`;
  const violations = [...output.matchAll(/^\s*error (\S+): (\S+) → (\S+)$/gm)].map(
    ([, rule, from, to]) => ({ rule, from, to }),
  );
  return { status: result.status, output, violations };
}

/** The repository's import check over a fixture whose packages are installed and declared. */
function installedCheck(files, installed) {
  const dir = fixtureWith(files);
  install(dir, installed);
  const roots = ['apps', 'packages'].filter((root) =>
    Object.keys(files).some((file) => file.startsWith(`${root}/`)),
  );
  return cruise(dir, path.join(ROOT, '.dependency-cruiser.cjs'), roots);
}

/**
 * A configuration written into `dir`: the repository's options, and this one
 * rule instead of the repository's rules. What a rule can see is decided by
 * the options; the probe asks only whether it sees this.
 */
function probeConfig(dir, rule) {
  const file = path.join(dir, 'probe.dependency-cruiser.cjs');
  writeFileSync(
    file,
    [
      `const repository = require(${JSON.stringify(path.join(ROOT, 'packages', 'config', 'dependency-cruiser.cjs'))});`,
      `module.exports = { forbidden: [${JSON.stringify({ severity: 'error', ...rule })}], options: repository.options };`,
      '',
    ].join('\n'),
  );
  return file;
}

/** The repository's options, as the import check runs with them. */
function repositoryOptions() {
  return createRequire(import.meta.url)('./dependency-cruiser.cjs').options;
}

/** A path option as depcruise takes it, a string, an array, or { path }, as a list of patterns. */
function patternsOf(option) {
  const value =
    typeof option === 'object' && option !== null && !Array.isArray(option) ? option.path : option;
  return value === undefined ? [] : [value].flat();
}

describe('LOST-02-AC25: installed packages reach the import rules', () => {
  test('LOST-02-AC25: an installed package whose entry is under dist/ is still a target the rules match; the repository’s exclude hides nothing inside node_modules', () => {
    // graphile-worker 0.18.0 is such a package: "main": "dist/index.js".
    const dir = fixtureWith({
      'apps/server/src/adapters/queue.ts': FORMS.static(GRAPHILE, 0),
    });
    install(dir, [GRAPHILE]);
    const config = probeConfig(dir, {
      name: 'probe-sees-installed-packages',
      from: { path: '^apps/server/src/adapters/queue\\.ts$' },
      to: { path: 'node_modules/' },
    });

    const probe = cruise(dir, config, ['apps']);

    expect(
      probe.violations.filter(
        ({ rule, from, to }) =>
          rule === 'probe-sees-installed-packages' &&
          from === 'apps/server/src/adapters/queue.ts' &&
          /^node_modules\/(\.pnpm\/graphile-worker@[^/]+\/node_modules\/)?graphile-worker\/dist\/index\.js$/.test(
            to,
          ),
      ),
      probe.output,
    ).toHaveLength(1);

    const options = repositoryOptions();
    const hidden = (modulePath) =>
      patternsOf(options.exclude).some((pattern) => new RegExp(pattern).test(modulePath));
    for (const inside of [
      'node_modules/pg/lib/index.js',
      'node_modules/.pnpm/pg@8.23.0/node_modules/pg/esm/index.mjs',
      'node_modules/.pnpm/graphile-worker@0.18.0_typescript@6.0.3/node_modules/graphile-worker/dist/index.js',
      'node_modules/.pnpm/react-native-background-geolocation@4.18.0/node_modules/react-native-background-geolocation/dist/index.js',
      'node_modules/.pnpm/zod@4.1.0/node_modules/zod/build/index.js',
      'apps/server/node_modules/zod/dist/index.js',
    ]) {
      expect(hidden(inside), inside).toBe(false);
    }
    // What the exclude is for stays hidden: build output outside
    // node_modules, and what `expo prebuild` generates.
    for (const outside of [
      'apps/server/dist/index.js',
      'packages/contracts/dist/index.js',
      'apps/mobile/.expo/types/router.d.ts',
      'apps/mobile/android/app/index.js',
      'apps/mobile/ios/main.m',
    ]) {
      expect(hidden(outside), outside).toBe(true);
    }
    // And a package's own imports are still not cruised.
    expect(
      patternsOf(options.doNotFollow).some((pattern) =>
        new RegExp(pattern).test('node_modules/.pnpm/pg@8.23.0/node_modules/pg/esm/index.mjs'),
      ),
    ).toBe(true);
  }, 60_000);

  describe('the location SDK', () => {
    const OUTSIDE = 'apps/mobile/src/features/map/locate.ts';
    const INSIDE = 'apps/mobile/src/safety-core/location.ts';
    const files = { [OUTSIDE]: FORMS.static(SDK, 0), [INSIDE]: FORMS.static(SDK, 1) };
    const checks = {};
    beforeAll(() => {
      checks.installed = installedCheck(files, [SDK]);
      checks.notInstalled = importCheck(files, { pnpm: false });
    }, 120_000);

    test.each([
      {
        case: 'installed, from outside the safety core: refused',
        file: OUTSIDE,
        installed: true,
        refused: true,
      },
      {
        case: 'not installed, from outside the safety core: refused',
        file: OUTSIDE,
        installed: false,
        refused: true,
      },
      {
        case: 'installed, from inside the safety core: allowed',
        file: INSIDE,
        installed: true,
        refused: false,
      },
      {
        case: 'not installed, from inside the safety core: allowed',
        file: INSIDE,
        installed: false,
        refused: false,
      },
    ])(
      'LOST-02-AC25: the location SDK, installed and not installed, is refused outside the safety core and allowed inside it — $case',
      ({ file, installed, refused }) => {
        const check = installed ? checks.installed : checks.notInstalled;
        const mine = check.violations.filter(({ from }) => from === file);
        const bySdkRule = mine.filter(({ rule }) => rule === SDK_RULE);

        if (refused) {
          expect(bySdkRule, check.output).toHaveLength(1);
          if (installed) {
            // Installed and declared: the rule under test is the only refusal.
            expect(mine, check.output).toEqual(bySdkRule);
          }
        } else if (installed) {
          // Installed and declared: allowed means no violation at all.
          expect(mine, check.output).toEqual([]);
        } else {
          // Not installed, not-to-unresolvable refuses it too; the SDK rule must not.
          expect(bySdkRule, check.output).toEqual([]);
        }
      },
    );
  });

  describe('domain-has-no-io', () => {
    const PRODUCTION = 'apps/server/src/domain/dates.ts';
    const WITH_ZOD = 'apps/server/src/domain/shapes.ts';
    const DOMAIN_TEST = 'apps/server/src/domain/dates.test.ts';
    let check;
    beforeAll(() => {
      check = installedCheck(
        {
          [PRODUCTION]: FORMS.static('dayjs', 0),
          [WITH_ZOD]: FORMS.static('zod', 0),
          [DOMAIN_TEST]: FORMS.static('vitest', 0),
        },
        ['dayjs', 'zod', 'vitest'],
      );
    }, 120_000);

    test.each([
      {
        case: 'an installed package other than zod, from a domain file: refused',
        file: PRODUCTION,
        refused: true,
      },
      { case: 'installed zod, from a domain file: allowed', file: WITH_ZOD, refused: false },
      { case: 'installed vitest, from a domain test: allowed', file: DOMAIN_TEST, refused: false },
    ])(
      'LOST-02-AC25: a domain file importing an installed package other than zod is refused by domain-has-no-io; a domain file importing installed zod, and a domain test importing installed vitest, are not — $case',
      ({ file, refused }) => {
        const mine = check.violations.filter(({ from }) => from === file);

        expect(mine, check.output).toEqual(
          refused
            ? [{ rule: NO_IO_RULE, from: file, to: expect.stringMatching(/^node_modules\//) }]
            : [],
        );
      },
    );
  });

  describe('AC24’s packages, installed', () => {
    const CASES = [
      ...everyWay('apps/server/src/modules/alerts'),
      ...everyWay('apps/server/src/domain'),
      ...everyWay('apps/server/src/adapters'),
    ];
    const runs = new Map();
    beforeAll(() => {
      for (const { cases, files } of runsOf(CASES)) {
        const check = installedCheck(files, [PG, 'drizzle-orm', GRAPHILE]);
        for (const each of cases) {
          runs.set(each, check);
        }
      }
    }, 120_000);

    test.each(CASES)(
      'LOST-02-AC25: AC24’s three packages, installed as pnpm installs them, are refused from a module, a domain file and another adapter — $file importing $from ($form)',
      (each) => {
        const check = runs.get(each);
        const names = databaseRules().map((rule) => rule.name);
        const mine = check.violations.filter(({ from }) => from === each.file);

        expect(
          mine.filter(({ rule }) => names.includes(rule)),
          check.output,
        ).toHaveLength(1);
        // Installed and declared, nothing else refuses it, except that a
        // domain file importing a package is also domain-has-no-io's.
        const alsoAllowed = each.file.startsWith('apps/server/src/domain/') ? [NO_IO_RULE] : [];
        expect(
          mine.filter(({ rule }) => !names.includes(rule) && !alsoAllowed.includes(rule)),
          check.output,
        ).toEqual([]);
      },
    );
  });

  test('LOST-02-AC25: (control) against the repository itself, a probe rule with the real to-patterns fires on db.ts importing pg and on worker.ts importing graphile-worker', () => {
    const rules = createRequire(import.meta.url)('./dependency-cruiser.cjs').forbidden;
    const database = rules.filter((rule) => String(rule.comment ?? '').includes('D-108'));
    const sdk = rules.find((rule) => rule.name === SDK_RULE);
    expect(database.length, 'no rule cites D-108 yet').toBeGreaterThan(0);
    expect(sdk).toBeDefined();
    const toPatterns = [...database, sdk].flatMap((rule) => patternsOf(rule.to));
    const dir = mkdtempSync(path.join(tmpdir(), 'installed-imports-probe-'));
    made.push(dir);
    const config = probeConfig(dir, {
      name: 'probe-real-patterns',
      from: { path: ['^apps/server/src/adapters/db\\.ts$', '^apps/server/src/worker\\.ts$'] },
      to: { path: toPatterns },
    });

    // The repository's own files and node_modules; nothing is written there.
    const probe = cruise(ROOT, config, ['apps/server/src']);
    const fired = probe.violations.filter(({ rule }) => rule === 'probe-real-patterns');

    expect(
      fired.filter(
        ({ from, to }) =>
          from === 'apps/server/src/adapters/db.ts' && /(^|\/)(@types\/)?pg[@/]/.test(to),
      ),
      probe.output,
    ).toHaveLength(1);
    expect(
      fired.filter(
        ({ from, to }) =>
          from === 'apps/server/src/worker.ts' && /(^|\/)graphile-worker[@/]/.test(to),
      ),
      probe.output,
    ).toHaveLength(1);
  }, 120_000);
});
