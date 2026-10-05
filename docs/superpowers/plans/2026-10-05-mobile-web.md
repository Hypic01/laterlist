# Laterlist on the Phone: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At phone width the Laterlist web app renders its own phone layout, and it installs to the iPhone Home Screen as a full-screen app. The phone layout has the Board, row lists, a video sheet, a swipe Clean up deck and a Done screen. The desktop stays unchanged.

**Architecture:**
- `App.jsx` keeps loading data, then hands it to a new `PhoneApp` whenever `useIsPhone()` matches. All phone code lives in `web/src/phone/`.
- Phone actions (remove, keep, move) go through a module-level pending queue. The queue commits to the API after 5 s, so an action can be undone.
- An optimistic overlay hides or marks the video until a fresh board confirms the change.
- The only server change is a `videos.kept_at` column with a `POST /api/videos/:id/keep` route.

**Tech Stack:** React 18 + Vite 5 (plain CSS with the existing tokens, no Tailwind), `vaul` for the bottom sheet, Express + Postgres (PGlite in tests), vitest with `renderToStaticMarkup` for markup tests.

**Spec:** `docs/superpowers/specs/2026-10-05-mobile-web-design.md`. The mockups are in Joon's vault: `~/Obsidian/Joon/1. Projects/Laterlist/Mobile Design.html`.

## Global Constraints

- The phone layout applies when `(max-width: 640px), (pointer: coarse) and (max-height: 500px)` matches. Above that, the desktop and the landing page must render exactly as before.
- Work happens in the worktree `/Users/joonwoopark/projects/laterlist/.claude/worktrees/mobile-web` on branch `feat/mobile-web`. Never edit the main checkout: it holds another session's uncommitted `App.jsx` edits.
- No Tailwind and no new design tokens. Use only the existing tokens from `web/src/styles.css` (`--background`, `--foreground`, `--card`, `--popover`, `--secondary`, `--muted`, `--faint`, `--border`, `--border-strong`, `--primary`, `--primary-foreground`, `--destructive`, `--cat-*`, `--font-display`, `--font-body`, `--font-mono`, `--space-*`, `--radius-*`, `--shadow-raised`, `--speed`, `--ease`). Colour only means category. The one exception is dark text on the coral Remove button, which is written as `#191919` with a comment.
- Every phone CSS class starts with `ph-`, so nothing can leak into the desktop.
- Copy rules: no em or en dashes in new copy, and use the neutral tool voice.
  - The phone YouTube line is exactly: `Removed videos leave your YouTube Watch Later the next time Laterlist is open on your computer.`
  - The sync line is exactly: `New videos come in when Laterlist syncs on your computer.`
- Manifest: `start_url` is `/app/` and `scope` is `/`. The scope must be `/`, because Google sign-in returns to `/app` with no trailing slash.
- Undo: actions commit after `COMMIT_DELAY_MS = 5000`, and the queue flushes with `keepalive` on `visibilitychange` (hidden), on `pagehide`, and when PhoneApp unmounts.
- `npm test` stays green, and no existing test may be edited to make it pass. Run every command from the worktree root.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Status | Job |
|---|---|---|
| `web/public/app/manifest.webmanifest` | new | Home Screen manifest |
| `web/public/app/icons/icon.svg` + `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | new | App icons, generated from the brand glyph |
| `web/app/index.html` | edit | Manifest link and iOS standalone meta tags |
| `web/src/styles.css` | edit | One global rule: body top padding for the safe area |
| `server/migrations.js`, `server/db.js`, `server/app.js` | edit | `kept_at` column, `db.keep`, the keep route (Codex) |
| `web/src/rows.js` | new | `ROWS` and `DURATIONS`, moved out of `App.jsx` so the phone can share them |
| `web/src/components/icons.jsx` | edit | Adds `CardsIcon`, `MoveIcon`, `SlidersIcon` |
| `web/src/components/VideoDetail.jsx` | edit | Optional `youtubeNote` prop (the desktop passes nothing) |
| `web/src/phone/copy.js` | new | The two exact phone sentences |
| `web/src/phone/deck.js` | new | Pure logic: deck, overlay, totals, swipe decision, session stats |
| `web/src/phone/pendingQueue.js` | new | The undo queue and its API requests |
| `web/src/phone/useIsPhone.js` | new | The media-query hook |
| `web/src/phone/PhoneBoard.jsx`, `PhoneSetupNote.jsx` | new | Board screen, and the first-run note |
| `web/src/phone/SwipeRow.jsx`, `PhoneRow.jsx` | new | Row list with swipe to reveal |
| `web/src/phone/VideoSheet.jsx` | new | The vaul bottom sheet (`SheetBody` is exported for tests) |
| `web/src/phone/CleanupDeck.jsx` | new | The swipe deck and the Done screen |
| `web/src/phone/PhoneSettings.jsx` | new | The desktop Settings component with phone props |
| `web/src/phone/PhoneApp.jsx` | new | Shell: screen stack, history, tabs, toast, overlay, queue wiring |
| `web/src/phone/phone.css` | new | Every phone style |
| `web/src/App.jsx`, `web/src/main.jsx` | edit | The `isPhone` branch and the CSS import |
| `tests/app-shell.test.js`, `tests/phone-*.test.js` | new | Tests |
| `tests/routes.test.js`, `tests/video-detail.test.js` | edit | Add cases (no existing case changes) |

Order: Task 1 ships alone, because it is the sign-in gate. Codex can build Task 2 in parallel with Tasks 3 to 8. Task 9 needs Tasks 2 to 8. Task 10 ships.

---

### Task 1: Home Screen install basics (ships alone, then the sign-in gate)

**Files:**
- Create: `web/public/app/manifest.webmanifest`, `web/public/app/icons/icon.svg`, `web/public/app/icons/icon-512.png`, `web/public/app/icons/icon-192.png`, `web/public/app/icons/apple-touch-icon.png`
- Modify: `web/app/index.html:4-9`, `web/src/styles.css` (after the `body { … }` block at line 136)
- Test: `tests/app-shell.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `/app/manifest.webmanifest` and `/app/icons/*` served from `web/dist` (Vite copies `web/public`), plus a global `body { padding-top: env(safe-area-inset-top, 0px) }`. Later tasks assume the body already pads the top safe area. Phone CSS pads only the bottom and the sides.

- [ ] **Step 1: Install dependencies in the worktree**

Run: `npm install`
Expected: it finishes without errors and `node_modules/` exists in the worktree.

- [ ] **Step 2: Write the failing test** `tests/app-shell.test.js`

```js
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync("web/app/index.html", "utf8");
const manifest = JSON.parse(readFileSync("web/public/app/manifest.webmanifest", "utf8"));

describe("Home Screen install", () => {
  it("links the manifest and the iOS standalone tags", () => {
    expect(html).toContain('<link rel="manifest" href="/app/manifest.webmanifest" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/app/icons/apple-touch-icon.png" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Laterlist" />');
    expect(html).toContain("viewport-fit=cover");
  });

  it("scopes the app to the whole origin so the Google return stays inside it", () => {
    expect(manifest.scope).toBe("/");
    expect(manifest.start_url).toBe("/app/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBe("#191919");
  });

  it("ships every icon the manifest and the page point to", () => {
    for (const icon of manifest.icons) {
      expect(existsSync(`web/public${icon.src}`), icon.src).toBe(true);
    }
    expect(existsSync("web/public/app/icons/apple-touch-icon.png")).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/app-shell.test.js`
Expected: FAIL with `ENOENT … manifest.webmanifest`.

- [ ] **Step 4: Write the manifest** `web/public/app/manifest.webmanifest`

```json
{
  "name": "Laterlist",
  "short_name": "Laterlist",
  "description": "Clean up your YouTube Watch Later.",
  "id": "/app/",
  "start_url": "/app/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#191919",
  "theme_color": "#191919",
  "icons": [
    { "src": "/app/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/app/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/app/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 5: Write the icon source** `web/public/app/icons/icon.svg`. This is the favicon glyph, full bleed and centered inside the maskable safe zone.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#191919"/>
  <g transform="translate(112 112) scale(12)" fill="none" stroke="#D9D9D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 6h10M4 12h10M4 18h6"/>
    <path d="M15 15l3 3 4-5"/>
  </g>
</svg>
```

- [ ] **Step 6: Render the PNGs** (macOS Quick Look, the same tool that made the extension icons)

```bash
cd web/public/app/icons
qlmanage -t -s 512 -o . icon.svg >/dev/null 2>&1
mv icon.svg.png icon-512.png
sips -z 192 192 icon-512.png --out icon-192.png >/dev/null
sips -z 180 180 icon-512.png --out apple-touch-icon.png >/dev/null
sips -g pixelWidth -g pixelHeight icon-512.png icon-192.png apple-touch-icon.png
cd -
```
Expected: the widths and heights are 512, 192 and 180. Open `icon-512.png` with the Read tool and confirm it shows a light list-with-check glyph on a full dark square, with no white border.

- [ ] **Step 7: Add the tags.** In `web/app/index.html`, replace the viewport line, then add the new tags right after the theme-color line.

Replace:
```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
```
with:
```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```
After `<meta name="theme-color" content="#191919" />` insert:
```html
    <!-- Home Screen app: full screen on iPhone, same scope on both domains. -->
    <link rel="manifest" href="/app/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/app/icons/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Laterlist" />
```

- [ ] **Step 8: Pad the top safe area.** In `web/src/styles.css`, right after the `body { … }` block (it ends at line 143), add:

```css
/* Home Screen app on iPhone: the status bar is translucent, so keep content
   out from under the clock and the notch. env() is 0 everywhere else. */
body { padding-top: env(safe-area-inset-top, 0px); }
```

- [ ] **Step 9: Run the tests and the build**

Run: `npx vitest run tests/app-shell.test.js && npm test && npm run build:web && ls web/dist/app/manifest.webmanifest web/dist/app/icons`
Expected: every test PASSES, the build succeeds, and the manifest and icons exist in `web/dist/app/`.

- [ ] **Step 10: Commit**

```bash
git add web/public/app web/app/index.html web/src/styles.css tests/app-shell.test.js
git commit -m "feat(web): installable Home Screen app (manifest, icons, iOS meta)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 11: Ship gate (needs Joon)**
  1. Push the branch: `git push -u origin feat/mobile-web`.
  2. Open the PR with `gh pr create --title "Home Screen install basics + phone spec" --body …`. The body says that only the manifest, icons and meta change, that desktop rendering is unchanged, and that it ends with the 🤖 line.
  3. Ask Joon "ship it?". Merge only after he says yes, with a merge commit (`gh pr merge --merge`), matching the repo history.
  4. After Vercel deploys, check that `curl -s https://laterlist-app.vercel.app/app/manifest.webmanifest` returns the JSON.
  5. **Real gate:** Joon deletes the old Home Screen icon, adds the site again from Safari, opens it from the Home Screen and signs in with Google.
     - If he lands signed in, inside the app, continue.
     - If not, STOP. Add an email-code sign-in task (Supabase `signInWithOtp` + `verifyOtp`) before Task 9, and ask Joon to enable the Email provider in Supabase.
  6. Then run `git fetch origin && git merge origin/main` on the branch so later PRs are clean.

---

### Task 2: Server `kept_at` + keep route (Codex)

Hand this task to Codex with the `codex:codex-rescue` agent, using GPT-6 Sol at medium reasoning. Codex works in its own worktree on branch `feat/mobile-keep`, cut from `feat/mobile-web`. The contract is in `.plans/mobile-keep.md`, which copies this task. Claude reviews the diff, then merges `feat/mobile-keep` into `feat/mobile-web`.

