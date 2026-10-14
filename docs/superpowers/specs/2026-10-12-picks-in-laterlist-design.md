# Picks inside Laterlist: the This week home

**Date:** 2026-10-12
**Status:** design approved in chat by Joon; this written spec awaits his review
**Owner:** Joon
**Builds on:** `2026-10-11-weekly-watch-picks-design.md` (the Monday Mac run stays the brain). This spec replaces only how the picks are delivered: inside Laterlist instead of a page on the Mac.

## 3-second line

Laterlist opens on the 3 videos in your Watch Later most worth your time this week, and says why.

## Why

Joon, 2026-10-12: the curated picks are "the reason why I created this product in the first place", so they "should definitely be inside the laterlist". The 2026-10-11 build delivered them as a page on the Mac because the design question asked where the picking should run, not where Joon would see the picks. This spec fixes that.

## Decisions (Joon, 2026-10-12)

| Question | Answer |
|---|---|
| Who uses Laterlist | Only Joon. Handled in its own spec (pricing removal and sign-in lock). |
| Where the picking happens | The Monday Mac run (vault, transcripts, Claude subscription), unchanged. It sends the picks into Laterlist. |
| Where picks show | Picks become home: Laterlist opens on a This week screen. The 5 rows move to a Library tab. |
| Verdicts | Buttons on each pick card: Worth it, Not for me, Didn't watch. Saved in Laterlist and read by the next Monday run. |

## How it works

```
Monday 08:00, Joon's Mac
  1. The watch-picks run picks 3 (same steps 1 to 5 as the 2026-10-11 spec)
  2. CLI post        -> POST /api/picks with the private picks key
  3. open Laterlist  -> https://laterlist-app.vercel.app/app opens on This week
  4. Joon taps verdicts in Laterlist -> next Monday the run reads them via GET /api/picks/history
Fallback: if the POST fails, the CLI writes the local HTML page as today and opens that instead.
```

## Data

New migration, additive only:

