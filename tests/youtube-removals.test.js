import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { createAuth, fakeVerifier, hashToken } from "../server/auth.js";
import { loadConfig } from "../server/config.js";
import { testDb, seedUser, vids, U1, U2 } from "./helpers.js";

const EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const EMAIL = "reader@test.dev";
const ADMIN = "boss@test.dev";
let db, pg, app;

function build(env = {}) {
  const config = loadConfig({
    EXTENSION_IDS: "abcdefghijklmnopabcdefghijklmnop",
    ADMIN_EMAILS: ADMIN,
    ...env,
  });
  const auth = createAuth({ verify: fakeVerifier(), db, adminEmails: config.adminEmails });
  app = createApp({ db, auth, config });
  return config;
}

async function userId(email = EMAIL) {
  const { sub } = await fakeVerifier()(`dev:${email}`);
  await seedUser(db, sub, email);
  return sub;
}

async function tokenFor(id, plain = "wll_test_token") {
  await db.createApiToken(id, { tokenHash: hashToken(plain), scope: "imports" });
  return plain;
}

async function videosFor(id, count = 3) {
  const videos = vids(count);
  await db.upsertFromImport(id, videos, 10000);
  for (const video of videos.slice(0, count - 1)) {
    await db.saveScanResult(id, video.id, {
      category: "learn", reasoning: "", confidence: 0.8, topics: [],
    });
  }
  return videos;
}

const asUser = (r, email = EMAIL) => r.set("Authorization", `Bearer dev:${email}`);

beforeEach(async () => {
  ({ db, pg } = await testDb());
  build();
});

describe("YouTube removal data", () => {
  it("migrates the preference and RLS-protected removal table", async () => {
    await seedUser(db, U1);
    expect((await db.getUser(U1)).remove_from_youtube).toBe(true);
    const { rows } = await pg.query(
      "SELECT relrowsecurity FROM pg_class WHERE relname = 'youtube_removals'",
    );
    expect(rows[0]?.relrowsecurity).toBe(true);
  });

  it("queues only for opted-in users with an active imports token", async () => {
    await seedUser(db, U1);
    const [video] = vids(1);
    expect(await db.enqueueYoutubeRemovals(U1, [video.id], "done")).toBe(0);
    const first = await tokenFor(U1);
    expect(await db.enqueueYoutubeRemovals(U1, [video.id], "done")).toBe(1);
    expect(await db.pendingYoutubeRemovals(U1)).toEqual([
      expect.objectContaining({ videoId: video.id, reason: "done" }),
    ]);
    await db.setRemoveFromYoutube(U1, false);
    expect(await db.enqueueYoutubeRemovals(U1, [vids(2)[1].id], "dismissed")).toBe(0);
    await db.setRemoveFromYoutube(U1, true);
    const tokenRow = await db.getApiTokenByHash(hashToken(first));
    await db.revokeApiToken(U1, tokenRow.id);
    expect(await db.enqueueYoutubeRemovals(U1, [vids(2)[1].id], "dismissed")).toBe(0);
  });

  it("keeps caller rows isolated and caps generic errors after three attempts", async () => {
    await seedUser(db, U1);
    await seedUser(db, U2, "other@test.dev");
    await tokenFor(U1);
    await tokenFor(U2, "wll_other");
    const [a, b] = vids(2);
    await db.enqueueYoutubeRemovals(U1, [a.id, b.id], "done");
    await db.enqueueYoutubeRemovals(U2, [a.id], "dismissed");
    await db.recordYoutubeRemovalResults(U1, [
      { videoId: a.id, ok: false, error: "ACCOUNT_MISMATCH" },
      { videoId: "unknown0001", ok: true },
    ]);
    expect((await pg.query("SELECT attempts, last_error FROM youtube_removals WHERE user_id=$1 AND video_id=$2", [U1, a.id])).rows[0])
      .toMatchObject({ attempts: 0, last_error: "ACCOUNT_MISMATCH" });
    await db.recordYoutubeRemovalResults(U1, [{ videoId: a.id, ok: true }]);
    for (let i = 0; i < 3; i++) {
      await db.recordYoutubeRemovalResults(U1, [{ videoId: b.id, ok: false, error: "HTTP_500" }]);
    }
    expect(await db.pendingYoutubeRemovals(U1)).toEqual([]);
    expect((await pg.query("SELECT state, attempts FROM youtube_removals WHERE user_id=$1 AND video_id=$2", [U1, b.id])).rows[0])
      .toMatchObject({ state: "failed", attempts: 3 });
    expect(await db.pendingYoutubeRemovals(U2)).toEqual([
      expect.objectContaining({ videoId: a.id, reason: "dismissed" }),
    ]);
  });

  it("returns the exact moved ids and their cleanup states", async () => {
    await seedUser(db, U1);
    await tokenFor(U1);
    const [a, b, unscanned] = await videosFor(U1);
    expect(await db.markDoneIds(U1, [a.id, b.id, unscanned.id])).toEqual([a.id, b.id]);
    expect(await db.markDoneIds(U1, [a.id])).toEqual([]);
    await db.enqueueYoutubeRemovals(U1, [a.id], "done");
    const cleanup = await db.getCleanup(U1);
    expect(cleanup.find((row) => row.id === a.id).youtube_state).toBe("pending");
    expect(cleanup.find((row) => row.id === b.id).youtube_state).toBeNull();
  });
});

