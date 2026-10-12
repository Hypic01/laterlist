# Picks Home (This week inside Laterlist) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Laterlist opens on a This week screen showing the 3 picks the Monday Mac run sent, with verdict buttons that feed the next run.

**Architecture:** Two new tables (`pick_sets`, `pick_verdicts`) and four routes (`POST /api/picks`, `GET /api/picks/current`, `POST /api/picks/:week/verdict`, `GET /api/picks/history`). The picks validator moves to `server/picks.js` and the Mac CLI imports it. The CLI gains `post` (send to Laterlist, fall back to the local page) and reads history from the API. The web app gets a `ThisWeek` screen as the default view on desktop and phone, with the existing board renamed Library.

**Tech Stack:** Node 22 ESM, Express, PGlite + vitest + supertest, React 18 (Vite), static-markup component tests (`react-dom/server`).

**Spec:** `docs/superpowers/specs/2026-10-12-picks-in-laterlist-design.md` (read it first). Parent spec: `docs/superpowers/specs/2026-10-11-weekly-watch-picks-design.md`.

**Who does what:**

| Task | Owner | Model |
|---|---|---|
| 0. Rebase on the private-no-pricing merge | Claude | none |
| 1. Server: tables, validator, routes | Codex (no network) | GPT-6 Sol medium |
| 2. Mac CLI: post and API history | Codex (no network) | GPT-6 Sol medium |
| 3. Web: This week screen, tabs, picks key | Claude, with `ui-ux-pro-max` + `kole-jain` | Opus 5.5 high |
| 4. Phone: This week tab | Claude | Opus 5.5 high |
| 5. Ship: migration, deploy, key, skill, live run | Claude, Joon creates the key | Opus 5.5 medium |

