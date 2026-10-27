/**
 * BUG-11, BUG-15 and BUG-64: the dependency audit's three accepted advisories,
 * each only by its own decision.
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
 * fixed, not ignored. GHSA-68fv-2mgg-jv7q (`source-map-js` >=1.0.0 <1.2.2, an
 * event-loop denial of service through indexed source-map section offsets)
 * failed the audit on `main` and every pull request: the lockfile held 1.2.1,
 * through `@vitest/coverage-v8 > magicast` and through `postcss`, both
 * declaring `^1.2.1`; `postcss` is reached through Vitest's Vite and through
 * `@expo/metro-config`, the app's bundler config. The root package.json
 * overrides the advisory's range to `^1.2.2`. Ignoring it instead fails
 * BUG-15's pin of exactly the decided ignored advisories.
 *
 * BUG-24 is the same kind, the same day: GHSA-pqg4-j6r4-53mv (critical:
 * command injection through `quote()` in `shell-quote` >=1.8.4 <1.11.0). The
 * lockfile held 1.10.0, through
 * `apps/mobile > react-native > react-devtools-core`, which declares `^1.6.1`.
 * The root package.json overrides everything below 1.11.0 to `^1.11.0`,
 * because other advisories cover the versions below 1.8.4 (see `PATCHED`).
 *
 * BUG-61 is the same kind again: GHSA-587h-7wmj-h5pm (high, filed against
 * vite: "launch-editor: `fs.existsSync()` existence check can be bypassed on
 * Windows"). The lockfile held vite 8.3.0, through `. > vitest > vite` and
 * `apps__server > vitest > vite`. vite comes in only as an auto-installed peer
 * of vitest and `@vitest/mocker`, and BUG-61's fix (6b7cd97) found that
 * nothing else moved that peer: a pnpm override changed only the peer range
 * ("unmet peer vite@^8.3.3: found 8.3.0"), and `pnpm up --depth Infinity` left
 * it at 8.3.0. Naming vite as a root dev dependency, `^8.3.3`, did. A JSON
 * file cannot say why a line is there, so `VITE_FLOOR_WHY` says it here,
 * where removing the line fails.
 *
 * BUG-64 is both kinds at once. On 2026-10-25 the audit failed on `main`'s own
 * checkout (run 40197588527) on two high advisories:
 *   - GHSA-mrhx-c7xc-m3w5 (zod <4.6.6: "Zod can exhaust memory while
 *     validating oversized constrained collections"), on two paths:
 *     `apps__server>zod` at 4.6.5, and `apps__mobile>expo>@expo/cli>zod` at
 *     3.25.76. The server's zod, and the API contracts', comes from the
 *     workspace catalog, and is fixed: the contracts' zod schemas are what the
 *     server validates requests with, which is what the advisory is about.
 *     `@expo/cli`, Expo's command-line tool, declares `zod ^3.25.76` even at
 *     its newest (58.1.15, read with `pnpm view` on 2026-10-25), and no 3.x is
 *     patched, so its zod is accepted (D-143) and ignored by the ID in the root
 *     package.json, as D-093 and D-104 are. That ignore is global: pnpm drops
 *     the advisory wherever it turns up, the server included. So the lockfile
 *     is read for it: every zod the server and the contracts reach is 4.6.6
 *     or later, and the only zod below 4.6.6 is the one `@expo/cli` depends
 *     on, reached from apps/mobile alone. The lockfile also held zod 4.6.5
 *     through `@stryker-mutator/core > mutation-server-protocol`
 *     (`zod ^4.1.12`), a root dev dependency the audit's paths did not list;
 *     D-143's premise check fails on it too, because the ignore hides it as
 *     well.
 *   - GHSA-xjj6-f33q-929c (undici >=8.0.0 <8.12.2: a denial of service through
 *     an unhandled error on excessive content-encodings), on one path,
 *     `apps__server>@testcontainers/postgresql>testcontainers>undici` at
 *     8.11.0: the server's integration-test containers, a dev dependency.
 *     testcontainers declares `^8.9.0` (12.1.0, the locked one) and `^8.11.2`
 *     (12.2.1, its newest), so 8.12.2 is in range. Fixed, a row in `PATCHED`.
 *
 * BUG-65 is a hole in this file's own check, found by #105's
 * privacy-security-reviewer. BUG-11's check matched the text of
 * pnpm-workspace.yaml and the root .npmrc against the words that set audit
 * settings, but pnpm reads neither as text. It reads the workspace file as
 * YAML, which decodes the escapes in a double-quoted key, and the .npmrc with
 * `ini`, which JSON-decodes a quoted name. Then it fills in `${NAME}`, or
 * `${NAME-fallback}` when NAME is unset, from the environment in each
 * top-level key of the one and each name of the other. So a key spelled
 * `audit` + an escaped `C` + `onfig` is auditConfig to pnpm and nothing to the
 * check. With the root package.json's auditConfig removed, in a scratch copy
 * of #105's head on 2026-10-26, `pnpm audit --audit-level high` exited 0,
 * "2 high (2 ignored)", on each of: pnpm-workspace.yaml with auditConfig and
 * ignoreGhsas behind `\u` escapes; pnpm-workspace.yaml with the key
 * `pnpm${TRYGG_UNSET-f}ile` naming a hook file whose updateConfig set
 * auditConfig; and the .npmrc naming that hook behind a JSON-quoted escape or
 * the same fallback. It exited 1 with none of them. Neither file had a code
 * owner (D-144 gives each one in #105), so a pull request touching only one
 * could silence the required `security` check. Now each is also read as pnpm
 * reads it, with the text check kept as a belt. A workflow, which GitHub reads
 * as YAML, is read decoded as well, for the same words and for the audit
 * command. Every route this file refuses is refused only when it runs, and in
 * CI a pnpm setting can stop it running (BUG-69, under "Not pinned").
 *
 * BUG-66 is a setting none of those words names: `registry`. pnpm sends the
 * audit to the registry the root .npmrc names, and CI's `security` job
 * installs and audits with it. On 2026-10-26, in a scratch copy of #105's
 * head, a local server that answered every request with no advisories, and
 * `registry=http://127.0.0.1:48731/` added to the .npmrc, made
 * `pnpm audit --audit-level high` exit 0, "No known vulnerabilities found";
 * the unchanged file exits 1. A registry that serves the real packages and
 * reports no advisories would pass the install as well. So the root .npmrc
 * may hold only the settings in `RC_SETTINGS`, today `engine-strict`, and
 * any other name fails, read as pnpm's `ini` reads it. A proxy, `strict-ssl`
 * or a certificate setting was not tried, and is refused by the list either
 * way.
 *
 * BUG-67 is the same in pnpm-workspace.yaml, found by #105's
 * privacy-security-reviewer. pnpm copies the file's top-level keys into its
 * settings, and the audit asks `registries.default`. A `registry` key there
 * had no effect, but with `registries:` and `default:` pointing at the same
 * server, `pnpm audit --audit-level high` exited 0, "No known
 * vulnerabilities found" (2026-10-26); the unchanged file exits 1. The
 * reviewer also reported a `lockfileDir` pointing at an empty lockfile making
 * the audit pass; it was not shown to get through
 * `pnpm install --frozen-lockfile`. So the file's top-level keys may be only
 * those in `WORKSPACE_SETTINGS`, today `packages` and `catalog`, named as
 * pnpm's parser names them. That also refuses an `overrides:` key here,
 * BUG-25's route through this file; BUG-25's other parts are not checked
 * here. `httpsProxy`, `strictSsl` and `ca` were not tried, and are refused
 * by the list either way. D-144 gives the file a code owner in #105.
 *
 * Then a lone CR, found by #105's privacy-security-reviewer at e57543d. pnpm
 * 10.33.0's reader breaks a line at a CR with no LF after it, as the YAML spec
 * does; `yaml` 2.9.1 keeps it inside a scalar, with no error or warning. So
 * `  - packages/*`, a CR, then `registries: {default: …}` was a registries
 * key to pnpm (the audit exited 0 against the same server, 2026-10-26) and
 * nothing to any check here. It is the fourth time the YAML model here has
 * drifted from pnpm's, after escapes, the environment fill and a flow
 * mapping. So two layers are added, and nothing is removed: `decodedYaml`
 * refuses a lone CR in any YAML file it reads, workflows included; and
 * `workspaceLines` reads pnpm-workspace.yaml with no YAML parser at all,
 * against a grammar of today's line shapes, where a line that is none of
 * them fails whatever a parser would make of it. The root .npmrc is pinned
 * the same way, to its exact content. Deleting the decoded denylists now
 * that the allowlists and the grammar exist (code-reviewer on #105) is
 * follow-up 15.
 *
 * A correction, from the same review. The bundle first read for BUG-65,
 * BUG-66 and BUG-67 was pnpm 10.28.0's (/opt/node-tools: the launcher, which
 * hands over to the 10.33.0 that `packageManager` names), with
 * `@zkochan/js-yaml` 0.0.9. Every claim here about pnpm's readers was read
 * again on 2026-10-26 in 10.33.0's own bundle: its YAML reader is
 * `@zkochan/js-yaml` 0.0.11, and every fixture's reading held; its .npmrc
 * reader is the same `ini` 1.3.8. The end-to-end runs used the `pnpm`
 * command, which is 10.33.0, and stand.
 *
 * An ignore list is a quiet way to stop a gate from seeing anything, so these
 * tests read files instead of running the audit: a `pnpm audit` run reads the
 * registry's advisory data, which changes whenever an advisory is published, and
 * a unit test must not change its answer with the news. What they pin, and
 * nothing more:
 *   - the root package.json's `pnpm.auditConfig.ignoreGhsas` lists
 *     GHSA-86w9-cpqp-85rv, GHSA-vfj7-8cjw-p6xm and GHSA-mrhx-c7xc-m3w5 (the
 *     reproductions: without any one, the audit fails every pull request);
 *   - `ignoreGhsas` holds exactly those three, each named by its own owner's
 *     decision, D-093, D-104 and D-143. A fourth fails this pin until the ID
 *     is added to `DECIDED_IGNORES`, beside which its premise test belongs;
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
 *   - BUG-65's reading of the same files as pnpm and GitHub read them, beside
 *     those text checks: pnpm-workspace.yaml parses, with no error and no tag
 *     left unresolved, or is refused; none of its scalars, key or value, at
 *     any depth, names one of those words once YAML has decoded it; no name
 *     of a setting or a section in the root .npmrc does once `ini` has
 *     decoded it as pnpm does; no key of either has `${` in it; and no line of
 *     any workflow scalar, decoded, outside a whole-line comment, names one of
 *     those words or runs an audit other than `pnpm audit --audit-level high`.
 *     A folded `run: >` is decoded too, so `pnpm` and `audit` on lines of
 *     their own are read as one command;
 *   - BUG-66's allowlist: every name in the root .npmrc, as `ini` decodes it,
 *     a `[section]`'s and the names inside it included, is in `RC_SETTINGS`
 *     (today only `engine-strict`). Adding a setting is a change to this test,
 *     in code-owned scripts/;
 *   - BUG-67's allowlist: every top-level key of pnpm-workspace.yaml, named
 *     as js-yaml names it (an alias followed, a sequence's items joined, a
 *     `<<` kept as a key), is in `WORKSPACE_SETTINGS` (today `packages` and
 *     `catalog`), and the file's top level is a mapping. Adding a setting is
 *     a change to this test, in code-owned scripts/;
 *   - BUG-67's lone CR: no YAML file read here holds a CR that is not part of
 *     a CRLF line end;
 *   - BUG-67's line grammar, with no YAML parser: every line of
 *     pnpm-workspace.yaml, split on LF alone, is one of `WORKSPACE_LINE`'s
 *     shapes in its place, so it holds no CR (a CRLF included), NEL, LS or
 *     PS, no tab, no quote but around a scoped catalog name, no flow
 *     collection, anchor, alias, tag or trailing comment, and no top-level
 *     key but `packages:` and `catalog:`, each once. Adding a shape is a
 *     change to this test, in code-owned scripts/;
 *   - the root .npmrc is exactly `engine-strict=true` and a line feed;
 *   - BUG-69's two settings, each with a named fixture: `scriptShell` in
 *     pnpm-workspace.yaml is refused by the line grammar and
 *     `WORKSPACE_SETTINGS`, and `script-shell` in the root .npmrc by
 *     `RC_SETTINGS` (and by the byte pin above);
 *   - BUG-69's package files: no .npmrc, pnpm-workspace.yaml or .pnpmfile.cjs
 *     anywhere in the repository, read by walking the tree with no git
 *     subprocess, `node_modules`, `.git` and `.stryker-tmp` skipped, but the
 *     root's two and spikes/background-safety/app/pnpm-workspace.yaml, which
 *     is outside the root workspace (`PNPM_SETTINGS_ALLOWED`);
 *   - BUG-69's workspace list (B1): pnpm-workspace.yaml's `packages:` and the
 *     root package.json's `workspaces` each name exactly `WORKSPACE_FOLDERS`,
 *     with no glob; each named folder has a package.json that is a path the
 *     owner must approve; and every folder under apps/ and packages/ with a
 *     package.json is named in both;
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
 *   - D-143's two halves, read from pnpm-lock.yaml with the same walk, upward
 *     from every locked zod short of 4.6.6 (below it, or not plain semver and
 *     so not comparable with it). The fixed half: neither apps/server nor
 *     packages/contracts reaches one, by any dependency field or `link:`. The
 *     accepted half, D-143's premise: the packages that depend on one are
 *     exactly `@expo/cli`, no workspace package depends on one directly, and
 *     the importers that reach one are exactly apps/mobile. Each is read by
 *     what depends on the zod and where it is reached from, never by its
 *     version string: a second zod short of 4.6.6 anywhere else fails, even
 *     one at `@expo/cli`'s own 3.25.76. No zod short of 4.6.6 at all fails
 *     too: D-143's prompt to remove the ignore, made loud;
 *   - BUG-23's and BUG-24's fixes, one row each in `PATCHED`, read from
 *     pnpm-lock.yaml: no `source-map-js` the lockfile resolves, by a
 *     `packages` or a `snapshots` key, is in >=1.0.0 <1.2.2, and no
 *     `shell-quote` is in <1.11.0. A version in the range fails, named, the
 *     fix's own pre-releases included; so does one that is not plain semver (a
 *     git, file or tarball source), which cannot be compared and so cannot be
 *     called fixed. Any version at or above the fix passes, because the
 *     overrides are floors. A `source-map-js` below 1.0.0 is outside its
 *     advisory and passes; every `shell-quote` below 1.11.0 fails, because
 *     other advisories cover the versions below 1.8.4. The lockfile's
 *     `overrides` section, where the fixes write their selectors, holds
 *     ranges, not resolved versions, and is not read;
 *   - BUG-61's fix, its row in `PATCHED`, read the same way: no `vite` the
 *     lockfile resolves is below 8.3.3. GHSA-587h-7wmj-h5pm covers one range
 *     per release line (>=7.0.0 <=7.3.6, >=8.0.0 <=8.1.5, >=8.2.0 <=8.2.3,
 *     >=8.3.0 <=8.3.2), and other high advisories cover 8.0.x, so, as for
 *     `shell-quote`, every vite below 8.3.3 fails. That includes the older
 *     lines' own fixed releases (7.3.7, 8.1.6, 8.2.4), which the audit would
 *     pass: the check is a floor, as the root dev dependency is;
 *   - BUG-64's undici fix, its row in `PATCHED`, read the same way: no
 *     `undici` the lockfile resolves is in >=8.0.0 <8.12.2,
 *     GHSA-xjj6-f33q-929c's own range, as BUG-23's row keeps to its
 *     advisory's. 8.12.2 also fixes two moderate advisories with the same
 *     range, GHSA-4qv8-2p9j-2685 and GHSA-f72v-6w45-q472;
 *   - the root package.json's `devDependencies.vite` has a floor of 8.3.3 or
 *     later (`^`, `~` or an exact version): the means BUG-61's fix found,
 *     pinned so that a cleanup of a dev dependency nothing imports fails here,
 *     with the reason, instead of letting vitest's peer fall back unnoticed.
 *
 * Not pinned:
 *   - the audit's result;
 *   - that these tests run at all (BUG-69). In CI they run through
 *     `pnpm run test:unit`, and pnpm 10.33.0 runs every script with the shell
 *     named by `scriptShell` in pnpm-workspace.yaml, `script-shell` in the
 *     root .npmrc, or a root .pnpmfile.cjs's `updateConfig` hook. With any one
 *     of the three, every `pnpm run` check exits 0 having run nothing
 *     (2026-10-26). These tests refuse all three (the line grammar and
 *     `WORKSPACE_SETTINGS`, the byte pin and `RC_SETTINGS`, BUG-11's root
 *     pnpmfile check), but not in a run they never reach. So in CI each
 *     route is closed by the owner's review: D-144 makes all three
 *     code-owned in #105, the pnpmfile before it exists. A check that runs
 *     before pnpm in CI is queued as BUG-69's follow-up. A package's own
 *     .npmrc or pnpm-workspace.yaml changes the shell for a run started in
 *     that package's folder, and turbo runs every package script there: an
 *     apps/server/.npmrc made its `typecheck` pass over a type error
 *     (2026-10-26). That route is refused here (see the pinned list above),
 *     and in CI only when this file runs, as for the root's;
 *   - an audit command or a setting that a workflow builds while it runs:
 *     shell quoting or variables (`pnpm "au"dit`), a GitHub expression
 *     (`${{ … }}`) or a repository variable. A workflow is read as GitHub
 *     decodes it, not as the shell runs it. Workflows have a code owner
 *     (.github/), and pnpm-workspace.yaml and the .npmrc have one from D-144
 *     (#105);
 *   - a workflow that sets `npm_config_registry`, or another `npm_config_*`
 *     variable whose name holds none of `ROUTE`'s words, or runs
 *     `pnpm config set registry`: not checked here. Workflows are under the
 *     code-owned .github/;
 *   - a workspace package's `preinstall`, `install`, `postinstall` or
 *     `prepare`: an install without `--ignore-scripts` runs it before the
 *     audit, and it can rewrite .npmrc or the job's environment, which checks
 *     of the checked-in files cannot see. Not read here. BUG-68's
 *     scripts/install-scripts.test.mjs holds every `pnpm install` in ci.yml
 *     to `--ignore-scripts`, and the workspace and root package.json files to
 *     no install script but the root's `prepare`; with D-144 (#105) every
 *     workspace package.json also has a code owner. ai-review.yml's and
 *     daily-status.yml's installs are not held to the flag (that file's "Not
 *     pinned");
 *   - where `yaml` 2.9.1, the parser used here, and pnpm's read YAML
 *     differently beyond the differences found (see `yamlLibrary`). For
 *     pnpm-workspace.yaml the line grammar depends on neither. A workflow is
 *     read by `yaml` alone: GitHub's reader was not compared;
 *   - what an .npmrc in a workspace package would set: none may exist
 *     (BUG-69, above), so none is read. A `registry` line in
 *     apps/mobile/.npmrc did not redirect the audit (tried
 *     2026-10-26). In pnpm-workspace.yaml a `registry` key did not either,
 *     but `registries` did: BUG-67's route, now refused here by
 *     `WORKSPACE_SETTINGS` (in CI, only when this file runs: BUG-69 above),
 *     as is `lockfileDir`, reported by #105's privacy-security-reviewer;
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
 *   - a new path to `@expo/cli`'s zod *inside* apps/mobile, as for `braces`:
 *     the walk allows apps/mobile, and a second `@expo/cli` there is still
 *     `@expo/cli`;
 *   - what `@expo/cli` does with zod. D-143 accepts it as Expo's command-line
 *     tool, not the app's runtime; nothing here reads that tool's source or
 *     the app bundle;
 *   - an undici below 8.0.0. GHSA-xjj6-f33q-929c's range starts at 8.0.0, and
 *     its row follows it, so an undici 7.x passes here. Other high advisories
 *     cover the 7.x line below 7.29.1, and none covers 7.30.1 (npm's bulk
 *     advisory endpoint, 2026-10-25): such a 7.x fails the audit itself, which
 *     no ignore here covers, and not this check;
 *   - a later decision that supersedes D-093, D-104 or D-143. The lookup finds
 *     the owner's acceptance, and does not read whether a later entry withdrew
 *     it (BUG-11's open gap). Removing the ID from `ignoreGhsas` is the loud
 *     path: the tests here then fail until they change with it;
 *   - copies of `braces` bundled inside other packages, which neither the
 *     lockfile nor the audit can see: those in Vite's bundled chokidar, tsx,
 *     prettier and `resolve-workspace-root`. All are tooling; the server runs
 *     under Node's type stripping, not tsx;
 *   - how BUG-23's, BUG-24's and BUG-64's fixes reach the lockfile: the root
 *     package.json's overrides, the workspace catalog's zod and any other
 *     means are not read, only what the lockfile resolves. `source-map-js`,
 *     `shell-quote`, `vite` or `undici` leaving the lockfile passes the
 *     lockfile check, because nothing then resolves in the range. BUG-61's
 *     means, the root dev dependency, is the one read (above);
 *   - `source-map-js` and `shell-quote` in the spike's lockfile, which holds
 *     1.2.1 and 1.10.0 and which the audit does not read (D-093 names it as
 *     not covered);
 *   - copies of `source-map-js` and `shell-quote` bundled inside other
 *     packages, which neither the lockfile nor the audit can see, nor the
 *     overrides reach (read in node_modules on 2026-10-06): magicast 0.5.5's
 *     `dist/builders-*.js` (source-map-js 1.2.1, unfixed); Vite 8.3.0's
 *     `dist/node/chunks/node.js` (shell-quote 1.8.4, inside
 *     GHSA-pqg4-j6r4-53mv and GHSA-395f-4hp3-45gv, whose function is
 *     `parse`. Vite never calls `parse` with request input: it mounts
 *     `launchEditorMiddleware()` with no editor, so `guessEditor` never
 *     reaches `shellQuote.parse`); react-devtools-core 6.1.5's
 *     `dist/standalone.js` (an old copy; the package's main is
 *     `dist/backend.js`, and nothing here loads the standalone build); and
 *     drizzle-kit 0.31.11's `bin.cjs` and @drizzle-team/brocli 0.10.2's
 *     `index.js` (shell-quote 1.8.1, older than the 1.8.4 form. drizzle-kit's
 *     copy calls neither `quote` nor `parse`; brocli calls `parse` only from
 *     its exported `test()` helper, which nothing here loads). All are
 *     tooling or unloaded; none is among the server's production
 *     dependencies (drizzle-kit is a server dev dependency).
 *
 * What pnpm does with these settings was read in pnpm 10.33.0's own bundle
 * (dist/pnpm.cjs), not assumed. (BUG-11 wrote this on 2026-10-02. On
 * 2026-10-26 BUG-67 re-read the first two items, the audit's two ignore
 * lists and the settings taken from package.json, in 10.33.0's bundle, and
 * they hold; the pnpmfile item was not re-read.)
 *   - the audit drops an advisory when
 *     `auditConfig.ignoreGhsas.includes(github_advisory_id)` (an exact,
 *     case-sensitive match), or when it has CVEs and every one is in
 *     `auditConfig.ignoreCves`, which can drop a different GHSA for the same
 *     CVE; `pnpm audit --ignore` and `--ignore-unfixable` write `ignoreCves`
 *     and exit 0 instead of auditing;
 *   - `auditConfig` and `configDependencies` are read from the root
 *     package.json's `pnpm` field, and then every top-level key of
 *     pnpm-workspace.yaml is assigned over the config. BUG-65 read how, and
 *     BUG-67 read it again in pnpm 10.33.0's bundle on 2026-10-26 (see the
 *     correction above): the file is parsed with `@zkochan/js-yaml` 0.0.11's
 *     `load` (a js-yaml 4 fork) after a byte-order mark is stripped, and
 *     `envReplace` (`@pnpm/config.env-replace` 3.0.2) is run over each
 *     top-level key and each top-level string value first. The root .npmrc
 *     is parsed with `ini` 1.3.8, through @pnpm/npm-conf and config-chain,
 *     and `envReplace` (1.1.0, the same code for this) is run over each name.
 *     `envReplace` throws on a `${NAME}` that is unset and has no fallback;
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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { OWNER_APPROVAL_PATHS } from './lib/merge-rules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

/**
 * The root .npmrc. A missing one is an error, never an empty file: read as
 * empty, it passed every check of today's file here (test-auditor on #105
 * renamed the path at each call, and all 44 tests still passed).
 */
