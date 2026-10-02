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
 * tests pin the configuration instead of running the audit. A `pnpm audit` run
 * reads the registry's advisory data, which changes whenever an advisory is
 * published, and a unit test must not change its answer with the news. They
 * hold that:
 *   - the accepted advisory is ignored (the reproduction: without it, the audit
 *     fails every pull request);
 *   - every advisory the audit ignores is named by an Accepted decision, so the
 *     list cannot grow without one;
 *   - every ignored ID is well formed, so a typo is caught here rather than
 *     ignoring nothing while the real advisory still fails CI;
 *   - nothing else ignores advisories: CI's audit still stops at high with no
 *     ignore of its own, and pnpm-workspace.yaml holds no audit settings.
 *
 * What pnpm does with these settings was read in pnpm 10.33.0's own bundle
 * (dist/pnpm.cjs), not assumed: it drops an advisory when
 * `auditConfig.ignoreGhsas.includes(github_advisory_id)` — an exact,
 * case-sensitive match — or when every one of its CVEs is in
 * `auditConfig.ignoreCves`; it reads `auditConfig` from the root package.json's
 * `pnpm` field and then from pnpm-workspace.yaml, whose settings are assigned
 * over the package.json ones; and `pnpm audit --ignore` and `--ignore-unfixable`
 * write ignores and exit 0 instead of auditing.
 */
import { readFileSync, readdirSync } from 'node:fs';
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

const manifest = JSON.parse(read('package.json'));
const auditConfig = manifest.pnpm?.auditConfig;
const decisionLog = read('docs/plan/decisions.md');

/** Every advisory ID the root package.json tells pnpm to ignore. */
function ignoredIds(config) {
  return [...(config?.ignoreGhsas ?? []), ...(config?.ignoreCves ?? [])];
}

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
 * Accepted means the status starts with the word "Accepted". "Partly accepted"
 * (D-069) does not, and "Accepted in principle" (D-006) leaves its questions
 * open, which is not an acceptance of a known vulnerability.
 */
function isAccepted(status) {
  return status !== null && /^Accepted\b/.test(status) && !/^Accepted in principle\b/.test(status);
}

/** True when the text names this ID, and not a longer one that contains it. */
function names(text, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`).test(text);
}

/** The Accepted decisions that name this advisory, by ID. */
function acceptingDecisions(entries, advisory) {
  return entries.filter((e) => isAccepted(e.status) && names(e.text, advisory)).map((e) => e.id);
}

/** Why an ignored advisory has no Accepted decision: which entries name it, and their status. */
function whyNotAccepted(entries, advisory) {
  const naming = entries.filter((e) => names(e.text, advisory));
  if (naming.length === 0) return `${advisory}: no decision names it`;
  const found = naming.map((e) => `${e.id} (${e.status ?? 'no Status line'})`).join(', ');
  return `${advisory}: named only by ${found}`;
}

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
      'ignored by the audit, but no Accepted entry in docs/plan/decisions.md names it',
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

  test('BUG-11: nothing else ignores advisories: CI audits at high with no ignore of its own, and pnpm-workspace.yaml holds no audit settings', () => {
    // D-093: "Everything else stays at --audit-level high." A lower bar,
    // --ignore or --ignore-unfixable on the command line would let through
    // what no decision accepted, and audit settings in pnpm-workspace.yaml
    // would replace the package.json ones, decision check and all.
    const workflows = readdirSync(path.join(root, '.github/workflows')).filter((f) =>
      /\.ya?ml$/.test(f),
    );
    const audits = workflows.flatMap((file) =>
      read(`.github/workflows/${file}`)
        .split('\n')
        .filter((line) => /\bpnpm\s+audit\b/.test(line) && !/^\s*#/.test(line))
        .map((line) => ({ file, command: line.replace(/^\s*(?:-\s*)?(?:run:\s*)?/, '').trim() })),
    );

    expect(audits.length, 'no workflow runs pnpm audit').toBeGreaterThan(0);
    for (const { file, command } of audits) {
      expect(command, `.github/workflows/${file}`).toBe('pnpm audit --audit-level high');
    }
    expect(
      read('pnpm-workspace.yaml'),
      'pnpm-workspace.yaml sets auditConfig, which replaces the one in package.json',
    ).not.toMatch(/^\s*auditConfig\s*:/m);
  });

  test('BUG-11: the decision lookup reads the log as it is written: a wrapped Accepted status counts; partly, in principle, proposed and no status at all do not', () => {
    // The log's own forms, from docs/plan/decisions.md.
    const log = new Map(decisionEntries(decisionLog).map((e) => [e.id, e]));
    expect(log.get('D-088')?.status).toMatch(/^Accepted \(owner, 2026-10-01\)\. Asked in session /);
    expect(isAccepted(log.get('D-088')?.status ?? null)).toBe(true);
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
        '## Notes',
        'GHSA-jjjj-mmmm-pppp is named here, under no decision.',
      ].join('\n'),
    );

    expect(acceptingDecisions(synthetic, 'GHSA-2222-3333-4444')).toEqual(['D-901']);
    expect(acceptingDecisions(synthetic, 'GHSA-5555-6666-7777')).toEqual([]);
    expect(acceptingDecisions(synthetic, 'GHSA-8888-9999-cccc')).toEqual([]);
    expect(acceptingDecisions(synthetic, 'GHSA-ffff-gggg-hhhh')).toEqual([]);
    expect(acceptingDecisions(synthetic, 'GHSA-jjjj-mmmm-pppp')).toEqual([]);
    expect(acceptingDecisions(synthetic, 'GHSA-2222-3333-444')).toEqual([]);
    expect(whyNotAccepted(synthetic, 'GHSA-5555-6666-7777')).toBe(
      'GHSA-5555-6666-7777: named only by D-902 (Proposed)',
    );
    expect(whyNotAccepted(synthetic, 'GHSA-8888-9999-cccc')).toBe(
      'GHSA-8888-9999-cccc: named only by D-903 (no Status line)',
    );
    expect(whyNotAccepted(synthetic, 'GHSA-jjjj-mmmm-pppp')).toBe(
      'GHSA-jjjj-mmmm-pppp: no decision names it',
    );
  });
});
