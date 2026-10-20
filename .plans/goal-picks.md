# Goal Picks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The weekly picks payload, API, This week screen and Mac CLI move from "3 picks from Watch Later" to "0 to 3 picks per goal, from anywhere on YouTube, each with a covers list and a Remove all".

**Architecture:** `pick_sets.payload` is jsonb, so there is no migration. One validator in `server/picks.js` accepts the new goal shape and still accepts the old flat shape, so past weeks render. Two new bulk endpoints (`POST /api/videos/dismiss`, `POST /api/videos/restore`) back Remove all and its Undo. The CLI gains a `search` subcommand that runs yt-dlp with fixed arguments.

**Tech Stack:** Node ESM, Express, pg / PGlite, React (Vite), vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-10-19-goal-picks-design.md` (read it before Task 1).

**Executor:** Codex, GPT-6.1 Sol high. The UI task cannot list every case. Claude reviews the diff. Work only in this worktree (`~/projects/laterlist-goal-picks`, branch `spec/goal-picks`). Never touch `~/projects/laterlist` (Joon's dirty main checkout) or `~/projects/laterlist-runtime`.

## Context

- `AGENTS.md`: `npm test` must be green before every commit. Do not change tests to match broken code. Everything is factory-injected through `server/index.js`. Use the one `query()` interface.
- Current shape and code: `server/picks.js` (`validatePicks`, `pickIds`, `VERDICTS`), `server/app.js` picks routes (around line 404), `server/db.js` picks section (around line 670), `dismiss`, `keep`, `enqueueYoutubeRemovals`, `web/src/components/ThisWeek.jsx`, `web/src/api.js`, `scripts/watch-picks.mjs`, `scripts/watch-picks/{subs,render,api,db}.mjs`.
- Tests to extend: `tests/picks-api.test.js` (helpers `seed`, `tokens`, `postAsMac`, `asJoon`, `vid`), `tests/this-week.test.js`, `tests/watch-picks-render.test.js`, `tests/watch-picks-subs.test.js`, `tests/watch-picks-cli.test.js`.
- Design tokens: `docs/design-system.md` only. The UI stays monochrome, and color appears only on category dots.

## Global Constraints

- Limits: up to 4 goals, 0 to 3 picks per goal, up to 20 covers per pick, up to 12 `closeButNo` entries.
- Text caps: `name` 60, `need` 200, `author` 120, `action` 160, `why` 400, `empty` 120. The other caps match the current validator.
- `source` is exactly `"youtube"` or `"saved"`.
- Subtitle budget: `FETCH_BUDGET = 24` per week.
- Search drops videos under 180 s and over 7200 s. Results are capped at 20 per query.
- Remove all: up to 500 ids per call. Undo is shown for 10 seconds.
- Copy users see has no em dashes and no en dashes. Exact strings:
  - `From YouTube`
  - `In your Watch Later`
  - `Covers ${n} saved video(s)`
  - `Remove all ${n}`
  - `Leave it`
  - `Nothing good enough this week.` (used when `empty` is blank)
  - `Picked without reading the transcript`
  - `Removed ${n}. They leave your YouTube Watch Later next time Laterlist is open on your computer.`
  - `Back in Laterlist. ${k} were already off YouTube.` (the second sentence only when `k > 0`)
- YouTube picks have no category dot and no library row. Never insert them into `videos`.

## Review Focus

1. **A pick that is also in its own covers or in another pick's covers.** The validator strips the pick's own id from covers. A video picked elsewhere in the set is also dropped from every covers list (Task 1 test).
2. **A covers video Joon removes from Library between Monday and opening This week.** `current` marks it `gone`, shows it struck, and leaves it out of the Remove all count (Tasks 2 and 4 tests).
3. **Pressing Remove all twice, or with a stale id.** The bulk dismiss only touches `scanned` rows and returns the ids it actually changed. The UI count comes from the response (Task 3 test).
4. **Undo after the extension already removed some from YouTube.** Restore deletes only `pending` removal rows and reports the `removed` ones as `alreadyOffYoutube` (Task 3 test).
5. **A search query that looks like a flag (`--exec ...`).** The query is passed only inside one `ytsearchN:` argument after `--` (Task 5 test).

---

### Task 1: Validator accepts the goal shape

**Files:**
- Modify: `server/picks.js`
- Test: `tests/goal-picks-validate.test.js` (new)

**Interfaces:**
- Produces:
  - `validatePicks(data)` returns either the legacy object, unchanged, or `{ week, error: "", notice, goals: [{ name, need, empty, picks: [Pick] }], closeButNo: [{ id, goal, title, reason }] }`.
  - `Pick` is `{ id, source, title, channel, durationSeconds, author, why, action, gets, start, end, noTranscript, covers: string[] }`.
  - `isGoalSet(set) -> boolean`, which is `Array.isArray(set.goals)`.
  - `allPicks(set) -> Pick[]`, flat across both shapes. Legacy picks get `source: "saved"`.
  - `pickIds(set) -> string[]`, all pick ids plus closeButNo ids, for both shapes.
  - `savedPickIds(set) -> string[]`.
  - `coverIds(set) -> string[]`, deduped.

- [x] **Step 1: Write failing tests** in `tests/goal-picks-validate.test.js`:
  - `accepts a goal set and keeps legacy sets unchanged`: a legacy `setFor`-style object deep-equals its old output, and a goal set gets `goals.length === 2`.
  - `caps goals at 4, picks per goal at 3, covers at 20`.
  - `requires name, need, author, action; requires title, channel, durationSeconds for youtube picks`: each one missing throws `PicksDataError`, and the message names the goal or pick index.
  - `rejects a source other than youtube or saved`.
  - `rejects the same video picked twice in one set`.
  - `strips a pick's own id and any other picked id from covers, and drops bad ids`: covers `[self, otherPick, "bad", vid(5)]` becomes `[vid(5)]`.
  - `blank empty becomes "Nothing good enough this week." only when the goal has zero picks`.
  - `error-only sets still skip every requirement`.
