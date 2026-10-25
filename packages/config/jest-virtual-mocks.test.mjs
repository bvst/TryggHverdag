// req-coverage: fixtures-only — a tooling test of the app's test files; the IDs below are references, not coverage.
//
// No test file in apps/mobile mocks an installed package with
// `{ virtual: true }` (GRP-02.md, "Review loop 2": code-reviewer note 9 and
// test-auditor N2).
//
// Why. Jest's resolver, which a jest worker keeps for its whole life, caches
// the answer to "what does this importer's require of this name resolve to"
// per (importer, name). A virtual mock of a bare package name is keyed by the
// name; a real require of an installed package is keyed by its real path.
// Once an earlier test file in the same worker loaded the importer with the
// real package, the cached answer is the real path, the virtual mock is never
// matched, and the real package runs in place of the fake: an order-dependent
// failure that never shows when the file runs alone (a54f735, phone.test.tsx
// and expo-intent-launcher). It breaks the other way round too: a virtual mock
// seen first makes a later file's non-virtual mock of the same package miss.
// So an installed package is mocked as installed, in every file, never mixed.
//
// What is refused: a call to jest.mock, jest.doMock or
// jest.unstable_mockModule whose options say `virtual: true`, when its module
// name is a bare name that resolves from the file that holds it, the way Node
// resolves it (createRequire(file).resolve), or is found but not exported to
// require (ERR_PACKAGE_PATH_NOT_EXPORTED: installed all the same). A name
// written as a path (starting with "." or "/") is left alone: its virtual key
// is its resolved path, the same key the real require gets, so it holds in
// any order, and the app's L5 tests rely on that to mock phone.ts before it
// exists. A name or options the reader cannot read (not a string literal, not
// an object literal) is refused too, saying so, rather than passed unread.
//
// The files read: every JavaScript and TypeScript file under apps/mobile but
// what a build or an install writes, so a helper module that mocks is read as
// a test is. What an install writes, node_modules, is left out at any depth,
// as jest leaves it out (its testPathIgnorePatterns, ["/node_modules/"], is
// the only folder it ignores). What a build or a test run writes, coverage,
// android, ios, .expo, dist and build, is left out only at the app's top
// level, where those tools write it: jest ignores none of those names, so a
// folder so named under src is the app's own, and its tests run (test-
// auditor's audit of review loop 2: a virtual mock of expo-crypto in
// src/shared/build/probe.test.tsx passed this guard, and jest ran it).
//
// A tooling test: it proves no tracked requirement, so it is exempt from the
// `<ID>-ACn` naming rule (.claude/rules/tests.md).
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, test } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const APP = path.join(ROOT, 'apps', 'mobile');

/** What an install writes: never the app's own files, at any depth, as jest's testPathIgnorePatterns says. */
const INSTALLED = 'node_modules';

/** Folders a build or a test run writes at the app's top level: never the app's own files there, and only there. */
const NOT_SOURCE = new Set(['coverage', 'android', 'ios', '.expo', 'dist', 'build']);

/** The extensions jest-expo reads as code. */
const CODE = /\.(?:[cm]?[jt]sx?)$/;

/** The jest functions that register a mock, and take the options as their third argument. */
const MOCKING = new Set(['mock', 'doMock', 'unstable_mockModule']);

/**
 * Every code file under `dir`, the app's folder, but what an install writes,
 * at any depth, and what a build or a test run writes, at `dir`'s top level.
 */
export function codeFiles(dir, top = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const skipped = entry.name === INSTALLED || (dir === top && NOT_SOURCE.has(entry.name));
      return skipped ? [] : codeFiles(full, top);
    }
    return entry.isFile() && CODE.test(entry.name) ? [full] : [];
  });
}

/** The script kind TypeScript should parse `file` as. */
function scriptKind(file) {
  if (file.endsWith('.tsx')) {
    return ts.ScriptKind.TSX;
  }
  if (file.endsWith('.jsx')) {
    return ts.ScriptKind.JSX;
  }
  return /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

/**
 * Every mock registration in `text`, read as the file `file`: the jest
 * function, the module name as written (null when it is not a string
 * literal), what its options say of `virtual` ('true', 'false', 'absent', or
 * 'unreadable'), and its line.
 */
export function mocksIn(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  const found = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'jest' &&
      MOCKING.has(node.expression.name.text)
    ) {
      const [name, , options] = node.arguments;
      found.push({
        fn: `jest.${node.expression.name.text}`,
        name:
          name !== undefined &&
          (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))
            ? name.text
            : null,
        virtual: virtualOf(options),
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** What a mock's options say of `virtual`. */
function virtualOf(options) {
  if (options === undefined) {
    return 'absent';
  }
  if (!ts.isObjectLiteralExpression(options)) {
    return 'unreadable';
  }
  for (const property of options.properties) {
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'virtual') {
      return 'unreadable';
    }
    if (ts.isSpreadAssignment(property)) {
      return 'unreadable';
    }
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === 'virtual'
    ) {
      if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) {
        return 'true';
      }
      if (property.initializer.kind === ts.SyntaxKind.FalseKeyword) {
        return 'false';
      }
      return 'unreadable';
    }
  }
  return 'absent';
}

