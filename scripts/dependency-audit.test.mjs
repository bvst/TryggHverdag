/**
 * BUG-11 and BUG-15: the dependency audit's two accepted advisories, each only
 * by its own decision.
 *
 * CI's required `security` job runs `pnpm audit --audit-level high`. Twice, a
 * high advisory with no patched version, published after `main`'s last green
 * run, failed it on every pull request:
 *   - GHSA-86w9-cpqp-85rv (`node-forge` through 1.4.0), from 2026-10-02. Its
 *     only path is `apps__mobile>expo>@expo/cli>node-forge`: Expo's
 *     command-line tool, not the server and not the app's runtime. The owner
 *     accepted it (D-093, BUG-11).
 *   - GHSA-vfj7-8cjw-p6xm (`braces` through 3.0.3), from 2026-10-03, on
 *     `main`'s own checkout as well. Its only dependent is `micromatch`, the
 *     glob matcher under the app's test runner and Expo's tooling, which expand
 *     patterns from this repository's own configuration. The owner accepted it
 *     (D-104, BUG-15).
 * Each is ignored by its ID in the root package.json.
 *
 * BUG-23 is the other kind: a high advisory with a patched version, which is
 * fixed, not ignored. GHSA-68fv-2mgg-jv7q (`source-map-js` before 1.2.2, an
 * event-loop denial of service through indexed source-map section offsets)
 * failed the audit on `main` and every pull request: the lockfile held 1.2.1,
 * through `@vitest/coverage-v8 > magicast` and through `postcss`, both
 * declaring `^1.2.1`. The root package.json overrides it to 1.2.2. Ignoring it
 * instead fails BUG-15's pin of exactly two ignored advisories.
 *
 * An ignore list is a quiet way to stop a gate from seeing anything, so these
 * tests read files instead of running the audit: a `pnpm audit` run reads the
 * registry's advisory data, which changes whenever an advisory is published, and
 * a unit test must not change its answer with the news. What they pin, and
 * nothing more:
 *   - the root package.json's `pnpm.auditConfig.ignoreGhsas` lists
 *     GHSA-86w9-cpqp-85rv and GHSA-vfj7-8cjw-p6xm (the reproductions: without
 *     either, the audit fails every pull request);
 *   - `ignoreGhsas` holds exactly those two, each named by its own owner's
 *     decision, D-093 and D-104. A third fails this pin until the ID is added
 *     to `DECIDED_IGNORES`, beside which its premise test belongs;
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
 *     condition, made loud;
 *   - D-104's premise, read from pnpm-lock.yaml the same way: the packages
 *     that depend on `braces` are exactly `micromatch`, no workspace package
 *     depends on `braces` directly, and every locked `braces` is at most
 *     3.0.3. A patched version reaching the lockfile, `braces` leaving it, or
 *     any new dependent fails it: D-104's prompt to remove the ignore or look
 *     again, made loud;
 *   - D-104's "Only `apps/mobile` reaches `braces`", read from pnpm-lock.yaml
 *     as a walk: upward from every locked `braces`, through every snapshot
 *     that depends on what was reached, to the workspace packages (the
 *     importers), and on through every `link:` from one importer to another.
 *     The importers reached are exactly `apps/mobile`. Every dependency field
 *     counts, dev ones too, because the ignore hides the advisory on every
 *     path, not only on a production one. The premise above cannot see this:
 *     `braces`' only dependent is `micromatch`, which almost every glob
 *     library goes through, so the server depending on `micromatch`, or on
 *     `jest-message-util`, which reaches it, left every other test here green;
 *   - BUG-23's fix, read from pnpm-lock.yaml: every `source-map-js` the
 *     lockfile resolves, by a `packages` or a `snapshots` key, is 1.2.2 or
 *     later. A version below it fails, named, 1.2.2's own pre-releases
 *     included; so does one that is not plain semver (a git or tarball
 *     source), which cannot be compared and so cannot be called fixed. The
 *     lockfile's `overrides` section, where the fix writes
 *     `source-map-js@<1.2.2`, holds a range, not a resolved version, and is
 *     not read.
 *
 * Not pinned:
 *   - the audit's result;
 *   - a `run:` written as a YAML folded scalar that puts `pnpm` and `audit` on
 *     different lines;
 *   - pnpm settings outside the repository (a runner's own user or global
 *     config);
 *   - the spike's own lockfile, spikes/background-safety/app/pnpm-lock.yaml,
 *     which D-093 names as not covered;
 *   - a new path to `braces` *inside* `apps/mobile`: a new app dependency that
 *     uses `micromatch`, or the app depending on `micromatch` directly. The
 *     walk allows `apps/mobile`, so either passes. Pinning `micromatch`'s exact
 *     dependents would catch it, but would also fail on routine Jest and Metro
 *     updates; D-104 leaves that cost for the owner to choose, and it is not
 *     pinned;
 *   - whether app source imports `micromatch` or `braces`. D-104's context
 *     reads that none does; nothing here reads the source;
 *   - a later decision that supersedes D-093 or D-104. The lookup finds the
 *     owner's acceptance, and does not read whether a later entry withdrew it
 *     (BUG-11's open gap). Removing the ID from `ignoreGhsas` is the loud
 *     path: the tests here then fail until they change with it;
 *   - copies of `braces` bundled inside other packages, which neither the
 *     lockfile nor the audit can see: those in Vite's bundled chokidar, tsx,
 *     prettier and `resolve-workspace-root`. All are tooling; the server runs
 *     under Node's type stripping, not tsx;
 *   - how BUG-23's fix reaches the lockfile: the root package.json's override
 *     is not read, only what the lockfile resolves. `source-map-js` leaving the
 *     lockfile passes, because nothing then resolves below 1.2.2;
 *   - `source-map-js` in the spike's lockfile, which holds 1.2.1 and which the
 *     audit does not read (D-093 names it as not covered).
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

/** The advisory the owner accepted on 2026-10-02 (D-093): node-forge's. */
const ACCEPTED_ADVISORY = 'GHSA-86w9-cpqp-85rv';

/** The advisory the owner accepted on 2026-10-03 (D-104): braces'. */
const BRACES_ADVISORY = 'GHSA-vfj7-8cjw-p6xm';