**Working directory:** `/Users/joonwoopark/projects/laterlist-picks-home` (branch `feat/picks-home`). Never touch `/Users/joonwoopark/projects/laterlist` (Joon's main checkout).

## Global Constraints

- Laterlist is private and single-user (the private-no-pricing change is merged first). No plan, quota or pricing logic anywhere.
- Picks validation lives only in `server/picks.js`; `scripts/watch-picks/render.mjs` re-exports it. Same rules as today plus: every pick and close-but-no id must exist in the user's library.
- `POST /api/picks` and `GET /api/picks/history` accept a JWT or an `X-Import-Token` with scope `picks` (`auth.jwtOrToken("picks")`). `GET /api/picks/current` and the verdict route are JWT only (`auth.required`).
- Verdicts are exactly `worth`, `not`, `skipped`. `worth` and `not` mark the video done exactly like `POST /api/videos/done` (same `db.markDoneIds` + `db.enqueueYoutubeRemovals` when `removalAllowed`). `skipped` touches nothing else.
- Same week posted again: payload replaced, verdicts kept.
- New tables: `ENABLE ROW LEVEL SECURITY`, additive migration `010-picks` only.
- CLI: `post` never exits non-zero for a delivery failure (it falls back to the local page and prints `posted: no (...)` and `open: <path>`); exit 2 only for an invalid picks.json or missing `.env.picks`. `.env.picks` gains `PICKS_API_TOKEN` and optional `PICKS_APP_URL` (default `https://laterlist-app.vercel.app`). Never print the token.
- UI: tokens from `docs/design-system.md` / `web/src/styles.css` only; monochrome; color only on category dots (`--cat-learn`, `--cat-watch`). No new hex, px font sizes or fonts outside existing patterns. No em or en dashes in copy. Tap targets at least 44px on phone.
- `npm test` green before each commit (Codex: the known sandbox `listen EPERM` failures in untouched route tests are allowed; report the count). Never weaken a test.

## Review Focus

1. **The Mac posts a pick whose video was removed from the library since the list was made.** 400 naming the id; the CLI falls back to the local page and says why. (Task 1 `rejects unknown ids`, Task 2 `post failure falls back`)
2. **Joon taps Worth it twice, or changes Worth it to Didn't watch.** One verdict row, latest wins, the video stays done (no un-done). (Task 1 `verdicts upsert`)
3. **Two runs in one week** (Monday run plus a manual rerun). One `pick_sets` row with the new payload; verdicts for videos still in the set stay. (Task 1 `same week replaces`)
4. **Picks older than this week's Monday** (Mac was asleep). The screen shows them under "These are last week's picks." instead of pretending they are fresh. (Task 3 `stale` test)
5. **Titles with `<`, `&`, quotes or Korean.** Rendered as text by React; the vault note still parses. (Task 3 hostile title test; Task 2 note round-trip)

---

### Task 0: Rebase (Claude)

- [ ] After the private-no-pricing PR merges: `git -C /Users/joonwoopark/projects/laterlist-picks-home fetch origin && git -C /Users/joonwoopark/projects/laterlist-picks-home rebase origin/main`, then `npm install && npm test` in the worktree (expect all green).

---

### Task 1: Server (Codex)

**Files:**
- Create: `server/picks.js`, `tests/picks-api.test.js`
- Modify: `server/migrations.js`, `server/db.js`, `server/app.js`, `scripts/watch-picks/render.mjs`

**Interfaces:**
- Produces: `server/picks.js` exports `PicksDataError`, `validatePicks(data)` (moved verbatim from `render.mjs`), `VERDICTS = ["worth","not","skipped"]`, `pickIds(set)`.
- `db` gains `libraryHas(userId, ids) -> Set`, `videosByIds(userId, ids) -> { [id]: {title, channel, duration_seconds, category, status} }`, `upsertPickSet(userId, week, payload)`, `latestPickSet(userId) -> { week, payload, updated_at } | null`, `pickVerdicts(userId, week) -> { [videoId]: verdict }`, `setPickVerdict(userId, week, videoId, verdict)`, `pickHistory(userId, weeks) -> [{ week, id, title, verdict }]` (newest week first, the N most recent sets).

- [ ] **Step 1: Write the failing tests.** Create `tests/picks-api.test.js`:

```js
import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { testDb } from "./helpers.js";
import { createApp } from "../server/app.js";
import { createAuth, fakeVerifier, hashToken } from "../server/auth.js";
import { createImporter } from "../server/importer.js";
import { loadConfig } from "../server/config.js";

let db, pg, app;
const EMAIL = "joon@test.dev";
const asJoon = (r) => r.set("Authorization", `Bearer dev:${EMAIL}`);
const vid = (n) => `vid${String(n).padStart(8, "0")}`;

function build() {
  const config = loadConfig({ YOUTUBE_REMOVAL: "all" });
  const auth = createAuth({ verify: fakeVerifier(), db });
  app = createApp({ db, auth, importer: createImporter({ db, config }), config });
}

async function joonId() {
  const res = await asJoon(request(app).get("/api/me")).expect(200);
  return res.body.id;
}

async function seed(userId, n) {
  for (let i = 1; i <= n; i++) {
    await pg.query(
      `INSERT INTO videos (user_id, video_id, title, channel, duration_seconds, category, status)
       VALUES ($1, $2, $3, 'Chan', 600, 'learn', 'scanned')`,
      [userId, vid(i), `Video ${i}`]
    );
  }
}

async function tokens(userId) {
  await db.createApiToken(userId, { tokenHash: hashToken("wll_picks"), scope: "picks", label: "Mac picks" });
  await db.createApiToken(userId, { tokenHash: hashToken("wll_imports"), scope: "imports", label: "Extension" });
}

const setFor = (week, ids, over = {}) => ({
  week,
  focus: "Portfolio",
  focusPoints: ["Case studies"],
  picks: ids.slice(0, 3).map((n) => ({
    id: vid(n), title: `Video ${n}`, channel: "Chan", durationSeconds: 600, row: "learn",
    why: `Why ${n}`, start: 60, end: 600, gets: ["A thing"],
  })),
  closeButNo: ids.slice(3).map((n) => ({ id: vid(n), title: `Video ${n}`, reason: "Repeat" })),
  ...over,
});

const postAsMac = (body, token = "wll_picks") =>
  request(app).post("/api/picks").set("X-Import-Token", token).send(body);

let uid;
beforeEach(async () => {
  ({ db, pg } = await testDb());
  build();
  uid = await joonId();
  await seed(uid, 8);
  await tokens(uid);
});

describe("picks routes", () => {
  it("every picks route needs auth", async () => {
    await request(app).post("/api/picks").send({}).expect(401);
    await request(app).get("/api/picks/current").expect(401);
    await request(app).post("/api/picks/2026-10-12/verdict").send({}).expect(401);
    await request(app).get("/api/picks/history").expect(401);
  });

  it("a picks key can post; an imports key cannot", async () => {
    const ok = await postAsMac(setFor("2026-10-12", [1, 2, 3, 4])).expect(200);
    expect(ok.body).toEqual({ week: "2026-10-12", picks: 3 });
    await postAsMac(setFor("2026-10-12", [1, 2, 3]), "wll_imports").expect(401);
  });

  it("rejects unknown ids, bad payloads and error-only sets", async () => {
    const unknown = await postAsMac(setFor("2026-10-12", [1, 2, 99])).expect(400);
    expect(unknown.body.error).toMatch(/vid00000099/);
    await postAsMac(setFor("2026-10-12", [1, 2, 3], { focus: "" })).expect(400);
    await postAsMac({ week: "2026-10-12", error: "db down" }).expect(400);
  });

  it("same week replaces the payload and keeps verdicts", async () => {
    await postAsMac(setFor("2026-10-12", [1, 2, 3])).expect(200);
    await asJoon(request(app).post("/api/picks/2026-10-12/verdict")).send({ videoId: vid(1), verdict: "skipped" }).expect(200);
    await postAsMac(setFor("2026-10-12", [1, 2, 3], { focus: "New focus" })).expect(200);
    const { rows } = await pg.query("SELECT count(*)::int AS n FROM pick_sets WHERE user_id = $1", [uid]);
    expect(rows[0].n).toBe(1);
    const cur = await asJoon(request(app).get("/api/picks/current")).expect(200);
    expect(cur.body.set.focus).toBe("New focus");
    expect(cur.body.set.picks[0].verdict).toBe("skipped");
  });

  it("current is null with no sets", async () => {
    const cur = await asJoon(request(app).get("/api/picks/current")).expect(200);
    expect(cur.body).toEqual({ set: null });
  });

  it("current returns the latest week with videos, verdicts and library flags", async () => {
    await postAsMac(setFor("2026-10-05", [5, 6, 7])).expect(200);
    await postAsMac(setFor("2026-10-12", [1, 2, 3, 4])).expect(200);
    const { body } = await asJoon(request(app).get("/api/picks/current")).expect(200);
    expect(body.set.week).toBe("2026-10-12");
    expect(body.set.picks).toHaveLength(3);
    expect(body.set.picks[0]).toMatchObject({ id: vid(1), why: "Why 1", verdict: null });
    expect(body.set.picks[0].video).toMatchObject({ title: "Video 1", status: "scanned" });
    expect(body.set.closeButNo[0]).toMatchObject({ id: vid(4), reason: "Repeat", inLibrary: true });
  });

  it("worth marks the video done and queues the YouTube removal", async () => {
    await postAsMac(setFor("2026-10-12", [1, 2, 3])).expect(200);
    const r = await asJoon(request(app).post("/api/picks/2026-10-12/verdict")).send({ videoId: vid(1), verdict: "worth" }).expect(200);
    expect(r.body).toEqual({ ok: true, marked: 1 });
    const v = await pg.query("SELECT status FROM videos WHERE user_id = $1 AND video_id = $2", [uid, vid(1)]);
    expect(v.rows[0].status).toBe("done");
    const q = await pg.query("SELECT count(*)::int AS n FROM youtube_removals WHERE user_id = $1 AND video_id = $2", [uid, vid(1)]);
    expect(q.rows[0].n).toBe(1);
  });

  it("not also marks done; skipped records the verdict only", async () => {
    await postAsMac(setFor("2026-10-12", [1, 2, 3])).expect(200);
    await asJoon(request(app).post("/api/picks/2026-10-12/verdict")).send({ videoId: vid(2), verdict: "not" }).expect(200);
    const s = await asJoon(request(app).post("/api/picks/2026-10-12/verdict")).send({ videoId: vid(3), verdict: "skipped" }).expect(200);
    expect(s.body).toEqual({ ok: true, marked: 0 });
    const { rows } = await pg.query("SELECT video_id, status FROM videos WHERE user_id = $1 AND video_id = ANY($2) ORDER BY video_id", [uid, [vid(2), vid(3)]]);
    expect(rows.map((r) => r.status)).toEqual(["done", "scanned"]);
  });

  it("verdicts upsert: latest wins and a done video stays done", async () => {
    await postAsMac(setFor("2026-10-12", [1, 2, 3])).expect(200);
    await asJoon(request(app).post("/api/picks/2026-10-12/verdict")).send({ videoId: vid(1), verdict: "worth" }).expect(200);
    await asJoon(request(app).post("/api/picks/2026-10-12/verdict")).send({ videoId: vid(1), verdict: "worth" }).expect(200);
    await asJoon(request(app).post("/api/picks/2026-10-12/verdict")).send({ videoId: vid(1), verdict: "skipped" }).expect(200);
    const { rows } = await pg.query("SELECT verdict FROM pick_verdicts WHERE user_id = $1", [uid]);
    expect(rows).toEqual([{ verdict: "skipped" }]);
    const v = await pg.query("SELECT status FROM videos WHERE user_id = $1 AND video_id = $2", [uid, vid(1)]);
    expect(v.rows[0].status).toBe("done");
  });

  it("validates verdict input", async () => {
    await asJoon(request(app).post("/api/picks/2026-10-12/verdict")).send({ videoId: vid(1), verdict: "meh" }).expect(400);
    await asJoon(request(app).post("/api/picks/not-a-week/verdict")).send({ videoId: vid(1), verdict: "worth" }).expect(400);
    await asJoon(request(app).post("/api/picks/2026-10-12/verdict")).send({ videoId: "bad", verdict: "worth" }).expect(400);
  });

  it("history lists the most recent sets with verdicts, newest first", async () => {
    await postAsMac(setFor("2026-10-05", [5, 6, 7])).expect(200);
    await postAsMac(setFor("2026-10-12", [1, 2, 3])).expect(200);
    await asJoon(request(app).post("/api/picks/2026-10-12/verdict")).send({ videoId: vid(1), verdict: "worth" }).expect(200);
    const all = await request(app).get("/api/picks/history?weeks=8").set("X-Import-Token", "wll_picks").expect(200);
    expect(all.body).toHaveLength(6);
    expect(all.body[0]).toEqual({ week: "2026-10-12", id: vid(1), title: "Video 1", verdict: "worth" });
    expect(all.body[5]).toEqual({ week: "2026-10-05", id: vid(7), title: "Video 7", verdict: null });
    const one = await request(app).get("/api/picks/history?weeks=1").set("X-Import-Token", "wll_picks").expect(200);
    expect(one.body).toHaveLength(3);
  });

  it("the tokens route accepts the picks scope", async () => {
    const r = await asJoon(request(app).post("/api/tokens")).send({ scope: "picks", label: "Mac picks" }).expect(200);
    expect(r.body.token).toMatch(/^wll_/);
    expect(r.body.scope).toBe("picks");
  });

  it("both new tables have row level security on", async () => {
    const { rows } = await pg.query(
      "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('pick_sets', 'pick_verdicts') ORDER BY relname"
    );
    expect(rows).toEqual([
      { relname: "pick_sets", relrowsecurity: true },
      { relname: "pick_verdicts", relrowsecurity: true },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run tests/picks-api.test.js` → FAIL (404s / missing tables).

- [ ] **Step 3: Migration.** Append to `MIGRATIONS` in `server/migrations.js`:

```js
  {
    id: "010-picks",
    sql: `
      CREATE TABLE IF NOT EXISTS pick_sets (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        week date NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, week)
      );
      CREATE TABLE IF NOT EXISTS pick_verdicts (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        week date NOT NULL,
        video_id text NOT NULL,
        verdict text NOT NULL CHECK (verdict IN ('worth', 'not', 'skipped')),
        decided_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, week, video_id)
      );
      ALTER TABLE pick_sets ENABLE ROW LEVEL SECURITY;
      ALTER TABLE pick_verdicts ENABLE ROW LEVEL SECURITY;
    `,
  },
```

