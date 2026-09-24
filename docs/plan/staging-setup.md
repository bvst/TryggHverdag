# Staging setup — the owner's steps (INF-07)

**Last updated:** 2026-09-24 · Decisions: D-077

Everything here is something only the owner can do: it creates accounts,
spends money or handles keys. Claude builds the code, the Terraform and the
workflows in the INF-07 pull request; none of it needs these steps until that
pull request has merged, so they can be done in parallel.

About 20 minutes in total. Nothing here needs the Mac, but step A-19 needs a
computer with Node.js (`npx`).

## A-18 — The staging organisation (Clever Cloud console, as yourself)

1. **Add an organisation** named `TryggHverdag Staging`, with the AS's billing
   details and a payment method. Staging lives here and nowhere else (D-046).
2. Open the organisation's **Information** page and copy its ID, which looks
   like `orga_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`. **Send it to Claude.** It
   is an identifier, not a secret, and goes into `infra/staging/` so every
   change to it is reviewed.

## A-19 — The CI user and its key

CI holds this user's key, and a key reaches every organisation its user is a
member of. So this user is a member of the staging organisation and **nothing
else**, ever (D-077). Production gets its own user at go-live.

1. **Sign up a new Clever Cloud user** with an address that is not
   `dev@urso.no` (for example `ci-staging@urso.no`). Turn on two-factor login.
2. As yourself, in the staging organisation → **Members**, invite it with the
   role **Manager** — the smallest role that can create a database, which
   Terraform needs (Developer cannot). It can also invite members to this
   organisation; it cannot delete the organisation or see the bills.
3. Accept the invitation as the CI user.
4. Get its key. On a computer, open a **private browser window** and log in to
   the console as the CI user — not as yourself, or the key will be yours. Then
   run `npx clever-tools@latest login` and, when it opens a page or prints a
   URL, finish the login in that private window. The key is now in
   `~/.config/clever-cloud/clever-tools.json` as `token` and `secret`.
5. Save them in GitHub (A-21), then delete the local copy:
   `npx clever-tools@latest logout`.

The key expires after one year. Put a reminder in your calendar for eleven
months from today: when it lapses, every deploy fails, loudly.

## A-20 — Where Terraform keeps its state (Clever Cloud console, as yourself)

Terraform writes down what it has created in a *state* file. It lives in a
Cellar bucket, Clever Cloud's S3-compatible storage, in the staging
organisation. Terraform cannot create the place it stores its own state, so
this one thing is made by hand.

1. In the staging organisation, create a **Cellar** add-on named
   `trygghverdag-staging-tfstate` in region **Paris**.
2. In its dashboard, create a bucket named `trygg-hverdag-staging-tfstate`.
3. From the add-on's environment variables, copy `CELLAR_ADDON_KEY_ID` and
   `CELLAR_ADDON_KEY_SECRET` for A-21, and **send Claude `CELLAR_ADDON_HOST`**
   (not a secret). `infra/staging/versions.tf` assumes
   `cellar-c2.services.clever-cloud.com`, the host Clever Cloud's documentation
   uses; if yours differs, that line changes before the first plan.

## A-21 — The GitHub environment that holds the keys

1. Repository **Settings → Environments → New environment** named `staging`.
2. **Deployment branches and tags → Selected branches and tags → add `main`.**
   This is the protection: a job can read these secrets only when it runs from
   `main`, so no pull request branch — Claude's included — can ever reach them.
3. Add four **environment secrets** (not repository secrets):

   | Name | Value |
   |------|-------|
   | `CLEVER_TOKEN` | `token` from A-19 |
   | `CLEVER_SECRET` | `secret` from A-19 |
   | `CELLAR_KEY_ID` | `CELLAR_ADDON_KEY_ID` from A-20 |
   | `CELLAR_KEY_SECRET` | `CELLAR_ADDON_KEY_SECRET` from A-20 |

GitHub cannot make these jobs wait for your approval in a private repository on
the Pro and Team plans — only Enterprise can. The approval is therefore built
from two runs you start yourself (D-077, and A-22 after merging).

## After the INF-07 pull request merges

- **A-22 — create staging.** Actions → `infra-staging` → Run workflow with
  action `plan`. Read what it will create in the run's summary (one Node.js
  app, one DEV PostgreSQL). Then Run workflow again with action `apply`, and
  in "plan run" paste that run's ID or its address (the summary shows the ID).
  It plans again and applies only if the plan is the one you read; if anything
  changed in between, it refuses and you plan again.
- **The first deploy.** The deploy that ran on merge will have failed, saying
  the app does not exist yet — on purpose, because a deploy with nowhere to go
  must not look green. Re-run it after A-22.
- **A-08 — UptimeRobot** can then watch
  `https://trygghverdag-staging.cleverapps.io/v1/health` (INF-08).
- **Optional:** add `trygghverdag-staging.cleverapps.io` to the cloud
  environment's allowed domains, so a session can check staging's health
  endpoint itself (`docs/plan/cloud-environment.md`).