/**
 * Every advisory the audit may ignore, and the decision that accepted it. Exactly
 * these: a third needs its own owner's decision and its own premise test here.
 */
const DECIDED_IGNORES = new Map([
  [ACCEPTED_ADVISORY, 'D-093'],
  [BRACES_ADVISORY, 'D-104'],
]);

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

/**
 * True when a version is in GHSA-vfj7-8cjw-p6xm's range, "through 3.0.3": at
 * most 3.0.3, its pre-releases included. A version that is not plain semver (a
 * git or tarball source) cannot be placed, so it is not in range.
 */
function inBracesRange(version) {
  const parts = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (parts === null) return false;
  const [major, minor, patch] = parts.slice(1, 4).map(Number);
  return major < 3 || (major === 3 && minor === 0 && patch <= 3);
}

/** The package D-104 says depends on braces: micromatch, the glob matcher. */
const D104_DEPENDENTS = ['micromatch'];

/** How the lockfile differs from what D-104 was decided on; empty when its premise holds. */
function bracesPremiseChanges(lock) {
  const changes = [];
  const braces = dependentsOf(lock, 'braces');
  if (braces.packages.join() !== D104_DEPENDENTS.join()) {
    changes.push(
      `the packages that depend on braces are [${braces.packages.join(', ')}], not [${D104_DEPENDENTS.join(', ')}]`,
    );
  }
  if (braces.importers.length > 0) {
    changes.push(`workspace packages depend on braces directly: ${braces.importers.join(', ')}`);
  }
  const versions = lockedVersions(lock, 'braces');
  if (versions.length === 0) changes.push('braces is not in the lockfile');
  const outside = versions.filter((v) => !inBracesRange(v));
  if (outside.length > 0) {
    changes.push(
      `braces ${outside.join(', ')} is locked, outside the advisory's range (through 3.0.3)`,
    );
  }
  return changes;
}

/**
 * A synthetic lockfile in v9's form, where D-104's premise holds: braces 3.0.3
 * through micromatch only, and micromatch reached from a workspace package's
 * test runner. It also holds the forms that must not count as depending on
 * braces: a peer range in `packages`, a `transitivePeerDependencies` item, and
 * an alias to another package.
 */
const BRACES_SAMPLE_LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    devDependencies:
      vitest:
        specifier: ^5.0.1
        version: 5.0.1

  apps/mobile:
    devDependencies:
      '@synthetic/test-runner':
        specifier: ^30.0.0
        version: 30.0.0

  apps/server:
    dependencies:
      zod:
        specifier: ^4.6.5
        version: 4.6.5

packages:

  '@synthetic/expander@2.0.0':
    resolution: {integrity: sha512-synthetic}
    peerDependencies:
      braces: '*'

  '@synthetic/test-runner@30.0.0':
    resolution: {integrity: sha512-synthetic}

  braces@3.0.3:
    resolution: {integrity: sha512-synthetic}
    engines: {node: '>=8'}

  fill-range@7.1.1:
    resolution: {integrity: sha512-synthetic}

  micromatch@4.0.8:
    resolution: {integrity: sha512-synthetic}
    engines: {node: '>=8.6'}

snapshots:

  '@synthetic/expander@2.0.0':
    dependencies:
      string-width-cjs: string-width@4.2.3
    optionalDependencies:
      fsevents: 2.3.3
    transitivePeerDependencies:
      - braces

  '@synthetic/test-runner@30.0.0':
    dependencies:
      micromatch: 4.0.8

  braces@3.0.3:
    dependencies:
      fill-range: 7.1.1

  fill-range@7.1.1: {}

  micromatch@4.0.8:
    dependencies:
      braces: 3.0.3
      picomatch: 2.3.2
