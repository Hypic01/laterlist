# Laterlist on the phone: design

Status: approved by Joon 2026-10-05. The visual source is the vault page
`1. Projects/Laterlist/Mobile Design.html`, which has 5 screen mockups drawn with
real dev-account videos plus the Mobbin study.

## 1. Goal

Laterlist works well on a phone. You open it from the iPhone Home Screen like
an app, the same way the Personal Agent dashboard works. On the phone you can do
two jobs:

1. **Browse** your rows and pick something to watch.
2. **Clean up** by swiping through the pile one video at a time.

Done when:
- At widths of 640px or less, the app renders the phone layout (Board, Clean up,
  row list, video sheet, Done). Above 640px, nothing changes on the desktop app or
  the landing page, and the existing tests pass untouched.
- Add to Home Screen opens it full screen, with the Laterlist icon and correct safe areas.
- Joon signs in from the Home Screen app on his real iPhone.
- Every swipe action also has a tap button, and every remove can be undone.

## 2. Non-goals

- A native or Expo app, or an App Store listing.
- A service worker, offline mode, or push notifications. iOS doesn't need a
  service worker to run a site full screen.
- Import on the phone. The Chrome extension can't run there.
- A "start over" button that brings kept videos back into Clean up. This is out
  of scope until someone asks for it.
- Any redesign of the desktop.

## 3. Decisions (approved)