describe("YouTube removal routes", () => {
  it("defaults the kill switch off, including the extension queue", async () => {
    const id = await userId();
    const token = await tokenFor(id);
    const [video] = await videosFor(id);
    const me = await asUser(request(app).get("/api/me")).expect(200);
    expect(me.body).toMatchObject({ removeFromYoutube: false, youtubeRemovalAvailable: false });
    await asUser(request(app).post(`/api/videos/${video.id}/dismiss`)).expect(200);
    expect(await db.pendingYoutubeRemovals(id)).toEqual([]);
    await db.enqueueYoutubeRemovals(id, [video.id], "dismissed");
    const pending = await request(app).get("/api/youtube-removals").set("X-Import-Token", token).expect(200);
    expect(pending.body).toEqual({ removals: [] });
    await request(app).post("/api/youtube-removals/results")
      .set("X-Import-Token", token).send({ results: [{ videoId: video.id, ok: true }] }).expect(200);
    expect(await db.pendingYoutubeRemovals(id)).toHaveLength(1);
  });

  it("gates admins to ADMIN_EMAILS and all to everyone", async () => {
    build({ YOUTUBE_REMOVAL: "admins" });
    const regularId = await userId();
    const adminId = await userId(ADMIN);
    await tokenFor(regularId);
    await tokenFor(adminId, "wll_admin");
    const [video] = vids(1);
    await videosFor(regularId);
    await videosFor(adminId);
    await asUser(request(app).post(`/api/videos/${video.id}/dismiss`)).expect(200);
    await asUser(request(app).post(`/api/videos/${video.id}/dismiss`), ADMIN).expect(200);
    expect(await db.pendingYoutubeRemovals(regularId)).toEqual([]);
    expect(await db.pendingYoutubeRemovals(adminId)).toHaveLength(1);
    build({ YOUTUBE_REMOVAL: "all" });
    await asUser(request(app).post(`/api/videos/${video.id}/dismiss`)).expect(200);
    expect(await db.pendingYoutubeRemovals(regularId)).toHaveLength(1);
  });

  it("enqueues dismiss and only the ids actually moved by done", async () => {
    build({ YOUTUBE_REMOVAL: "all" });
    const id = await userId();
    await tokenFor(id);
    const [a, b, unscanned] = await videosFor(id);
    await asUser(request(app).post(`/api/videos/${a.id}/dismiss`)).expect(200);
    const marked = await asUser(request(app).post("/api/videos/done"))
      .send({ ids: [a.id, b.id, unscanned.id] }).expect(200);
    expect(marked.body).toEqual({ ok: true, marked: 1 });
    expect(await db.pendingYoutubeRemovals(id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ videoId: a.id, reason: "dismissed" }),
      expect.objectContaining({ videoId: b.id, reason: "done" }),
    ]));
    expect(await db.pendingYoutubeRemovals(id)).toHaveLength(2);
  });

  it("honors preferences and missing or revoked imports tokens", async () => {
    build({ YOUTUBE_REMOVAL: "all" });
    const id = await userId();
    const [a, b, c] = await videosFor(id);
    await asUser(request(app).post(`/api/videos/${a.id}/dismiss`)).expect(200);
    expect(await db.pendingYoutubeRemovals(id)).toEqual([]);
    const token = await tokenFor(id);
    await asUser(request(app).put("/api/me/prefs")).send({ removeFromYoutube: false }).expect(200);
    await asUser(request(app).post(`/api/videos/${b.id}/dismiss`)).expect(200);
    expect(await db.pendingYoutubeRemovals(id)).toEqual([]);
    await asUser(request(app).put("/api/me/prefs")).send({ removeFromYoutube: true }).expect(200);
    const tokenRow = await db.getApiTokenByHash(hashToken(token));
    await db.revokeApiToken(id, tokenRow.id);
    await asUser(request(app).post(`/api/videos/${c.id}/dismiss`)).expect(200);
    expect(await db.pendingYoutubeRemovals(id)).toEqual([]);
  });

  // "Off" has to mean nothing else leaves YouTube, including removals queued while it was on.
  it("cancels still-pending removals when the preference is turned off", async () => {
    build({ YOUTUBE_REMOVAL: "all" });
    const id = await userId();
    const token = await tokenFor(id);
    const [a] = await videosFor(id);
    await asUser(request(app).post(`/api/videos/${a.id}/dismiss`)).expect(200);
    expect(await db.pendingYoutubeRemovals(id)).toHaveLength(1);
    await asUser(request(app).put("/api/me/prefs")).send({ removeFromYoutube: false }).expect(200);
    const pending = await request(app).get("/api/youtube-removals")
      .set("X-Import-Token", token).expect(200);
    expect(pending.body).toEqual({ removals: [] });
  });

  it("validates and persists the preference", async () => {
    build({ YOUTUBE_REMOVAL: "all" });
    await asUser(request(app).put("/api/me/prefs")).send({ removeFromYoutube: "false" }).expect(400);
    const on = await asUser(request(app).get("/api/me")).expect(200);
    expect(on.body).toMatchObject({ removeFromYoutube: true, youtubeRemovalAvailable: true });
    const saved = await asUser(request(app).put("/api/me/prefs"))
      .send({ removeFromYoutube: false }).expect(200);
    expect(saved.body).toEqual({ ok: true, removeFromYoutube: false });
    const off = await asUser(request(app).get("/api/me")).expect(200);
    expect(off.body.removeFromYoutube).toBe(false);
  });

  it("returns only the token owner's pending rows and applies results", async () => {
    build({ YOUTUBE_REMOVAL: "all" });
    const id = await userId();
    const otherId = await userId("other@test.dev");
    const token = await tokenFor(id);
    await tokenFor(otherId, "wll_other");
    const [a, b] = vids(2);
    await videosFor(id);
    await db.markDoneIds(id, [a.id, b.id]);
    await db.enqueueYoutubeRemovals(id, [a.id, b.id], "done");
    await db.enqueueYoutubeRemovals(otherId, [a.id], "dismissed");
    await request(app).post("/api/youtube-removals/results").set("X-Import-Token", token)
      .send({ results: [{ videoId: a.id, ok: true }] }).expect(200);
    const pending = await request(app).get("/api/youtube-removals")
      .set("X-Import-Token", token).expect(200);
    expect(pending.body).toEqual({ removals: [{ videoId: b.id, reason: "done" }] });
    expect(await db.pendingYoutubeRemovals(otherId)).toHaveLength(1);
    const cleanup = await asUser(request(app).get("/api/cleanup")).expect(200);
    expect(cleanup.body.find((row) => row.id === a.id).youtube_state).toBe("removed");
    expect(cleanup.body.find((row) => row.id === b.id).youtube_state).toBe("pending");
  });

  it("rejects malformed result payloads and keeps the imports CORS contract", async () => {
    build({ YOUTUBE_REMOVAL: "all" });
    const id = await userId();
    const token = await tokenFor(id);
    for (const results of [null, {}, Array.from({ length: 51 }, () => ({ videoId: "v1", ok: true })),
      [{ videoId: 123, ok: true }], [{ videoId: "v1", ok: "yes" }],
      [{ videoId: "v1", ok: false, error: 123 }]]) {
      await request(app).post("/api/youtube-removals/results")
        .set("X-Import-Token", token).send({ results }).expect(400);
    }
    const preflight = await request(app).options("/api/youtube-removals/results")
      .set("Origin", EXTENSION_ORIGIN).expect(204);
    expect(preflight.headers["access-control-allow-methods"]).toBe("GET, POST, OPTIONS");
    expect(preflight.headers["access-control-allow-headers"]).toBe("content-type, x-import-token");
    const queue = await request(app).get("/api/youtube-removals")
      .set("Origin", EXTENSION_ORIGIN).set("X-Import-Token", token).expect(200);
    expect(queue.headers["access-control-allow-origin"]).toBe(EXTENSION_ORIGIN);
    const imports = await request(app).options("/api/imports")
      .set("Origin", EXTENSION_ORIGIN).expect(204);
    expect(imports.headers["access-control-allow-methods"]).toBe("POST, OPTIONS");
  });
});
