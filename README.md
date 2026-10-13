# Laterlist

Joon's private, single-user tool: connect his YouTube Watch Later, let AI sort
the backlog into five rows, then clean it up.

The original localhost app stays untouched as Joon's personal daily driver.
Design spec: `docs/superpowers/specs/`.

## Run locally (zero accounts)

    npm install
    DEV_FAKE_AUTH=1 FAKE_LLM=1 npm start     # http://localhost:4400

Dev mode uses an embedded PGlite database (`./dev-pgdata`), fake sign-in
(any email), and a deterministic fake classifier. The whole product flow works
end to end without Supabase or Anthropic credentials.

    npm test                                  # vitest — DB tests run on PGlite (real Postgres in WASM)

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
- `collector/` — the browser-side Watch Later collector (scroll + Polymer `.data`
  harvest + DOM pruning; validated on a real 2,796-video playlist at 100% of
  available items). Served fresh at `GET /collector.js` for the console snippet;
  bundled into the future MV3 extension (Chrome forbids remote code).
- `web/` — Vite multi-page: sign-in landing at `/`, React app at `/app`.

## Production status

Live at **https://watch-later-web.vercel.app** (Vercel project `watch-later-web`,
Supabase project `fjykuzbwhrpzpiqxzjeh`, schema applied). The private deployment
requires owner access and the existing service credentials:

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

Set `OWNER_EMAILS` to Joon's sign-in email (comma-separated if needed). It falls
back to `ADMIN_EMAILS` when unset. If both are empty in production, every sign-in
is refused. `LIBRARY_CAP` is the safety limit for stored videos, default 25,000.

## Production setup (one-time)

1. **Supabase**: create a project → Auth → enable Google provider (needs a GCP
   OAuth client with redirect `https://<project>.supabase.co/auth/v1/callback`).
   Grab the URL, anon key, and the pooled `DATABASE_URL`.
2. **Anthropic**: create an API key at console.anthropic.com.
3. **Railway**: new project from this repo; set every env var from
   `.env.example` (including `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`,
   which bake into the frontend at build time). `railway.json` handles
   build/migrate/start.

## Cost model

Jev, metadata-only, one request per video: ≈ $0.04 per 1,000 videos (measured
2026-09-30). (Haiku fallback: ≈ $0.40–0.77 per 1,000, half that via Batches.) `BUDGET_USD`
kill switch caps total spend; admins get `/api/admin/stats`.