- [x] **Step 2:** Run `npx vitest run tests/goal-picks-validate.test.js`. Expected: FAIL.
- [x] **Step 3:** Implement in `server/picks.js`. Branch on `Array.isArray(data.goals)`. The legacy path is the current code, untouched. Reuse `str`, `int` and `ID_RE`. Apply the start and end rule from the legacy path to every pick.
- [x] **Step 4:** Run `npx vitest run tests/goal-picks-validate.test.js tests/watch-picks-render.test.js`. Expected: PASS.
- [x] **Step 5:** Run `npm test`, then commit `feat(picks): validator accepts goal picks with covers`.

### Task 2: Picks API serves goal sets

**Files:**
- Modify: `server/app.js` (picks routes), `server/db.js` (`pickHistory`)
- Test: `tests/picks-api.test.js` (append a `describe("goal picks")`)

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces, for a goal set:
  - `POST /api/picks` returns `{ week, picks: n, warnings: string[] }`.
  - `GET /api/picks/current` returns `set.goals[].picks[]`, each with `video` (the library row or `null`), `verdict`, and `covers: [{ id, title, channel, durationSeconds, gone }]`.
  - Legacy sets keep today's response.

- [x] **Step 1: Write failing tests:**
  - `a youtube pick not in the library posts; a saved pick not in the library is 400 naming it`.
  - `unknown, done or dismissed covers are dropped with a warning, not a 400`: `warnings` contains the id, and the stored payload no longer lists it.
  - `current joins saved picks and covers; a cover removed after posting comes back gone: true`. Seed it, post it, call `POST /api/videos/:id/dismiss` on one cover, then assert `gone`.
  - `worth on a youtube pick saves the verdict and marks nothing done`: `marked === 0`, and no `youtube_removals` row.
  - `worth on a saved goal pick marks done like today`.
  - `history flattens goal sets, youtube picks included`.
