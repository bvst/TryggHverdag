/**
 * BUG-11: the dependency audit's one accepted advisory, and only by decision.
 *
 * CI's required `security` job runs `pnpm audit --audit-level high`. A high
 * advisory published after `main`'s last green run, GHSA-86w9-cpqp-85rv
 * (`node-forge` through 1.4.0, no patched version), failed it on every pull
 * request from 2026-10-02. Its only path is
 * `apps__mobile>expo>@expo/cli>node-forge`: Expo's command-line tool, not the
 * server and not the app's runtime. The owner accepted that one advisory
 * (D-093), to be ignored by its ID in the root package.json.
 *
 * An ignore list is a quiet way to stop a gate from seeing anything, so these
 * tests read files instead of running the audit: a `pnpm audit` run reads the
 * registry's advisory data, which changes whenever an advisory is published, and
 * a unit test must not change its answer with the news. What they pin, and
 * nothing more:
 *   - the root package.json's `pnpm.auditConfig.ignoreGhsas` lists
 *     GHSA-86w9-cpqp-85rv (the reproduction: without it, the audit fails every
 *     pull request);
 *   - every ID in `ignoreGhsas` or `ignoreCves` is named by an entry in
 *     docs/plan/decisions.md whose status starts "Accepted (owner," or
 *     "Accepted (owner)", D-093's form. Delegated, partly accepted, accepted in
 *     principle, a bare "Accepted", an owner answering only part, proposed, or
 *     no status line at all: none of these accepts an advisory;
 *   - each ignore list holds only IDs in their advisory form, each once;
 *   - `ignoreCves` is absent or empty: the audit ignores by GHSA only;
 *   - every workflow line where `pnpm` is followed, with or without flags
 *     between, by the word `audit` is exactly `pnpm audit --audit-level high`.
 *     Whole-line comments are skipped; a line ending in a backslash is read
 *     together with the next;
 *   - nothing else can set audit settings or load a hook that could:
 *     pnpm-workspace.yaml and the root .npmrc (if there is one) never mention
 *     `pnpmfile`, `auditConfig`, `ignoreGhsas`, `ignoreCves` or
 *     `configDependencies`, in any case, quoted or not, with or without a `-`
 *     or `_`; no file in the repository root has `pnpmfile` in its name; the
 *     root package.json's `pnpm` field has no `configDependencies`; and no
 *     workflow line outside a whole-line comment mentions any of those words;
 *   - D-093's premise, read from pnpm-lock.yaml (lockfile v9): the packages
 *     that depend on `node-forge` are exactly `@expo/cli` and
 *     `@expo/code-signing-certificates`, the second's only dependent is
 *     `@expo/cli`, no workspace package depends on `node-forge` directly, and
 *     every locked `node-forge` is at most 1.4.0. Expo dropping `node-forge`,
 *     or a patched version reaching the lockfile, fails it: D-093's removal
 *     condition, made loud.
 *
 * Not pinned: the audit's result; a `run:` written as a YAML folded scalar that
 * puts `pnpm` and `audit` on different lines; pnpm settings outside the
 * repository (a runner's own user or global config); and the spike's own
 * lockfile, spikes/background-safety/app/pnpm-lock.yaml, which D-093 names as
 * not covered.
 *
 * What pnpm does with these settings was read in pnpm 10.33.0's own bundle
 * (dist/pnpm.cjs), not assumed:
 *   - the audit drops an advisory when
 *     `auditConfig.ignoreGhsas.includes(github_advisory_id)` (an exact,
 *     case-sensitive match), or when it has CVEs and every one is in
 *     `auditConfig.ignoreCves`, which can drop a different GHSA for the same
 *     CVE; `pnpm audit --ignore` and `--ignore-unfixable` write `ignoreCves`
 *     and exit 0 instead of auditing;
 *   - `auditConfig` and `configDependencies` are read from the root
 *     package.json's `pnpm` field, and then every key of pnpm-workspace.yaml is
 *     assigned over the config as written;
 *   - when it reads its config, pnpm loads `.pnpmfile.cjs` from the root (or
 *     the `pnpmfile` setting's file instead), the `globalPnpmfile` setting's
 *     file, and the `pnpmfile.cjs` of each config dependency named like a pnpm
 *     plugin, then runs every `hooks.updateConfig` over the config, which can
 *     set `auditConfig`; `npm_config_*` environment variables are settings too.
 *     A root `.pnpmfile.cjs` was loaded, and its `updateConfig` run, by
 *     `pnpm audit --audit-level high` in a scratch project on 2026-10-02.
 *
 * If a pnpmfile or a config dependency is ever needed, this file failing is the
 * prompt to look at what it does to the audit.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

/** The advisory the owner accepted on 2026-10-02. */
const ACCEPTED_ADVISORY = 'GHSA-86w9-cpqp-85rv';

