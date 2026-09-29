---
name: ids-taken-while-open
description: `git diff origin/main...HEAD` hides D-/BUG-/A- numbers main took after the branch was cut; a conflicting PR runs no workflows; the sandbox cannot read job logs; a runner label is a release, not an image
metadata:
  type: project
---

PR #43 (2026-09-29) added D-083 and BUG-8. While it was open, #44 merged its own D-083 and a D-084 that gave BUG-8 to other work, and open #46 added `BUG-8:` tests. The three-dot diff compares against the old merge-base, so it showed nothing wrong. The branch was renumbered to D-085 and BUG-9.

**How to apply:**
- For every new D-, BUG- or A- number on the branch, grep freshly fetched `origin/main` and the open pull requests. Read `mergeable_state` from `https://api.github.com/repos/bvst/TryggHverdag/pulls/<n>`. This extends [[spec-promises-vs-head]]: INF-06 hit the same thing with D-080.
- A push that "started no workflow" usually means the PR is conflicted (`mergeable_state: dirty`). GitHub runs no `pull_request` workflows until the conflict is resolved, so the head has zero check runs.
- The reviewer sandbox cannot read job logs: the log storage host is blocked, and `gh` is not installed. `api.github.com` metadata and `raw.githubusercontent.com` work. Say which log quotes you could not check.
- `runs-on: ubuntu-26.04` names an Ubuntu release, not a fixed image. GitHub rebuilds the image under the label, and "Set up job" prints the Image Version. Challenge any claim that it is "pinned like a commit".
