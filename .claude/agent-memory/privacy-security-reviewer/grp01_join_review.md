---
name: grp01-join-review
description: GRP-01 (sign-in by invitation, groups, membership as the session) — BLOCK on Terraform random_id printing the bootstrap code in the public infra-staging log; random_bytes is the fix; PG16 scratch-cluster recipe as root; auth/join/removal probe; recurring docs misses (inventory, monitoring-setup, README Open for M4)
metadata:
  type: feedback
---

First seen on GRP-01 (2026-10-20, reviewed a5fd8cf, base 60b46ee). Verdict BLOCK, one blocking finding.

**Why:** the code held every PRIV/SEC rule under probe. The leak was in which Terraform resource made the
secret: `random_id` has NO sensitive attributes (b64_std, b64_url, dec, hex, id all plain in the 3.9.1
schema), and Terraform prints a resource's `id` in its UI lines. random_id's id is the base64url of the
bytes, i.e. the secret itself. infra-staging.yml runs plan with stdio inherited into a PUBLIC job log
(repo public, D-089), so every plan after creation prints "random_id.X: Refreshing state... [id=...]",
and the creating run prints "... complete after Ns [id=...]" (format string "%s: %s complete after %s%s"
in the binary; not run, see below). D-136 had rejected a bootstrap route precisely for "a CI log that is
public in this repository".

**How to apply:**
- Any new `random_*` secret in infra/: check the provider schema's `sensitive` flags AND whether the
  resource has an `id` derived from the value. Safe: random_password (result*, id "none"), random_bytes
  (hex*, base64*, no id). Unsafe: random_id, random_string (result plain), random_integer.
- Proof recipe without the creating step (the global guard refuses any command text with the creating
  verb, even in a scratch dir): scratch dir with the resource, `init -plugin-dir=infra/staging/.terraform/providers`,
  hand-write a v4 terraform.tfstate with synthetic attribute values via node, then `plan -no-color | tee`,
  and `grep -c -F <secret>`. random_id: 1 hit (the positive control); random_bytes: 0 hits, the env
  shows "(sensitive value)".
- Schema dump: `providers schema -json | node` listing `resource_schemas.<type>.block.attributes` with
  their sensitive flag.

**Recurring docs misses, again (5th time for the inventory/monitoring docs):** the spec's file table
promised monitoring-setup.md (what the canary credential can name now) and it did not change; it still
says "naming any existing user ... M3's login task must check this again". 08-cicd-releases.md's secrets
inventory got no ADMIN_BOOTSTRAP_CODE entry. README "Open for M4" got no "Since GRP-01" passage
(memberships.display_name, invitations.created_by/used_by/join_key_hash, audit_log.actor_id FK to users
blocking erasure, removed members' users/devices rows). Check all three on every task that adds a secret
or a table.

**Probes that ran (Linux session, about 10 min):**
- PG16 is installed at /usr/lib/postgresql/16/bin but initdb refuses root and the postgres user cannot
  traverse the scratchpad path: make the cluster under /tmp/<name> chowned to postgres, `su postgres -s
  /bin/bash -c "initdb -A trust; pg_ctl -o '-p 55433 -k <dir> -c listen_addresses=127.0.0.1' start"`.
  Apply migrations with the begin/sed statement-breakpoint/commit pipe from git show. Stop and rm after.
- tsx probe from apps/server (`./node_modules/.bin/tsx <scratch>.mts`, imports by absolute path, no file
  in the tree because test-author was writing there): createPool + createDatabase, then the real
  databaseGroupStore, databaseDeviceAuthenticator and databaseJourneyStore(db, {} as never). Results:
  second bootstrap not_valid; same code other key not_valid; retry same user, old credential null;
  canary walker may name only CANARY_RESPONDER; admin cannot name canary IDs; removed walker WALKER_ONLY
  until the journey is ENDED then null; retry after removal not_valid; canary removal MEMBER_NOT_FOUND;
  audit rows hold IDs only; 0 raw secrets in hash columns.
- psql checks: memberships_not_the_canary_check refuses both IDs (upper-case input too); \x07 and \u0085
  refused; U+200B-only and U+202E names ACCEPTED (Note for task 3, when members see the list).
- Postgres's own server log writes "DETAIL: Failing row contains (...)" with the display name on a
  constraint error; unreachable through the API while the contract mirrors the table's checks.
- expo config introspect (EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1): read `_internal.modResults.android.manifest`;
  release = no usesCleartextTraffic, no networkSecurityConfig; EXPO_PUBLIC_API_URL=http://10.0.2.2:8080
  adds only android:networkSecurityConfig (domain-config for that host).
- New deps expo-secure-store 57.0.4 and expo-crypto 57.0.4: MIT, zero dependencies, no URLs but docs in
  android/build/plugin; licenses:check passed; pnpm audit unchanged.

**Notes left for later tasks:** bootstrap join has no join-key retry (a lost answer locks the owner out
until the staging DB is emptied); AC29's "any 401 deletes the credential" will sign a removed member's
walking phone out on GET /v1/me once task 3 adds journeys (D-136 answer 5 needs the credential kept);
bootstrap compared with === (compare SHA-256 digests with timingSafeEqual); unowned auth files: config.ts,
bin/api.ts, ports.ts, contracts/src/groups.ts, apps/mobile/src/shared/{secure-storage.ts,api/client.ts},
apps/mobile/package.json (privacy-security-reviewer always runs and blocks, so a Note).

Related: [[rel10-canary-review]], [[lost07-sms-escalation-review]], [[reviewer-sandbox-quirks]], [[mobile-release-review]]
