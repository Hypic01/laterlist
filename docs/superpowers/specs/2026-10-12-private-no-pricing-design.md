# Private Laterlist: owner-only sign-in, no pricing

**Date:** 2026-10-12
**Status:** design approved in chat by Joon; this written spec awaits his review
**Owner:** Joon

## 3-second line

Laterlist is Joon's private tool: only he can sign in, and nothing is metered or for sale.

## Why

Joon, 2026-10-12: "this product I'm going to use just for myself, like a hyper-personalized product for me." He chose "Only me" over "anyone, free" and "current users stay". This reverses the freemium plan (Polar billing, Pro, beta pricing) and the public launch posture.

## Changes

### 1. Owner-only sign-in

- New config `ownerEmails`: from `OWNER_EMAILS` (comma separated, lowercased), falling back to `ADMIN_EMAILS` when `OWNER_EMAILS` is unset.
- The lock is active when `ownerEmails` is non-empty, or when running in production (`config.serverless`, i.e. on Vercel). In production with no owners configured, everyone is refused and the server logs one clear error. In local dev (`DEV_FAKE_AUTH=1`) with no owners configured, the lock is off so the zero-account dev flow keeps working.
- `auth.required` checks the verified email against `ownerEmails` BEFORE `db.upsertUser`, so a refused visitor never gets a user row. Refusal is `403 { error: "This Laterlist is private." }`.
- Token auth (`importToken`, used by the extension and the picks run) refuses tokens whose user is not an owner, with the same 403.
- The web app shows a plain "This Laterlist is private." screen with a Sign out button when `/api/me` returns that 403.
- `BETA_ALLOWLIST` and its importer check are removed (the owner lock replaces them).

### 2. Billing removed

- Delete `server/billing.js`, its setup in `server/boot.js`, the webhook, checkout and portal routes in `server/app.js`, and the Polar config keys in `server/config.js`.
- Remove the `@polar-sh/sdk` and `standardwebhooks` dependencies (only `billing.js` uses them).
- Delete `tests/billing.test.js`.

### 3. Plans and limits removed

- One library cap remains as a safety limit, not a plan: `libraryCap` from `LIBRARY_CAP`, default 25,000 (today's fair-use number). The importer stores up to it for everyone.
- TL;DRs have no monthly quota and never return 402. The summaries meter is no longer read or shown.
- `BETA_PRO_FOR_ALL`, `FREE_VIDEO_CAP`, `PRO_VIDEO_CAP`, `FREE_SUMMARY_QUOTA` and every `isPro` / `plan === "pro"` / `betaProForAll` branch go away. Jobs use one tier.
- `/api/me` drops `plan`, `betaPro`, `summaryQuota`, `summariesUsed`, `videoCap`, `proEndsAt`, `proInterval`.
- Kept: the AI budget kill switch (`BUDGET_USD`), the worker invariants, `YOUTUBE_REMOVAL`.
- Database: no migration. Plan and billing columns stay in place, unused; no data is deleted.

### 4. Web app

- Delete `web/src/components/UpgradeBand.jsx` and its CSS.
- Settings: remove the Plan block (Upgrade, Manage plan, beta note).
- Video detail: remove the upgrade card and the TL;DR quota messages.
- App: remove the `?upgraded=1` toast, the at-cap logic, and plan wording ("you're at your plan's limit", "Your newest N videos sort free"). If the safety cap ever skips videos, say "older videos skipped, your library is full".
- `web/src/api.js`: remove `checkoutUrl` and `portalUrl`.

### 5. Landing and legal pages

- `web/index.html` becomes a plain sign-in page: the brand mark and wordmark, one line ("Your private Laterlist."), a Sign in with Google button that goes to `/app`, and a footer with Privacy and Terms links. The pricing section, the Pricing nav link and the sales sections are removed. The theme guard script and the token block stay, with tokens unchanged.
- `web/public/privacy.html`: remove the payment-status bullet. `web/public/terms.html`: remove the Pro subscription section. Everything else stays (Google sign-in and the Chrome Web Store still need these pages).

### 6. Docs

- Repo `README.md` and `AGENTS.md`: describe Laterlist as a private, single-user tool; remove billing and freemium facts; document `OWNER_EMAILS` and `LIBRARY_CAP`.

## Not touched

The Chrome Web Store listing, extension code, the old `watch-later-web.vercel.app` domain (must stay live), the sorting rulebook and rows, the picks work (its own spec).

## Deploy

Before merging, set `OWNER_EMAILS` to Joon's sign-in email on the Vercel production environment (`watch-later-web` project). Without it the production lock refuses everyone, by design.

## Testing

- Owner lock: owner allowed; non-owner gets 403 and no user row is created; a non-owner's token is refused; production with no owners refuses everyone; dev with no owners is open; `OWNER_EMAILS` overrides `ADMIN_EMAILS`.
- Importer stores up to `libraryCap` regardless of plan columns; summaries never 402; `/api/me` no longer has the removed fields.
- Web: Settings has no Plan block; video detail has no upgrade card; the board has no upgrade band; the private screen renders on 403.
- `npm test` green, with tests updated only where they asserted the removed pricing behavior.

## Done means

1. `npm test` green; `grep -rniE "polar|upgrade to pro|betaPro|BETA_PRO|checkout|summaryQuota" server web/src` finds nothing.
2. Dev (`DEV_FAKE_AUTH=1 FAKE_LLM=1 npm start`): the landing page is the plain sign-in; the app has no pricing anywhere; imports and TL;DRs work with no limits.
3. Production after deploy: Joon signs in and sees his board; the landing page shows no pricing.
