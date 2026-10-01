# Fast lane onboarding — design

Status: APPROVED by Joon 2026-09-30 (approach A of three: fast lane / guided wizard / try-before-install).

## Goal

A brand-new user reaches their first sorted video as fast as possible, with no
screen that makes them stop and wonder what to do. Success metric: time from
clicking "Start Sorting" on the landing page to the first card on the board.

## Today (audited 2026-09-30, Chromium + extension path)

1. Landing "Start Sorting" → `/app`
2. Sign-in card (extra screen) → Google
3. Taste quiz (blocking screen before any value)
4. Import page → "Add to Chrome" opens the store in a new tab
5. Back on the tab: the page does not notice the install (`detect()` runs once per mount) → dead end until reload
6. "Connect" button, then a separate "Sync your Watch Later" button
7. Sort runs; the board stays empty until the whole job completes (board refresh only on completion; board API returns `status = 'scanned'` only; Jev chunks are 100 videos)
8. Board

## Design (five changes)

### 1. One click to sign in
Landing CTAs ("Start Sorting", "Sign in", "Start free") link to `/app?signin=1`.
In real-auth mode, when the app loads unauthenticated with `signin=1`, it strips
the param and calls `signInWithGoogle()` immediately. Dev-auth mode is
unchanged (the dev email form still shows). Visiting `/app` without the param
still shows the sign-in card.

### 2. The page notices the extension
While the extension is not present, re-run `extensionClient.detect()` when the
tab becomes visible again (`visibilitychange` → visible, and `focus`). A fresh
install can take a moment to answer, so a miss retries up to 3 times, 1.5 s
apart. When found, the existing status/port setup runs exactly as on mount.

### 3. Connect and sync happen together (first run only)
When all hold: the user has zero videos, the extension is present, it is not
connected, there is no account mismatch, no job is active, and this has not
been attempted yet in this page session → call `connectExtension()` and, if it
succeeds, `syncExtension()`. One attempt per page session; on failure the
existing Connect button remains as the fallback. A mismatch (extension tied to
another account) never auto-connects; the Reconnect button stays.

### 4. The quiz moves into the wait
New users no longer see the blocking quiz screen. The first-run setup screen
(below) shows the interest chips under the checklist as "While you wait: what
do you use YouTube for? (optional)". Each toggle saves via `api.saveTaste`
(debounced ~600 ms). No Save button, no free-text note on this screen (the note
stays available through Settings → retake quiz). Classification reads taste
per chunk (`promptOptsFor` runs every chunk), so answers given mid-sort still
shape the rest of the sort.

### 5. The board fills live
- Worker: the first chunk of a job (`processed === 0`) is capped at the
  classifier's concurrency (16 for Jev; Haiku keeps its own chunk size), so the
  first videos land within one round of requests. Later chunks keep the normal
  size.
- Web: while a job is active, each poll whose `processed` count has increased
  also reloads the board, so rows fill as chunks commit.
- Once the first sorted videos exist, the app leaves the setup screen and shows
  the board with the existing progress band on top.

## First-run setup screen

Shown instead of the board whenever the user has zero sorted videos (all five
rows empty), whether or not an import or sort is in progress. Replaces today's
empty-hero and the quiz gate. If the last job failed, the failure message shows
on this screen under the checklist.

Title: "Let's get your Watch Later". A three-step checklist, each step
done / active / waiting:
1. Add the Chrome extension (button: Add to Chrome → store)
2. Connected to {email} (auto; fallback Connect button if auto failed)
3. Fetching your list… {count} videos (live from extension progress) → then "Sorting…"

Below: the optional interest chips (change 4).

Non-Chromium browsers: the extension steps are replaced by today's
paste-it-yourself import (unchanged), with the chips still below.

## Unchanged

Paste-it-yourself import flow and copy, billing and plan caps, Settings (retake
quiz stays there), the Import page for returning users, extension protocol,
Jev/Haiku classification logic and rules.

## Testing

- Worker: a job's first chunk is capped at the classifier's concurrency; the
  second chunk uses the full chunk size (PGlite worker test).
- Pure helper for the auto-connect condition (`shouldAutoConnect`) with a table
  test covering every guard.
- Setup screen: static render tests for each checklist state and for the
  non-Chromium variant.
- Manual: fresh dev user walk-through in the browser pane, timing landing →
  first card, with screenshots of each state.

## Out of scope

Showing unsorted imported videos before they are classified (needs a board API
change); a resurfacing loop; non-Chromium import improvements.
