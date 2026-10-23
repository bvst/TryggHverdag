// CALL-02-AC1, AC7 and AC9 (L1): what the app's source may hold, read from
// the files themselves with TypeScript's own parser, so a comment or a word in
// a string is never mistaken for code:
//   - AC7: no file in apps/mobile/src/ but src/shared/ui/palette.ts holds a
//     colour literal: a hex colour (#rgb, #rgba, #rrggbb, #rrggbbaa), or a
//     string starting rgb(, rgba(, hsl( or hsla(. Every colour comes from the
//     one palette, so every screen is dark together (Q5);
//   - AC9: no JSX text in apps/mobile/src/features/ or src/shared/ui/ is a
//     literal other than "112": every other word a person sees comes from t();
//   - AC1: each route file under src/app/ imports `Screen`, from
//     src/shared/ui/, and no file under src/features/ imports it: the route
//     draws `Screen`, and a view a feature adds inside a route later is drawn
//     inside that `Screen`, below the bar (approach 1). The ESLint rule that
//     refuses the import outside src/app/ and src/shared/ui/ (AC2) has its own
//     fixture tests in packages/config.
//
// Test files are read too: every file means every file. This file holds no
// colour, and builds the patterns it looks for from parts.
import { describe, expect, test } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** apps/mobile/src. */
const SRC = path.join(__dirname, '..', '..');

