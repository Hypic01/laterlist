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