const readRc = () => {
  if (!existsSync(path.join(root, '.npmrc'))) {
    throw new Error(
      'the root .npmrc is missing: the tests of it here read the checked-in file, and a missing file is not a clean one',
    );
  }
  return read('.npmrc');
};

/** The advisory the owner accepted on 2026-10-02 (D-093): node-forge's. */
const ACCEPTED_ADVISORY = 'GHSA-86w9-cpqp-85rv';

/** The advisory the owner accepted on 2026-10-03 (D-104): braces'. */
const BRACES_ADVISORY = 'GHSA-vfj7-8cjw-p6xm';

/**
 * The advisory the owner accepted on 2026-10-25 (D-143), for `@expo/cli`'s
 * zod only: zod's. The server's and the contracts' zod is fixed instead.
 */
const ZOD_ADVISORY = 'GHSA-mrhx-c7xc-m3w5';

/**
 * Every advisory the audit may ignore, and the decision that accepted it. Exactly
 * these: another needs its own owner's decision and its own premise test here.
 *
 * RG-03, BUG-64: this pin held two (D-093, D-104) and now holds three. The
 * owner's decision D-143 adds exactly one, GHSA-mrhx-c7xc-m3w5, with its
 * premise tests (D-143's two halves, below). The pin stays exact: a fourth,
 * or one of these three missing, still fails.
 */
