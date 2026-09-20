# 0 · Working agreement

**Status:** ✅ Done (v1) · **Last updated:** 2026-09-20

## Roles
- **Owner (you):** sets direction, answers questions, makes every decision,
  reviews results. Does not write code.
- **Claude:** researches, proposes options with a recommendation, asks focused
  questions, records outcomes, and later writes all code and tests.

## The loop for every section
1. **Research** — Claude gathers facts relevant to the section and cites
   sources. Anything unsourced is labelled **Hypothesis**.
2. **Options** — for each open choice: 2–4 options, trade-offs, and one
   recommendation with reasons.
3. **Questions** — at most 3 per round, each with a recommended answer, so the
   owner can reply quickly.
4. **Answers** — the owner replies (a short answer is fine).
5. **Decide** — each outcome is written to `decisions.md` as a numbered
   decision.
6. **Close** — the section gets a short summary at the top, the status table in
   `README.md` is updated, and the next section starts.

A section can take several rounds. Each round is appended under
`## Rounds` in the section file so the reasoning stays traceable.

## Section file template
```markdown
# N · Title
**Status:** … · **Last updated:** YYYY-MM-DD

## Summary            ← filled in when the section closes
## Goal of this section
## Research findings  ← with source links
## Options & recommendation
## Open questions for the owner
## Rounds             ← round 1, round 2 … (questions, answers, outcomes)
## Next steps
```

## Conventions
- Language for docs and code: English. App text: decided in Section 1.
- Dates: ISO format (2026-09-20).
- Decisions are never deleted or edited after acceptance. To change one, add a
  new decision that says "Supersedes D-00X" and mark the old one
  "Superseded by D-00Y".
- Every file in `docs/plan/` has a **Status** and **Last updated** line.

## Where things will live
| Path | Contents | Created in |
|------|----------|------------|
| `docs/plan/` | Planning sections, this agreement, decision log | Now |
| `docs/specs/` | One spec per feature, with acceptance criteria | Section 9 |
| `docs/progress.md` | Running log of what was built, tested and shipped | Section 9 |
| `.claude/` | Agents, skills, hooks, commands | Section 7 |
| `/spikes/` | Throwaway experiments, never shipped | When a section needs one |

## Resume protocol
Any session starts with: *"Read `docs/plan/README.md` and continue the planning
where we left off."* Before a session ends, Claude updates the current section
file, the status table and the "Last updated" lines, so nothing lives only in
chat history.

## Guiding principles for this product
1. **Fail loudly, never silently.** A safety app that silently stops working is
   worse than no app, because it creates false confidence.
2. **Don't replace emergency services.** Make calling 112/113 faster; never get
   in the way of it.
3. **Consent and privacy by default.** Location is shared only when the user
   chooses, for as long as they choose, with people they choose, and it is
   always visible that sharing is on.
4. **Built for stress.** Big targets, few steps, works with gloves, in the dark,
   while tipsy and cold.
5. **Simple over clever.** Every feature must be testable and explainable.
