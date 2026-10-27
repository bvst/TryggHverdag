/**
 * BUG-68: CI's installs run no install script.
 *
 * Every job in ci.yml that runs a check after an install runs
 * `pnpm install --frozen-lockfile` first. pnpm 10.33.0 runs each workspace
 * project's own install scripts during that install, the root's included. A
 * script there runs with the job's checkout and environment before the job's
 * checks: it can rewrite the root .npmrc (BUG-66's route to a silent audit),
 * write to `$GITHUB_ENV`, or change the shell every later `pnpm run` gets
 * (BUG-69's route). The checks of the checked-in files never see what it did.
 * Reproduced in a minimal pnpm 10.33.0 workspace: a workspace package's
 * `postinstall` ran during `pnpm install --frozen-lockfile`, and with
 * `--ignore-scripts` it did not. #105 made all five workspace package.json
 * files owned (D-144) and named the five packages in pnpm-workspace.yaml, so
 * adding a script needs the owner's review. This is CI's own defence, and
 * privacy-security-reviewer's S1 on #105 asked for it on every install before
 * a required check, not on the `security` job's alone.
 *
 * Test names carry no <ID>-ACn: prefix: a bug's tests are named BUG-<n>, and
 * BUG- is not a requirement prefix req:coverage collects.
 *
 * Pinned:
 *   - every `pnpm install` (or `pnpm i`, `pnpm add`, `pnpm install-test`,
 *     `pnpm it`) in ci.yml carries `--ignore-scripts` on that same command,
 *     spelled that way, with no `false` after it and no other spelling of the
 *     setting beside it. pnpm is pnpm however it is called: a path to it,
 *     `pnpm@<version>`, its `pnpm.cjs`, and behind `npx`, `corepack`,
 *     `pnpm dlx` or `node` (`PNPM_WORD`). ci.yml is read as GitHub decodes
 *     it, every string in it and not only `run:` (android-emulator-runner's
 *     `with: script:` is a shell command too), and each string as a rough
 *     shell reading splits it: a comment dropped from a `#` that starts a word
 *     outside quotes, lines joined at a trailing backslash, commands split at
 *     `;`, `&`, `|`, `&&`, `||`, parentheses, backticks, `<` and `>`, and a
 *     `${{ … }}` expression read as one word, which GitHub fills in before the
 *     shell runs. It is not a shell: what it does not split on, or a command
 *     the shell assembles, it does not see (below);
 *   - a second, plain reading of ci.yml's lines, with no YAML parser and its
 *     own cruder comment rule, finds as many lines that say `pnpm install` or
 *     `pnpm i` as the decoded reading finds installs, and each is a line the
 *     decoded reading found. That catches a part of the file the YAML walk
 *     misses, or a reading that finds nothing; the two share the separators,
 *     so a form neither splits on is missed by both;
 *   - no pnpm/action-setup step in ci.yml sets `run_install` to anything but
 *     `false` (privacy-security-reviewer's N2 on #106): the action can run
 *     `pnpm install` itself, with scripts on (`actionSetupSteps`);
 *   - no workspace package's package.json (each folder pnpm-workspace.yaml
 *     names; today apps/mobile, apps/server, packages/config,
 *     packages/contracts and packages/test-kit) holds a script named in
 *     `INSTALL_LIFECYCLE`, and none has a binding.gyp;
 *   - the root package.json holds no script named in `INSTALL_LIFECYCLE` but
 *     `prepare`, which is exactly `ROOT_PREPARE`; no `pnpm:devPreinstall`
 *     (`ROOT_INSTALL_HOOKS`); and the root has no binding.gyp.
 * Each check also runs on a copy with one script added, so a reading that
 * finds nothing cannot pass for one that found nothing to find.
 *
 * The workspace and root checks run after the install they are about, so in
 * CI they are a second line: with `--ignore-scripts` nothing they refuse runs
 * in ci.yml's jobs, and without it the script has run before this file does.
 * They hold the files for every install that is not CI's: a session's, the
 * owner's Mac, and the two workflows below.
 *
 * The root's `prepare` runs `git config core.hooksPath .githooks || true`. With
 * `--ignore-scripts` CI skips it, which is fine: it only points git at the
 * repository's local hooks, which no CI job uses. It is pinned to that text
 * because it still runs on every install without the flag, two of them in CI
 * (below).
 *
 * Not pinned:
 *   - `.github/workflows/ai-review.yml:180`, `pnpm install --frozen-lockfile`
 *     with no `--ignore-scripts`, before the review step that is given the
 *     Claude secrets. A change to ai-review.yml can only be merged by hand
 *     (D-075), so it goes in its own batch pull request, with Dependabot's
 *     #102. Until then the owned package.json files (D-144) and the two
 *     checks above stand in for it;
 *   - `.github/workflows/daily-status.yml:81`, the same install. It runs on a
 *     schedule, from `main`'s already-reviewed code, or when started by hand
 *     (`workflow_dispatch`); no pull request starts it;
 *   - any other workflow. deploy-staging.yml and infra-staging.yml run no
 *     `pnpm install` today, and one added there is not read here;
 *   - pnpm commands that install under another name (`update`, `dedupe`,
 *     `remove`, `link`, `import`), `pnpm rebuild` (which runs install scripts
 *     on purpose), and installs by npm or yarn, corepack's included (corepack
 *     running pnpm is read, above);
 *   - an install the shell builds while it runs (`$PNPM install`,
 *     `$(command -v pnpm) install`, `eval`), pnpm under another file name, a
 *     here-document or a quoted string the rough reading splits wrongly, or
 *     an install a repository script or an action other than
 *     pnpm/action-setup runs for the step: only the text of ci.yml is read;
 *   - pnpm/action-setup in another workflow, a composite action or a reusable
 *     workflow that wraps it, and an `INPUT_RUN_INSTALL` environment variable
 *     (whether the runner lets one override the input was not tried);
 *   - `npm_config_ignore_scripts` or an .npmrc `ignore-scripts` line: neither
 *     is read. pnpm gives the command-line option precedence: in the minimal
 *     workspace on 2026-10-27, with either set to `false`,
 *     `pnpm install --frozen-lockfile --ignore-scripts` still ran no script;
 *   - dependencies' own build scripts. pnpm 10 runs none unless a setting
 *     allows it (`onlyBuiltDependencies` and its kin), and `--ignore-scripts`
 *     stops them in CI; the root package.json's `pnpm` field is not read for
 *     those settings here;
 *   - a `pre<name>` or `post<name>` script that `pnpm run <name>` runs: not an
 *     install script, and `--ignore-scripts` on the install does not reach it;
 *   - the packages under spikes/background-safety/, which are outside the
 *     workspace, so the root install does not install them;
 *   - `prepublish` and `prepublishOnly` running on an install. The bundle
 *     names both (`INSTALL_LIFECYCLE`), and neither was seen to run in a
 *     minimal workspace's frozen install on 2026-10-27; they are refused here
 *     because the bundle names them, not because a run showed it.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

const ROOT = path.join(import.meta.dirname, '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

/**
 * The scripts pnpm 10.33.0 runs from a workspace project's package.json while
 * it installs, read on 2026-10-27 in its own bundle, `dist/pnpm.cjs` of the
 * pnpm 10.33.0 the root package.json's `packageManager` names (not another
 * version's):
 *   - `pkg-manager/headless`, the install `--frozen-lockfile` takes when the
 *     lockfile is up to date, and `pkg-manager/core`'s install each call
 *     `runLifecycleHooksConcurrently(["preinstall", "install", "postinstall",
 *     "preprepare", "prepare", "postprepare"], …)` over the projects they
 *     installed, the root among them, unless `ignoreScripts`;
 *   - headless's `extendProjectsWithTargetDirs` gives a project that another
 *     one injects the stages `["preinstall", "install", "postinstall",
 *     "prepare", "prepublishOnly"]` instead;
 *   - `installDeps`, after a non-recursive install with
 *     `linkWorkspacePackages`, calls `rebuildProjects` unless `ignoreScripts`,
 *     and that runs `["preinstall", "install", "postinstall", "prepublish",
 *     "prepare"]`.
 * A stage runs only the script of its own name: `runLifecycleHook` and
 * `@pnpm/npm-lifecycle` 1001.0.0 add no pre or post form, so `prepreinstall`
 * or `postpostinstall` never runs, and `preprepare` and `postprepare` run
 * because they are stages of their own. In a minimal pnpm 10.33.0 workspace
 * on 2026-10-27, `pnpm install --frozen-lockfile` ran a workspace package's
 * `preinstall`, `install`, `postinstall`, `preprepare`, `prepare` and
 * `postprepare`, and not its `prepublish`, `prepublishOnly`,
 * `prepreinstall`, `postpostinstall`, `preuninstall`, `prepack` or `postpack`;
 * with `--ignore-scripts` it ran none.
 */