- [x] **Step 2:** Run `npx vitest run tests/picks-api.test.js`. Expected: the new tests FAIL and the old ones PASS.
- [x] **Step 3: Implement.**
  - `POST`: run the library check on `savedPickIds(set)` plus the legacy picks and closeButNo ids. Then filter `coverIds` with `db.videosByIds`, keeping only `status === 'scanned'`. Rewrite each pick's `covers` and collect `warnings` before calling `upsertPickSet`.
  - `current`: one `videosByIds` call over `pickIds` plus `coverIds`. A cover gets `gone` when its row is missing or not `scanned`.
  - Verdict route: find the pick with `allPicks(set.payload)`, and mark done only when `source === "saved"`.
  - `pickHistory`: use `allPicks(s.payload)`.
- [x] **Step 4:** Run `npm test`. Expected: PASS.
- [x] **Step 5:** Commit `feat(picks): API stores and serves goal picks with covers`.

### Task 3: Bulk remove and restore

**Files:**
- Modify: `server/db.js`, `server/app.js`, `web/src/api.js`
- Test: `tests/bulk-remove.test.js` (new; copy the setup pattern from `tests/picks-api.test.js`)

**Interfaces:**
- Produces:
  - `db.dismissMany(userId, ids: string[]) -> Promise<string[]>`. It updates only `status = 'scanned'` rows, with the same override columns as `dismiss`, and returns the changed ids.
  - `db.restoreDismissed(userId, ids) -> Promise<{ restored: string[], alreadyOffYoutube: string[] }>`. It sets `dismissed` back to `scanned`, deletes `youtube_removals` rows in `pending` or `failed` state for those ids, and reports ids whose removal row is `removed`.
  - `POST /api/videos/dismiss { ids }` returns `{ ok, removed: string[] }`. When `removalAllowed`, it also enqueues removals with reason `dismissed`.
  - `POST /api/videos/restore { ids }` returns `{ ok, restored, alreadyOffYoutube }`.
  - Both endpoints return 400 when `ids` is missing or empty, and slice to 500.
  - `api.dismissVideos(ids)` and `api.restoreVideos(ids)` in `web/src/api.js`.

- [x] **Step 1: Write failing tests:**
  - `bulk dismiss changes only scanned rows and returns them`: send one done video and one unknown id, and expect both to be absent from `removed`.
  - `bulk dismiss queues YouTube removals only when allowed`: run with and without the `imports` token.
  - `a second identical call returns removed: []`.
  - `restore brings rows back, cancels pending removals and reports removed ones`. Set one queue row to `state='removed'` with SQL, then assert `alreadyOffYoutube` holds that id, the pending row is gone, and the status is `scanned`.
  - `both routes need auth and ids`.
- [x] **Step 2:** Run `npx vitest run tests/bulk-remove.test.js`. Expected: FAIL.
- [x] **Step 3:** Implement. Register both routes before any `/api/videos/:id` POST route that could shadow them, next to `/api/videos/done`.
- [x] **Step 4:** Run `npm test`. Expected: PASS.
- [x] **Step 5:** Commit `feat(api): bulk dismiss and restore for Remove all and Undo`.

### Task 4: This week, layout A

**Files:**
- Modify: `web/src/components/ThisWeek.jsx`, `web/src/styles.css` (new `.goal*` and `.covers*` rules, existing tokens only), `web/src/phone/*` only if the phone This week tab renders its own markup (check first)
- Test: `tests/this-week.test.js` (append)

**Interfaces:**
- Consumes: the Task 2 `current` shape, and the Task 3 `api.dismissVideos` and `api.restoreVideos`.
- Produces:
  - `ThisWeekView` renders goal sets as below. Legacy sets render exactly as today.
  - Pure helpers, exported for tests:
    - `removableCovers(pick, leftOut: Set<string>) -> string[]`, which skips `gone` covers and left-out ids.
    - `applyRemoved(set, ids) -> set`, which marks those covers `gone: true` in every pick.