/** Every .ts and .tsx file under `dir`, at any depth, as paths relative to src/, with /. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    return /\.tsx?$/.test(name) ? [path.relative(SRC, full).split(path.sep).join('/')] : [];
  });
}

/** A file, parsed. */
function parsed(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(path.join(SRC, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Every node of a file, depth first. */
function nodesOf(source: ts.SourceFile): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Where a node is, for a message: the file and the line. */
const at = (source: ts.SourceFile, node: ts.Node): string =>
  `${source.fileName}:${String(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)}`;

/** The text of a string literal, a template without substitutions, or a template's parts. */
function literalText(node: ts.Node): string | null {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    return node.text;
  }
  return null;
}

/** A hex colour, whole: # and 3, 4, 6 or 8 hex digits. */
const HEX_COLOUR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** A functional colour: rgb(, rgba(, hsl( or hsla(, at the start. */
const FUNCTIONAL_COLOUR = new RegExp(
  `^\\s*(?:${['rgb', 'rgba', 'hsl', 'hsla'].join('|')})\\(`,
  'i',
);

const isColour = (text: string): boolean =>
  HEX_COLOUR.test(text.trim()) || FUNCTIONAL_COLOUR.test(text);

/** The one file colours may be written in. */
const PALETTE = 'shared/ui/palette.ts';

describe('CALL-02-AC7: no file but the palette holds a colour literal', () => {
  test('CALL-02-AC7: the check reads colours as the spec writes them, and nothing else', () => {
    // The patterns, checked on text made here, so that a pattern that matched
    // nothing could not pass the test below by reading nothing.
    const hash = '#';
    const call = (name: string, args: string) => `${name}(${args})`;
    for (const colour of [
      `${hash}fff`,
      `${hash}FFFA`,
      `${hash}1f4e79`,
      `${hash}1f4e79cc`,
      call('rgb', '0, 0, 0'),
      call('rgba', '0,0,0,0.5'),
      call('hsl', '0, 0%, 0%'),
      ` ${call('hsla', '0,0%,0%,1')}`,
    ]) {
      expect({ colour, read: isColour(colour) }).toEqual({ colour, read: true });
    }
    for (const text of [
      `${hash}1`,
      `${hash}12`,
      `${hash}12345`,
      `*31${hash}112`,
      'Nummer 1',
      'ring 112',
      'background',
      `${hash}ggg`,
    ]) {
      expect({ text, read: isColour(text) }).toEqual({ text, read: false });
    }
  });

  test('CALL-02-AC7: no .ts or .tsx file under apps/mobile/src/ but src/shared/ui/palette.ts holds a hex colour, or a string beginning rgb(, rgba(, hsl( or hsla(', () => {
    const files = sourceFiles(SRC);
    const found: string[] = [];
    for (const file of files.filter((each) => each !== PALETTE)) {
      const source = parsed(file);
      for (const node of nodesOf(source)) {
        const text = literalText(node);
        if (text !== null && isColour(text)) {
          found.push(`${at(source, node)} ${JSON.stringify(text)}`);
        }
      }
    }

    expect(files.length).toBeGreaterThan(0);
    expect(found).toEqual([]);
  });
});

/** The JSX text a person would read in a file, as written: text between tags, and string literals in braces. */
function jsxTexts(source: ts.SourceFile): { where: string; text: string }[] {
  return nodesOf(source).flatMap((node) => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim();
      return text === '' ? [] : [{ where: at(source, node), text }];
    }
    if (
      ts.isJsxExpression(node) &&
      node.expression !== undefined &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      (ts.isStringLiteral(node.expression) ||
        ts.isNoSubstitutionTemplateLiteral(node.expression) ||
        ts.isTemplateExpression(node.expression))
    ) {
      return [{ where: at(source, node), text: node.expression.getText(source) }];
    }
    return [];
  });
}

describe('CALL-02-AC9: no JSX text in features/ or shared/ui/ but "112"', () => {
  test('CALL-02-AC9: the check finds text between tags and literals in braces, and lets "112" through', () => {
    const source = ts.createSourceFile(
      'probe.tsx',
      [
        'const a = <Text>Hei</Text>;',
        "const b = <Text>{'Hallo'}</Text>;",
        'const c = <Text>{`Hei ${name}`}</Text>;',
        'const d = <Text>112</Text>;',
        "const e = <Text>{t('call.button.call')}</Text>;",
        'const f = <Text>{name}</Text>;',
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    expect(
      jsxTexts(source)
        .map(({ text }) => text)
        .filter((text) => text !== '112'),
    ).toEqual(['Hei', "'Hallo'", '`Hei ${name}`']);
  });

  test('CALL-02-AC9: no JSX text node in apps/mobile/src/features/ or apps/mobile/src/shared/ui/ is a literal other than "112"', () => {
    const files = sourceFiles(SRC).filter(
      (file) => file.startsWith('features/') || file.startsWith('shared/ui/'),
    );
    const found = files
      .filter((file) => file.endsWith('.tsx'))
      .flatMap((file) => jsxTexts(parsed(file)))
      .filter(({ text }) => text !== '112')
      .map(({ where, text }) => `${where} ${text}`);

    expect(files.length).toBeGreaterThan(0);
    expect(found).toEqual([]);
  });
});

/** The names a file imports `Screen` as, with the module each comes from; re-exports of it too. */
function screenImports(source: ts.SourceFile): { where: string; from: string }[] {
  return source.statements.flatMap((statement) => {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const bindings = statement.importClause?.namedBindings;
      const named =
        bindings !== undefined && ts.isNamedImports(bindings)
          ? bindings.elements.some(
              (element) => (element.propertyName ?? element.name).text === 'Screen',
            )
          : false;
      return named ? [{ where: at(source, statement), from: statement.moduleSpecifier.text }] : [];
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some(
        (element) => (element.propertyName ?? element.name).text === 'Screen',
      )
    ) {
      return [{ where: at(source, statement), from: statement.moduleSpecifier.text }];
    }
    return [];
  });
}

/** Files under src/app/ that are not screens: as screen.test.tsx leaves them out, for the same reasons. */
const NOT_A_ROUTE = [
  /\.(test|spec)\.tsx?$/,
  /(^|\/)_layout\.tsx?$/,
  /(^|\/)\+html\.tsx?$/,
  /(^|\/)\+native-intent\.tsx?$/,
  /\+api\.tsx?$/,
  /(^|\/)\+middleware\.tsx?$/,
  /\.web\.tsx?$/,
];

describe('CALL-02-AC1: the route draws Screen, and no feature does', () => {
  test('CALL-02-AC1: each route file under src/app/ imports Screen, from src/shared/ui/', () => {
    const routes = sourceFiles(SRC)
      .filter((file) => file.startsWith('app/'))
      .filter((file) => !NOT_A_ROUTE.some((pattern) => pattern.test(file.slice('app/'.length))));
    const sharedUi = path.join(SRC, 'shared', 'ui');

    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      const from = screenImports(parsed(route)).map((each) =>
        path.resolve(path.dirname(path.join(SRC, route)), each.from),
      );
      expect({
        route,
        importsScreenFromSharedUi: from.some(
          (module) => module === sharedUi || module.startsWith(`${sharedUi}${path.sep}`),
        ),
      }).toEqual({ route, importsScreenFromSharedUi: true });
    }
  });

  test('CALL-02-AC1: no file under src/features/ imports Screen, or re-exports it', () => {
    const files = sourceFiles(SRC).filter((file) => file.startsWith('features/'));
    const found = files.flatMap((file) =>
      screenImports(parsed(file)).map(({ where, from }) => `${where} from ${from}`),
    );

    expect(files.length).toBeGreaterThan(0);
    expect(found).toEqual([]);
  });
});
