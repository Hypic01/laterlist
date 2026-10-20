import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { testDb } from "./helpers.js";
import { createApp } from "../server/app.js";
import { createAuth, fakeVerifier, hashToken } from "../server/auth.js";
import { createImporter } from "../server/importer.js";
import { loadConfig } from "../server/config.js";

let db, pg, app, uid;
const email = "joon@test.dev";
const vid = (n) => `vid${String(n).padStart(8, "0")}`;
const asJoon = (r) => r.set("Authorization", `Bearer dev:${email}`);
const dismiss = (ids) => asJoon(request(app).post("/api/videos/dismiss")).send({ ids });
const restore = (ids) => asJoon(request(app).post("/api/videos/restore")).send({ ids });

function build(removal = "all") {
  const config = loadConfig({ YOUTUBE_REMOVAL: removal });
  app = createApp({ db, auth: createAuth({ verify: fakeVerifier(), db }), importer: createImporter({ db, config }), config });
}

beforeEach(async () => {
  ({ db, pg } = await testDb());
  build();
  uid = (await asJoon(request(app).get("/api/me")).expect(200)).body.id;
  for (let n = 1; n <= 3; n++) {
    await pg.query(
      "INSERT INTO videos (user_id, video_id, title, category, status) VALUES ($1, $2, $3, 'learn', 'scanned')",
      [uid, vid(n), `Video ${n}`],
    );
  }
});

describe("bulk remove and restore", () => {
  it("changes only scanned rows and returns the changed ids", async () => {
    await pg.query("UPDATE videos SET status = 'done' WHERE user_id = $1 AND video_id = $2", [uid, vid(2)]);
    const { body } = await dismiss([vid(1), vid(2), vid(99)]).expect(200);
    expect(body).toEqual({ ok: true, removed: [vid(1)] });
  });

  it("queues removals only when allowed and an imports token exists", async () => {
    await dismiss([vid(1)]).expect(200);
    expect((await pg.query("SELECT count(*)::int AS n FROM youtube_removals", [])).rows[0].n).toBe(0);
    await db.createApiToken(uid, { tokenHash: hashToken("wll_imports"), scope: "imports", label: "Extension" });
    build("off");
    await dismiss([vid(2)]).expect(200);
    expect((await pg.query("SELECT count(*)::int AS n FROM youtube_removals", [])).rows[0].n).toBe(0);
    build("all");
    await dismiss([vid(3)]).expect(200);
    const { rows } = await pg.query("SELECT video_id, reason FROM youtube_removals WHERE user_id = $1", [uid]);
    expect(rows).toEqual([{ video_id: vid(3), reason: "dismissed" }]);
  });

  it("returns no ids on a second identical call", async () => {
    await dismiss([vid(1)]).expect(200);
    expect((await dismiss([vid(1)]).expect(200)).body.removed).toEqual([]);
  });

  it("restores dismissed rows, cancels pending and reports already removed", async () => {
    await db.createApiToken(uid, { tokenHash: hashToken("wll_imports"), scope: "imports", label: "Extension" });
    await dismiss([vid(1), vid(2)]).expect(200);
    await pg.query("UPDATE youtube_removals SET state = 'removed' WHERE user_id = $1 AND video_id = $2", [uid, vid(2)]);
    const { body } = await restore([vid(1), vid(2)]).expect(200);
    expect(body).toEqual({ ok: true, restored: [vid(1), vid(2)], alreadyOffYoutube: [vid(2)] });
    const statuses = await pg.query("SELECT video_id, status FROM videos WHERE user_id = $1 ORDER BY video_id", [uid]);
    expect(statuses.rows.slice(0, 2).map((r) => r.status)).toEqual(["scanned", "scanned"]);
    const queue = await pg.query("SELECT video_id, state FROM youtube_removals WHERE user_id = $1", [uid]);
    expect(queue.rows).toEqual([{ video_id: vid(2), state: "removed" }]);
  });

  it("requires auth and nonempty ids on both routes", async () => {
    await request(app).post("/api/videos/dismiss").send({ ids: [vid(1)] }).expect(401);
    await request(app).post("/api/videos/restore").send({ ids: [vid(1)] }).expect(401);
    await dismiss([]).expect(400);
    await restore([]).expect(400);
  });
});
