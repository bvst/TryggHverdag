# SPIKE-01: background safety on emulators and simulators

Throwaway code for milestone M1. It checks, on the Android emulator and the iOS
simulator, whether the location SDK keeps a journey alive in the background
(S1 to S7), and whether MapLibre draws Kartverket's tiles (S8, outside the
go/no-go). The spec is [`docs/specs/SPIKE-01.md`](../../docs/specs/SPIKE-01.md);
the results will go in `docs/plan/04b-spike-results.md`.

It is never shipped and never imported: nothing under `apps/` or `packages/`
may import it (the `spikes-are-throwaway` rule), and it is not a workspace
package. Deleting this folder removes the spike completely.

## What is here

| Folder      | What                                                                       |
| ----------- | -------------------------------------------------------------------------- |
| `receiver/` | The receiver: takes the SDK's uploads on loopback and keeps no position    |
| `routes/`   | The synthetic route: made-up waypoints and a fixed seed                    |
| `analysis/` | Pure functions: the verdicts, the results tables and the go/no-go rule     |
| `app/`      | The spike app (to come)                                                    |
| `drivers/`  | One script per scenario and platform, and the Maestro flows (to come)      |

Plain `.mjs` on Node 22, with no dependencies outside the app.

## Running the tests

From this folder:

```sh
node --run test
```

or `npm test`. Both run `node --test` on `receiver/`, `routes/` and `analysis/`
only, so an installed `app/node_modules` is never collected. Nothing in CI runs
these tests, and the root `test:unit` does not collect them: run them before
every commit, and quote the output in the pull request.

## Building the app

To come.

## Running the scenarios

To come.

## Never copy into the product

These are for the spike only (spec, risk R13). None of them may reach
`apps/mobile` or `apps/server` when the SDK is brought in:

- **Cleartext HTTP to the loopback address.** The product talks HTTPS and
  authenticates each device. The receiver is not the heartbeat endpoint.
- **Permissions granted with `adb`** (or `simctl privacy`). In the product the
  person grants them, and the app checks and reports them.
- **Forced device states:** Doze forced idle, the standby bucket, the battery
  unplugged, airplane mode, Do Not Disturb and the ringer set by script.
- **The receiver itself,** its records and its refuse switch.
- **The SDK in debug builds without a licence.** Release builds need the
  licence (D-023).