const INSTALL_LIFECYCLE = [
  'preinstall',
  'install',
  'postinstall',
  'preprepare',
  'prepare',
  'postprepare',
  'prepublish',
  'prepublishOnly',
];

/**
 * The root project's own install hook, read in the same bundle: core's
 * install runs the root manifest's `pnpm:devPreinstall` (`DEV_PREINSTALL`)
 * before anything else, with `--frozen-lockfile` too, unless `ignoreScripts`.
 * In the minimal workspace it ran even when the frozen lockfile was then
 * refused as out of date.
 */
const ROOT_INSTALL_HOOKS = ['pnpm:devPreinstall'];

/**
 * The root's `prepare`, as it is today. It only points git at the
 * repository's hooks; anything else here runs on every install without the
 * flag, a session's and two of CI's (the header's "Not pinned").
 */
const ROOT_PREPARE = 'git config core.hooksPath .githooks || true';

/**
 * The pnpm commands that install the workspace from its manifests, and so run
 * its install scripts, by the names pnpm 10.33.0's bundle gives them
 * (`commandNames`): install's `install` and `i`, `add`, and install-test's
 * `install-test` and `it`, which installs and then runs `test`. Its `ci` and
 * kin throw "not implemented" in 10.33.0, and are not named.
 */
const INSTALL_COMMANDS = new Set(['install', 'i', 'add', 'install-test', 'it']);

/** The setting, spelled as the one form accepted. */
const IGNORE_SCRIPTS = '--ignore-scripts';

const made = [];
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh folder outside the repository, removed after the file's tests. */
function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'bug-68-'));
  made.push(dir);
  return dir;
}