/**
 * GitHub's advisory ID, as the GitHub Advisory Database's README gives it
 * (read 2026-10-02): "GHSA-xxxx-xxxx-xxxx where x is a letter or a number from
 * the following set: 23456789cfghjmpqrvwx", all letters lowercase, with the
 * pattern `/GHSA(-[23456789cfghjmpqrvwx]{4}){3}/`. Anchored here, because pnpm
 * matches the ID exactly as written: a `ghsa-` prefix, a trailing space or an
 * `o` for a `q` ignores nothing.
 */
const GHSA_ID = /^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/;
const CVE_ID = /^CVE-\d{4}-\d{4,}$/;

/** The one form a workflow may run the audit in (D-093: "Everything else stays at --audit-level high"). */
const AUDIT_COMMAND = 'pnpm audit --audit-level high';

/**
 * The words that set audit settings or load a hook that could: the settings
 * pnpm reads (`auditConfig`, `pnpmfile`, `globalPnpmfile`,
 * `configDependencies`), the two ignore lists, and their kebab and snake
 * forms, as an rc file or an `npm_config_*` variable would spell them.
 */
const ROUTE = /pnpmfile|audit[-_]?config|ignore[-_]?ghsas|ignore[-_]?cves|config[-_]?dependencies/i;

const manifest = JSON.parse(read('package.json'));
const auditConfig = manifest.pnpm?.auditConfig;
const decisionLog = read('docs/plan/decisions.md');

/** Every advisory ID the root package.json tells pnpm to ignore. */
function ignoredIds(config) {
  return [...(config?.ignoreGhsas ?? []), ...(config?.ignoreCves ?? [])];
}

// --- The decision log -------------------------------------------------------

/**
 * The decision log as entries: one per `## D-NNN — title` heading, running to
 * the next `## ` heading of any kind. `status` is what follows `**Status:**`, up
 * to the ` · ` that starts the next field, a new bullet or a blank line. It
 * wraps over lines (D-088: "Accepted (owner, 2026-10-01). Asked in / session
 * with…"), so whitespace is collapsed. An entry written without a Status line
 * (D-073 to D-075 open with "**Decision.**") has `status: null`.
 */
function decisionEntries(markdown) {
  const entries = [];
  let current = null;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      const heading = /^## (D-\d+)\b/.exec(line);
      current = heading === null ? null : { id: heading[1], lines: [line] };
      if (current !== null) entries.push(current);
    } else if (current !== null) {
      current.lines.push(line);
    }
  }
  return entries.map(({ id, lines }) => {
    const text = lines.join('\n');
    const status = /\*\*Status:\*\*\s*([\s\S]*?)(?:\s·\s|\n\s*\n|\n\s*- |$)/.exec(text);
    return { id, text, status: status === null ? null : status[1].replace(/\s+/g, ' ').trim() };
  });
}

/**
 * Only the owner accepts a known vulnerability. The status must start
 * "Accepted (owner," or "Accepted (owner)", the form D-093 is written in. A
 * delegated acceptance ("Accepted (delegated, D-031)"), one where the owner
 * answered only part ("Accepted (owner answered …; the rest delegated"), a bare
 * "Accepted", "Partly accepted" (D-069) and "Accepted in principle" (D-006) do
 * not count.
 */
function isAccepted(status) {
  return status !== null && /^Accepted \(owner[,)]/.test(status);
}

