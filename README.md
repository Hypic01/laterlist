# Laterlist (hosted)

The multi-user, freemium version of [watch-later-librarian](../watch-later-librarian):
connect your own YouTube Watch Later → AI sorts your backlog into five rows →
you clean it up. First 100 videos free; Pro subscription sorts up to 10,000.

The original localhost app stays untouched as Joon's personal daily driver.
This repo is the public product. Design spec: `docs/superpowers/specs/`.

## Run locally (zero accounts)

    npm install
    DEV_FAKE_AUTH=1 FAKE_LLM=1 npm start     # http://localhost:4400

Dev mode uses an embedded PGlite database (`./dev-pgdata`), fake sign-in
(any email), and a deterministic fake classifier. The whole product flow works
end to end without Supabase, Anthropic, or Stripe credentials.

    npm test                                  # vitest — DB tests run on PGlite (real Postgres in WASM)

## Publishing the extension

Uses [Chrome Web Store API v2](https://developer.chrome.com/docs/webstore/using-api)
to update Laterlist item `iggeklmapgdaknfdblkhefnfaflbojeg` and submit it for
review. Bump `extension/manifest.json`'s version before each upload.

One-time setup: create a Google Cloud project, enable the Chrome Web Store API,
and configure its OAuth consent screen. For the OAuth Playground, Google's
current guide requires a **Web application** OAuth client with authorized redirect
URI `https://developers.google.com/oauthplayground` (a Desktop app client is for
a local installed-app authorization flow, not this Playground setup). In the
[OAuth Playground](https://developers.google.com/oauthplayground), enable "Use
your own OAuth credentials", enter that client's ID and secret, authorize scope
`https://www.googleapis.com/auth/chromewebstore` using the account that owns the
listing, then exchange the authorization code for a refresh token. Find the
publisher ID under Publisher > Settings in the Chrome Web Store developer dashboard.

Put `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`, and
`CWS_PUBLISHER_ID` in your local, ignored `.env`; never commit credentials.
The script reads the environment only. Export those values into your shell
before running:

```sh
set -a
. ./.env
set +a
npm run publish:extension
# Build and validate without any network requests:
node scripts/publish-extension.js --dry-run
```

Missing variables stop the publisher before any network request. Upload failures
stop submission; asynchronous uploads are polled until success or a bounded
timeout. The existing extension builder produces the store zip. Direct script
invocations also build it, so the npm command rebuilds it before publishing.

## Architecture

- `server/` — Express API + in-process classification worker.
  `index.js` is the composition root; everything is factory-injected.
  - `db.js` over `pg.Pool` (Supabase) or PGlite (tests/dev) via one `query()` interface
  - `auth.js` verifies Supabase JWTs (JWKS or legacy HS256), JIT-provisions users
  - `jev.js` — default sorting engine: Jev (TypeSafe) via OpenRouter's decisions
    API, one metadata-only request per video in a parallel pool, no batching needed
  - `classify.js` + `anthropic.js` — the shared sorting rules, plus the Haiku
    fallback (`CLASSIFIER=haiku`): structured outputs, Batches API over 500 videos
  - `worker.js` — claims jobs (`FOR UPDATE SKIP LOCKED`), chunked processing,
    crash re-adoption, budget kill switch
  - `background.js` — on Vercel, sorting runs after the response (`waitUntil`)
    and hands off to a fresh invocation via `/api/cron/advance`, so a sort keeps
    going with the tab closed. Needs `CRON_SECRET` and `APP_URL` (the production
    domain) set; polls only restart a job whose run died
  - `billing.js` — Stripe Checkout + Portal + signature-verified webhooks
- `collector/` — the browser-side Watch Later collector (scroll + Polymer `.data`
  harvest + DOM pruning; validated on a real 2,796-video playlist at 100% of
  available items). Served fresh at `GET /collector.js` for the console snippet;
  bundled into the future MV3 extension (Chrome forbids remote code).
- `web/` — Vite multi-page: marketing landing at `/`, React app at `/app`.

## Production status

Live at **https://watch-later-web.vercel.app** (Vercel project `watch-later-web`,
Supabase project `fjykuzbwhrpzpiqxzjeh`, schema applied). Three env steps remain
before strangers can fully use it — each is copy-paste:

1. **Database password** (unblocks the whole API): Supabase dashboard →
   project `watch-later-web` → Settings → Database → Reset database password. Then:

       printf 'postgresql://postgres.fjykuzbwhrpzpiqxzjeh:<PASSWORD>@aws-0-us-west-1.pooler.supabase.com:6543/postgres' \
         | vercel env add DATABASE_URL production
       vercel deploy --prod --yes

2. **Google sign-in**: Google Cloud Console → APIs & Services → Credentials →
   Create OAuth client ID (Web application) with redirect URI
   `https://fjykuzbwhrpzpiqxzjeh.supabase.co/auth/v1/callback`. Paste the client
   ID + secret into Supabase → Authentication → Providers → Google. In Supabase →
   Authentication → URL Configuration set Site URL `https://watch-later-web.vercel.app`
   and add `https://watch-later-web.vercel.app/app` as a redirect URL.

3. **Sorting engine**: create a key at openrouter.ai (add credits), then:

       printf 'sk-or-v1-...' | vercel env add OPENROUTER_API_KEY production
       vercel deploy --prod --yes

   `ANTHROPIC_API_KEY` stays for summaries, and sorting falls back to Haiku
   if the OpenRouter key is missing. `CLASSIFIER=haiku` forces the fallback.

Optional while testing: `BETA_ALLOWLIST` (comma-separated emails) gates imports.
Stripe env (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`)
turns on the upgrade flow whenever pricing is ready — keep test mode first.
Note: Vercel's Hobby plan is for non-commercial use; move the project to Pro
(or a paid team) when payments go live.

## Production setup (one-time)

1. **Supabase**: create a project → Auth → enable Google provider (needs a GCP
   OAuth client with redirect `https://<project>.supabase.co/auth/v1/callback`).
   Grab the URL, anon key, and the pooled `DATABASE_URL`.
2. **Anthropic**: create an API key at console.anthropic.com.
3. **Stripe**: create a Product ("Pro") with a monthly Price; add a webhook
   endpoint `https://<domain>/api/billing/webhook` subscribed to
   `checkout.session.completed`, `customer.subscription.updated`,
   `customer.subscription.deleted`. Keep TEST mode until launch.
4. **Railway**: new project from this repo; set every env var from
   `.env.example` (including `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`,
   which bake into the frontend at build time). `railway.json` handles
   build/migrate/start.

## Cost model

Jev, metadata-only, one request per video: ≈ $0.04 per 1,000 videos (measured
2026-09-30). Free tier ≈ $0.04/user; a maxed 10,000-video Pro subscriber ≈ $0.40
once. (Haiku fallback: ≈ $0.40–0.77 per 1,000, half that via Batches.) `BUDGET_USD`
kill switch caps total spend; admins get `/api/admin/stats`.