**Files:**
- Modify: `server/migrations.js` (append to `MIGRATIONS`, after `008-youtube-removals`)
- Modify: `server/db.js:9-10` (`LIST_COLUMNS`) and add `keep` after `dismiss` (around line 379)
- Modify: `server/app.js` (new route after the `/api/videos/:id/dismiss` route, around line 418)
- Test: `tests/routes.test.js` (one entry in the auth-coverage list, and two cases in `describe("board & actions")`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `POST /api/videos/:id/keep` returns `{ ok: true }`, or 404 `{ error: "unknown video" }`.
  - Every `/api/board` video now has `kept_at` (an ISO string or `null`).
  - `db.keep(userId, videoId): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests.** In `tests/routes.test.js`, add `["post", "/api/videos/x/keep"],` to the list in `"every /api route except health 401s without a token"`, right after `["post", "/api/videos/x/dismiss"],`. Inside `describe("board & actions", …)`, after the `"user B cannot mutate user A's videos"` case, add:

```js
  it("keep marks a scanned video kept, only for its owner", async () => {
    const id = vids(1)[0].id;
    await asUser(request(app).post(`/api/videos/${id}/keep`), "b@test.dev").expect(404);
    await asUser(request(app).post(`/api/videos/${id}/keep`)).expect(200, { ok: true });
    const res = await asUser(request(app).get("/api/board")).expect(200);
    expect(res.body.learn.find((v) => v.id === id).kept_at).toBeTruthy();
    expect(res.body.learn.find((v) => v.id !== id).kept_at).toBeNull();
  });

  it("keep 404s for a video that is not on the board", async () => {
    const unsorted = vids(3)[2].id; // imported, never sorted
    await asUser(request(app).post(`/api/videos/${unsorted}/keep`)).expect(404);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/routes.test.js`
Expected: FAIL. The keep route returns 404 for the owner, and `kept_at` is undefined.

- [ ] **Step 3: Add the migration.** In `server/migrations.js`, append this as the last element of `MIGRATIONS`:

```js
  {
    id: "009-kept",
    sql: `
      ALTER TABLE videos ADD COLUMN IF NOT EXISTS kept_at timestamptz;
    `,
  },
```

- [ ] **Step 4: Expose the column, and add `db.keep`.** In `server/db.js`, change `LIST_COLUMNS` to:

```js
const LIST_COLUMNS =
  "video_id AS id, title, channel, duration_seconds, playlist_position, published_text, category, reasoning, confidence, topics, status, manual_override, override_from, kept_at";
```
Then add this right after `async dismiss(userId, videoId) { … },`:

```js
    // Swiping right in the phone's Clean up: the video stays on the board but
    // stops coming back in Clean up.
    async keep(userId, videoId) {
      const { rows } = await q.query(
        `UPDATE videos SET kept_at = now()
         WHERE user_id = $1 AND video_id = $2 AND status = 'scanned'
         RETURNING video_id`,
        [userId, videoId]
      );
      return rows.length > 0;
    },
```

- [ ] **Step 5: Add the route.** In `server/app.js`, right after the `app.post("/api/videos/:id/dismiss", …)` handler, add:

```js
  app.post("/api/videos/:id/keep", auth.required, async (req, res) => {
    const ok = await db.keep(req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: "unknown video" });
    res.json({ ok: true });
  });
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/routes.test.js && npm test`
Expected: PASS, with the full suite green.

- [ ] **Step 7: Commit**

```bash
git add server/migrations.js server/db.js server/app.js tests/routes.test.js
git commit -m "feat(server): remember kept videos (kept_at + POST /api/videos/:id/keep)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Prod SQL for later (no prod write now).** Write `migration-009-prod.txt` in the worktree root. It is untracked and never committed. Joon pastes it into the Supabase SQL editor in Task 10.

```sql
ALTER TABLE videos ADD COLUMN IF NOT EXISTS kept_at timestamptz;
INSERT INTO schema_migrations (id) VALUES ('009-kept') ON CONFLICT DO NOTHING;
```

---

### Task 3: Shared rows + phone logic (`rows.js`, `deck.js`, `copy.js`)

**Files:**
- Create: `web/src/rows.js`, `web/src/phone/deck.js`, `web/src/phone/copy.js`
- Modify: `web/src/App.jsx:25-48` (import `ROWS` and `DURATIONS` instead of defining them)
- Test: `tests/phone-deck.test.js`

**Interfaces:**
- Consumes: `SORTS` from `web/src/lib.js` (`SORTS["added-old"].fn` orders by highest `playlist_position` first, which is the desktop's "Added: oldest").
- Produces:
  - `rows.js`: `ROWS: Array<{ key, label, tint, icon, empty }>`, `DURATIONS: Array<{ key, label, test(seconds) }>`
  - `deck.js`:
    - `ROW_KEYS: string[]`
    - `buildDeck(board, { row = null } = {}): Video[]`
    - `applyOverlay(board, overlay): Board`
    - `pruneOverlay(board, overlay): Overlay`
    - `findVideo(board, id): Video | null`
    - `totalSeconds(videos): number`
    - `formatTotal(seconds): string`
    - `swipeOutcome(dx, velocity, width): "remove" | "keep" | null`
    - `sessionStats(log, undone): { reviewed, removed, kept, moved, removedSeconds }`
  - `copy.js`: `REMOVAL_NOTE`, `SYNC_NOTE`
  - Overlay entry shapes: `{ hide: true }` | `{ kept: true }` | `{ category: string, kept: boolean }`. A log entry is `{ key: number, kind: "dismiss" | "done" | "keep" | "move", video }`.

- [ ] **Step 1: Write the failing test** `tests/phone-deck.test.js`

```js
import { describe, expect, it } from "vitest";
import { ROWS, DURATIONS } from "../web/src/rows.js";
import { CATEGORIES } from "../web/src/components/VideoCard.jsx";
import {
  applyOverlay, buildDeck, findVideo, formatTotal, pruneOverlay, sessionStats, swipeOutcome, totalSeconds,
} from "../web/src/phone/deck.js";
import { REMOVAL_NOTE, SYNC_NOTE } from "../web/src/phone/copy.js";

const v = (id, category, position, extra = {}) => ({
  id, category, playlist_position: position, duration_seconds: 600,
  title: `Title ${id}`, channel: "Channel", kept_at: null, ...extra,
});
const board = () => ({
  learn: [v("a", "learn", 1), v("b", "learn", 9)],
  watch: [v("c", "watch", 5, { kept_at: "2026-10-05T00:00:00Z" })],
  music: [v("d", "music", 7)],
  entertainment: [],
  outdated: [],
});

describe("rows", () => {
  it("matches the desktop categories and length buckets", () => {
    expect(ROWS.map((r) => r.key)).toEqual(CATEGORIES.map((c) => c.key));
    expect(DURATIONS.map((d) => d.key)).toEqual(["xs", "md", "lg", "xl"]);
  });
});

describe("buildDeck", () => {
  it("mixes every row, oldest saved first, and skips kept videos", () => {
    expect(buildDeck(board()).map((x) => x.id)).toEqual(["b", "d", "a"]);
  });
  it("can stay inside one row", () => {
    expect(buildDeck(board(), { row: "learn" }).map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("overlay", () => {
  it("hides removed videos, marks kept ones, and moves rows", () => {
    const out = applyOverlay(board(), { a: { hide: true }, b: { kept: true }, d: { category: "watch", kept: false } });
    expect(out.learn.map((x) => x.id)).toEqual(["b"]);
    expect(out.learn[0].kept_at).toBe("pending");
    expect(out.watch.map((x) => x.id)).toEqual(["c", "d"]);
    expect(out.watch[1].category).toBe("watch");
    expect(out.music).toEqual([]);
    expect(buildDeck(out).map((x) => x.id)).toEqual(["d"]);
  });

  it("keeps an entry until the server's board reflects it", () => {
    const overlay = { a: { hide: true }, b: { kept: true }, d: { category: "watch", kept: false } };
    expect(pruneOverlay(board(), overlay)).toEqual(overlay);
    const fresh = {
      learn: [v("b", "learn", 9, { kept_at: "2026-10-05T01:00:00Z" })],
      watch: [v("c", "watch", 5), v("d", "watch", 7)],
      music: [], entertainment: [], outdated: [],
    };
    expect(pruneOverlay(fresh, overlay)).toEqual({});
  });

  it("finds a video in any row", () => {
    expect(findVideo(board(), "d").title).toBe("Title d");
    expect(findVideo(board(), "zzz")).toBeNull();
  });
});

describe("totals", () => {
  it("adds durations and prints hours and minutes", () => {
    expect(totalSeconds([v("a", "learn", 1), v("b", "learn", 2, { duration_seconds: null })])).toBe(600);
    expect(formatTotal(62058)).toBe("17 h 14 m");
    expect(formatTotal(2460)).toBe("41 m");
    expect(formatTotal(0)).toBe("0 m");
  });
});

describe("swipeOutcome", () => {
  it("commits past 35% of the card or on a fast flick", () => {
    expect(swipeOutcome(-130, 0, 340)).toBe("remove");
    expect(swipeOutcome(130, 0, 340)).toBe("keep");
    expect(swipeOutcome(-60, -0.8, 340)).toBe("remove");
    expect(swipeOutcome(60, 0.8, 340)).toBe("keep");
    expect(swipeOutcome(-60, -0.1, 340)).toBeNull();
    expect(swipeOutcome(10, 2, 340)).toBeNull();
  });
});

describe("sessionStats", () => {
  it("counts what the session did, minus undone actions", () => {
    const log = [
      { key: 1, kind: "dismiss", video: v("a", "learn", 1, { duration_seconds: 3600 }) },
      { key: 2, kind: "keep", video: v("b", "learn", 2) },
      { key: 3, kind: "move", video: v("c", "watch", 3) },
      { key: 4, kind: "done", video: v("d", "music", 4, { duration_seconds: 1800 }) },
    ];
    expect(sessionStats(log, new Set([4]))).toEqual({ reviewed: 3, removed: 1, kept: 1, moved: 1, removedSeconds: 3600 });
  });
});

describe("copy", () => {
  it("says exactly when YouTube catches up", () => {
    expect(REMOVAL_NOTE).toBe("Removed videos leave your YouTube Watch Later the next time Laterlist is open on your computer.");
    expect(SYNC_NOTE).toBe("New videos come in when Laterlist syncs on your computer.");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/phone-deck.test.js`
Expected: FAIL with `Failed to load url ../web/src/rows.js`.

- [ ] **Step 3: Create** `web/src/rows.js`. Move the two constants verbatim from `App.jsx:30-48`.

```js
// The five rows and the length buckets, shared by the desktop board and the
// phone layout.
import { LearnIcon, EyeIcon, MusicIcon, GamepadIcon, ArchiveIcon } from "./components/icons.jsx";

export const ROWS = [
  { key: "learn", label: "Worth learning from", tint: "var(--cat-learn)", icon: LearnIcon,
    empty: "No lessons pending." },
  { key: "watch", label: "Worth watching", tint: "var(--cat-watch)", icon: EyeIcon,
    empty: "Your eyes are off the hook." },
  { key: "music", label: "Music", tint: "var(--cat-music)", icon: MusicIcon,
    empty: "All quiet in here." },
  { key: "entertainment", label: "Just for fun", tint: "var(--cat-entertainment)", icon: GamepadIcon,
    empty: "No fun pending." },
  { key: "outdated", label: "Outdated", tint: "var(--cat-outdated)", icon: ArchiveIcon,
    empty: "Nothing has aged out yet." },
];

export const DURATIONS = [
  { key: "xs", label: "< 5 min", test: (d) => d != null && d < 300 },
  { key: "md", label: "5–20 min", test: (d) => d != null && d >= 300 && d < 1200 },
  { key: "lg", label: "20–60 min", test: (d) => d != null && d >= 1200 && d < 3600 },
  { key: "xl", label: "1 hr +", test: (d) => d != null && d >= 3600 },
];
```

- [ ] **Step 4: Point `App.jsx` at it.** Delete the `const ROWS = [ … ];` and `const DURATIONS = [ … ];` blocks (lines 30-48). Add `import { ROWS, DURATIONS } from "./rows.js";` after the `lib.js` import on line 3. In the icons import (lines 25-28), remove `LearnIcon, EyeIcon, MusicIcon, GamepadIcon, ArchiveIcon,` only if nothing else in `App.jsx` uses them. Check that first with `grep -n "LearnIcon\|EyeIcon\|MusicIcon\|GamepadIcon\|ArchiveIcon" web/src/App.jsx`: after the edit, the only remaining hits should be in that import line.

- [ ] **Step 5: Create** `web/src/phone/copy.js`

```js
// The two sentences the phone uses wherever it talks about YouTube or syncing.
export const REMOVAL_NOTE =
  "Removed videos leave your YouTube Watch Later the next time Laterlist is open on your computer.";
export const SYNC_NOTE = "New videos come in when Laterlist syncs on your computer.";
```

- [ ] **Step 6: Create** `web/src/phone/deck.js`

```js
// Pure logic for the phone layout: what Clean up shows, how optimistic
// actions overlay the board, and the small numbers the screens print.
import { SORTS } from "../lib.js";
import { ROWS } from "../rows.js";

export const ROW_KEYS = ROWS.map((r) => r.key);

// Every sorted video still to review, oldest saved first. That is the desktop's
// "Added: oldest" sort. Kept videos never come back.
export function buildDeck(board, { row = null } = {}) {
  const keys = row ? [row] : ROW_KEYS;
  return keys
    .flatMap((k) => board?.[k] ?? [])
    .filter((v) => !v.kept_at)
    .sort(SORTS["added-old"].fn);
}

// The phone shows an action before the server confirms it. An overlay entry
// says what the user did:
//   { hide: true }                 removed (not interested or watched)
//   { kept: true }                 swiped right
//   { category, kept }             moved (kept too when moved from Clean up)
export function applyOverlay(board, overlay) {
  const out = Object.fromEntries(ROW_KEYS.map((k) => [k, []]));
  for (const k of ROW_KEYS) {
    for (const v of board?.[k] ?? []) {
      const o = overlay[v.id];
      if (!o) { out[k].push(v); continue; }
      if (o.hide) continue;
      const category = o.category && out[o.category] ? o.category : k;
      out[category].push({ ...v, category, kept_at: o.kept ? (v.kept_at ?? "pending") : v.kept_at });
    }
  }
  return out;
}

// An entry stays until a fresh board reflects it, so a reload that started
// before the action landed can't bring the card back.
export function pruneOverlay(board, overlay) {
  const found = new Map();
  for (const k of ROW_KEYS) for (const v of board?.[k] ?? []) found.set(v.id, { ...v, category: k });
  const next = {};
  for (const [id, o] of Object.entries(overlay)) {
    const v = found.get(id);
    if (!v) continue; // gone from the board: confirmed
    const confirmed = !o.hide
      && (!o.kept || Boolean(v.kept_at))
      && (!o.category || v.category === o.category);
    if (!confirmed) next[id] = o;
  }
  return next;
}

export function findVideo(board, id) {
  for (const k of ROW_KEYS) {
    const hit = (board?.[k] ?? []).find((v) => v.id === id);
    if (hit) return hit;
  }
  return null;
}

export function totalSeconds(videos) {
  return videos.reduce((sum, v) => sum + (Number(v.duration_seconds) || 0), 0);
}

// "17 h 14 m", "41 m", "0 m". Whole minutes.
export function formatTotal(seconds) {
  const mins = Math.floor((Number(seconds) || 0) / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h ${m} m` : `${m} m`;
}

// A drag commits past 35% of the card, or on a flick faster than 0.5 px/ms.
// Under 24 px it is a tap that jittered, never a decision.
export function swipeOutcome(dx, velocity, width) {
  if (Math.abs(dx) < 24) return null;
  if (dx <= -width * 0.35 || velocity <= -0.5) return "remove";
  if (dx >= width * 0.35 || velocity >= 0.5) return "keep";
  return null;
}

export function sessionStats(log, undone) {
  const live = log.filter((e) => !undone.has(e.key));
  const removed = live.filter((e) => e.kind === "dismiss" || e.kind === "done");
  return {
    reviewed: live.length,
    removed: removed.length,
    kept: live.filter((e) => e.kind === "keep").length,
    moved: live.filter((e) => e.kind === "move").length,
    removedSeconds: totalSeconds(removed.map((e) => e.video)),
  };
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/phone-deck.test.js && npm test`
Expected: PASS, with the full suite green (the desktop still renders from `rows.js`).

- [ ] **Step 8: Commit**

```bash
git add web/src/rows.js web/src/phone/deck.js web/src/phone/copy.js web/src/App.jsx tests/phone-deck.test.js
git commit -m "feat(phone): shared rows + deck, overlay and stats logic

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The undo queue (`pendingQueue.js`)

**Files:**
- Create: `web/src/phone/pendingQueue.js`
- Test: `tests/phone-queue.test.js`

**Interfaces:**
- Consumes: `getToken()` from `web/src/auth.js`, and `POST /api/videos/:id/keep` from Task 2 (by URL only, there is no `api.js` helper).
- Produces:
  - `COMMIT_DELAY_MS = 5000`
  - `requestsFor(action): Array<{ url, body? }>`
  - `postRequest(request, token, { keepalive })`
  - `createPendingQueue({ send, getToken, delay })`
  - `pendingQueue`, a singleton with:
    - `enqueue(action): number`, the key
    - `undo(key): action | null`
    - `has(key): boolean`
    - `flush({ keepalive }): Promise`
    - `subscribe(fn): () => void`
  - An action is `{ kind: "dismiss" | "done" | "keep" | "move", id, category?, keep? }`.
  - Events are `{ type: "change" }` and `{ type: "settled", key, action, ok, error? }`.

- [ ] **Step 1: Write the failing test** `tests/phone-queue.test.js`

```js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMIT_DELAY_MS, createPendingQueue, requestsFor } from "../web/src/phone/pendingQueue.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(overrides = {}) {
  const sent = [];
  const events = [];
  const queue = createPendingQueue({
    send: async (request, token, opts) => { sent.push({ ...request, token, keepalive: Boolean(opts?.keepalive) }); },
    getToken: async () => "tok-1",
    ...overrides,
  });
  queue.subscribe((event) => events.push(event));
  return { queue, sent, events };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
afterEach(() => { vi.useRealTimers(); });

describe("requestsFor", () => {
  it("maps each phone action to its API calls", () => {
    expect(requestsFor({ kind: "dismiss", id: "abc" })).toEqual([{ url: "/api/videos/abc/dismiss" }]);
    expect(requestsFor({ kind: "done", id: "abc" })).toEqual([{ url: "/api/videos/done", body: { ids: ["abc"] } }]);
    expect(requestsFor({ kind: "keep", id: "abc" })).toEqual([{ url: "/api/videos/abc/keep" }]);
    expect(requestsFor({ kind: "move", id: "abc", category: "music", keep: true })).toEqual([
      { url: "/api/videos/abc/category", body: { category: "music" } },
      { url: "/api/videos/abc/keep" },
    ]);
    expect(requestsFor({ kind: "move", id: "abc", category: "music", keep: false })).toHaveLength(1);
  });
});

describe("pendingQueue", () => {
  it("sends nothing until the delay passes, then sends with the captured token", async () => {
    const { queue, sent, events } = setup();
    queue.enqueue({ kind: "dismiss", id: "abc" });
    await tick();
    vi.advanceTimersByTime(COMMIT_DELAY_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    await tick();
    expect(sent).toEqual([{ url: "/api/videos/abc/dismiss", token: "tok-1", keepalive: false }]);
    expect(events.at(-1)).toMatchObject({ type: "settled", ok: true, action: { id: "abc" } });
  });

  it("undo cancels the call and hands back the action", async () => {
    const { queue, sent } = setup();
    const key = queue.enqueue({ kind: "keep", id: "abc" });
    expect(queue.has(key)).toBe(true);
    expect(queue.undo(key)).toEqual({ kind: "keep", id: "abc" });
    expect(queue.has(key)).toBe(false);
    vi.advanceTimersByTime(COMMIT_DELAY_MS);
    await tick();
    expect(sent).toEqual([]);
    expect(queue.undo(key)).toBeNull();
  });

  it("flush sends everything at once with keepalive", async () => {
    const { queue, sent } = setup();
    queue.enqueue({ kind: "dismiss", id: "a" });
    queue.enqueue({ kind: "done", id: "b" });
    await tick();
    await queue.flush({ keepalive: true });
    expect(sent.map((r) => [r.url, r.keepalive, r.token])).toEqual([
      ["/api/videos/a/dismiss", true, "tok-1"],
      ["/api/videos/done", true, "tok-1"],
    ]);
  });

  it("reports a failed send so the phone can put the card back", async () => {
    const { queue, events } = setup({ send: async () => { throw new Error("offline"); } });
    queue.enqueue({ kind: "dismiss", id: "abc" });
    await tick();
    await queue.flush();
    expect(events.at(-1)).toMatchObject({ type: "settled", ok: false, action: { id: "abc" } });
  });

  it("rejects an unknown action right away", () => {
    const { queue } = setup();
    expect(() => queue.enqueue({ kind: "explode", id: "abc" })).toThrow("unknown action explode");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/phone-queue.test.js`
Expected: FAIL with `Failed to load url ../web/src/phone/pendingQueue.js`.

- [ ] **Step 3: Create** `web/src/phone/pendingQueue.js`

```js
// Phone actions wait a few seconds before they reach the server, so Undo can
// cancel them and an undone remove never queues a YouTube removal. There is
// one module-level queue: it has to outlive PhoneApp (rotating the phone can
// unmount it), and it flushes when the page goes away.
import { getToken as defaultGetToken } from "../auth.js";

export const COMMIT_DELAY_MS = 5000;

const videoPath = (id) => `/api/videos/${encodeURIComponent(id)}`;

export function requestsFor(action) {
  switch (action.kind) {
    case "dismiss": return [{ url: `${videoPath(action.id)}/dismiss` }];
    case "done": return [{ url: "/api/videos/done", body: { ids: [action.id] } }];
    case "keep": return [{ url: `${videoPath(action.id)}/keep` }];
    case "move": return [
      { url: `${videoPath(action.id)}/category`, body: { category: action.category } },
      ...(action.keep ? [{ url: `${videoPath(action.id)}/keep` }] : []),
    ];
    default: throw new Error(`unknown action ${action.kind}`);
  }
}

export async function postRequest({ url, body }, token, { keepalive = false } = {}) {
  const res = await fetch(url, {
    method: "POST",
    keepalive,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // 404 means the video already left the board (say, removed on the computer).
  if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
}

export function createPendingQueue({ send = postRequest, getToken = defaultGetToken, delay = COMMIT_DELAY_MS } = {}) {
  const items = new Map(); // key -> { action, token, tokenPromise, timer }
  const listeners = new Set();
  let nextKey = 1;
  const emit = (event) => listeners.forEach((fn) => fn(event));

  const commit = (key, { keepalive = false } = {}) => {
    const item = items.get(key);
    if (!item) return Promise.resolve();
    clearTimeout(item.timer);
    items.delete(key);
    emit({ type: "change" });
    const run = (token) => Promise.all(requestsFor(item.action).map((r) => send(r, token, { keepalive })));
    // A keepalive flush can't wait for an async token; send what we have.
    const sent = keepalive || item.token !== undefined ? run(item.token) : item.tokenPromise.then(run);
    return sent.then(
      () => emit({ type: "settled", key, action: item.action, ok: true }),
      (error) => emit({ type: "settled", key, action: item.action, ok: false, error }),
    );
  };

  return {
    enqueue(action) {
      requestsFor(action); // an unknown kind throws now, not 5 s later
      const key = nextKey++;
      const item = { action, token: undefined };
      item.tokenPromise = Promise.resolve()
        .then(() => getToken())
        .then((t) => { item.token = t ?? null; return item.token; }, () => { item.token = null; return null; });
      item.timer = setTimeout(() => { void commit(key); }, delay);
      items.set(key, item);
      emit({ type: "change" });
      return key;
    },
    undo(key) {
      const item = items.get(key);
      if (!item) return null;
      clearTimeout(item.timer);
      items.delete(key);
      emit({ type: "change" });
      return item.action;
    },
    has(key) {
      return items.has(key);
    },
    flush({ keepalive = false } = {}) {
      return Promise.all([...items.keys()].map((key) => commit(key, { keepalive })));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

export const pendingQueue = createPendingQueue();
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/phone-queue.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/phone/pendingQueue.js tests/phone-queue.test.js
git commit -m "feat(phone): undo queue that commits after 5 s and flushes on leave

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Board screen + first-run note (+ phone.css base)

**Files:**
- Create: `web/src/phone/PhoneBoard.jsx`, `web/src/phone/PhoneSetupNote.jsx`, `web/src/phone/phone.css`
- Modify: `web/src/components/icons.jsx` (append `CardsIcon`)
- Test: `tests/phone-board.test.js`

**Interfaces:**
- Consumes: `ROWS` (Task 3), `SORTS` (`lib.js`), `totalSeconds` and `formatTotal` (Task 3), `SYNC_NOTE` (Task 3).
- Produces:
  - `<PhoneBoard board deckCount job onOpenRow(rowKey) onStartCleanup() onSearch() />`
  - `<PhoneSetupNote host />`
  - `CardsIcon`
  - Shared classes in `phone.css` that later tasks reuse: `ph-bar`, `ph-iconbtn`, `ph-btn`, `ph-btn--primary`, `ph-btn--ghost`, `ph-note`, `ph-dot`, `ph-tile`, `ph-empty`, `ph-sr`, `ph-label`.

- [ ] **Step 1: Write the failing test** `tests/phone-board.test.js`

```js
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PhoneBoard from "../web/src/phone/PhoneBoard.jsx";
import PhoneSetupNote from "../web/src/phone/PhoneSetupNote.jsx";

const v = (id, seconds, position) => ({
  id, title: `Title ${id}`, channel: "Channel", duration_seconds: seconds, playlist_position: position, kept_at: null,
});
const board = { learn: [v("a", 600, 1), v("b", 1200, 2)], watch: [v("c", 3600, 3)], music: [], entertainment: [], outdated: [] };
const noop = () => {};
const render = (props = {}) => renderToStaticMarkup(React.createElement(PhoneBoard, {
  board, deckCount: 3, job: null, onOpenRow: noop, onStartCleanup: noop, onSearch: noop, ...props,
}));

describe("PhoneBoard", () => {
  it("shows the pile as one number with its total time", () => {
    const html = render();
    expect(html).toContain("<b>3</b>");
    expect(html).toContain("1 h 30 m of watching");
    expect(html).toContain("Start clean up");
  });

  it("lists every row, and empty rows show their line but can't be opened", () => {
    const html = render();
    expect(html).toContain("Worth learning from");
    expect(html).toContain("<small>30 m</small>");
    expect(html).toContain("All quiet in here.");
    expect(html.match(/<button class="ph-group__row"/g)).toHaveLength(2);
  });

  it("says when everything has been reviewed", () => {
    const html = render({ deckCount: 0 });
    expect(html).toContain("Everything here has been reviewed.");
    expect(html).not.toContain("Start clean up");
  });

  it("shows sorting progress while a job runs", () => {
    expect(render({ job: { state: "running", processed: 5, total: 20 } })).toContain("Sorting 5 of 20…");
  });
});

describe("PhoneSetupNote", () => {
  it("sends a new user to their computer", () => {
    const html = renderToStaticMarkup(React.createElement(PhoneSetupNote, { host: "laterlist-app.vercel.app" }));
    expect(html).toContain("Start on your computer");
    expect(html).toContain("laterlist-app.vercel.app/app");
    expect(html).toContain("New videos come in when Laterlist syncs on your computer.");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/phone-board.test.js`
Expected: FAIL with `Failed to load url ../web/src/phone/PhoneBoard.jsx`.

- [ ] **Step 3: Add `CardsIcon`** at the end of `web/src/components/icons.jsx`, before `GoogleIcon` if that comes last, matching the file's `Icon` wrapper style:

```jsx
export const CardsIcon = p => (
  <Icon {...p}>
    <rect x="5" y="3" width="14" height="18" rx="3" />
    <path d="M9 21h6" />
  </Icon>
)
```

- [ ] **Step 4: Create** `web/src/phone/PhoneBoard.jsx`

```jsx
import React from "react";
import { ROWS } from "../rows.js";
import { SORTS } from "../lib.js";
import { formatTotal, totalSeconds } from "./deck.js";
import { SYNC_NOTE } from "./copy.js";
import { BrandMark, CardsIcon, ChevronRightIcon, SearchIcon } from "../components/icons.jsx";

const ACTIVE_STATES = new Set(["queued", "running", "awaiting_batch"]);

export default function PhoneBoard({ board, deckCount, job, onOpenRow, onStartCleanup, onSearch }) {
  const all = ROWS.flatMap((r) => board[r.key] ?? []);
  const fan = [...all].sort(SORTS["added-new"].fn).slice(0, 3);
  const sorting = Boolean(job && ACTIVE_STATES.has(job.state));

  return (
    <section className="ph-board">
      <header className="ph-bar">
        <div className="ph-brand"><BrandMark size={20} /><span>Laterlist</span></div>
        <button className="ph-iconbtn" onClick={onSearch} aria-label="Search all videos"><SearchIcon size={20} /></button>
      </header>

      <div className="ph-hero">
        {fan.length ? (
          <div className="ph-hero__fan" aria-hidden="true">
            {fan.map((v) => <img key={v.id} src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" />)}
          </div>
        ) : null}
        <p className="ph-hero__label">Waiting in Watch Later</p>
        <p className="ph-hero__count"><b>{all.length.toLocaleString()}</b><span>{all.length === 1 ? "video" : "videos"}</span></p>
        <p className="ph-hero__time">{formatTotal(totalSeconds(all))} of watching</p>
        {sorting ? (
          <p className="ph-hero__job" role="status">
            Sorting {Number(job.processed || 0).toLocaleString()} of {Number(job.total || 0).toLocaleString()}…
          </p>
        ) : null}
        {deckCount > 0 ? (
          <button className="ph-btn ph-btn--primary" onClick={onStartCleanup}><CardsIcon size={20} /> Start clean up</button>
        ) : (
          <p className="ph-hero__clear">{all.length ? "Everything here has been reviewed." : SYNC_NOTE}</p>
        )}
      </div>

      <h2 className="ph-label">Your rows</h2>
      <ul className="ph-group">
        {ROWS.map((r) => {
          const list = board[r.key] ?? [];
          const Icon = r.icon;
          const body = (
            <>
              <span className="ph-tile" style={{ "--tint": r.tint }}><Icon size={20} /></span>
              <span className="ph-group__name">{r.label}<small>{list.length ? formatTotal(totalSeconds(list)) : r.empty}</small></span>
              <span className="ph-group__count">{list.length}</span>
            </>
          );
          return (
            <li key={r.key}>
              {list.length ? (
                <button className="ph-group__row" onClick={() => onOpenRow(r.key)}>
                  {body}<ChevronRightIcon size={16} className="ph-group__chev" />
                </button>
              ) : (
                <div className="ph-group__row is-empty">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 5: Create** `web/src/phone/PhoneSetupNote.jsx`

```jsx
import React from "react";
import { SYNC_NOTE } from "./copy.js";
import { BrandMark } from "../components/icons.jsx";

// A new user on a phone can't import (no extension), so point them at a computer.
export default function PhoneSetupNote({ host }) {
  return (
    <section className="ph-setup">
      <span className="ph-setup__mark"><BrandMark size={28} /></span>
      <h1>Start on your computer</h1>
      <p>Laterlist reads your Watch Later through a Chrome extension, so the first import happens on a computer. Open {host}/app in Chrome there, then come back here.</p>
      <p className="ph-note">{SYNC_NOTE}</p>
    </section>
  );
}
```

- [ ] **Step 6: Create** `web/src/phone/phone.css`, with the base and board sections. Later tasks append further sections.

```css
/* ---------- Phone layout --------------------------------------------------
   Rendered by web/src/phone/PhoneApp.jsx instead of the desktop board when
   the screen is phone sized. Every class starts with ph- so nothing here can
   touch the desktop. Existing tokens only: colour still means category.
   The top safe area is padded on <body> (styles.css). This file pads the
   bottom and the sides. */

html.is-phone, html.is-phone body { overscroll-behavior-y: none; }

.ph-app {
  min-height: 100dvh;
  padding: 0 max(var(--space-4), env(safe-area-inset-right)) var(--space-6) max(var(--space-4), env(safe-area-inset-left));
  color: var(--foreground);
  font-family: var(--font-body);
  -webkit-tap-highlight-color: transparent;
}
.ph-app.has-tabs { padding-bottom: calc(64px + var(--space-6) + env(safe-area-inset-bottom)); }
.ph-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* shared pieces */
.ph-bar { display: flex; align-items: center; justify-content: space-between; min-height: 56px; }
.ph-bar__actions { display: flex; gap: var(--space-2); }
.ph-brand { display: flex; align-items: center; gap: var(--space-2); font: 400 24px/1 var(--font-display); }
.ph-iconbtn { position: relative; width: 44px; height: 44px; display: grid; place-items: center; border: 0; border-radius: var(--radius-pill); background: var(--secondary); color: var(--foreground); }
.ph-iconbtn--ghost { background: none; }
.ph-back { display: flex; align-items: center; gap: var(--space-1); min-height: 44px; padding: 0 var(--space-2) 0 0; border: 0; background: none; color: var(--foreground); font: 500 16px var(--font-body); }
.ph-btn { display: flex; align-items: center; justify-content: center; gap: var(--space-2); width: 100%; min-height: 52px; border: 0; border-radius: var(--radius-lg); font: 600 16px var(--font-body); text-decoration: none; }
.ph-btn--primary { background: var(--primary); color: var(--primary-foreground); }
.ph-btn--ghost { min-height: 46px; background: var(--secondary); color: var(--foreground); font-size: 14px; }
.ph-label { margin: var(--space-5) var(--space-1) var(--space-2); font: 500 13px var(--font-body); color: var(--muted); }
.ph-note { font-size: 13px; line-height: 1.45; color: var(--faint); }
.ph-dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--tint, var(--faint)); }
.ph-tile { flex: none; width: 38px; height: 38px; display: grid; place-items: center; border-radius: var(--radius-lg); color: var(--tint); background: color-mix(in srgb, var(--tint) 15%, transparent); }
.ph-empty { padding: var(--space-6) var(--space-2); text-align: center; color: var(--muted); }

/* board */
.ph-hero { position: relative; overflow: hidden; padding: var(--space-5) 20px 20px; border: 1px solid var(--border); border-radius: calc(var(--radius-lg) * 2); background: var(--card); }
.ph-hero__fan { position: absolute; top: 22px; right: 14px; width: 132px; height: 90px; }
.ph-hero__fan img { position: absolute; width: 104px; aspect-ratio: 16 / 9; object-fit: cover; border: 2px solid var(--card); border-radius: var(--radius-md); box-shadow: var(--shadow-raised); }
.ph-hero__fan img:nth-child(1) { top: 2px; right: 22px; transform: rotate(-9deg); }
.ph-hero__fan img:nth-child(2) { top: 16px; right: 10px; transform: rotate(-2deg); }
.ph-hero__fan img:nth-child(3) { top: 32px; right: 0; transform: rotate(6deg); }
.ph-hero__label { font-size: 13px; color: var(--muted); }
.ph-hero__count { display: flex; align-items: baseline; gap: var(--space-2); margin-top: 2px; }
.ph-hero__count b { font: 400 60px/1 var(--font-display); }
.ph-hero__count span { font-size: 16px; color: var(--muted); }
.ph-hero__time { margin: var(--space-2) 0 20px; font: 500 13px var(--font-mono); }
.ph-hero__job { margin: -12px 0 var(--space-4); font: 500 12px var(--font-mono); color: var(--muted); }
.ph-hero__clear { font-size: 14px; color: var(--muted); }
.ph-group { margin: 0; padding: 0; overflow: hidden; list-style: none; border: 1px solid var(--border); border-radius: calc(var(--radius-lg) * 2 - 4px); background: var(--card); }
.ph-group li + li { border-top: 1px solid var(--border); }
.ph-group__row { display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: 66px; padding: 0 14px; border: 0; background: none; color: inherit; font: inherit; text-align: left; }
.ph-group__row.is-empty { opacity: .55; }
.ph-group__name { flex: 1; min-width: 0; font-size: 15px; font-weight: 500; line-height: 1.25; }
.ph-group__name small { display: block; margin-top: 3px; font: 400 12px var(--font-mono); color: var(--muted); }
.ph-group__count { font: 500 15px var(--font-mono); }
.ph-group__chev { color: var(--faint); }

/* first-run note */
.ph-setup { display: flex; flex-direction: column; align-items: center; gap: var(--space-3); padding: 96px var(--space-2) 0; text-align: center; }
.ph-setup__mark { width: 56px; height: 56px; display: grid; place-items: center; border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: var(--card); }
.ph-setup h1 { font: 400 32px/1.1 var(--font-display); }
.ph-setup p { max-width: 32ch; color: var(--muted); }
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/phone-board.test.js && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/phone/PhoneBoard.jsx web/src/phone/PhoneSetupNote.jsx web/src/phone/phone.css web/src/components/icons.jsx tests/phone-board.test.js
git commit -m "feat(phone): Board screen and first-run note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Row list with swipe to reveal

**Files:**
- Create: `web/src/phone/SwipeRow.jsx`, `web/src/phone/PhoneRow.jsx`
- Modify: `web/src/components/icons.jsx` (append `MoveIcon`, `SlidersIcon`), `web/src/phone/phone.css` (append the row and swipe sections)
- Test: `tests/phone-row.test.js`

**Interfaces:**
- Consumes: `ROWS`, `DURATIONS`, `totalSeconds`, `formatTotal` (Task 3), and `SORTS` and `formatDuration` (`lib.js`).
- Produces:
  - `<SwipeRow onMove() onRemove()>{children}</SwipeRow>`
  - `<PhoneRow rowKey|null board startSearch onBack() onOpenVideo(video) onMove(video) onRemove(video) onCleanRow(rowKey) />`
  - `MoveIcon`, `SlidersIcon`

- [ ] **Step 1: Write the failing test** `tests/phone-row.test.js`

```js
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PhoneRow from "../web/src/phone/PhoneRow.jsx";
import SwipeRow from "../web/src/phone/SwipeRow.jsx";

const v = (id, seconds, position) => ({
  id, title: `Title ${id}`, channel: `Channel ${id}`, duration_seconds: seconds, playlist_position: position, kept_at: null,
});
const board = { learn: [v("a", 600, 1), v("b", 1200, 2)], watch: [v("c", 3600, 3)], music: [], entertainment: [], outdated: [] };
const noop = () => {};
const render = (props = {}) => renderToStaticMarkup(React.createElement(PhoneRow, {
  rowKey: "learn", board, onBack: noop, onOpenVideo: noop, onMove: noop, onRemove: noop, onCleanRow: noop, ...props,
}));

describe("PhoneRow", () => {
  it("lists one row with its count, time, filters and clean-up entry", () => {
    const html = render();
    expect(html).toContain("Worth learning from");
    expect(html).toContain("2 videos · 30 m");
    expect(html).toContain("&lt; 5 min");
    expect(html).toContain("Clean up this row");
    expect(html).toContain("Title a");
    expect(html).toContain("Title b");
    expect(html).not.toContain("Title c");
    expect(html).toContain("10:00");
  });

  it("searches across every row when opened from the Board", () => {
    const html = render({ rowKey: null, startSearch: true });
    expect(html).toContain("All videos");
    expect(html).toContain('aria-label="Search videos"');
    expect(html).toContain("Title c");
    expect(html).not.toContain("Clean up this row");
  });

  it("shows the row's empty line", () => {
    expect(render({ rowKey: "music" })).toContain("All quiet in here.");
  });
});

describe("SwipeRow", () => {
  it("keeps its hidden actions out of the tab order until revealed", () => {
    const html = renderToStaticMarkup(React.createElement(SwipeRow, { onMove: noop, onRemove: noop },
      React.createElement("span", null, "child")));
    expect(html).toContain("child");
    expect(html).toContain("Move");
    expect(html).toContain("Remove");
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/phone-row.test.js`
Expected: FAIL with `Failed to load url ../web/src/phone/PhoneRow.jsx`.

- [ ] **Step 3: Add the icons** to `web/src/components/icons.jsx`, after `CardsIcon`:

```jsx
export const MoveIcon = p => (
  <Icon {...p}>
    <path d="M8 3 4 7l4 4" />
    <path d="M4 7h16" />
    <path d="m16 21 4-4-4-4" />
    <path d="M20 17H4" />
  </Icon>
)

export const SlidersIcon = p => (
  <Icon {...p}>
    <path d="M20 7h-9" />
    <path d="M14 17H5" />
    <circle cx="17" cy="17" r="3" />
    <circle cx="7" cy="7" r="3" />
  </Icon>
)
```

- [ ] **Step 4: Create** `web/src/phone/SwipeRow.jsx`

```jsx
import React, { useRef, useState } from "react";
import { MoveIcon, XIcon } from "../components/icons.jsx";

const ACTION_WIDTH = 76;
const OPEN_X = -ACTION_WIDTH * 2;

// One list row that slides left to show Move and Remove. Vertical scrolling
// stays native (touch-action: pan-y). We only take over once the finger moves
// more sideways than down. A long swipe past 60% removes straight away.
export default function SwipeRow({ children, onMove, onRemove }) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(null);
  const swallowClick = useRef(false);
  const open = x !== 0;

  const onPointerDown = (e) => {
    start.current = { x: e.clientX, y: e.clientY, base: x, axis: null };
  };
  const onPointerMove = (e) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (s.axis === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (s.axis === "x") {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDragging(true);
      }
    }
    if (s.axis === "x") setX(Math.min(0, s.base + dx));
  };
  const onPointerUp = (e) => {
    const s = start.current;
    start.current = null;
    if (!s || s.axis !== "x") return;
    swallowClick.current = true;
    setDragging(false);
    const finalX = Math.min(0, s.base + (e.clientX - s.x));
    const width = e.currentTarget.offsetWidth || 375;
    if (finalX < -width * 0.6) { setX(0); onRemove(); return; }
    setX(finalX < OPEN_X / 2 ? OPEN_X : 0);
  };
  const onPointerCancel = () => {
    start.current = null;
    setDragging(false);
    setX(0);
  };
  // A drag must not also count as a tap, and a tap on an open row closes it.
  const onClickCapture = (e) => {
    if (swallowClick.current || open) {
      e.preventDefault();
      e.stopPropagation();
      if (!swallowClick.current) setX(0);
    }
    swallowClick.current = false;
  };

  return (
    <div className="ph-swipe">
      <div className="ph-swipe__actions" aria-hidden={!open}>
        <button className="ph-swipe__move" tabIndex={open ? 0 : -1} onClick={() => { setX(0); onMove(); }}>
          <MoveIcon size={18} />Move
        </button>
        <button className="ph-swipe__remove" tabIndex={open ? 0 : -1} onClick={() => { setX(0); onRemove(); }}>
          <XIcon size={18} />Remove
        </button>
      </div>
      <div className={`ph-swipe__front${dragging ? " is-dragging" : ""}`} style={{ transform: `translateX(${x}px)` }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel} onClickCapture={onClickCapture}>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create** `web/src/phone/PhoneRow.jsx`

```jsx
import React, { useMemo, useState } from "react";
import { DURATIONS, ROWS } from "../rows.js";
import { SORTS, formatDuration } from "../lib.js";
import { formatTotal, totalSeconds } from "./deck.js";
import SwipeRow from "./SwipeRow.jsx";
import {
  ArrowLeftIcon, CardsIcon, ChevronRightIcon, MoreIcon, SearchIcon, SlidersIcon,
} from "../components/icons.jsx";

// One row as a plain list (rowKey), or every row with search open (rowKey null).
export default function PhoneRow({ rowKey, board, startSearch = false, onBack, onOpenVideo, onMove, onRemove, onCleanRow }) {
  const row = ROWS.find((r) => r.key === rowKey) || null;
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(startSearch);
  const [duration, setDuration] = useState(null);
  const [sort, setSort] = useState("added-new");
  const source = row ? board[row.key] ?? [] : ROWS.flatMap((r) => board[r.key] ?? []);

  const videos = useMemo(() => {
    let out = source;
    if (duration) {
      const bucket = DURATIONS.find((d) => d.key === duration);
      out = out.filter((v) => bucket.test(v.duration_seconds));
    }
    const q = query.trim().toLowerCase();
    if (q) out = out.filter((v) => `${v.title} ${v.channel}`.toLowerCase().includes(q));
    return [...out].sort(SORTS[sort].fn);
  }, [source, duration, query, sort]);

  return (
    <section className="ph-row">
      <header className="ph-bar">
        <button className="ph-back" onClick={onBack}><ArrowLeftIcon size={18} /> Board</button>
        <div className="ph-bar__actions">
          <label className="ph-iconbtn ph-sort">
            <SlidersIcon size={18} />
            <span className="ph-sr">Sort videos</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {Object.entries(SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
            </select>
          </label>
          <button className="ph-iconbtn" onClick={() => setSearching((s) => !s)} aria-label="Search" aria-pressed={searching}>
            <SearchIcon size={18} />
          </button>
        </div>
      </header>

      <div className="ph-row__title" style={{ "--tint": row?.tint }}>
        {row ? <span className="ph-dot" aria-hidden="true" /> : null}
        <h1>{row ? row.label : "All videos"}</h1>
      </div>
      <p className="ph-row__sub">{source.length} {source.length === 1 ? "video" : "videos"} · {formatTotal(totalSeconds(source))}</p>

      {searching ? (
        <div className="ph-search">
          <SearchIcon size={16} />
          <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Title or channel" aria-label="Search videos" />
        </div>
      ) : null}

      <div className="ph-chips" role="group" aria-label="Filter by length">
        {DURATIONS.map((d) => (
          <button key={d.key} className={`ph-chip${duration === d.key ? " is-on" : ""}`} aria-pressed={duration === d.key}
            onClick={() => setDuration(duration === d.key ? null : d.key)}>
            {d.label}
          </button>
        ))}
      </div>

      {row && source.length ? (
        <button className="ph-cleanrow" onClick={() => onCleanRow(row.key)}>
          <CardsIcon size={18} /> Clean up this row <span>{source.length}<ChevronRightIcon size={14} /></span>
        </button>
      ) : null}

      {videos.length ? (
        <ul className="ph-list">
          {videos.map((v) => (
            <li key={v.id}>
              <SwipeRow onMove={() => onMove(v)} onRemove={() => onRemove(v)}>
                <button className="ph-video" onClick={() => onOpenVideo(v)}>
                  <span className="ph-video__thumb">
                    <img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" loading="lazy" />
                    {v.duration_seconds != null ? <span className="ph-dur">{formatDuration(v.duration_seconds)}</span> : null}
                  </span>
                  <span className="ph-video__text">
                    <span className="ph-video__title">{v.title}</span>
                    <span className="ph-video__channel">{v.channel}</span>
                  </span>
                  <MoreIcon size={16} className="ph-video__more" />
                </button>
              </SwipeRow>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ph-empty">{query || duration ? "No videos match." : row?.empty ?? "No videos yet."}</p>
      )}
    </section>
  );
}
```

- [ ] **Step 6: Append the row and swipe styles** to `web/src/phone/phone.css`

```css
/* row list */
.ph-row__title { display: flex; align-items: center; gap: 10px; margin-top: var(--space-1); }
.ph-row__title h1 { font: 400 28px/1.15 var(--font-display); }
.ph-row__sub { margin-top: var(--space-1); font: 400 12px var(--font-mono); color: var(--muted); }
.ph-sort { overflow: hidden; }
.ph-sort select { position: absolute; inset: 0; opacity: 0; font-size: 16px; }
.ph-search { display: flex; align-items: center; gap: var(--space-2); min-height: 44px; margin-top: var(--space-4); padding: 0 var(--space-3); border-radius: var(--radius-lg); background: var(--secondary); color: var(--muted); }
.ph-search input { flex: 1; min-width: 0; border: 0; outline: none; background: none; color: var(--foreground); font: 16px var(--font-body); }
.ph-chips { display: flex; gap: var(--space-2); margin: var(--space-4) calc(var(--space-4) * -1) 0; padding: 0 var(--space-4); overflow-x: auto; scrollbar-width: none; }
.ph-chips::-webkit-scrollbar { display: none; }
.ph-chip { flex: none; min-height: 36px; padding: 0 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-pill); background: none; color: var(--foreground); font: 500 13px var(--font-mono); }
.ph-chip.is-on { border-color: var(--primary); background: var(--primary); color: var(--primary-foreground); }
.ph-cleanrow { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: 48px; margin-top: var(--space-3); padding: 0 14px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); color: var(--foreground); font: 500 14px var(--font-body); }
.ph-cleanrow span { display: flex; align-items: center; gap: var(--space-1); margin-left: auto; color: var(--muted); font-family: var(--font-mono); }
.ph-list { margin: var(--space-2) calc(var(--space-4) * -1) 0; padding: 0; list-style: none; }
.ph-video { display: flex; align-items: flex-start; gap: var(--space-3); width: 100%; padding: var(--space-3) var(--space-2) var(--space-3) var(--space-4); border: 0; background: var(--background); color: inherit; font: inherit; text-align: left; }
.ph-video__thumb { position: relative; flex: none; width: 128px; }
.ph-video__thumb img { display: block; width: 128px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: var(--radius-md); background: var(--secondary); }
.ph-dur { position: absolute; right: 5px; bottom: 5px; padding: 1px 5px; border-radius: var(--radius-sm); background: rgba(0, 0, 0, .82); color: #fff; font: 500 10.5px var(--font-mono); }
.ph-video__text { flex: 1; min-width: 0; }
.ph-video__title { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; font-size: 14px; font-weight: 500; line-height: 1.3; }
.ph-video__channel { display: block; margin-top: var(--space-1); font-size: 12px; color: var(--muted); }
.ph-video__more { flex: none; margin-top: 2px; color: var(--muted); }

/* swipe to reveal */
.ph-swipe { position: relative; overflow: hidden; }
.ph-swipe__actions { position: absolute; inset: 0 0 0 auto; display: flex; }
.ph-swipe__actions button { width: 76px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; border: 0; font: 600 12px var(--font-body); }
.ph-swipe__move { background: var(--secondary); color: var(--foreground); }
/* Woodsmoke text: legible on coral in both themes (4.6:1 and up). */
.ph-swipe__remove { background: var(--destructive); color: #191919; }
.ph-swipe__front { position: relative; touch-action: pan-y; transition: transform var(--speed) var(--ease); }
.ph-swipe__front.is-dragging { transition: none; }
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/phone-row.test.js && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/phone/SwipeRow.jsx web/src/phone/PhoneRow.jsx web/src/phone/phone.css web/src/components/icons.jsx tests/phone-row.test.js
git commit -m "feat(phone): row list with swipe to Move or Remove, search and length chips

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Video sheet (vaul) + the phone note on the detail screen

**Files:**
- Create: `web/src/phone/VideoSheet.jsx`
- Modify: `package.json` (new devDependency `vaul`), `web/src/components/VideoDetail.jsx` (an optional `youtubeNote` prop), `web/src/phone/phone.css` (append the sheet section)
- Test: `tests/phone-sheet.test.js`, `tests/video-detail.test.js` (one new case)

**Interfaces:**
- Consumes: `ROWS` (Task 3), `REMOVAL_NOTE` (Task 3), `MoveIcon` (Task 6), `formatDuration` (`lib.js`).
- Produces:
  - `<VideoSheet video open panel onPanel(panel) onClose() removalQueued onPlay() onTldr() onMove(category) onDone() onDismiss() />`, where `panel` is `"main" | "move"`
  - `SheetBody`, the same props minus `open` and `onClose`
  - `VideoDetail` accepts `youtubeNote?: string | null`

- [ ] **Step 1: Install vaul**

Run: `npm install --save-dev vaul && node -e "console.log(require('vaul/package.json').version)"`
Expected: a 1.x version prints, and `npm ls react` shows no peer warnings.

- [ ] **Step 2: Write the failing tests.** Create `tests/phone-sheet.test.js`:

```js
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetBody } from "../web/src/phone/VideoSheet.jsx";

const video = { id: "abc12345678", title: "A useful video", channel: "A channel", duration_seconds: 603, category: "learn" };
const noop = () => {};
const render = (props = {}) => renderToStaticMarkup(React.createElement(SheetBody, {
  video, panel: "main", onPanel: noop, removalQueued: false,
  onPlay: noop, onTldr: noop, onMove: noop, onDone: noop, onDismiss: noop, ...props,
}));

describe("SheetBody", () => {
  it("leads with Open in YouTube and lists every action", () => {
    const html = render();
    expect(html).toContain('href="https://www.youtube.com/watch?v=abc12345678"');
    expect(html).toContain("A channel · 10:03");
    expect(html).toContain("Play here");
    expect(html).toContain("TL;DR");
    expect(html).toContain("Worth learning from");
    expect(html).toContain("Watched it, remove");
    expect(html).toContain("Not interested, remove");
    expect(html).not.toContain("next time Laterlist is open on your computer");
  });

  it("explains when YouTube catches up, only when removal is on", () => {
    expect(render({ removalQueued: true }))
      .toContain("Removed videos leave your YouTube Watch Later the next time Laterlist is open on your computer.");
  });

  it("lists the five rows to move to, with the current one disabled", () => {
    const html = render({ panel: "move" });
    expect(html.match(/class="ph-sitem"/g)).toHaveLength(5);
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    expect(html).toContain("Here now");
  });
});
```

In `tests/video-detail.test.js`, add a case inside `describe("VideoDetail M4 actions", …)`, after its first case:

```js
  it("lets the phone replace the YouTube note", () => {
    const html = renderToStaticMarkup(React.createElement(VideoDetail, {
      ...baseProps,
      youtubeNote: "Phone note.",
      me: { plan: "pro", isAdmin: false, summariesUsed: 0, summaryQuota: 100 },
    }));
    expect(html).toContain("Phone note.");
    expect(html).not.toContain("Your YouTube Watch Later stays unchanged.");
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/phone-sheet.test.js tests/video-detail.test.js`
Expected: FAIL, because `VideoSheet.jsx` is missing and the default note still renders.

- [ ] **Step 4: Add `youtubeNote` to `VideoDetail.jsx`.**
  1. In the props list, add `youtubeNote = null,` after `removesFromYoutube = false,`.
  2. Replace the `data-tip={removesFromYoutube ? … : …}` expression on the Mark watched button with:

```jsx
          data-tip-align="start" data-tip={youtubeNote ?? (removesFromYoutube
            ? "Hides it here and takes it off your YouTube Watch Later."
            : "Hides it from this board. Your YouTube Watch Later stays unchanged.")}
```
  3. Replace the body of `<p id="detail-watched-note" className="detail__note">` with:

```jsx
        {youtubeNote ?? (removesFromYoutube
          ? "Mark watched hides it here and takes it off your YouTube Watch Later."
          : "Mark watched hides it from this board. Your YouTube Watch Later stays unchanged.")}
```

- [ ] **Step 5: Create** `web/src/phone/VideoSheet.jsx`

```jsx
import React from "react";
import { Drawer } from "vaul";
import { ROWS } from "../rows.js";
import { formatDuration } from "../lib.js";
import { REMOVAL_NOTE } from "./copy.js";
import {
  ArrowLeftIcon, CheckIcon, ChevronRightIcon, ExternalIcon, MoveIcon, PlayIcon, SummaryIcon, XIcon,
} from "../components/icons.jsx";

export function SheetBody({ video, panel, onPanel, removalQueued, onPlay, onTldr, onMove, onDone, onDismiss }) {
  const row = ROWS.find((r) => r.key === video.category);
  const meta = [video.channel, video.duration_seconds != null && formatDuration(video.duration_seconds)]
    .filter(Boolean).join(" · ");

  if (panel === "move") {
    return (
      <div className="ph-sheet__body">
        <button className="ph-sheet__back" onClick={() => onPanel("main")}><ArrowLeftIcon size={16} /> Move to</button>
        <ul className="ph-sgroup">
          {ROWS.map((r) => (
            <li key={r.key}>
              <button className="ph-sitem" style={{ "--tint": r.tint }} disabled={r.key === video.category}
                onClick={() => onMove(r.key)}>
                <span className="ph-dot" aria-hidden="true" /> {r.label}
                {r.key === video.category ? <span className="ph-sitem__r">Here now</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="ph-sheet__body">
      <div className="ph-sheet__head">
        <img src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`} alt="" />
        <div><b>{video.title}</b>{meta ? <span>{meta}</span> : null}</div>
      </div>
      <a className="ph-btn ph-btn--primary" href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer">
        <ExternalIcon size={18} /> Open in YouTube
      </a>
      <div className="ph-sheet__two">
        <button className="ph-btn ph-btn--ghost" onClick={onPlay}><PlayIcon size={16} /> Play here</button>
        <button className="ph-btn ph-btn--ghost" onClick={onTldr}><SummaryIcon size={16} /> TL;DR</button>
      </div>
      <ul className="ph-sgroup">
        <li>
          <button className="ph-sitem" onClick={() => onPanel("move")}>
            <MoveIcon size={18} /> Move to<span className="ph-sitem__r">{row?.label}<ChevronRightIcon size={14} /></span>
          </button>
        </li>
      </ul>
      <ul className="ph-sgroup">
        <li><button className="ph-sitem" onClick={onDone}><CheckIcon size={18} /> Watched it, remove</button></li>
        <li><button className="ph-sitem ph-sitem--danger" onClick={onDismiss}><XIcon size={18} /> Not interested, remove</button></li>
      </ul>
      {removalQueued ? <p className="ph-note">{REMOVAL_NOTE}</p> : null}
    </div>
  );
}

// shadcn's Drawer is vaul under the hood: drag down or tap outside to close.
export default function VideoSheet({ video, open, onClose, ...body }) {
  if (!video) return null;
  return (
    <Drawer.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Drawer.Portal>
        <Drawer.Overlay className="ph-sheet__scrim" />
        <Drawer.Content className="ph-sheet" aria-describedby={undefined}>
          <div className="ph-sheet__handle" aria-hidden="true" />
          <Drawer.Title className="ph-sr">{video.title}</Drawer.Title>
          <SheetBody video={video} {...body} />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
```

- [ ] **Step 6: Append the sheet styles** to `web/src/phone/phone.css`. vaul portals the sheet onto `<body>`, so these classes stand alone.

```css
/* bottom sheet (vaul renders it in a portal on <body>) */
.ph-sheet__scrim { position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, .6); }
.ph-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 41; display: flex; flex-direction: column; max-height: 92dvh; padding: var(--space-2) var(--space-4) calc(var(--space-5) + env(safe-area-inset-bottom)); border-top: 1px solid var(--border-strong); border-radius: calc(var(--radius-lg) * 2.5) calc(var(--radius-lg) * 2.5) 0 0; background: var(--popover); color: var(--foreground); font-family: var(--font-body); outline: none; }
.ph-sheet__handle { flex: none; width: 38px; height: 5px; margin: 0 auto var(--space-4); border-radius: 3px; background: var(--faint); }
.ph-sheet__body { overflow-y: auto; }
.ph-sheet__head { display: flex; align-items: flex-start; gap: var(--space-3); margin-bottom: var(--space-4); }
.ph-sheet__head img { flex: none; width: 104px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: var(--radius-md); }
.ph-sheet__head b { display: block; font-size: 15px; font-weight: 600; line-height: 1.3; }
.ph-sheet__head span { display: block; margin-top: var(--space-1); font: 400 12px var(--font-mono); color: var(--muted); }
.ph-sheet__two { display: flex; gap: var(--space-2); margin-top: var(--space-2); }
.ph-sheet__back { display: flex; align-items: center; gap: var(--space-2); min-height: 44px; border: 0; background: none; color: var(--foreground); font: 600 16px var(--font-body); }
.ph-sgroup { margin: var(--space-3) 0 0; padding: 0; overflow: hidden; list-style: none; border-radius: calc(var(--radius-lg) + 5px); background: var(--secondary); }
.ph-sgroup li + li { border-top: 1px solid var(--border); }
.ph-sitem { display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: 50px; padding: 0 14px; border: 0; background: none; color: var(--foreground); font: 15px var(--font-body); text-align: left; }
.ph-sitem:disabled { opacity: .5; }
.ph-sitem__r { display: flex; align-items: center; gap: 6px; margin-left: auto; color: var(--muted); font-size: 13px; }
.ph-sitem--danger { color: var(--destructive); }
.ph-sheet .ph-note { margin-top: var(--space-3); }
```

- [ ] **Step 7: Run the tests and the build**

Run: `npx vitest run tests/phone-sheet.test.js tests/video-detail.test.js && npm test && npm run build:web`
Expected: PASS, and the build succeeds (vaul bundles).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json web/src/phone/VideoSheet.jsx web/src/components/VideoDetail.jsx web/src/phone/phone.css tests/phone-sheet.test.js tests/video-detail.test.js
git commit -m "feat(phone): video bottom sheet (vaul) and a phone-specific watched note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Clean up deck + Done screen

**Files:**
- Create: `web/src/phone/CleanupDeck.jsx`
- Modify: `web/src/phone/phone.css` (append the deck and done sections)
- Test: `tests/phone-deck-ui.test.js`

**Interfaces:**
- Consumes: `ROWS`, `swipeOutcome`, `REMOVAL_NOTE`, `SYNC_NOTE` (Task 3), and `formatDuration`.
- Produces:
  - `<CleanupDeck deck startCount stats removalQueued onClose() onDecide(outcome, video) onOpenVideo(video) onMove(video) onTldr(video) />`, where `outcome` is `"remove" | "keep"`
  - `<DoneScreen stats removalQueued onClose() />`

- [ ] **Step 1: Write the failing test** `tests/phone-deck-ui.test.js`

```js
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CleanupDeck, { DoneScreen } from "../web/src/phone/CleanupDeck.jsx";

const v = (id, category) => ({ id, category, title: `Title ${id}`, channel: "Channel", duration_seconds: 1161, playlist_position: 1, kept_at: null });
const noop = () => {};
const stats = (over = {}) => ({ reviewed: 1, removed: 1, kept: 0, moved: 0, removedSeconds: 600, ...over });
const deck = (props = {}) => renderToStaticMarkup(React.createElement(CleanupDeck, {
  deck: [v("a", "entertainment"), v("b", "watch")], startCount: 3, stats: stats(), removalQueued: false,
  onClose: noop, onDecide: noop, onOpenVideo: noop, onMove: noop, onTldr: noop, ...props,
}));
const done = (props = {}) => renderToStaticMarkup(React.createElement(DoneScreen, { stats: stats(), removalQueued: false, onClose: noop, ...props }));

describe("CleanupDeck", () => {
  it("shows progress, the front card, and a labelled button for every swipe", () => {
    const html = deck();
    expect(html).toContain("2 of 3");
    expect(html).toContain("Title a");
    expect(html).toContain("Just for fun");
    expect(html).toContain("Channel · 19:21");
    expect(html).toContain("Swipe left to remove, right to keep");
    expect(html).toContain(">Remove<");
    expect(html).toContain(">Keep<");
    expect(html).toContain("Wrong row? Move it");
    expect(html).toContain('aria-hidden="true"');
  });

  it("ends on the Done screen when the deck is empty", () => {
    expect(deck({ deck: [] })).toContain("You let go of 1 video");
  });
});

describe("DoneScreen", () => {
  it("says what the session gave back", () => {
    const html = done({ stats: stats({ reviewed: 4, removed: 3, kept: 1, removedSeconds: 7300 }), removalQueued: true });
    expect(html).toContain("You let go of 3 videos");
    expect(html).toContain("2 hours you no longer owe anyone."); // React escapes the apostrophe in "That's"
    expect(html).toContain("Removed videos leave your YouTube Watch Later the next time Laterlist is open on your computer.");
  });

  it("skips the hours line under an hour, and handles an empty pile", () => {
    expect(done()).not.toContain("you no longer owe anyone");
    expect(done({ stats: stats({ reviewed: 0, removed: 0 }) })).toContain("Nothing left to sort");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/phone-deck-ui.test.js`
Expected: FAIL with `Failed to load url ../web/src/phone/CleanupDeck.jsx`.

- [ ] **Step 3: Create** `web/src/phone/CleanupDeck.jsx`

```jsx
import React, { useRef, useState } from "react";
import { ROWS } from "../rows.js";
import { formatDuration } from "../lib.js";
import { swipeOutcome } from "./deck.js";
import { REMOVAL_NOTE, SYNC_NOTE } from "./copy.js";
import { CheckIcon, PlayIcon, SummaryIcon, XIcon } from "../components/icons.jsx";

const LEAVE_MS = 220;
const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function DeckCard({ video, back = false, cardRef, style, stamp, stampOpacity, handlers, onTldr }) {
  const row = ROWS.find((r) => r.key === video.category);
  const meta = [video.channel, video.duration_seconds != null && formatDuration(video.duration_seconds)]
    .filter(Boolean).join(" · ");
  return (
    <article ref={cardRef} className={`ph-card${back ? " ph-card--back" : ""}`} style={style}
      aria-hidden={back ? "true" : undefined} {...handlers}>
      {stamp ? (
        <span className={`ph-stamp ph-stamp--${stamp}`} style={{ opacity: stampOpacity }}>
          {stamp === "remove" ? "REMOVE" : "KEEP"}
        </span>
      ) : null}
      <img src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`} alt="" draggable={false} />
      <div className="ph-card__body">
        {row ? <span className="ph-pill" style={{ "--tint": row.tint }}><span className="ph-dot" aria-hidden="true" />{row.label}</span> : null}
        <h2>{video.title}</h2>
        {meta ? <p className="ph-card__meta">{meta}</p> : null}
        {!back && onTldr ? (
          <button className="ph-card__tldr" onClick={() => onTldr(video)}><SummaryIcon size={14} /> TL;DR</button>
        ) : null}
      </div>
    </article>
  );
}

export function DoneScreen({ stats, removalQueued, onClose }) {
  if (!stats.reviewed) {
    return (
      <section className="ph-done">
        <div className="ph-done__ring"><CheckIcon size={36} /></div>
        <h1>Nothing left to sort</h1>
        <p>{SYNC_NOTE}</p>
        <button className="ph-btn ph-btn--primary ph-done__cta" onClick={onClose}>Back to board</button>
      </section>
    );
  }
  const hours = Math.floor(stats.removedSeconds / 3600);
  return (
    <section className="ph-done">
      <div className="ph-done__ring"><CheckIcon size={36} /></div>
      <h1>{stats.removed ? `You let go of ${stats.removed} ${stats.removed === 1 ? "video" : "videos"}` : "All reviewed"}</h1>
      {hours >= 1 ? <p>That's {hours} {hours === 1 ? "hour" : "hours"} you no longer owe anyone.</p> : null}
      <div className="ph-done__stats">
        <div><b>{stats.removed}</b><span>Removed</span></div>
        <div><b>{stats.kept}</b><span>Kept</span></div>
        <div><b>{stats.moved}</b><span>Moved</span></div>
      </div>
      {removalQueued && stats.removed ? <p className="ph-note">{REMOVAL_NOTE}</p> : null}
      <button className="ph-btn ph-btn--primary ph-done__cta" onClick={onClose}>Back to board</button>
    </section>
  );
}

export default function CleanupDeck({ deck, startCount, stats, removalQueued, onClose, onDecide, onOpenVideo, onMove, onTldr }) {
  const [drag, setDrag] = useState({ dx: 0, dy: 0, width: 340, active: false });
  const [leaving, setLeaving] = useState(null);
  const startRef = useRef(null);
  const draggedRef = useRef(false);
  const cardRef = useRef(null);
  const card = deck[0];
  const next = deck[1];

  if (!card) return <DoneScreen stats={stats} removalQueued={removalQueued} onClose={onClose} />;

  const decide = (outcome) => {
    if (leaving) return;
    if (reducedMotion()) { onDecide(outcome, card); return; }
    setLeaving(outcome);
    setTimeout(() => {
      setLeaving(null);
      setDrag((d) => ({ ...d, dx: 0, dy: 0, active: false }));
      onDecide(outcome, card);
    }, LEAVE_MS);
  };

  const handlers = {
    onPointerDown: (e) => {
      if (leaving) return;
      startRef.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastT: e.timeStamp, v: 0, captured: false };
    },
    onPointerMove: (e) => {
      const s = startRef.current;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (!s.captured) {
        if (Math.hypot(dx, dy) < 8) return;
        s.captured = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      const dt = Math.max(1, e.timeStamp - s.lastT);
      s.v = (e.clientX - s.lastX) / dt;
      s.lastX = e.clientX;
      s.lastT = e.timeStamp;
      setDrag({ dx, dy, width: cardRef.current?.offsetWidth || 340, active: true });
    },
    onPointerUp: (e) => {
      const s = startRef.current;
      startRef.current = null;
      if (!s?.captured) return;
      draggedRef.current = true;
      const width = cardRef.current?.offsetWidth || 340;
      const outcome = swipeOutcome(e.clientX - s.x, s.v, width);
      if (outcome) decide(outcome);
      else setDrag((d) => ({ ...d, dx: 0, dy: 0, active: false }));
    },
    onPointerCancel: () => {
      startRef.current = null;
      setDrag((d) => ({ ...d, dx: 0, dy: 0, active: false }));
    },
    // A drag that ends over the TL;DR button must not also press it.
    onClickCapture: (e) => {
      if (draggedRef.current) { e.preventDefault(); e.stopPropagation(); }
      draggedRef.current = false;
    },
  };

  const threshold = drag.width * 0.35;
  const stamp = leaving || (drag.dx < -24 ? "remove" : drag.dx > 24 ? "keep" : null);
  const stampOpacity = leaving ? 1 : Math.min(1, Math.abs(drag.dx) / threshold);
  const off = leaving === "remove" ? -1 : 1;
  const style = leaving
    ? { transform: `translateX(${off * 150}%) rotate(${off * 18}deg)`, transition: `transform ${LEAVE_MS}ms var(--ease)` }
    : {
      transform: `translate(${drag.dx}px, ${drag.dy * 0.2}px) rotate(${(drag.dx / drag.width) * 12}deg)`,
      transition: drag.active ? "none" : "transform var(--speed) var(--ease)",
    };

  const total = Math.max(startCount, stats.reviewed + deck.length);

  return (
    <section className="ph-deck">
      <header className="ph-deck__top">
        <button className="ph-iconbtn" onClick={onClose} aria-label="Close clean up"><XIcon size={20} /></button>
        <span className="ph-deck__count">{stats.reviewed + 1} of {total}</span>
        <span className="ph-iconbtn ph-iconbtn--ghost" aria-hidden="true" />
      </header>
      <div className="ph-progress" aria-hidden="true"><i style={{ width: `${(stats.reviewed / total) * 100}%` }} /></div>

      <div className="ph-deck__stack">
        {next ? <DeckCard key={next.id} video={next} back /> : null}
        <DeckCard key={card.id} video={card} cardRef={cardRef} style={style} stamp={stamp}
          stampOpacity={stampOpacity} handlers={handlers} onTldr={onTldr} />
      </div>

      <p className="ph-deck__hint">Swipe left to remove, right to keep</p>
      <div className="ph-deck__acts">
        <button className="ph-act ph-act--remove" onClick={() => decide("remove")}><span><XIcon size={26} /></span>Remove</button>
        <button className="ph-act ph-act--watch" onClick={() => onOpenVideo(card)}><span><PlayIcon size={20} /></span>Watch</button>
        <button className="ph-act ph-act--keep" onClick={() => decide("keep")}><span><CheckIcon size={26} /></span>Keep</button>
      </div>
      <button className="ph-deck__move" onClick={() => onMove(card)}>Wrong row? Move it</button>
    </section>
  );
}
```

- [ ] **Step 4: Append the deck and done styles** to `web/src/phone/phone.css`

```css
/* clean up deck */
.ph-deck { display: flex; flex-direction: column; min-height: calc(100dvh - env(safe-area-inset-top)); padding-bottom: env(safe-area-inset-bottom); }
.ph-deck__top { display: flex; align-items: center; justify-content: space-between; min-height: 56px; }
.ph-deck__count { font: 500 13px var(--font-mono); color: var(--muted); }
.ph-progress { height: 3px; overflow: hidden; border-radius: 2px; background: var(--secondary); }
.ph-progress i { display: block; height: 100%; background: var(--foreground); transition: width var(--speed) var(--ease); }
.ph-deck__stack { position: relative; flex: 1; min-height: 380px; margin-top: var(--space-5); }
.ph-card { position: absolute; inset: 0 0 auto; overflow: hidden; border: 1px solid var(--border-strong); border-radius: calc(var(--radius-lg) * 2); background: var(--card); box-shadow: var(--shadow-raised); touch-action: none; user-select: none; -webkit-user-select: none; will-change: transform; }
.ph-card--back { transform: translateY(16px) scale(.94); opacity: .55; pointer-events: none; }
.ph-card img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: var(--secondary); pointer-events: none; }
.ph-card__body { padding: var(--space-4) 18px 18px; }
.ph-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 8px; border: 1px solid var(--border-strong); border-radius: var(--radius-pill); font-size: 12px; font-weight: 500; }
.ph-pill .ph-dot { width: 8px; height: 8px; }
.ph-card h2 { margin: var(--space-3) 0 6px; font: 600 18px/1.3 var(--font-body); }
.ph-card__meta { font: 400 12px var(--font-mono); color: var(--muted); }
.ph-card__tldr { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; margin-top: var(--space-4); padding: 0 var(--space-3); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: none; color: var(--foreground); font: 500 13px var(--font-body); }
.ph-stamp { position: absolute; top: 22px; z-index: 2; padding: 6px 12px 4px; border: 2.5px solid currentColor; border-radius: var(--radius-lg); background: color-mix(in srgb, var(--background) 70%, transparent); font: 400 26px/1 var(--font-display); letter-spacing: .06em; pointer-events: none; }
.ph-stamp--remove { right: 18px; color: var(--destructive); transform: rotate(14deg); }
.ph-stamp--keep { left: 18px; color: var(--foreground); transform: rotate(-14deg); }
.ph-deck__hint { margin-top: var(--space-4); text-align: center; font-size: 13px; color: var(--muted); }
.ph-deck__acts { display: flex; justify-content: center; align-items: flex-start; gap: 28px; margin-top: var(--space-5); }
.ph-act { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); border: 0; background: none; color: var(--muted); font: 12px var(--font-body); }
.ph-act span { width: 68px; height: 68px; display: grid; place-items: center; border-radius: 50%; }
.ph-act--remove span { border: 1.5px solid var(--destructive); color: var(--destructive); }
.ph-act--watch span { width: 54px; height: 54px; margin-top: 7px; background: var(--secondary); color: var(--foreground); }
.ph-act--keep span { background: var(--primary); color: var(--primary-foreground); }
.ph-deck__move { align-self: center; min-height: 44px; margin-top: var(--space-2); border: 0; background: none; color: var(--foreground); font: 500 14px var(--font-body); }
@media (prefers-reduced-motion: reduce) {
  .ph-card, .ph-swipe__front, .ph-progress i { transition: none !important; }
}

/* done */
.ph-done { display: flex; flex-direction: column; align-items: center; min-height: calc(100dvh - env(safe-area-inset-top)); padding: 96px var(--space-2) calc(var(--space-6) + env(safe-area-inset-bottom)); text-align: center; }
.ph-done__ring { width: 88px; height: 88px; display: grid; place-items: center; border: 2px solid var(--foreground); border-radius: 50%; }
.ph-done h1 { margin-top: 28px; font: 400 34px/1.15 var(--font-display); }
.ph-done > p { margin-top: var(--space-2); color: var(--muted); }
.ph-done__stats { display: flex; gap: var(--space-2); width: 100%; margin-top: var(--space-6); }
.ph-done__stats div { flex: 1; padding: 14px var(--space-2); border: 1px solid var(--border); border-radius: calc(var(--radius-lg) + 5px); background: var(--card); }
.ph-done__stats b { display: block; font: 500 26px var(--font-mono); }
.ph-done__stats span { font-size: 12px; color: var(--muted); }
.ph-done .ph-note { max-width: 290px; margin-top: 20px; }
.ph-done__cta { margin-top: auto; }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/phone-deck-ui.test.js && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/phone/CleanupDeck.jsx web/src/phone/phone.css tests/phone-deck-ui.test.js
git commit -m "feat(phone): swipe Clean up deck and Done screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: PhoneApp shell, wiring into App, and browser verification

**Files:**
- Create: `web/src/phone/useIsPhone.js`, `web/src/phone/PhoneSettings.jsx`, `web/src/phone/PhoneApp.jsx`
- Modify: `web/src/App.jsx` (imports, one hook call, one early return), `web/src/main.jsx` (CSS import), `web/src/phone/phone.css` (append the shell section)
- Test: `tests/phone-app.test.js`

**Interfaces:**
- Consumes everything from Tasks 2 to 8, plus:
  - `api.listTokens()`, `api.setPrefs()`, `api.saveTaste()`
  - the existing `Settings`, `Onboarding` and `VideoDetail` components
  - `isFirstRun` (`lib.js`)
  - App's `me`, `board`, `job`, `reload` and `onSummaryUsed`
- Produces:
  - `PHONE_QUERY`
  - `useIsPhone(): boolean`
  - `<PhoneSettings me reload onToast onRetakeQuiz />`
  - `<PhoneApp me board job reload onSummaryUsed />`

- [ ] **Step 1: Write the failing test** `tests/phone-app.test.js`

```js
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PhoneApp from "../web/src/phone/PhoneApp.jsx";
import { PHONE_QUERY } from "../web/src/phone/useIsPhone.js";

const v = (id, position) => ({ id, title: `Title ${id}`, channel: "C", duration_seconds: 600, playlist_position: position, kept_at: null });
const board = { learn: [v("a", 1), v("b", 2)], watch: [v("c", 3)], music: [], entertainment: [], outdated: [] };
const me = (counts) => ({ email: "a@test.dev", plan: "pro", removeFromYoutube: false, counts });
const render = (props) => renderToStaticMarkup(React.createElement(PhoneApp, {
  board, job: null, reload: async () => {}, onSummaryUsed: () => {}, ...props,
}));

describe("PhoneApp", () => {
  it("keeps the phone layout when a phone is held sideways", () => {
    expect(PHONE_QUERY).toBe("(max-width: 640px), (pointer: coarse) and (max-height: 500px)");
  });

  it("opens on the Board with the three tabs and the review count", () => {
    const html = render({ me: me({ scanned: 3, unscanned: 0, done: 0, dismissed: 0 }) });
    expect(html).toContain("Your rows");
    expect(html).toContain('aria-label="Main"');
    expect(html).toContain('<span class="ph-tab__badge">3</span>');
    expect(html).toContain("Settings");
  });

  it("sends a brand new user to their computer", () => {
    expect(render({ me: me({ scanned: 0, unscanned: 0, done: 0, dismissed: 0 }) })).toContain("Start on your computer");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/phone-app.test.js`
Expected: FAIL with `Failed to load url ../web/src/phone/PhoneApp.jsx`.

- [ ] **Step 3: Create** `web/src/phone/useIsPhone.js`

```js
import { useEffect, useState } from "react";

// Phone sized, or a phone held sideways (about 850px wide but short and touch
// driven). Without the second half, rotating mid-session would swap layouts.
export const PHONE_QUERY = "(max-width: 640px), (pointer: coarse) and (max-height: 500px)";

const matches = () => typeof window !== "undefined" && typeof window.matchMedia === "function"
  && window.matchMedia(PHONE_QUERY).matches;

export function useIsPhone() {
  const [isPhone, setIsPhone] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setIsPhone(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  return isPhone;
}
```

- [ ] **Step 4: Create** `web/src/phone/PhoneSettings.jsx`

```jsx
import React from "react";
import * as api from "../api.js";
import Settings from "../components/Settings.jsx";
import { SYNC_NOTE } from "./copy.js";

// The desktop Settings, minus the extension (phones can't run it).
const NO_EXTENSION = { checking: false, present: false, connected: false, mismatch: false, isChromium: false };

export default function PhoneSettings({ me, reload, onToast, onRetakeQuiz }) {
  const toggleRemoveFromYoutube = async (enabled) => {
    try {
      await api.setPrefs({ removeFromYoutube: enabled });
      await reload();
    } catch (error) {
      onToast(error.message);
    }
  };
  return (
    <div className="ph-settings">
      <p className="ph-note ph-settings__sync">{SYNC_NOTE}</p>
      <Settings me={me} onBack={() => {}} onToast={onToast} onRetakeQuiz={onRetakeQuiz}
        extension={{ ...NO_EXTENSION, accountEmail: me.email }} onConnectExtension={async () => null}
        extensionBusy={false} extensionConnected={false} extensionVersionOk={false}
        removeFromYoutube={me.removeFromYoutube} onToggleRemoveFromYoutube={toggleRemoveFromYoutube}
        onImportManually={() => {}} />
    </div>
  );
}
```

- [ ] **Step 5: Create** `web/src/phone/PhoneApp.jsx`

```jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api.js";
import { isFirstRun } from "../lib.js";
import { ROWS } from "../rows.js";
import { applyOverlay, buildDeck, findVideo, pruneOverlay, sessionStats } from "./deck.js";
import { COMMIT_DELAY_MS, pendingQueue } from "./pendingQueue.js";
import { REMOVAL_NOTE } from "./copy.js";
import PhoneBoard from "./PhoneBoard.jsx";
import PhoneSetupNote from "./PhoneSetupNote.jsx";
import PhoneRow from "./PhoneRow.jsx";
import VideoSheet from "./VideoSheet.jsx";
import CleanupDeck from "./CleanupDeck.jsx";
import PhoneSettings from "./PhoneSettings.jsx";
import VideoDetail from "../components/VideoDetail.jsx";
import Onboarding from "../components/Onboarding.jsx";
import { BrandMark, CardsIcon, SettingsIcon } from "../components/icons.jsx";

const TOAST_TEXT = { dismiss: "Removed", done: "Marked watched", keep: "Kept" };
const TAB_SCREENS = new Set(["board", "row", "settings"]);
const dropKey = (obj, key) => { const next = { ...obj }; delete next[key]; return next; };

export default function PhoneApp({ me, board, job, reload, onSummaryUsed }) {
  // Screens form a stack. A "sheet" entry sits on top of the screen it covers.
  const [stack, setStack] = useState([{ name: "board" }]);
  const [overlay, setOverlay] = useState({});
  const [toast, setToast] = useState(null); // { text, key }
  const [log, setLog] = useState([]);
  const [undone, setUndone] = useState(() => new Set());
  const [importLinked, setImportLinked] = useState(false);
  const [sheetVideo, setSheetVideo] = useState(null);
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const toastTimer = useRef(null);
  const reloadTimer = useRef(null);

  const top = stack[stack.length - 1];
  const sheetOpen = top.name === "sheet";
  const screen = sheetOpen ? stack[stack.length - 2] : top;
  const view = useMemo(() => applyOverlay(board, overlay), [board, overlay]);
  const deckAll = useMemo(() => buildDeck(view), [view]);
  const removalQueued = Boolean(me.removeFromYoutube) && importLinked;
  const liveSheetVideo = sheetVideo ? findVideo(view, sheetVideo.id) ?? sheetVideo : null;

  // ---- navigation: the stack is mirrored into history so Back closes the top
  const push = (entry) => {
    history.pushState({ phoneDepth: stackRef.current.length }, "");
    setStack([...stackRef.current, entry]);
  };
  const back = () => history.back();
  const replaceTop = (entry) => setStack((s) => [...s.slice(0, -1), entry]);
  const switchTab = (entry) => {
    const depth = stackRef.current.length - 1;
    setStack([entry]);
    if (depth > 0) history.go(-depth);
  };
  useEffect(() => {
    history.replaceState({ phoneDepth: 0 }, "");
    const onPop = (e) => {
      const depth = Number(e.state?.phoneDepth) || 0;
      setStack((s) => s.slice(0, depth + 1));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ---- data that only the phone needs
  useEffect(() => { setOverlay((o) => pruneOverlay(board, o)); }, [board]);
  useEffect(() => {
    api.listTokens().then((tokens) => setImportLinked(tokens.some((t) => t.scope === "imports")), () => {});
  }, []);

  // ---- toast + the undo queue
  const flashToast = useCallback((text, key = null) => {
    setToast({ text, key });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), key ? COMMIT_DELAY_MS : 3000);
  }, []);

  useEffect(() => pendingQueue.subscribe((event) => {
    if (event.type !== "settled") return;
    if (!event.ok) {
      setOverlay((o) => dropKey(o, event.action.id));
      flashToast("Couldn't save that. Check your connection and try again.");
    }
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => { reload().catch(() => {}); }, 400);
  }), [flashToast, reload]);

  useEffect(() => {
    const flush = () => { void pendingQueue.flush({ keepalive: true }); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    document.documentElement.classList.add("is-phone");
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      document.documentElement.classList.remove("is-phone");
      flush();
    };
  }, []);

  const act = (action, video, effect, text) => {
    setOverlay((o) => ({ ...o, [video.id]: effect }));
    const key = pendingQueue.enqueue(action);
    setLog((l) => [...l, { key, kind: action.kind, video }]);
    flashToast(text, key);
  };
  const remove = (video, kind = "dismiss") => act({ kind, id: video.id }, video, { hide: true }, TOAST_TEXT[kind]);
  const keep = (video) => act({ kind: "keep", id: video.id }, video, { kept: true }, TOAST_TEXT.keep);
  const move = (video, category, alsoKeep = false) => act(
    { kind: "move", id: video.id, category, keep: alsoKeep }, video, { category, kept: alsoKeep },
    `Moved to ${ROWS.find((r) => r.key === category)?.label ?? category}`,
  );
  const undo = () => {
    if (!toast?.key) return;
    const action = pendingQueue.undo(toast.key);
    if (action) {
      setOverlay((o) => dropKey(o, action.id));
      setUndone((u) => new Set(u).add(toast.key));
    }
    setToast(null);
  };

  // ---- screens
  const openSheet = (video, { panel = "main", fromDeck = false } = {}) => {
    setSheetVideo(video);
    push({ name: "sheet", panel, fromDeck });
  };
  const deckEntry = (row) => ({ name: "deck", row, startCount: buildDeck(view, { row }).length });
  const resetSession = () => { setLog([]); setUndone(new Set()); };
  const startDeck = (row) => { resetSession(); push(deckEntry(row)); };
  const closeDeck = () => (stackRef.current.length > 1 ? back() : switchTab({ name: "board" }));
  const retakeQuiz = () => { api.saveTaste({ interests: [], note: "" }).catch(() => {}); push({ name: "quiz" }); };

  let body;
  if (screen.name === "board") {
    body = isFirstRun(me.counts)
      ? <PhoneSetupNote host={globalThis.location?.host ?? ""} />
      : (
        <PhoneBoard board={view} deckCount={deckAll.length} job={job}
          onOpenRow={(row) => push({ name: "row", row })}
          onStartCleanup={() => startDeck(null)}
          onSearch={() => push({ name: "row", row: null, search: true })} />
      );
  } else if (screen.name === "row") {
    body = (
      <PhoneRow key={`${screen.row}:${Boolean(screen.search)}`} rowKey={screen.row} board={view}
        startSearch={Boolean(screen.search)} onBack={back}
        onOpenVideo={(v) => openSheet(v)} onMove={(v) => openSheet(v, { panel: "move" })}
        onRemove={(v) => remove(v)} onCleanRow={(row) => startDeck(row)} />
    );
  } else if (screen.name === "deck") {
    body = (
      <CleanupDeck deck={buildDeck(view, { row: screen.row })} startCount={screen.startCount}
        stats={sessionStats(log, undone)} removalQueued={removalQueued} onClose={closeDeck}
        onDecide={(outcome, v) => (outcome === "remove" ? remove(v) : keep(v))}
        onOpenVideo={(v) => openSheet(v, { fromDeck: true })}
        onMove={(v) => openSheet(v, { panel: "move", fromDeck: true })}
        onTldr={(v) => push({ name: "detail", video: v, intent: "tldr" })} />
    );
  } else if (screen.name === "settings") {
    body = <PhoneSettings me={me} reload={reload} onToast={flashToast} onRetakeQuiz={retakeQuiz} />;
  } else if (screen.name === "quiz") {
    body = <Onboarding onDone={() => reload().then(back)} />;
  } else if (screen.name === "detail") {
    const video = findVideo(view, screen.video.id) ?? screen.video;
    body = (
      <div className="ph-detail">
        <VideoDetail video={video} rowMeta={ROWS.find((r) => r.key === video.category)} me={me}
          intent={screen.intent} extensionPresent={false} removesFromYoutube={false}
          youtubeNote={removalQueued ? `Mark watched hides it here. ${REMOVAL_NOTE}` : null}
          onBack={back} onMove={async (id, category) => move(video, category)}
          onDismiss={async () => remove(video)} onDone={async () => remove(video, "done")}
          onToast={flashToast} onSummaryUsed={onSummaryUsed} />
      </div>
    );
  }

  const sheetProps = sheetOpen && liveSheetVideo ? {
    panel: top.panel,
    onPanel: (panel) => replaceTop({ ...top, panel }),
    removalQueued,
    onPlay: () => replaceTop({ name: "detail", video: liveSheetVideo, intent: "play" }),
    onTldr: () => replaceTop({ name: "detail", video: liveSheetVideo, intent: "tldr" }),
    onMove: (category) => { move(liveSheetVideo, category, top.fromDeck); back(); },
    onDone: () => { remove(liveSheetVideo, "done"); back(); },
    onDismiss: () => { remove(liveSheetVideo, "dismiss"); back(); },
  } : { panel: "main", onPanel: () => {} };

  const tabsVisible = TAB_SCREENS.has(screen.name);
  const onSettings = screen.name === "settings";

  return (
    <div className={`ph-app${tabsVisible ? " has-tabs" : ""}`}>
      {body}

      {toast ? (
        <div className="ph-toast" role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.key ? <button onClick={undo}>Undo</button> : null}
        </div>
      ) : null}

      {tabsVisible ? (
        <nav className="ph-tabs" aria-label="Main">
          <button className={`ph-tab${onSettings ? "" : " is-on"}`} aria-current={onSettings ? undefined : "page"}
            onClick={() => switchTab({ name: "board" })}>
            <BrandMark size={20} />Board
          </button>
          <button className="ph-tab" onClick={() => { resetSession(); switchTab(deckEntry(null)); }}>
            <CardsIcon size={20} />Clean up
            {deckAll.length ? <span className="ph-tab__badge">{deckAll.length}</span> : null}
          </button>
          <button className={`ph-tab${onSettings ? " is-on" : ""}`} aria-current={onSettings ? "page" : undefined}
            onClick={() => switchTab({ name: "settings" })}>
            <SettingsIcon size={20} />Settings
          </button>
        </nav>
      ) : null}

      <VideoSheet video={liveSheetVideo} open={sheetOpen} onClose={back} {...sheetProps} />
    </div>
  );
}
```

- [ ] **Step 6: Append the shell styles** to `web/src/phone/phone.css`

```css
/* tab bar + toast */
.ph-tabs { position: fixed; left: var(--space-4); right: var(--space-4); bottom: calc(env(safe-area-inset-bottom) + 12px); z-index: 30; display: flex; height: 64px; padding: 6px; border: 1px solid var(--border-strong); border-radius: var(--radius-pill); background: color-mix(in srgb, var(--popover) 88%, transparent); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }
.ph-tab { position: relative; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border: 0; border-radius: var(--radius-pill); background: none; color: var(--muted); font: 500 11px var(--font-body); }
.ph-tab.is-on { background: var(--secondary); color: var(--foreground); }
.ph-tab__badge { position: absolute; top: 4px; left: calc(50% + 6px); padding: 0 5px; border-radius: 8px; background: var(--primary); color: var(--primary-foreground); font: 500 10px/16px var(--font-mono); }
.ph-toast { position: fixed; left: 50%; bottom: calc(env(safe-area-inset-bottom) + 88px); z-index: 35; display: flex; align-items: center; gap: var(--space-3); max-width: calc(100vw - 32px); padding: var(--space-2) var(--space-4); border: 1px solid var(--border-strong); border-radius: var(--radius-pill); background: var(--popover); box-shadow: var(--shadow-raised); font-size: 13px; transform: translateX(-50%); }
.ph-toast:has(button) { padding-right: var(--space-2); }
.ph-toast span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ph-toast button { flex: none; min-height: 32px; padding: 0 var(--space-3); border: 0; border-radius: var(--radius-pill); background: var(--primary); color: var(--primary-foreground); font: 600 13px var(--font-body); }
.ph-app:not(.has-tabs) .ph-toast { top: calc(env(safe-area-inset-top) + 72px); bottom: auto; }

/* desktop screens reused inside the phone shell */
.ph-detail .detail__actions { flex-wrap: wrap; }
.ph-detail .detail__actions > .btn { flex: 1 1 auto; justify-content: center; }
.ph-detail .topbar__spacer { display: none; }
.ph-settings__sync { margin: var(--space-4) var(--space-1) 0; }
.ph-settings .catview__header .btn { display: none; }
```

- [ ] **Step 7: Wire it into `App.jsx` and `main.jsx`.**
  1. In `web/src/App.jsx`, add after the `rows.js` import:

```js
import { useIsPhone } from "./phone/useIsPhone.js";
import PhoneApp from "./phone/PhoneApp.jsx";
```
  2. Right after `const meEmail = me?.email || "";`, add:

```js
  const isPhone = useIsPhone();
```
  3. Right after `if (!me || !board) return <div className="loading">loading…</div>;`, add:

```jsx
  // Phones get their own layout (web/src/phone/). Everything below is desktop.
  if (isPhone) {
    return <PhoneApp me={me} board={board} job={job} reload={reload} onSummaryUsed={onSummaryUsed} />;
  }
```
  4. In `web/src/main.jsx`, add `import "./phone/phone.css";` after `import "./styles.css";`.

- [ ] **Step 8: Run the tests and the build**

Run: `npx vitest run tests/phone-app.test.js && npm test && npm run build:web`
Expected: PASS, and the build succeeds.

- [ ] **Step 9: Commit**

```bash
git add web/src/phone web/src/App.jsx web/src/main.jsx tests/phone-app.test.js
git commit -m "feat(phone): phone shell with tabs, undo toast and history, wired into App

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Start a dev server for this worktree.** Create `.claude/launch.json` in the worktree. It is untracked and must not be committed.

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "laterlist-mobile",
      "runtimeExecutable": "bash",
      "runtimeArgs": ["-lc", "npm run build:web && npm run build:collector && node server/index.js"],
      "env": { "DEV_FAKE_AUTH": "1", "FAKE_LLM": "1", "BETA_PRO_FOR_ALL": "1", "PORT": "4410", "PGLITE_DIR": "./dev-pgdata-mobile" },
      "port": 4410
    }
  ]
}
```
Start it with `preview_start {name: "laterlist-mobile"}`. Then seed it with real video IDs, so the thumbnails load. The other chat's server at :4403 is a read-only source. If it's gone, use `vids(40)` from `tests/helpers.js`; those have no thumbnails, but the layout is still checkable.

```bash
curl -s http://localhost:4403/api/board -H "Authorization: Bearer dev:joon2@example.test" \
 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=JSON.parse(s);const videos=Object.values(b).flat().map((v,i)=>({id:v.id,title:v.title,channel:v.channel,durationSeconds:v.duration_seconds,position:i+1,publishedText:v.published_text}));process.stdout.write(JSON.stringify({v:1,source:"console",videos}))})' \
 | curl -s -X POST http://localhost:4410/api/imports -H "Authorization: Bearer dev:joon@test.dev" -H "Content-Type: application/json" --data-binary @-
```
Expected: JSON with `added` greater than 0. Wait about 10 s for the fake classifier, then confirm the board has rows with `curl -s http://localhost:4410/api/board -H "Authorization: Bearer dev:joon@test.dev" | head -c 300`.

- [ ] **Step 11: Verify in the browser at phone size.** Use `resize_window` at 390×844 and `javascript_tool` (`localStorage.setItem("wll-dev-email","joon@test.dev"); location.reload()`). Check each item, and screenshot each screen:
  1. Board: the hero count and time, the thumbnail fan, five rows (Outdated greyed if it's empty), and a floating tab bar with a badge. No sideways scroll: `document.documentElement.scrollWidth <= 390`.
  2. Tap a row. The list has thumbnails on the left. Drag a row left with `left_click_drag` and confirm Move and Remove appear. The length chips filter. The sort select works. Search filters.
  3. Tap a video. The sheet slides up, and dragging it down closes it. Move to shows five rows with the current one disabled. Play here opens the detail screen with the player, and Back returns. TL;DR runs (FAKE_LLM).
  4. Clean up tab. Drag the card left past a third: the REMOVE stamp shows, the card flies off, and the toast shows Undo. Tap Undo and the card returns. Drag right to keep. Use the buttons. Finish the deck and check the Done screen numbers.
  5. Settings tab: the sync note shows, no extension block, and the theme toggle works.
  6. `read_console_messages` with `onlyErrors`: none.
  7. Wait 6 s after a remove, then reload the page: the removed video stays gone, so the server got it.
  8. Desktop check: run `resize_window` with preset desktop (1440 wide) and reload. The desktop board is unchanged: topbar, chips, horizontal rows. Screenshot it.
  9. Light mode: in Settings → Appearance switch to light, then recheck the Board, a row, the sheet and the deck at 390. Text must be readable and the category dots visible.

  Fix anything that fails in the component or in `phone.css`, then rerun `npm test`. Commit the fixes with `fix(phone): …`.

---

### Task 10: Polish and ship

**Files:** whatever the polish pass touches, limited to `web/src/phone/*` and `phone.css`.

- [ ] **Step 1: Polish pass.** Load the `kole-jain` skill and apply it to the phone screens using screenshots at 390×844, in both dark and light. Keep the approved structure from `Mobile Design.html`. Only spacing, hierarchy and detail fixes are allowed. Rerun `npm test` and commit with `style(phone): polish pass`.
- [ ] **Step 2: Full check.** Run `npm test && npm run build:web`. Expected: all green.
- [ ] **Step 3: Cross-review.** Run `/codex review` on the branch diff against `origin/main`. Fix every real finding, rerun `npm test`, and commit.
- [ ] **Step 4: PR.** Push, then run `gh pr create --title "Laterlist on the phone: Board, rows, sheet, swipe Clean up"`. The body lists:
  - the screens
  - the one server change (migration 009)
  - that the desktop is unchanged at 1440 (attach the screenshot)
  - the iPhone checklist below
  - the 🤖 line at the end

  Bind it with `mcp__ccd_pr__bind_pr` if `get_status` doesn't show it.
- [ ] **Step 5: Prod migration first (Joon).** Vercel doesn't auto-migrate. Joon pastes `migration-009-prod.txt` into the Supabase SQL editor. Verify it from the dev machine without writing: ask Joon to run `SELECT id FROM schema_migrations WHERE id = '009-kept';` and confirm one row comes back.
- [ ] **Step 6: Merge on Joon's "ship it".** Run `gh pr merge --merge`. Within about a minute, check that the live bundle contains `ph-tabs` with `curl -s https://laterlist-app.vercel.app/app/ | grep -o 'assets/app-[^"]*\.css'`, then grep that CSS for `ph-tabs`.
- [ ] **Step 7: Joon's iPhone checklist.** Send it as plain text:
  1. Open Laterlist from the Home Screen and sign in if asked.
  2. Swipe cards and rows while scrolling the list.
  3. Rotate the phone mid Clean up. The layout and any pending removes survive.
  4. Tap Open in YouTube. Does it open the YouTube app, or a Safari sheet?
  5. Remove 2 videos, then open Laterlist on the computer. They leave your YouTube Watch Later.
  6. Does swiping from the left edge go back?

  Fix what he reports in a follow-up PR.
- [ ] **Step 8: Log it.**
  - Add a dated entry at the top of the vault log `~/Obsidian/Joon/1. Projects/Laterlist/log.md`: SHIPPED, the PR link, the merge SHA, and the iPhone checklist results.
  - Update the status in `Decision - Phone version as a Home Screen web app (2026-10-05).md`.
  - Update the memory file `laterlist-mobile-web.md`.