**Layout** (the mockup Joon chose was option A):
- Eyebrow, the title `This week`, and the notice.
- One `<section class="goal">` per goal. It holds `name` in the display font, `need` small and muted, a right-aligned count (`2 picks`, `1 pick`, `0 picks`), then the cards, or the `empty` line when there are no picks.
- Card content follows the spec's Pick card list: a source pill, the author line, the action line, and `Picked without reading the transcript` when `noTranscript`.
- A saved pick keeps the category dot. A YouTube pick has none.
- Verdict buttons stay as they are today.
- Covers block under the card when `covers.length > 0`:
  - `<details>`, open when 1 to 5 covers are not gone.
  - Each row shows the title as a button that calls `onOpenVideo(id)`, and a `Leave it` toggle with `aria-pressed`.
  - Gone rows are struck through with no toggle.
  - The `Remove all ${n}` button is hidden when `n === 0`.
- After Remove all, the block shows the removed line and an `Undo` button for 10 seconds. Undo calls `restoreVideos` and shows the back-in-Laterlist toast.
- The `ThisWeek` container calls `onLibraryChanged()` after a remove or an undo.
- Remove all marks as gone only the ids the server returned in `removed`. Rows it skipped stay unstruck, so Joon can retry them.
- `Close, but no` stays a single collapsed block as today, with each row tagged with its `goal` in a mono pill.
- Phone at 640 px or narrower: covers start collapsed, and Remove all is full width with `min-height: 44px`.

- [x] **Step 1: Write failing tests:**
  - `renders goal sections, counts, empty goal text and source pills`.
  - `a youtube pick has no category dot; a saved pick does`.
  - `covers: open at 1 to 5, collapsed above 5, gone rows struck, Remove all count excludes gone`.
  - `removableCovers skips left-out and gone ids`.
  - `applyRemoved marks the ids gone in every pick`.
  - `legacy flat sets still render three cards`, which is the existing first test with no changes.
  - `hostile goal names and cover titles render as text`.
- [x] **Step 2:** Run `npx vitest run tests/this-week.test.js`. Expected: FAIL.
- [x] **Step 3:** Implement. Keep the legacy branch as it is, and add a `GoalSection` and a `CoversBlock` component in the same file.
- [x] **Step 4:** Run `npm test` and `npm run build:web`. Expected: PASS, and the build succeeds.
- [ ] **Step 5: Verify in dev.**
  1. Start dev with `DEV_FAKE_AUTH=1 FAKE_LLM=1 npm start`.
  2. Seed 8 videos, create a picks key, and POST `fixtures/goal-picks.sample.json` (create it). It needs 2 goals: one with a youtube pick covering 6 seeded ids and a saved pick, and one empty goal.
  3. Open `/app` and check each of these:
     - Layout A shows.
     - `Leave it` lowers the count.
     - Remove all removes the videos from the Library rows.
     - Undo brings them back.
     - Verdicts persist after a reload.
     - There are no console errors.
     - A 375 px window has no horizontal scroll.
- [x] **Step 6:** Commit `feat(web): This week grouped by goal with covers and Remove all`.

### Task 5: CLI search, budget, and goal rendering

**Files:**
- Modify: `scripts/watch-picks/subs.mjs`, `scripts/watch-picks.mjs`, `scripts/watch-picks/render.mjs`
- Test: `tests/watch-picks-subs.test.js`, `tests/watch-picks-cli.test.js`, `tests/watch-picks-render.test.js`