/** True when the text names this ID, and not a longer one that contains it. */
function names(text, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`).test(text);
}

/** The owner-accepted decisions that name this advisory, by ID. */
function acceptingDecisions(entries, advisory) {
  return entries.filter((e) => isAccepted(e.status) && names(e.text, advisory)).map((e) => e.id);
}

/** Why an ignored advisory has no owner-accepted decision: which entries name it, and their status. */
function whyNotAccepted(entries, advisory) {
  const naming = entries.filter((e) => names(e.text, advisory));
  if (naming.length === 0) return `${advisory}: no decision names it`;
  const found = naming.map((e) => `${e.id} (${e.status ?? 'no Status line'})`).join(', ');
  return `${advisory}: named only by ${found}`;
}

// --- The workflows -----------------------------------------------------------

/** The workflow files, by name. */
function workflowFiles() {
  return readdirSync(path.join(root, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f));
}

/**
 * The text as the shell would read its lines: a line that is not a whole-line
 * comment and ends in a backslash is joined to the next. A comment ending in a
 * backslash is not joined, because the shell does not continue a comment.
 */
function logicalLines(text) {
  const lines = [];
  let pending = null;
  for (const line of text.split(/\r?\n/)) {
    const joined = pending === null ? line : `${pending} ${line.trim()}`;
    if (!/^\s*#/.test(joined) && /\\\s*$/.test(joined)) {
      pending = joined.replace(/\\\s*$/, '').trimEnd();
      continue;
    }
    pending = null;
    lines.push(joined);
  }
  if (pending !== null) lines.push(pending);
  return lines;
}

/**
 * Every line of a workflow that runs pnpm's audit: `pnpm`, then anything but a
 * comment, then `audit` as a word of its own. So `pnpm -C . audit`,
 * `pnpm --dir . audit`, `pnpm -w audit` and `pnpm --filter=. audit` are
 * selected, not only `pnpm audit`; a lone `--audit-level` is not. The command
 * is the line without its `- ` and `run:`.
 */
function auditCommands(file, text) {
  return logicalLines(text)
    .filter((line) => !/^\s*#/.test(line) && /\bpnpm\b[^#\n]*\saudit\b/.test(line))
    .map((line) => ({ file, command: line.replace(/^\s*(?:-\s*)?(?:run:\s*)?/, '').trim() }));
}

/** The audit commands that are not the one allowed form. */
function wrongAudits(audits) {
  return audits.filter(({ command }) => command !== AUDIT_COMMAND);
}

// --- The lockfile ------------------------------------------------------------

/** The fields of an importer or a snapshot that name what it depends on. */
const DEPENDENCY_FIELDS = new Set(['dependencies', 'devDependencies', 'optionalDependencies']);

/** A YAML scalar as written in the lockfile, without its quotes. */
function unquote(scalar, where) {
  if (scalar.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(scalar)) throw new Error(`${where}: an unclosed quote: ${scalar}`);
    return scalar.slice(1, -1).replace(/''/g, "'");
  }
  if (scalar.startsWith('"')) return JSON.parse(scalar);
  return scalar;
}

/** A `key: value` line of the lockfile, both unquoted; `value` is '' for a key that opens a block. */
function keyValue(body, where) {
  const line = /^('(?:[^']|'')*'|"(?:[^"\\]|\\.)*"|[^'"].*?):(?: +(.*?))?\s*$/.exec(body);
  if (line === null) throw new Error(`${where}: not a "key: value" line: ${body}`);
  return { key: unquote(line[1], where), value: unquote(line[2] ?? '', where) };
}

/**
 * pnpm-lock.yaml, read in the form pnpm 10 writes it (lockfile v9), by
 * indentation: there is no YAML library at the root. Top-level keys at column
 * 0; `importers`, `packages` and `snapshots` entries at 2; an entry's fields at
 * 4; a snapshot's dependencies (`name: version`) and an importer's (`name:`)
 * at 6; an importer dependency's `specifier` and `version` at 8.
 *
 * Returns the lockfile's version, the `packages` keys, and for every importer
 * and snapshot the list of its `dependencies`, `devDependencies` and
 * `optionalDependencies` as `{ name, version }`. Peer ranges in `packages` and
 * `transitivePeerDependencies` are not dependencies. Anything in an importer or
 * a snapshot that is not in this form (an odd indent, an entry or a dependency
 * field written inline, another field ending in "Dependencies", a list where a
 * map belongs) throws, so a change of form fails loudly instead of reading as
 * "nothing depends on it".
 */
function readLockfile(text) {
  const lock = { lockfileVersion: null, packages: [], importers: new Map(), snapshots: new Map() };
  let section = null;
  let entry = null;
  let field = null;
  let dependency = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const where = `pnpm-lock.yaml line ${i + 1}`;
    if (line.trim() === '' || /^\s*#/.test(line)) return;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();

    if (indent === 0) {
      const { key, value } = keyValue(body, where);
      section = key;
      entry = null;
      field = null;
      dependency = null;
      if (key === 'lockfileVersion') lock.lockfileVersion = value;
      return;
    }
    if (section === 'packages') {
      if (indent === 2) lock.packages.push(keyValue(body, where).key);
      return;
    }
    if (section !== 'importers' && section !== 'snapshots') return;
    if (indent % 2 !== 0)
      throw new Error(`${where}: indented ${indent}, not the form this reader knows`);

    if (indent === 2) {
      const { key, value } = keyValue(body, where);
      if (value !== '' && value !== '{}') {
        throw new Error(`${where}: ${key} is written inline (${value}), not in block form`);
      }
      entry = [];
      (section === 'importers' ? lock.importers : lock.snapshots).set(key, entry);
      field = null;
      dependency = null;
      return;
    }
    if (entry === null) throw new Error(`${where}: a field outside any ${section} entry`);

    if (indent === 4) {
      const { key, value } = keyValue(body, where);
      if (
        /[dD]ependencies$/.test(key) &&
        !DEPENDENCY_FIELDS.has(key) &&
        key !== 'transitivePeerDependencies'
      ) {
        throw new Error(`${where}: ${key} is a dependency field this reader does not know`);
      }
      if (DEPENDENCY_FIELDS.has(key) && value !== '') {
        throw new Error(`${where}: ${key} is written inline (${value}), not in block form`);
      }
      field = key;
      dependency = null;
      return;
    }
    if (!DEPENDENCY_FIELDS.has(field)) return;

    if (indent === 6) {
      if (body.startsWith('-'))
        throw new Error(`${where}: a list item under ${field}, where a map belongs`);
      const { key, value } = keyValue(body, where);
      if (section === 'snapshots' && value === '')
        throw new Error(`${where}: ${key} has no version`);
      dependency = { name: key, version: value };
      entry.push(dependency);
      return;
    }
    if (indent === 8 && section === 'importers' && dependency !== null) {
      const { key, value } = keyValue(body, where);
      if (key === 'version') dependency.version = value;
      return;
    }
    throw new Error(`${where}: indented ${indent} under ${field}, not the form this reader knows`);
  });
  return lock;
}

/** The package name of a `name@version(peers)` key. */
function packageName(key) {
  const at = key.indexOf('@', 1);
  if (at <= 0) throw new Error(`pnpm-lock.yaml: "${key}" is not a name@version key`);
  return key.slice(0, at);
}

/** The package a dependency resolves to: its own name, or the one an alias (`alias: name@version`) points at. */
function resolvedName({ name, version }) {
  const bare = version.replace(/^npm:/, '').replace(/\(.*$/, '');
  const at = bare.indexOf('@', 1);
  return at > 0 && !bare.includes(':') ? bare.slice(0, at) : name;
}

/** What depends on a package: the snapshots' package names, and the importers' paths. */
function dependentsOf(lock, name) {
  const dependsOn = (dependencies) => dependencies.some((d) => resolvedName(d) === name);
  const packages = [...lock.snapshots]
    .filter(([, deps]) => dependsOn(deps))
    .map(([key]) => packageName(key));
  const importers = [...lock.importers].filter(([, deps]) => dependsOn(deps)).map(([at]) => at);
  return { packages: [...new Set(packages)].sort(), importers: importers.sort() };
}

/** Every version of a package the lockfile holds, from the `packages` and `snapshots` keys. */
function lockedVersions(lock, name) {
  const keys = [...lock.packages, ...lock.snapshots.keys()].filter(
    (key) => packageName(key) === name,
  );
  return [...new Set(keys.map((key) => key.slice(name.length + 1).replace(/\(.*$/, '')))].sort();
}

/**
 * True when a version is in GHSA-86w9-cpqp-85rv's range, "through 1.4.0":
 * at most 1.4.0, its pre-releases included. A version that is not plain semver
 * (a git or tarball source) cannot be placed, so it is not in range.
 */
function inAdvisoryRange(version) {
  const parts = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (parts === null) return false;
  const [major, minor, patch] = parts.slice(1, 4).map(Number);
  return major < 1 || (major === 1 && (minor < 4 || (minor === 4 && patch === 0)));
}

/** The packages D-093 says depend on node-forge: Expo's command-line tool, and its code-signing library. */
const D093_DEPENDENTS = ['@expo/cli', '@expo/code-signing-certificates'];

/** How the lockfile differs from what D-093 was decided on; empty when its premise holds. */
function premiseChanges(lock) {
  const changes = [];
  const forge = dependentsOf(lock, 'node-forge');
  if (forge.packages.join() !== D093_DEPENDENTS.join()) {
    changes.push(
      `the packages that depend on node-forge are [${forge.packages.join(', ')}], not [${D093_DEPENDENTS.join(', ')}]`,
    );
  }
  if (forge.importers.length > 0) {
    changes.push(`workspace packages depend on node-forge directly: ${forge.importers.join(', ')}`);
  }
  const certificates = dependentsOf(lock, '@expo/code-signing-certificates');
  const certificateDependents = [
    ...certificates.packages,
    ...certificates.importers.map((at) => `workspace package ${at}`),
  ];
  if (certificateDependents.join() !== '@expo/cli') {
    changes.push(
      `@expo/code-signing-certificates is depended on by [${certificateDependents.join(', ')}], not only @expo/cli`,
    );
  }
  const versions = lockedVersions(lock, 'node-forge');
  if (versions.length === 0) changes.push('node-forge is not in the lockfile');
  const outside = versions.filter((v) => !inAdvisoryRange(v));
  if (outside.length > 0) {
    changes.push(
      `node-forge ${outside.join(', ')} is locked, outside the advisory's range (through 1.4.0)`,
    );
  }
  return changes;
}

