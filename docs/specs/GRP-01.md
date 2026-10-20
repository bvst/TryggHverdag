# GRP-01 · Join by invitation: sign-in without SMS, one group, an admin who invites and removes, and the route that removes a responder from a journey

**Milestone:** M3, task 1 of 12 (D-134) · **Delivers:** GRP-01, server and
contract, and the minimum app screens to join with an invitation and for the
admin to invite and remove; with it the device sessions D-091 left to this
task, the removal route D-122 left to M3, and the canary's place outside the
group (D-128) · **Decisions:** D-008, D-009, D-013, D-014, D-016, D-023,
D-031, D-032, D-033, D-036, D-046, D-052, D-055, D-075, D-079, D-086, D-087,
D-090, D-091, D-092, D-100, D-111, D-115, D-116, D-122, D-123, D-128, D-134,
D-135 · **Written:** 2026-10-20, step 1 of `/feature GRP-01` (started by the
owner on 2026-10-20), for the cloud session's branch `claude/busy-faraday-40n2zl`
(D-055). This writer had no shell: the branch and its commit were not checked,
`pnpm run decision` and `req:coverage` were not run, and the decisions were
read in `docs/plan/decisions.md` itself, by line · **Status:** Spec,
settled; built (green at `a5fd8cf`), in review loop 1. The owner answered all
five questions on 2026-10-20, each time with Claude's recommendation (D-136;
"Owner's answers", at the end); the choices delegated to Claude are D-137.
Changes made in review loop 1 are marked *Review loop 1* where they are made,
and listed below; D-137's loop-1 amendment records them, and D-138 the app
client's swap from D-032's libraries. Review loop 2 is marked the same way.

### Review loop 2 (2026-10-20), from the delta reviews of `3fac8fb`

All five reviewers passed `3fac8fb`, with nothing blocking. Claude's choices
(D-031): the cheap should-fixes go in now, and the rest are recorded under
"Left for later tasks". AC8, AC24, AC28, AC30 and AC32 are amended.

| Change | From | Where |
|---|---|---|
| The invitation code's spelled label and its announcement begin with the code field's own name | `a11y-i18n-reviewer` S1 | AC28 |
| While a removal is in flight, the waiting indicator shows in the confirmation, where the admin acted; the indicator is an accessibility element with its label | `a11y-i18n-reviewer` S2, S3 | AC30 |
| A removal refused with any other 4xx says it was refused; the members screen's header comment says what the code does | `code-reviewer` | AC28 |
| The staging Terraform declares no `random_id`, `random_string` or `random_integer` resource, as D-137 says | `privacy-security-reviewer`, note 3 | AC8 |
| The `membership` mutation group runs `join.test.ts` too, so `join.ts`'s guard for a code that is not a code is killed inside its own run | `test-auditor` S1 | AC32; Mutation |
| An invitation the store cannot create writes one `invitation_failed` line with `stage: 'store'` | `test-auditor` S2 | AC24 |
| D-137: the bootstrap retry's window opens again if the admin removes every other member | `privacy-security-reviewer`, note 1 | D-137 |
| Display names of combining marks alone, and line separators inside a name; VoiceOver on iOS; the spinner's contrast; an audit row for the bootstrap retry | `privacy-security-reviewer` notes 1, 2; `a11y-i18n-reviewer` S3 | Left for later tasks |

### Review loop 1 (2026-10-20), from the reviews of `a5fd8cf`

Claude's choices (D-031), from the reviewers' findings. Criteria numbers
AC1 to AC30 are unchanged; AC8, AC28 and AC30 are amended; AC31 to AC33 are
new.

| Change | From | Where |
|---|---|---|
| The bootstrap code is made by `random_bytes`, not `random_id`, so no plan prints it | `privacy-security-reviewer`, B1 (blocking) | Approach 8; AC8 |
| The bootstrap join can be retried with its join key while the admin is the only member | `privacy-security-reviewer` N1; `code-reviewer` | Approach 2, 8; AC8 |
| The bootstrap code is compared in constant time | `privacy-security-reviewer` N2 | Approach 8; AC8 |
| Display names refuse bidirectional controls and other format characters (ZWNJ and ZWJ allowed), and names with nothing visible | `privacy-security-reviewer` N4 (the abusive-member threat) | Approach 2, 12; AC31 |
| `modules/groups/` is a safety path with a mutation group; the journeys group runs `groups.system.test.ts` | `safety-reviewer` S4 | Approach 1; Mutation; AC32 |
| `android-e2e` runs on changes to the server and the contracts | `safety-reviewer`; implementer | Approach 14; AC33 |
| `responderIds`' description says "a member of the walker's group" | `code-reviewer` S2 | Approach 6; Contract changes |
| The app's plain `fetch` client instead of `@orpc/client` and TanStack Query, recorded as D-138 | `code-reviewer` S3 | Approach 14 |
| A refusal on removal is not shown as "could not be reached"; the detached JSDoc in `api.ts` goes | `code-reviewer` S4, S1 | AC28; no criterion for S1 |
| The app's accessibility: the removal confirmation in place, the code's wrapping and reading, visible labels, a waiting indicator, one "try again" | `a11y-i18n-reviewer` S2 to S6 | Approach 14; AC28, AC30 |
| The authentication query may find the journey by `walker_id` too | `safety-reviewer`, note | Approach 5 |
| Dark-first screens (task 2); the app's sign-out on a 401 against a walking removed member (task 3); the task-6 hand-off corrected | `a11y-i18n-reviewer` S1; `safety-reviewer` S1, S2; `privacy-security-reviewer` N3 | Left for later tasks |

## Requirement

### The story this task delivers

**GRP-01** (`docs/plan/01b-mvp-scope.md`, GRP section, 1st story; Must):

> **GRP-01 · Join by invitation** (Must)
> As an invited person, I can join the group from an invitation, so only people
> the admin trusts are in it.
> - Nobody can join without a valid invitation.
> - An invitation works once and expires after ⚙️ 7 days.
> - The admin can remove a member. A removed member immediately stops seeing any
>   location and stops receiving alerts.

And from the same file, "People": "**Admin** — the owner, who invites and
removes members."

### The owner's scope (D-134)

D-134, task 1 (the owner, 2026-10-20):

> 1. **GRP-01 — Sign-in and groups.** A single-use invitation that expires
>    after 7 days, device sessions (D-091), groups, membership, an admin
>    removing a member; the route that removes a responder from a journey
>    (D-122); the canary's users kept out of every group (D-128).

> **Sign-in without SMS first:** in task 1 the invitation binds the first
> device. Signing in on a new device with an SMS code comes with task 10, so
> task 1 does not wait on A-12.

Also from D-134: "UI work runs on the Mac, where the simulators are (D-055);
server parts may run in cloud sessions", and the tension "the [new-device]
notice, placed in M3's sign-in task by SM-01's spec and in M4 by the roadmap",
"to be raised with the owner in the task each concerns". The owner placed it
in task 10 (D-136, answer 2).

### What the plan fixed around it

- **D-091** (delegated): this task inherits `users`, `devices`, the
  `DeviceAuthenticator` port, the middleware, the public-route tests and the
  401 contract, and decides "issuance, expiry, rotation, revocation, the
  new-device notice, and Better Auth's use of UUID user IDs". "**The issuer
  must use `crypto.randomBytes(32)`, with a test asserting it.**" Fallback:
  Better Auth's bearer plugin behind the same port.
- **D-032** (delegated): Better Auth, "SMS codes; passkey for the admin".
  D-134 amends its sign-in for M3: SMS codes come with task 10.
- **D-122, item 5 and its consequence** (the owner): the removal has no route
  in M2; "M3's route must not ship where the SMS check is not running … a
  deployed worker must refuse to start without `HEALTHCHECKS_SMS_URL`, or make
  a check the owner is paged by fail … A log line is not enough".
- **SM-10's spec, "Left for later tasks", M3, the route:** who may remove whom;
  the 403s; whether a responder may leave on their own; wiring
  `createRemovalService` into `api.ts` with an additive route; one answer for
  `JOURNEY_NOT_FOUND`, `NOT_A_RESPONDER` and `JOURNEY_ENDED` for a caller not
  allowed to tell them apart; an admin's removal in the audit log; the journey
  ID validated as a UUID; and "the admin removing a member from every journey
  they follow (M3)".
- **D-128 and REL-10's spec, "Left for later tasks", M3, the login task:** "the
  canary's two users join no group and can be invited by no one; issuance must
  not touch `CANARY_DEVICE_ID`; the rule that only the worker registers the
  canary stays, with its import rule. Re-check which users the canary's
  credential can name as responders … must not reach a real user once there
  are real users." D-128's own amendment asks for that last point as a
  criterion with a test.
- **SM-01's spec, "Out of scope":** "The responder check becomes 'a current
  member of the walker's group' then."
- **D-008, D-009** (the owner): the volunteers are "the private group itself";
  "The first private group is friends and family, at least 12 people."
- **D-013** (the owner): "No public web links in the MVP".
- **D-135** (the owner): until M5, staging may hold the owner's own personal
  data, "Nobody else's". Tests stay synthetic (RG-07).
