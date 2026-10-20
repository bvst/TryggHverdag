---
name: gitleaks-ignore-review
description: PR #96 GRP-01 gitleaks exception (.gitleaksignore, one fingerprint for 064be6c) - PASS; what each gitleaks 8.30.1 suppression route covers, probe recipe in a throwaway clone, unowned .gitleaksignore/.gitleaks.toml
metadata:
  type: feedback
---

First seen on PR #96 (GRP-01, 2026-10-20, head a9b9dd1 + uncommitted .gitleaksignore). PASS, Should fix + Notes.

**Facts, probed with the pinned gitleaks 8.30.1 (archive sha256 = ci.yml pin):**
- `gitleaks git` scans each commit's patch, so a literal is reported once, by the commit that ADDED it; later commits that keep the line unchanged are not re-reported.
- A `commit:file:rule:line` fingerprint covers that one commit only. Same value re-added in a new commit at the SAME file and line 34: found. Other line, other file: found.
- A commit-less `file:rule:line` entry (gitleaks' global fingerprint) suppresses that file:line in EVERY commit. That is the broad form; ask that the ignore file's comment forbids it.
- `<root>/.gitleaks.toml` is auto-loaded (an untracked one with `[allowlist] paths` silenced a real finding), and inline `gitleaks:allow` silences a line in any file. Both, plus `.gitleaksignore`, are read from the PR's own tree (pull_request runs the PR's code).
- generic-api-key needs a keyword near the value (`joinKey` matched, `const k =` did not): "no finding" in a probe can mean the line lacked a keyword. Use a positive control.
- Ruleset allows squash only, so a branch-only commit (064be6c) never reaches main: its ignore line is dead on main after merge.

**Recipe (~1 min):** `git clone -q --no-local <repo> <scratch>/glprobe`, checkout branch, copy the uncommitted ignore file in, run the CI command; positive control by moving the ignore aside; scratch commits for same-line/other-line/other-file; append a commit-less entry; drop a `.gitleaks.toml`; a `// gitleaks:allow` line. `--report-path x.json --report-format json` then print `.Fingerprint`.

**Job logs:** `gh api .../actions/jobs/<id>/logs` is refused here (redirect to blob storage). Annotations give only "exit code 1". Say the log was unreadable and reproduce locally instead.

**Ownership:** /.gitleaksignore and /.gitleaks.toml were not in CODEOWNERS (checked 2026-10-20). Required check `security` + code-owner review + no bypass actors: owning them makes a scan exception an owner decision. Inline `gitleaks:allow` stays an open route (a test or grep in CI would be the fix).

Related: [[merge-rules-codeowners-review]], [[grp01-join-review]], [[reviewer-sandbox-quirks]]