- [ ] **Step 4: Validator.** Create `server/picks.js`: move `PicksDataError` and `validatePicks` (with its helpers `ID_RE`, `str`, `int`) verbatim from `scripts/watch-picks/render.mjs`, plus:

```js
export const VERDICTS = ["worth", "not", "skipped"];

export function pickIds(set) {
  return [...set.picks.map((p) => p.id), ...set.closeButNo.map((c) => c.id)];
}
```

In `scripts/watch-picks/render.mjs`, delete the moved code and add `export { PicksDataError, validatePicks } from "../../server/picks.js";`. Remove helpers that become unused there. `tests/watch-picks-render.test.js` must pass unchanged.

- [ ] **Step 5: DB methods.** Add to the object returned by `createDb` in `server/db.js`:

```js
    // ---- weekly picks (2026-10-12) ----
    async libraryHas(userId, ids) {
      const { rows } = await q.query(
        "SELECT video_id FROM videos WHERE user_id = $1 AND video_id = ANY($2::text[])",
        [userId, ids]
      );
      return new Set(rows.map((r) => r.video_id));
    },

    async videosByIds(userId, ids) {
      const { rows } = await q.query(
        `SELECT video_id, title, channel, duration_seconds, category, status
           FROM videos WHERE user_id = $1 AND video_id = ANY($2::text[])`,
        [userId, ids]
      );
      return Object.fromEntries(rows.map(({ video_id, ...v }) => [video_id, v]));
    },

    async upsertPickSet(userId, week, payload) {
      await q.query(
        `INSERT INTO pick_sets (user_id, week, payload) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, week) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [userId, week, JSON.stringify(payload)]
      );
    },

    async latestPickSet(userId) {
      const { rows } = await q.query(
        `SELECT to_char(week, 'YYYY-MM-DD') AS week, payload, updated_at
           FROM pick_sets WHERE user_id = $1 ORDER BY week DESC LIMIT 1`,
        [userId]
      );
      return rows[0] || null;
    },

    async pickVerdicts(userId, week) {
      const { rows } = await q.query(
        "SELECT video_id, verdict FROM pick_verdicts WHERE user_id = $1 AND week = $2",
        [userId, week]
      );
      return Object.fromEntries(rows.map((r) => [r.video_id, r.verdict]));
    },

    async setPickVerdict(userId, week, videoId, verdict) {
      await q.query(
        `INSERT INTO pick_verdicts (user_id, week, video_id, verdict) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, week, video_id) DO UPDATE SET verdict = EXCLUDED.verdict, decided_at = now()`,
        [userId, week, videoId, verdict]
      );
    },

    async pickHistory(userId, weeks) {
      const { rows: sets } = await q.query(
        `SELECT to_char(week, 'YYYY-MM-DD') AS week, payload
           FROM pick_sets WHERE user_id = $1 ORDER BY week DESC LIMIT $2`,
        [userId, weeks]
      );
      const { rows: verdicts } = await q.query(
        "SELECT to_char(week, 'YYYY-MM-DD') AS week, video_id, verdict FROM pick_verdicts WHERE user_id = $1",
        [userId]
      );
      const byKey = new Map(verdicts.map((v) => [`${v.week}|${v.video_id}`, v.verdict]));
      return sets.flatMap((s) => (s.payload.picks || []).map((p) => ({
        week: s.week, id: p.id, title: p.title, verdict: byKey.get(`${s.week}|${p.id}`) || null,
      })));
    },
```

- [ ] **Step 6: Routes.** In `server/app.js`: import `{ PicksDataError, validatePicks, VERDICTS, pickIds }` from `./picks.js`; change the token scope list to `["imports", "bridge", "picks"]`; then add, after the `/api/videos/done` route:

```js
  // ---- weekly picks: the Mac run posts, the app shows (2026-10-12) ----
  app.post("/api/picks", auth.jwtOrToken("picks"), async (req, res) => {
    let set;
    try {
      set = validatePicks(req.body);
    } catch (e) {
      if (e instanceof PicksDataError) return res.status(400).json({ error: e.message });
      throw e;
    }
    if (set.error) return res.status(400).json({ error: "an error-only picks set is not stored" });
    const ids = pickIds(set);
    const have = await db.libraryHas(req.user.id, ids);
    const unknown = ids.find((id) => !have.has(id));
    if (unknown) return res.status(400).json({ error: `video ${unknown} is not in your library` });
    await db.upsertPickSet(req.user.id, set.week, set);
    res.json({ week: set.week, picks: set.picks.length });
  });

  app.get("/api/picks/current", auth.required, async (req, res) => {
    const row = await db.latestPickSet(req.user.id);
    if (!row) return res.json({ set: null });
    const p = row.payload;
    const [videos, verdicts] = await Promise.all([
      db.videosByIds(req.user.id, pickIds(p)),
      db.pickVerdicts(req.user.id, row.week),
    ]);
    res.json({
      set: {
        ...p,
        week: row.week,
        updatedAt: row.updated_at,
        picks: p.picks.map((x) => ({ ...x, video: videos[x.id] || null, verdict: verdicts[x.id] || null })),
        closeButNo: p.closeButNo.map((x) => ({ ...x, inLibrary: Boolean(videos[x.id]) })),
      },
    });
  });

  app.post("/api/picks/:week/verdict", auth.required, async (req, res) => {
    const { week } = req.params;
    const { videoId, verdict } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return res.status(400).json({ error: "bad week" });
    if (!VERDICTS.includes(verdict)) return res.status(400).json({ error: "verdict must be worth, not or skipped" });
    if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ""))) return res.status(400).json({ error: "bad video id" });
    await db.setPickVerdict(req.user.id, week, videoId, verdict);
    let marked = 0;
    if (verdict !== "skipped") {
      const moved = await db.markDoneIds(req.user.id, [videoId]);
      marked = moved.length;
      if (moved.length && removalAllowed(req.user)) {
        await db.enqueueYoutubeRemovals(req.user.id, moved, "done");
      }
    }
    res.json({ ok: true, marked });
  });

  app.get("/api/picks/history", auth.jwtOrToken("picks"), async (req, res) => {
    const weeks = Math.min(52, Math.max(1, Number(req.query.weeks) || 8));
    res.json(await db.pickHistory(req.user.id, weeks));
  });