`;

const D104_PREMISE_CHANGED = "D-104's premise changed: decide again, or remove the ignore";

// --- What reaches braces -----------------------------------------------------

/**
 * The importer a `link:` dependency points at. The path is relative to the
 * importer that names it: `link:packages/config` from the root (`.`),
 * `link:../../packages/config` from `apps/server`.
 */
function linkedImporter(from, version) {
  return path.posix.join(from, version.slice('link:'.length));
}

/**
 * The snapshot a dependency resolves to, by its key. `name: version(peers)`
 * resolves to `name@version(peers)`, and an alias, `alias: name@version(peers)`,
 * to what it names. The peer suffix is stripped before the alias check, or
 * `react-native: 0.86.3(@babel/core@7.29.7)` reads as an alias of a package
 * named `0.86.3(`.
 */
function snapshotKey({ name, version }) {
  const written = version.replace(/^npm:/, '');
  const bare = written.replace(/\(.*$/, '');
  const at = bare.indexOf('@', 1);
  return at > 0 && !bare.includes(':') ? written : `${name}@${written}`;
}

/** A node of the lockfile's graph: a snapshot by its key, or an importer by its path. */
const snapshotNode = (key) => `snapshot ${key}`;
const importerNode = (at) => `importer ${at}`;
const nodeName = (node) => node.replace(/^(?:snapshot|importer) /, '');

/**
 * For every snapshot and importer, what depends on it: the snapshots and
 * importers that list it in any of `readLockfile`'s dependency fields, and the
 * importers that `link:` to an importer. A dependency that resolves to no
 * snapshot or importer the lockfile holds throws, because a dependency the
 * walk could not place would read as "nothing reaches it this way".
 */
function dependentsIndex(lock) {
  const index = new Map();
  const add = (target, dependent) => {
    if (!index.has(target)) index.set(target, []);
    index.get(target).push(dependent);
  };
  for (const [key, dependencies] of lock.snapshots) {
    for (const dependency of dependencies) {
      const target = snapshotKey(dependency);
      if (!lock.snapshots.has(target)) {
        throw new Error(
          `pnpm-lock.yaml: ${key} depends on ${dependency.name}: ${dependency.version}, which resolves to no snapshot (${target})`,
        );
      }
      add(snapshotNode(target), snapshotNode(key));
    }
  }
  for (const [at, dependencies] of lock.importers) {
    for (const dependency of dependencies) {
      if (dependency.version.startsWith('link:')) {
        const target = linkedImporter(at, dependency.version);
        if (!lock.importers.has(target)) {
          throw new Error(
            `pnpm-lock.yaml: importer ${at} links ${dependency.name} to ${target}, which is no importer`,
          );
        }
        add(importerNode(target), importerNode(at));
        continue;
      }
      const target = snapshotKey(dependency);
      if (!lock.snapshots.has(target)) {
        throw new Error(
          `pnpm-lock.yaml: importer ${at} depends on ${dependency.name}: ${dependency.version || '(no version)'}, which resolves to no snapshot (${target})`,
        );
      }
      add(snapshotNode(target), importerNode(at));
    }
  }
  return index;
}

/**
 * Every importer from which a locked version of `name` is reached, with one
 * shortest chain from it down to that version. The walk goes upward, from every
 * snapshot of `name`, through what depends on it, until nothing new is
 * reached; a `link:` between importers is followed like any other dependency.
 *
 * Every dependency field `readLockfile` reads counts (`dependencies`,
 * `devDependencies`, `optionalDependencies`), so this is not
 * `pnpm why braces --prod`. `--prod` does not mean "what runs in production"
 * anyway: in pnpm it includes peers (D-104's context, from BUG-15's
 * `privacy-security-reviewer`). And a path through a dev dependency still
 * installs `braces`, whose advisory the ignore then hides there too: pnpm
 * drops it by `ignoreGhsas.includes(github_advisory_id)`, wherever it turns
 * up. So the claim pinned is the stronger one: no path at all.
 */
function importersReaching(lock, name) {
  const index = dependentsIndex(lock);
  const queue = [...lock.snapshots.keys()]
    .filter((key) => packageName(key) === name)
    .map(snapshotNode);
  const below = new Map(queue.map((node) => [node, null]));
  for (let i = 0; i < queue.length; i += 1) {
    for (const dependent of index.get(queue[i]) ?? []) {
      if (below.has(dependent)) continue;
      below.set(dependent, queue[i]);
      queue.push(dependent);
    }
  }
  const reached = new Map();
  for (const node of queue.filter((n) => n.startsWith('importer ')).sort()) {
    const chain = [];
    for (let at = node; at !== null; at = below.get(at)) chain.push(nodeName(at));
    reached.set(nodeName(node), chain);
  }
  return reached;
}

/**
 * The importers D-104 leaves `braces` reachable from: the app's, by its test
 * runner and Expo's tooling. "Only `apps/mobile` reaches `braces`."
 */
const D104_REACHED_FROM = ['apps/mobile'];

/** How the importers that reach braces differ from D-104's context; empty when only apps/mobile does. */
function bracesReachChanges(lock) {
  const reached = importersReaching(lock, 'braces');
  const importers = [...reached.keys()];
  if (importers.join() === D104_REACHED_FROM.join()) return [];
  return [
    `the workspace packages that reach braces are [${importers.join(', ')}], not [${D104_REACHED_FROM.join(', ')}]`,
    ...importers
      .filter((at) => !D104_REACHED_FROM.includes(at))
      .map((at) => `${at} reaches braces: ${reached.get(at).join(' > ')}`),
  ];
}

/**
 * A synthetic lockfile in v9's form, in the shape D-104 was decided on:
 * apps/mobile reaches braces through its test runner (jest, then micromatch),
 * and nothing else does. The server links the test kit, the root and the
 * packages link the shared config, and the app's react-native carries a peer
 * suffix with an `@` in it, the form that reads as an alias if the suffix is
 * not stripped first.
 */
const REACH_SAMPLE_LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true

importers:

  .:
    devDependencies:
      '@trygghverdag/config':
        specifier: workspace:*
        version: link:packages/config
      vitest:
        specifier: ^5.0.1
        version: 5.0.1

  apps/mobile:
    dependencies:
      react-native:
        specifier: 0.86.3
        version: 0.86.3(@babel/core@7.29.7)
    devDependencies:
      '@trygghverdag/config':
        specifier: workspace:*
        version: link:../../packages/config
      jest:
        specifier: ^29.7.0
        version: 29.7.0(@types/node@26.6.2)

  apps/server:
    dependencies:
      zod:
        specifier: ^4.6.5
        version: 4.6.5
    devDependencies:
      '@trygghverdag/test-kit':
        specifier: workspace:*
        version: link:../../packages/test-kit

  packages/config:
    dependencies:
      globals:
        specifier: ^17.12.0
        version: 17.12.0

  packages/test-kit:
    dependencies:
      fast-check:
        specifier: ^4.10.2
        version: 4.10.2
    devDependencies:
      '@trygghverdag/config':
        specifier: workspace:*
        version: link:../config

packages:

  '@babel/core@7.29.7':
    resolution: {integrity: sha512-synthetic}

  '@types/node@26.6.2':
    resolution: {integrity: sha512-synthetic}

  braces@3.0.3:
    resolution: {integrity: sha512-synthetic}

  fast-check@4.10.2:
    resolution: {integrity: sha512-synthetic}

  fill-range@7.1.1:
    resolution: {integrity: sha512-synthetic}

  globals@17.12.0:
    resolution: {integrity: sha512-synthetic}

  jest-message-util@29.7.0:
    resolution: {integrity: sha512-synthetic}

  jest@29.7.0:
    resolution: {integrity: sha512-synthetic}
    peerDependencies:
      node-notifier: ^8.0.1

  micromatch@4.0.8:
    resolution: {integrity: sha512-synthetic}

  picomatch@2.3.2:
    resolution: {integrity: sha512-synthetic}

  react-native@0.86.3:
    resolution: {integrity: sha512-synthetic}
    peerDependencies:
      '@babel/core': '*'

  vitest@5.0.1:
    resolution: {integrity: sha512-synthetic}

  zod@4.6.5:
    resolution: {integrity: sha512-synthetic}

snapshots:

  '@babel/core@7.29.7': {}

  '@types/node@26.6.2': {}

  braces@3.0.3:
    dependencies:
      fill-range: 7.1.1

  fast-check@4.10.2: {}

  fill-range@7.1.1: {}

  globals@17.12.0: {}

  jest-message-util@29.7.0:
    dependencies:
      micromatch: 4.0.8

  jest@29.7.0(@types/node@26.6.2):
    dependencies:
      '@types/node': 26.6.2
      jest-message-util: 29.7.0
      micromatch: 4.0.8
    transitivePeerDependencies:
      - node-notifier

  micromatch@4.0.8:
    dependencies:
      braces: 3.0.3
      picomatch: 2.3.2

  picomatch@2.3.2: {}

  react-native@0.86.3(@babel/core@7.29.7):
    dependencies:
      '@babel/core': 7.29.7

  vitest@5.0.1: {}

  zod@4.6.5: {}
`;

const D104_REACH_CHANGED =
  'D-104\'s "Only apps/mobile reaches braces" no longer holds: decide again, or remove the ignore';

// --- What fixes source-map-js ------------------------------------------------

/** The advisory BUG-23 fixes: source-map-js's, before 1.2.2. */
const SOURCE_MAP_ADVISORY = 'GHSA-68fv-2mgg-jv7q';

/** The first source-map-js GHSA-68fv-2mgg-jv7q does not cover: 1.2.2, as [major, minor, patch]. */
const SOURCE_MAP_FIXED = [1, 2, 2];

/**
 * Where a source-map-js version stands against 1.2.2, the one that fixes
 * GHSA-68fv-2mgg-jv7q: 'below' (1.2.2's own pre-releases included, as semver
 * orders them), 'fixed', or 'unplaced' when it is not plain semver (a git or
 * tarball source) and cannot be compared.
 */
function againstSourceMapFix(version) {
  const parts = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (parts === null) return 'unplaced';
  const numbers = parts.slice(1, 4).map(Number);
  const first = numbers.findIndex((n, i) => n !== SOURCE_MAP_FIXED[i]);
  if (first !== -1) return numbers[first] < SOURCE_MAP_FIXED[first] ? 'below' : 'fixed';
  return parts[4] === undefined ? 'fixed' : 'below';
}

/**
 * How the lockfile falls short of BUG-23's fix; empty when every source-map-js
 * it resolves, by a `packages` or a `snapshots` key, is 1.2.2 or later. A
 * version that cannot be placed counts against it: one this check cannot
 * compare is one it cannot call fixed.
 */
function sourceMapUnfixed(lock) {
  const fixed = SOURCE_MAP_FIXED.join('.');
  const versions = lockedVersions(lock, 'source-map-js');
  const below = versions.filter((v) => againstSourceMapFix(v) === 'below');
  const unplaced = versions.filter((v) => againstSourceMapFix(v) === 'unplaced');
  const unfixed = [];
  if (below.length > 0) {
    unfixed.push(
      `source-map-js ${below.join(', ')} is locked, below ${fixed}, the version that fixes ${SOURCE_MAP_ADVISORY}`,
    );
  }
  if (unplaced.length > 0) {
    unfixed.push(
      `source-map-js ${unplaced.join(', ')} is locked, a version that cannot be compared with ${fixed}`,
    );
  }
  return unfixed;
}

/**
 * A synthetic lockfile in v9's form, as BUG-23's fix leaves it: the override in
 * the form pnpm 10.33.0 writes it (read from a scratch install, 2026-10-06),
 * and source-map-js 1.2.2 through both of today's paths, magicast under the
 * coverage tool and postcss, reached here from vitest.
 */
const SOURCE_MAP_SAMPLE_LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

overrides:
  source-map-js@<1.2.2: 1.2.2

importers:

  .:
    devDependencies:
      '@vitest/coverage-v8':
        specifier: ^5.0.1
        version: 5.0.1(vitest@5.0.1)
      vitest:
        specifier: ^5.0.1
        version: 5.0.1

packages:

  '@vitest/coverage-v8@5.0.1':
    resolution: {integrity: sha512-synthetic}
    peerDependencies:
      vitest: 5.0.1

  magicast@0.5.5:
    resolution: {integrity: sha512-synthetic}

  postcss@8.5.28:
    resolution: {integrity: sha512-synthetic}

  source-map-js@1.2.2:
    resolution: {integrity: sha512-synthetic}
    engines: {node: '>=0.10.0'}

  vitest@5.0.1:
    resolution: {integrity: sha512-synthetic}

snapshots:

  '@vitest/coverage-v8@5.0.1(vitest@5.0.1)':
    dependencies:
      magicast: 0.5.5
      vitest: 5.0.1

  magicast@0.5.5:
    dependencies:
      source-map-js: 1.2.2

  postcss@8.5.28:
    dependencies:
      source-map-js: 1.2.2

  source-map-js@1.2.2: {}

  vitest@5.0.1:
    dependencies:
      postcss: 8.5.28
`;

const SOURCE_MAP_UNFIXED =
  'the lockfile resolves a source-map-js below 1.2.2: GHSA-68fv-2mgg-jv7q fails the audit on every pull request';

describe('the dependency audit ignores what the owner accepted, and nothing else', () => {
  test('BUG-11: GHSA-86w9-cpqp-85rv is ignored by the dependency audit', () => {
    expect(
      auditConfig?.ignoreGhsas,
      "the root package.json's pnpm.auditConfig.ignoreGhsas does not list the accepted advisory",
    ).toEqual(expect.arrayContaining([ACCEPTED_ADVISORY]));
  });

  test('BUG-15: GHSA-vfj7-8cjw-p6xm is ignored by the dependency audit', () => {
    expect(
      auditConfig?.ignoreGhsas,
      "the root package.json's pnpm.auditConfig.ignoreGhsas does not list D-104's accepted advisory",
    ).toEqual(expect.arrayContaining([BRACES_ADVISORY]));
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

  test('BUG-15: the audit ignores exactly the two accepted advisories, each named by its own decision (D-093, D-104)', () => {
    // Sorted, because pnpm reads the list as a set; a duplicate still shows,
    // as a longer list. A third advisory, even one an owner's decision names,
    // fails here until the ID is added to DECIDED_IGNORES, beside which its
    // premise test belongs.
    expect(
      [...(auditConfig?.ignoreGhsas ?? [])].sort(),
      "pnpm.auditConfig.ignoreGhsas is not exactly D-093's and D-104's advisories",
    ).toEqual([...DECIDED_IGNORES.keys()].sort());

    const entries = decisionEntries(decisionLog);
    for (const [advisory, decision] of DECIDED_IGNORES) {
      expect(
        acceptingDecisions(entries, advisory),
        `${advisory} is not named by ${decision} with the owner's acceptance`,
      ).toContain(decision);
    }
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

  test("BUG-15: D-104's premise holds in the lockfile: braces comes only through micromatch, at a version the advisory covers", () => {
    const lock = readLockfile(read('pnpm-lock.yaml'));

    expect(
      lock.lockfileVersion,
      'pnpm-lock.yaml is not lockfile v9, the form this reader knows',
    ).toMatch(/^9\./);
    // The reader found the workspace packages and what they depend on, so "no
    // workspace package depends on braces" is read, not assumed.
    expect(
      dependentsOf(lock, 'expo').importers,
      'the lockfile reader did not find apps/mobile depending on expo',
    ).toContain('apps/mobile');
    expect(bracesPremiseChanges(lock), D104_PREMISE_CHANGED).toEqual([]);
  });

  test("BUG-15: the lockfile check fails on each way D-104's premise can change", () => {
    const sample = readLockfile(BRACES_SAMPLE_LOCK);
    expect(sample.lockfileVersion).toBe('9.0');
    expect(dependentsOf(sample, '@synthetic/test-runner').importers).toEqual(['apps/mobile']);
    expect(dependentsOf(sample, 'braces')).toEqual({ packages: D104_DEPENDENTS, importers: [] });
    expect(lockedVersions(sample, 'braces')).toEqual(['3.0.3']);
    expect(bracesPremiseChanges(sample)).toEqual([]);

    // A patched version reaches the lockfile: in place of 3.0.3, or beside it
    // through a second micromatch. Every locked braces must be in range, not
    // just one; and a second micromatch is still micromatch.
    const patched = edited(
      BRACES_SAMPLE_LOCK,
      ['braces@3.0.3', 'braces@3.0.4'],
      ['braces: 3.0.3', 'braces: 3.0.4'],
    );
    const patchedBeside = edited(BRACES_SAMPLE_LOCK, [
      '  fill-range@7.1.1: {}\n',
      '  braces@3.0.4:\n    dependencies:\n      fill-range: 7.1.1\n\n  fill-range@7.1.1: {}\n\n  micromatch@4.0.9:\n    dependencies:\n      braces: 3.0.4\n',
    ]);
    for (const text of [patched, patchedBeside]) {
      expect(bracesPremiseChanges(readLockfile(text))).toEqual([
        "braces 3.0.4 is locked, outside the advisory's range (through 3.0.3)",
      ]);
    }
    expect(lockedVersions(readLockfile(patchedBeside), 'braces')).toEqual(['3.0.3', '3.0.4']);
    expect(['0.1.0', '2.3.2', '3.0.0', '3.0.3-rc.1', '3.0.3'].filter(inBracesRange)).toEqual([
      '0.1.0',
      '2.3.2',
      '3.0.0',
      '3.0.3-rc.1',
      '3.0.3',
    ]);
    expect(
      ['3.0.4', '3.0.4-rc.1', '3.0.10', '3.1.0', '4.0.0', 'github:synthetic/braces'].filter(
        inBracesRange,
      ),
    ).toEqual([]);

    // micromatch stops depending on braces, and braces leaves the lockfile.
    const dropped = edited(
      BRACES_SAMPLE_LOCK,
      ['      braces: 3.0.3\n', ''],
      [
        "  braces@3.0.3:\n    resolution: {integrity: sha512-synthetic}\n    engines: {node: '>=8'}\n\n",
        '',
      ],
      ['  braces@3.0.3:\n    dependencies:\n      fill-range: 7.1.1\n\n', ''],
    );
    expect(bracesPremiseChanges(readLockfile(dropped))).toEqual([
      'the packages that depend on braces are [], not [micromatch]',
      'braces is not in the lockfile',
    ]);

    // Another package depends on braces: directly, through an alias, or as optional.
    const directly = edited(BRACES_SAMPLE_LOCK, [
      '      micromatch: 4.0.8\n',
      '      braces: 3.0.3\n      micromatch: 4.0.8\n',
    ]);
    const throughAlias = edited(BRACES_SAMPLE_LOCK, [
      'string-width-cjs: string-width@4.2.3',
      'expand: braces@3.0.3',
    ]);
    const asOptional = edited(BRACES_SAMPLE_LOCK, ['fsevents: 2.3.3', 'braces: 3.0.3']);
    expect(bracesPremiseChanges(readLockfile(directly))).toEqual([
      'the packages that depend on braces are [@synthetic/test-runner, micromatch], not [micromatch]',
    ]);
    for (const text of [throughAlias, asOptional]) {
      expect(bracesPremiseChanges(readLockfile(text))).toEqual([
        'the packages that depend on braces are [@synthetic/expander, micromatch], not [micromatch]',
      ]);
    }

    // A workspace package depends on braces directly: as a dependency, or as a
    // devDependency through an alias.
    const direct = edited(BRACES_SAMPLE_LOCK, [
      'zod:\n        specifier: ^4.6.5\n        version: 4.6.5',
      'braces:\n        specifier: ^3.0.3\n        version: 3.0.3',
    ]);
    expect(bracesPremiseChanges(readLockfile(direct))).toEqual([
      'workspace packages depend on braces directly: apps/server',
    ]);
    const directAlias = edited(BRACES_SAMPLE_LOCK, [
      "      '@synthetic/test-runner':\n        specifier: ^30.0.0\n        version: 30.0.0\n",
      "      '@synthetic/test-runner':\n        specifier: ^30.0.0\n        version: 30.0.0\n      expand:\n        specifier: npm:braces@^3.0.3\n        version: braces@3.0.3\n",
    ]);
    expect(bracesPremiseChanges(readLockfile(directAlias))).toEqual([
      'workspace packages depend on braces directly: apps/mobile',
    ]);
  });

  test('BUG-15: only apps/mobile reaches braces in the lockfile', () => {
    const lock = readLockfile(read('pnpm-lock.yaml'));

    expect(
      lock.lockfileVersion,
      'pnpm-lock.yaml is not lockfile v9, the form this reader knows',
    ).toMatch(/^9\./);
    // The walk reaches the server where the server does depend on something:
    // fast-check is the test kit's. And the reader found the link from
    // apps/server to packages/test-kit as an edge the walk follows. So "the
    // server does not reach braces" is walked, not assumed. The edge is checked
    // on its own, not as the walk's chain to fast-check: if apps/server ever
    // depends on fast-check directly, as the testing conventions recommend,
    // the shortest chain skips the test kit, and this test must not go red
    // over something that has nothing to do with braces.
    expect(
      [...importersReaching(lock, 'fast-check').keys()],
      'the walk did not reach apps/server and packages/test-kit from fast-check',
    ).toEqual(expect.arrayContaining(['apps/server', 'packages/test-kit']));
    expect(
      dependentsIndex(lock).get(importerNode('packages/test-kit')) ?? [],
      'the lockfile reader did not find the link from apps/server to packages/test-kit',
    ).toContain(importerNode('apps/server'));
    expect(bracesReachChanges(lock), D104_REACH_CHANGED).toEqual([]);
  });

  test('BUG-15: the walk to braces fails when the server or the root reaches it, through micromatch, jest-message-util, an alias, a link or a second braces', () => {
    // The shape D-104 was decided on: apps/mobile > jest > micromatch > braces.
    const sample = readLockfile(REACH_SAMPLE_LOCK);
    expect(sample.lockfileVersion).toBe('9.0');
    expect([...importersReaching(sample, 'braces')]).toEqual([
      [
        'apps/mobile',
        ['apps/mobile', 'jest@29.7.0(@types/node@26.6.2)', 'micromatch@4.0.8', 'braces@3.0.3'],
      ],
    ]);
    expect(bracesReachChanges(sample)).toEqual([]);
    // The premise test above passes on every case below: braces' only
    // dependent stays micromatch, and no importer depends on braces directly.
    expect(bracesPremiseChanges(sample)).toEqual([]);

    // A peer suffix with an `@` in it is not an alias; an alias is.
    expect(snapshotKey({ name: 'react-native', version: '0.86.3(@babel/core@7.29.7)' })).toBe(
      'react-native@0.86.3(@babel/core@7.29.7)',
    );
    expect(snapshotKey({ name: 'glob-match', version: 'micromatch@4.0.8' })).toBe(
      'micromatch@4.0.8',
    );
    expect(snapshotKey({ name: '@scope/x', version: '1.0.0(@scope/y@2.0.0)' })).toBe(
      '@scope/x@1.0.0(@scope/y@2.0.0)',
    );
    // A link is relative to the importer that names it.
    expect(linkedImporter('.', 'link:packages/config')).toBe('packages/config');
    expect(linkedImporter('apps/server', 'link:../../packages/test-kit')).toBe('packages/test-kit');
    expect(linkedImporter('packages/test-kit', 'link:../config')).toBe('packages/config');

    const serverDev =
      "      '@trygghverdag/test-kit':\n        specifier: workspace:*\n        version: link:../../packages/test-kit\n";
    const serverDeps = '      zod:\n        specifier: ^4.6.5\n        version: 4.6.5\n';
    const rootDev =
      "      '@trygghverdag/config':\n        specifier: workspace:*\n        version: link:packages/config\n";
    const testKitDeps = '      fast-check:\n        specifier: ^4.10.2\n        version: 4.10.2\n';
    const reachedBy = (text) => bracesReachChanges(readLockfile(text));

    // The server depends on micromatch, as a dependency.
    const serverMicromatch = edited(REACH_SAMPLE_LOCK, [
      `  apps/server:\n    dependencies:\n${serverDeps}`,
      `  apps/server:\n    dependencies:\n      micromatch:\n        specifier: ^4.0.8\n        version: 4.0.8\n${serverDeps}`,
    ]);
    expect(reachedBy(serverMicromatch)).toEqual([
      'the workspace packages that reach braces are [apps/mobile, apps/server], not [apps/mobile]',
      'apps/server reaches braces: apps/server > micromatch@4.0.8 > braces@3.0.3',
    ]);

    // The server depends on jest-message-util, which reaches micromatch: as a
    // dev dependency, which counts as much as any other.
    const serverJestMessageUtil = edited(REACH_SAMPLE_LOCK, [
      serverDev,
      `${serverDev}      jest-message-util:\n        specifier: ^29.7.0\n        version: 29.7.0\n`,
    ]);
    expect(reachedBy(serverJestMessageUtil)).toEqual([
      'the workspace packages that reach braces are [apps/mobile, apps/server], not [apps/mobile]',
      'apps/server reaches braces: apps/server > jest-message-util@29.7.0 > micromatch@4.0.8 > braces@3.0.3',
    ]);

    // The server reaches micromatch through an alias, as an optional dependency.
    const serverAlias = edited(REACH_SAMPLE_LOCK, [
      serverDev,
      `${serverDev}    optionalDependencies:\n      glob-match:\n        specifier: npm:micromatch@^4.0.8\n        version: micromatch@4.0.8\n`,
    ]);
    expect(reachedBy(serverAlias)).toEqual([
      'the workspace packages that reach braces are [apps/mobile, apps/server], not [apps/mobile]',
      'apps/server reaches braces: apps/server > micromatch@4.0.8 > braces@3.0.3',
    ]);

    // The root depends on micromatch.
    const rootMicromatch = edited(REACH_SAMPLE_LOCK, [
      rootDev,
      `${rootDev}      micromatch:\n        specifier: ^4.0.8\n        version: 4.0.8\n`,
    ]);
    expect(reachedBy(rootMicromatch)).toEqual([
      'the workspace packages that reach braces are [., apps/mobile], not [apps/mobile]',
      '. reaches braces: . > micromatch@4.0.8 > braces@3.0.3',
    ]);

    // The server links an importer that reaches braces: the app itself, so
    // only the link shows it.
    const serverLinksMobile = edited(REACH_SAMPLE_LOCK, [
      serverDev,
      `${serverDev}      '@trygghverdag/mobile':\n        specifier: workspace:*\n        version: link:../mobile\n`,
    ]);
    expect(reachedBy(serverLinksMobile)).toEqual([
      'the workspace packages that reach braces are [apps/mobile, apps/server], not [apps/mobile]',
      'apps/server reaches braces: apps/server > apps/mobile > jest@29.7.0(@types/node@26.6.2) > micromatch@4.0.8 > braces@3.0.3',
    ]);

    // The test kit depends on micromatch, and the server links the test kit.
    const testKitMicromatch = edited(REACH_SAMPLE_LOCK, [
      testKitDeps,
      `${testKitDeps}      micromatch:\n        specifier: ^4.0.8\n        version: 4.0.8\n`,
    ]);
    expect(reachedBy(testKitMicromatch)).toEqual([
      'the workspace packages that reach braces are [apps/mobile, apps/server, packages/test-kit], not [apps/mobile]',
      'apps/server reaches braces: apps/server > packages/test-kit > micromatch@4.0.8 > braces@3.0.3',
      'packages/test-kit reaches braces: packages/test-kit > micromatch@4.0.8 > braces@3.0.3',
    ]);

    // A second braces, inside the advisory's range, that only the server
    // reaches, through a second micromatch. Its key comes after braces@3.0.3,
    // in the order pnpm writes keys (by code unit, so a pre-release of 3.0.3
    // follows 3.0.3), so a walk that started from the first locked braces
    // alone would find only apps/mobile and pass. "Upward from every locked
    // braces" is what catches it.
    const secondBraces = edited(
      REACH_SAMPLE_LOCK,
      [
        `  apps/server:\n    dependencies:\n${serverDeps}`,
        `  apps/server:\n    dependencies:\n      micromatch:\n        specifier: 4.0.7\n        version: 4.0.7\n${serverDeps}`,
      ],
      [
        '  braces@3.0.3:\n    resolution: {integrity: sha512-synthetic}\n',
        '  braces@3.0.3:\n    resolution: {integrity: sha512-synthetic}\n\n  braces@3.0.3-rc.1:\n    resolution: {integrity: sha512-synthetic}\n',
      ],
      [
        '  micromatch@4.0.8:\n    resolution: {integrity: sha512-synthetic}\n',
        '  micromatch@4.0.7:\n    resolution: {integrity: sha512-synthetic}\n\n  micromatch@4.0.8:\n    resolution: {integrity: sha512-synthetic}\n',
      ],
      [
        '  braces@3.0.3:\n    dependencies:\n      fill-range: 7.1.1\n',
        '  braces@3.0.3:\n    dependencies:\n      fill-range: 7.1.1\n\n  braces@3.0.3-rc.1:\n    dependencies:\n      fill-range: 7.1.1\n',
      ],
      [
        '  micromatch@4.0.8:\n    dependencies:\n',
        '  micromatch@4.0.7:\n    dependencies:\n      braces: 3.0.3-rc.1\n      picomatch: 2.3.2\n\n  micromatch@4.0.8:\n    dependencies:\n',
      ],
    );
    const secondLock = readLockfile(secondBraces);
    // The sample is what it says: two braces, both in range, the server's after
    // the app's, and the app reaching only the first.
    expect(lockedVersions(secondLock, 'braces')).toEqual(['3.0.3', '3.0.3-rc.1']);
    expect(lockedVersions(secondLock, 'braces').every(inBracesRange)).toBe(true);
    expect([...secondLock.snapshots.keys()].filter((key) => packageName(key) === 'braces')).toEqual(
      ['braces@3.0.3', 'braces@3.0.3-rc.1'],
    );
    expect(importersReaching(secondLock, 'braces').get('apps/mobile')).toEqual([
      'apps/mobile',
      'jest@29.7.0(@types/node@26.6.2)',
      'micromatch@4.0.8',
      'braces@3.0.3',
    ]);
    expect(reachedBy(secondBraces)).toEqual([
      'the workspace packages that reach braces are [apps/mobile, apps/server], not [apps/mobile]',
      'apps/server reaches braces: apps/server > micromatch@4.0.7 > braces@3.0.3-rc.1',
    ]);

    // The premise test passes on every one of these; only the walk sees them.
    for (const text of [
      serverMicromatch,
      serverJestMessageUtil,
      serverAlias,
      rootMicromatch,
      serverLinksMobile,
      testKitMicromatch,
      secondBraces,
    ]) {
      expect(bracesPremiseChanges(readLockfile(text))).toEqual([]);
    }

    // The app no longer reaches braces: "exactly apps/mobile" fails too.
    const mobileWithout = edited(REACH_SAMPLE_LOCK, [
      '      jest-message-util: 29.7.0\n      micromatch: 4.0.8\n',
      '      jest-message-util: 29.7.0\n',
    ]);
    const unreached = edited(mobileWithout, [
      '  jest-message-util@29.7.0:\n    dependencies:\n      micromatch: 4.0.8\n',
      '  jest-message-util@29.7.0: {}\n',
    ]);
    expect(reachedBy(unreached)).toEqual([
      'the workspace packages that reach braces are [], not [apps/mobile]',
    ]);

    // A dependency the walk cannot place throws, instead of reading as
    // "nothing reaches it this way": one that resolves to no snapshot, and a
    // link to no importer.
    const unplaced = edited(REACH_SAMPLE_LOCK, [
      '      jest-message-util: 29.7.0\n      micromatch: 4.0.8\n',
      '      jest-message-util: 29.7.0\n      micromatch: 4.0.9\n',
    ]);
    expect(() => importersReaching(readLockfile(unplaced), 'braces')).toThrow(
      /jest@29\.7\.0\(@types\/node@26\.6\.2\) depends on micromatch: 4\.0\.9, which resolves to no snapshot/,
    );
    const noVersion = edited(REACH_SAMPLE_LOCK, [
      serverDeps,
      '      zod:\n        specifier: ^4.6.5\n',
    ]);
    expect(() => importersReaching(readLockfile(noVersion), 'braces')).toThrow(
      /importer apps\/server depends on zod: \(no version\), which resolves to no snapshot/,
    );
    const linkNowhere = edited(REACH_SAMPLE_LOCK, [
      'version: link:../../packages/test-kit',
      'version: link:../../packages/testkit',
    ]);
    expect(() => importersReaching(readLockfile(linkNowhere), 'braces')).toThrow(
      /importer apps\/server links @trygghverdag\/test-kit to packages\/testkit, which is no importer/,
    );
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

describe('the dependency audit passes on a patched version where there is one, not on an ignore', () => {
  test('BUG-23: the lockfile holds no source-map-js below 1.2.2, the version that fixes GHSA-68fv-2mgg-jv7q', () => {
    const lock = readLockfile(read('pnpm-lock.yaml'));

    expect(
      lock.lockfileVersion,
      'pnpm-lock.yaml is not lockfile v9, the form this reader knows',
    ).toMatch(/^9\./);
    // The reader found keys in both sections, so "none below 1.2.2" is read,
    // not assumed: vitest, the runner of this very file, is locked in each.
    expect(
      lock.packages.filter((key) => packageName(key) === 'vitest'),
      'the lockfile reader found no vitest among the packages keys',
    ).not.toEqual([]);
    expect(
      [...lock.snapshots.keys()].filter((key) => packageName(key) === 'vitest'),
      'the lockfile reader found no vitest among the snapshots keys',
    ).not.toEqual([]);
    expect(sourceMapUnfixed(lock), SOURCE_MAP_UNFIXED).toEqual([]);
  });

  test('BUG-23: the source-map-js check fails on a lockfile holding 1.2.1, in either section, and passes on one holding only 1.2.2', () => {
    // The fixed form passes, and the override's `source-map-js@<1.2.2` is not
    // read as a version.
    const sample = readLockfile(SOURCE_MAP_SAMPLE_LOCK);
    expect(sample.lockfileVersion).toBe('9.0');
    expect(lockedVersions(sample, 'source-map-js')).toEqual(['1.2.2']);
    expect(sourceMapUnfixed(sample)).toEqual([]);

    // Today's lockfile: 1.2.1 on both paths, and no override.
    const unfixed = edited(
      SOURCE_MAP_SAMPLE_LOCK,
      ['overrides:\n  source-map-js@<1.2.2: 1.2.2\n\n', ''],
      ['source-map-js@1.2.2', 'source-map-js@1.2.1'],
      ['source-map-js: 1.2.2', 'source-map-js: 1.2.1'],
    );
    expect(sourceMapUnfixed(readLockfile(unfixed))).toEqual([
      'source-map-js 1.2.1 is locked, below 1.2.2, the version that fixes GHSA-68fv-2mgg-jv7q',
    ]);

    // 1.2.1 beside 1.2.2: one path fixed, magicast's not. Every locked
    // source-map-js must be fixed, not just one.
    const beside = edited(
      SOURCE_MAP_SAMPLE_LOCK,
      [
        '  magicast@0.5.5:\n    dependencies:\n      source-map-js: 1.2.2\n',
        '  magicast@0.5.5:\n    dependencies:\n      source-map-js: 1.2.1\n',
      ],
      [
        '  source-map-js@1.2.2:\n    resolution:',
        "  source-map-js@1.2.1:\n    resolution: {integrity: sha512-synthetic}\n    engines: {node: '>=0.10.0'}\n\n  source-map-js@1.2.2:\n    resolution:",
      ],
      ['  source-map-js@1.2.2: {}\n', '  source-map-js@1.2.1: {}\n\n  source-map-js@1.2.2: {}\n'],
    );
    expect(lockedVersions(readLockfile(beside), 'source-map-js')).toEqual(['1.2.1', '1.2.2']);
    expect(sourceMapUnfixed(readLockfile(beside))).toEqual([
      'source-map-js 1.2.1 is locked, below 1.2.2, the version that fixes GHSA-68fv-2mgg-jv7q',
    ]);

    // Each section is read on its own: 1.2.1 in only the packages keys, or
    // only the snapshots keys, still fails.
    const inPackages = edited(SOURCE_MAP_SAMPLE_LOCK, [
      '  source-map-js@1.2.2:\n    resolution:',
      '  source-map-js@1.2.1:\n    resolution:',
    ]);
    const inSnapshots = edited(SOURCE_MAP_SAMPLE_LOCK, [
      '  source-map-js@1.2.2: {}\n',
      '  source-map-js@1.2.1: {}\n',
    ]);
    for (const text of [inPackages, inSnapshots]) {
      expect(sourceMapUnfixed(readLockfile(text))).toEqual([
        'source-map-js 1.2.1 is locked, below 1.2.2, the version that fixes GHSA-68fv-2mgg-jv7q',
      ]);
    }

    // A source that is not plain semver cannot be called fixed.
    const tarball = edited(SOURCE_MAP_SAMPLE_LOCK, [
      '  source-map-js@1.2.2: {}\n',
      '  source-map-js@1.2.2: {}\n\n  source-map-js@https://example.invalid/source-map-js-1.2.2.tgz: {}\n',
    ]);
    expect(sourceMapUnfixed(readLockfile(tarball))).toEqual([
      'source-map-js https://example.invalid/source-map-js-1.2.2.tgz is locked, a version that cannot be compared with 1.2.2',
    ]);

    // Where the line falls: below 1.2.2, its pre-releases included; at or above it.
    const below = ['0.6.2', '1.0.0', '1.2.0', '1.2.1', '1.2.1+build.7', '1.2.2-beta.0'];
    const fixed = ['1.2.2', '1.2.2+build.7', '1.2.3', '1.2.10', '1.3.0', '1.10.0', '2.0.0'];
    expect(below.map(againstSourceMapFix)).toEqual(below.map(() => 'below'));
    expect(fixed.map(againstSourceMapFix)).toEqual(fixed.map(() => 'fixed'));
    expect(['github:synthetic/source-map-js', '1.2', ''].map(againstSourceMapFix)).toEqual([
      'unplaced',
      'unplaced',
      'unplaced',
    ]);
  });
});
