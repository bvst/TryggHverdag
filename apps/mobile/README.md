# apps/mobile — `@trygghverdag/mobile`

The Expo app, built as an **Expo development build** (not Expo Go) with Expo
Router, in bokmål and English (D-014, D-023, D-032). Today it is a skeleton: one
placeholder screen that shows the working title and says the app is under
development. It makes no claim that anyone is protected, because it protects
no one yet.

Spec: [`docs/specs/INF-06.md`](../../docs/specs/INF-06.md).

## Commands

Run from the repository root.

| Command | What it does |
|---------|--------------|
| `pnpm run dev` | Metro for the development client (`expo start --dev-client`) |
| `pnpm --filter @trygghverdag/mobile run android` | Builds and installs the **debug** development build on the running emulator (`expo run:android`) |
| `pnpm run test:unit` | Vitest, then this app's jest-expo suite (L5) |
| `pnpm run test:coverage` | The same, measured; the ratchet reads both summaries |
| `pnpm run e2e:android` | L7: the **release** build, installed on a connected emulator in bokmål, driven by the Maestro flows in `e2e/` |

`e2e:android` takes `--build-only` (no device needed) and `--skip-build`
(install and test what was built), which is how CI builds before the emulator
boots. It uses emulators only, and passes only when Maestro exits 0 and its report
shows every flow ran and passed.

## How it is put together

- **No `android/` or `ios/` folder is committed.** `expo prebuild` generates the
  native project from `app.config.ts` (continuous native generation), so native
  settings live in reviewed code. Both folders are ignored by git, ESLint and
  the import rules.
- **The Android application ID is a placeholder**, defined once in
  `app.config.ts`. It is fixed together with the public name before the first
  store upload (D-057).
- **No over-the-air updates** (D-023): `expo-updates` is not a dependency and
  the config names no update URL.
- **Routes live in `src/app/`, and nothing else does.** Expo Router takes every
  `.ts` and `.tsx` file there as a route, tests included, and bundles it into
  the release build. That is why `src/app.test.tsx` sits beside the folder.
- **Translations** are in `src/shared/translations/`: `nb.json` and `en.json`
  with the same keys, typed from `nb.json`, so a missing key is a type error.
  The language is the first of the device's preferred languages the app has:
  `nb`, `nn` and `no` mean bokmål, `en` means English, anything else bokmål.
- **Tests import from `@jest/globals`**, never from ambient globals, as the
  server's tests import from `vitest`.
- `src/safety-core/` does not exist yet. The import rules and the owner's
  review are already waiting for it (AR-09).