/** Whether `name`, required from `file`, finds an installed package. */
export function installedFrom(file, name) {
  try {
    createRequire(file).resolve(name);
    return true;
  } catch (error) {
    // Found, but its package.json exports nothing to require: installed all the same.
    return error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED';
  }
}

/** A module name written as a path, whose virtual key is its real path. */
const isPath = (name) => name.startsWith('.') || name.startsWith('/');

/** The mocks in `text`, read as `file`, that this test refuses, each said in one line. */
export function refusedIn(file, text) {
  const where = path.relative(ROOT, file);
  return mocksIn(file, text).flatMap(({ fn, name, virtual, line }) => {
    if (virtual === 'false' || virtual === 'absent') {
      return [];
    }
    if (virtual === 'unreadable') {
      return [
        `${where}:${String(line)} ${fn}: options this test cannot read; write { virtual: … } as a literal`,
      ];
    }
    if (name === null) {
      return [
        `${where}:${String(line)} ${fn}: a virtual mock whose module name is not a string literal`,
      ];
    }
    if (isPath(name) || !installedFrom(file, name)) {
      return [];
    }
    return [
      `${where}:${String(line)} ${fn}('${name}', …, { virtual: true }): '${name}' is installed; mock it without virtual`,
    ];
  });
}

/** A probe file's path inside the app: never written, only named, so it resolves as an app file would. */
const PROBE = path.join(APP, 'src', 'features', 'probe', 'probe.test.tsx');

/** Probe texts, each with what the test must say of it. */
const REFUSED_PROBES = [
  [
    'a virtual mock of expo-secure-store, which is installed',
    "jest.mock('expo-secure-store', () => ({}), { virtual: true });",
  ],
  [
    'a virtual mock of expo-crypto, which is installed',
    "jest.mock('expo-crypto', () => ({ randomUUID: () => 'x' }), { virtual: true });",
  ],
  [
    'a virtual mock of expo-intent-launcher, the package behind a54f735',
    "jest.mock('expo-intent-launcher', () => ({}), { virtual: true });",
  ],
  [
    'a virtual jest.doMock of an installed package',
    "jest.doMock('expo-secure-store', () => ({}), { virtual: true });",
  ],
  [
    'a virtual mock whose factory spans lines and nests calls',
    [
      'jest.mock(',
      "  'expo-crypto',",
      '  () => {',
      '    const bytes = (size: number) => Uint8Array.from({ length: size }, () => 0);',
      '    return { getRandomBytes: jest.fn(bytes) };',
      '  },',
      '  { virtual: true },',
      ');',
    ].join('\n'),
  ],
  [
    'a virtual mock of an installed package written with quoted keys',
    "jest.mock('expo-crypto', () => ({}), { 'virtual': true });",
  ],
  [
    'options this test cannot read',
    "const options = { virtual: true };\njest.mock('expo-crypto', () => ({}), options);",
  ],
];

const ALLOWED_PROBES = [
  ['a mock of an installed package, not virtual', "jest.mock('expo-secure-store', () => ({}));"],
  [
    'a mock of an installed package with virtual: false',
    "jest.mock('expo-secure-store', () => ({}), { virtual: false });",
  ],
  [
    'a virtual mock by relative path, whose key is its real path',
    "jest.mock('./phone.ts', () => ({}), { virtual: true });",
  ],
  [
    'a virtual mock by a deeper relative path',
    "jest.mock('../../features/call/phone.ts', () => ({}), { virtual: true });",
  ],
  [
    'a virtual mock of a package that is not installed',
    "jest.mock('trygghverdag-no-such-package-probe', () => ({}), { virtual: true });",
  ],
];