```

- [ ] **Step 7: Run.** `npx vitest run tests/picks-api.test.js tests/watch-picks-render.test.js` → PASS. Then `npm test`.
- [ ] **Step 8: Commit.** `git add server/picks.js server/migrations.js server/db.js server/app.js scripts/watch-picks/render.mjs tests/picks-api.test.js && git commit -m "feat(picks): store weekly picks and verdicts, picks-scoped API"`

---

### Task 2: Mac CLI (Codex)

**Files:**
- Create: `scripts/watch-picks/api.mjs`
- Modify: `scripts/watch-picks/db.mjs`, `scripts/watch-picks/render.mjs`, `scripts/watch-picks.mjs`, `tests/watch-picks-cli.test.js`, `tests/watch-picks-render.test.js`, `tests/watch-picks-db.test.js`

**Interfaces:**
- `loadPicksEnv(envPath)` additionally returns `apiToken` (`PICKS_API_TOKEN`, default `""`) and `appUrl` (`PICKS_APP_URL` without trailing slash, default `https://laterlist-app.vercel.app`).
- `api.mjs` exports `PicksApiError`, `postPicks({ appUrl, apiToken, data, fetchImpl })`, `fetchHistory({ appUrl, apiToken, weeks, fetchImpl })`.
- `renderMarkdown(data, { posted = false } = {})`: when `posted`, each verdict line is `Verdict: tap it in Laterlist`. `parsePicksNote` treats that line as `verdict: null`.
- `main` deps gain `fetchImpl` (default `globalThis.fetch`).

- [ ] **Step 1: Write the failing tests.**

In `tests/watch-picks-db.test.js` add:

```js
  it("reads the optional API token and app URL", () => {
    const file = tmpFile("PICKS_DATABASE_URL=postgresql://r:p@h:6543/postgres\nPICKS_EMAIL=me@test.dev\nPICKS_API_TOKEN=wll_k\nPICKS_APP_URL=https://laterlist.test/\n");
    expect(loadPicksEnv(file)).toMatchObject({ apiToken: "wll_k", appUrl: "https://laterlist.test" });
    const bare = tmpFile("PICKS_DATABASE_URL=postgresql://r:p@h:6543/postgres\nPICKS_EMAIL=me@test.dev\n");
    expect(loadPicksEnv(bare)).toMatchObject({ apiToken: "", appUrl: "https://laterlist-app.vercel.app" });
  });
```

In `tests/watch-picks-render.test.js` add:

```js
describe("posted note", () => {
  it("says to tap the verdict in Laterlist and parses it as unfilled", () => {
    const md = renderMarkdown(validatePicks(base()), { posted: true });
    expect(md).toContain("Verdict: tap it in Laterlist");
    expect(md).not.toContain("worth it | not | skipped");
    expect(parsePicksNote(md).picks[0].verdict).toBe(null);
  });
});
```

In `tests/watch-picks-cli.test.js`, add a helper and tests (inside the existing `describe`):

```js
  function withApi(responses) {
    const calls = [];
    fs.writeFileSync(deps.envPath,
      "PICKS_DATABASE_URL=postgresql://r:pw@localhost:5432/db\nPICKS_EMAIL=u1@test.dev\nPICKS_API_TOKEN=wll_k\nPICKS_APP_URL=https://laterlist.test\n");
    deps.fetchImpl = async (url, opts = {}) => {
      calls.push({ url, opts });
      const r = responses.shift() || { status: 200, body: {} };
      return { ok: r.status < 400, status: r.status, json: async () => r.body };
    };
    return calls;
  }

  const picksJson = () => {
    const json = path.join(root, "picks.json");
    fs.writeFileSync(json, JSON.stringify({
      week: "2026-10-12", focus: "Case studies", focusPoints: [],
      picks: [{ id: vid(1), title: "One", row: "learn", why: "Because", gets: [] }], closeButNo: [],
    }));
    return json;
  };

  it("post sends the picks to Laterlist and archives a note", async () => {
    const calls = withApi([{ status: 200, body: { week: "2026-10-12", picks: 1 } }]);
    expect(await main(["post", picksJson()], deps)).toBe(0);
    expect(calls[0].url).toBe("https://laterlist.test/api/picks");
    expect(calls[0].opts.method).toBe("POST");
    expect(calls[0].opts.headers["x-import-token"]).toBe("wll_k");
    expect(JSON.parse(calls[0].opts.body).week).toBe("2026-10-12");
    expect(out).toContain("posted: yes (1 picks for 2026-10-12)");
    expect(out).toContain("open: https://laterlist.test/app");
    const md = fs.readFileSync(path.join(deps.picksDir, "2026-10-12.md"), "utf8");
    expect(md).toContain("Verdict: tap it in Laterlist");
    expect(fs.existsSync(path.join(deps.picksDir, "2026-10-12.html"))).toBe(false);
    expect(out.join("\n")).not.toContain("wll_k");
  });

  it("post failure falls back to the local page and says why", async () => {
    withApi([{ status: 401, body: { error: "invalid import token" } }]);
    expect(await main(["post", picksJson()], deps)).toBe(0);
    expect(out).toContain("posted: no (Laterlist said 401: invalid import token)");
    const html = path.join(deps.picksDir, "2026-10-12.html");
    expect(fs.existsSync(html)).toBe(true);
    expect(out).toContain(`open: ${html}`);
  });

  it("post without a token falls back without calling the network", async () => {
    let called = false;
    deps.fetchImpl = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
    expect(await main(["post", picksJson()], deps)).toBe(0);
    expect(called).toBe(false);
    expect(out.join("\n")).toMatch(/posted: no \(PICKS_API_TOKEN is not set/);
  });

  it("post rejects an invalid picks.json with exit 2", async () => {
    const json = path.join(root, "bad.json");
    fs.writeFileSync(json, JSON.stringify({ week: "2026-10-12", focus: "" }));
    expect(await main(["post", json], deps)).toBe(2);
  });

  it("past reads history from the API when a token is set", async () => {
    const calls = withApi([{ status: 200, body: [{ week: "2026-10-12", id: vid(1), title: "One", verdict: "worth" }] }]);
    expect(await main(["past", "4"], deps)).toBe(0);
    expect(calls[0].url).toBe("https://laterlist.test/api/picks/history?weeks=4");
    expect(JSON.parse(out[0])).toEqual([{ week: "2026-10-12", id: vid(1), title: "One", verdict: "worth" }]);
  });

  it("list still excludes vault-note picks when the API history is empty", async () => {
    await seedVideo(pg, { id: vid(1), title: "Keep" });
    await seedVideo(pg, { id: vid(2), title: "Picked before the switch" });
    fs.mkdirSync(deps.picksDir, { recursive: true });
    fs.writeFileSync(path.join(deps.picksDir, "2026-10-05.md"),
      `---\nweek: 2026-10-05\n---\n## 1. [Picked before the switch](https://www.youtube.com/watch?v=${vid(2)})\nVerdict: worth it\n`);
    withApi([{ status: 200, body: [] }]);
    expect(await main(["list"], deps)).toBe(0);
    const lines = fs.readFileSync(path.join(work(), "list.tsv"), "utf8").split("\n").filter(Boolean);
    expect(lines.slice(1).map((l) => l.split("\t")[0])).toEqual([vid(1)]);
  });

  it("past merges API and vault history, API verdict wins", async () => {
    fs.mkdirSync(deps.picksDir, { recursive: true });
    fs.writeFileSync(path.join(deps.picksDir, "2026-10-05.md"),
      `---\nweek: 2026-10-05\n---\n## 1. [Old](https://www.youtube.com/watch?v=${vid(3)})\nVerdict: not\n## 2. [Both](https://www.youtube.com/watch?v=${vid(4)})\nVerdict: worth it | not | skipped\n`);
    withApi([{ status: 200, body: [{ week: "2026-10-05", id: vid(4), title: "Both", verdict: "worth" }] }]);
    expect(await main(["past"], deps)).toBe(0);
    const rows = JSON.parse(out[0]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === vid(4)).verdict).toBe("worth");
    expect(rows.find((r) => r.id === vid(3)).verdict).toBe("not");
  });

  it("list excludes recent picks from API history", async () => {
    await seedVideo(pg, { id: vid(1), title: "Keep" });
    await seedVideo(pg, { id: vid(2), title: "Picked in the app" });
    withApi([{ status: 200, body: [{ week: "2026-10-05", id: vid(2), title: "Picked in the app", verdict: null }] }]);
    expect(await main(["list"], deps)).toBe(0);
    const lines = fs.readFileSync(path.join(work(), "list.tsv"), "utf8").split("\n").filter(Boolean);
    expect(lines.slice(1).map((l) => l.split("\t")[0])).toEqual([vid(1)]);
  });