/**
 * A synthetic lockfile in v9's form, where D-093's premise holds: node-forge
 * 1.4.0 through `@expo/cli` and `@expo/code-signing-certificates` only. It also
 * holds the forms that must not count as depending on node-forge: a peer range
 * in `packages`, a `transitivePeerDependencies` item, and an alias to another
 * package.
 */
const SAMPLE_LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    devDependencies:
      vitest:
        specifier: ^5.0.1
        version: 5.0.1

  apps/mobile:
    dependencies:
      expo:
        specifier: ~57.0.25
        version: 57.0.25(react@19.2.3)

  apps/server:
    dependencies:
      zod:
        specifier: ^4.6.5
        version: 4.6.5

packages:

  '@expo/cli@57.0.27':
    resolution: {integrity: sha512-synthetic}
    hasBin: true

  '@expo/code-signing-certificates@0.0.6':
    resolution: {integrity: sha512-synthetic}

  '@synthetic/signer@2.0.0':
    resolution: {integrity: sha512-synthetic}
    peerDependencies:
      node-forge: '*'

  expo@57.0.25:
    resolution: {integrity: sha512-synthetic}

  node-forge@1.4.0:
    resolution: {integrity: sha512-synthetic}
    engines: {node: '>= 6.13.0'}

snapshots:

  '@expo/cli@57.0.27(expo@57.0.25(react@19.2.3))':
    dependencies:
      '@expo/code-signing-certificates': 0.0.6
      node-forge: 1.4.0
    transitivePeerDependencies:
      - supports-color

  '@expo/code-signing-certificates@0.0.6':
    dependencies:
      node-forge: 1.4.0

  '@synthetic/signer@2.0.0':
    dependencies:
      string-width-cjs: string-width@4.2.3
    optionalDependencies:
      fsevents: 2.3.3
    transitivePeerDependencies:
      - node-forge

  expo@57.0.25(react@19.2.3):
    dependencies:
      '@expo/cli': 57.0.27(expo@57.0.25(react@19.2.3))

  node-forge@1.4.0: {}