describe('jest virtual mocks: the reader', () => {
  test.each(REFUSED_PROBES)('refuses %s', (_what, text) => {
    expect(mocksIn(PROBE, text).length).toBeGreaterThan(0);
    expect(refusedIn(PROBE, text)).toHaveLength(1);
  });

  test.each(ALLOWED_PROBES)('allows %s', (_what, text) => {
    // Not vacuous: the reader found the mock, and let it be.
    expect(mocksIn(PROBE, text)).toHaveLength(1);
    expect(refusedIn(PROBE, text)).toEqual([]);
  });

  test('the refusal names the file, the line and the package', () => {
    const [said] = refusedIn(PROBE, "\n\njest.mock('expo-crypto', () => ({}), { virtual: true });");

    expect(said).toContain(path.relative(ROOT, PROBE));
    expect(said).toContain(':3 ');
    expect(said).toContain("'expo-crypto' is installed");
  });

  test('the packages this guard was written for resolve from the app, and a made-up name does not', () => {
    for (const name of ['expo-secure-store', 'expo-crypto', 'expo-intent-launcher']) {
      expect({ name, installed: installedFrom(PROBE, name) }).toEqual({ name, installed: true });
    }
    expect(installedFrom(PROBE, 'trygghverdag-no-such-package-probe')).toBe(false);
  });
});

/** The text of the file test-auditor planted (its audit of review loop 2). */
const PLANTED = "jest.mock('expo-crypto', () => ({ randomUUID: () => 'x' }), { virtual: true });\n";

const made = [];

/** Writes `files`, by path, into a fresh folder that stands for apps/mobile; its path. */
function tempApp(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'jest-virtual-mocks-'));
  made.push(dir);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

/** `file`, under `dir`, as a path relative to it with forward slashes. */
const relative = (dir, file) => path.relative(dir, file).split(path.sep).join('/');

describe('jest virtual mocks: the walk', () => {
  afterEach(() => {
    for (const dir of made.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // test-auditor's audit of review loop 2: jest runs a test under
  // src/**/build/ (its testPathIgnorePatterns is ["/node_modules/"] alone),
  // so the walk reads it. A walk that skipped a build output's name at any
  // depth let a virtual mock of an installed package through.
  test('reads a code file in a folder under src named as a build output (build, dist, coverage, android, ios, .expo), and skips those names at the app’s top level only; node_modules is skipped at any depth', () => {
    const names = [...NOT_SOURCE];
    const dir = tempApp(
      Object.fromEntries(
        [
          'src/app.test.tsx',
          ...names.map((name) => `src/shared/${name}/probe.test.tsx`),
          ...names.map((name) => `src/${name}/probe.ts`),
          ...names.map((name) => `${name}/probe.test.tsx`),
          'node_modules/some-package/index.js',
          'src/node_modules/some-package/index.js',
          'src/shared/build/node_modules/some-package/index.test.js',
        ].map((file) => [file, PLANTED]),
      ),
    );

    // Not vacuous: the names are the walk's own set, build among them, so
    // each name it leaves out at the top is also made, and read, under src.
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('build');
    expect(
      codeFiles(dir)
        .map((file) => relative(dir, file))
        .sort(),
    ).toEqual(
      [
        'src/app.test.tsx',
        ...names.map((name) => `src/shared/${name}/probe.test.tsx`),
        ...names.map((name) => `src/${name}/probe.ts`),
      ].sort(),
    );
  });

  test('the file test-auditor planted, src/shared/build/probe.test.tsx with a virtual mock of expo-crypto, is walked and refused, read as the app’s file', () => {
    const dir = tempApp({ 'src/shared/build/probe.test.tsx': PLANTED });

    const refused = codeFiles(dir).flatMap((file) =>
      refusedIn(path.join(APP, path.relative(dir, file)), readFileSync(file, 'utf8')),
    );

    expect(refused).toEqual([
      `${path.join('apps', 'mobile', 'src', 'shared', 'build', 'probe.test.tsx')}:1 jest.mock('expo-crypto', …, { virtual: true }): 'expo-crypto' is installed; mock it without virtual`,
    ]);
  });
});

describe('jest virtual mocks: the app', () => {
  test('no file under apps/mobile mocks an installed package with { virtual: true }', () => {
    const files = codeFiles(APP);
    const mocks = files.flatMap((file) =>
      mocksIn(file, readFileSync(file, 'utf8')).map((mock) => ({ file, ...mock })),
    );
    const refused = files.flatMap((file) => refusedIn(file, readFileSync(file, 'utf8')));

    // Not vacuous: the walk reached the app's tests, and read their mocks,
    // the installed packages' and phone.ts's by its path among them.
    expect(files.some((file) => file.endsWith(path.join('src', 'app.test.tsx')))).toBe(true);
    expect(mocks.some(({ name }) => name === 'expo-secure-store')).toBe(true);
    expect(
      mocks.some(({ name, virtual }) => name?.endsWith('phone.ts') && virtual === 'true'),
    ).toBe(true);
    expect(refused).toEqual([]);
  });
});