```

The existing `past` and `list` tests (vault-note based) must keep passing: with no `PICKS_API_TOKEN` the CLI falls back to the vault notes.

- [ ] **Step 2: Run to verify failure.** `npx vitest run tests/watch-picks-cli.test.js tests/watch-picks-render.test.js tests/watch-picks-db.test.js` → FAIL.

- [ ] **Step 3: Implement.**

`scripts/watch-picks/db.mjs` `loadPicksEnv`: after computing `email`, return

```js
  return {
    url,
    email,
    apiToken: env.PICKS_API_TOKEN || "",
    appUrl: (env.PICKS_APP_URL || "https://laterlist-app.vercel.app").replace(/\/+$/, ""),
  };
```

Create `scripts/watch-picks/api.mjs`:

```js
// Talks to Laterlist with the picks-scoped key. Every failure becomes a
// PicksApiError so the CLI can fall back to the local page.
export class PicksApiError extends Error {}

async function send(url, { apiToken, fetchImpl, method = "GET", body }) {
  if (!apiToken) throw new PicksApiError("PICKS_API_TOKEN is not set in .env.picks");
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { "content-type": "application/json", "x-import-token": apiToken },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new PicksApiError(`could not reach Laterlist: ${String(e?.message || e).split("\n")[0]}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new PicksApiError(`Laterlist said ${res.status}: ${data?.error || "no detail"}`);
  return data;
}

export function postPicks({ appUrl, apiToken, data, fetchImpl = globalThis.fetch }) {
  return send(`${appUrl}/api/picks`, { apiToken, fetchImpl, method: "POST", body: data });
}

export async function fetchHistory({ appUrl, apiToken, weeks = 8, fetchImpl = globalThis.fetch }) {
  const rows = await send(`${appUrl}/api/picks/history?weeks=${weeks}`, { apiToken, fetchImpl });
  if (!Array.isArray(rows)) throw new PicksApiError("Laterlist sent an unexpected history shape");
  return rows;
}
```

`scripts/watch-picks/render.mjs`:
- `export function renderMarkdown(d, { posted = false } = {})`; the per-pick line becomes ``lines.push("", posted ? "Verdict: tap it in Laterlist" : `Verdict: ${VERDICT_TEMPLATE}`, "");``
- In `parsePicksNote`, treat `said === "tap it in laterlist"` like the template (verdict `null`).

`scripts/watch-picks.mjs`:
- Import `{ PicksApiError, postPicks, fetchHistory }` from `./watch-picks/api.mjs`.
- Add `fetchImpl: globalThis.fetch` to the defaults inside `main`'s `o`.
- Add a helper inside `main`:

```js
  // API history (verdicts tapped in Laterlist) merged with the vault notes, so
  // picks made before the switch to Laterlist still count. API verdict wins.
  const recentPicks = async (weeks) => {
    const vault = pastPicks(o.picksDir, { now: o.now, weeks });
    let fromApi = [];
    try {
      const env = loadPicksEnv(o.envPath);
      fromApi = await fetchHistory({ appUrl: env.appUrl, apiToken: env.apiToken, weeks, fetchImpl: o.fetchImpl });
    } catch (e) {
      if (!(e instanceof PicksApiError)) throw e;
      o.err(`history from vault notes only (${e.message})`);
    }
    const seen = new Set(fromApi.map((p) => `${p.week}|${p.id}`));
    return [...fromApi, ...vault.filter((p) => !seen.has(`${p.week}|${p.id}`))]
      .sort((a, b) => (a.week < b.week ? 1 : a.week > b.week ? -1 : 0));
  };
```

- `list`: replace the `pastPicks(...)` call with `await recentPicks(8)`.
- `past`: print `JSON.stringify(await recentPicks(weeks), null, 2)`.
- Add to the usage string `post <picks.json>` and a new case:

```js
      case "post": {
        if (!arg) {
          o.err("post needs the path to picks.json");
          return 2;
        }
        let raw;
        try {
          raw = JSON.parse(fs.readFileSync(arg, "utf8"));
        } catch (e) {
          throw new PicksDataError(`picks.json is not valid JSON: ${String(e.message).split("\n")[0]}`);
        }
        const data = validatePicks(raw);
        const env = loadPicksEnv(o.envPath);
        fs.mkdirSync(o.picksDir, { recursive: true });
        const { html, md } = outputPaths(o.picksDir, data.week);
        try {
          if (data.error) throw new PicksApiError(`not posted: ${data.error}`);
          await postPicks({ appUrl: env.appUrl, apiToken: env.apiToken, data, fetchImpl: o.fetchImpl });
          fs.writeFileSync(md, renderMarkdown(data, { posted: true }));
          o.out(`posted: yes (${data.picks.length} picks for ${data.week})`);
          o.out(`open: ${env.appUrl}/app`);
        } catch (e) {
          if (!(e instanceof PicksApiError)) throw e;
          fs.writeFileSync(html, renderHtml(data));
          fs.writeFileSync(md, renderMarkdown(data));
          o.out(`posted: no (${e.message})`);
          o.out(`open: ${html}`);
        }
        return 0;
      }
```

- [ ] **Step 4: Run.** The three test files → PASS; then `npm test`.
- [ ] **Step 5: Commit.** `git add scripts/watch-picks scripts/watch-picks.mjs tests/watch-picks-*.test.js && git commit -m "feat(watch-picks): post picks to Laterlist, read history from the API"`

**Codex stops here and reports:** commit hashes (or per-task file lists if git is blocked), test totals, EPERM count, deviations.

---

### Task 3: Web This week screen (Claude)

Load `ui-ux-pro-max` (L1, against `docs/design-system.md` tokens) and `shadcn` where a component fits, before writing UI; run `kole-jain` before calling it done.

**Files:**
- Create: `web/src/components/ThisWeek.jsx`, `tests/this-week.test.js`
- Modify: `web/src/api.js`, `web/src/App.jsx`, `web/src/components/Settings.jsx`, `web/src/styles.css`

- [ ] **Step 1: Write the failing tests.** Create `tests/this-week.test.js`:

```js
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThisWeekView, applyVerdict, mondayOf, bestPart, weekLabel } from "../web/src/components/ThisWeek.jsx";

const pick = (n, over = {}) => ({
  id: `vid0000000${n}`, title: `Video ${n}`, channel: "Chan", durationSeconds: 1860, row: "learn",
  why: `Why ${n}`, start: 184, end: 970, gets: ["One thing"], verdict: null, ...over,
});
const set = (over = {}) => ({
  week: "2026-10-12", focus: "Finish the portfolio", focusPoints: ["Case studies"], notice: "",
  picks: [pick(1), pick(2, { row: "watch", start: null, end: null }), pick(3)],
  closeButNo: [{ id: "vid00000009", title: "Close one", reason: "Repeats your notes", inLibrary: true }],
  ...over,
});
const view = (state, extra = {}) => renderToStaticMarkup(React.createElement(ThisWeekView, {
  state, thisMonday: "2026-10-12", onVerdict: () => {}, onRetry: () => {}, onOpenLibrary: () => {}, onOpenVideo: () => {}, ...extra,
}));

describe("ThisWeekView", () => {
  it("shows the focus, three cards, best parts and verdict buttons", () => {
    const html = view({ status: "ready", set: set() });
    expect(html).toContain("Week of Oct 12");
    expect(html).toContain("Finish the portfolio");
    expect((html.match(/class="pick"/g) || []).length).toBe(3);
    expect(html).toContain("Watch 3:04 to 16:10");
    expect(html).toContain("Watch it all");
    expect(html).toContain("https://www.youtube.com/watch?v=vid00000001&amp;t=184s");
    expect(html).toContain("Worth it");
    expect(html).toContain("Not for me");
    expect(html).toContain("Didn&#x27;t watch");
    expect(html).toContain("Close, but no (1)");
    expect(html).not.toMatch(/[–—]/);
  });

  it("marks the chosen verdict", () => {
    const html = view({ status: "ready", set: set({ picks: [pick(1, { verdict: "worth" }), pick(2), pick(3)] }) });
    expect(html).toMatch(/aria-pressed="true"[^>]*>Worth it/);
  });

  it("flags picks from an earlier week as stale", () => {
    const html = view({ status: "ready", set: set({ week: "2026-10-05" }) });
    expect(html).toContain("These are last week&#x27;s picks. Is your Mac awake Monday at 8?");
  });

  it("explains the empty state", () => {
    const html = view({ status: "ready", set: null });
    expect(html).toContain("Your first picks arrive Monday at 8 AM.");
    expect(html).toContain("Open your library");
  });

  it("shows loading and error states", () => {
    expect(view({ status: "loading" })).toContain('aria-busy="true"');
    const err = view({ status: "error", message: "offline" });
    expect(err).toContain("offline");
    expect(err).toContain("Retry");
  });

  it("renders hostile titles as text", () => {
    const html = view({ status: "ready", set: set({ picks: [pick(1, { title: '<img src=x onerror=alert(1)> & "디자인"' }), pick(2), pick(3)] }) });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;디자인&quot;");
  });
});

describe("helpers", () => {
  it("applyVerdict updates one pick only", () => {
    const next = applyVerdict(set(), "vid00000002", "not");
    expect(next.picks.map((p) => p.verdict)).toEqual([null, "not", null]);
  });

  it("mondayOf, bestPart and weekLabel", () => {
    expect(mondayOf(new Date(2026, 9, 18, 9))).toBe("2026-10-12");
    expect(bestPart({ start: 184, end: 970 })).toBe("Watch 3:04 to 16:10");
    expect(bestPart({ start: 184, end: null })).toBe("Start at 3:04");
    expect(bestPart({ start: null, end: null })).toBe("Watch it all");
    expect(weekLabel("2026-10-12")).toBe("Oct 12");
  });
});
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run tests/this-week.test.js` → FAIL (module missing).

- [ ] **Step 3: API helpers.** Add to `web/src/api.js`:

```js
export const getCurrentPicks = () => call("/api/picks/current");
export const setPickVerdict = (week, videoId, verdict) => post(`/api/picks/${week}/verdict`, { videoId, verdict });
```

- [ ] **Step 4: Component.** Create `web/src/components/ThisWeek.jsx`:

```jsx
import React, { useCallback, useEffect, useState } from "react";
import * as api from "../api.js";

// This week: the Monday Mac run's 3 picks. Laterlist opens here (2026-10-12).

const ROW = {
  learn: { label: "Get the gist", tint: "var(--cat-learn)" },
  watch: { label: "Watch it", tint: "var(--cat-watch)" },
};
const VERDICTS = [["worth", "Worth it"], ["not", "Not for me"], ["skipped", "Didn't watch"]];
const pad = (n) => String(n).padStart(2, "0");
const WEEK = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function mondayOf(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function weekLabel(week) {
  const [y, m, d] = week.split("-").map(Number);
  return WEEK.format(new Date(y, m - 1, d));
}

function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export function bestPart(p) {
  if (p.start === null || p.start === undefined) return "Watch it all";
  if (p.end === null || p.end === undefined) return `Start at ${clock(p.start)}`;
  return `Watch ${clock(p.start)} to ${clock(p.end)}`;
}

const watchUrl = (id, start) => `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ""}`;

export function applyVerdict(set, videoId, verdict) {
  return { ...set, picks: set.picks.map((p) => (p.id === videoId ? { ...p, verdict } : p)) };
}

function PickCard({ pick, index, busy, onVerdict }) {
  const row = ROW[pick.row] || ROW.learn;
  const href = watchUrl(pick.id, pick.start);
  const length = pick.durationSeconds ? `${Math.max(1, Math.round(pick.durationSeconds / 60))} min` : "";
  const meta = [pick.channel, length].filter(Boolean).join(" · ");
  return (
    <article className="pick">
      <a className="pick__thumb" href={href} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
        <img src={`https://i.ytimg.com/vi/${pick.id}/hqdefault.jpg`} alt="" loading="lazy" />
      </a>
      <div className="pick__body">
        <p className="pick__row"><span className="pick__dot" style={{ background: row.tint }} />{index + 1} · {row.label}</p>
        <h3 className="pick__title"><a href={href} target="_blank" rel="noopener noreferrer">{pick.title}</a></h3>
        {meta || pick.noTranscript ? (
          <p className="pick__meta">{meta}{pick.noTranscript ? <span className="pick__faint">{meta ? " · " : ""}no transcript</span> : null}</p>
        ) : null}
        <p className="pick__why"><span className="pick__label">Why you, now</span>{pick.why}</p>
        <a className="pick__chip" href={href} target="_blank" rel="noopener noreferrer">{bestPart(pick)}</a>
        {pick.gets?.length ? <ul className="pick__gets">{pick.gets.map((g) => <li key={g}>{g}</li>)}</ul> : null}
        <div className="pick__verdicts" role="group" aria-label="Your verdict">
          {VERDICTS.map(([key, label]) => (
            <button key={key} type="button" disabled={busy} aria-pressed={pick.verdict === key}
              className={`btn ${pick.verdict === key ? "btn--primary" : "btn--ghost"} pick__verdict`}
              onClick={() => onVerdict(pick.id, key)}>{label}</button>
          ))}
        </div>
      </div>
    </article>
  );
}