`;

/** The sample with each `[from, to]` replaced everywhere; a `from` the sample lacks is an error, not a no-op. */
function edited(text, ...edits) {
  let out = text;
  for (const [from, to] of edits) {
    if (!out.includes(from)) throw new Error(`the sample has no ${JSON.stringify(from)}`);
    out = out.split(from).join(to);
  }
  return out;
}

const PREMISE_CHANGED = "D-093's premise changed: decide again, or remove the ignore";

describe('the dependency audit ignores what the owner accepted, and nothing else', () => {
  test('BUG-11: GHSA-86w9-cpqp-85rv is ignored by the dependency audit', () => {
    expect(
      auditConfig?.ignoreGhsas,
      "the root package.json's pnpm.auditConfig.ignoreGhsas does not list the accepted advisory",
    ).toEqual(expect.arrayContaining([ACCEPTED_ADVISORY]));
  });

  test('BUG-11: every advisory the audit ignores is accepted by a decision', () => {
    const entries = decisionEntries(decisionLog);
    const unaccepted = ignoredIds(auditConfig)
      .filter((id) => acceptingDecisions(entries, id).length === 0)
      .map((id) => whyNotAccepted(entries, id));

    expect(
      unaccepted,
      'ignored by the audit, but no entry in docs/plan/decisions.md accepted by the owner names it',
    ).toEqual([]);
  });

  test('BUG-11: the ignore lists hold only well-formed advisory IDs, each once, so a typo cannot ignore nothing', () => {
    const lists = [
      ['ignoreGhsas', GHSA_ID],
      ['ignoreCves', CVE_ID],
    ];
    for (const [key, form] of lists) {
      const list = auditConfig?.[key];
      if (list === undefined) continue;

      expect(Array.isArray(list), `pnpm.auditConfig.${key} is not a list`).toBe(true);
      expect(
        list.filter((id) => typeof id !== 'string' || !form.test(id)),
        `pnpm.auditConfig.${key} holds IDs that are not in the advisory ID form`,
      ).toEqual([]);
      expect(
        list.filter((id, i) => list.indexOf(id) !== i),
        `pnpm.auditConfig.${key} lists an ID twice`,
      ).toEqual([]);
    }
  });

  test('BUG-11: the audit ignores by GHSA only: pnpm.auditConfig.ignoreCves is absent or empty', () => {
    // pnpm drops every advisory whose CVEs are all in ignoreCves, which can be
    // a different GHSA for the same CVE than the one a decision accepted; and
    // `pnpm audit --ignore` and `--ignore-unfixable` write to this list.
    expect(
      auditConfig?.ignoreCves ?? [],
      'pnpm.auditConfig.ignoreCves is set: ignore by GHSA (ignoreGhsas), the ID a decision names',
    ).toEqual([]);
  });

  test('BUG-11: every workflow line that runs pnpm audit, in any form, is exactly `pnpm audit --audit-level high`', () => {
    // D-093: "Everything else stays at --audit-level high." A lower bar,
    // --ignore or --ignore-unfixable on the command line, or the audit run
    // from somewhere else with flags in between, would let through what no
    // decision accepted.
    const audits = workflowFiles().flatMap((file) =>
      auditCommands(file, read(`.github/workflows/${file}`)),
    );

    expect(audits.length, 'no workflow runs pnpm audit').toBeGreaterThan(0);
    expect(
      wrongAudits(audits),
      `a workflow runs pnpm audit other than as \`${AUDIT_COMMAND}\``,
    ).toEqual([]);
  });

  test('BUG-11: the workflow check selects every form of pnpm audit, not only the literal one', () => {
    const sample = [
      'jobs:',
      '  security:',
      '    steps:',
      '      - run: pnpm install --frozen-lockfile',
      '      - run: pnpm audit --audit-level high',
      '      - run: pnpm -C . audit --ignore-unfixable',
      '      - run: pnpm --dir . audit',
      '      - run: pnpm -w audit',
      '      - run: pnpm --filter=. audit',
      '      - run: pnpm audit --audit-level critical',
      '      - run: |',
      '          pnpm --recursive \\',
      '            audit --ignore CVE-2026-0001',
      '      # - run: pnpm audit --ignore-unfixable',
      '      - run: |',
      '          # a comment that ends in a backslash \\',
      '          pnpm audit --json',
      '      - run: pnpm run licenses:check',
      '        with: { node-version-file: .nvmrc, cache: pnpm }',
    ].join('\n');

    const audits = auditCommands('sample.yml', sample);
    expect(audits.map((a) => a.command)).toEqual([
      'pnpm audit --audit-level high',
      'pnpm -C . audit --ignore-unfixable',
      'pnpm --dir . audit',
      'pnpm -w audit',
      'pnpm --filter=. audit',
      'pnpm audit --audit-level critical',
      'pnpm --recursive audit --ignore CVE-2026-0001',
      'pnpm audit --json',
    ]);
    expect(wrongAudits(audits).map((a) => a.command)).toEqual([
      'pnpm -C . audit --ignore-unfixable',
      'pnpm --dir . audit',
      'pnpm -w audit',
      'pnpm --filter=. audit',
      'pnpm audit --audit-level critical',
      'pnpm --recursive audit --ignore CVE-2026-0001',
      'pnpm audit --json',
    ]);
  });

  test("BUG-11: nothing else sets pnpm's audit settings or loads a hook that could: pnpm-workspace.yaml, .npmrc, a pnpmfile, config dependencies", () => {
    expect(
      read('pnpm-workspace.yaml'),
      "pnpm-workspace.yaml mentions an audit or hook setting: its keys are assigned over package.json's, so auditConfig there replaces the decided one, and a pnpmfile or config dependency can rewrite it",
    ).not.toMatch(ROUTE);
    expect(
      existsSync(path.join(root, '.npmrc')) ? read('.npmrc') : '',
      'the root .npmrc mentions an audit or hook setting: a pnpmfile it names is loaded for the audit, and its updateConfig hook can set auditConfig',
    ).not.toMatch(ROUTE);
    expect(
      readdirSync(root).filter((name) => /pnpmfile/i.test(name)),
      'a pnpmfile in the repository root: pnpm loads .pnpmfile.cjs for the audit, and its updateConfig hook can set auditConfig',
    ).toEqual([]);
    expect(
      Object.keys(manifest.pnpm ?? {}).filter((key) => ROUTE.test(key) && key !== 'auditConfig'),
      "the root package.json's pnpm field sets configDependencies or a pnpmfile: a config dependency named like a pnpm plugin brings a pnpmfile.cjs that pnpm loads for the audit",
    ).toEqual([]);
  });

  test('BUG-11: no workflow sets audit settings or a pnpmfile around the audit', () => {
    // An `npm_config_pnpmfile` in a step's env, a `.pnpmfile.cjs` written by a
    // step, `pnpm config set global-pnpmfile` or an edit to auditConfig would
    // change what the audit ignores without touching package.json.
    const mentions = workflowFiles().flatMap((file) =>
      read(`.github/workflows/${file}`)
        .split('\n')
        .filter((line) => !/^\s*#/.test(line) && ROUTE.test(line))
        .map((line) => `${file}: ${line.trim()}`),
    );

    expect(mentions, 'a workflow mentions an audit or hook setting').toEqual([]);
  });

  test("BUG-11: D-093's premise holds in the lockfile: node-forge comes only through Expo's command-line tool, at a version the advisory covers", () => {
    const lock = readLockfile(read('pnpm-lock.yaml'));

    expect(
      lock.lockfileVersion,
      'pnpm-lock.yaml is not lockfile v9, the form this reader knows',
    ).toMatch(/^9\./);
    // The reader found the workspace packages and what they depend on, so "no
    // workspace package depends on node-forge" is read, not assumed.
    expect(
      dependentsOf(lock, 'expo').importers,
      'the lockfile reader did not find apps/mobile depending on expo',
    ).toContain('apps/mobile');
    expect(premiseChanges(lock), PREMISE_CHANGED).toEqual([]);
  });

  test("BUG-11: the lockfile check fails on each way D-093's premise can change, and on a lockfile form it cannot read", () => {
    const sample = readLockfile(SAMPLE_LOCK);
    expect(sample.lockfileVersion).toBe('9.0');
    expect(dependentsOf(sample, 'expo').importers).toEqual(['apps/mobile']);
    expect(dependentsOf(sample, 'node-forge')).toEqual({
      packages: D093_DEPENDENTS,
      importers: [],
    });
    expect(lockedVersions(sample, 'node-forge')).toEqual(['1.4.0']);
    expect(premiseChanges(sample)).toEqual([]);

    // A patched version reaches the lockfile.
    const patched = edited(
      SAMPLE_LOCK,
      ['node-forge@1.4.0', 'node-forge@1.4.1'],
      ['node-forge: 1.4.0', 'node-forge: 1.4.1'],
    );
    expect(premiseChanges(readLockfile(patched))).toEqual([
      "node-forge 1.4.1 is locked, outside the advisory's range (through 1.4.0)",
    ]);
    expect(['0.10.0', '1.3.9', '1.4.0-rc.1', '1.4.0'].filter(inAdvisoryRange)).toEqual([
      '0.10.0',
      '1.3.9',
      '1.4.0-rc.1',
      '1.4.0',
    ]);
    expect(
      ['1.4.1', '1.4.1-rc.1', '1.5.0', '2.0.0', 'github:synthetic/forge'].filter(inAdvisoryRange),
    ).toEqual([]);

    // Expo stops depending on node-forge.
    const dropped = edited(
      SAMPLE_LOCK,
      ['      node-forge: 1.4.0\n', ''],
      [
        "  node-forge@1.4.0:\n    resolution: {integrity: sha512-synthetic}\n    engines: {node: '>= 6.13.0'}\n",
        '',
      ],
      ['  node-forge@1.4.0: {}\n', ''],
    );
    expect(premiseChanges(readLockfile(dropped))).toEqual([
      'the packages that depend on node-forge are [], not [@expo/cli, @expo/code-signing-certificates]',
      'node-forge is not in the lockfile',
    ]);

    // Another package depends on node-forge: through an alias, or as optional.
    const throughAlias = edited(SAMPLE_LOCK, [
      'string-width-cjs: string-width@4.2.3',
      'forge: node-forge@1.4.0',
    ]);
    const asOptional = edited(SAMPLE_LOCK, ['fsevents: 2.3.3', 'node-forge: 1.4.0']);
    for (const text of [throughAlias, asOptional]) {
      expect(premiseChanges(readLockfile(text))).toEqual([
        'the packages that depend on node-forge are [@expo/cli, @expo/code-signing-certificates, @synthetic/signer], not [@expo/cli, @expo/code-signing-certificates]',
      ]);
    }

    // A workspace package depends on node-forge, or on the code-signing library, directly.
    const direct = edited(SAMPLE_LOCK, [
      'zod:\n        specifier: ^4.6.5\n        version: 4.6.5',
      'node-forge:\n        specifier: ^1.4.0\n        version: 1.4.0',
    ]);
    expect(premiseChanges(readLockfile(direct))).toEqual([
      'workspace packages depend on node-forge directly: apps/server',
    ]);
    const directCertificates = edited(SAMPLE_LOCK, [
      'zod:\n        specifier: ^4.6.5\n        version: 4.6.5',
      "'@expo/code-signing-certificates':\n        specifier: 0.0.6\n        version: 0.0.6",
    ]);
    expect(premiseChanges(readLockfile(directCertificates))).toEqual([
      '@expo/code-signing-certificates is depended on by [@expo/cli, workspace package apps/server], not only @expo/cli',
    ]);

    // A form the reader does not know throws instead of reading as "nothing depends on it".
    const inline = edited(SAMPLE_LOCK, [
      "  '@expo/code-signing-certificates@0.0.6':\n    dependencies:\n      node-forge: 1.4.0\n",
      "  '@expo/code-signing-certificates@0.0.6':\n    dependencies: {node-forge: 1.4.0}\n",
    ]);
    expect(() => readLockfile(inline)).toThrow(/dependencies is written inline/);
    const inlineEntry = edited(SAMPLE_LOCK, [
      '  node-forge@1.4.0: {}\n',
      '  node-forge@1.4.0: {dependencies: {}}\n',
    ]);
    expect(() => readLockfile(inlineEntry)).toThrow(/node-forge@1\.4\.0 is written inline/);
    const unknownField = edited(SAMPLE_LOCK, [
      '    optionalDependencies:\n      fsevents',
      '    bundledDependencies:\n      fsevents',
    ]);
    expect(() => readLockfile(unknownField)).toThrow(
      /bundledDependencies is a dependency field this reader does not know/,
    );
    const reindented = edited(SAMPLE_LOCK, [
      '      node-forge: 1.4.0\n',
      '     node-forge: 1.4.0\n',
    ]);
    expect(() => readLockfile(reindented)).toThrow(/indented 5/);
  });

  test("BUG-11: the decision lookup reads the log as it is written: only an owner's acceptance counts, not a delegated, bare, partial, in-principle or proposed one, nor no status at all", () => {
    // The log's own forms, from docs/plan/decisions.md.
    const entries = decisionEntries(decisionLog);
    const log = new Map(entries.map((e) => [e.id, e]));
    expect(log.get('D-088')?.status).toMatch(/^Accepted \(owner, 2026-10-01\)\. Asked in session /);
    expect(isAccepted(log.get('D-088')?.status ?? null)).toBe(true);
    expect(acceptingDecisions(entries, ACCEPTED_ADVISORY)).toContain('D-093');
    expect(log.get('D-032')?.status).toBe('Accepted (delegated, D-031)');
    expect(isAccepted(log.get('D-032')?.status ?? null)).toBe(false);
    expect(log.get('D-001')?.status).toBe('Accepted');
    expect(isAccepted(log.get('D-001')?.status ?? null)).toBe(false);
    expect(isAccepted(log.get('D-069')?.status ?? null)).toBe(false);
    expect(isAccepted(log.get('D-006')?.status ?? null)).toBe(false);
    expect(log.get('D-074')?.status).toBeNull();

    // Synthetic entries, for the forms the log does not hold yet, and for where
    // one entry ends: a GHSA under a heading that is not a decision belongs to
    // no decision, not to the entry above it.
    const synthetic = decisionEntries(
      [
        '## D-901 — An accepted advisory',
        '- **Date:** 2026-01-01 · **Status:** Accepted (owner, 2026-01-01). Asked in',
        '  session · **Section:** 8',
        '- **Decision:** the audit ignores GHSA-2222-3333-4444.',
        '',
        '## D-902 — A proposed one',
        '- **Date:** 2026-01-01 · **Status:** Proposed · **Section:** 8',
        '- **Decision:** the audit would ignore GHSA-5555-6666-7777.',
        '',
        '## D-903 — No Status line',
        '',
        '**Decision.** The audit ignores GHSA-8888-9999-cccc.',
        '',
        '## D-904 — Partly accepted',
        '- **Date:** 2026-01-01 · **Status:** Partly accepted (delegated); the',
        '  rest **needs the owner** · **Section:** 8',
        '- **Decision:** the audit ignores GHSA-ffff-gggg-hhhh.',
        '',
        '## D-905 — Accepted, but delegated',
        '- **Date:** 2026-01-01 · **Status:** Accepted (delegated, D-031) · **Section:** 8',
        '- **Decision:** the audit ignores GHSA-qqqq-rrrr-vvvv.',
        '',
        '## D-906 — The owner answered one part; the rest delegated',
        '- **Date:** 2026-01-01 · **Status:** Accepted (owner answered one question; the',
        '  rest delegated, D-031) · **Section:** 8',
        '- **Decision:** the audit ignores GHSA-wwww-xxxx-2345.',
        '',
        '## D-907 — A bare Accepted',
        '- **Date:** 2026-01-01 · **Status:** Accepted · **Section:** 8',
        '- **Decision:** the audit ignores GHSA-3456-789c-fghj.',
        '',
        '## D-908 — The owner, undated',
        '- **Date:** 2026-01-01 · **Status:** Accepted (owner) · **Section:** 8',
        '- **Decision:** the audit ignores GHSA-mpqr-vwx2-3456.',
        '',
        '## Notes',
        'GHSA-jjjj-mmmm-pppp is named here, under no decision.',
      ].join('\n'),
    );

    expect(acceptingDecisions(synthetic, 'GHSA-2222-3333-4444')).toEqual(['D-901']);
    expect(acceptingDecisions(synthetic, 'GHSA-5555-6666-7777')).toEqual([]);
    expect(acceptingDecisions(synthetic, 'GHSA-8888-9999-cccc')).toEqual([]);
    expect(acceptingDecisions(synthetic, 'GHSA-ffff-gggg-hhhh')).toEqual([]);
    expect(acceptingDecisions(synthetic, 'GHSA-qqqq-rrrr-vvvv')).toEqual([]);
    expect(acceptingDecisions(synthetic, 'GHSA-wwww-xxxx-2345')).toEqual([]);
    expect(acceptingDecisions(synthetic, 'GHSA-3456-789c-fghj')).toEqual([]);
    expect(acceptingDecisions(synthetic, 'GHSA-mpqr-vwx2-3456')).toEqual(['D-908']);
    expect(acceptingDecisions(synthetic, 'GHSA-jjjj-mmmm-pppp')).toEqual([]);
    expect(acceptingDecisions(synthetic, 'GHSA-2222-3333-444')).toEqual([]);
    expect(whyNotAccepted(synthetic, 'GHSA-5555-6666-7777')).toBe(
      'GHSA-5555-6666-7777: named only by D-902 (Proposed)',
    );
    expect(whyNotAccepted(synthetic, 'GHSA-8888-9999-cccc')).toBe(
      'GHSA-8888-9999-cccc: named only by D-903 (no Status line)',
    );
    expect(whyNotAccepted(synthetic, 'GHSA-qqqq-rrrr-vvvv')).toBe(
      'GHSA-qqqq-rrrr-vvvv: named only by D-905 (Accepted (delegated, D-031))',
    );
    expect(whyNotAccepted(synthetic, 'GHSA-jjjj-mmmm-pppp')).toBe(
      'GHSA-jjjj-mmmm-pppp: no decision names it',
    );
  });
});
