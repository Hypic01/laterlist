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

const goalPick = (n, source = "youtube", over = {}) => ({
  id: vid(n), source, title: `Video ${n}`, channel: "Chan", durationSeconds: 600,
  author: "Working designer", why: "Useful", action: "Practice", gets: ["One thing"],
  start: 60, end: 300, noTranscript: false, covers: [], ...over,
});
const goalSet = (picks = [goalPick(99)], over = {}) => ({
  week: "2026-10-19", notice: "", goals: [{ name: "Get a design job", need: "Prepare for interviews", picks }],
  closeButNo: [], ...over,
});

let uid;
beforeEach(async () => {
  ({ db, pg } = await testDb());
  build();
  uid = await joonId();
  await seed(uid, 8);
  await tokens(uid);
});

describe("goal picks", () => {
  it("posts an unsaved YouTube pick and rejects an unsaved saved pick", async () => {
    expect((await postAsMac(goalSet()).expect(200)).body).toEqual({ week: "2026-10-19", picks: 1, warnings: [] });
    const bad = await postAsMac(goalSet([goalPick(99, "saved")])).expect(400);
    expect(bad.body.error).toContain(vid(99));
  });

  it("drops unknown, done and dismissed covers with warnings", async () => {
    await pg.query("UPDATE videos SET status = 'done' WHERE user_id = $1 AND video_id = $2", [uid, vid(2)]);
    await pg.query("UPDATE videos SET status = 'dismissed' WHERE user_id = $1 AND video_id = $2", [uid, vid(3)]);
    const body = goalSet([goalPick(99, "youtube", { covers: [vid(1), vid(2), vid(3), vid(90)] })]);
    const posted = await postAsMac(body).expect(200);
    expect(posted.body.warnings.join(" ")).toContain(vid(2));
    expect(posted.body.warnings.join(" ")).toContain(vid(3));
    expect(posted.body.warnings.join(" ")).toContain(vid(90));
    const stored = await db.pickSet(uid, body.week);
    expect(stored.payload.goals[0].picks[0].covers).toEqual([vid(1)]);
  });

  it("joins saved picks and covers, and marks a subsequently removed cover gone", async () => {
    await postAsMac(goalSet([goalPick(1, "saved", { covers: [vid(2), vid(3)] }), goalPick(99)])).expect(200);
    await asJoon(request(app).post(`/api/videos/${vid(2)}/dismiss`)).expect(200);
    const { body } = await asJoon(request(app).get("/api/picks/current")).expect(200);
    const picks = body.set.goals[0].picks;
    expect(picks[0].video).toMatchObject({ title: "Video 1" });
    expect(picks[1].video).toBeNull();
    expect(picks[0].covers).toEqual([
      { id: vid(2), title: "Video 2", channel: "Chan", durationSeconds: 600, gone: true },
      { id: vid(3), title: "Video 3", channel: "Chan", durationSeconds: 600, gone: false },
    ]);
  });

  it("stores a YouTube verdict without marking a library video done", async () => {
    await postAsMac(goalSet()).expect(200);
    const { body } = await asJoon(request(app).post("/api/picks/2026-10-19/verdict"))
      .send({ videoId: vid(99), verdict: "worth" }).expect(200);
    expect(body.marked).toBe(0);
    expect((await db.pickVerdicts(uid, "2026-10-19"))[vid(99)]).toBe("worth");
    expect((await pg.query("SELECT count(*)::int AS n FROM youtube_removals WHERE user_id = $1", [uid])).rows[0].n).toBe(0);
  });

  it("marks a saved goal pick done", async () => {
    await postAsMac(goalSet([goalPick(1, "saved")])).expect(200);
    const { body } = await asJoon(request(app).post("/api/picks/2026-10-19/verdict"))
      .send({ videoId: vid(1), verdict: "worth" }).expect(200);
    expect(body.marked).toBe(1);
    expect((await pg.query("SELECT status FROM videos WHERE user_id = $1 AND video_id = $2", [uid, vid(1)])).rows[0].status).toBe("done");
  });

  it("history includes YouTube picks from goal sets", async () => {
    await postAsMac(goalSet([goalPick(1, "saved"), goalPick(99)])).expect(200);
    const { body } = await request(app).get("/api/picks/history").set("X-Import-Token", "wll_picks").expect(200);
    expect(body.map((p) => p.id)).toEqual([vid(1), vid(99)]);
  });
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

  it("refuses a verdict for a video that is not one of that week's picks", async () => {
    await postAsMac(setFor("2026-10-12", [1, 2, 3, 4])).expect(200);
    await asJoon(request(app).post("/api/picks/2026-10-12/verdict")).send({ videoId: vid(4), verdict: "worth" }).expect(404);
    await asJoon(request(app).post("/api/picks/2026-10-05/verdict")).send({ videoId: vid(1), verdict: "worth" }).expect(404);
    const v = await pg.query("SELECT status FROM videos WHERE user_id = $1 AND video_id = $2", [uid, vid(4)]);
    expect(v.rows[0].status).toBe("scanned");
  });

  it("rejects impossible dates with 400, not a server error", async () => {
    await postAsMac(setFor("2026-02-30", [1, 2, 3])).expect(400);
    await asJoon(request(app).post("/api/picks/2026-02-30/verdict")).send({ videoId: vid(1), verdict: "worth" }).expect(400);
  });

  it("close-but-no videos already done are not openable", async () => {
    await postAsMac(setFor("2026-10-12", [1, 2, 3, 4])).expect(200);
    await pg.query("UPDATE videos SET status = 'done' WHERE user_id = $1 AND video_id = $2", [uid, vid(4)]);
    const { body } = await asJoon(request(app).get("/api/picks/current")).expect(200);
    expect(body.set.closeButNo[0].inLibrary).toBe(false);
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
