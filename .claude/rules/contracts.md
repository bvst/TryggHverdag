---
paths:
  - "packages/contracts/**"
---
# API contract rules (D-030)
- Schemas are defined once here and never duplicated in the app or the server.
- Never make a breaking change to an existing endpoint. Add a new version
  instead. `pnpm api:diff` must pass against every file in `released/`.
- `released/` is written only by `release-engineer`.