**Interfaces:**
- Produces:
  - `FETCH_BUDGET = 24`.
  - `searchArgs(query: string, limit = 10) -> string[]` returns `["--ignore-config", "--flat-playlist", "-J", "--", \`ytsearch${n}:${q}\`]`.
    - `n` is clamped between 1 and 20.
    - `q` is trimmed, whitespace collapsed, and cut to 120 characters.
    - An empty `q` throws.
  - `parseSearch(json: string) -> [{ id, title, channel, durationSeconds, views, uploadDate }]`.
    - It reads `entries` and keeps `ID_RE` ids.
    - It drops durations under 180 or over 7200, and also unknown durations.
  - The CLI `search "<query>" [--limit N]`:
    - It writes `WORK/search-<k>.json`, where `k` is the next free number, and prints one TSV line per result plus `saved: <path>`.
    - On a yt-dlp failure it prints `search failed: <last stderr line>` and exits 1.
    - Searches do not count toward `FETCH_BUDGET`.
  - `renderHtml` and `renderMarkdown` render goal sets grouped by goal: name, need, then per pick the title link, source, author, why, action, and `Covers: <n> saved videos`.
  - `parsePicksNote` returns every pick across goals, so `pastPicks` keeps working.
  - The `post` output line reads `posted: yes (<n> picks across <g> goals for <week>)` for goal sets.

- [x] **Step 1: Write failing tests:**
  - `searchArgs keeps a hostile query inside one argument after --`: the query `--exec rm -rf ~` gives a last argument that starts with `ytsearch10:--exec`, and no other argument equals `--exec`.
  - `searchArgs clamps limit and rejects empty`.
  - `parseSearch drops shorts, over 2h and unknown durations`.
  - `budget is 24`.
  - `cli search writes search-1.json then search-2.json`, using the existing fake `runYtDlp` injection pattern with a canned stdout. Extend `runYtDlp` to resolve `stdout` too.
  - `render groups goal sets by goal and round-trips through parsePicksNote`.
  - `post prints picks across goals for a goal set`.
- [x] **Step 2:** Run `npx vitest run tests/watch-picks-subs.test.js tests/watch-picks-cli.test.js tests/watch-picks-render.test.js`. Expected: FAIL.
- [x] **Step 3:** Implement. Add `search` to `USAGE`.
- [x] **Step 4:** Run `npm test`. Expected: PASS.
- [x] **Step 5:** Commit `feat(watch-picks): search subcommand, budget 24, goal rendering`.

### Task 6 (Claude, after Codex): skill, runtime, review

Not for Codex.
- [ ] Review the whole branch diff against the spec and this plan. Run `/codex review` on any part Claude wrote.
- [ ] Rewrite `~/.claude/skills/watch-picks/SKILL.md`. Steps 1 to 6 follow the spec: goals from `~/projects/personal-agent/state/week.json` (only when `week_start` is this Monday) and the ladder, search plus list per goal, 5 checks, covers, and the new picks.json shape. Delete the "Exactly 3 picks" rule. The allowlist stays the single `node .../watch-picks.mjs` entry plus `open`.
- [ ] Open a PR, merge it after Joon's OK, then run `git -C ~/projects/laterlist-runtime fetch` and `git -C ~/projects/laterlist-runtime checkout --detach origin/main`.
- [ ] Run the `watch-picks` scheduled task once by hand, and confirm This week shows goal sections in production.

## Verification

```bash
npm test
npm run build:web
DEV_FAKE_AUTH=1 FAKE_LLM=1 npm start
```

## Definition of Done

- [x] `npm test` is green and `npm run build:web` succeeds.
- [ ] Task 4 Step 5 dev checks all pass, with no console errors and no sideways scroll at 375 px.
- [x] A legacy week (flat payload) still renders on This week and in `past`.
- [ ] Task 6 is done. One manual production run posts goal picks.

## Deviations

- The worktree has no root `AGENTS.md`, so the supplied AGENTS.md instructions and this plan governed the work.
- The plan's `superpowers` execution skills are unavailable in this session. The available `pstack:poteto-mode` workflow was read, and the plan's test-first sequence was followed directly.
- Task 4 Step 5 completed the local server, eight-video seed, picks token, and sample POST. The browser checks were skipped under the user's stated exception: the in-app browser was unavailable and Chrome control timed out. `npm run build:web` succeeded. Console errors and 375 px scroll were not checked in a browser.
