# apps

Two deployable applications live here, both from milestone M0:

| Folder | What it is | Arrived in |
|--------|-----------|-----------|
| `server/` | Hono API and the watchdog worker, built from one codebase (AR-01) | INF-05 |
| `mobile/` | The Expo app: routes in `src/app/`, then `safety-core/`, `features/`, `shared/` (AR-09); see its README | INF-06 |

The layout each of them follows is in
[`docs/plan/05-architecture.md`](../docs/plan/05-architecture.md). The import
rules that keep the boundaries in place are already installed, in
`packages/config/dependency-cruiser.cjs`: they start blocking the day these
folders appear.
