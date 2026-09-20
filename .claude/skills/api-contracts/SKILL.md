---
name: api-contracts
description: "Contract-first REST with oRPC and zod, versioning and the oasdiff compatibility gate."
---

# api-contracts

Read D-030 and D-032. Schemas live only in `packages/contracts`. Additive changes only; breaking changes need a new version. `pnpm api:diff` must pass against every file in `released/`. Endpoints used by native code (location SDK uploads) keep a stable, documented format.