const DECIDED_IGNORES = new Map([
  [ACCEPTED_ADVISORY, 'D-093'],
  [BRACES_ADVISORY, 'D-104'],
  [ZOD_ADVISORY, 'D-143'],
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

// --- BUG-65: the settings files, read as pnpm and GitHub read them -----------

/**
 * The `yaml` package, as Node resolves it for the root's own `vite`. No
 * workspace package depends on a YAML library, and none resolves from
 * scripts/. The lockfile resolves `yaml` 2.9.1 as vite's peer (the root
 * importer's vite is `8.3.4(…)(yaml@2.9.1)`), and pnpm links it beside vite,
 * so it is reached from vite's folder, as stryker-config.test.mjs reaches
 * Stryker's modules: no dependency is added. It is loaded when first asked
 * for: if that peer ever goes, the BUG-65 tests fail and say why, and nothing
 * reads the files as clean.
 *
 * pnpm 10.33.0 reads pnpm-workspace.yaml with `@zkochan/js-yaml` 0.0.11, a
 * fork of js-yaml 4 bundled into pnpm, which nothing here can load. (This
 * said 0.0.9 until BUG-67: that is pnpm 10.28.0's, read by mistake.) Every
 * fixture below was read with 0.0.11, taken from 10.33.0's bundle, on
 * 2026-10-26. Each route word it decodes, `yaml` decodes too, except across a
 * lone CR. The differences found are covered rather than modelled: js-yaml
 * applies a `<<` merge and `yaml` does not, but every scalar is read where it
 * is written, which is where a merge or an alias takes it from; js-yaml
 * throws on a tag it does not know, where `yaml` warns, and a warning is
 * refused here; a `!!binary` key is its bytes' numbers to js-yaml and their
 * text here, which refuses more, not less; a CR with no LF after it is a line
 * break to js-yaml and a character to `yaml`, and `decodedYaml` refuses it;
 * and an undefined alias is an error to js-yaml, but to `yaml` only when it
 * converts, which the walk never does. That drift is why `workspaceLines`
 * reads the workspace file with no parser at all.
 */
const yamlLibrary = (() => {
  let loaded = null;
  return () => {
    if (loaded !== null) return loaded;
    try {
      const fromRoot = createRequire(path.join(root, 'package.json'));
      loaded = createRequire(fromRoot.resolve('vite/package.json'))('yaml');
    } catch (error) {
      throw new Error(
        `BUG-65: no YAML parser resolves through the root's vite, so pnpm-workspace.yaml and the workflows cannot be read as pnpm and GitHub read them, and are not called clean: ${error.message}`,
        { cause: error },
      );
    }
    return loaded;
  };
})();

/**
 * The text of every scalar a key is made of: the key itself, the node an alias
 * names, or each item of a sequence used as a key (js-yaml turns `? [a]` into
 * the key `a`). A mapping used as a key gives none here: its own pairs are
 * pairs the walk visits, and js-yaml reads it as `[object Object]`.
 */
function keyTexts(node, doc, seen = new Set()) {
  const { isAlias, isScalar, isSeq } = yamlLibrary();
  if (node === null || node === undefined || seen.has(node)) return [];
  seen.add(node);
  if (isAlias(node)) return keyTexts(node.resolve(doc), doc, seen);
  if (isScalar(node)) return [String(node.value)];
  if (isSeq(node)) return node.items.flatMap((item) => keyTexts(item, doc, seen));
  return [];
}

/**
 * A YAML file as a parser decodes it: the text of every scalar, key or value,
 * at every depth, each once, where it is written; and the text of every key,
 * an alias followed to what it names. A file that does not parse (a broken
 * collection, a key twice, two documents), or holds what the parser does not
 * resolve (an unknown tag), comes back in `unread`, never as clean.
 */
function decodedYaml(file, text) {
  const { parseDocument, visit } = yamlLibrary();
  const doc = parseDocument(text);
  const unread = [...doc.errors, ...doc.warnings].map(
    (problem) => `${file} is not read as clean: ${problem.message.split('\n')[0]}`,
  );
  // BUG-67: a CR with no LF after it breaks the line for the YAML spec and for
  // pnpm's reader; `yaml` keeps it inside a scalar, with no error or warning.
  const loneCr = /\r(?!\n)/.exec(text);
  if (loneCr !== null) {
    unread.push(
      `${file} line ${text.slice(0, loneCr.index).split('\n').length} has a carriage return that is not part of a CRLF line end: the YAML spec, and pnpm's reader, break the line there, and this reader does not`,
    );
  }
  const scalars = [];
  const keys = [];
  let topLevel = [];
  if (doc.errors.length === 0) {
    // Block bodies: a visitor that returns a number moves the walk to that index.
    visit(doc, {
      Scalar: (_, node) => {
        // `yaml` gives `!!binary` as a Node Buffer, whose String is its bytes as UTF-8.
        scalars.push(String(node.value));
      },
      Pair: (_, pair) => {
        keys.push(...keyTexts(pair.key, doc));
      },
    });
    topLevel = topLevelKeys(doc);
  }
  return { unread, scalars, keys, topLevel };
}

/**
 * BUG-67: the top-level keys of a YAML document as js-yaml, pnpm's parser,
 * names them (read again with the 0.0.11 loader from pnpm 10.33.0's bundle
 * on 2026-10-26; first read with 10.28.0's 0.0.9, which agrees): a
 * scalar's text, an alias's target, a sequence's items joined by commas, a
 * mapping as `[object Object]`, an empty key as `null`. A `<<` stays a key of
 * its own here, where js-yaml merges what it names into the top level. Null
 * when the top level is not a mapping, which pnpm refuses.
 */
function topLevelKeys(doc) {
  const { isAlias, isMap, isScalar, isSeq } = yamlLibrary();
  const name = (node, seen = new Set()) => {
    if (node === null || node === undefined || seen.has(node)) return 'null';
    seen.add(node);
    if (isAlias(node)) return name(node.resolve(doc), seen);
    if (isScalar(node)) return String(node.value);
    if (isSeq(node)) return node.items.map((item) => name(item, seen)).join(',');
    if (isMap(node)) return '[object Object]';
    return 'null';
  };
  if (doc.contents === null) return [];
  return isMap(doc.contents) ? doc.contents.items.map((pair) => name(pair.key)) : null;
}

/** A decoded text that names an audit or hook setting, as a finding. */
function decodedRoute(file, text) {
  const word = ROUTE.exec(text);
  return word === null ? [] : [`${file}: ${JSON.stringify(text)}, decoded, names ${word[0]}`];
}

/**
 * A key with `${` in it, as a finding. pnpm runs `envReplace` over each
 * top-level key of pnpm-workspace.yaml and over each name in .npmrc before it
 * reads them, and `${NAME-fallback}` is the fallback when NAME is unset, so
 * such a key can be any setting at all. Refused at every depth, not only at
 * the top: no key here needs one.
 */
function fromEnvironment(file, key) {
  return key.includes('${')
    ? [
        `${file}: the key ${JSON.stringify(key)} is filled in from the environment before pnpm reads it`,
      ]
    : [];
}

/**
 * BUG-65: what in pnpm-workspace.yaml could set an audit setting or load a
 * hook, read three ways. Its text against `ROUTE`, BUG-11's check, kept as a
 * belt for whatever the parser reads differently from pnpm's (it refuses a
 * comment too, as it always has; today's file has no match). Every scalar,
 * decoded, against `ROUTE`. Every key against `${`. Every finding, or none.
 */
function workspaceRoutes(text) {
  const file = 'pnpm-workspace.yaml';
  const raw = ROUTE.exec(text);
  const { unread, scalars, keys } = decodedYaml(file, text);
  return [
    ...(raw === null ? [] : [`${file} mentions ${raw[0]} in its text`]),
    ...unread,
    ...scalars.flatMap((scalar) => decodedRoute(file, scalar)),
    ...keys.flatMap((key) => fromEnvironment(file, key)),
  ];
}

/**
 * BUG-67: the only top-level keys pnpm-workspace.yaml may hold. pnpm copies
 * each into its settings, and the audit asks `registries.default`, so a
 * `registries` key pointing at a server that reports no advisories passes the
 * audit. Every other setting is refused too, whether or not it was ever shown
 * to change the audit. The list stays short on purpose.
 */
const WORKSPACE_SETTINGS = new Set(['packages', 'catalog']);

/**
 * BUG-67: each top-level key of pnpm-workspace.yaml outside
 * `WORKSPACE_SETTINGS`, as a finding, named as pnpm names it
 * (`topLevelKeys`), so an escaped or quoted key, an alias or a sequence used
 * as a key, and a `${…}` key are each read for what they are. A file that
 * does not parse is refused through BUG-65's `unread`; one whose top level
 * is not a mapping is refused here.
 */
function workspaceUnlisted(text) {
  const file = 'pnpm-workspace.yaml';
  const { unread, topLevel } = decodedYaml(file, text);
  if (topLevel === null) return [...unread, `${file}'s top level is not a mapping of settings`];
  return [
    ...unread,
    ...topLevel
      .filter((key) => !WORKSPACE_SETTINGS.has(key))
      .map(
        (key) =>
          `${file} sets ${JSON.stringify(key)}, which is not among the settings it may hold (${[...WORKSPACE_SETTINGS].join(', ')}): adding one is a change to this test, and scripts/ is code-owned, so the owner approves it`,
      ),
  ];
}

/**
 * BUG-67: the shapes a line of pnpm-workspace.yaml may take, read from its raw
 * text with no YAML parser. Every other check here reads the file through
 * `yaml`, and that reading has drifted from pnpm's again and again: escapes,
 * the environment fill, a flow mapping, a lone CR. A grammar of line shapes
 * cannot drift that way: a line that is none of them fails, whatever a parser
 * would make of it. The shapes are today's file's own: a blank line, a
 * whole-line comment, `packages:` and `catalog:` (each once), a package glob
 * under `packages:`, and a `name: range` entry under `catalog:`. A glob may not
 * start with `!`, `*` or `@`, nor a range with `>`, `|` or `-`: YAML reads
 * those as a tag, an alias, a reserved indicator, a folded or literal scalar,
 * or a list item. Each of these claims has its own fixture in "each claim of
 * the line grammar …", below. A sweep of 131 mutants of this grammar on
 * 2026-10-26 (test-auditor on #105) left four alive, each of which changes
 * no answer: the comment's `$`, and CR, LS or PS taken out of `LINE_BREAKS`.
 */
const WORKSPACE_LINE = {
  blank: /^$/,
  comment: /^ *#.*$/,
  glob: /^ {2}- [A-Za-z0-9_.][A-Za-z0-9_./*@!-]*$/,
  entry: /^ {2}(?:[A-Za-z0-9_.-]+|'[A-Za-z0-9_.@/-]+'): [0-9A-Za-z^~<=][0-9A-Za-z.^~<>=| +-]*$/,
};

/** The top-level keys the grammar lets a line open, each at most once. */
const WORKSPACE_SECTIONS = ['packages', 'catalog'];

/**
 * The characters a YAML reader may break a line at, besides LF: CR, NEL, LS
 * and PS. CR, LS and PS also match no shape's characters, and `.` does not
 * match them, so only NEL, which `.` matches in a comment, needs this rule;
 * the other three are refused twice.
 */
const LINE_BREAKS = [0x0d, 0x85, 0x2028, 0x2029].map((code) => String.fromCharCode(code));

/** A line as JSON writes it, every character outside printable ASCII as a `\u` escape, so a CR, NEL, LS or PS shows. */
function shown(line) {
  return JSON.stringify(line).replace(
    /[^\x20-\x7e]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/**
 * BUG-67: each line of pnpm-workspace.yaml that is not one of
 * `WORKSPACE_LINE`'s shapes in its place, as a finding. The text is split on
 * LF alone, so a CR anywhere, a CRLF line end included, leaves a line that
 * fits no shape; so does a NEL, LS or PS.
 */
function workspaceLines(text) {
  const file = 'pnpm-workspace.yaml';
  const opened = new Set();
  let section = null;
  const fits = (line) => {
    if ([...line].some((c) => LINE_BREAKS.includes(c))) return false;
    if (WORKSPACE_LINE.blank.test(line) || WORKSPACE_LINE.comment.test(line)) return true;
    const header = WORKSPACE_SECTIONS.find((name) => line === `${name}:`);
    if (header !== undefined) {
      section = opened.has(header) ? null : header;
      opened.add(header);
      return section !== null;
    }
    if (!line.startsWith(' ')) {
      section = null;
      return false;
    }
    if (section === 'packages') return WORKSPACE_LINE.glob.test(line);
    if (section === 'catalog') return WORKSPACE_LINE.entry.test(line);
    return false;
  };
  return text
    .split('\n')
    .flatMap((line, i) =>
      fits(line)
        ? []
        : [
            `${file} line ${i + 1}, ${shown(line)}, is not a line this file may hold: adding a line shape is a change to this test, and scripts/ is code-owned, so the owner approves it`,
          ],
    );
}

/**
 * `ini` 1.3.8's `unsafe`, through which it reads a name. A name in double
 * quotes, or in single quotes around a JSON string, is `JSON.parse`d, so a
 * `\u` escape in it is decoded; one that does not parse loses only its single
 * quotes. An unquoted name ends at the first `;` or `#` no backslash escapes,
 * and a backslash before `\`, `;` or `#` stands for that character.
 */
function rcUnquoted(written) {
  let name = (written ?? '').trim();
  if (
    (name.startsWith('"') && name.endsWith('"')) ||
    (name.startsWith("'") && name.endsWith("'"))
  ) {
    if (name.startsWith("'")) name = name.slice(1, -1);
    try {
      name = JSON.parse(name);
    } catch {
      // ini leaves a name that is not JSON as it is.
    }
    return String(name);
  }
  let unescaped = '';
  let escaping = false;
  for (const character of name) {
    if (escaping) {
      unescaped += '\\;#'.includes(character) ? character : `\\${character}`;
      escaping = false;
    } else if (character === ';' || character === '#') {
      break;
    } else if (character === '\\') {
      escaping = true;
    } else {
      unescaped += character;
    }
  }
  return (escaping ? `${unescaped}\\` : unescaped).trim();
}

/**
 * The names of an rc file's settings and sections, as pnpm 10.33.0 reads the
 * root .npmrc (first read in 10.28.0's bundle by mistake, then in 10.33.0's
 * on 2026-10-26, whose `ini` 1.3.8 is the same code):
 * @pnpm/npm-conf parses it with `ini` 1.3.8, whose `decode` splits the text
 * on line breaks, skips a line that starts with `;` or `#`, and reads a
 * `[section]`, or what comes before a line's first `=`, through `unsafe`
 * (`rcUnquoted`). A name after a `[section]` is read too, though `ini` puts
 * it inside that section rather than among pnpm's settings.
 */
function rcNames(text) {
  const names = [];
  for (const line of text.split(/[\r\n]+/g)) {
    if (line === '' || /^\s*[;#]/.test(line)) continue;
    const match = /^\[([^\]]*)\]$|^([^=]+)(=(.*))?$/.exec(line);
    if (match !== null) names.push(rcUnquoted(match[1] ?? match[2]));
  }
  return names;
}

/**
 * BUG-65: what in the root .npmrc could load a hook, read three ways: its text
 * against `ROUTE`, BUG-11's check, kept, which refuses a comment as well; each
 * name, decoded, against `ROUTE`; and each name against `${`.
 */
function rcRoutes(text) {
  const raw = ROUTE.exec(text);
  const names = rcNames(text);
  return [
    ...(raw === null ? [] : [`.npmrc mentions ${raw[0]} in its text`]),
    ...names.flatMap((name) => decodedRoute('.npmrc', name)),
    ...names.flatMap((name) => fromEnvironment('.npmrc', name)),
  ];
}

/**
 * BUG-66: the only settings the root .npmrc may hold. pnpm sends the audit to
 * the registry this file names, so a `registry` line pointing at a server that
 * reports no advisories passes the audit. Every other setting is refused
 * too, whether or not it was ever shown to change the audit: a scoped
 * registry, an auth line, a proxy, a certificate, a `[section]`. The list
 * stays short on purpose.
 */
const RC_SETTINGS = new Set(['engine-strict']);

/**
 * BUG-66: each name in the root .npmrc outside `RC_SETTINGS`, as a finding.
 * Every name `rcNames` decodes counts, a section's name and the names inside
 * it included, so a quoted or escaped `registry` counts as `registry`.
 */
function rcUnlisted(text) {
  return rcNames(text)
    .filter((name) => !RC_SETTINGS.has(name))
    .map(
      (name) =>
        `.npmrc sets ${JSON.stringify(name)}, which is not among the settings it may hold (${[...RC_SETTINGS].join(', ')}): adding one is a change to this test, and scripts/ is code-owned, so the owner approves it`,
    );
}

/**
 * BUG-69: the names of the files pnpm takes a folder's settings and hooks
 * from. In the folder a script runs in, `script-shell` in an .npmrc or
 * `scriptShell` in a pnpm-workspace.yaml names the shell pnpm runs it with;
 * a .pnpmfile.cjs's `updateConfig` can set either.
 */
const PNPM_SETTINGS_FILES = ['.npmrc', 'pnpm-workspace.yaml', '.pnpmfile.cjs'];

/**
 * BUG-69: the only files of those names the repository may hold. The root's
 * two are pinned by the tests of them here, and code-owned (D-144). The
 * spike's is outside the root workspace, whose packages are all folders
 * under apps/ and packages/, so pnpm and turbo at the root never run a script
 * there.
 */
const PNPM_SETTINGS_ALLOWED = [
  '.npmrc',
  'pnpm-workspace.yaml',
  'spikes/background-safety/app/pnpm-workspace.yaml',
];

/**
 * BUG-69: the folders the walk below does not enter: installed packages, git's
 * own, and `.stryker-tmp`, the gitignored copy of the repository, root files
 * and all, that an interrupted mutation run leaves behind (test-auditor's N3
 * on #105).
 */
const WALK_SKIPS = ['node_modules', '.git', '.stryker-tmp'];

/**
 * BUG-69: every file under the folder `top` named as one of
 * `PNPM_SETTINGS_FILES`, as a path from `top` with `/` between folders,
 * sorted. Folders named as in `WALK_SKIPS` are skipped, and a symbolic link
 * to a folder is not followed. The tree is read as it is, with no git
 * subprocess, so an untracked file is found too.
 */
function pnpmSettingsFiles(top) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(top, dir), { withFileTypes: true })) {
      const at = dir === '' ? entry.name : `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!WALK_SKIPS.includes(entry.name)) walk(at);
      } else if (PNPM_SETTINGS_FILES.includes(entry.name)) {
        found.push(at);
      }
    }
  };
  walk('');
  return found.toSorted();
}

/**
 * BUG-69 (privacy-security-reviewer's B1 on #105): the workspace's packages,
 * by folder. With `apps/*` and `packages/*` in pnpm-workspace.yaml and in the
 * root package.json's `workspaces`, a pull request that adds only
 * apps/<new>/package.json, which no CODEOWNERS line owns, adds a workspace
 * package, and CI's `pnpm install --frozen-lockfile` runs its `preinstall`
 * or `postinstall` in every required job. That script can write
 * `script-shell=/bin/true` to the root .npmrc, and every `pnpm run` after it
 * passes having run nothing (reproduced with pnpm 10.33.0, 2026-10-26; with
 * the packages named, the install left the .npmrc alone). Named, a new
 * package needs a line in both files, each code-owned (D-144), and each
 * named package's package.json is a path the owner must approve.
 */
const WORKSPACE_FOLDERS = [
  'apps/mobile',
  'apps/server',
  'packages/config',
  'packages/contracts',
  'packages/test-kit',
];

/** BUG-69: a workspace entry pnpm would expand as a glob, not read as one folder. */
const WORKSPACE_GLOB = /[*?[\]{}!]/;

/**
 * BUG-69: the workspace's two lists as written: pnpm-workspace.yaml's
 * `packages:`, as the YAML parser reads it (the line grammar holds every line
 * of that file to shapes pnpm's parser reads the same way), and the root
 * package.json's `workspaces`. A list that is missing or not a list of
 * strings comes back as it is, and fails the comparisons below.
 */
function workspaceLists() {
  return {
    pnpm: yamlLibrary().parse(read('pnpm-workspace.yaml'))?.packages,
    manifest: manifest.workspaces,
  };
}

/**
 * BUG-65: what in a workflow could set an audit setting or load a hook. Each
 * line as written, outside a whole-line comment: BUG-11's check, kept. Then
 * each line of each scalar as GitHub decodes it, a whole-line comment again
 * skipped, as the shell skips it. `${` is not refused here: GitHub fills in
 * `${{ … }}` in values, never in keys, and does not run pnpm's `envReplace`.
 */
function workflowRoutes(file, text) {
  const { unread, scalars } = decodedYaml(file, text);
  const decodedLines = scalars
    .flatMap((scalar) => scalar.split('\n'))
    .filter((line) => !/^\s*#/.test(line));
  return [
    ...text
      .split('\n')
      .filter((line) => !/^\s*#/.test(line) && ROUTE.test(line))
      .map((line) => `${file}: ${line.trim()}`),
    ...unread,
    ...decodedLines.flatMap((line) => decodedRoute(file, line.trim())),
  ];
}

/**
 * BUG-65: the audit commands in a workflow, selected as BUG-11's
 * `auditCommands` selects them, from its lines as written and from each
 * scalar as GitHub decodes it: an escape in a double-quoted `run:`, or a
 * folded `run: >` that puts `pnpm` and `audit` on lines of their own.
 */
function workflowAudits(file, text) {
  const { scalars } = decodedYaml(file, text);
  return [
    ...auditCommands(file, text).map((audit) => ({ ...audit, read: 'as written' })),
    ...scalars
      .flatMap((scalar) => auditCommands(file, scalar))
      .map((audit) => ({ ...audit, read: 'decoded' })),
  ];
}

/**
 * BUG-65's reproduction: pnpm-workspace.yaml in today's shape, with the line
 * privacy-security-reviewer found on #105 at its end. Both keys are written
 * with `\u` escapes inside double quotes, which YAML decodes, so pnpm reads
 * `auditConfig.ignoreGhsas` from it while the text names neither. With the
 * root package.json's auditConfig removed, `pnpm audit --audit-level high`
 * exited 0 on it, "2 high (2 ignored)", in a scratch copy of #105's head
 * (2026-10-26), and 1 without the line.
 */
const ESCAPED_WORKSPACE = String.raw`packages:
  - apps/*
  - packages/*

catalog:
  zod: ^4.6.6
"audit\u0043onfig": {"ignore\u0047hsas": ["GHSA-86w9-cpqp-85rv", "GHSA-vfj7-8cjw-p6xm", "GHSA-mrhx-c7xc-m3w5"]}
`;

/**
 * Every character of a word as a backslash escape: `\`, the letter, and the
 * character's code point in hex, padded to `digits`. The default, `\u` with
 * four digits, is the form both JSON and YAML decode; YAML also decodes `\x`
 * with two digits and `\U` with eight.
 */
function asEscapes(word, letter = 'u', digits = 4) {
  return [...word]
    .map((c) => `\\${letter}${c.codePointAt(0).toString(16).padStart(digits, '0')}`)
    .join('');
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
  return importersReachingFrom(
    lock,
    [...lock.snapshots.keys()].filter((key) => packageName(key) === name),
  );
}

/**
 * `importersReaching`, from the given snapshot keys rather than from every
 * snapshot of one package: BUG-64 walks from the zods short of 4.6.6 only,
 * not from the fixed ones beside them.
 */
function importersReachingFrom(lock, keys) {
  const index = dependentsIndex(lock);
  const queue = keys.map(snapshotNode);
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

// --- What fixes an advisory with a patched version --------------------------

/**
 * The advisories fixed by a patched version, not ignored: one entry per fix,
 * by the bug that made it. A locked version counts against the lockfile from
 * `vulnerableFrom` (null: from the first version there is) up to, and not
 * including, `fixedAt`. `lockedBefore` is what the lockfile held when the audit
 * failed. The ranges were read from npm's bulk advisory endpoint, the data
 * `pnpm audit` reads, on 2026-10-06 (BUG-23, BUG-24), 2026-10-20 (BUG-61) and
 * 2026-10-25 (BUG-64).
 */
const PATCHED = [
  {
    bug: 'BUG-23',
    name: 'source-map-js',
    advisory: 'GHSA-68fv-2mgg-jv7q',
    // The advisory's own range, >=1.0.0 <1.2.2. A 0.x is outside it, and the
    // override, `source-map-js@>=1.0.0 <1.2.2`, leaves a 0.x alone too.
    vulnerableFrom: '1.0.0',
    fixedAt: '1.2.2',
    lockedBefore: '1.2.1',
  },
  {
    bug: 'BUG-24',
    name: 'shell-quote',
    advisory: 'GHSA-pqg4-j6r4-53mv',
    // GHSA-pqg4-j6r4-53mv covers >=1.8.4 <1.11.0, and other advisories cover
    // everything below it: GHSA-w7jw-789q-3m8p (critical, >=1.1.0 <=1.8.3:
    // `quote()` does not escape newlines in object `.op` values),
    // GHSA-395f-4hp3-45gv (high, <=1.8.4: a quadratic-complexity denial of
    // service in `parse()`) and GHSA-qg8p-v9q4-gh34 (critical, <1.6.1: a
    // potential command injection). So every shell-quote below 1.11.0
    // counts, as the override's `shell-quote@<1.11.0` does.
    vulnerableFrom: null,
    fixedAt: '1.11.0',
    lockedBefore: '1.10.0',
  },
  {
    bug: 'BUG-61',
    name: 'vite',
    advisory: 'GHSA-587h-7wmj-h5pm',
    // The fix's commit cites >=8.3.0 <=8.3.2, the range of the line the
    // lockfile held. The endpoint gives the advisory one range per release
    // line: >=7.0.0 <=7.3.6, >=8.0.0 <=8.1.5, >=8.2.0 <=8.2.3 and
    // >=8.3.0 <=8.3.2. GHSA-v2wj-q39q-566r and GHSA-p9ff-h696-f583 (high,
    // >=8.0.0 <=8.0.4) and GHSA-fx2h-pf6j-xcff (high, >=8.0.0 <=8.0.15)
    // cover 8.0.x as well. A floor at 8.3.0 would pass a vite 8.2.3 the audit
    // fails, so every vite below 8.3.3 counts: the floor the root dev
    // dependency, `^8.3.3`, sets. The older lines' own fixed releases (7.3.7,
    // 8.1.6, 8.2.4) count too, though the audit passes them: a red here that
    // the audit would not give, never a green it would not.
    vulnerableFrom: null,
    fixedAt: '8.3.3',
    lockedBefore: '8.3.0',
  },
  {
    bug: 'BUG-64',
    name: 'undici',
    advisory: 'GHSA-xjj6-f33q-929c',
    // The advisory's own range, >=8.0.0 <8.12.2, as `pnpm audit --json` and
    // the endpoint gave it on 2026-10-25; the moderate GHSA-4qv8-2p9j-2685
    // and GHSA-f72v-6w45-q472 have the same 8.x range. An undici 7.x is
    // outside it and passes here, as a 0.x source-map-js does for BUG-23; the
    // 7.x line's own advisories are the audit's to catch (see "Not pinned").
    vulnerableFrom: '8.0.0',
    fixedAt: '8.12.2',
    lockedBefore: '8.11.0',
  },
];

/**
 * Why the root package.json names vite as a dev dependency (BUG-61). Nothing
 * imports it; it is there for vitest's auto-installed peer. A JSON file cannot
 * hold that comment, so it is said here, where removing the line fails.
 */
const VITE_FLOOR_WHY =
  "the root package.json's devDependencies.vite (`^8.3.3`, BUG-61) is the only way found to move vitest's auto-installed vite peer past GHSA-587h-7wmj-h5pm: a pnpm override changed only the peer range, and `pnpm up --depth Infinity` left vite at 8.3.0. Keep it at a floor of 8.3.3 or later; to drop it, first show the lockfile resolves no vite below 8.3.3 without it, then change this test with a written reason (RG-03)";

/** The floor of a dev dependency's specifier: `^8.3.3`, `~8.3.3` and `8.3.3` give 8.3.3; any other form, null. */
function floorOf(specifier) {
  const plain = /^[\^~]?(\d+\.\d+\.\d+)$/.exec(String(specifier));
  return plain === null ? null : plain[1];
}

/** A fix's range, in the form the advisory database writes one: `>=1.0.0 <1.2.2`, or `<1.11.0`. */
function rangeOf({ vulnerableFrom, fixedAt }) {
  return vulnerableFrom === null ? `<${fixedAt}` : `>=${vulnerableFrom} <${fixedAt}`;
}

/** A plain semver version: three numbers, then an optional pre-release and build. Anchored at both ends. */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Where a locked version stands against a fix: 'in range' (from
 * `vulnerableFrom`, when there is one, up to `fixedAt`), 'fixed' (`fixedAt` or
 * later), 'before range' (below `vulnerableFrom`), or 'unplaced' when it is
 * not plain semver (a git, file or tarball source) and cannot be compared.
 * Each part is compared as a number, so 1.9.9 and 1.10.0 are below 1.11.0; a
 * pre-release comes before its release, as semver orders them, so 1.2.2-beta.0
 * is below 1.2.2; build metadata is ignored.
 */
function placeAgainst(version, { vulnerableFrom, fixedAt }) {
  const parts = SEMVER.exec(version);
  if (parts === null) return 'unplaced';
  const numbers = parts.slice(1, 4).map(Number);
  const isBefore = (release) => {
    const bound = release.split('.').map(Number);
    const first = numbers.findIndex((n, i) => n !== bound[i]);
    return first === -1 ? parts[4] !== undefined : numbers[first] < bound[first];
  };
  if (!isBefore(fixedAt)) return 'fixed';
  if (vulnerableFrom !== null && isBefore(vulnerableFrom)) return 'before range';
  return 'in range';
}

/**
 * How the lockfile falls short of a fix; empty when no version of the package
 * it resolves, by a `packages` or a `snapshots` key, is in the fix's range or
 * unplaced. Each version is placed once. One that cannot be placed counts
 * against the lockfile: a version this check cannot compare is one it cannot
 * call fixed.
 */
function shortOfFix(lock, fix) {
  const inRange = [];
  const unplaced = [];
  for (const version of lockedVersions(lock, fix.name)) {
    const place = placeAgainst(version, fix);
    if (place === 'in range') inRange.push(version);
    if (place === 'unplaced') unplaced.push(version);
  }
  const short = [];
  if (inRange.length > 0) {
    short.push(
      `${fix.name} ${inRange.join(', ')} is locked, in ${rangeOf(fix)}, which ${fix.fixedAt} fixes (${fix.advisory})`,
    );
  }
  if (unplaced.length > 0) {
    short.push(
      `${fix.name} ${unplaced.join(', ')} is locked, a version that cannot be compared with ${fix.fixedAt}`,
    );
  }
  return short;
}

/**
 * A synthetic lockfile in v9's form, as BUG-23's, BUG-24's and BUG-61's fixes
 * leave it: both overrides in the form and order pnpm 10.33.0 writes them
 * (read from a scratch install, 2026-10-06), source-map-js 1.2.2 through
 * magicast, under the coverage tool, and through postcss, reached here from
 * vitest; shell-quote 1.11.0 through the app's react-native and its
 * react-devtools-core; vite 8.3.3 as the root's own dev dependency and as
 * vitest's peer; and undici 8.12.2 through the server's testcontainers, here
 * with an override in BUG-23's and BUG-24's form (BUG-64's fix may move undici
 * without one, since testcontainers' own range admits 8.12.2; the check reads
 * only what the lockfile resolves, either way). The overrides and the dev
 * dependency are floors (`^1.2.2`, `^1.11.0`, `^8.3.3`, `^8.12.2`), so a real
 * install may lock a later version: the same scratch install locked
 * shell-quote 1.12.0, and BUG-61's fix locked vite 8.3.4.
 */
const PATCHED_SAMPLE_LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

overrides:
  source-map-js@>=1.0.0 <1.2.2: ^1.2.2
  shell-quote@<1.11.0: ^1.11.0
  undici@>=8.0.0 <8.12.2: ^8.12.2

importers:

  .:
    devDependencies:
      '@vitest/coverage-v8':
        specifier: ^5.0.1
        version: 5.0.1(vitest@5.0.1)
      vite:
        specifier: ^8.3.3
        version: 8.3.3
      vitest:
        specifier: ^5.0.1
        version: 5.0.1

  apps/mobile:
    dependencies:
      react-native:
        specifier: 0.86.3
        version: 0.86.3

  apps/server:
    devDependencies:
      '@testcontainers/postgresql':
        specifier: ^12.1.0
        version: 12.1.0

packages:

  '@testcontainers/postgresql@12.1.0':
    resolution: {integrity: sha512-synthetic}

  '@vitest/coverage-v8@5.0.1':
    resolution: {integrity: sha512-synthetic}
    peerDependencies:
      vitest: 5.0.1

  magicast@0.5.5:
    resolution: {integrity: sha512-synthetic}

  postcss@8.5.28:
    resolution: {integrity: sha512-synthetic}

  react-devtools-core@6.1.5:
    resolution: {integrity: sha512-synthetic}

  react-native@0.86.3:
    resolution: {integrity: sha512-synthetic}

  shell-quote@1.11.0:
    resolution: {integrity: sha512-synthetic}
    engines: {node: '>= 0.4'}

  source-map-js@1.2.2:
    resolution: {integrity: sha512-synthetic}
    engines: {node: '>=0.10.0'}

  testcontainers@12.1.0:
    resolution: {integrity: sha512-synthetic}

  undici@8.12.2:
    resolution: {integrity: sha512-synthetic}

  vite@8.3.3:
    resolution: {integrity: sha512-synthetic}

  vitest@5.0.1:
    resolution: {integrity: sha512-synthetic}

  ws@7.5.13:
    resolution: {integrity: sha512-synthetic}

snapshots:

  '@testcontainers/postgresql@12.1.0':
    dependencies:
      testcontainers: 12.1.0

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

  react-devtools-core@6.1.5:
    dependencies:
      shell-quote: 1.11.0
      ws: 7.5.13
    transitivePeerDependencies:
      - bufferutil
      - utf-8-validate

  react-native@0.86.3:
    dependencies:
      react-devtools-core: 6.1.5

  shell-quote@1.11.0: {}

  source-map-js@1.2.2: {}

  testcontainers@12.1.0:
    dependencies:
      undici: 8.12.2

  undici@8.12.2: {}

  vite@8.3.3: {}

  vitest@5.0.1:
    dependencies:
      postcss: 8.5.28
      vite: 8.3.3

  ws@7.5.13: {}
`;

// --- BUG-64: zod, fixed for the server and the contracts, accepted for Expo's tool ---

/**
 * GHSA-mrhx-c7xc-m3w5's range, in `placeAgainst`'s form: every zod below
 * 4.6.6, the whole 3.x line included, which has no patched release.
 */
const ZOD_FIX = { vulnerableFrom: null, fixedAt: '4.6.6' };

/**
 * Where D-143 fixes the advisory instead of accepting it: the server, and the
 * API contracts whose zod schemas it validates requests with. Both take zod
 * from the workspace catalog.
 */
const D143_FIXED_IN = ['apps/server', 'packages/contracts'];

/** The one package D-143 accepts a zod short of 4.6.6 under: Expo's command-line tool, which declares `zod ^3.25.76`. */
const D143_DEPENDENTS = ['@expo/cli'];

/** The one workspace package D-143 leaves that zod reachable from: the app, through expo. */
const D143_REACHED_FROM = ['apps/mobile'];

/**
 * The snapshot keys of every zod short of 4.6.6: in its range, or not plain
 * semver (a git, file or tarball source), which cannot be called fixed. Read
 * from the `snapshots` keys, where the walk starts; the `packages` keys hold
 * no edges to walk.
 */
function zodShortOfFix(lock) {
  return [...lock.snapshots.keys()].filter(
    (key) =>
      packageName(key) === 'zod' &&
      placeAgainst(key.slice('zod@'.length).replace(/\(.*$/, ''), ZOD_FIX) !== 'fixed',
  );
}

/**
 * What depends on the given snapshots directly: the snapshots' package names,
 * and the importers' paths. Read from `dependentsIndex`, so a dependency the
 * reader cannot place throws here as it does in the walk.
 */
function directDependents(lock, keys) {
  const index = dependentsIndex(lock);
  const nodes = keys.flatMap((key) => index.get(snapshotNode(key)) ?? []);
  const named = (kind) => nodes.filter((n) => n.startsWith(`${kind} `)).map(nodeName);
  return {
    packages: [...new Set(named('snapshot').map(packageName))].sort(),
    importers: [...new Set(named('importer'))].sort(),
  };
}

/**
 * D-143's fixed half: each of the server and the contracts that reaches a zod
 * short of 4.6.6, by any dependency field or `link:`, with one shortest
 * chain. Empty when neither does.
 */
function zodFixChanges(lock) {
  const reached = importersReachingFrom(lock, zodShortOfFix(lock));
  return D143_FIXED_IN.filter((at) => reached.has(at)).map(
    (at) => `${at} reaches a zod short of 4.6.6: ${reached.get(at).join(' > ')}`,
  );
}

/**
 * D-143's accepted half, its premise: how the lockfile differs from it, read
 * by what depends on each zod short of 4.6.6 and where it is reached from,
 * never by its version string. Empty when the packages that depend on one are
 * exactly `@expo/cli`, no workspace package depends on one directly, and the
 * importers that reach one are exactly apps/mobile.
 */
function zodPremiseChanges(lock) {
  const short = zodShortOfFix(lock);
  if (short.length === 0) {
    return [
      "no zod short of 4.6.6 is locked: @expo/cli no longer needs D-143's exception, so remove the ignore",
    ];
  }
  const changes = [];
  const versions = short.map((key) => key.slice('zod@'.length)).join(', ');
  const dependents = directDependents(lock, short);
  if (dependents.packages.join() !== D143_DEPENDENTS.join()) {
    changes.push(
      `the packages that depend on a zod short of 4.6.6 (${versions}) are [${dependents.packages.join(', ')}], not [${D143_DEPENDENTS.join(', ')}]`,
    );
  }
  if (dependents.importers.length > 0) {
    changes.push(
      `workspace packages depend on a zod short of 4.6.6 directly: ${dependents.importers.join(', ')}`,
    );
  }
  const reached = importersReachingFrom(lock, short);
  const importers = [...reached.keys()];
  if (importers.join() !== D143_REACHED_FROM.join()) {
    changes.push(
      `the workspace packages that reach a zod short of 4.6.6 are [${importers.join(', ')}], not [${D143_REACHED_FROM.join(', ')}]`,
      ...importers
        .filter((at) => !D143_REACHED_FROM.includes(at))
        .map((at) => `${at} reaches a zod short of 4.6.6: ${reached.get(at).join(' > ')}`),
    );
  }
  return changes;
}

const D143_FIX_SHORT =
  'GHSA-mrhx-c7xc-m3w5 is fixed for the server and the contracts (D-143), not accepted: the ignore is global, and would hide this';

const D143_PREMISE_CHANGED = "D-143's premise changed: decide again, or remove the ignore";

/**
 * A synthetic lockfile in v9's form, as BUG-64's fix leaves it: the server and
 * the contracts at zod 4.6.6, from the catalog, the contracts' `@orpc/zod`
 * holding it as a peer, the server and the app linking the contracts; and
 * `@expo/cli` at zod 3.25.76, reached from the app through expo, and from
 * nothing else.
 */
const ZOD_SAMPLE_LOCK = `lockfileVersion: '9.0'

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
      '@trygghverdag/contracts':
        specifier: workspace:*
        version: link:../../packages/contracts
      expo:
        specifier: ~57.0.25
        version: 57.0.25(react@19.2.3)

  apps/server:
    dependencies:
      '@trygghverdag/contracts':
        specifier: workspace:*
        version: link:../../packages/contracts
      zod:
        specifier: 'catalog:'
        version: 4.6.6
    devDependencies:
      vitest:
        specifier: 'catalog:'
        version: 5.0.1

  packages/contracts:
    dependencies:
      '@orpc/zod':
        specifier: ^1.15.3
        version: 1.15.3(zod@4.6.6)
      zod:
        specifier: 'catalog:'
        version: 4.6.6
    devDependencies:
      vitest:
        specifier: 'catalog:'
        version: 5.0.1

packages:

  '@expo/cli@57.0.27':
    resolution: {integrity: sha512-synthetic}
    hasBin: true

  '@orpc/zod@1.15.3':
    resolution: {integrity: sha512-synthetic}
    peerDependencies:
      zod: '>=3.25.0'

  expo@57.0.25:
    resolution: {integrity: sha512-synthetic}

  vitest@5.0.1:
    resolution: {integrity: sha512-synthetic}

  zod@3.25.76:
    resolution: {integrity: sha512-synthetic}

  zod@4.6.6:
    resolution: {integrity: sha512-synthetic}

snapshots:

  '@expo/cli@57.0.27(expo@57.0.25(react@19.2.3))':
    dependencies:
      zod: 3.25.76
    transitivePeerDependencies:
      - supports-color

  '@orpc/zod@1.15.3(zod@4.6.6)':
    dependencies:
      zod: 4.6.6

  expo@57.0.25(react@19.2.3):
    dependencies:
      '@expo/cli': 57.0.27(expo@57.0.25(react@19.2.3))

  vitest@5.0.1: {}

  zod@3.25.76: {}

  zod@4.6.6: {}
`;

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

  test('BUG-64: GHSA-mrhx-c7xc-m3w5 is ignored by the dependency audit', () => {
    // The reproduction: `@expo/cli`'s zod 3.25.76 has no patched 3.x, so
    // without the ignore the audit fails every pull request (D-143).
    expect(
      auditConfig?.ignoreGhsas,
      "the root package.json's pnpm.auditConfig.ignoreGhsas does not list D-143's accepted advisory",
    ).toEqual(expect.arrayContaining([ZOD_ADVISORY]));
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

  test('BUG-15, BUG-64: the audit ignores exactly the three accepted advisories, each named by its own decision (D-093, D-104, D-143)', () => {
    // Sorted, because pnpm reads the list as a set; a duplicate still shows,
    // as a longer list. A fourth advisory, even one an owner's decision names,
    // fails here until the ID is added to DECIDED_IGNORES, beside which its
    // premise test belongs. RG-03: BUG-64 renamed this test from "exactly the
    // two" and its message from "D-093's and D-104's", because the owner's
    // decision D-143 adds exactly one; the assertions are unchanged.
    expect(
      [...(auditConfig?.ignoreGhsas ?? [])].sort(),
      "pnpm.auditConfig.ignoreGhsas is not exactly D-093's, D-104's and D-143's advisories",
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
    // RG-03: read through readRc, which refuses a missing .npmrc, where this
    // read a missing one as empty and passed (test-auditor on #105).
    expect(
      readRc(),
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

  test('BUG-65: a pnpm-workspace.yaml that sets auditConfig behind escaped keys is refused, as pnpm decodes them', () => {
    // The line found on #105. pnpm reads the file with js-yaml, which decodes
    // each `\u` escape to its letter: the keys it sees are auditConfig and
    // ignoreGhsas.
    expect(
      ROUTE.test(ESCAPED_WORKSPACE),
      'the fixture is the bypass: its text names no audit or hook setting',
    ).toBe(false);
    expect(workspaceRoutes(ESCAPED_WORKSPACE)).toEqual([
      'pnpm-workspace.yaml: "auditConfig", decoded, names auditConfig',
      'pnpm-workspace.yaml: "ignoreGhsas", decoded, names ignoreGhsas',
    ]);
  });

  test('BUG-65: a pnpm-workspace.yaml key that pnpm fills in from the environment is refused', () => {
    // pnpm runs envReplace over every top-level key of the file before it
    // reads the settings, and `${NAME-fallback}` is the fallback when NAME is
    // unset: this key is `pnpmfile`. `pnpm audit --audit-level high` loaded
    // the hook it names, a file without "pnpmfile" in its name, and ran its
    // updateConfig, which set auditConfig: exit 0, "2 high (2 ignored)"
    // (2026-10-26).
    const text = 'packages:\n  - apps/*\n"pnpm${TRYGG_UNSET-f}ile": hooks.cjs\n';
    expect(ROUTE.test(text), 'the fixture names no audit or hook setting in its text').toBe(false);
    expect(workspaceRoutes(text)).toEqual([
      'pnpm-workspace.yaml: the key "pnpm${TRYGG_UNSET-f}ile" is filled in from the environment before pnpm reads it',
    ]);
  });

  test('BUG-65: a root .npmrc that names a pnpmfile behind a quoted, escaped name or an environment variable is refused, as pnpm reads it', () => {
    // pnpm's ini parser JSON-decodes a quoted name, and then fills in
    // `${…}` from the environment. Each of these loaded hooks.cjs, whose
    // updateConfig set auditConfig: `pnpm audit --audit-level high` exited 0,
    // "2 high (2 ignored)" (2026-10-26).
    const escaped = String.raw`engine-strict=true
"\u0070npmfile"=hooks.cjs
`;
    const wrapped = String.raw`engine-strict=true
'"\u0070npmfile"'=hooks.cjs
`;
    // RG-03: named `fromEnvironment` until code-reviewer on #105 found it
    // shadowing the module's helper of that name; renamed, nothing else.
    const envFilled = 'engine-strict=true\npnpm${TRYGG_UNSET-f}ile=hooks.cjs\n';
    for (const text of [escaped, wrapped, envFilled]) {
      expect(ROUTE.test(text), `the fixture names no hook setting in its text: ${text}`).toBe(
        false,
      );
    }
    // One assertion, so a failure shows every case at once.
    expect({
      escaped: rcRoutes(escaped),
      wrapped: rcRoutes(wrapped),
      envFilled: rcRoutes(envFilled),
    }).toEqual({
      escaped: ['.npmrc: "pnpmfile", decoded, names pnpmfile'],
      wrapped: ['.npmrc: "pnpmfile", decoded, names pnpmfile'],
      envFilled: [
        '.npmrc: the key "pnpm${TRYGG_UNSET-f}ile" is filled in from the environment before pnpm reads it',
      ],
    });
  });

  test('BUG-65: a workflow that sets a pnpmfile, or runs another audit, behind YAML escapes is refused', () => {
    // GitHub reads a workflow as YAML, so a double-quoted key or value reaches
    // the runner decoded: an `npm_config_pnpmfile` variable, a
    // `pnpm config set pnpmfile`, and a `pnpm audit --ignore-unfixable`, which
    // writes ignoreCves and exits 0 instead of auditing.
    const sample = String.raw`jobs:
  security:
    runs-on: ubuntu-latest
    env:
      "npm_config_\x70npmfile": hooks.cjs
    steps:
      - run: "pnpm config set \x70npmfile hooks.cjs"
      - run: "pnpm \x61udit --ignore-unfixable"
      - run: pnpm audit --audit-level high
`;
    // One assertion, so a failure shows both checks at once.
    expect({
      routes: workflowRoutes('sample.yml', sample),
      audits: wrongAudits(workflowAudits('sample.yml', sample)).map(
        (a) => `${a.read}: ${a.command}`,
      ),
    }).toEqual({
      routes: [
        'sample.yml: "npm_config_pnpmfile", decoded, names pnpmfile',
        'sample.yml: "pnpm config set pnpmfile hooks.cjs", decoded, names pnpmfile',
      ],
      audits: ['decoded: pnpm audit --ignore-unfixable'],
    });
  });

  test("BUG-65: today's pnpm-workspace.yaml, root .npmrc and workflows, read as pnpm and GitHub read them, set no audit setting and load no hook", () => {
    // BUG-11's text checks above stay as they were; these read the same files
    // decoded, with the text check kept inside each.
    const workspace = read('pnpm-workspace.yaml');
    // The parser read the file: it found the catalog's zod, so "no key names
    // a setting" is read, not assumed.
    expect(
      decodedYaml('pnpm-workspace.yaml', workspace).keys,
      'the YAML reader did not find the keys of pnpm-workspace.yaml',
    ).toEqual(expect.arrayContaining(['packages', 'catalog', 'zod']));
    expect(
      workspaceRoutes(workspace),
      "pnpm-workspace.yaml, read as pnpm reads it, sets an audit or hook setting: its keys are assigned over package.json's, so auditConfig there replaces the decided one, and a pnpmfile or config dependency can rewrite it",
    ).toEqual([]);
    // RG-03: read through readRc, which refuses a missing .npmrc, where this
    // read a missing one as empty and passed (test-auditor on #105).
    expect(
      rcRoutes(readRc()),
      'the root .npmrc, read as pnpm reads it, names a hook setting: a pnpmfile it names is loaded for the audit, and its updateConfig hook can set auditConfig',
    ).toEqual([]);

    const workflows = workflowFiles().map((file) => [file, read(`.github/workflows/${file}`)]);
    expect(
      workflows.flatMap(([file, text]) => workflowRoutes(file, text)),
      'a workflow, read as GitHub decodes it, mentions an audit or hook setting',
    ).toEqual([]);
    const audits = workflows.flatMap(([file, text]) => workflowAudits(file, text));
    expect(
      wrongAudits(audits),
      `a workflow, read as GitHub decodes it, runs pnpm audit other than as \`${AUDIT_COMMAND}\``,
    ).toEqual([]);
    // The decoded read found the audit that the line check finds, so "no
    // other audit" is read, not assumed.
    expect(
      audits.filter((audit) => audit.read === 'decoded').map((audit) => audit.command),
      'the decoded read of the workflows did not find the audit',
    ).toContain(AUDIT_COMMAND);
  });

  test("BUG-65: the workspace check refuses an audit setting in pnpm-workspace.yaml however YAML writes its key, at any depth, and passes today's file and other settings", () => {
    // No false positive: today's file, and one with settings pnpm reads that
    // are none of these.
    expect(workspaceRoutes(read('pnpm-workspace.yaml'))).toEqual([]);
    expect(
      workspaceRoutes(
        'packages:\n  - apps/*\nonlyBuiltDependencies:\n  - esbuild\nsavePrefix: "~"\ncatalog:\n  "zod": ^4.6.6\n',
      ),
    ).toEqual([]);

    // A plain key: the text check refuses it, as BUG-11's always has, and the
    // decoded read does too.
    expect(workspaceRoutes('auditConfig:\n  ignoreGhsas: [GHSA-86w9-cpqp-85rv]\n')).toEqual([
      'pnpm-workspace.yaml mentions auditConfig in its text',
      'pnpm-workspace.yaml: "auditConfig", decoded, names auditConfig',
      'pnpm-workspace.yaml: "ignoreGhsas", decoded, names ignoreGhsas',
    ]);

    // Each route word, kebab and snake forms included, with every character
    // written as each of YAML's three escapes for one. The text check sees
    // none of them.
    const escapes = [
      ['x', 2],
      ['u', 4],
      ['U', 8],
    ];
    const words = [
      'pnpmfile',
      'globalPnpmfile',
      'auditConfig',
      'audit-config',
      'audit_config',
      'ignoreGhsas',
      'ignore-ghsas',
      'ignore_ghsas',
      'ignoreCves',
      'ignore-cves',
      'ignore_cves',
      'configDependencies',
      'config-dependencies',
      'config_dependencies',
    ];
    for (const word of words) {
      for (const [form, digits] of escapes) {
        const text = `packages:\n  - apps/*\n"${asEscapes(word, form, digits)}": x\n`;
        expect(ROUTE.test(text), `${word}, each character as \\${form}: the text names it`).toBe(
          false,
        );
        expect(workspaceRoutes(text), `${word}, each character as \\${form}`).toEqual([
          `pnpm-workspace.yaml: "${word}", decoded, names ${ROUTE.exec(word)[0]}`,
        ]);
      }
    }

    // The same setting, escaped, in each place and form YAML allows a key.
    // pnpm reads settings at the top only; the check refuses them at any depth.
    const decodedAuditConfig = [
      'pnpm-workspace.yaml: "auditConfig", decoded, names auditConfig',
      'pnpm-workspace.yaml: "ignoreGhsas", decoded, names ignoreGhsas',
    ];
    const forms = {
      'nested under a quoted top-level key': String.raw`"catalog":
  zod: ^4.6.6
  "\x61uditConfig":
    "\x69gnoreGhsas": [GHSA-86w9-cpqp-85rv]
`,
      'in a flow mapping': String.raw`{packages: [apps/*], "\x61uditConfig": {"\x69gnoreGhsas": [GHSA-86w9-cpqp-85rv]}}
`,
      // js-yaml, pnpm's parser, merges these keys into the top level; `yaml`
      // keeps `<<` as a key of its own. Read where they are written, they are
      // refused either way.
      'through a << merge key': String.raw`defaults: &defaults
  "\x61uditConfig":
    "\x69gnoreGhsas": [GHSA-86w9-cpqp-85rv]
packages:
  - apps/*
<<: *defaults
`,
      'through an alias used as a key': String.raw`name: &setting "\x61uditConfig"
*setting : {"\x69gnoreGhsas": [GHSA-86w9-cpqp-85rv]}
`,
      // js-yaml takes a tag on an explicit key or in a flow mapping; on a
      // quoted key in a block it stops reading.
      'with the !!str tag': String.raw`? !!str "\x61uditConfig"
: {!!str "\x69gnoreGhsas": [GHSA-86w9-cpqp-85rv]}
`,
      // js-yaml turns `? [a]` into the key `a`.
      'as a collection used as a key': String.raw`? ["\x61uditConfig"]
: {"\x69gnoreGhsas": [GHSA-86w9-cpqp-85rv]}
`,
      'across an escaped line break in an explicit key': String.raw`? "audit\
  Config"
: {"\x69gnoreGhsas": [GHSA-86w9-cpqp-85rv]}
`,
    };
    for (const [form, text] of Object.entries(forms)) {
      expect(ROUTE.test(text), `${form}: the text names it`).toBe(false);
      expect(workspaceRoutes(text), form).toEqual(decodedAuditConfig);
    }

    // A `!!binary` key: js-yaml reads it as its bytes' numbers, "97,117,…",
    // which sets nothing, but its bytes spell auditConfig, and a key written
    // to hide a word is not read as clean.
    expect(workspaceRoutes('? !!binary YXVkaXRDb25maWc=\n: x\n')).toEqual([
      'pnpm-workspace.yaml: "auditConfig", decoded, names auditConfig',
    ]);
  });

  test('BUG-65: the workspace check refuses a key filled in from the environment, a tag it cannot resolve, and a file that does not parse', () => {
    const filled =
      'pnpm-workspace.yaml: the key "pnpm${TRYGG_UNSET-f}ile" is filled in from the environment before pnpm reads it';
    // Through an alias used as a key, and nested, where pnpm would not fill it
    // in: no key here needs one, so it is refused at any depth.
    expect(workspaceRoutes('name: &hook "pnpm${TRYGG_UNSET-f}ile"\n*hook : hooks.cjs\n')).toEqual([
      filled,
    ]);
    expect(workspaceRoutes('catalog:\n  "pnpm${TRYGG_UNSET-f}ile": x\n')).toEqual([filled]);
    // A sequence used as a key: js-yaml turns `? [a]` into the key `a`, which
    // pnpm then fills in. A mapping used as a key is `[object Object]` to
    // js-yaml, which sets nothing, but its own key is a key, and is refused.
    expect(workspaceRoutes('? ["pnpm${TRYGG_UNSET-f}ile"]\n: hooks.cjs\n')).toEqual([filled]);
    expect(workspaceRoutes('? {"pnpm${TRYGG_UNSET-f}ile": x}\n: hooks.cjs\n')).toEqual([filled]);
    // As a value, it names nothing: pnpm fills in a value but does not read
    // it as a key.
    expect(workspaceRoutes('catalog:\n  zod: ${TRYGG_UNSET-^4.6.6}\n')).toEqual([]);

    // A tag the parser does not know: js-yaml throws on it, `yaml` warns, and
    // the warning is refused, with or without a route word under it.
    expect(
      workspaceRoutes(String.raw`!custom "\x61uditConfig": x
`),
    ).toEqual([
      expect.stringMatching(/^pnpm-workspace\.yaml is not read as clean: Unresolved tag: !custom/),
      'pnpm-workspace.yaml: "auditConfig", decoded, names auditConfig',
    ]);
    expect(workspaceRoutes('!custom packages:\n  - apps/*\n')).toEqual([
      expect.stringMatching(/^pnpm-workspace\.yaml is not read as clean: Unresolved tag: !custom/),
    ]);

    // A file that does not parse is refused, never read as clean: a flow
    // mapping left open, a key twice, two documents. pnpm refuses each too.
    for (const text of [
      String.raw`"\x61uditConfig": {"\x69gnoreGhsas": [GHSA-86w9-cpqp-85rv]
`,
      'packages: [apps/*]\npackages: [packages/*]\n',
      'packages: [apps/*]\n---\nx: 1\n',
    ]) {
      expect(workspaceRoutes(text), text).toEqual([
        expect.stringMatching(/^pnpm-workspace\.yaml is not read as clean: /),
      ]);
    }
  });

  test("BUG-65: the .npmrc check reads names as pnpm's ini parser does, refuses a hook setting however its name is written, and passes today's file", () => {
    // The names, as ini 1.3.8 reads them: comment lines skipped, a section's
    // name, a quoted name JSON-decoded, one in single quotes that is not JSON
    // left as it is, an unquoted one cut at `;` and unescaped.
    const sample = [
      'engine-strict=true',
      '; skipped=1',
      '# skipped=2',
      '[section]',
      `"${asEscapes('quoted')}"=3`,
      `'"${asEscapes('wrapped')}"'=4`,
      "'not json'=5",
      'plain;comment=6',
      'esc\\;aped=7',
      'flag',
    ].join('\n');
    expect(rcNames(sample)).toEqual([
      'engine-strict',
      'section',
      'quoted',
      'wrapped',
      'not json',
      'plain',
      'esc;aped',
      'flag',
    ]);

    // No false positive: today's file, and other settings.
    // RG-03: read through readRc, which refuses a missing .npmrc, where this
    // read a missing one as empty and passed (test-auditor on #105).
    expect(rcRoutes(readRc())).toEqual([]);
    expect(
      rcRoutes('engine-strict=true\nauto-install-peers=true\nstrict-peer-dependencies=false\n'),
    ).toEqual([]);

    // Plain: the text check refuses it, and the decoded name too.
    expect(rcRoutes('pnpmfile=hooks.cjs\n')).toEqual([
      '.npmrc mentions pnpmfile in its text',
      '.npmrc: "pnpmfile", decoded, names pnpmfile',
    ]);
    expect(rcRoutes('global-pnpmfile=hooks.cjs\n')).toEqual([
      '.npmrc mentions pnpmfile in its text',
      '.npmrc: "global-pnpmfile", decoded, names pnpmfile',
    ]);
    // Every character escaped, as a setting and as a section.
    expect(rcRoutes(`"${asEscapes('global-pnpmfile')}"=hooks.cjs\n`)).toEqual([
      '.npmrc: "global-pnpmfile", decoded, names pnpmfile',
    ]);
    expect(rcRoutes(`["${asEscapes('pnpmfile')}"]\nx=1\n`)).toEqual([
      '.npmrc: "pnpmfile", decoded, names pnpmfile',
    ]);
    // JSON first, then the environment: an escaped `$` still comes out as `${`.
    expect(rcRoutes(`"pnpm${asEscapes('$')}{TRYGG_UNSET-f}ile"=hooks.cjs\n`)).toEqual([
      '.npmrc: the key "pnpm${TRYGG_UNSET-f}ile" is filled in from the environment before pnpm reads it',
    ]);
    // A comment line: only the text check sees it, as BUG-11's always has.
    expect(rcRoutes('; pnpmfile=hooks.cjs\n')).toEqual(['.npmrc mentions pnpmfile in its text']);
  });

  test('BUG-65: the workflow checks read each value as GitHub decodes it, a folded run: included, skip a shell comment as the line check does, and refuse a workflow that does not parse', () => {
    const sample = String.raw`jobs:
  security:
    steps:
      - run: >
          pnpm
          audit --ignore-unfixable
      - run: |
          # pnpm config set pnpmfile is not run: a comment
          pnpm audit --audit-level high
      - name: "\x70npmfile in a step's name"
        run: echo
`;
    expect({
      routes: workflowRoutes('sample.yml', sample),
      audits: workflowAudits('sample.yml', sample).map((a) => `${a.read}: ${a.command}`),
    }).toEqual({
      routes: ['sample.yml: "pnpmfile in a step\'s name", decoded, names pnpmfile'],
      audits: [
        'as written: pnpm audit --audit-level high',
        'decoded: pnpm audit --ignore-unfixable',
        'decoded: pnpm audit --audit-level high',
      ],
    });
    // A shell comment after the command, inside a decoded value: only a
    // line that starts with `#` is skipped, because this one still runs.
    const inlineComment = String.raw`jobs:
  security:
    steps:
      - run: "pnpm config set \x70npmfile hooks.cjs # sets the hook"
`;
    expect(workflowRoutes('inline.yml', inlineComment)).toEqual([
      'inline.yml: "pnpm config set pnpmfile hooks.cjs # sets the hook", decoded, names pnpmfile',
    ]);
    expect(workflowRoutes('bad.yml', 'jobs:\n  security: {runs-on: ubuntu-latest\n')).toEqual([
      expect.stringMatching(/^bad\.yml is not read as clean: /),
    ]);
  });

  test('BUG-66: a root .npmrc that points the registry elsewhere is refused', () => {
    // Today's .npmrc with a registry line. pnpm sends the audit to the
    // registry it names: a server that answered every request with no
    // advisories made `pnpm audit --audit-level high` exit 0, "No known
    // vulnerabilities found", where the unchanged file exits 1, "2 high"
    // (2026-10-26).
    const text = 'engine-strict=true\nregistry=http://127.0.0.1:48731/\n';
    expect(
      { text: ROUTE.test(text), bug65: rcRoutes(text) },
      "the fixture passes today's checks: BUG-11's text check and BUG-65's decoded names",
    ).toEqual({ text: false, bug65: [] });
    expect(rcUnlisted(text)).toEqual([
      '.npmrc sets "registry", which is not among the settings it may hold (engine-strict): adding one is a change to this test, and scripts/ is code-owned, so the owner approves it',
    ]);
  });

  test('BUG-66: the root .npmrc holds only the settings it may (RC_SETTINGS)', () => {
    // RG-03: read through readRc, which refuses a missing .npmrc, where this
    // read a missing one as empty and passed (test-auditor on #105).
    expect(
      rcUnlisted(readRc()),
      'the root .npmrc holds a setting outside RC_SETTINGS: pnpm reads it for the install and the audit, and a registry it names decides what the audit reports',
    ).toEqual([]);
  });

  test("BUG-66: the .npmrc allowlist refuses every other setting, a section and a quoted or escaped name included, and passes engine-strict as pnpm's ini parser reads it", () => {
    const unlisted = (name) =>
      `.npmrc sets ${JSON.stringify(name)}, which is not among the settings it may hold (engine-strict): adding one is a change to this test, and scripts/ is code-owned, so the owner approves it`;
    // engine-strict, however ini reads it; no file; and comments, which set
    // nothing.
    for (const text of [
      'engine-strict=true\n',
      'engine-strict = true\r\n',
      '',
      '; registry=http://127.0.0.1:48731/\n# registry=http://127.0.0.1:48731/\nengine-strict=true\n',
    ]) {
      expect(rcUnlisted(text), JSON.stringify(text)).toEqual([]);
    }

    // Each refused, by the name ini decodes; `registry[]`, which ini reads as
    // a list named `registry`, by its name as written. Only `registry` was
    // shown to change the audit; the rest are refused because they are not on
    // the list.
    const refused = {
      'registry=http://127.0.0.1:48731/': 'registry',
      '@trygghverdag:registry=http://127.0.0.1:48731/': '@trygghverdag:registry',
      '//registry.npmjs.org/:_authToken=${NPM_TOKEN}': '//registry.npmjs.org/:_authToken',
      'registry[]=http://127.0.0.1:48731/': 'registry[]',
      [`"${asEscapes('registry')}"=http://127.0.0.1:48731/`]: 'registry',
      [`'"${asEscapes('registry')}"'=http://127.0.0.1:48731/`]: 'registry',
      "'registry'=http://127.0.0.1:48731/": 'registry',
      'proxy=http://127.0.0.1:48732/': 'proxy',
      'https-proxy=http://127.0.0.1:48732/': 'https-proxy',
      'strict-ssl=false': 'strict-ssl',
      'cafile=synthetic-ca.pem': 'cafile',
      'noproxy=*': 'noproxy',
    };
    for (const [line, name] of Object.entries(refused)) {
      expect(rcUnlisted(`engine-strict=true\n${line}\n`), line).toEqual([unlisted(name)]);
    }
    // A lone CR ends a line too: ini splits on `[\r\n]+`. This exact file made
    // `pnpm audit --audit-level high` exit 0 against a registry reporting no
    // advisories (2026-10-26). A CRLF, above, cannot tell the two apart.
    expect(rcUnlisted('engine-strict=true\rregistry=http://127.0.0.1:48731/\n')).toEqual([
      unlisted('registry'),
    ]);
    // A section is a name too, and refused; the allowed name inside it is not.
    expect(rcUnlisted('[registry]\nengine-strict=true\n')).toEqual([unlisted('registry')]);
    // An escaped `registry` passes BUG-65's checks: only the allowlist sees it.
    const escaped = `engine-strict=true\n"${asEscapes('registry')}"=http://127.0.0.1:48731/\n`;
    expect(rcRoutes(escaped)).toEqual([]);
    expect(rcUnlisted(escaped)).toEqual([unlisted('registry')]);
  });

  test("BUG-67: a pnpm-workspace.yaml that points the audit's registry elsewhere is refused", () => {
    // Today's file, its comments left out, with a `registries:` block. pnpm
    // copies the file's top-level keys into its settings, and the audit goes
    // to `registries.default`: a server that answered every request with no
    // advisories made `pnpm audit --audit-level high` exit 0, "No known
    // vulnerabilities found", where the unchanged file exits 1, "2 high"
    // (2026-10-26).
    const text = [
      'packages:',
      '  - apps/*',
      '  - packages/*',
      '',
      'catalog:',
      '  typescript: ~6.0.3',
      '  vitest: ^5.0.1',
      '  zod: ^4.6.6',
      "  '@types/node': ^22.19.4",
      'registries:',
      '  default: http://127.0.0.1:48731/',
      '',
    ].join('\n');
    expect(
      { text: ROUTE.test(text), bug65: workspaceRoutes(text) },
      "the fixture passes today's checks: BUG-11's text check and BUG-65's decoded read",
    ).toEqual({ text: false, bug65: [] });
    expect(workspaceUnlisted(text)).toEqual([
      'pnpm-workspace.yaml sets "registries", which is not among the settings it may hold (packages, catalog): adding one is a change to this test, and scripts/ is code-owned, so the owner approves it',
    ]);
  });

  test('BUG-67: the top-level keys of pnpm-workspace.yaml are only the settings it may hold (WORKSPACE_SETTINGS)', () => {
    const workspace = read('pnpm-workspace.yaml');
    // The reader found the top-level keys, so "no other key" is read, not
    // assumed.
    expect(
      decodedYaml('pnpm-workspace.yaml', workspace).topLevel,
      'the YAML reader did not find the top-level keys of pnpm-workspace.yaml',
    ).toContain('packages');
    expect(
      workspaceUnlisted(workspace),
      'pnpm-workspace.yaml sets a top-level key outside WORKSPACE_SETTINGS: pnpm copies each into its settings, and a `registries` key there decides where the audit asks',
    ).toEqual([]);
  });

  test("BUG-67: the workspace allowlist refuses every other top-level key, however YAML writes it, and passes today's file", () => {
    const unlisted = (key) =>
      `pnpm-workspace.yaml sets ${JSON.stringify(key)}, which is not among the settings it may hold (packages, catalog): adding one is a change to this test, and scripts/ is code-owned, so the owner approves it`;
    const today = 'packages:\n  - apps/*\n  - packages/*\ncatalog:\n  zod: ^4.6.6\n';
    expect(workspaceUnlisted(read('pnpm-workspace.yaml'))).toEqual([]);
    expect(workspaceUnlisted(today)).toEqual([]);

    // Each refused by the name pnpm reads it as. `registries` was shown to
    // redirect the audit; `lockfileDir` was reported to, by #105's
    // privacy-security-reviewer; `overrides` here is BUG-25's route; the
    // rest are refused because they are not on the list.
    const refused = {
      'registries:\n  default: http://127.0.0.1:48731/': 'registries',
      "registries:\n  '@trygghverdag': http://127.0.0.1:48731/": 'registries',
      'registry: http://127.0.0.1:48731/': 'registry',
      'lockfileDir: sub': 'lockfileDir',
      'overrides:\n  zod: 3.25.76': 'overrides',
      'httpsProxy: http://127.0.0.1:48732/': 'httpsProxy',
      'strictSsl: false': 'strictSsl',
      'ca: synthetic-ca': 'ca',
      'auditConfig:\n  ignoreGhsas: [GHSA-86w9-cpqp-85rv]': 'auditConfig',
      '"registries":\n  default: http://127.0.0.1:48731/': 'registries',
      [String.raw`"\x72egistries":
  default: http://127.0.0.1:48731/`]: 'registries',
      '? [registries]\n: {default: http://127.0.0.1:48731/}': 'registries',
      '"regis${TRYGG_UNSET-t}ries":\n  default: http://127.0.0.1:48731/':
        'regis${TRYGG_UNSET-t}ries',
    };
    for (const [block, key] of Object.entries(refused)) {
      expect(workspaceUnlisted(`${today}${block}\n`), block).toEqual([unlisted(key)]);
    }

    // An alias used as a key, its anchor set on a catalog entry.
    expect(
      workspaceUnlisted(
        'packages:\n  - apps/*\ncatalog:\n  zod: &setting registries\n*setting :\n  default: http://127.0.0.1:48731/\n',
      ),
    ).toEqual([unlisted('registries')]);
    // A `<<` merge: js-yaml, pnpm's parser, merges `registries` into the top
    // level; `yaml` keeps `<<` as a key. Both it and the key that holds the
    // anchor are refused.
    expect(
      workspaceUnlisted(
        'defaults: &defaults\n  registries:\n    default: http://127.0.0.1:48731/\npackages:\n  - apps/*\n<<: *defaults\n',
      ),
    ).toEqual([unlisted('defaults'), unlisted('<<')]);

    // The whole file written as one flow mapping: its keys are the top-level
    // keys all the same.
    expect(workspaceUnlisted('{packages: [apps/*], catalog: {zod: ^4.6.6}}\n')).toEqual([]);
    expect(
      workspaceUnlisted(
        '{packages: [apps/*], catalog: {zod: ^4.6.6}, registries: {default: http://127.0.0.1:48731/}}\n',
      ),
    ).toEqual([unlisted('registries')]);

    // A file that does not parse is refused through BUG-65's `unread`, and a
    // top level that is not a mapping, which pnpm refuses too, here.
    expect(workspaceUnlisted('registries: {default: http://127.0.0.1:48731/\n')).toEqual([
      expect.stringMatching(/^pnpm-workspace\.yaml is not read as clean: /),
    ]);
    expect(workspaceUnlisted('- apps/*\n')).toEqual([
      "pnpm-workspace.yaml's top level is not a mapping of settings",
    ]);
  });

  test('BUG-67: a lone CR in pnpm-workspace.yaml hides a registries key from the YAML reader, but not from pnpm', () => {
    // #105's privacy-security-reviewer, at e57543d. pnpm 10.33.0's reader,
    // `@zkochan/js-yaml` 0.0.11, breaks the line at a CR with no LF after it,
    // as the YAML spec does, and reads `registries` as a top-level key:
    // `pnpm audit --audit-level high` exited 0 against a registry reporting
    // no advisories (2026-10-26). `yaml` 2.9.1 keeps the CR inside a plain
    // scalar, with no error or warning.
    const text = [
      'packages:',
      '  - apps/*',
      '  - packages/*\rregistries: {default: "http://127.0.0.1:48731/"}',
      '',
      'catalog:',
      '  typescript: ~6.0.3',
      '  vitest: ^5.0.1',
      '  zod: ^4.6.6',
      "  '@types/node': ^22.19.4",
      '',
    ].join('\n');
    expect(
      { text: ROUTE.test(text), topLevel: decodedYaml('pnpm-workspace.yaml', text).topLevel },
      'the fixture is the bypass: the YAML reader sees only packages and catalog',
    ).toEqual({ text: false, topLevel: ['packages', 'catalog'] });
    const crLine =
      "pnpm-workspace.yaml line 3 has a carriage return that is not part of a CRLF line end: the YAML spec, and pnpm's reader, break the line there, and this reader does not";
    expect({
      routes: workspaceRoutes(text),
      unlisted: workspaceUnlisted(text),
      lines: workspaceLines(text),
    }).toEqual({
      routes: [crLine],
      unlisted: [crLine],
      lines: [
        'pnpm-workspace.yaml line 3, "  - packages/*\\rregistries: {default: \\"http://127.0.0.1:48731/\\"}", is not a line this file may hold: adding a line shape is a change to this test, and scripts/ is code-owned, so the owner approves it',
      ],
    });
  });

  test('BUG-67: a lone CR in a workflow is refused: the YAML spec breaks the line there, and this reader does not', () => {
    // `yaml` reads one key, "echo ok\rrun"; a reader that breaks at the CR
    // reads a different workflow. Not shown to change a GitHub run; refused
    // because the two readings differ.
    const text =
      'jobs:\n  security:\n    steps:\n      - echo ok\rrun: pnpm config set registry http://127.0.0.1:48731/\n      - run: pnpm audit --audit-level high\n';
    expect(workflowRoutes('cr.yml', text)).toEqual([
      "cr.yml line 4 has a carriage return that is not part of a CRLF line end: the YAML spec, and pnpm's reader, break the line there, and this reader does not",
    ]);
  });

  test("BUG-67: the line grammar refuses every line shape but those today's file uses, without a YAML parser", () => {
    // A copy of today's file with one more package glob and one more catalog
    // entry: the shapes it already uses.
    const grown = [
      '# A comment.',
      'packages:',
      '  - apps/*',
      '  - packages/*',
      '  - tools/*',
      '',
      'catalog:',
      '  typescript: ~6.0.3',
      '  vitest: ^5.0.1',
      '  zod: ^4.6.6',
      "  '@types/node': ^22.19.4",
      '  fast-check: ^4.10.2',
      '',
    ].join('\n');
    expect(workspaceLines(grown)).toEqual([]);

    const today = 'packages:\n  - apps/*\n  - packages/*\ncatalog:\n  zod: ^4.6.6\n';
    const breakIn = (code) => `packages:\n  - apps/*${String.fromCharCode(code)}registries: x\n`;
    const refused = {
      'a lone CR': 'packages:\n  - apps/*\rregistries: {default: x}\ncatalog:\n  zod: ^4.6.6\n',
      'a CRLF copy': today.replace(/\n/g, '\r\n'),
      'a flow mapping': '{packages: [apps/*], catalog: {zod: ^4.6.6}}\n',
      'a double-quoted key': 'packages:\n  - apps/*\n"catalog":\n  zod: ^4.6.6\n',
      'an escaped key': String.raw`packages:
  - apps/*
"\x72egistries":
  default: http://127.0.0.1:48731/
`,
      'an anchor and an alias': 'packages:\n  - &glob apps/*\n  - *glob\n',
      'a tag': 'packages:\n  - !!str apps/*\n',
      'a << merge': 'packages:\n  - apps/*\n<<: {registries: {default: x}}\n',
      'a registries line': `${today}registries:\n  default: http://127.0.0.1:48731/\n`,
      'a top-level overrides': `${today}overrides:\n  zod: ^4.6.6\n`,
      'a tab-indented line': 'packages:\n\t- apps/*\n',
      'an inline comment after a value': 'catalog:\n  zod: ^4.6.6 # pinned\n',
      'a NEL': breakIn(0x85),
      'an LS': breakIn(0x2028),
      'a PS': breakIn(0x2029),
      // YAML reads these first characters as a tag, an alias and a folded
      // scalar, which is why a glob or a range may not start with them.
      'a glob that starts with !': 'packages:\n  - !apps/*\n',
      'a glob that starts with *': 'packages:\n  - */apps\n',
      'a range that starts with >': 'catalog:\n  zod: >=4.6.6\n',
      'packages: twice': `${today}packages:\n  - tools/*\n`,
      'a catalog entry under packages': 'packages:\n  - apps/*\n  zod: ^4.6.6\n',
      // test-auditor on #105, at a0c11ed: two claims the grammar's comment
      // made that no fixture pinned, and the NEL above being refused by the
      // glob's characters rather than by the line-break rule.
      'a range that starts with |': 'catalog:\n  zod: |\n',
      'a header with a value': 'packages: [apps/*]\n',
      'a NEL inside a comment': '# x\x85registries: x',
    };
    // One assertion, so a failure names every fixture let through.
    expect(
      Object.entries(refused)
        .filter(([, text]) => workspaceLines(text).length === 0)
        .map(([name]) => name),
      'let through by the line grammar',
    ).toEqual([]);
    // The YAML-reading checks let these through, so the grammar is the only
    // layer that refuses them; they refuse the rest as well. Some set nothing
    // pnpm reads (a CRLF, a NEL, a comment), but each is a shape this test
    // does not need to read. The undefined alias `*/apps` is a parse error
    // to pnpm's reader and none to `yaml`'s parseDocument: one more drift.
    expect(
      Object.entries(refused)
        .filter(([, text]) => [...workspaceRoutes(text), ...workspaceUnlisted(text)].length === 0)
        .map(([name]) => name),
    ).toEqual([
      'a CRLF copy',
      'a flow mapping',
      'a double-quoted key',
      'an anchor and an alias',
      'a tag',
      'an inline comment after a value',
      'a NEL',
      'an LS',
      'a PS',
      'a glob that starts with *',
      // RG-03: three entries added with test-auditor's three fixtures above,
      // which the YAML-reading checks let through too. Nothing is removed.
      'a range that starts with |',
      'a header with a value',
      'a NEL inside a comment',
    ]);
  });

  test('BUG-67: each claim of the line grammar has a fixture that fails for that claim alone, or passes where the claim allows', () => {
    // The line under test is the only one that may fail: it is added at the
    // end of `packages:` (line 3), of `catalog:` (line 5), or at the top
    // (line 1), among lines the grammar passes. Each entry is [text, lines
    // refused].
    const underPackages = (line) => `packages:\n  - apps/*\n${line}\ncatalog:\n  zod: ^4.6.6\n`;
    const underCatalog = (line) => `packages:\n  - apps/*\ncatalog:\n  zod: ^4.6.6\n${line}\n`;
    const atTop = (line) => `${line}\npackages:\n  - apps/*\n`;
    const char = (code) => String.fromCharCode(code);
    const claims = {
      'lines split on LF alone: a CRLF line end ends no line': [
        'packages:\r\n  - apps/*\r\n',
        [1, 2],
      ],
      'the line-break rule: a NEL in a comment, which `.` matches': [
        atTop(`# x${char(0x85)}registries: x`),
        [1],
      ],
      'the line-break rule: a CR in a comment': [atTop('# x\rregistries: x'), [1]],
      'the line-break rule: an LS in a comment': [atTop(`# x${char(0x2028)}registries: x`), [1]],
      'the line-break rule: a PS in a comment': [atTop(`# x${char(0x2029)}registries: x`), [1]],
      'a blank line is empty: not spaces': [underPackages('  '), [3]],
      'a blank line may sit anywhere': [underPackages(''), []],
      'a comment may follow spaces': [underPackages('  # a comment'), []],
      'a comment may not follow a tab': [underPackages('\t# a comment'), [3]],
      'a comment is a whole line: not after a glob': [underPackages('  - tools/* # x'), [3]],
      'a comment is a whole line: not after an entry': [underCatalog('  vitest: ^5.0.1 # x'), [5]],
      'a header is exactly `packages:`: not with a value': ['packages: [apps/*]\n', [1]],
      'a header is exactly `catalog:`: not with a trailing space': [
        'catalog: \n  zod: ^4.6.6\n',
        [1, 2],
      ],
      '`packages:` at most once, and nothing under the second': [
        'packages:\n  - apps/*\npackages:\n  - tools/*\n',
        [3, 4],
      ],
      '`catalog:` at most once, and nothing under the second': [
        'catalog:\n  zod: ^4.6.6\ncatalog:\n  vitest: ^5.0.1\n',
        [3, 4],
      ],
      'no other top-level key, and nothing under one is in a section': [
        'packages:\n  - apps/*\nregistries:\n  - tools/*\n',
        [3, 4],
      ],
      'nothing indented before a header': ['  - apps/*\npackages:\n  - tools/*\n', [1]],
      'a glob only under `packages:`': ['catalog:\n  - apps/*\n', [2]],
      'an entry only under `catalog:`': ['packages:\n  zod: ^4.6.6\n', [2]],
      'a glob is indented by two spaces: not three': [underPackages('   - tools/*'), [3]],
      'a glob is indented by two spaces: not one': [underPackages(' - tools/*'), [3]],
      'a glob follows `- `: not `-` alone': [underPackages('  -tools/*'), [3]],
      'a glob is not empty': [underPackages('  - '), [3]],
      'an entry is indented by two spaces: not three': [underCatalog('   vitest: ^5.0.1'), [5]],
      'an entry is indented by two spaces: not one': [underCatalog(' vitest: ^5.0.1'), [5]],
      'an entry has `: ` between name and range: not `:` alone': [
        underCatalog('  vitest:^5.0.1'),
        [5],
      ],
      'a range is not empty': [underCatalog('  vitest: '), [5]],
      'a scoped name is single-quoted: not bare': [underCatalog('  @types/react: ^19.0.0'), [5]],
      'a scoped name is single-quoted: not double-quoted': [
        underCatalog('  "@types/react": ^19.0.0'),
        [5],
      ],
    };
    // Each character class, both ways: every character the comment allows
    // passes, and every one of these others is refused, each in a line that
    // fits but for it. Letters and digits are allowed in every class.
    const others = [
      '|',
      '>',
      '-',
      '!',
      '*',
      '@',
      '&',
      '{',
      '}',
      '[',
      ']',
      ',',
      '#',
      "'",
      '"',
      ':',
      '%',
      '\t',
      ' ',
    ];
    const classes = [
      ['a glob first character', '_.', (c) => underPackages(`  - ${c}tools/*`), 3],
      ['a glob character', '_./*@!-', (c) => underPackages(`  - tools/a${c}b`), 3],
      ['a catalog name character', '_.-', (c) => underCatalog(`  vit${c}est: ^5.0.1`), 5],
      [
        'a quoted catalog name character',
        '_.@/-',
        (c) => underCatalog(`  '@types/re${c}act': ^19.0.0`),
        5,
      ],
      ['a range first character', '^~<=', (c) => underCatalog(`  vitest: ${c}5.0.1`), 5],
      ['a range character', '.^~<>=| +-', (c) => underCatalog(`  vitest: ^5.0${c}1`), 5],
    ];
    for (const [where, allowed, fixture, line] of classes) {
      for (const c of allowed) claims[`${where} may be ${JSON.stringify(c)}`] = [fixture(c), []];
      for (const c of others.filter((o) => !allowed.includes(o))) {
        claims[`${where} may not be ${JSON.stringify(c)}`] = [fixture(c), [line]];
      }
    }
    const refusedLines = (text) =>
      workspaceLines(text).map((finding) => Number(/ line (\d+), /.exec(finding)[1]));
    // One assertion, so a failure names every claim that no longer holds.
    expect(
      Object.fromEntries(
        Object.entries(claims).map(([claim, [text]]) => [claim, refusedLines(text)]),
      ),
    ).toEqual(
      Object.fromEntries(Object.entries(claims).map(([claim, [, lines]]) => [claim, lines])),
    );

    // The message quotes the line as JSON, every character outside printable
    // ASCII as a `\u` escape, so a NEL shows.
    expect(workspaceLines(`# x${char(0x85)}registries: x`)).toEqual([
      'pnpm-workspace.yaml line 1, "# x\\' +
        'u0085registries: x", is not a line this file may hold: adding a line shape is a change to this test, and scripts/ is code-owned, so the owner approves it',
    ]);
  });

  test("BUG-67: today's pnpm-workspace.yaml holds only the line shapes it may (WORKSPACE_LINE)", () => {
    expect(
      workspaceLines(read('pnpm-workspace.yaml')),
      'pnpm-workspace.yaml holds a line outside the shapes this test reads without a YAML parser: pnpm copies its top-level keys into its settings, and a line a parser reads differently from pnpm can hide one',
    ).toEqual([]);
  });

  test('BUG-66, BUG-67: the root .npmrc is exactly `engine-strict=true`, compared byte for byte, with no parser to drift from pnpm', () => {
    expect(
      readRc(),
      'the root .npmrc is not exactly "engine-strict=true\\n": pnpm reads its settings for the install and the audit. Changing it is a change to this test, and scripts/ is code-owned, so the owner approves it',
    ).toBe('engine-strict=true\n');
  });

  test('BUG-69: a script shell set in pnpm-workspace.yaml or the root .npmrc is refused, by the line grammar and WORKSPACE_SETTINGS, and by RC_SETTINGS', () => {
    // These checks protect only while they run. In CI they run through
    // `pnpm run test:unit`, and either line below makes pnpm run every
    // script with /bin/true, this file's run included, so the check goes
    // green having run nothing (pnpm 10.33.0, 2026-10-26). There the
    // code-owner lines of D-144 are what hold. The byte pin above refuses the
    // .npmrc line too, and needs no fixture: it compares the file with one
    // exact string, and failed on this line in a scratch copy (2026-10-26).
    const workspace =
      'packages:\n  - apps/*\n  - packages/*\ncatalog:\n  zod: ^4.6.6\nscriptShell: /bin/true\n';
    const rc = 'engine-strict=true\nscript-shell=/bin/true\n';

    expect(
      {
        text: [ROUTE.test(workspace), ROUTE.test(rc)],
        bug65: [...workspaceRoutes(workspace), ...rcRoutes(rc)],
      },
      "the fixtures pass BUG-11's text check and BUG-65's decoded read: only the grammar and the allowlists refuse them",
    ).toEqual({ text: [false, false], bug65: [] });
    expect(workspaceLines(workspace)).toEqual([
      'pnpm-workspace.yaml line 6, "scriptShell: /bin/true", is not a line this file may hold: adding a line shape is a change to this test, and scripts/ is code-owned, so the owner approves it',
    ]);
    expect(workspaceUnlisted(workspace)).toEqual([
      'pnpm-workspace.yaml sets "scriptShell", which is not among the settings it may hold (packages, catalog): adding one is a change to this test, and scripts/ is code-owned, so the owner approves it',
    ]);
    expect(rcUnlisted(rc)).toEqual([
      '.npmrc sets "script-shell", which is not among the settings it may hold (engine-strict): adding one is a change to this test, and scripts/ is code-owned, so the owner approves it',
    ]);
  });

  test("BUG-69: no .npmrc, pnpm-workspace.yaml or .pnpmfile.cjs is in the repository but the root's two and the spike's workspace file, so no package's scripts run with a shell a pull request chose", () => {
    // turbo runs each package's script from that package's folder, and pnpm
    // reads the .npmrc and pnpm-workspace.yaml there. With a type error in
    // apps/server, `pnpm exec turbo run typecheck
    // --filter=@trygghverdag/server --force` exits 2; with an apps/server/.npmrc
    // holding `script-shell=/bin/true` it exits 0, "4 successful" (pnpm
    // 10.33.0, 2026-10-26; privacy-security-reviewer's S1 on #105). A
    // package's pnpm-workspace.yaml with `scriptShell` did the same, by the
    // reviewer's report. A package's .pnpmfile.cjs alone did not, and is
    // refused all the same.
    //
    // The files this refuses cannot switch it off. It runs in the root
    // Vitest run, which `pnpm run test:unit` starts from the root: a
    // package's own file does not reach a run started there, and the root
    // .npmrc, pnpm-workspace.yaml and Vitest configuration it does read are
    // code-owned (D-082, D-144).
    const found = pnpmSettingsFiles(root);

    expect(found, 'the walk did not find the root .npmrc, so it read nothing').toContain('.npmrc');
    expect(
      found.filter((file) => !PNPM_SETTINGS_ALLOWED.includes(file)),
      'a file that sets pnpm settings for the folder it is in: a script run there, as turbo runs every package script, can be given a shell that runs nothing',
    ).toEqual([]);
  });

  test('BUG-69: the walk finds each of those files in a package folder and deeper, skips node_modules, .git and .stryker-tmp, and passes a tree with none', () => {
    const top = mkdtempSync(path.join(tmpdir(), 'bug-69-'));
    const put = (file) => {
      mkdirSync(path.dirname(path.join(top, file)), { recursive: true });
      writeFileSync(path.join(top, file), 'synthetic\n');
    };
    try {
      put('apps/server/package.json');
      put('apps/server/src/index.ts');
      expect(pnpmSettingsFiles(top), 'a tree with none').toEqual([]);

      put('apps/server/.npmrc');
      put('packages/contracts/pnpm-workspace.yaml');
      put('packages/contracts/src/deep/.pnpmfile.cjs');
      put('apps/server/node_modules/some-package/.npmrc');
      put('.git/hooks/.npmrc');
      put('.stryker-tmp/sandbox-synthetic/.npmrc');
      put('.stryker-tmp/sandbox-synthetic/apps/server/.npmrc');
      put('apps/server/.npmrc.bak');
      expect(pnpmSettingsFiles(top)).toEqual([
        'apps/server/.npmrc',
        'packages/contracts/pnpm-workspace.yaml',
        'packages/contracts/src/deep/.pnpmfile.cjs',
      ]);
    } finally {
      rmSync(top, { recursive: true, force: true });
    }
  });

  test('BUG-69: pnpm-workspace.yaml and package.json each name exactly the five package folders, with no glob, so a new folder under apps/ or packages/ is no workspace package until the owner approves a line for it', () => {
    const lists = workspaceLists();
    const globs = (list) =>
      (Array.isArray(list) ? list : [list]).filter((entry) => WORKSPACE_GLOB.test(String(entry)));

    expect(
      { pnpm: globs(lists.pnpm), manifest: globs(lists.manifest) },
      'workspace entries that are globs: a pull request that adds a package.json under one becomes a workspace package, and CI installs it and runs its install scripts with no owner approving it (B1)',
    ).toEqual({ pnpm: [], manifest: [] });
    expect({
      pnpm: Array.isArray(lists.pnpm) ? lists.pnpm.toSorted() : lists.pnpm,
      manifest: Array.isArray(lists.manifest) ? lists.manifest.toSorted() : lists.manifest,
    }).toEqual({ pnpm: WORKSPACE_FOLDERS, manifest: WORKSPACE_FOLDERS });
  });

  test("BUG-69: each package folder the workspace names has a package.json, and it is a path the owner must approve, so a named package's install scripts cannot change unseen", () => {
    const lists = workspaceLists();
    const named = [
      ...new Set([
        ...WORKSPACE_FOLDERS,
        ...(Array.isArray(lists.pnpm) ? lists.pnpm : []),
        ...(Array.isArray(lists.manifest) ? lists.manifest : []),
      ]),
    ];
    // An owner path covers a file when it is that file, or a folder it is in.
    const owned = (file) =>
      OWNER_APPROVAL_PATHS.some(
        (owner) => owner === `/${file}` || (owner.endsWith('/') && `/${file}`.startsWith(owner)),
      );

    expect(
      named.filter((folder) => !existsSync(path.join(root, String(folder), 'package.json'))),
      'workspace entries that are not a folder with a package.json',
    ).toEqual([]);
    expect(
      named.map((folder) => `${folder}/package.json`).filter((file) => !owned(file)),
      "workspace packages whose package.json is no path the owner must approve: its install scripts run in CI's install",
    ).toEqual([]);
  });

  test('BUG-69: every folder under apps/ and packages/ that has a package.json is one both workspace lists name, so none is left out of the workspace unseen', () => {
    const lists = workspaceLists();
    const names = (list, folder) => Array.isArray(list) && list.includes(folder);
    const found = ['apps', 'packages'].flatMap((parent) =>
      readdirSync(path.join(root, parent), { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() && existsSync(path.join(root, parent, entry.name, 'package.json')),
        )
        .map((entry) => `${parent}/${entry.name}`),
    );

    // The walk found the packages, so "none is left out" is read, not assumed.
    expect(found, 'the walk found no package under apps/').toContain('apps/server');
    expect(
      found.filter((folder) => !names(lists.pnpm, folder) || !names(lists.manifest, folder)),
      'folders with a package.json that pnpm-workspace.yaml or package.json does not name',
    ).toEqual([]);
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

  test("BUG-64: every zod that apps/server and packages/contracts reach is 4.6.6 or later, so D-143's ignore hides nothing there", () => {
    const lock = readLockfile(read('pnpm-lock.yaml'));

    expect(
      lock.lockfileVersion,
      'pnpm-lock.yaml is not lockfile v9, the form this reader knows',
    ).toMatch(/^9\./);
    // The walk reaches both from zod at all, so "neither reaches a zod short
    // of 4.6.6" is walked, not assumed.
    expect(
      [...importersReaching(lock, 'zod').keys()],
      'the walk did not reach apps/server and packages/contracts from zod',
    ).toEqual(expect.arrayContaining(D143_FIXED_IN));
    expect(zodFixChanges(lock), D143_FIX_SHORT).toEqual([]);
  });

  test("BUG-64: D-143's premise holds in the lockfile: the only zod short of 4.6.6 is the one @expo/cli depends on, reached from apps/mobile alone", () => {
    const lock = readLockfile(read('pnpm-lock.yaml'));

    expect(
      lock.lockfileVersion,
      'pnpm-lock.yaml is not lockfile v9, the form this reader knows',
    ).toMatch(/^9\./);
    // The reader found the app depending on expo, so "only apps/mobile
    // reaches it" is read, not assumed.
    expect(
      dependentsOf(lock, 'expo').importers,
      'the lockfile reader did not find apps/mobile depending on expo',
    ).toContain('apps/mobile');
    expect(zodPremiseChanges(lock), D143_PREMISE_CHANGED).toEqual([]);
  });

  test('BUG-64: the zod checks fail when the server or the contracts reach a zod short of 4.6.6, by a dependency, a dev dependency, an alias, a peer or a link, and on a second one anywhere else, even at the version @expo/cli holds', () => {
    // The shape D-143 was decided on: apps/mobile > expo > @expo/cli > zod
    // 3.25.76, and every other zod at 4.6.6.
    const sample = readLockfile(ZOD_SAMPLE_LOCK);
    expect(sample.lockfileVersion).toBe('9.0');
    expect(zodShortOfFix(sample)).toEqual(['zod@3.25.76']);
    expect([...importersReaching(sample, 'zod').keys()]).toEqual([
      'apps/mobile',
      'apps/server',
      'packages/contracts',
    ]);
    expect([...importersReachingFrom(sample, zodShortOfFix(sample))]).toEqual([
      [
        'apps/mobile',
        [
          'apps/mobile',
          'expo@57.0.25(react@19.2.3)',
          '@expo/cli@57.0.27(expo@57.0.25(react@19.2.3))',
          'zod@3.25.76',
        ],
      ],
    ]);
    expect(zodFixChanges(sample)).toEqual([]);
    expect(zodPremiseChanges(sample)).toEqual([]);

    const fixOf = (text) => zodFixChanges(readLockfile(text));
    const premiseOf = (text) => zodPremiseChanges(readLockfile(text));
    // A package added at the end of both sections, with its snapshot's
    // dependencies. Where it sits does not change what the reader finds.
    const quoted = (name) => (name.startsWith('@') ? `'${name}'` : name);
    const withPackage = (text, key, dependencies = {}) => {
      const lines = Object.entries(dependencies).map(([n, v]) => `      ${quoted(n)}: ${v}\n`);
      const snapshot =
        lines.length === 0
          ? `  ${quoted(key)}: {}\n`
          : `  ${quoted(key)}:\n    dependencies:\n${lines.join('')}`;
      return `${edited(text, ['\nsnapshots:\n', `\n  ${quoted(key)}:\n    resolution: {integrity: sha512-synthetic}\n\nsnapshots:\n`])}\n${snapshot}`;
    };
    const serverDeps = '  apps/server:\n    dependencies:\n';
    const serverDevEnd = '        version: 5.0.1\n\n  packages/contracts:\n';
    const mobileExpo = '        version: 57.0.25(react@19.2.3)\n';

    // The lockfile the audit failed on: the server and the contracts at
    // 4.6.5, the catalog's version then.
    const before = edited(
      ZOD_SAMPLE_LOCK,
      ['zod@4.6.6', 'zod@4.6.5'],
      ['zod: 4.6.6', 'zod: 4.6.5'],
      ['version: 4.6.6', 'version: 4.6.5'],
    );
    expect(fixOf(before)).toEqual([
      'apps/server reaches a zod short of 4.6.6: apps/server > zod@4.6.5',
      'packages/contracts reaches a zod short of 4.6.6: packages/contracts > zod@4.6.5',
    ]);
    expect(premiseOf(before)).toEqual([
      'the packages that depend on a zod short of 4.6.6 (3.25.76, 4.6.5) are [@expo/cli, @orpc/zod], not [@expo/cli]',
      'workspace packages depend on a zod short of 4.6.6 directly: apps/server, packages/contracts',
      'the workspace packages that reach a zod short of 4.6.6 are [apps/mobile, apps/server, packages/contracts], not [apps/mobile]',
      'apps/server reaches a zod short of 4.6.6: apps/server > zod@4.6.5',
      'packages/contracts reaches a zod short of 4.6.6: packages/contracts > zod@4.6.5',
    ]);

    // The server's zod at @expo/cli's own version, through an alias: the
    // version string alone is the accepted one.
    const serverAlias = edited(ZOD_SAMPLE_LOCK, [
      serverDeps,
      `${serverDeps}      legacy-zod:\n        specifier: npm:zod@^3.25.76\n        version: zod@3.25.76\n`,
    ]);
    expect(zodShortOfFix(readLockfile(serverAlias))).toEqual(['zod@3.25.76']);
    expect(fixOf(serverAlias)).toEqual([
      'apps/server reaches a zod short of 4.6.6: apps/server > zod@3.25.76',
    ]);
    expect(premiseOf(serverAlias)).toEqual([
      'workspace packages depend on a zod short of 4.6.6 directly: apps/server',
      'the workspace packages that reach a zod short of 4.6.6 are [apps/mobile, apps/server], not [apps/mobile]',
      'apps/server reaches a zod short of 4.6.6: apps/server > zod@3.25.76',
    ]);

    // The server reaches one through a dev dependency, which the ignore hides
    // as much as any other.
    const serverDev = withPackage(
      withPackage(
        edited(ZOD_SAMPLE_LOCK, [
          serverDevEnd,
          `        version: 5.0.1\n      '@synthetic/migrator':\n        specifier: ^1.0.0\n        version: 1.0.0\n\n  packages/contracts:\n`,
        ]),
        '@synthetic/migrator@1.0.0',
        { zod: '3.24.1' },
      ),
      'zod@3.24.1',
    );
    expect(fixOf(serverDev)).toEqual([
      'apps/server reaches a zod short of 4.6.6: apps/server > @synthetic/migrator@1.0.0 > zod@3.24.1',
    ]);
    expect(premiseOf(serverDev)).toEqual([
      'the packages that depend on a zod short of 4.6.6 (3.25.76, 3.24.1) are [@expo/cli, @synthetic/migrator], not [@expo/cli]',
      'the workspace packages that reach a zod short of 4.6.6 are [apps/mobile, apps/server], not [apps/mobile]',
      'apps/server reaches a zod short of 4.6.6: apps/server > @synthetic/migrator@1.0.0 > zod@3.24.1',
    ]);

    // The server links the app, and so reaches @expo/cli's own zod: only the
    // link shows it.
    const serverLinksMobile = edited(ZOD_SAMPLE_LOCK, [
      serverDeps,
      `${serverDeps}      '@trygghverdag/mobile':\n        specifier: workspace:*\n        version: link:../mobile\n`,
    ]);
    expect(fixOf(serverLinksMobile)).toEqual([
      'apps/server reaches a zod short of 4.6.6: apps/server > apps/mobile > expo@57.0.25(react@19.2.3) > @expo/cli@57.0.27(expo@57.0.25(react@19.2.3)) > zod@3.25.76',
    ]);
    expect(premiseOf(serverLinksMobile)).toEqual([
      'the workspace packages that reach a zod short of 4.6.6 are [apps/mobile, apps/server], not [apps/mobile]',
      'apps/server reaches a zod short of 4.6.6: apps/server > apps/mobile > expo@57.0.25(react@19.2.3) > @expo/cli@57.0.27(expo@57.0.25(react@19.2.3)) > zod@3.25.76',
    ]);

    // The contracts' `@orpc/zod` resolves its zod peer to @expo/cli's 3.25.76,
    // though the contracts' own zod is fixed. The server links the contracts,
    // so it reaches it too.
    const peerOld = edited(
      ZOD_SAMPLE_LOCK,
      ['1.15.3(zod@4.6.6)', '1.15.3(zod@3.25.76)'],
      ['      zod: 4.6.6\n', '      zod: 3.25.76\n'],
    );
    expect(fixOf(peerOld)).toEqual([
      'apps/server reaches a zod short of 4.6.6: apps/server > packages/contracts > @orpc/zod@1.15.3(zod@3.25.76) > zod@3.25.76',
      'packages/contracts reaches a zod short of 4.6.6: packages/contracts > @orpc/zod@1.15.3(zod@3.25.76) > zod@3.25.76',
    ]);
    expect(premiseOf(peerOld)).toEqual([
      'the packages that depend on a zod short of 4.6.6 (3.25.76) are [@expo/cli, @orpc/zod], not [@expo/cli]',
      'the workspace packages that reach a zod short of 4.6.6 are [apps/mobile, apps/server, packages/contracts], not [apps/mobile]',
      'apps/server reaches a zod short of 4.6.6: apps/server > packages/contracts > @orpc/zod@1.15.3(zod@3.25.76) > zod@3.25.76',
      'packages/contracts reaches a zod short of 4.6.6: packages/contracts > @orpc/zod@1.15.3(zod@3.25.76) > zod@3.25.76',
    ]);

    // A zod the check cannot compare with 4.6.6 cannot be called fixed.
    const tarball = withPackage(
      edited(ZOD_SAMPLE_LOCK, [
        "        specifier: 'catalog:'\n        version: 4.6.6\n",
        '        specifier: https://example.invalid/zod-4.6.6.tgz\n        version: https://example.invalid/zod-4.6.6.tgz\n',
      ]),
      'zod@https://example.invalid/zod-4.6.6.tgz',
    );
    expect(fixOf(tarball)).toEqual([
      'apps/server reaches a zod short of 4.6.6: apps/server > zod@https://example.invalid/zod-4.6.6.tgz',
      'packages/contracts reaches a zod short of 4.6.6: packages/contracts > zod@https://example.invalid/zod-4.6.6.tgz',
    ]);

    // The fix check passes on every case below; only the premise sees them.
    //
    // The root reaches one through Stryker, as the lockfile did when the audit
    // failed (`. > @stryker-mutator/core > mutation-server-protocol > zod
    // 4.6.5`), a path the audit's output did not list.
    const rootStryker = withPackage(
      withPackage(
        withPackage(
          edited(ZOD_SAMPLE_LOCK, [
            '  .:\n    devDependencies:\n',
            "  .:\n    devDependencies:\n      '@stryker-mutator/core':\n        specifier: ^10.0.0\n        version: 10.0.0\n",
          ]),
          '@stryker-mutator/core@10.0.0',
          { 'mutation-server-protocol': '0.4.1' },
        ),
        'mutation-server-protocol@0.4.1',
        { zod: '4.6.5' },
      ),
      'zod@4.6.5',
    );
    expect(premiseOf(rootStryker)).toEqual([
      'the packages that depend on a zod short of 4.6.6 (3.25.76, 4.6.5) are [@expo/cli, mutation-server-protocol], not [@expo/cli]',
      'the workspace packages that reach a zod short of 4.6.6 are [., apps/mobile], not [apps/mobile]',
      '. reaches a zod short of 4.6.6: . > @stryker-mutator/core@10.0.0 > mutation-server-protocol@0.4.1 > zod@4.6.5',
    ]);

    // A second zod at @expo/cli's own 3.25.76, under another package in the
    // app: the same version string, the same importer, and only its
    // dependent shows it. A check by version string would pass it.
    const secondAtExpos = withPackage(
      edited(ZOD_SAMPLE_LOCK, [
        mobileExpo,
        `${mobileExpo}      '@synthetic/forms':\n        specifier: ^2.0.0\n        version: 2.0.0\n`,
      ]),
      '@synthetic/forms@2.0.0',
      { zod: '3.25.76' },
    );
    expect(zodShortOfFix(readLockfile(secondAtExpos))).toEqual(['zod@3.25.76']);
    expect(premiseOf(secondAtExpos)).toEqual([
      'the packages that depend on a zod short of 4.6.6 (3.25.76) are [@expo/cli, @synthetic/forms], not [@expo/cli]',
    ]);

    // The app itself depends on @expo/cli's zod directly: the importer is the
    // accepted one, the path is not.
    const mobileDirect = edited(ZOD_SAMPLE_LOCK, [
      mobileExpo,
      `${mobileExpo}      zod:\n        specifier: ^3.25.76\n        version: 3.25.76\n`,
    ]);
    expect(premiseOf(mobileDirect)).toEqual([
      'workspace packages depend on a zod short of 4.6.6 directly: apps/mobile',
    ]);

    // Expo moves @expo/cli to a fixed zod: D-143's exception is no longer
    // needed, and the ignore should go.
    const expoFixed = edited(
      ZOD_SAMPLE_LOCK,
      ['      zod: 3.25.76\n', '      zod: 4.6.6\n'],
      ['  zod@3.25.76:\n    resolution: {integrity: sha512-synthetic}\n\n', ''],
      ['  zod@3.25.76: {}\n\n', ''],
    );
    expect(premiseOf(expoFixed)).toEqual([
      "no zod short of 4.6.6 is locked: @expo/cli no longer needs D-143's exception, so remove the ignore",
    ]);

    for (const text of [rootStryker, secondAtExpos, mobileDirect, expoFixed]) {
      expect(fixOf(text)).toEqual([]);
    }
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
  const fixes = PATCHED.map((fix) => ({ ...fix, range: rangeOf(fix) }));

  test.each(fixes)(
    '$bug: the lockfile holds no $name in $range, which $fixedAt fixes ($advisory)',
    (fix) => {
      const lock = readLockfile(read('pnpm-lock.yaml'));

      expect(
        lock.lockfileVersion,
        'pnpm-lock.yaml is not lockfile v9, the form this reader knows',
      ).toMatch(/^9\./);
      // The reader found keys in both sections, so "none in the range" is
      // read, not assumed: vitest, the runner of this very file, is locked in
      // each.
      expect(
        lock.packages.filter((key) => packageName(key) === 'vitest'),
        'the lockfile reader found no vitest among the packages keys',
      ).not.toEqual([]);
      expect(
        [...lock.snapshots.keys()].filter((key) => packageName(key) === 'vitest'),
        'the lockfile reader found no vitest among the snapshots keys',
      ).not.toEqual([]);
      expect(
        shortOfFix(lock, fix),
        `the lockfile resolves a ${fix.name} in ${fix.range}: ${fix.advisory} fails the audit on every pull request`,
      ).toEqual([]);
    },
  );

  test("BUG-61: the root package.json names vite as a dev dependency with a floor of 8.3.3 or later, the only way found to move vitest's auto-installed peer past GHSA-587h-7wmj-h5pm", () => {
    const fix = PATCHED.find(({ bug }) => bug === 'BUG-61');
    expect(fix, 'PATCHED has no row for BUG-61').toBeDefined();
    const specifier = manifest.devDependencies?.vite;

    expect(specifier, VITE_FLOOR_WHY).toEqual(expect.any(String));
    const floor = floorOf(specifier);
    expect(
      floor,
      `${VITE_FLOOR_WHY}. Its specifier, ${specifier}, has no floor this reads`,
    ).not.toBeNull();
    expect(placeAgainst(floor, fix), VITE_FLOOR_WHY).toBe('fixed');
  });

  test('BUG-61: the floor read from a dev dependency: a caret, a tilde or an exact version, and nothing else', () => {
    const fix = PATCHED.find(({ bug }) => bug === 'BUG-61');
    const read = (specifier) => {
      const floor = floorOf(specifier);
      return floor === null ? 'no floor' : placeAgainst(floor, fix);
    };

    expect(['^8.3.3', '~8.3.3', '8.3.3', '^8.3.4', '^9.0.0'].map(read)).toEqual([
      'fixed',
      'fixed',
      'fixed',
      'fixed',
      'fixed',
    ]);
    // The lockfile's 8.3.0 and the 8.2 line's own fix: below the floor.
    expect(['^8.3.0', '^8.2.4', '~8.3.2', '8.3.0'].map(read)).toEqual([
      'in range',
      'in range',
      'in range',
      'in range',
    ]);
    // Forms with no single floor to read: each fails the test above.
    expect(
      ['>=8.3.3', '8.x', '*', 'latest', 'catalog:', 'workspace:*', '^8.3', '', undefined].map(read),
    ).toEqual(Array.from({ length: 9 }, () => 'no floor'));
  });

  test('BUG-23, BUG-24, BUG-61, BUG-64: the check fails on a lockfile holding source-map-js 1.2.1, shell-quote 1.10.0, vite 8.3.0 or undici 8.11.0, in either section, and passes on one holding only 1.2.2, 1.11.0, 8.3.3 and 8.12.2 or later', () => {
    // RG-03, BUG-64: renamed from "BUG-23, BUG-24, BUG-61: … source-map-js
    // 1.2.1, shell-quote 1.10.0 or vite 8.3.0 …", and given one row, for the
    // undici row BUG-64 adds to PATCHED, as BUG-61 did for vite. No row or
    // assertion is removed or changed.
    //
    // Per fix: the lines the fix writes into the lockfile (an override, or
    // for BUG-61 the root's own dev dependency), a second path to the version
    // the lockfile held before (beside the fixed one), a later version that a
    // floor (`^1.2.2`, `^1.11.0`, `^8.3.3`, `^8.12.2`) may lock, a version
    // below the advisory's own range, and what the check says of each.
    const controls = [
      {
        fix: PATCHED[0],
        fixedBy: '  source-map-js@>=1.0.0 <1.2.2: ^1.2.2\n',
        // magicast's path left at 1.2.1, postcss's fixed.
        secondPath: [
          '  magicast@0.5.5:\n    dependencies:\n      source-map-js: 1.2.2\n',
          '  magicast@0.5.5:\n    dependencies:\n      source-map-js: 1.2.1\n',
        ],
        later: '1.3.0',
        // Outside GHSA-68fv-2mgg-jv7q's range, and no other advisory's here.
        belowAdvisory: { version: '0.6.2', short: [] },
        inRange: [
          'source-map-js 1.2.1 is locked, in >=1.0.0 <1.2.2, which 1.2.2 fixes (GHSA-68fv-2mgg-jv7q)',
        ],
        unplaced: [
          'source-map-js https://example.invalid/source-map-js-1.2.2.tgz is locked, a version that cannot be compared with 1.2.2',
        ],
      },
      {
        fix: PATCHED[1],
        fixedBy: '  shell-quote@<1.11.0: ^1.11.0\n',
        // A second path, from react-native itself, not overridden.
        secondPath: [
          '  react-native@0.86.3:\n    dependencies:\n      react-devtools-core: 6.1.5\n',
          '  react-native@0.86.3:\n    dependencies:\n      react-devtools-core: 6.1.5\n      shell-quote: 1.10.0\n',
        ],
        later: '1.12.0',
        // Below GHSA-pqg4-j6r4-53mv's 1.8.4, but inside the other advisories'.
        belowAdvisory: {
          version: '1.6.1',
          short: [
            'shell-quote 1.6.1 is locked, in <1.11.0, which 1.11.0 fixes (GHSA-pqg4-j6r4-53mv)',
          ],
        },
        inRange: [
          'shell-quote 1.10.0 is locked, in <1.11.0, which 1.11.0 fixes (GHSA-pqg4-j6r4-53mv)',
        ],
        unplaced: [
          'shell-quote https://example.invalid/shell-quote-1.11.0.tgz is locked, a version that cannot be compared with 1.11.0',
        ],
      },
      {
        fix: PATCHED[2],
        // No override: the root's own dev dependency, what BUG-61's fix wrote.
        fixedBy: '      vite:\n        specifier: ^8.3.3\n        version: 8.3.3\n',
        // The failure the dev dependency exists to prevent: the root's vite
        // fixed, and vitest's auto-installed peer left at 8.3.0 beside it.
        secondPath: ['      vite: 8.3.3\n', '      vite: 8.3.0\n'],
        // What BUG-61's fix locked.
        later: '8.3.4',
        // Below 8.3.0, the range the fix's commit cites, but inside
        // GHSA-587h-7wmj-h5pm's own range for the 8.2 line, >=8.2.0 <=8.2.3.
        belowAdvisory: {
          version: '8.2.3',
          short: ['vite 8.2.3 is locked, in <8.3.3, which 8.3.3 fixes (GHSA-587h-7wmj-h5pm)'],
        },
        inRange: ['vite 8.3.0 is locked, in <8.3.3, which 8.3.3 fixes (GHSA-587h-7wmj-h5pm)'],
        unplaced: [
          'vite https://example.invalid/vite-8.3.3.tgz is locked, a version that cannot be compared with 8.3.3',
        ],
      },
      {
        fix: PATCHED[3],
        // The sample's override, in BUG-23's form (see PATCHED_SAMPLE_LOCK).
        fixedBy: '  undici@>=8.0.0 <8.12.2: ^8.12.2\n',
        // A second path, from @testcontainers/postgresql itself, not overridden.
        secondPath: [
          "  '@testcontainers/postgresql@12.1.0':\n    dependencies:\n      testcontainers: 12.1.0\n",
          "  '@testcontainers/postgresql@12.1.0':\n    dependencies:\n      testcontainers: 12.1.0\n      undici: 8.11.0\n",
        ],
        // undici's newest on 2026-10-25 (`pnpm view undici version`).
        later: '8.12.3',
        // Below GHSA-xjj6-f33q-929c's 8.0.0, and outside every undici
        // advisory npm's bulk endpoint gave on 2026-10-25.
        belowAdvisory: { version: '7.30.1', short: [] },
        inRange: [
          'undici 8.11.0 is locked, in >=8.0.0 <8.12.2, which 8.12.2 fixes (GHSA-xjj6-f33q-929c)',
        ],
        unplaced: [
          'undici https://example.invalid/undici-8.12.2.tgz is locked, a version that cannot be compared with 8.12.2',
        ],
      },
    ];
    expect(controls.map((c) => c.fix)).toEqual(PATCHED);

    const sample = readLockfile(PATCHED_SAMPLE_LOCK);
    expect(sample.lockfileVersion).toBe('9.0');

    for (const { fix, fixedBy, secondPath, later, belowAdvisory, inRange, unplaced } of controls) {
      const { name, fixedAt, lockedBefore } = fix;
      const others = PATCHED.filter((other) => other !== fix);
      // What the check says of a lockfile text for this fix, once every other
      // fix is seen to hold there: each fix is checked on its own package.
      const check = (text) => {
        const lock = readLockfile(text);
        for (const other of others) {
          expect(shortOfFix(lock, other), `${other.name}, where only ${name} changed`).toEqual([]);
        }
        return shortOfFix(lock, fix);
      };
      const packagesEntry = `  ${name}@${fixedAt}:\n    resolution:`;
      const snapshotEntry = `  ${name}@${fixedAt}: {}\n`;
      const beside = (version) =>
        edited(
          PATCHED_SAMPLE_LOCK,
          [
            packagesEntry,
            `  ${name}@${version}:\n    resolution: {integrity: sha512-synthetic}\n\n${packagesEntry}`,
          ],
          [snapshotEntry, `  ${name}@${version}: {}\n\n${snapshotEntry}`],
        );

      // The fixed form passes, and the override's selector is not read as a
      // version.
      expect(lockedVersions(sample, name)).toEqual([fixedAt]);
      expect(check(PATCHED_SAMPLE_LOCK)).toEqual([]);

      // The lockfile the audit failed on: the old version on every path, and
      // none of the lines the fix wrote.
      const before = edited(
        PATCHED_SAMPLE_LOCK,
        [fixedBy, ''],
        [`${name}@${fixedAt}`, `${name}@${lockedBefore}`],
        [`${name}: ${fixedAt}`, `${name}: ${lockedBefore}`],
      );
      expect(check(before)).toEqual(inRange);

      // The old version beside the fixed one, on a second path. Every locked
      // version must be fixed, not just one.
      const besideFixed = edited(beside(lockedBefore), secondPath);
      expect(lockedVersions(readLockfile(besideFixed), name)).toEqual([lockedBefore, fixedAt]);
      expect(check(besideFixed)).toEqual(inRange);

      // Each section is read on its own: the old version in only the packages
      // keys, or only the snapshots keys, still fails.
      const inPackages = edited(PATCHED_SAMPLE_LOCK, [
        packagesEntry,
        `  ${name}@${lockedBefore}:\n    resolution:`,
      ]);
      const inSnapshots = edited(PATCHED_SAMPLE_LOCK, [
        snapshotEntry,
        `  ${name}@${lockedBefore}: {}\n`,
      ]);
      for (const text of [inPackages, inSnapshots]) {
        expect(check(text)).toEqual(inRange);
      }

      // A source that is not plain semver cannot be called fixed.
      const tarball = edited(PATCHED_SAMPLE_LOCK, [
        snapshotEntry,
        `${snapshotEntry}\n  ${name}@https://example.invalid/${name}-${fixedAt}.tgz: {}\n`,
      ]);
      expect(check(tarball)).toEqual(unplaced);

      // The override is a floor: a later version in place of the fix passes.
      const floor = edited(
        PATCHED_SAMPLE_LOCK,
        [`${name}@${fixedAt}`, `${name}@${later}`],
        [`${name}: ${fixedAt}`, `${name}: ${later}`],
      );
      expect(lockedVersions(readLockfile(floor), name)).toEqual([later]);
      expect(check(floor)).toEqual([]);

      // A version below the advisory's own range: source-map-js 0.6.2 and
      // undici 7.30.1 are outside every range here and pass; shell-quote
      // 1.6.1 is inside other advisories' and fails.
      expect(check(beside(belowAdvisory.version))).toEqual(belowAdvisory.short);
    }
  });

  test('BUG-23, BUG-24, BUG-61, BUG-64: where each fix draws its line: in the range, before it, fixed, or not comparable', () => {
    // RG-03, BUG-64: renamed from "BUG-23, BUG-24, BUG-61: …", and given one
    // row and one range, for the undici row BUG-64 adds to PATCHED, as BUG-61
    // did for vite. No row or assertion is removed or changed.
    //
    // Each part is compared as a number: 1.9.9 and 1.10.0 are below 1.11.0,
    // though "1.9.9" sorts after "1.11.0" as text. A pre-release is below its
    // release. The `file:` rows hold the pattern's start anchor: each ends in
    // a version that would match without it.
    const boundaries = [
      {
        fix: PATCHED[0],
        'in range': ['1.0.0', '1.2.0', '1.2.1', '1.2.1+build.7', '1.2.2-beta.0'],
        // Below GHSA-68fv-2mgg-jv7q's 1.0.0: outside the advisory, so no red.
        'before range': ['0.6.2', '0.99.99', '1.0.0-rc.1'],
        fixed: ['1.2.2', '1.2.2+build.7', '1.2.3', '1.2.10', '1.3.0', '1.10.0', '2.0.0'],
        unplaced: ['github:synthetic/source-map-js', 'file:vendor/source-map-js-1.2.2', '1.2', ''],
      },
      {
        fix: PATCHED[1],
        // Every shell-quote below 1.11.0, below GHSA-pqg4-j6r4-53mv's 1.8.4
        // too: the other advisories cover those.
        'in range': [
          '0.0.1',
          '1.0.0',
          '1.6.1',
          '1.8.3',
          '1.8.4',
          '1.9.9',
          '1.10.0',
          '1.10.9',
          '1.11.0-rc.1',
        ],
        fixed: ['1.11.0', '1.11.0+build.7', '1.11.1', '1.12.0', '1.100.0', '2.0.0'],
        unplaced: ['github:synthetic/shell-quote', 'file:vendor/shell-quote-1.11.0', '1.11', ''],
      },
      {
        fix: PATCHED[2],
        // Every vite below 8.3.3: each line's last version in
        // GHSA-587h-7wmj-h5pm (7.3.6, 8.1.5, 8.2.3, 8.3.2); 8.0.16, the 8.0
        // line's last, inside its >=8.0.0 <=8.1.5; 8.3.0, which the lockfile
        // held; and the older lines' own fixed releases, 7.3.7, 8.1.6 and
        // 8.2.4, which the audit passes: the check is a floor.
        'in range': [
          '0.0.1',
          '7.3.6',
          '7.3.7',
          '8.0.16',
          '8.1.5',
          '8.1.6',
          '8.2.3',
          '8.2.4',
          '8.3.0-beta.1',
          '8.3.0',
          '8.3.2',
          '8.3.2+build.7',
          '8.3.3-beta.0',
        ],
        fixed: ['8.3.3', '8.3.3+build.7', '8.3.4', '8.3.10', '8.4.0', '8.10.0', '9.0.0'],
        unplaced: ['github:synthetic/vite', 'file:vendor/vite-8.3.3', '8.3', ''],
      },
      {
        fix: PATCHED[3],
        // GHSA-xjj6-f33q-929c's own range: 8.11.0, which the lockfile held,
        // and 8.11.2, the floor testcontainers' newest declares.
        'in range': [
          '8.0.0',
          '8.9.0',
          '8.11.0',
          '8.11.2',
          '8.12.1',
          '8.12.1+build.7',
          '8.12.2-rc.1',
        ],
        // Below its 8.0.0: no red here. 7.16.0 is inside other high
        // advisories (7.x below 7.29.1), which the audit itself fails, and
        // which this row does not read; 7.30.1 is outside every one.
        'before range': ['7.16.0', '7.30.1', '7.99.99', '8.0.0-rc.1'],
        fixed: ['8.12.2', '8.12.2+build.7', '8.12.3', '8.12.10', '8.13.0', '8.100.0', '9.0.0'],
        unplaced: ['github:synthetic/undici', 'file:vendor/undici-8.12.2', '8.12', ''],
      },
    ];
    expect(boundaries.map((b) => b.fix)).toEqual(PATCHED);

    for (const { fix, ...places } of boundaries) {
      for (const [place, versions] of Object.entries(places)) {
        expect(
          versions.map((version) => placeAgainst(version, fix)),
          `${fix.name}: ${place}`,
        ).toEqual(versions.map(() => place));
      }
    }
    expect(PATCHED.map(rangeOf)).toEqual([
      '>=1.0.0 <1.2.2',
      '<1.11.0',
      '<8.3.3',
      '>=8.0.0 <8.12.2',
    ]);
  });
});
