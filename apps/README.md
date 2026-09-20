# apps

Two deployable applications live here. Both arrive later in milestone M0:

| Folder | What it is | Arrives in |
|--------|-----------|-----------|
| `server/` | Hono API and the watchdog worker, built from one codebase (AR-01) | INF-05 |
| `mobile/` | The Expo app: `safety-core/`, `features/`, `shared/` (AR-09) | INF-06 (needs the Mac) |

The layout each of them follows is in
[`docs/plan/05-architecture.md`](../docs/plan/05-architecture.md). The import
rules that keep the boundaries in place are already installed, in
`packages/config/dependency-cruiser.cjs`: they start blocking the day these
folders appear.