- `pick_sets`: `user_id uuid` (references users, cascade delete), `week date` (that week's Monday), `payload jsonb` (the validated picks.json: focus, focusPoints, notice, picks, closeButNo), `created_at`, `updated_at`. Primary key `(user_id, week)`. Posting the same week again replaces the payload (latest run wins).
- `pick_verdicts`: `user_id uuid`, `week date`, `video_id text`, `verdict text` (`worth`, `not`, `skipped`), `decided_at timestamptz`. Primary key `(user_id, week, video_id)`. Changing a verdict overwrites it.
- Both tables get `ENABLE ROW LEVEL SECURITY` like every other table. The app connects as the owner role, so no policies are needed.

## Validation

One validator, in `server/picks.js` (`validatePicks`), moved there from `scripts/watch-picks/render.mjs`, which then imports it. Same rules as today: week `YYYY-MM-DD`, focus required, at most 3 picks, 11-character ids, start and end in seconds with end after start, text trimmed and capped. The server adds one rule: every pick and close-but-no id must be a video in Joon's library, otherwise 400 naming the first unknown id.

## API

| Route | Auth | Does |
|---|---|---|
| `POST /api/picks` | `auth.jwtOrToken("picks")` | Validates and upserts this week's set. Returns `{ week, picks: n }`. |
| `GET /api/picks/current` | signed in | Latest set by week, with each pick's video joined (title, channel, duration, category, status) and that week's verdicts. `{ set: null }` when none exist. |
| `POST /api/picks/:week/verdict` | signed in | Body `{ videoId, verdict }`. Upserts the verdict. `worth` and `not` also mark the video done exactly like `POST /api/videos/done` (including the YouTube removal queue when removal is allowed). `skipped` changes nothing else. |
| `GET /api/picks/history?weeks=8` | `auth.jwtOrToken("picks")` | Past picks with verdicts, newest first: `[{ week, id, title, verdict }]`. The Mac run uses it to skip recent picks and to learn from verdicts. |

`POST /api/tokens` accepts a new scope `picks`.

## The private key

Settings' existing Connected apps block gets a Create picks key button: it shows a `picks` token once with a copy button (the same reveal the bridge token uses), and the key is listed and revocable like other connected apps. Joon adds it to `~/.config/watch-picks/.env.picks` as `PICKS_API_TOKEN` with a terminal command that reads it without echoing (same pattern as the database password). An optional `PICKS_APP_URL` overrides `https://laterlist-app.vercel.app`.

## Mac side changes

- `scripts/watch-picks.mjs post <picks.json>`: validates, POSTs to `/api/picks` with header `X-Import-Token`. On success it writes the vault `.md` note (archive) and prints `open: <app url>`. On any failure it renders the local HTML page and `.md` exactly as today and prints `open: <html path>` plus one line saying why posting failed. Exit 0 in both cases, 2 for invalid picks.json.
- `past` and the 8-week exclusion in `list` read `GET /api/picks/history`. If the API is unreachable they fall back to parsing the vault notes, as today.
- The vault note's verdict line becomes `Verdict: tap it in Laterlist`.
- The skill's step 6 becomes: run `CLI post WORK/picks.json`, then `open` the path or URL on the `open:` line. Nothing else in the skill changes. The allowlist stays the single `node .../watch-picks.mjs` entry.

## The This week screen

- **Navigation:** two tabs in the top bar, This week and Library. Laterlist opens on This week; the brand mark goes to This week. Library is today's board, unchanged (rows, filters, category pages, Clean up).
- **Content, top to bottom:** eyebrow `Week of Oct 12`; the focus line (display font); focus points (up to 5, small); the notice when present; 3 pick cards; `Close, but no (n)`, collapsed by default.
- **Pick card:** thumbnail (`hqdefault`, which always exists), category dot and row label, position, title linking to YouTube at the best-part start (new tab), channel and length, "Why you, now", the best-part chip (same link), 2 or 3 things you'll get, then the 3 verdict buttons. The chosen verdict stays highlighted; tapping another one changes it.
- **Close, but no:** title and one-line reason per row; a title opens that video's detail page when it is in the library.
- **States:**
  - Loading: skeleton cards.
  - Never had picks: "Your first picks arrive Monday at 8 AM." plus one line on how they get made.
  - Latest set older than this week's Monday: show it under "These are last week's picks. Is your Mac awake Monday at 8?"
  - Load error: one line and a Retry button.
  - Library empty (first run): This week still loads; the empty state points to the Library tab to import.
- **Phone (640px and below):** the phone layout keeps its bottom tab bar: This week becomes the first tab (and the default), Board is renamed Library. Cards in one column, tap targets at least 44px.
- **Design rules:** tokens from `docs/design-system.md` only (monochrome; color only on category dots). App UI skills per CLAUDE.md: `ui-ux-pro-max` plus `shadcn` where it fits, `kole-jain` polish before calling it done. Copy has no dashes.

## Errors

| Case | Behavior |
|---|---|
| POST with an unknown video id | 400 naming the id; the CLI falls back to the local page and says why. |
| POST with a revoked or wrong-scope key | 401; same fallback. |
| Laterlist unreachable on Monday | Same fallback; the next run posts normally. |
| Verdict for a video no longer in the library | Verdict saved; marking done is a no-op. |
| Two runs in one week | Latest payload wins; verdicts already given for videos still in the set stay. |

## Out of scope

Pricing removal and the sign-in lock (own spec), recommending videos Joon never saved, picking inside the server, push notifications, any change to the 5 rows or the sorting rulebook.

## Testing

- Server (vitest, PGlite): POST validation including unknown ids; `picks` scope accepted, `imports` scope rejected; same-week upsert replaces; current returns latest week with videos and verdicts; verdict `worth` and `not` mark done and enqueue removal only when allowed; `skipped` does not; history shape and ordering; RLS enabled on both tables.
- Web (vitest, existing component test style): This week renders loading, never, stale, error and normal states; verdict click calls the API and updates the card; tabs switch between This week and Library; brand goes to This week.
- CLI: `post` success writes the md note and prints the app URL; failure falls back to the HTML page; `past` uses the API and falls back to vault notes.

## Done means

1. `npm test` green.
2. In dev (`DEV_FAKE_AUTH=1 FAKE_LLM=1 npm start`): posting a sample picks.json with a dev `picks` key makes `/app` open on This week with 3 cards; verdict buttons persist after reload; Worth it moves the video out of the Library rows; no console errors; the screen fits 375 px without sideways scroll.
3. In production, after Joon adds the key: a manual run of the `watch-picks` task posts the picks and opens Laterlist on This week.
4. The next `CLI past` returns the verdicts Joon tapped.

## Open before the build

1. After deploy, Joon creates the picks key in Settings and saves it with the terminal command the plan gives.