- **The threat model** (`03-safety-reliability-security.md`), named in words
  for the reason below: the account-takeover threat ("A login on a new device
  notifies the member and the admin. The admin can revoke sessions."), the
  abusive-member threat ("Removal by the admin is immediate"), the
  leaked-invitation threat ("single-use, expire …, and are bound to the invited
  phone number"), the admin-account threat ("passkey or hardware key") and
  SEC-03 ("an audit log of admin actions").
- **The data model sketch** (`05-architecture.md`): "users, groups,
  memberships — age band and role per membership"; "audit_log — Admin
  actions".
- **AR-03, AR-04, AR-05, AR-10, AR-11**: no clock in domain or module code;
  every journey transition decided by the domain under the row's lock; a change
  and its messages in one transaction; import boundaries; privacy by
  construction.

### What earlier tasks left for this one

| Left for the login task | Where | Where it is met |
|---|---|---|
| Issuing a device credential, with `crypto.randomBytes(32)` and a test asserting it | D-091; SM-01's spec, item 5 | Approach 4; AC7 |
| Expiry, rotation, revocation | D-091 | Approach 5 (D-136, answer 4); AC11 |
| The new-device notice | D-091; SM-01's spec; D-134's tension | Task 10 (D-136, answer 2); not this task |
| Better Auth's use of UUID user IDs | D-091 | Approach 4: Better Auth is not installed in this task, so the question moves to the task that installs it |
| Sign-in added to SM-01-AC9's public routes, deliberately, in the test | SM-01's spec, item 5 | AC10; "Existing assertions that change by design" |
| The responder check becomes "a current member of the walker's group" | SM-01's spec | Approach 6; AC12, AC13 |
| The canary's users in no group, never invited; issuance never touches `CANARY_DEVICE_ID`; what the canary's credential can name | D-128; REL-10's spec; `monitoring-setup.md` lines 292-295 | Approach 6, 7; AC14, AC15 |
| The removal route, who may remove whom, the combined answer, the audit entry, UUID validation | D-122; SM-10's spec | Approach 9, 10; AC16 to AC24 |
| The admin removing a member from every journey they follow | SM-10's spec | Approach 9; AC17 to AC20 |
| The route must not ship where the SMS check is not running | D-122; SM-10's spec | Approach 11; AC25 |

### What exists today

Read on 2026-10-20, in the files themselves:

- **Six routes** in `packages/contracts/src/contract.ts`: `health`,
  `startJourney`, `recordHeartbeat`, `reportHome`, `acknowledgeAlert`,
  `closeAlert`. Only `health` is public.
- **`users`** (`id`, `created_at`) and **`devices`** (`id`, `user_id`,
  `credential_hash` unique, `created_at`) in `apps/server/src/db/schema.ts`.
  No groups, memberships, invitations or audit log.
- **`adapters/device-credentials.ts`** checks a credential by its SHA-256 and
  creates nothing; `hashCredential` is exported for tests and the canary.
- **`DeviceAuthenticator`** in `ports.ts` answers `{ deviceId, userId }` or
  `null`, and rejects when it cannot check (a 500, never a 401).
- **The start rule** (`domain/journey.ts`, `start`) refuses
  `INVALID_RESPONDER` when a named ID is the walker or not in
  `existingUserIds`; `modules/journeys/service.ts` fills that set from
  `JourneyStore.existingUsers`, which answers "is a user". The contract's
  message says "is not a user".
- **`createRemovalService`** (`modules/journeys/removal.ts`) and
  `ResponderStore.removeResponder` (`adapters/journeys.ts`) exist, each removal
  its own transaction; nothing in production calls them. `JourneyForRemoval`
  carries no walker.
- **The worker** says at start when the SMS check is not reporting and what
  then goes unpaged (`worker.ts`, `SMS_CHECK_UNPAGED`), and still checks in
  with `HEALTHCHECKS_WORKER_URL`: a log line, which D-122 says is not enough
  once the route ships. On staging, Terraform refuses a plan without
  `HEALTHCHECKS_SMS_URL` (A-32).
- **The app** (`apps/mobile`) has one placeholder screen, translations in
  `src/shared/translations/` (`nb.json`, `en.json`), no `features/` folder,
  no API client and no secure storage. `app.config.ts` has no `scheme` ("they
  arrive with the first feature that needs one"), no `ios`, and
  `allowBackup: false` ("a restore would move a login bound to one phone onto
  another"). Its import rules for `features/` and `safety-core/` are already in
  `packages/config/dependency-cruiser.cjs`. L7 has one flow,
  `e2e/app-starts.yaml`, which needs no server.
- **Coverage** (`docs/requirements-status.md`): GRP-01 has no test.

### Readings this spec makes

Each is stated so the reviewers can check it.

1. **"The group"** is one group: the private group (D-008, D-009, the story's
   own "the group", one admin who is "the owner"). A user is a member of at
   most one group. Settled by those, so not asked.
2. **"A valid invitation"** is one the admin created, not yet used, and not
   expired by the database's clock. Anything else, a code that never existed
   included, is not valid, and all of them get one answer (AC2).
3. **"Works once"** means it brings in one person once. A retry of that same
   join, whose answer was lost (F2), is the same join, not a second use: it
   gets the same membership and a fresh credential, and the earlier credential
   stops working (AC5). A join by anyone else with that code is refused.
4. **"Expires after 7 days"**: valid while the database's now() is before
   `created_at + 7 days`; at exactly 7 days it is expired. The 7 is a ⚙️
   constant in one place (`domain/groups.ts`).
5. **The first admin is not invited** (nobody exists to invite them). A
   bootstrap code opens only an empty group: it works once (the group it
   creates ends it) and has no expiry of its own (D-136, answer 1).
   *Review loop 1:* as with an invitation (reading 3), a retry of that same
   join, with the same join key, is the same join, not a second use; it is
   accepted while the admin is the group's only member (approach 8).
6. **"A member"** is a user with a membership row. **"Removed"** is that row
   deleted. Their `users` row stays: journeys, alerts and messages reference it
   (the retention rule, M4, decides when it goes).
7. **"Immediately"** means in the transaction that removes them: from its
   commit, every check that reads membership or responder rows leaves them
   out. Messages already in a provider's hands cannot be recalled (D-122,
   item 2); that limit is stated, not hidden.
8. **"Stops seeing any location"**: no route shows a location yet (the alert
   screen is task 7, the map task 8). What this task can and must hold is the
   ground those routes will stand on: a removed member holds no responder row
   on any unended journey and no device that authenticates (AC17, AC18). The
   access rule of tasks 7 and 8 reads those rows (AR-11).
9. **"Stops receiving alerts"**: every unsent message to them is withdrawn,
   nothing new is written to them, and they cannot be named as a responder
   again (AC12, AC18, AC19). Push targets arrive with task 6, which must send
   only to devices that authenticate, and to a removed member's walking
   device only the messages to the walker of its own unended journey (Left
   for later tasks, corrected in review loop 1).
10. **The admin is also a member**, and can be a walker and a responder like
    anyone else.

### How this spec names requirements, and why

The `traceability` job runs `req:coverage --fail-on-uncovered-changed`. It
refuses a changed spec that names a tracked requirement, or a criterion in the
form ID, "-AC", number, that no test names; `mentions` matches anywhere in the
text (BUG-16).

- **Delivered here, and named by its tests:** GRP-01.
- **Cited, already covered, not claimed:** SM-01, SM-02, SM-07, SM-10,
  LOST-02, LOST-06, LOST-07, REL-01, REL-08, REL-10, SEC-03, SEC-07, PRIV-07.
  Some criteria strengthen them, and their test files may name them.
- **Untracked, named freely:** AR-, D-, F-, RG-, INF-, BUG-, A-, CI-, L- IDs.
- **Every other tracked requirement is named in words**, here and in product
  code and its comments:

| Name used here | Where it lives |
|---|---|
| the #1-contact story; the permission-check story; responder setup | `01b-mvp-scope.md`, GRP section, 2nd, 3rd, 4th stories |
| the start-a-journey story; the map story; the two-hour stop | JRN section, 1st, 3rd, 6th stories |
| the account-takeover threat; the abusive-member threat; the leaked-invitation threat; the admin-account threat | `03-safety-reliability-security.md`, threat model, 1st, 2nd, 4th, 5th rows |
| the alert-level rule | same file, reliability table, 6th row |
| the responders-only rule; the retention rule; the EEA rule; the no-analytics rule; the data-rights rule; the privacy-notice rule; the DPIA rule; the minors rule | `02-norway-law-privacy.md`, privacy table, 3rd, 4th, 5th, 6th, 9th, 10th, 11th, 12th rows |

**Partial delivery shows as full.** Once tests name it, GRP-01 shows as
covered. What remains of the people and sign-in work is listed under "Out of
scope", each with its owner task.

## Approach (technical choices delegated to Claude, D-031)

Built on the owner's answers (D-136). The choices here that the plan did not
already make are recorded in D-137.

1. **Where the code goes.**
   - **Rules:** `apps/server/src/domain/groups.ts` (new): the invitation's
     validity (AC2 to AC6), the code's normalisation, the roles, the admin
     rules (who may invite, list, remove, and whom), and the 7-day constant.
     Pure, no clock (AR-03), in the `domain` mutation group.
   - **Module:** `apps/server/src/modules/groups/` (new): `join.ts`,
     `invitations.ts`, `members.ts` (list and remove). Thin, as every module:
     read, ask the domain, write through a port. A new safety path, because it
     decides who receives alerts. *Review loop 1:* the green head left it out
     of `SAFETY_PATHS` and every mutation group; it goes in, with a group of
     its own (Mutation, AC32).
   - **SQL:** `apps/server/src/adapters/groups.ts` (new): the join, the
     invitation, the members, the member's removal; owned, proven at L3 and by
     the shared behaviour suite (D-100), not mutated (D-095's reading).
   - **The credential issuer** stays in `adapters/device-credentials.ts`
     (owned, a safety path since D-092): `issueCredential()` beside
     `hashCredential`.
   - **The responder route** reuses `modules/journeys/removal.ts`, which gains
     the walker check (approach 10).
   - **Owned paths first (D-128's precedent):** `modules/groups/**` and
     `adapters/groups.ts` go into the ai-review `safety` filter,
     `OWNER_APPROVAL_PATHS` and `.github/CODEOWNERS` in a pull request of their
     own, merged by hand (D-075), before this task's pull request, because
     `scripts/gate.test.mjs` requires every owned `/apps/` path to be in that
     filter and the reverse. `SAFETY_PATHS` and `CLOCK_FREE_PATHS`
     (`modules/**` already) follow.

2. **The tables** (one migration; no column holds a phone number, an age, a
   position or a device detail):

   | Table | Columns | Constraints |
   |---|---|---|
   | `groups` | `id` (UUID), `created_at` (database time), `bootstrap_join_key_hash` (*review loop 1*: the SHA-256 of the first admin's join key, written with the group) | at most one row: a unique index on a constant (reading 1); `bootstrap_join_key_hash` not null |
   | `memberships` | `user_id` (PK, references `users`), `group_id`, `role` (`ADMIN` \| `MEMBER`), `display_name`, `joined_at` (database time) | one group per user (the PK); one `ADMIN` per group (partial unique index); `display_name` 1 to 40 characters after trimming, no control characters; **`user_id` not one of the canary's two IDs** (a check with literals, AC15) |

   *Review loop 1:* the contract's rule for a display name is stricter than
   the table's check (approach 12, AC31): no bidirectional control, no other
   format character but ZWNJ and ZWJ, and at least one visible character. The table's check is unchanged and stays the backstop
   for length and control characters; the join route is the only way a
   display name is written, and it takes the contract's rule. The new column
   goes into this task's migration, which has not merged and has run on no
   deployed database.
   | `invitations` | `id`, `group_id`, `code_hash` (unique), `created_by` (references `users`), `created_at`, `expires_at`, `used_at`, `used_by` (references `users`), `join_key_hash` | `expires_at > created_at`; `used_at`, `used_by` and `join_key_hash` all null or all set |
   | `audit_log` | `id` (identity), `at` (database time), `actor_id` (nullable), `action` (`GROUP_CREATED` \| `INVITATION_CREATED` \| `MEMBER_REMOVED`), `subject_id` (nullable: an invitation's or a user's ID, by action) | no free text, no name, no code |

   `users` and `devices` keep their columns. The display name lives on the
   membership, so a removal deletes it with the row (minimisation; the
   retention rule, M4, covers the rest).

3. **The invitation: a code, and nothing else** (D-136, answer 3). 20
   characters of Crockford's base32 (100 bits) from `crypto.randomBytes`, shown as four groups of five. Only
   its SHA-256 is stored; 100 random bits cannot be found from a copy of the
   table within seven days, or guessed online at any rate the API serves, so
   no slow hash and no rate limit are needed for it (SM-01's spec leaves rate
   limiting out). The code's normalisation (upper case; spaces and hyphens
   dropped; O read as 0, I and L as 1) is a domain function. Created by the
   admin, `expires_at = now() + 7 days` by the database's clock (REL-01), with
   an `INVITATION_CREATED` audit row in the same transaction.

4. **Sign-in without SMS: the invitation binds the first device** (D-134).
   - **The join** (public route, approach 12): the app sends the code, its
     **join key** (32 random bytes the app makes once, kept in secure storage)
     and the display name the person types for themselves (D-136, answer 3).
     In one transaction the store takes the invitation's row (`FOR UPDATE`), asks the domain whether it is
     valid at the database's now(), and writes: a user, a `MEMBER` membership,
     a device with the hash of a new credential, the invitation marked used
     with the join key's hash. The answer carries the credential once, with
     `Cache-Control: no-store`.
   - **A retry of the same join** (reading 3): the same code with the same join
     key, while the invitation has not expired and its user is still a
     member, replaces that device's hash with a new credential's and answers as
     the first time. Anything else on a used invitation is the one refusal.
   - **The issuer:** `issueCredential()` returns 32 bytes of
     `crypto.randomBytes`, base64url (43 characters), and its hash. A unit
     test asserts it calls `crypto.randomBytes` with 32 (D-091). Device IDs
     come from the database's `gen_random_uuid()`, never from a constant.
   - **Better Auth is not installed in this task.** Its value is its sign-in
     flows, SMS codes and passkeys (D-032), and neither exists in task 1
     (D-134; the passkey is M4's, D-136, answer 2). D-091's port stays, with
     this issuer behind it. Whether Better Auth can use UUID user IDs is
     decided by the task that installs it (task 10 for SMS codes, or M4 for
     the passkey, whichever comes first), against the version it pins.
   - **The app** keeps the credential and the join key only in
     `expo-secure-store` (Android Keystore; iOS Keychain when iOS arrives), and
     nowhere else; `allowBackup: false` stays.

5. **Sessions: membership is the session** (D-136, answer 4).
   - A credential does not expire by time and is not rotated, except by a
     retried join (approach 4).
   - **A device authenticates only while** its credential's hash matches, and
     its user is a current member, **or** it is the canary's device
     (`CANARY_DEVICE_ID`, D-128), **or** it started a journey that has not
     ended, and then only for that journey's heartbeats and "I'm home"
     (D-136, answer 5).
   - One query in `adapters/device-credentials.ts` answers the device, its
     user, and whether it is admitted fully (a member's, or the canary's) or
     only as a walker (a removed member's device with a journey it started
     and that has not ended). The middleware stays closed by default: a
     walker-only device passes on `recordHeartbeat` and `reportHome` alone,
     whose rules already require the journey's own walker and device (D-101,
     D-110), and every other route answers it the one 401. Once that journey
     ends, the query admits it nowhere. The 401 contract and "a check that
     cannot run is a 500" are unchanged.
   - *Review loop 1 (`safety-reviewer`, a note):* the query finds the unended
     journey by `device_id` alone, which no index serves, so every request
     reads the unended journeys. It may also match on `walker_id` (the
     device's user), so the existing partial unique index on a walker's
     unended journey serves it. Who is admitted does not change; the
     implementer makes this change only if it stays one query and simple.
   - So removing a membership revokes every device of that user at its commit,
     with no column to forget and no path to miss. A `revoked_at` per device,
     for the admin's revoke-sessions of the account-takeover threat, is M4's.

6. **Who can be a responder.**
   - The start rule's set becomes **"eligible responders"**: the current
     members of the walker's group other than the walker; for the canary's
     walker, exactly `{ CANARY_RESPONDER_ID }`; for anyone else, nobody. The
     domain's rule is unchanged in shape; its input is renamed
     `existingUserIds` → `eligibleResponderIds`, and the port method
     `existingUsers(ids)` → `eligibleResponders(walkerId, ids)`, so no safety
     reader takes "is a user" for the rule.
   - **Held under the lock too:** the start's transaction takes the named
     responders' membership rows `FOR SHARE` and refuses, writing nothing, if
     one has gone since the read, answering `INVALID_RESPONDER`; the member's
     removal takes that row `FOR UPDATE`. So a start and a removal that race
     cannot leave a removed member on a new journey (AC13).
   - The contract's `INVALID_RESPONDER` message becomes "A responder named is
     the walker, or is not a member of the walker's group." (a description
     change, not a breaking one).
   - *Review loop 1 (`code-reviewer` S2):* so does the start route's
     `responderIds` description, which still said "an existing user": each
     must be a member of the walker's group other than the walker. Also a
     description change only.

7. **The canary stays outside** (D-128). Its two users have no membership,
   held by the table's check; a join never writes `CANARY_DEVICE_ID` or its
   hash (device IDs are random, and the store refuses a device row for a
   canary user); the admin's routes answer the canary's IDs as "not a member";
   only the worker registers the canary, with its import rule, unchanged. The
   canary's walker can name only its own responder, and no member can name
   either canary user.

8. **The first admin** (D-136, answer 1).
   - **Made by Terraform with `random_bytes`** (*review loop 1*,
     `privacy-security-reviewer` B1): `random_bytes.admin_bootstrap_code`,
     `length = 16`, written as upper-case hex (32 characters the normaliser
     accepts): `ADMIN_BOOTSTRAP_CODE =
     upper(random_bytes.admin_bootstrap_code.hex)`. The green head used
     `random_id`, which in `hashicorp/random` 3.9.1 marks no attribute
     sensitive and whose `id` is the bytes themselves (base64url): every
     `infra-staging` plan would print `random_id.admin_bootstrap_code:
     Refreshing state... [id=…]`, the code, into a job log that is public.
     `random_bytes`' `hex` is sensitive and the resource has no ID made from
     the value, so a plan shows `(sensitive value)` and no code (the reviewer
     checked both against a hand-written state, in a scratch directory). That
     public log is the exposure D-136, answer 1, chose Terraform to avoid,
     and SEC-03 asks for secrets in a managed store. Nothing was planned or
     applied with `random_id`: GRP-01 has not merged, and A-36's plan comes
     after the merge. Never in a GitHub secret or a variable.
   - **Rotated by a generation** (*review loop 1*, the coordinator, D-031):
     the resource takes `keepers = { generation =
     local.admin_bootstrap_code_generation }`, starting at `"1"`, as the
     canary's credential does (D-128's loop-1 amendment). `infra-staging.yml`
     has no `-replace`, so raising that number in a pull request, then plan
     and apply, is the one-line rotation.
   - While no group exists, a join with it creates the group and makes the
     joiner its `ADMIN`, with a `GROUP_CREATED` audit row and the join key's
     hash on the group's row, in one transaction; the one-group index decides
     a race. Once a group exists, it is refused like any invalid code, with
     one exception:
   - **The bootstrap join can be retried** (*review loop 1*,
     `privacy-security-reviewer` N1, `code-reviewer`). The same code with the
     same join key (`groups.bootstrap_join_key_hash`), while the admin is the
     group's only member, gives the admin's one device a new credential and
     answers as the first time (the same user, `ADMIN`); the earlier
     credential stops working; the display name sent with the retry is not
     used. Without it, a lost answer (F2) left the group made and the owner
     outside it, and only emptying the staging database would let them in.
     The window closes when anyone else joins: an invitation can only be made
     with a working admin credential, so a second member shows the admin's
     phone has one. Another key, or the same key after that, is the one
     refusal.
   - **Compared in constant time** (*review loop 1*,
     `privacy-security-reviewer` N2): the code sent and the setting are each
     hashed with SHA-256 and the two digests compared with
     `crypto.timingSafeEqual`, never with `===`, so the time a refusal takes
     says nothing about how much of the code was right.
   - `config.ts` reads it as usable only if it normalises to 20 to 32 base32
     characters; the API says at start, in one line, whether the first admin
     can join with it, and never its value. The owner reads it in Clever
     Cloud's console for the staging app (A-36, below). In CI's L7 job it is
     a synthetic value set by the job.

9. **The admin removes a member: one transaction, all or nothing.**
   - Takes the membership row `FOR UPDATE`; refuses the admin's own ID
     (`CANNOT_REMOVE_ADMIN`) and a non-member (`MEMBER_NOT_FOUND`); deletes
     the membership; then, for each unended journey the member is a responder
     on, in journey-ID order, runs SM-10's removal inside the same transaction
     (`adapters/journeys.ts` exports its in-transaction step, so the rules,
     the reset, the withdrawals and the walker's warning are the ones SM-10
     proved, not a copy); writes `MEMBER_REMOVED` (actor, subject, database
     time).
   - **Why one transaction** (SM-10's spec said "once per journey"): with one
     transaction per journey, a failure after the membership's deletion leaves
     a removed member on a journey, still alerted, and a retry finds no member
     to remove. Lock order, membership row then journey rows, matches the
     start's (membership `FOR SHARE`, then new rows), and the watchdog and "I'm
     on it" take journey rows only, so no cycle. Each journey's wait keeps
     SM-10's lock limit; a limit reached fails the whole removal, loudly
     (AC20), and the admin retries.
   - **The member's own unended journey as walker is not touched** (D-136,
     answer 5): it runs to its end, followed by the responders already on it,
     and its device may send only that journey's heartbeats and "I'm home"
     until it ends (approach 5).

10. **The walker removes a responder from their journey** (D-122's route).
    - Only the journey's walker, from any of their devices that authenticates.
      Not the admin (no story asks for it; the admin's tool is removing the
      member), and not a responder on their own (in no story, SM-10's spec):
      both out of scope.
    - A caller who is not the walker gets `JOURNEY_NOT_FOUND`, whatever the
      journey's state and whoever follows it, a responder of it included: the
      one answer for a caller who may not tell them apart. The walker gets the
      three apart: `JOURNEY_NOT_FOUND`, `JOURNEY_ENDED`, `NOT_A_RESPONDER`.
    - `JourneyForRemoval` gains `walkerId`, read in the same query; the module
      compares it with the caller before asking the rule, and the store asks
      again under the lock. A removed responder stays a group member.
    - No 403 on this route, by design: a 403 would say the journey exists.
      The admin routes answer `NOT_THE_ADMIN` (403) to a member, who knows
      they are not the admin.
    - No audit row: the walker is not acting as admin (D-122 asks for the
      admin's).

11. **The SMS check must be running where the route ships** (D-122). When the
    worker's own check-in is configured (`HEALTHCHECKS_WORKER_URL` usable) and
    the SMS check is not reporting (unset, unusable, or the worker's own
    address), **the worker does not check in**: its start line says so and
    what then goes unpaged, and `staging-worker` pages within its grace. The
    watchdog, the senders and the canary keep running: refusing to start would
    stop every alert to page about one (F7). With neither URL set, as on a
    developer's machine, nothing changes. On staging Terraform already refuses
    a plan without the SMS URL; this is the defence behind it.

12. **The contract** (all additive; "Contract changes" below lists them). The
    join is the second public route, added to SM-01-AC9's list on purpose.
    Every ID in a path is `z.uuid().toLowerCase()`, so a malformed one is the
    fixed 400, never a 22P02 and a 500. Every refusal is a fixed shape that
    carries nothing of the request.
    - **A display name is something a person can see** (*review loop 1*,
      `privacy-security-reviewer` N4; the abusive-member threat). The green
      head's rule (1 to 40 characters after trimming, no control character)
      let through U+202E RIGHT-TO-LEFT OVERRIDE, which makes a name read as
      another, and a name of U+200B ZERO WIDTH SPACE alone, which shows as
      nothing in the admin's list. The threat is spoofing: a name that reads
      as someone else's through a bidirectional override, and a name that
      shows as nothing. The join's schema now also refuses:
      - the bidirectional controls: U+061C, U+200E, U+200F, U+202A to
        U+202E and U+2066 to U+2069;
      - every other format character (Unicode general category Cf, such as
        U+200B, U+FEFF and the soft hyphen U+00AD), **except** ZERO WIDTH
        NON-JOINER (U+200C) and ZERO WIDTH JOINER (U+200D), which real names
        and joined emoji need (some Persian names; an emoji family);
      - a name with no visible character. A visible character is one that is
        not white space (Unicode `White_Space`), not Cc or Cf (U+200C and
        U+200D included: they are allowed, but they are not visible), and not
        one of the blank fillers U+115F, U+1160, U+3164, U+FFA0 and U+2800.
        So a name made only of spaces, ZWJ, ZWNJ or other non-printing
        characters is refused.

      The rule is one function in `packages/contracts`, used by the join's
      schema (the fixed 400), and the app checks a name with the same
      function before it sends one (AC31), so a refused name is never shown
      as a refused invitation. The trade-off, stated: ZWNJ and ZWJ are let
      through because refusing them would refuse real names and emoji, which
      costs more than it protects; on their own they cannot reverse a name,
      and a name of nothing else is refused as invisible. (The rule as first
      written in this loop refused every Cf character; the coordinator
      narrowed it, D-031.)

13. **The log** takes closed events only. New events name a stage and a
    SQLSTATE (`join_failed`, `invitation_failed`, `member_removal_failed`),
    as `removal_failed` does. No line carries an invitation code, a join key,
    a credential, a display name or a user's ID; a refusal is the caller's
    answer and writes no line (PRIV-07, AR-11).

14. **The app** (`apps/mobile/src/features/grp/`, its public `index.ts`; the
    routes under `src/app/`).
    - Screens: **join** (code and the person's own name); **member** (says the
      phone is signed in to the group, and nothing that suggests anyone is
      being looked after: no journey exists in the app yet); for the admin,
      **invite** (create, then show the code, its expiry date, and the
      system's share sheet) and **members** (names and roles; remove, after a
      confirmation that says the removal is immediate).
    - On start the app calls `GET /v1/me` once it holds a credential. **Any
      401 deletes the stored credential** and shows the join screen with a
      plain line that this phone is no longer signed in; a 500 or a network
      failure never signs out, and is said plainly with a retry. This holds
      in task 1 because the app has no journey yet; task 3 must change it
      before a removed member can walk with the app (Left for later tasks).
    - New dependencies: `expo-secure-store`, `expo-crypto` (the join key),
      and the workspace's `@trygghverdag/contracts`. Each through
      `licenses:check`. No analytics, no web view, no deep link (`scheme` stays
      absent, D-013); the share sheet is React Native's own `Share`.
    - **The API client is plain `fetch`** (*review loop 1*, `code-reviewer`
      S3, recorded rather than changed). The spec named `@orpc/client` with
      its OpenAPI link and `@tanstack/react-query` (D-032's library set); the
      build has one module, `src/shared/api/client.ts`, that sends a request
      and reads its answer into one of four kinds kept apart on purpose: ok,
      refused (with the contract's code), unauthorized (the 401, the only
      answer that signs out, AC29) and unreachable (no answer within 20 s, or
      a 5xx). Five calls on four screens need no cache, no refetching and no
      generated client, and two fewer packages are two fewer things to vet
      (the no-analytics rule, D-016). The types still come from the
      contracts: every screen imports its request and answer types from
      `@trygghverdag/contracts`, type-only. The `as T` casts on a success
      body are accepted: the app does not validate the server's answer at
      run time; a changed shape is caught before it ships by `api:diff`
      (additive only), the L6 tests of each route's answer and the L7 flows
      against the real API. What is accepted, stated: an answer that is not
      the type's shape would not be caught in the app itself. TanStack Query and
      `@orpc/client` come back to the question when a screen needs caching or
      refetching (task 3's responder picker at the earliest). D-138 records
      the swap, as D-032 asks for any swap.
    - The API's address is fixed at build time (`EXPO_PUBLIC_API_URL`), the
      staging one for release builds (D-046). The L7 build talks to a server
      the CI job starts; if that is plain HTTP, cleartext is allowed only to
      the emulator's host address and only in the e2e build, held by an
      `app.config.ts` test that the release configuration allows none.
    - Every string through `nb.json` and `en.json`, bokmål first (D-014);
      every control has a screen-reader label; large targets.
    - **Accessibility** (*review loop 1*, `a11y-i18n-reviewer` S2 to S6;
      AC28, AC30):
      - **The removal's confirmation is shown in place,** in the member's own
        row, not after the list, where with more than about four members it
        fell below the fold. Its confirm button names the person ("Fjern
        Kari"), and the result is announced once the list shows without them.
      - **Its wording** says the removal takes effect at once, that they get
        no more alerts, and that they need a new invitation to join again. It
        does not say their phone is signed out at once, which is not true of
        a member who is walking (AC21), and does not use "deres" for one
        person (it reads as plural or formal); it uses the name.
      - **The invitation code** is shown in its four groups of five and never
        breaks inside a group when it wraps (a hyphen before a digit is not a
        line-break opportunity, so one `Text` with hyphens could). It is
        announced when it appears, and a screen reader reads it character by
        character, group by group, not as a word.
      - **Every text field has a visible label** above it, which stays while
        text is typed; a placeholder is never the only label.
      - **While a request is in flight,** the screen shows a waiting
        indicator with a screen-reader label, besides the dimmed button.
      - **One wording for trying again:** "Prøv igjen" in bokmål and "Try
        again" in English, on every screen.
      - Dark-first colours are task 2's (Left for later tasks).
    - **A refusal on removal is said as a refusal** (*review loop 1*,
      `code-reviewer` S4): a 403 or a 409 shows that the removal was refused,
      not that the server could not be reached; a 404 `MEMBER_NOT_FOUND` is
      done, as before (F2).
    - **`android-e2e` runs on changes to the server and the contracts**
      (*review loop 1*, `safety-reviewer` and the implementer; AC33). The L7
      flows now join, invite and refuse against the API the job starts, so a
      server change can break them as surely as an app change.
      `scripts/lib/affected.mjs`, which decides whether the job runs, answered
      "cannot change the app" for `apps/server/**`. A change under
      `apps/server/` or `packages/contracts/` now makes the job run.
      `packages/contracts/` already did, through the app's dependency
      closure; it is named so it stays true if the app ever stops importing
      it. How (a list, or the server's dependency closure read as the app's
      is) is the implementer's, as long as AC33 holds.

## Acceptance criteria

Each is proven by at least one test whose name starts with its ID. "Admin",
"member" and "walker" are synthetic users made by the test kit (RG-07).

### Invitations

**GRP-01-AC1 — The admin creates an invitation that expires 7 days later by
the database's clock.**
- **Given** a group whose admin is A
- **When** A asks for an invitation
- **Then** 201 with a code of 20 base32 characters in four groups of five and
  `expiresAt` equal to the database's now() plus 7 days
- **And** only the code's SHA-256 is stored, and an `INVITATION_CREATED` audit
  row names A and the invitation, in the same transaction
- **And** the code comes from `crypto.randomBytes` (a unit test asserts the
  call).

**GRP-01-AC2 — Nobody joins without a valid invitation.**
- **Given** a group, and no invitation matching the code
- **When** anyone sends a join with: a code that never existed; a used one
  (another join key); an expired one; the bootstrap code once a group exists
- **Then** each gets the same 404 `INVITATION_NOT_VALID`, with the same body
- **And** nothing is written: no user, membership, device or audit row
- **And** a code that is not a code at all (wrong characters or length), or a
  body with any other key, is the fixed 400
- **And** a property test (fast-check): for any string, the normaliser either
  yields a well-formed code or refuses it, and never throws.

**GRP-01-AC3 — A valid invitation brings one person in, with a device bound to
the phone.**
- **Given** an unused invitation created less than 7 days ago
- **When** a phone joins with it, its join key and the display name the person
  typed
- **Then** 201 with a credential (43 base64url characters), the new user's ID
  and the role `MEMBER`, and `Cache-Control: no-store`
- **And** one user, one membership in the group, one device holding only the
  credential's SHA-256; the invitation used, with its time, user and the join
  key's hash
- **And** the credential authenticates on the next request (`GET /v1/me`
  answers that user, name and role).

**GRP-01-AC4 — An invitation works once, and the database decides a race.**
- **Given** an unused invitation
- **When** two joins with it and different join keys arrive at once
- **Then** exactly one is 201 and the other 404 `INVITATION_NOT_VALID`
- **And** one user, one membership and one device exist (L3, two connections).

**GRP-01-AC5 — A join whose answer was lost can be retried.**
- **Given** a join that succeeded with join key K
- **When** the same code is sent again with K (F2)
- **Then** 201 again, with the same user ID and a new credential
- **And** the first credential is now refused (401) and the new one works
- **And** no second user, membership or device exists
- **And** the same code with another key is 404, and so is the same key once
  the invitation has expired or the user has been removed.

**GRP-01-AC6 — An invitation expires at 7 days, exactly.**
- **Given** an invitation created at T, database time
- **When** a join arrives at T + 7 days − 1 ms, and another one's at T + 7 days
- **Then** the first is valid and the second is `INVITATION_NOT_VALID`
- **And** a property test over creation and try times: valid exactly when the
  try is before T + 7 days and the invitation is unused (L2, fake clock)
- **And** the comparison is the database's now(), never the process's (L3).

**GRP-01-AC7 — The device credential is 256 random bits, kept only as a hash.**
- **Given** the issuer
- **Then** it takes 32 bytes from `crypto.randomBytes` (a test spies on it,
  D-091), encodes them base64url, and only their SHA-256 reaches the database
- **And** no response but the join's carries a credential, and no log line
  ever does (AC24).

**GRP-01-AC8 — The first admin joins with the bootstrap code.**
- **Given** an empty database and a usable `ADMIN_BOOTSTRAP_CODE`
- **When** a phone joins with it
- **Then** 201 with the role `ADMIN`; one group, one admin membership, one
  device, and a `GROUP_CREATED` audit row, in one transaction
- **And** a second join with it, or two at once, leaves exactly one group and
  one admin (L3)
- **And** with the setting unset or unusable, the API says so in one line at
  start, naming the setting and never a value, and a join with any code finds
  no group (404).
- **And** (*review loop 1*) a retry of that join with the same code and the
  same join key, while the admin is the group's only member, is 201 with the
  same user ID, the role `ADMIN` and a new credential; the first credential
  is then refused (401) and the new one works; no second group, membership,
  device or `GROUP_CREATED` row exists; the admin's display name is the
  first join's (L3, L6)
- **And** the bootstrap code with another join key, or with the same key once
  a second member has joined, is the same 404 `INVITATION_NOT_VALID`, and
  writes nothing
- **And** the code sent is compared with the setting as the SHA-256 digests
  of both, by `crypto.timingSafeEqual` (a unit test spies on it, as AC7's
  does on `crypto.randomBytes`), and never with `===` (L2)
- **And** Terraform makes the code with `random_bytes.admin_bootstrap_code`,
  `length = 16`, `keepers = { generation =
  local.admin_bootstrap_code_generation }` as its only keeper, the local set
  in `main.tf`'s `locals` (as `canary_credential_generation` is), and the
  app's environment takes `upper(random_bytes.admin_bootstrap_code.hex)`; no
  `.tf` file in
  `infra/staging/` declares a `random_id` resource (a static test, as the
  existing ones read `main.tf`), so no plan prints the code. *Review loop
  2:* nor a `random_string` or `random_integer` resource, whose values a plan
  prints as well (D-137).

**GRP-01-AC9 — Only the admin invites and lists members, and there is one
admin.**
- **Given** a member M who is not the admin
- **When** M asks for an invitation, or for the member list
- **Then** 403 `NOT_THE_ADMIN`, and nothing is written
- **And** the admin's list holds each member's ID, display name and role, and
  no canary user
- **And** the database refuses a second `ADMIN` in the group and a second
  group (L3).

### Sessions

**GRP-01-AC10 — The public routes are exactly health and the join.**
- **Given** the routes read from the contract, and a public list holding
  `GET /v1/health` and the join
- **When** every other route is called without a credential, with an empty
  one, another scheme, or `Bearer` and nothing
- **Then** each is the one 401, as SM-01-AC9 holds today.

**GRP-01-AC11 — A device authenticates only while its user is a member.**
- **Given** member M with a device D
- **When** M's membership is removed (AC17)
- **Then** D's next request to every authenticated route is the one 401, the
  same body as an unknown credential
- **But** while D's own journey has not ended, its heartbeats and
  "I'm home" are accepted, and every other route is 401; once it has ended,
  those are 401 too
- **And** the canary's device still authenticates (it has no membership)
- **And** a store that cannot answer is still a 500, never a 401 (L3, L6).

### Who can be a responder

**GRP-01-AC12 — A journey's responders must be current members of the
walker's group.**
- **Given** walker W, members R1 and R2, a removed member X, a user U who never
  joined, and the canary's responder
- **When** W starts a journey naming R1 and, in turn, X, U, the canary's
  responder, or W
- **Then** R1 alone is accepted; each of the others is 422 `INVALID_RESPONDER`
  and nothing is stored, the whole start refused as today (SM-01).

**GRP-01-AC13 — A member removed while a start is in flight is not stored as
its responder.**
- **Given** a start naming R that has read R as eligible
- **When** R's membership is removed before the start writes
- **Then** the start writes nothing and answers `INVALID_RESPONDER`, or the
  removal, if it takes the row second, removes R from the journey (L3, two
  connections, both orders).

**GRP-01-AC14 — The canary's credential can name only the canary's responder,
and the canary still runs.**
- **Given** the canary registered as the worker registers it, and real members
- **When** the canary's device starts a journey naming a real member
- **Then** 422 `INVALID_RESPONDER`
- **And** naming `CANARY_RESPONDER_ID` alone starts it, and a canary run
  through the API ends `ON_TIME`, unchanged (the existing REL-10 system tests
  pass without edits)
- **And** no member can name the canary's walker or responder (AC12).

**GRP-01-AC15 — The canary's users join no group and are never touched by a
join.**
- **Given** the canary registered, and any number of joins and bootstraps
- **Then** neither canary user has a membership; the database refuses one
  (the check on `memberships`)
- **And** `CANARY_DEVICE_ID` keeps its user and its hash, and no join writes a
  device for a canary user
- **And** the admin's removal of either canary ID is 404 `MEMBER_NOT_FOUND`
- **And** only `worker.ts` may import `adapters/canary.ts` (the import rule
  stands, L1).

### The admin removes a member

**GRP-01-AC16 — The admin's removal: the answers.**
- **Given** admin A, member M, and a user who is not a member
- **When** A removes M → 200 `REMOVED`
- **And** A removes M again, or a user who is not a member → 404
  `MEMBER_NOT_FOUND`; A removes A → 409 `CANNOT_REMOVE_ADMIN`; M removes
  anyone → 403 `NOT_THE_ADMIN`; a user ID that is not a UUID → the fixed 400
- **Then** none of the refusals writes anything.

**GRP-01-AC17 — The removal takes effect at once, in one transaction.**
- **Given** member M, a responder on two unended journeys J1 and J2 and on an
  ended journey J0, with two devices
- **When** the admin removes M
- **Then** in one transaction: M's membership (and with it M's display name)
  is gone; M's responder rows on J1 and J2 are deleted and J0's left as they
  were (SM-10, SM-07); one `MEMBER_REMOVED` audit row names the admin, M and
  the database's time
- **And** from the commit, both of M's devices are 401 (AC11).

**GRP-01-AC18 — A removed member stops receiving alerts.** (L6, recording
push and SMS fakes, controlled clock)
- **Given** walker W on a journey followed by members R1 and R2, the journey
  silent long enough that its lost-contact alert is open, and R1's message
  not yet handed to the push port
- **When** the admin removes R1
- **Then** R1's unsent messages of the journey's alerts are withdrawn and none
  is ever handed to the push or SMS port
- **And** when the alert escalates at two minutes, only R2 gets the SMS
- **And** on a second journey by W that goes silent after the removal, no
  message of any kind names R1.

**GRP-01-AC19 — A removed acknowledger, or the last responder, is SM-10's
removal, reached through the admin.** (L6)
- **Given** R1 on "I'm on it" for an alert that has already sent its SMS
- **When** the admin removes R1
- **Then** the alert is back to `OPEN`, nobody recorded, its round raised, and
  every remaining responder gets a second SMS at the next sweep (D-122,
  item 1)
- **And given** a journey whose only responder is removed by the admin
- **Then** the walker gets the `NO_RESPONDER` warning (SM-02), and if the
  journey then goes silent, its alert opens with nobody to tell and the SMS
  check reports failing (D-122, item 3).

**GRP-01-AC20 — A removal that cannot finish changes nothing.** (L3)
- **Given** member M on two unended journeys, the second's row held by
  another transaction past the removal's lock limit (or a failure injected
  after the first journey's step)
- **When** the admin removes M
- **Then** 500, nothing written (M still a member and on both journeys, no
  audit row), one closed line naming the stage and the SQLSTATE
- **And** the same removal, retried once the row is free, completes as AC17.

**GRP-01-AC21 — A removed member who is walking keeps their own journey to its
end.**
- **Given** member M walking, followed by R1
- **When** the admin removes M
- **Then** M's journey is unchanged and R1 still follows it: silence still
  alerts R1 (L6, the full LOST-02 flow); M's heartbeats and "I'm home" are
  accepted
- **And** M can start no new journey (no eligible responder), acknowledge
  nothing, and reach no admin or member route
- **And** once M's journey ends, M's device is 401 everywhere.

### The walker removes a responder

**GRP-01-AC22 — The walker removes a responder from their own journey.** (L6)
- **Given** walker W on a journey followed by R1 and R2
- **When** W removes R1
- **Then** 200 `REMOVED`, with SM-10's effects: R1's row deleted, an alert R1
  was on reset, R1's unsent messages withdrawn, and the `NO_RESPONDER` warning
  if none is left
- **And** R1 is still a member of the group, and W may name R1 again on a
  later journey.

**GRP-01-AC23 — The removal route's answers, and the one answer for others.**
- **Given** W's journey J followed by R1, another member X, and J's responder
  R2
- **When** X or R2 asks to remove anyone from J, whatever J's state; or anyone
  names a journey that does not exist
- **Then** each is the same 404 `JOURNEY_NOT_FOUND`, the same body
- **And** W naming someone who is not on J is 409 `NOT_A_RESPONDER`; W on an
  ended J is 409 `JOURNEY_ENDED`; a journey or user ID that is not a UUID is
  the fixed 400
- **And** none of them writes anything, and none writes a log line but the
  ended journey's (SM-07).

### Paging, the log and privacy

**GRP-01-AC24 — Nothing secret or personal reaches a log line.** (L3, the
existing log-capture tests' way, PRIV-07)
- **Given** a run through every new route, success and refusal, with
  synthetic names, codes and keys
- **Then** no line written by the API contains an invitation code, a join
  key, a credential or its hash, a display name or a user's ID
- **And** every new event is in `log.ts`'s closed list.
- **And** (*review loop 2*) when the store fails, the join writes one
  `join_failed` line and an invitation's creation one `invitation_failed`
  line, each with `stage: 'store'` and the SQLSTATE, and the store's error
  goes on (L2).

**GRP-01-AC25 — The worker does not check in while the SMS check is not
reporting.** (L2, in-process, as `worker.test.ts` runs the worker; D-122)
- **Given** a usable `HEALTHCHECKS_WORKER_URL`
- **When** `HEALTHCHECKS_SMS_URL` is unset, unusable, or names the worker's
  own check
- **Then** the worker sends no check-in, and its start line says the worker's
  check is withheld because the SMS check is not reporting, and what goes
  unpaged, naming no URL
- **And** the watchdog still sweeps and the senders still run
- **And** with a usable SMS URL of its own, the check-in runs as today.

### The app

**GRP-01-AC26 — A new install joins with an invitation.** (L5; L7 Android)
- **Given** a fresh install, no stored credential
- **Then** the join screen shows, in bokmål on a bokmål phone
- **When** a valid code and the person's own name are entered and sent
- **Then** the credential and join key are in secure storage and nowhere else
  (L5, with the store mocked), and the member screen shows
- **And** L7: the first admin joins with the job's synthetic bootstrap code
  and sees the admin's choices.

**GRP-01-AC27 — The app says plainly when joining fails, and never looks
joined.** (L5; L7 for the invalid code)
- **When** the join answers 404, 400, 500, or the network fails
- **Then** a 404 or 400 shows one message (ask the admin for a new
  invitation); a 500 or network failure shows that nothing was saved and
  offers a retry, which sends the same join key (AC5)
- **And** the member screen is never shown.

**GRP-01-AC28 — The admin invites and removes in the app.** (L5; L7 for the
invitation)
- **Given** the app signed in as the admin
- **Then** the invite screen creates an invitation and shows its code, its
  expiry date and a share action
- **And** (*review loop 1*) the code shows as four groups of five, each group
  kept whole when the line wraps; it is announced when it appears; and its
  screen-reader label spells it character by character, group by group
- **And** (*review loop 2*) that label and that announcement begin with the
  code field's own name (`grp.join.codeLabel`, "Invitasjonskode") and a
  colon, so the characters are never read without saying what they are
- **And** the members screen lists names and roles, and removing a member
  asks for confirmation that says it takes effect at once, then shows the list
  without them
- **And** (*review loop 1*) the confirmation appears in that member's place
  in the list, not after it; its confirm button's label names the member;
  its text says they get no more alerts and need a new invitation to join
  again, and says neither that their phone is signed out at once nor
  "deres"; once the list shows without them, the removal is announced
- **And** (*review loop 1*) a removal answered 403 or 409 says the removal was
  refused, never that the server could not be reached; one answered 404
  `MEMBER_NOT_FOUND` shows the list without them, as a done removal
- **And** (*review loop 2*) one answered with any other 4xx, a 404 without
  `MEMBER_NOT_FOUND` among them, says the removal was refused too, and the
  list still shows them
- **And** a member who is not the admin sees neither choice.

**GRP-01-AC29 — A 401 signs the phone out loudly; nothing else does.** (L5)
- **When** any call answers 401
- **Then** the stored credential is deleted and the join screen shows a line
  saying this phone is no longer signed in to the group
- **And** a 500 or a network failure keeps the credential and says the server
  could not be reached.

**GRP-01-AC30 — Every word is translated, every control labelled.** (L5)
- **Then** every string of the new screens comes from `nb.json` and `en.json`,
  with the same keys in both (the existing translations test), every control
  has a screen-reader label, and no screen says or implies the user is
  protected
- **And** (*review loop 1*) every text field has a visible label that stays
  shown while text is typed, not a placeholder alone
- **And** while any request is in flight, the screen shows a waiting
  indicator with a screen-reader label
- **And** (*review loop 2*) while a removal is in flight, that indicator
  shows inside the confirmation, next to its buttons, where the admin acted,
  not only at the top of the list; and the indicator is an accessibility
  element (`accessible`) carrying its label
- **And** every "try again" control reads "Prøv igjen" in bokmål and "Try
  again" in English: one key, or keys with the same text, on every screen.

### Added in review loop 1

**GRP-01-AC31 — A display name must hold something a person can see, and
nothing that changes how a name reads.** (*review loop 1*; L2, L6, L5)
- **Given** a join that is otherwise valid
- **When** its display name holds a bidirectional control (U+061C, U+200E,
  U+200F, U+202A to U+202E, U+2066 to U+2069), or any other format character
  (Unicode category Cf, such as U+200B or U+FEFF) but ZWNJ (U+200C) and ZWJ
  (U+200D); or holds no visible character (only white space, ZWNJ, ZWJ, or
  the blank fillers U+115F, U+1160, U+3164, U+FFA0, U+2800)
- **Then** the fixed 400; no user, membership, device or audit row is
  written, and the invitation stays unused (L6)
- **And** a name in any script with letters, digits, spaces, an apostrophe or
  a hyphen ("Åse", "O'Brien", "Anne-Marit"), a name with ZWNJ between two
  letters, and a name holding an emoji joined with ZWJ are accepted
- **And** a property test (fast-check) over any string: the contract's rule
  accepts it exactly when, once trimmed, it is 1 to 40 characters (counted
  as the green head's rule counts them), holds no Cc character, no Cf
  character other than U+200C and U+200D, and at least one visible
  character; it never throws (L2)
- **And** the app checks the name with the contract's own rule before it
  sends the join: a name the rule refuses is not sent, and the screen says
  plainly that the name cannot be used, never that the invitation does not
  work (L5).

**GRP-01-AC32 — The groups module is a safety path, and its mutants are run
by the tests that kill them.** (*review loop 1*; the gate's own tests)
- **Then** `apps/server/src/modules/groups/` is in `SAFETY_PATHS`, as a
  folder, and `apps/server/src/adapters/groups.ts` is not (proved at L3 and
  by the shared suite, D-095's reading)
- **And** a mutation group `membership` mutates `modules/groups/` against
  `groups.system.test.ts`, under the system tests' configuration;
  `mutationRuns` mutates each of its files exactly once. *Review loop 2:*
  against `apps/server/src/modules/groups/join.test.ts` and then
  `groups.system.test.ts`, under `vitest.coverage.config.mjs` (unit and
  system together, no L3), because only the unit file reaches `join.ts`'s
  guard for a code that is not a code: the contract refuses such a code
  before any request reaches the module. It is not named
  `groups`: that word is the mutation plan's output key in `ci.yml`'s three
  mutation jobs, where BUG-45-AC8 refuses any group's name
- **And** the `journeys` group runs `groups.system.test.ts` after its three
  files: the walker check in `modules/journeys/removal.ts` is killed only by
  that file's tests (AC21, AC23), as `safety-reviewer`'s planted mutant
  showed
- **And** each file of both groups reaches 80 % killed on its own (D-098).

**GRP-01-AC33 — A change to the server or the contracts runs the Android
flows.** (*review loop 1*; the gate's own tests)
- **Given** a pull request's diff
- **When** `scripts/affected.mjs` decides whether `android-e2e` runs
- **Then** a diff whose only change is a file under `apps/server/`, or only a
  file under `packages/contracts/`, can change what the flows check, and
  `android-e2e` runs
- **And** a diff of only `docs/`, or only `packages/test-kit/`, still does
  not, as INF-06 holds today.

## Test plan

| Level | Where | Criteria | Runs here? |
|---|---|---|---|
| L1 static | `tsc`, ESLint, dependency-cruiser | AC15 (the canary import rule); `features/grp/` reached only through its `index`; no clock in `domain/` or `modules/` | Yes |
| L2 domain and in-process | `domain/groups.test.ts` (validity, normaliser, admin rules, with fast-check), `domain/journey.test.ts` (the renamed set), `adapters/device-credentials.test.ts` (the issuer's spy), `config.test.ts`, `worker.test.ts`; *review loop 1:* the join module's test (the `timingSafeEqual` spy), `packages/contracts/src/groups.test.ts` (the display-name rule, with fast-check) | AC2, AC6, AC7, AC8 (config; the constant-time compare), AC9 (rules), AC25, AC31 (the rule) | Yes |
| The gate's own tests (Vitest, `test:unit`) | `scripts/infra.test.mjs` (`random_bytes`, no `random_id`), `scripts/lib/gate-decisions.test.mjs` and `scripts/lib/merge-rules.test.mjs` (the safety path and the groups), `scripts/lib/affected.test.mjs` (the triggers) | AC8 (Terraform), AC32, AC33 | Yes |
| L3 integration | `groups.integration.test.ts` (new), `adapters/device-credentials.integration.test.ts`, `removal.integration.test.ts`, `canary.integration.test.ts`; the shared behaviour suite for the group store (D-100) runs against the fake and the adapter | AC1, AC3 to AC9, AC11, AC13, AC15, AC17, AC20, AC24 | **No**: needs Docker; CI's `integration` |
| L4 contract | `api:spec`, `api:diff` (oasdiff) | "Contract changes": additive only | Yes |
| L5 app | jest-expo and React Native Testing Library under `apps/mobile/src/features/grp/` | AC26 to AC30; AC31 (the app's check) | Yes |
| L6 system | `groups.system.test.ts` (new), `removal.system.test.ts`, `journeys.system.test.ts`, `api.system.test.ts`, `canary.system.test.ts` (unchanged, must stay green) | AC1 to AC3, AC5, AC8 to AC12 (AC8: the bootstrap retry too), AC14, AC16 to AC19, AC21 to AC23, AC31 (the 400) | Yes |
| L7 Android | Maestro flows in `apps/mobile/e2e/`: the first admin joins; the admin creates an invitation and its code shows; a wrong code shows the one message | AC26 to AC28 | **No**: CI's `android-e2e` |
| L7 iOS | none | — | Not in this task: the app has no `ios` configuration until task 12 (D-134), so no iOS run exists, here or on the Mac |

**What this cloud session cannot verify:** L3 (no Docker daemon); L7 (no
emulator; CI's `android-e2e` runs it); any iOS behaviour (not configured);
Terraform's plan and apply, and reading `ADMIN_BOOTSTRAP_CODE` in Clever
Cloud's console (the owner's, A-36); that `staging-worker` pages when the SMS
check is withheld on a real deploy (only the owner sees Healthchecks.io). That
the staging plan prints no code with `random_bytes` was shown by
`privacy-security-reviewer` against a hand-written state, not by a plan of
staging's own state; A-36's plan is the first, and the owner is asked to stop
if it shows the code. A constant-time comparison cannot be timed reliably in
a test: AC8 holds that `timingSafeEqual` is what compares, not how long it
takes.

**L7 needs a server.** This is the first L7 flow that does. The `android-e2e`
job starts PostgreSQL and the API (with a synthetic `ADMIN_BOOTSTRAP_CODE`)
before the flows. That edits `.github/workflows/` and
`scripts/e2e-android.mjs`, both owned. Every later app task's L7 flow reuses it.

### Existing assertions that change by design (RG-03)

Each is a change of meaning made by this spec, written out so `test-auditor`
can check none is a weakening:

- **SM-01-AC9's public list** gains the join (SM-01's spec, item 5, asked for
  this "deliberately, in the test").
- **SM-01-AC13** ("Before the login task, nobody can get a credential"): its
  "the only public route is `GET /v1/health`" no longer holds; a freshly
  migrated database is still empty of users, devices, groups and invitations,
  and that half stays.
- **`INVALID_RESPONDER`'s meaning** moves from "not a user" to "not a member
  of the walker's group". Every L3 and L6 test that starts a journey must put
  its walker and responders in a group: the test kit's builders (`addUser`
  and the fake store) gain a group and memberships, and the shared journey
  behaviour suite's starts do the same. The domain's `existingUserIds` is
  renamed `eligibleResponderIds`: a rename, no assertion changed.
- **`device-credentials.ts`'s header**, "This adapter can only check a
  credential", becomes the issuer's description.
- **INF-06-AC11's flow** (`e2e/app-starts.yaml`): a cleared app now opens on
  the join screen, not the placeholder. The flow asserts the join screen's
  bokmål title and that no raw key shows; the placeholder's keys go.

Added in review loop 1:

- **GRP-01-AC8's Terraform tests** (`scripts/infra.test.mjs`): "main.tf makes
  the code with `random_id.admin_bootstrap_code`, 16 bytes" and the
  environment's `upper(random_id.admin_bootstrap_code.hex)` become
  `random_bytes.admin_bootstrap_code`, `length = 16`, with its generation
  keeper, and `upper(random_bytes.admin_bootstrap_code.hex)`. Not a weakening: the
  resource changes because `random_id` would print the code (B1), and AC8 gains
  the test that no `random_id` is declared.
- **The `MUTATION_GROUPS` pin** (`scripts/lib/gate-decisions.test.mjs`): the
  `journeys` group's tests gain `groups.system.test.ts`, fourth, and a new
  `membership` group follows it (AC32). Each only adds tests or mutants.
- **INF-06-AC13's "the server cannot"** (`scripts/lib/affected.test.mjs`):
  the two assertions that `apps/server/src/api.ts` cannot change the app
  become "can change what the flows check" (AC33). A meaning changed by the
  first L7 flows that need a server; the `packages/test-kit/` and `docs/`
  assertions stay. `apps/server/package.json` leaves the "cannot change the
  app" list for the same reason: AC33 covers every file under
  `apps/server/`.
- **The start route's `responderIds` description**, wherever a test or the
  generated `openapi.json` holds it: "an existing user" becomes "a member of
  the walker's group". A description change; `api:diff` passes it.
- **The app's translations and L5 tests**: the confirmation's text, the
  retry key's text ("Prøv på nytt" / "Try once more" become "Prøv igjen" /
  "Try again"), and the L7 flows' strings read from `nb.json` follow AC28
  and AC30.

Added in review loop 2:

- **The invite flow's code step** (`apps/mobile/e2e/first-admin-invites.yaml`)
  and its pattern tests (`scripts/lib/e2e-android.test.mjs`): the spelled
  label now begins with the code field's name and a colon (AC28). The
  pattern still proves 20 characters in four groups of five.
- **The `membership` group's pins** (`scripts/lib/gate-decisions.test.mjs`,
  `scripts/lib/merge-rules.test.mjs`, `scripts/stryker-config.test.mjs`): its
  tests gain `join.test.ts`, first, and its configuration becomes
  `vitest.coverage.config.mjs` (AC32). It only adds a test file to the run.
- **GRP-01-AC8's no-`random_id` test** (`scripts/infra.test.mjs`) refuses
  `random_string` and `random_integer` too. A stronger test.

## Mutation (D-036, D-098, D-099, D-129)

- `domain/groups.ts` joins the `domain` group; `modules/groups/` gets a group
  of its own against `groups.system.test.ts`, or joins `journeys` if the
  measured time allows. The implementer checks whether CI's per-group matrix
  (BUG-45) is read from `MUTATION_GROUPS` or written out in the workflow; if
  written out, the workflow edit is owned.
- *Review loop 1 (`safety-reviewer` S4), settled:* the green head did
  neither, so `modules/groups/` was mutated by no run. It goes into
  `SAFETY_PATHS` as a folder, with a group of its own, `membership`, against
  `groups.system.test.ts` under `vitest.system.config.mjs`, placed after
  `journeys`. And `groups.system.test.ts` joins the `journeys` group's
  tests, fourth: the reviewer planted a mutant that skips the walker check in
  `modules/journeys/removal.ts`, and it survived the group's three files and
  died to `groups.system.test.ts` (AC32).
- *Review loop 2 (`test-auditor` S1):* the fresh run at `3fac8fb` gave
  `join.ts` 83.3 %, with its `code === null` guard surviving: no request can
  reach it, and only `join.test.ts` (L2) kills it. The `membership` group now
  runs `join.test.ts` and then `groups.system.test.ts` under
  `vitest.coverage.config.mjs`, which holds the unit and the system files
  and no L3 (AC32).
- `api.ts` is not a safety path and is mutated by no group, as before this
  task. The reviewer's second surviving mutant, `api.ts`'s full-access gate
  always open, is killed by `groups.system.test.ts` (AC21, AC23), which
  `test:system` and `test:coverage` run either way; but no mutation run will
  find the next such gap in `api.ts`. Adding `api.ts` to `SAFETY_PATHS` is
  not part of this loop: it is a BUG of its own (Left for later tasks).
- `adapters/groups.ts` is proven at L3 and by the shared suite and not mutated
  (D-095's reading), as `adapters/journeys.ts` is.
- Each file ≥ 80 %, every run fresh.

## Modules and files affected

**Server (`apps/server/src/`):** `domain/groups.ts` (new) and its test;
`domain/journey.ts` (the renamed set, the doc comment); `modules/groups/`
(new); `modules/journeys/service.ts` (eligibility); `modules/journeys/removal.ts`
(the walker check); `adapters/groups.ts` (new);
`adapters/device-credentials.ts` (the issuer; authentication by membership);
`adapters/journeys.ts` (the eligibility query and `FOR SHARE`; the removal's
in-transaction step exported; `walkerId` in `journeyForRemoval`); `ports.ts`;
`db/schema.ts` and one migration; `api.ts` (six routes); `api-process.ts`
(wiring); `config.ts` (`ADMIN_BOOTSTRAP_CODE`); `worker.ts` (AC25); `log.ts`
(new closed events).

**Contracts (`packages/contracts/src/`):** `groups.ts` (new), `journeys.ts`
(the removal route; `INVALID_RESPONDER`'s message), `contract.ts`, `index.ts`,
the generated `openapi.json` (never by hand).

**Test kit (`packages/test-kit/src/`, owned):** a fake group store, the
group store's behaviour suite, groups and memberships in the journey fake and
its builders, synthetic display names.

**App (`apps/mobile/`):** `src/features/grp/` (new), `src/app/` routes,
`src/shared/` (API client, secure storage wrapper), `nb.json` and `en.json`,
`app.config.ts` (owned; the API address, and the e2e build's cleartext rule if
used), `package.json`, `e2e/` flows.

**Infra and CI (owned):** `infra/staging/` (`random_bytes.admin_bootstrap_code`
since review loop 1, and its environment entry); `.github/workflows/` (the L7
job's server; any mutation matrix line); the first, separate pull request for
the ai-review filter, `OWNER_APPROVAL_PATHS` and CODEOWNERS (approach 1).

**Review loop 1 adds:** `db/schema.ts` and the migration
(`groups.bootstrap_join_key_hash`); `adapters/groups.ts` and
`modules/groups/join.ts` (the bootstrap retry, the constant-time compare);
`packages/contracts/src/groups.ts` (the display-name rule) and
`journeys.ts` (`responderIds`' description); `api.ts` (the detached JSDoc);
`apps/mobile/src/features/grp/` and the translations (AC28, AC30, AC31);
`scripts/lib/gate-decisions.mjs` (`SAFETY_PATHS`, `MUTATION_GROUPS`);
`scripts/lib/affected.mjs` (AC33); and, if the authentication query changes
(approach 5), `adapters/device-credentials.ts`.

**Docs:** this spec; the decisions; `docs/plan/monitoring-setup.md` (what the
canary's credential can name now; the withheld check-in, under "When
`staging-worker` pages you"; "If `ADMIN_BOOTSTRAP_CODE` leaks");
`docs/plan/08-cicd-releases.md` (the secrets inventory gains
`ADMIN_BOOTSTRAP_CODE`); `docs/plan/README.md` (A-36; "Open for M4", since
GRP-01). The three docs items were promised in the green head and missed;
review loop 1 makes them.

**New owner to-do, A-36** (D-136, answer 1; the row is in
`docs/plan/README.md`): after this task merges and deploys, `infra-staging`
plan and apply; then read `ADMIN_BOOTSTRAP_CODE` once in Clever Cloud's
console for the staging app and join with it in the app from the owner's own
phone (D-135). That this console shows the value was not checked from here.
Since review loop 1 the plan shows a new `random_bytes` and no value; a plan
that shows the code anywhere is a stop.

## Contract changes

All additive (AR-08); `api:diff` must pass.

| Route | Who | Success | Refusals besides 401 |
|---|---|---|---|
| `POST /v1/group/members` (join) | **public** | 201 `{ credential, userId, role }`, `Cache-Control: no-store` | 400 fixed; 404 `INVITATION_NOT_VALID` |
| `GET /v1/me` | any device | 200 `{ userId, displayName, role }` | 404 `NOT_A_MEMBER` (the canary's device) |
| `POST /v1/group/invitations` | admin | 201 `{ invitationCode, expiresAt }` | 400 fixed; 403 `NOT_THE_ADMIN` |
| `GET /v1/group/members` | admin | 200 `{ members: [{ userId, displayName, role }] }` | 403 `NOT_THE_ADMIN` |
| `DELETE /v1/group/members/{userId}` | admin | 200 `{ outcome: 'REMOVED' }` | 400 fixed; 403 `NOT_THE_ADMIN`; 404 `MEMBER_NOT_FOUND`; 409 `CANNOT_REMOVE_ADMIN` |
| `DELETE /v1/journeys/{journeyId}/responders/{responderId}` | the journey's walker | 200 `{ outcome: 'REMOVED' }` | 400 fixed; 404 `JOURNEY_NOT_FOUND`; 409 `NOT_A_RESPONDER`; 409 `JOURNEY_ENDED` |
| `POST /v1/journeys` (changed text only) | — | — | `INVALID_RESPONDER`'s message: "… or is not a member of the walker's group"; *review loop 1:* `responderIds`' description, "a member of the walker's group" for "an existing user" |

The join's body: `invitationCode` (string, normalised at the edge), `joinKey`
(43 base64url characters), `displayName` (the person's own; 1 to 40
characters after trimming; *review loop 1:* no control character, no
bidirectional control, no other format character but ZWNJ and ZWJ, and at
least one visible character, AC31), strict. The bearer scheme is
required on every route but health and the join.

*Review loop 1:* the display-name rule narrows what the join accepts. No
shipped app can be broken by it: no app version has shipped
(`packages/contracts/released/` does not exist yet, checked 2026-10-20), and
the join is new in this task. Whether `api:diff` sees a zod refinement at all
was not checked. The bootstrap retry changes no shape.

## Risks and failure modes

- **[F6](../plan/03-safety-reliability-security.md#failure-modes), a missed
  alert.**
  - *A responder who cannot be reached.* Today any user can be named; after
    this task only members (AC12). A member whose phone holds no working
    credential (a lost answer, a reinstall) could still be named; AC5 keeps
    the first case from making an orphan, and responder setup (task 9) shows
    readiness. A reinstall on Android loses the credential (secure storage
    goes with the app): the person needs a new invitation and becomes a new
    member, and the admin should remove the old one. Task 10's SMS sign-in
    ends this.
  - *A removal that half-happens* would leave a removed member alerted, or a
    walker believing someone follows who does not. One transaction (AC17,
    AC20).
  - *The admin removes the last responder of someone's journey*: the walker is
    warned (SM-02), and a silence then pages the owner through the SMS check
    (D-122, item 3) — which is why AC25 exists.
  - *The admin removes the acknowledger*: escalation resumes, with a second
    SMS at once if it had already gone (D-122, item 1; about €0.05 per
    remaining responder, D-024).
  - *The admin removes someone who is walking*: their journey keeps its
    protection to its end (D-136, answer 5). Silence on it still alerts the
    responders already on it (AC21), and nothing ends a walk's protection
    because of a removal.
- **[F7](../plan/03-safety-reliability-security.md#failure-modes), the server
  or watchdog down.** The authenticator now joins memberships: a database
  that cannot answer is still a 500, never a 401, so no walker is signed out
  by a blink (AC11). AC25 withholds a check-in rather than stopping the
  worker.
- **[F8](../plan/03-safety-reliability-security.md#failure-modes), a bad
  release breaks alerts.** The new eligibility rule could break the canary,
  whose users are in no group: AC14 runs the canary unchanged, and on staging
  `staging-canary` pages within one run. Every existing journey test needs its
  users in a group; a builder that quietly skipped that would hide a broken
  rule, so the shared suite asserts a non-member is refused (AC12).
- **[F2](../plan/03-safety-reliability-security.md#failure-modes), no
  coverage.** A join's lost answer would burn the invitation and leave an
  orphan member; AC5 makes the retry safe. Removal routes answer a repeat with
  `MEMBER_NOT_FOUND` or `NOT_A_RESPONDER`, which the app reads as done.
  *Review loop 1:* the bootstrap join's lost answer was the same failure at
  its worst, a group made with the owner outside it and nobody able to
  invite; AC8's retry covers it while the owner is the only member.
- **[F6](../plan/03-safety-reliability-security.md#failure-modes) and
  [F7](../plan/03-safety-reliability-security.md#failure-modes), a page
  nobody reads right** (*review loop 1*, `safety-reviewer` S3). With AC25,
  `staging-worker` can page while the worker is alive, the watchdog sweeps,
  `/v1/health` answers ok and UptimeRobot is green: the check-in is withheld
  because the SMS check is not reporting. Read as "the worker is down", it
  sends the owner the wrong way. `monitoring-setup.md` gains "When
  `staging-worker` pages you", whose first step is the worker's withheld
  start line. A Healthchecks.io check that has never been pinged does not
  page at all, so a new `staging-worker` check, after a rotation, must be
  seen to leave `new` (the rotation steps already ask it).
- **[F6](../plan/03-safety-reliability-security.md#failure-modes), a walking
  removed member signed out by their own app** (*review loop 1*,
  `safety-reviewer` S1, `privacy-security-reviewer` N3). AC29 deletes the
  credential on any 401, and `GET /v1/me` answers a walker-only device 401.
  Harmless in task 1, which has no journey in the app; task 3 must not ship
  without its fix (Left for later tasks), or a removed member's walk would
  stop sending heartbeats and could no longer say "I'm home".
- **[F10](../plan/03-safety-reliability-security.md#failure-modes), someone
  else's unlocked phone.** Whoever holds the admin's unlocked phone can invite
  and remove. Known limitation; the admin-account threat's stronger login, the
  passkey, comes in M4 (D-136, answer 2).
- **A lost admin phone** leaves no admin until a new device can sign in (task
  10's SMS sign-in): nobody can invite or remove. On staging the
  owner would need help from a database operation. Stated, not solved here.
- **A leaked invitation** lets whoever has it join as a member, once, within
  seven days. The leaked-invitation threat's binding to a phone number needs
  a proof of the number, which is SMS (task 10, and the roadmap's M4); until
  then the admin sees every new member by name and can remove them.
- **Real people's data on staging.** Nothing technical stops the owner from
  inviting someone real before M5; D-135 allows only the owner's own data.
  The invite screen does not enforce it.
- **The bootstrap code** opens only an empty group. If the staging
  database were emptied, it would open again: anyone holding it could become
  admin of the new group. It lives only in Terraform's state and the app's
  environment, as the canary's credential does. *Review loop 1:* and in no
  job log, because `random_bytes` keeps it sensitive (approach 8); the
  green head's `random_id` would have printed it in every public
  `infra-staging` plan. Its retry needs the join key too, which only the
  owner's phone holds, so the code alone re-opens nothing once the group
  exists. What a leak means and how it is replaced are in
  `08-cicd-releases.md`'s inventory and `monitoring-setup.md`.
- **Display names are personal data** in the EEA (D-016, the EEA rule), never
  logged (AC24), deleted with the membership; the privacy notice and the
  DPIA (M4) must name them.
- **A display name that misleads** (*review loop 1*, the abusive-member
  threat): a name with a right-to-left override can read as someone else's,
  and one of zero-width characters shows as nothing in the admin's list, so
  the admin cannot see who joined. AC31 refuses both. Look-alike letters
  from other scripts ("Kаri" with a Cyrillic а) are not refused; the admin
  sees every new member and can remove them.

### Flags from other decisions, checked

- **D-087:** no new message kind and no notification in this task, so the
  alert-level rule's test over every message kind is not touched. The
  new-device notice, when it comes, must be non-critical.
- **D-086:** nothing here touches the location SDK or heartbeats' bodies.
- **D-023:** no over-the-air updates; nothing added fetches code.
- **D-016, the no-analytics rule:** every new package is first-party Expo,
  oRPC or TanStack, with no telemetry; `licenses:check` runs.

## Out of scope

- **The #1 contact** (task 2); **responder setup and readiness** (task 9);
  **SMS sign-in on a new device and SMS itself** (task 10, A-12); **push**
  (task 6), which must send only to devices that authenticate.
- **The new-device notice** (task 10) and **the admin's passkey** (M4), both
  by D-136, answer 2; and the admin's revoke-sessions of the account-takeover
  threat, one phone at a time (M4, D-136, answer 4).
- **Binding an invitation to a phone number**, **age bands at invitation**
  (the minors rule), the privacy notice, export and deletion, and leaving the
  group on one's own (M4, the roadmap's M4 row).
- **A responder leaving a journey on their own**, and **the admin removing a
  responder from one journey**: in no story.
- **Revoking an unused invitation, a list of open invitations, renaming a
  member, a second admin, several groups.**
- **The member list for non-admins**, which the start-a-journey story (task 3)
  needs to pick responders; it can open `GET /v1/group/members` to members
  then.
- **The walker's journey screen**, its loud no-responder state (D-087) and the
  responder removal's button: tasks 3 and 5.
- **Rate limiting**, as SM-01's spec left it.
- **Retention** of memberships, invitations and audit rows, and the DPIA (M4).

### Left for later tasks

- **A BUG of its own, after GRP-01 merges: `api.ts` is mutated by no run**
  (*review loop 1*, from `safety-reviewer` S4; to be queued by the
  coordinator). `apps/server/src/api.ts` is not in `SAFETY_PATHS`, so no
  mutation run tests it, yet its middleware decides which routes a device
  reaches: full access for a member or the canary, and only heartbeats and
  "I'm home" for a walker-only device (approach 5). `safety-reviewer`'s
  planted mutant, that gate always open, survived the journeys group and was
  killed only by `groups.system.test.ts`, which `test:system` runs but no
  mutation run reads for `api.ts`. The fix: `api.ts` into `SAFETY_PATHS`,
  with a mutation group against the system tests that reach its routes,
  measured first for time (D-066, D-098), and the owner's and safety
  review's paths checked (`merge-rules.mjs`).
- **Task 2 (the home screen)** (*review loop 1*, `a11y-i18n-reviewer` S1):
  dark-first screens. GRP-01's screens are light-only: `ui.tsx` hard-codes
  its colours (`#1f4e79` on black is 2.4:1), sets no background or text
  colour, and `app.config.ts` sets no `userInterfaceStyle`, so Expo's default
  is light. INF-06 deferred dark mode, status-bar contrast and
  `SafeAreaProvider` to the real home screen, which is task 2's. Task 2 makes
  the shared kit dark-first, these screens with it; the reviewer will block
  task 2 if the home screen is still light-only.
- **Task 3 (start a journey):** the member list for members; the responder
  picker; the removal route's button; what the app shows a walker whose
  removal of the last responder answers `REMOVED`.
  *Review loop 2 (`privacy-security-reviewer`, note 2):* AC31's rule accepts
  a name made only of combining marks (Mn, Me: U+034F, U+FE0F, U+0301 each
  came back usable) and a line or paragraph separator (U+2028, U+2029)
  inside a name, which can break a line in a list. When task 3 shows the
  member list to members, it either refuses a name with no base character
  and any Zl or Zp character, with tests at L2 and L6, or records why it
  accepts them.
  *Review loop 1 (`safety-reviewer` S1, `privacy-security-reviewer` N3):*
  the app deletes its credential on any 401 (AC29), but a removed member's
  walking phone is admitted only as a walker (approach 5), so `GET /v1/me`
  answers it 401, and an app restart mid-walk would delete the credential:
  no more heartbeats, and no "I'm home". Task 3 must either not delete the
  credential while the phone holds a journey it has not seen end, or have
  `GET /v1/me` answer a walker-only device with something other than 401
  (a contract change, additive). Either way the walk keeps its device until
  it ends (D-136, answer 5), and the phone is signed out after.
- **Task 6 (push):** targets only for devices that authenticate; a removed
  member's device gets nothing but the messages to the walker of its own
  unended journey, so the walker's own `NO_RESPONDER` warning still reaches
  them when their last responder goes (*corrected in review loop 1*,
  `safety-reviewer` S2; the green head's "gets nothing" would have dropped
  it, F6); the canary's responder never at the critical level (D-128).
- **Tasks 7 and 8 (alert screen, map):** every read of an alert or a position
  checks the caller's responder row and membership (the responders-only rule).
- **Task 10 (SMS):** sign-in on a new device; Better Auth's UUID question;
  the new-device notice, to the member and the admin (D-136, answer 2);
  binding an invitation to a number.
- **Task 2 (the home screen)**, also (*review loop 2*, `a11y-i18n-reviewer`):
  the waiting indicator's colour is the platform default, below 3:1 on white
  on iOS; it takes the palette's colour with the rest.
- **Task 12 (the iOS build)** (*review loop 2*, `a11y-i18n-reviewer` S3):
  `accessibilityLiveRegion` is Android-only in React Native 0.86, so on iOS
  the screens' messages (the confirmation, the removal's result, the refusal,
  `grp.join.nameNotUsable`, the errors) are silent in VoiceOver; only the
  invitation code is announced on both, by `announceForAccessibility`.
  AC28's "the removal is announced" holds on Android until task 12 announces
  each message on iOS too. Task 12 also checks where VoiceOver's focus goes
  when the confirmation replaces the pressed "Fjern" button, and that the
  waiting indicator's label, not the system's "In progress", is what
  VoiceOver reads. All three on a device.
- **M4:** the admin's passkey (D-136, answer 2); a device's `revoked_at` for
  the admin's revoke-sessions (D-136, answer 4); retention of the new tables;
  the DPIA naming display names. *Review loop 2 (`privacy-security-reviewer`,
  note 1):* the bootstrap retry gives the admin's device a new credential
  and writes no audit row, as an invitation's retry writes none; M4's admin
  audit log decides whether a credential's re-issue is an audited action.

## Settled by the plan, so not asked

D-137 records the choices among these that were Claude's (D-031).

- **One group, a user in at most one:** D-008, D-009 and the story's "the
  group" (reading 1).
- **No web link:** D-013. The owner also chose no custom-scheme link (D-136,
  answer 3).
- **Better Auth waits:** D-091 gives issuance to this task, D-134 takes SMS
  out of it, and D-031 delegates the library's timing (approach 4).
- **The issuer's randomness and the hash:** D-091.
- **Who may remove a responder from a journey:** the walker (the
  abusive-member threat); the admin removes members; a responder leaving is in
  no story (approach 10).
- **The combined answer, the audit entry, UUID validation, the SMS check's
  guard:** D-122 and SM-10's spec name each; approach 10 and 11 choose within
  them (D-122 offered "refuse to start, or make a check fail"; failing the
  worker's check keeps the watchdog running).
- **The canary's place:** D-128 (approach 7).
- **The age band, phone binding, privacy notice:** the roadmap's M4 row.

## Where the plan disagrees with itself

1. **The new-device notice:** SM-01's spec puts it in "the login task" (M3);
   the roadmap's M4 row (the threat model's IDs) and
   `critical-alerts-request.md` lines 522-523 ("which comes in M4") put it in
   M4. D-134 names this tension. Neither placement can be task 1: no sign-in
   on a new device exists before task 10, and no push before task 6.
   **Resolved:** task 10 (D-136, answer 2).
2. **D-128 against SM-01's spec:** the canary's users "join no group", while
   the responder check becomes "a current member of the walker's group". Taken
   together, the canary's walker could name nobody and every canary run would
   fail and page. Approach 6 gives the canary's walker its own responder, and
   only it, which is what D-128's "re-check" asks.
3. **The leaked-invitation threat against D-134:** invitations are to be
   "bound to the invited phone number", but D-134 starts sign-in without SMS,
   and a number cannot be bound without proving it. The roadmap puts that
   threat in M4; this spec leaves the binding to task 10, where proving a
   number first becomes possible, or M4.
4. **SM-10's spec against this one:** it describes the admin's removal as
   calling the store operation "once per journey"; approach 9 runs it inside
   one transaction instead, for the reason given there.
5. **D-134's "UI work runs on the Mac" against this session:** the app half of
   this task needs no simulator (no iOS until task 12); L5 runs here and L7
   Android in CI. Whether the app half is built here or on the Mac is for the
   coordinating session or the owner; nothing in this spec needs the Mac.
6. **`05-architecture.md`'s data model** puts "age band and role per
   membership" together; the age band is the minors rule's, which the roadmap
   puts in M4. This task adds the role only.
7. **D-091's "GRP-01 decides Better Auth's use of UUID user IDs"** cannot be
   decided where Better Auth is not installed (approach 4).

## Questions raised by review loop 1

Two were settled by the coordinator under D-031: the bootstrap code's
generation keeper (approach 8, AC8), and `api.ts`'s mutation gap, which goes
to a BUG of its own (Left for later tasks). One is the owner's:

- **Files that carry authentication but have no code owner**
  (`privacy-security-reviewer` N5): `apps/server/src/config.ts`,
  `apps/server/src/bin/api.ts`, `apps/server/src/ports.ts`,
  `packages/contracts/src/groups.ts`, and in the app
  `src/shared/secure-storage.ts`, `src/shared/api/client.ts` and
  `package.json`. Raised in the pull request for the owner. It blocks none of
  this task's criteria.

## Owner's answers

The owner answered all five questions on 2026-10-20, asked in Norwegian, one
at a time, each with Claude's recommendation, and chose the recommendation each
time. Recorded as D-136, with the alternatives offered.

1. **The first admin:** "Terraform makes a one-time bootstrap code. It works
   only while no group exists and does not expire after 7 days." The owner
   reads it once in Clever Cloud's console and joins with it (A-36).
   Approach 8; AC8.
2. **The admin's passkey and the new-device notice:** "the new-device notice
   comes with task 10, and the admin's passkey in M4." Neither is in this
   task.
3. **What an invitation looks like:** "a code only. The person types their
   own name when they join." Approach 3 and 4; AC1, AC3, AC26.
4. **How long a phone stays signed in:** "a session lasts until the member is
   removed. No time limit and no rotation in M3. Revoking a single phone comes
   in M4." Approach 5; AC11.
5. **A member removed while walking:** "keeps their own journey to its end,
   followed by the responders already on it. Their phone may send only
   heartbeats and 'I'm home' for that journey, and is signed out when it
   ends." Approach 5 and 9; AC11, AC21.