/**
 * The `yaml` package, as Node resolves it for the root's own `vite`, the way
 * scripts/dependency-audit.test.mjs reaches it (`yamlLibrary` there, whose
 * comment says why): no workspace package depends on a YAML library, and
 * importing that test file would run its tests here too. If that peer ever
 * goes, these tests fail and say why, and nothing reads ci.yml as clean.
 */
const yamlLibrary = (() => {
  let loaded = null;
  return () => {
    if (loaded !== null) return loaded;
    try {
      const fromRoot = createRequire(path.join(ROOT, 'package.json'));
      loaded = createRequire(fromRoot.resolve('vite/package.json'))('yaml');
    } catch (error) {
      throw new Error(
        `BUG-68: no YAML parser resolves through the root's vite, so the workflows and pnpm-workspace.yaml cannot be read as GitHub and pnpm decode them, and are not called clean: ${error.message}`,
        { cause: error },
      );
    }
    return loaded;
  };
})();

// --- ci.yml's installs --------------------------------------------------------

/**
 * A YAML document, parsed, with a line counter for its nodes. A document that
 * does not parse cleanly is refused, never read as clean.
 */
function parsedYaml(file, text) {
  const { LineCounter, parseDocument } = yamlLibrary();
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines });
  const problems = [...doc.errors, ...doc.warnings];
  if (problems.length > 0) {
    throw new Error(
      `${file} is not read as clean: ${problems.map((p) => p.message.split('\n')[0]).join('; ')}`,
    );
  }
  return { doc, lines };
}

/**
 * Every string in a YAML document as a parser decodes it, key or value, at
 * every depth, each with the line its text starts on: the line after the
 * header for a block scalar (`|`, `>` and their kin), its own line otherwise.
 * A document that does not parse cleanly is refused, never read as clean.
 */
function decodedStrings(file, text) {
  const { visit } = yamlLibrary();
  const { doc, lines } = parsedYaml(file, text);
  const strings = [];
  visit(doc, {
    Scalar: (_, node) => {
      if (typeof node.value !== 'string') return;
      const at = lines.linePos(node.range?.[0] ?? 0).line;
      const block = node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED';
      strings.push({ text: node.value, line: block ? at + 1 : at });
    },
  });
  return strings;
}