export function ThisWeekView({ state, thisMonday, busyId = null, onVerdict, onRetry, onOpenLibrary, onOpenVideo }) {
  if (state.status === "loading") {
    return (
      <section className="week" aria-busy="true">
        <div className="week__picks">{[0, 1, 2].map((i) => <div key={i} className="pick pick--skeleton" />)}</div>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="week">
        <p className="week__notice">Couldn't load this week's picks: {state.message}</p>
        <button type="button" className="btn btn--ghost" onClick={onRetry}>Retry</button>
      </section>
    );
  }
  const set = state.set;
  if (!set) {
    return (
      <section className="week week--empty">
        <p className="week__eyebrow">This week</p>
        <h2 className="week__focus">Your first picks arrive Monday at 8 AM.</h2>
        <p className="week__notice">Every Monday, Claude on your Mac reads your notes and your Watch Later, then sends the 3 videos most worth your time here.</p>
        <button type="button" className="btn btn--ghost" onClick={onOpenLibrary}>Open your library</button>
      </section>
    );
  }
  return (
    <section className="week">
      <p className="week__eyebrow">Week of {weekLabel(set.week)} · your focus</p>
      <h2 className="week__focus">{set.focus}</h2>
      {set.focusPoints?.length ? <ul className="week__points">{set.focusPoints.map((f) => <li key={f}>{f}</li>)}</ul> : null}
      {set.week < thisMonday ? <p className="week__notice">These are last week's picks. Is your Mac awake Monday at 8?</p> : null}
      {set.notice ? <p className="week__notice">{set.notice}</p> : null}
      <div className="week__picks">
        {set.picks.map((p, i) => <PickCard key={p.id} pick={p} index={i} busy={busyId === p.id} onVerdict={onVerdict} />)}
      </div>
      {set.closeButNo?.length ? (
        <details className="week__close">
          <summary>Close, but no ({set.closeButNo.length})</summary>
          <ul>
            {set.closeButNo.map((c) => (
              <li key={c.id}>
                {c.inLibrary
                  ? <button type="button" className="week__close-title" onClick={() => onOpenVideo(c.id)}>{c.title}</button>
                  : <span className="week__close-title">{c.title}</span>}
                <span className="week__reason">{c.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export default function ThisWeek({ onOpenLibrary, onOpenVideo, onLibraryChanged = () => {}, onToast = () => {} }) {
  const [state, setState] = useState({ status: "loading" });
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const { set } = await api.getCurrentPicks();
      setState({ status: "ready", set });
    } catch (e) {
      setState({ status: "error", message: e.message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onVerdict = async (videoId, verdict) => {
    if (state.status !== "ready" || !state.set) return;
    const before = state.set;
    setState({ status: "ready", set: applyVerdict(before, videoId, verdict) });
    setBusyId(videoId);
    try {
      await api.setPickVerdict(before.week, videoId, verdict);
      if (verdict !== "skipped") onLibraryChanged();
    } catch (e) {
      setState({ status: "ready", set: before });
      onToast(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ThisWeekView state={state} thisMonday={mondayOf()} busyId={busyId} onVerdict={onVerdict}
      onRetry={load} onOpenLibrary={onOpenLibrary} onOpenVideo={onOpenVideo} />
  );
}
```

- [ ] **Step 5: Styles.** Add to `web/src/styles.css` (tokens only; font sizes come from the app's existing scale: 28, 19, 13, phone 26):

```css
/* ---- This week (picks home) ---- */
.week { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5) 0; }
.week__eyebrow { margin: 0; color: var(--muted); font-size: 13px; }
.week__focus { margin: 0; font-family: var(--font-display); font-weight: 400; font-size: 28px; line-height: 1.15; }
.week__points { margin: 0; padding-left: var(--space-5); color: var(--muted); }
.week__notice { margin: 0; color: var(--muted); }
.week__picks { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: var(--space-4); margin-top: var(--space-3); }
.pick { display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.pick--skeleton { min-height: 360px; background: var(--secondary); }
.pick__thumb img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: var(--secondary); }
.pick__body { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); }
.pick__body p { margin: 0; }
.pick__row { display: flex; align-items: center; gap: var(--space-2); color: var(--muted); font-size: 13px; }
.pick__dot { width: 8px; height: 8px; border-radius: var(--radius-pill); }
.pick__title { margin: 0; font-family: var(--font-display); font-weight: 400; font-size: 19px; line-height: 1.25; }
.pick__title a, .pick__chip { color: inherit; text-decoration: none; }
.pick__title a:hover { text-decoration: underline; }
.pick__meta { color: var(--muted); font-size: 13px; }
.pick__faint { color: var(--faint); }
.pick__label { display: block; color: var(--muted); font-size: 13px; }
.pick__chip { align-self: flex-start; padding: 2px var(--space-3); border: 1px solid var(--border-strong); border-radius: var(--radius-pill); font-size: 13px; }
.pick__gets { margin: 0; padding-left: var(--space-5); }
.pick__verdicts { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); }
.week__close { border-top: 1px solid var(--border); padding-top: var(--space-4); margin-top: var(--space-3); }
.week__close summary { cursor: pointer; font-family: var(--font-display); font-size: 19px; }
.week__close ul { list-style: none; margin: var(--space-3) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.week__close-title { background: none; border: 0; padding: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.week__reason { display: block; color: var(--muted); font-size: 13px; }
.topbar__tabs { display: flex; gap: var(--space-1); margin-left: var(--space-4); }
```

- [ ] **Step 6: App wiring.** In `web/src/App.jsx`:
  - `const [view, setView] = useState("week");`
  - Brand button: `onClick={() => { setFocus(null); setView("week"); }}`, `aria-label="This week"`.
  - Right after the brand button, add:

```jsx
        <nav className="topbar__tabs" aria-label="Main">
          <button className={`btn ${view === "week" && !focus ? "btn--primary" : "btn--ghost"}`}
            aria-current={view === "week" && !focus ? "page" : undefined}
            onClick={() => { setFocus(null); setView("week"); }}>This week</button>
          <button className={`btn ${view !== "week" && !focus ? "btn--primary" : "btn--ghost"}`}
            aria-current={view !== "week" && !focus ? "page" : undefined}
            onClick={() => { setFocus(null); setView("board"); }}>Library</button>
        </nav>
```

  - In `<main>`, before the `view === "settings"` branch, add `view === "week" ? (<ThisWeek onOpenLibrary={() => setView("board")} onOpenVideo={openVideoById} onLibraryChanged={reload} onToast={showToast} />) :` where `openVideoById` finds the video across `board` rows (`Object.values(board).flat().find((v) => v.id === id)`) and calls the existing `openDetail` with it, or falls back to `setView("board")` with a toast "That video isn't in your library any more." when not found.
  - Import `ThisWeek` from `./components/ThisWeek.jsx`.
- [ ] **Step 7: Settings picks key.** In `Settings.jsx`, generalize `generateBridgeToken` into `generateToken(scope, label, toastText)`; keep the admin bridge button calling `generateToken("bridge", "Vault bridge", "Bridge token generated.")`; add a button `Create picks key` (always shown) calling `generateToken("picks", "Mac picks", "Picks key created. Copy it now.")`; change the reveal text to "Copy this key now. It will not be shown again." and its aria-label to "Generated key"; show the scope label `{ bridge: "Bridge", picks: "Picks", imports: "Imports" }[token.scope] || "Imports"`.
- [ ] **Step 8: Run.** `npx vitest run tests/this-week.test.js` → PASS; `npm test` green (update any test that asserted the board is the default view, listing it); `npm run build:web` passes.
- [ ] **Step 9: Browser check (dev).** `DEV_FAKE_AUTH=1 FAKE_LLM=1 npm start` in the worktree (via `preview_start` with a launch config). Sign in as a dev user, import sample videos, create a picks key in Settings, `curl -X POST localhost:4400/api/picks -H 'content-type: application/json' -H 'x-import-token: <key>' -d @sample-picks.json` with ids from the dev library. Confirm: app opens on This week with 3 cards; Worth it persists after reload and the video leaves Library; stale banner when the posted week is older; no console errors; 375 px wide has no sideways scroll. Screenshot for Joon.
- [ ] **Step 10: Polish + commit.** Run `kole-jain` on the screen, fix what it finds, then `git add -A web/src tests/this-week.test.js && git commit -m "feat(web): This week home with picks and verdicts; Library tab"`.

---

### Task 4: Phone This week tab (Claude)

**Files:** Modify `web/src/phone/PhoneApp.jsx`, `web/src/phone/phone.css`; tests in `tests/phone-app.test.js` (follow its existing style).

- [ ] **Step 1: Failing test.** The phone tab bar renders a first tab "This week" (marked current by default) and a "Library" tab where "Board" was.
- [ ] **Step 2: Implement.** Initial stack `[{ name: "week" }]`; add the This week tab first (an existing icon from `icons.jsx`; if none fits, add a small calendar icon following that file's pattern); rename the Board tab label to Library; render `<ThisWeek ... />` when the top entry is `week`, with `onOpenVideo` opening the existing `VideoSheet` for that video and `onLibraryChanged={reload}`. In `phone.css`: `.week__focus` at 26px, cards one column (already by grid), verdict buttons min-height 44px.
- [ ] **Step 3: Run + commit.** Tests green; dev check at 375 px; `git commit -am "feat(phone): This week tab first"`.

---

### Task 5: Ship (Claude, Joon creates the key)

- [ ] **Step 1:** Review Codex's commits against Tasks 1 and 2 line by line; `npm test` (all green, no EPERM outside the sandbox); `npm run build:web`.
- [ ] **Step 2:** Push and open the PR. Ask Joon to OK the merge, saying in the same sentence that merging also adds 2 tables (`pick_sets`, `pick_verdicts`) to the live Supabase database. Do not treat the design approval as consent for the database change.
- [ ] **Step 3: Production migration before deploy.** Apply migration `010-picks` to the Supabase project `fjykuzbwhrpzpiqxzjeh` with the Supabase MCP `apply_migration` (the exact SQL from Task 1 Step 3), then `INSERT INTO schema_migrations (id) VALUES ('010-picks') ON CONFLICT DO NOTHING`. Verify both tables exist with RLS on.
- [ ] **Step 4:** Merge (squash); wait for the Vercel production deploy; update the runtime copy: `git -C /Users/joonwoopark/projects/laterlist fetch origin && git -C /Users/joonwoopark/projects/laterlist-runtime checkout --detach origin/main && (cd /Users/joonwoopark/projects/laterlist-runtime && npm ci --omit=dev)`.
- [ ] **Step 5: Joon creates the key.** Joon: Settings, Create picks key, Copy. Then in Terminal:

```bash
read -s "TK?Paste the picks key: " && printf 'PICKS_API_TOKEN=%s\n' "$TK" >> ~/.config/watch-picks/.env.picks && unset TK && echo saved
```

- [ ] **Step 6: Skill.** In `/Users/joonwoopark/.claude/skills/watch-picks/SKILL.md`, replace step 6's last paragraph with: "Run `CLI post WORK/picks.json`. It sends the picks to Laterlist and prints `posted: yes` and `open: <Laterlist URL>`, or, if Laterlist could not be reached, saves the local page and prints `posted: no (reason)` and `open: <html path>`. Run `open "<the path or URL on the open: line>"`." Also change the shell list's third bullet to `open "<the path or URL on the open: line>"`, and in step 1 item 4 note that `CLI past` now reads Joon's verdicts from Laterlist.
- [ ] **Step 7: Go live without a third set this week.** Do NOT trigger a fresh run (the 2026-10-12 08:12 run already picked this week's 3). Post the existing set: `node /Users/joonwoopark/projects/laterlist-runtime/scripts/watch-picks.mjs post "/Users/joonwoopark/Obsidian/Joon/2. Areas/Mentor/Picks/.work/2026-10-12/picks.json"`. Expect `posted: yes`; open `https://laterlist-app.vercel.app/app` and confirm This week shows those 3 picks; Joon taps one verdict; `node .../watch-picks.mjs past` shows it. If that picks.json is missing, re-date the approved 2026-10-05 set to 2026-10-12 and post that instead. Next Monday is the first fully in-app run.
- [ ] **Step 8:** Log in the vault (`1. Projects/Laterlist/log.md`), update the decision doc status and memory.

## Definition of Done

1. `npm test` green; `npm run build:web` passes.
2. Dev: posting a sample set opens `/app` on This week with 3 cards; verdicts persist after reload; Worth it moves the video out of Library; stale banner works; no console errors; 375 px has no sideways scroll; phone tab bar starts with This week.
3. Production: migration 010 applied with RLS; Joon's picks key saved; a manual run posts and Laterlist opens on This week.
4. `CLI past` returns the verdicts Joon tapped.
