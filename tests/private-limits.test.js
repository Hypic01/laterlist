import { describe, it, expect } from "vitest";
import { testDb, seedUser, vids, U1 } from "./helpers.js";
import { createImporter } from "../server/importer.js";
import { createApp } from "../server/app.js";
import { loadConfig } from "../server/config.js";

const passthroughAuth = {
  required: (req, res, next) => next(),
  admin: (req, res, next) => next(),
  jwtOrToken: () => (req, res, next) => next(),
};

function route(app, path, method = "get") {
  return app._router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
}

async function invoke(handler, id, params = {}) {
  const req = { user: { id, email: "u1@test.dev", isAdmin: false }, params };
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler(req, res);
  return res;
}

describe("private library limits", () => {
  it("stores 1,500 videos for a user with no plan and respects the one safety cap", async () => {
    const { db } = await testDb();
    await seedUser(db, U1);
    const user = { id: U1, email: "u1@test.dev", isAdmin: false };
    const config = loadConfig({});
    const importer = createImporter({ db, config });
    const first = await importer.handleImport(user, { source: "console", videos: vids(1500) });
    expect(first.status).toBe(200);
    expect(first.body.added).toBe(1500);
    expect(first.body.capped).toBe(0);
    expect((await db.counts(U1)).unscanned).toBe(1500);

    const cappedDb = await testDb();
    await seedUser(cappedDb.db, U1);
    const cappedImporter = createImporter({ db: cappedDb.db, config: loadConfig({ LIBRARY_CAP: "100" }) });
    const second = await cappedImporter.handleImport(user, { source: "console", videos: vids(150) });
    expect(second.body.added).toBe(100);
    expect(second.body.capped).toBe(50);
  });

  it("does not meter TL;DRs after 150 summaries this month", async () => {
    const { db, pg } = await testDb();
    await seedUser(db, U1);
    await db.upsertFromImport(U1, vids(151), 25000);
    await pg.query(`INSERT INTO summaries (user_id, video_id, summary, model, input_tokens, output_tokens)
      SELECT user_id, video_id, '{"tldr":"old","points":[],"watchIf":""}'::jsonb, 'test', 0, 0
      FROM videos WHERE user_id = $1 AND video_id <> $2 LIMIT 150`, [U1, vids(151)[150].id]);
    await db.saveTranscript(U1, vids(151)[150].id, { transcript: "Useful transcript." });
    const config = loadConfig({ BUDGET_USD: "100" });
    const mentor = { summarize: async () => ({ summary: { tldr: "new", points: [], watchIf: "" }, usage: { input: 0, output: 0 } }) };
    const app = createApp({ db, auth: passthroughAuth, config, mentor });
    const response = await invoke(route(app, "/api/videos/:id/summary", "post"), U1, { id: vids(151)[150].id });
    expect(response.statusCode).toBe(200);
    expect(response.body.summary.tldr).toBe("new");
    expect(response.body.summaryQuota).toBeUndefined();
  });

  it("returns a private /api/me contract without plan fields", async () => {
    const { db } = await testDb();
    await seedUser(db, U1);
    const app = createApp({ db, auth: passthroughAuth, config: loadConfig({}) });
    const response = await invoke(route(app, "/api/me"), U1);
    expect(response.statusCode).toBe(200);
    for (const key of ["plan", "beta" + "Pro", "summaryQuota", "summariesUsed", "videoCap", "proEndsAt", "proInterval"])
      expect(response.body).not.toHaveProperty(key);
    for (const key of ["id", "email", "isAdmin", "counts", "lastImportAt", "removeFromYoutube", "youtubeRemovalAvailable"])
      expect(response.body).toHaveProperty(key);
  });
});