/** A shell word with its quotes taken out: `"--ignore-scripts"` is `--ignore-scripts` to the shell. */
const unquoted = (word) => word.replace(/["']/g, '');

/**
 * A line without its shell comment: from a `#` that starts a word, outside
 * quotes, on. A `#` inside quotes (`echo "build #1"`) or inside a word (`$#`,
 * `a#b`) is text, as it is to the shell (test-auditor on #106, round 2: the
 * plain `(^|\s)#` dropped `echo "build #1" && pnpm install` whole).
 */
function withoutComment(line) {
  let quote = null;
  for (let at = 0; at < line.length; at += 1) {
    const char = line[at];
    if (quote !== null) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"') at += 1;
    } else if (char === '\\') {
      at += 1;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#' && (at === 0 || /[\s;&|()<>`]/.test(line[at - 1] ?? ''))) {
      return line.slice(0, at);
    }
  }
  return line;
}

/**
 * A string as the shell reads its commands: each `${{ … }}` one word, each
 * line's comment dropped (`withoutComment`), lines joined where what is left
 * ends in a backslash, and each line split into commands at `;`, `&`, `|`,
 * `&&`, `||`, parentheses, backticks and redirections (`<`, `>`), so
 * `$(pnpm install)` and `pnpm install>log` are commands of their own. Each
 * command is its words and the index of the line it starts on.
 */
function shellCommands(text) {
  const commands = [];
  let carried = null;
  let startedAt = 0;
  const lines = text.replace(/\$\{\{[\s\S]*?\}\}/g, 'GITHUB_EXPRESSION').split('\n');
  const take = (code, index) => {
    for (const part of code.split(/&&|\|\||[;&|()`<>]/)) {
      const words = part
        .trim()
        .split(/\s+/)
        .filter((word) => word !== '')
        .map(unquoted);
      if (words.length > 0) commands.push({ words, offset: index });
    }
  };
  lines.forEach((raw, index) => {
    if (carried === null) startedAt = index;
    const code = withoutComment(carried === null ? raw : `${carried} ${raw.trim()}`);
    if (/\\\s*$/.test(code)) {
      carried = code.replace(/\\\s*$/, '').trimEnd();
      return;
    }
    carried = null;
    take(code, startedAt);
  });
  if (carried !== null) take(carried, startedAt);
  return commands;
}

/**
 * Whether a command's words, from `pnpm` on, ask for an install with scripts
 * off: the word `--ignore-scripts` once at least, never followed by `false`
 * (pnpm's nopt 0.3.1 takes a `true` or `false` after a boolean option as its
 * value), and no other word naming the setting (`--no-ignore-scripts`,
 * `--ignore-scripts=…`, `--config.ignore-scripts…`), so the last one cannot
 * turn it back off. In the minimal workspace on 2026-10-27,
 * `--ignore-scripts false` and `--ignore-scripts --no-ignore-scripts` each
 * ran every install script.
 */
function ignoresScripts(words) {
  const flags = words.filter((word) => /ignore[-_]?scripts/i.test(word));
  return (
    flags.length > 0 &&
    flags.every((word) => word === IGNORE_SCRIPTS) &&
    words.every((word, index) => word !== IGNORE_SCRIPTS || words[index + 1] !== 'false')
  );
}

/**
 * A word that calls pnpm: `pnpm`, a path ending in it, pnpm with a version
 * (`pnpm@10.33.0`, as `npx` and `corepack` take one), or pnpm's own script run
 * by node (`…/pnpm/bin/pnpm.cjs`). What runs it (`npx`, `corepack`,
 * `pnpm dlx`, `node`) comes before it in the same command, so a command is
 * read from its first such word on (privacy-security-reviewer's N1 on #106:
 * `npx pnpm@10.33.0 install` got past `word === 'pnpm'`).
 */
const PNPM_WORD = /^(?:.*\/)?pnpm(?:@\S+|\.[cm]?js)?$/;

/**
 * Every pnpm install in a workflow: a command with a `PNPM_WORD` followed,
 * flags or not in between, by one of `INSTALL_COMMANDS` as a word of its own.
 * Each with where it is, the command from that word on, and whether it
 * ignores scripts.
 */
function installsIn(file, text) {
  return decodedStrings(file, text).flatMap(({ text: value, line }) =>
    shellCommands(value).flatMap(({ words, offset }) => {
      const at = words.findIndex((word) => PNPM_WORD.test(word));
      if (at === -1) return [];
      const own = words.slice(at);
      if (!own.slice(1).some((word) => INSTALL_COMMANDS.has(word))) return [];
      return [
        {
          where: `${file}:${line + offset}`,
          line: line + offset,
          command: own.join(' '),
          ignoresScripts: ignoresScripts(own),
        },
      ];
    }),
  );
}

/** The installs that would run scripts, as `file:line: command`. */
const withScripts = (installs) =>
  installs.filter((each) => !each.ignoresScripts).map((each) => `${each.where}: ${each.command}`);

/**
 * The lines of a workflow, outside a comment, that say `pnpm install` or
 * `pnpm i` in plain text (pnpm with a version, or its script, too), between
 * the same separators the shell reading splits at: read with no YAML parser
 * and its own cruder comment rule, `(^|\s)#`, as a check on the reading
 * above. It drops a line whose `#` is quoted before the install
 * (`echo "build #1" && pnpm install`), where the reading above does not, so
 * the two disagree there, and the count on ci.yml fails.
 */
function plainInstallLines(text) {
  return text
    .split('\n')
    .map((line, index) => ({ code: line.replace(/(^|\s)#.*$/, ''), number: index + 1 }))
    .filter(({ code }) =>
      /(?:^|[\s/"'(`;&|<>])pnpm(?:@\S+|\.[cm]?js)?\s+(?:install|i)(?=[\s"')`;&|<>]|$)/.test(code),
    )
    .map(({ number }) => number);
}

/**
 * Every step of a workflow that uses pnpm/action-setup, with its
 * `run_install` as decoded, or undefined when it sets none
 * (privacy-security-reviewer's N2 on #106). The action can install by itself:
 * the pinned v6.1.0 (`ea17c68`) parses `run_install` as YAML
 * (`src/inputs/run-install.ts`, read 2026-10-27), where `null`, its default,
 * and `false` install nothing, `true` runs `pnpm recursive install`, and an
 * object or a list runs `pnpm install` with its `args`, scripts on unless they
 * say otherwise. The action's owner and name are read without case, as GitHub
 * reads them, and so is the input's name; a `with:` an alias names is
 * followed, and one that is not a mapping is reported as such.
 */
function actionSetupSteps(file, text) {
  const { isAlias, isMap, isScalar, visit } = yamlLibrary();
  const { doc, lines } = parsedYaml(file, text);
  const resolved = (node) => (isAlias(node) ? node.resolve(doc) : node);
  const steps = [];
  visit(doc, {
    Map: (_, map) => {
      const uses = resolved(map.get('uses', true));
      if (!isScalar(uses) || !/^\s*pnpm\/action-setup@/i.test(String(uses.value))) return;
      const where = `${file}:${lines.linePos(uses.range?.[0] ?? 0).line}`;
      const inputs = resolved(map.get('with', true));
      if (inputs === undefined || inputs === null) {
        steps.push({ where, runInstall: undefined });
        return;
      }
      if (!isMap(inputs)) {
        steps.push({ where, runInstall: 'a `with:` that is not a mapping' });
        return;
      }
      const setting = inputs.items.find((pair) => {
        const key = resolved(pair.key);
        return isScalar(key) && String(key.value).toLowerCase() === 'run_install';
      });
      const value = setting === undefined ? undefined : resolved(setting.value);
      steps.push({
        where,
        runInstall: setting === undefined ? undefined : (value?.toJS?.(doc) ?? null),
      });
    },
  });
  return steps;
}

/**
 * The pnpm/action-setup steps that set `run_install` to anything but `false`,
 * as findings. Only `false` passes, written as a boolean or a string: GitHub
 * hands the action the text either way. `null` installs nothing too, but one
 * value is simpler to hold than the action's whole schema.
 */
const actionInstalls = (steps) =>
  steps
    .filter(
      ({ runInstall }) =>
        runInstall !== undefined && runInstall !== false && runInstall !== 'false',
    )
    .map(
      ({ where, runInstall }) =>
        `${where}: pnpm/action-setup's run_install is ${JSON.stringify(runInstall)}`,
    );

describe('BUG-68: every pnpm install in ci.yml runs with --ignore-scripts', () => {
  test('BUG-68: every pnpm install in ci.yml runs with --ignore-scripts, so no workspace package runs an install script before a job’s checks', () => {
    const text = readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    const installs = installsIn('ci.yml', text);

    expect(installs.length, 'pnpm installs the decoded reading finds in ci.yml').toBeGreaterThan(0);
    // Two readings, one count: every install in ci.yml is written on one
    // line, so the plain-text pass and the decoded one find as many (ten,
    // today), and a reading that finds nothing cannot agree with one that
    // finds them all.
    expect(
      plainInstallLines(text),
      'lines of ci.yml that say pnpm install or pnpm i, outside a comment, against the installs the decoded reading found',
    ).toHaveLength(installs.length);
    expect(
      plainInstallLines(text).filter((number) => !installs.some((each) => each.line === number)),
      'lines of ci.yml that say pnpm install or pnpm i, outside a comment, which the decoded reading did not find as an install',
    ).toEqual([]);
    expect(
      withScripts(installs),
      'pnpm installs in ci.yml without --ignore-scripts: each runs every workspace package’s preinstall, install, postinstall and prepare, and the root’s, before the job’s checks (BUG-68)',
    ).toEqual([]);
  });

  test('BUG-68: the reading finds an install however a step writes it, and passes one only with --ignore-scripts on that command', () => {
    const fixture = [
      'jobs:', // 1
      '  a:', // 2
      '    steps:', // 3
      '      - run: pnpm install --frozen-lockfile --ignore-scripts', // 4: passes
      '      - run: |', // 5
      '          set -euo pipefail', // 6
      '          # pnpm install in a shell comment', // 7: not a command
      '          pnpm i --frozen-lockfile', // 8: refused
      '      - run: >-', // 9
      '          pnpm install', // 10: refused, folded with the next line
      '          --frozen-lockfile', // 11
      '      - run: pnpm --dir . install --ignore-scripts', // 12: passes
      '      - run: echo --ignore-scripts && pnpm install', // 13: refused, the flag is another command's
      '      - run: pnpm install --ignore-scripts false', // 14: refused
      '      - run: pnpm install --ignore-scripts --no-ignore-scripts', // 15: refused
      '      - run: pnpm add -D left-pad --ignore-scripts', // 16: passes
      '      - run: pnpm it', // 17: refused
      '      - run: "pnpm install \\', // 18: refused, an escaped line break
      '          --frozen-lockfile"', // 19
      '      - uses: some/action@0000000000000000000000000000000000000000', // 20
      '        with:', // 21
      '          script: pnpm install --frozen-lockfile', // 22: refused, a script the action runs
      "      - run: pnpm install --filter ${{ inputs.only || 'a' }} --ignore-scripts", // 23: passes
      '      - run: |', // 24
      '          pnpm install \\', // 25: passes, joined at the backslash
      '            --frozen-lockfile \\', // 26
      '            --ignore-scripts', // 27
      "      - run: sh -c 'pnpm install'", // 28: refused
      '      - run: pnpm run test:unit && pnpm audit --audit-level high', // 29: no install
      '      - run: pnpm install --frozen-lockfile # --ignore-scripts', // 30: refused, the flag is a comment
      '      - run: version=$(pnpm install --frozen-lockfile)', // 31: refused, in a command substitution
      "      - run: '{ pnpm install --ignore-scripts; }'", // 32: passes, in a group
      '      - run: echo `pnpm i`', // 33: refused, in backticks
      // test-auditor on #106: row 30's ` # …` is a YAML comment, gone before
      // the shell reading sees it. In a block it is the shell's to drop.
      '      - run: |', // 34
      '          pnpm install --frozen-lockfile # --ignore-scripts', // 35: refused, the flag is a shell comment
      // privacy-security-reviewer's N1 on #106: pnpm called by another name.
      '      - run: npx pnpm@10.33.0 install --frozen-lockfile', // 36: refused
      '      - run: npx pnpm@10.33.0 install --frozen-lockfile --ignore-scripts', // 37: passes
      '      - run: npx pnpm install', // 38: refused
      '      - run: corepack pnpm install --frozen-lockfile', // 39: refused
      '      - run: pnpm dlx pnpm install', // 40: refused
      '      - run: /usr/local/bin/pnpm install', // 41: refused, a path to pnpm
      '      - run: node node_modules/pnpm/bin/pnpm.cjs install', // 42: refused, pnpm's script
      '      - run: pnpm install --frozen-lockfile \\', // 43: refused, a backslash ends the string
      // test-auditor on #106, round 2: a redirection and a quoted `#`.
      '      - run: pnpm install>log', // 44: refused
      '      - run: pnpm install<in', // 45: refused
      '      - run: pnpm install --ignore-scripts>log', // 46: passes
      '      - run: |', // 47
      '          echo "build #1" && pnpm install --frozen-lockfile', // 48: refused, the `#` is quoted
      '          echo "#1" # && pnpm install', // 49: not a command, a comment after a quoted `#`
      '',
    ].join('\n');

    const installs = installsIn('fixture.yml', fixture);

    expect(withScripts(installs)).toEqual([
      'fixture.yml:8: pnpm i --frozen-lockfile',
      'fixture.yml:10: pnpm install --frozen-lockfile',
      'fixture.yml:13: pnpm install',
      'fixture.yml:14: pnpm install --ignore-scripts false',
      'fixture.yml:15: pnpm install --ignore-scripts --no-ignore-scripts',
      'fixture.yml:17: pnpm it',
      'fixture.yml:18: pnpm install --frozen-lockfile',
      'fixture.yml:22: pnpm install --frozen-lockfile',
      'fixture.yml:28: pnpm install',
      'fixture.yml:30: pnpm install --frozen-lockfile',
      'fixture.yml:31: pnpm install --frozen-lockfile',
      'fixture.yml:33: pnpm i',
      'fixture.yml:35: pnpm install --frozen-lockfile',
      'fixture.yml:36: pnpm@10.33.0 install --frozen-lockfile',
      'fixture.yml:38: pnpm install',
      'fixture.yml:39: pnpm install --frozen-lockfile',
      'fixture.yml:40: pnpm dlx pnpm install',
      'fixture.yml:41: /usr/local/bin/pnpm install',
      'fixture.yml:42: node_modules/pnpm/bin/pnpm.cjs install',
      'fixture.yml:43: pnpm install --frozen-lockfile',
      'fixture.yml:44: pnpm install',
      'fixture.yml:45: pnpm install',
      'fixture.yml:48: pnpm install --frozen-lockfile',
    ]);
    expect(
      installs.filter((each) => each.ignoresScripts).map((each) => each.line),
      'the installs that pass',
    ).toEqual([4, 12, 16, 23, 25, 32, 37, 46]);
    // The plain-text check (test-auditor on #106): exactly the lines that say
    // pnpm install or pnpm i on one line, outside a comment. Not the shell
    // comment on line 7; not 12, 16 or 17, which name no install right after
    // pnpm; not 48, whose quoted `#` its cruder comment rule takes for one
    // (the reading above finds it); not 49; and each one a line the decoded
    // reading found.
    const plain = plainInstallLines(fixture);
    expect(plain).toEqual([
      4, 8, 10, 13, 14, 15, 18, 22, 23, 25, 28, 30, 31, 32, 33, 35, 36, 37, 38, 39, 40, 41, 42, 43,
      44, 45, 46,
    ]);
    expect(plain, 'the shell comment on line 7').not.toContain(7);
    expect(plain.filter((number) => !installs.some((each) => each.line === number))).toEqual([]);
    expect(() => installsIn('broken.yml', 'jobs:\n  a: [\n')).toThrow(
      /broken\.yml is not read as clean/,
    );
  });

  test('BUG-68: no pnpm/action-setup step in ci.yml runs an install of its own: its run_install is unset or false', () => {
    const text = readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
    const steps = actionSetupSteps('ci.yml', text);
    const plainly = text
      .split('\n')
      .filter((line) => /\bpnpm\/action-setup@/i.test(line.replace(/(^|\s)#.*$/, '')));

    expect(steps.length, 'pnpm/action-setup steps the decoded reading finds in ci.yml').toBe(
      plainly.length,
    );
    expect(steps.length).toBeGreaterThan(0);
    expect(
      actionInstalls(steps),
      'pnpm/action-setup steps in ci.yml whose run_install is not false: the action runs pnpm install itself, with scripts on (BUG-68)',
    ).toEqual([]);
  });

  test('BUG-68: the run_install check refuses every value but false, however the step writes it', () => {
    const fixture = [
      'jobs:', // 1
      '  a:', // 2
      '    steps:', // 3
      '      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0', // 4: passes, no with
      '      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413', // 5: passes
      '        with: { run_install: false }', // 6
      '      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413', // 7: passes
      '        with:', // 8
      "          run_install: 'false'", // 9
      '      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413', // 10: refused
      '        with:', // 11
      '          version: 10.33.0', // 12
      '          run_install: true', // 13
      '      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413', // 14: refused, args or not
      '        with:', // 15
      '          run_install: |', // 16
      '            - args: [--frozen-lockfile, --ignore-scripts]', // 17
      '      - uses: PNPM/Action-Setup@ea17c68df8912ef543352723c149a84f56e3d413', // 18: refused, the name in another case
      "        with: { run_install: 'true' }", // 19
      '      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413', // 20: refused, the input in another case
      '        with: { Run_Install: true }', // 21
      '      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413', // 22: refused
      '        with: &setup', // 23
      '          run_install: null', // 24
      '      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413', // 25: refused, the alias followed
      '        with: *setup', // 26
      '      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1', // 27: not pnpm/action-setup
      '        with: { run_install: true }', // 28
      '      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413', // 29: refused
      '        with:', // 30
      '          run_install: ${{ inputs.install }}', // 31
      '',
    ].join('\n');

    const steps = actionSetupSteps('fixture.yml', fixture);

    expect(steps.map((step) => step.where)).toEqual(
      [4, 5, 7, 10, 14, 18, 20, 22, 25, 29].map((line) => `fixture.yml:${line}`),
    );
    expect(actionInstalls(steps)).toEqual([
      "fixture.yml:10: pnpm/action-setup's run_install is true",
      `fixture.yml:14: pnpm/action-setup's run_install is ${JSON.stringify('- args: [--frozen-lockfile, --ignore-scripts]\n')}`,
      'fixture.yml:18: pnpm/action-setup\'s run_install is "true"',
      "fixture.yml:20: pnpm/action-setup's run_install is true",
      "fixture.yml:22: pnpm/action-setup's run_install is null",
      "fixture.yml:25: pnpm/action-setup's run_install is null",
      'fixture.yml:29: pnpm/action-setup\'s run_install is "${{ inputs.install }}"',
    ]);
    expect(
      actionInstalls(
        actionSetupSteps(
          'scalar.yml',
          'steps:\n  - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413\n    with: run_install\n',
        ),
      ),
    ).toEqual([
      'scalar.yml:2: pnpm/action-setup\'s run_install is "a `with:` that is not a mapping"',
    ]);
  });
});

// --- The workspace's and the root's package.json -------------------------------

/**
 * The folders pnpm-workspace.yaml names under `packages:`, as pnpm reads
 * them. A glob is refused rather than expanded: since #105 the packages are
 * named by folder (D-144's B1), and a glob this does not expand would leave a
 * package unread.
 */
function workspaceFolders(root) {
  const { parse } = yamlLibrary();
  const packages = parse(readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8'))?.packages;
  if (!Array.isArray(packages)) {
    throw new Error(
      'pnpm-workspace.yaml has no `packages:` list, so the workspace packages cannot be read',
    );
  }
  return packages.map((entry) => {
    if (typeof entry !== 'string' || /[*?{}[\]!]/.test(entry)) {
      throw new Error(
        `pnpm-workspace.yaml names ${JSON.stringify(entry)}, which is not a plain folder: its packages are not read here, so none is called clean`,
      );
    }
    return entry.replace(/\/+$/, '');
  });
}

/**
 * A project folder's package.json. pnpm reads package.json before
 * package.json5 and package.yaml (`MANIFEST_BASE_NAMES` in the bundle), so a
 * missing one is an error here, never an empty manifest.
 */
function manifestOf(root, folder) {
  const file = path.join(root, folder, 'package.json');
  if (!existsSync(file)) {
    throw new Error(
      `${path.posix.join(folder, 'package.json')} is missing: pnpm would read a package.json5 or package.yaml there, and neither is read here`,
    );
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * What pnpm would run from a project folder while installing, as findings:
 * each script named in `names`, whatever its value, and a binding.gyp, which
 * pnpm runs as `node-gyp rebuild` when the folder has no `install` or
 * `preinstall` (`checkBindingGyp` in the bundle; in the minimal workspace a
 * binding.gyp's `<!(…)` ran its shell command during the frozen install).
 */
function installTimeScripts(root, folder, names) {
  const where = folder === '.' ? 'package.json' : path.posix.join(folder, 'package.json');
  const scripts = manifestOf(root, folder).scripts ?? {};
  if (typeof scripts !== 'object' || Array.isArray(scripts)) {
    return [`${where}: scripts is ${JSON.stringify(scripts)}, not an object of scripts`];
  }
  const found = names
    .filter((name) => Object.hasOwn(scripts, name))
    .map((name) => `${where}: scripts.${name} is ${JSON.stringify(scripts[name])}`);
  if (existsSync(path.join(root, folder, 'binding.gyp'))) {
    found.push(
      `${folder === '.' ? '' : `${folder}/`}binding.gyp: pnpm runs it as node-gyp rebuild`,
    );
  }
  return found;
}

/** Every workspace package's install-time scripts. */
const workspaceFindings = (root) =>
  workspaceFolders(root).flatMap((folder) => installTimeScripts(root, folder, INSTALL_LIFECYCLE));

/** The root's install-time scripts, `prepare` aside when it is exactly `ROOT_PREPARE`. */
function rootFindings(root) {
  const scripts = manifestOf(root, '.').scripts ?? {};
  const keep = Object.hasOwn(scripts, 'prepare') && scripts.prepare === ROOT_PREPARE;
  return installTimeScripts(root, '.', [...INSTALL_LIFECYCLE, ...ROOT_INSTALL_HOOKS]).filter(
    (finding) => !(keep && finding.startsWith('package.json: scripts.prepare ')),
  );
}

/** The five packages #105 named in pnpm-workspace.yaml, as D-144 owns their package.json files. */
const FIVE = [
  'apps/mobile',
  'apps/server',
  'packages/config',
  'packages/contracts',
  'packages/test-kit',
];

/** A copy of the root package.json, pnpm-workspace.yaml and each workspace package.json, in a fresh folder. */
function copyOfManifests() {
  const dir = scratch();
  for (const file of [
    'package.json',
    'pnpm-workspace.yaml',
    ...workspaceFolders(ROOT).map((folder) => `${folder}/package.json`),
  ]) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    copyFileSync(path.join(ROOT, file), path.join(dir, file));
  }
  return dir;
}

/** Adds `scripts[name] = value` to the package.json in `folder` of `dir`. */
function addScript(dir, folder, name, value) {
  const file = path.join(dir, folder, 'package.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  manifest.scripts = { ...manifest.scripts, [name]: value };
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

describe('BUG-68: no package.json holds a script pnpm runs on install, but the root’s prepare', () => {
  test('BUG-68: no workspace package’s package.json holds a script pnpm 10.33.0 runs on install, and none has a binding.gyp', () => {
    expect(workspaceFolders(ROOT), 'the folders pnpm-workspace.yaml names').toEqual(
      expect.arrayContaining(FIVE),
    );
    expect(
      workspaceFindings(ROOT),
      `install-time scripts in the workspace packages: pnpm runs each on every install without --ignore-scripts, before any check of the files they can change (BUG-68). The names refused: ${INSTALL_LIFECYCLE.join(', ')}`,
    ).toEqual([]);
  });

  test('BUG-68: the workspace check finds a postinstall added to a copy, and every other name pnpm runs on install, and a binding.gyp', () => {
    const one = copyOfManifests();
    expect(workspaceFindings(one), 'an unchanged copy').toEqual([]);
    addScript(
      one,
      'apps/server',
      'postinstall',
      'echo registry=http://127.0.0.1:9/ >> ../../.npmrc',
    );
    expect(workspaceFindings(one)).toEqual([
      'apps/server/package.json: scripts.postinstall is "echo registry=http://127.0.0.1:9/ >> ../../.npmrc"',
    ]);

    // Every name, one to a package in turn, and a binding.gyp in another. The
    // names are written out again, not read from INSTALL_LIFECYCLE, so a name
    // dropped from it fails here.
    const every = copyOfManifests();
    const folders = workspaceFolders(every);
    const names = [
      'preinstall',
      'install',
      'postinstall',
      'preprepare',
      'prepare',
      'postprepare',
      'prepublish',
      'prepublishOnly',
    ];
    const expected = names.map((name, index) => {
      const folder = folders[index % folders.length] ?? '';
      addScript(every, folder, name, 'true');
      return { folder, finding: `${folder}/package.json: scripts.${name} is "true"` };
    });
    writeFileSync(path.join(every, 'packages/test-kit/binding.gyp'), '{ "targets": [] }\n');
    expect(new Set(workspaceFindings(every))).toEqual(
      new Set([
        ...expected.map((each) => each.finding),
        'packages/test-kit/binding.gyp: pnpm runs it as node-gyp rebuild',
      ]),
    );

    // What it cannot read fails, rather than reading as clean: a glob, a
    // package with no package.json, and a `scripts` that is not an object of
    // scripts (test-auditor on #106).
    const globbed = copyOfManifests();
    writeFileSync(path.join(globbed, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    expect(() => workspaceFindings(globbed)).toThrow(/"apps\/\*", which is not a plain folder/);
    const missing = copyOfManifests();
    rmSync(path.join(missing, 'apps/server/package.json'));
    expect(() => workspaceFindings(missing)).toThrow(/apps\/server\/package\.json is missing/);
    for (const scripts of ['postinstall', ['postinstall']]) {
      const odd = copyOfManifests();
      const file = path.join(odd, 'apps/server/package.json');
      writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), scripts }));
      expect(workspaceFindings(odd), `scripts as ${JSON.stringify(scripts)}`).toEqual([
        `apps/server/package.json: scripts is ${JSON.stringify(scripts)}, not an object of scripts`,
      ]);
    }
  });

  test('BUG-68: the root package.json’s only install-time script is prepare, which sets the local git hooks and nothing else, and the root has no binding.gyp', () => {
    // --ignore-scripts skips this prepare in CI, which is fine: it only points
    // git at .githooks, which no CI job uses.
    const { scripts } = manifestOf(ROOT, '.');
    expect(scripts?.prepare, 'the root package.json’s prepare').toBe(
      'git config core.hooksPath .githooks || true',
    );
    expect(
      rootFindings(ROOT),
      `install-time scripts in the root package.json, other than prepare as "${ROOT_PREPARE}": pnpm runs each on every install without --ignore-scripts (BUG-68). The names refused: ${[...INSTALL_LIFECYCLE, ...ROOT_INSTALL_HOOKS].join(', ')}`,
    ).toEqual([]);
  });

  test('BUG-68: the root check finds a postinstall, pnpm:devPreinstall, a changed prepare and a binding.gyp, each added to a copy', () => {
    const postinstall = copyOfManifests();
    expect(rootFindings(postinstall), 'an unchanged copy').toEqual([]);
    addScript(postinstall, '.', 'postinstall', 'node scripts/doctor.mjs');
    expect(rootFindings(postinstall)).toEqual([
      'package.json: scripts.postinstall is "node scripts/doctor.mjs"',
    ]);

    const hook = copyOfManifests();
    addScript(hook, '.', 'pnpm:devPreinstall', 'true');
    expect(rootFindings(hook)).toEqual(['package.json: scripts.pnpm:devPreinstall is "true"']);

    const prepare = copyOfManifests();
    addScript(prepare, '.', 'prepare', `${ROOT_PREPARE}; echo x >> "$GITHUB_ENV"`);
    expect(rootFindings(prepare)).toEqual([
      `package.json: scripts.prepare is ${JSON.stringify(`${ROOT_PREPARE}; echo x >> "$GITHUB_ENV"`)}`,
    ]);

    const gyp = copyOfManifests();
    writeFileSync(path.join(gyp, 'binding.gyp'), '{ "targets": [] }\n');
    expect(rootFindings(gyp)).toEqual(['binding.gyp: pnpm runs it as node-gyp rebuild']);

    // Every other name pnpm runs on install, each refused at the root too,
    // written out again as in the workspace check's copy.
    const every = copyOfManifests();
    const others = [
      'preinstall',
      'install',
      'postinstall',
      'preprepare',
      'postprepare',
      'prepublish',
      'prepublishOnly',
    ];
    for (const name of others) addScript(every, '.', name, 'true');
    expect(rootFindings(every)).toEqual(
      others.map((name) => `package.json: scripts.${name} is "true"`),
    );
  });
});