| # | Decision |
|---|---|
| 1 | Same site and URL. The phone layout applies at widths of 640px or less. Desktop and landing are unchanged. |
| 2 | Add to Home Screen opens full screen: manifest, icons, `apple-mobile-web-app-*` meta, `viewport-fit=cover`, safe-area insets. |
| 3 | Bottom tabs: **Board**, **Clean up** (badge = videos left to review), **Settings**. Search sits top right on Board and on each row. |
| 4 | In Clean up, swipe left = **Remove** (the existing "not interested" / dismiss path) and swipe right = **Keep**. "Watched it" lives in the tap sheet. The order is oldest saved first, with all rows mixed. |
| 5 | Keep is remembered on the server (`videos.kept_at`). Kept videos don't come back in Clean up. This is the only server change. |
| 6 | Tapping a video opens a bottom sheet with Open in YouTube (primary), Play here, TL;DR, Move to, Watched it (remove), and Not interested (remove). |
| 7 | shadcn: use only its Drawer pattern, via `vaul` (the library shadcn's Drawer wraps), styled with our tokens. **No Tailwind**: its preflight reset would shift the desktop styles. |
| 8 | Dark is the default and light works. The tokens are the existing ones from `web/src/styles.css`, and color still only means category. |

## 4. Constraints found while exploring

- **No extension on the phone.** `removesFromYoutube` on the client is false on
  phones. The server still queues YouTube removals: `enqueueYoutubeRemovals`
  checks the user's preference and a live import token, not the client. The
  desktop extension drains the queue the next time Laterlist opens on the
  computer. All phone copy says exactly that:
  "Removed videos leave your YouTube Watch Later the next time Laterlist is open on your computer."
  When the user has the preference off, the copy says nothing about YouTube.
- **Import is desktop-only.** On the phone, the topbar Import button,
  `SetupScreen` and `ImportPanel` are replaced by a note: "New videos come in when Laterlist syncs on your computer."
  A first-run user with an empty library sees that note plus a short line on
  how to start on a computer.
- **Google sign-in inside a Home Screen app is a known weak spot on iOS.** The
  OAuth redirect (`signInWithOAuth`, redirect to `/app`) can finish in an in-app
  browser sheet instead of the standalone app, so the session never reaches the
  app. Phase 0 tests this before any build. The fallback (only if Phase 0 fails)
  is an email one-time code: Supabase `signInWithOtp` plus `verifyOtp`, typed
  inside the app. That fallback needs Joon to turn on the Email provider in
  Supabase, which he does by hand.
- **There is no undo endpoint today.** Undo is built on the client (see §7), so
  the server needs no restore route.
- **The main checkout has another session's uncommitted `App.jsx` edits.** Work
  happens in the `feat/mobile-web` worktree off `origin/main`. Phone code lives in
  new files, and `App.jsx` only gets a small branch point to keep merge conflicts small.

## 5. Architecture

### Where the phone layout plugs in

- `web/src/phone/useIsPhone.js` is a `matchMedia("(max-width: 640px)")` hook that
  updates on resize and rotation.
- `App.jsx` keeps owning all state and handlers: `me`, `board`, `move`,
  `dismiss`, `done`, `openDetail`, `showToast`, `reload`, theme, and history nav.
  When `isPhone` is true and the user is past the auth gate, `App.jsx` renders
  `<PhoneApp …/>` instead of the desktop header and main area, passing the same
  data and handlers as props. The desktop branch is left untouched.
- History: phone screens reuse the existing `pushNav` / `popstate` entries, so
  the iOS back swipe works in standalone mode. Values: `view` = board | cleanup |
  settings | a row key, plus a `sheet` entry for the open video.

### New files (all under `web/src/phone/`)

| File | Job |
|---|---|
| `PhoneApp.jsx` | Shell: safe-area padding, the screen switch, the bottom tab bar, the undo toast. |
| `PhoneBoard.jsx` | Hero card (videos left + total watch time + "Start clean up"), and the five rows as a grouped list with icon tile, total time and count. A row with no videos shows its existing `empty` line and can't be tapped. |
| `PhoneRow.jsx` | Row list: title, count and time, duration chips (the existing `DURATIONS`), sort, search, a "Clean up this row" entry, video rows with a thumbnail on the left and a swipe to reveal **Move** and **Remove**. |
| `SwipeRow.jsx` | Swipe-to-reveal for one list row: pointer events, a horizontal-intent lock so vertical scroll still works, and snap open or closed. |
| `CleanupDeck.jsx` | Card stack: progress ("13 of 61"), the drag card with a REMOVE / KEEP stamp, the Remove / Watch / Keep buttons, "Wrong row? Move it", the empty state, and the Done screen. |
| `VideoSheet.jsx` | `vaul` Drawer holding the actions in decision 6. Move to opens a nested list of the 5 rows inside the same drawer. |
| `PhoneSettings.jsx` | Wraps the existing `Settings` component with phone spacing. It hides the extension-connect controls and shows the "sync on your computer" note. |
| `deck.js` | Pure logic: `buildDeck(board, { row })` returns scanned videos where `kept_at` is null, oldest saved first. Also `pendingQueue` for undo (§7). Unit tested. |
| `phone.css` | Phone styles, imported from `main.jsx` and scoped under `.phone-app` so the desktop can't be affected. It uses only existing tokens. |

### Data

- `/api/board` already returns every scanned video, grouped by category. The
  phone needs no new read endpoint. `LIST_COLUMNS` adds `kept_at`.
- Total watch time per row is the sum of `duration_seconds`, computed on the client.
- **Deck order:** "oldest saved first" depends on which end of the Watch Later
  holds the oldest saves. The assumption is that the highest `playlist_position`
  is the oldest (YouTube puts new saves at the top). The plan's first task checks
  this against Joon's real Watch Later. The order is one comparator in `deck.js`,
  so flipping it is a one-line change.

### Server change (the only one)

- Migration `009-kept`: `ALTER TABLE videos ADD COLUMN IF NOT EXISTS kept_at timestamptz;`
- `db.keep(userId, videoId)` sets `kept_at = now()` where `status = 'scanned'` and
  returns a boolean.
- `POST /api/videos/:id/keep` returns `{ ok: true }`, or 404 for an unknown video.
- `api.keepVideo(id)` is added in `web/src/api.js`.
- Moving a video (`setCategory`) from the deck also calls keep. Choosing a row
  counts as reviewing the video.
- Prod note: Vercel has no auto-migrate, so 009 is applied to Supabase by hand
  before the merge. This is the same flow as 008.

## 6. Screens

All screens follow the mockups in `Mobile Design.html`.

1. **Board.** The brand mark and wordmark sit top left, with search top right.
   The hero card shows "Waiting in Watch Later", the count (Fjalla One, large),
   the total time (mono), a fan of 3 real thumbnails, and a full-width "Start
   clean up" button. "Your rows" is a grouped list. The floating tab bar sits at
   the bottom inside the safe area.
2. **Clean up.** X closes it. The page shows "N of M" in mono and a 3px
   progress bar. The front card shows the thumbnail, a category pill with a dot,
   the title, channel and duration, and a TL;DR button. Dragging shows a stamp:
   REMOVE in coral on a left drag, KEEP in the foreground color on a right drag.
   Under the card are three buttons: Remove (coral outline), Watch (opens the
   sheet), Keep (filled). Below them is "Wrong row? Move it". The undo toast
   appears under the progress bar.
3. **Row list.** The back button says "Board". The page shows the title with the
   category dot, a "count · time" subline, duration chips, a "Clean up this row"
   bar (a deck filtered to this row), and the video rows.
4. **Video sheet.** A drag handle, then the thumbnail, title and meta. Next
   comes Open in YouTube as the primary button
   (`https://www.youtube.com/watch?v=ID`, which iOS hands to the YouTube app).
   Play here and TL;DR sit side by side. Below that: Move to (showing the current
   row), Watched it (remove), and Not interested (remove, in coral), then the
   YouTube footnote. Play here and TL;DR reuse the existing `VideoDetail` pieces
   as far as practical. If reuse is awkward, Play here embeds the same
   youtube-nocookie iframe the desktop uses.
5. **Done.** A check ring, "You let go of N videos", and "That's X hours you no
   longer owe anyone." when the removed time is at least 1 hour (otherwise just
   the count). Then 3 stat tiles (Removed / Kept / Moved), the YouTube footnote
   when it applies, and "Back to board".
6. **Sign-in.** The existing `AuthGate` stays as is. It is checked at 390px
   and only gets spacing fixes if it needs them.
7. **Empty and other states.** The deck when everything has been reviewed: "Nothing
   left to sort. New videos show up here after your computer syncs." Board while
   loading: skeleton rows, not a spinner. An API error keeps the card in place
   and shows a toast with Retry. A row with zero videos shows its existing empty
   line.

