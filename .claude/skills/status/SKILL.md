---
name: status
description: "Plain-language progress report for the owner: what's done, what's next, requirement coverage, risks, CI health and owner to-dos."
---

# /status

Write a report for the owner, who does not read code. Keep it to one phone
screen, and start with ✅ healthy, ⚠️ needs attention or 🛑 action required.
When run by the daily workflow (D-050), cover the last 24 hours and post it as a
comment on the pinned "Daily status" issue.
1. **Done since last report** — from `docs/progress/m0.md` (the narrative log);
   `docs/progress.md` carries current status and what the owner still owes.
2. **Requirement coverage** — run `pnpm req:coverage`: Must stories covered,
   uncovered, failing.
3. **Health** — CI on `main` (`gh run list --branch main --limit 3`), open PRs
   waiting for the owner, any `.claude/state/gate-failed` file.
4. **Risks** — anything that could fail silently, and residual risks
   RR-01 to RR-04 if relevant.
5. **Next** — the next requirement in the roadmap (Section 10), open
   `owner-question` issues, and owner to-dos.
6. **Cost** — monthly running cost so far against budget (D-048).