## 7. Interactions

- **Swipe (deck).** Pointer events on the card. The card follows the finger with
  a rotation of up to 12°. It commits once the drag passes 35% of the card width
  or the flick is faster than 0.5 px/ms; otherwise it springs back. Animations
  use transform and opacity only. With `prefers-reduced-motion`, the card swaps
  with no fly-off.
- **Swipe (row).** The row reveals two actions 76px wide. A long swipe left past
  60% fires Remove directly. A vertical scroll never triggers it.
- **Buttons always work.** Every gesture has a button, so swiping is never the
  only path, and the buttons have accessible labels.
- **Undo (client-side deferred commit).** A remove, keep or move goes into
  `pendingQueue` and leaves the UI right away. The API call fires 5s later. The
  undo toast shows the most recent pending action, and Undo cancels it before it
  is sent. On `visibilitychange` (hidden) or `pagehide`, every pending action is
  flushed with `fetch(..., { keepalive: true })`. Because nothing reaches the
  server until it commits, an undone remove never queues a YouTube removal.
- **Done vs dismiss.** "Watched it" calls `markDone`. Remove and "Not interested"
  call `dismissVideo`. The server-side YouTube queue is unchanged.

## 8. Home Screen install

- `web/app/index.html` gets:
  - `<link rel="manifest" href="manifest.webmanifest">`
  - `apple-touch-icon` (180px)
  - `apple-mobile-web-app-capable=yes` and `mobile-web-app-capable=yes`
  - `apple-mobile-web-app-status-bar-style=black-translucent`
  - `apple-mobile-web-app-title=Laterlist`
  - `viewport-fit=cover` in the viewport meta
- `web/public/app/manifest.webmanifest`:
  - `name` "Laterlist", `short_name` "Laterlist"
  - `start_url` "./" and `scope` "./". Relative values keep both production
    origins working.
  - `display` "standalone"
  - `background_color` and `theme_color` `#191919`
  - icons at 192 and 512, plus a 512 maskable icon
- Icons are generated from the existing brand SVG (the same glyph as the favicon)
  into `web/public/app/icons/`.
- Safe areas: the phone shell pads with `env(safe-area-inset-*)`. The tab bar
  sits at `bottom: calc(env(safe-area-inset-bottom) + 12px)`. Body
  `overscroll-behavior-y: none` stops the standalone app from rubber-banding the
  whole shell.

## 9. Testing

- **Unit (vitest).**
  - `deck.js`: ordering, the kept filter, the row filter, and the undo queue
    (enqueue, cancel, timer commit, flush). Fake timers run in-process.
- **Server (vitest + PGlite).**
  - Migration 009 applies on top of 008.
  - `keep` sets `kept_at` only on scanned videos and only for the owner.
  - `POST /api/videos/:id/keep` returns 404 for another user's video.
  - `/api/board` includes `kept_at`.
- **Markup (renderToStaticMarkup).**
  - `PhoneBoard` renders the counts and total times.
  - The empty row is not a link.
  - `VideoSheet` shows the YouTube footnote only when removal is on.
- **Real browser (Claude, every phase).** Check at 390×844 and at 1440×900:
  - no sideways scroll and no console errors
  - the desktop matches the pre-change screenshots
  - swipes and undo work with mouse drag in the browser pane
- **Joon's real iPhone.** Install, sign in, run a clean-up session, and check
  that removals leave YouTube after the next desktop open.
- The existing suite (`npm test`) stays green, with no existing test edited to
  pass.

## 10. Phases

0. **Sign-in check (Joon, about 1 minute, no code).** On the iPhone, open
   laterlist-app.vercel.app/app in Safari, then Share, Add to Home Screen, with
   "Open as Web App" on. Open it from the Home Screen and sign in with Google.
   If it lands signed in, there's no fallback work. If not, add the email-code
   fallback to Phase 1.
1. **Install basics + shell + Board + row list + sheet.** Covers manifest, icons,
   meta, safe areas, `useIsPhone`, `PhoneApp` and its tabs, Board, Row,
   SwipeRow, VideoSheet (vaul), PhoneSettings, and the import note.
2. **Clean up.** Covers migration 009, the keep endpoint and `api.keepVideo`,
   `deck.js`, `CleanupDeck`, undo, and the Done screen.
3. **Polish and ship.** A `kole-jain` pass, a light-mode check, a reduced-motion
   check, then `/codex review`, the PR, applying migration 009 on prod, merge, and
   Joon's iPhone check.

## 11. Who builds what

The global Claude × Codex split and AGENTS.md apply:

- **Codex:** migration 009, `db.keep`, the keep route, `api.keepVideo`, and their
  server tests, handed off as a `.plans/` contract. Codex can also write the
  `deck.js` unit tests from the spec.
- **Claude:** all phone UI (design taste, gestures, motion), the install basics,
  the browser verification, and the final review.

## 12. Open checks

- The Watch Later order direction (§5 Data). Settle it in the first plan task.
- Whether `vaul` works with React 18.3 and the existing Vite build without extra
  config. Check it in the first Phase 1 task. If not, fall back to a hand-built
  sheet with the same behavior.
