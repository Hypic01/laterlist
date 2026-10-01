import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { testDb, vids } from "./helpers.js";
import { createApp } from "../server/app.js";
import { createAuth, fakeVerifier } from "../server/auth.js";
import { createImporter } from "../server/importer.js";
import { createWorker } from "../server/worker.js";
import { createBackground } from "../server/background.js";
import { createJevClassifier, createFakeJevFetch } from "../server/jev.js";
import { loadConfig } from "../server/config.js";

const config = loadConfig({
  SERVERLESS: "1", CRON_SECRET: "s3cret", APP_URL: "https://laterlist.test", BACKGROUND_MAX_HOPS: "3",
});

// Runs whatever is handed to waitUntil and lets the test await all of it.
function collectWaitUntil() {
  const pending = [];
  const waitUntil = (p) => pending.push(p);
  return { waitUntil, settle: () => Promise.all(pending.splice(0)) };
}

function fakeFetch() {
  const calls = [];
  const fetchImpl = async (url, init) => (calls.push({ url, headers: init.headers }), new Response("{}", { status: 202 }));
  return { calls, fetchImpl };
}

describe("createBackground hand-off", () => {
  const stubDb = (pending) => ({ getJobsInState: async () => pending });

  it("hands off to a fresh invocation when work is left", async () => {
    const { waitUntil, settle } = collectWaitUntil();
    const { calls, fetchImpl } = fakeFetch();
    const bg = createBackground({ worker: { tick: async () => true }, db: stubDb([{ id: 1 }]), config, waitUntil, fetchImpl });
    bg.kick(1);
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://laterlist.test/api/cron/advance");
    expect(calls[0].headers).toEqual({ authorization: "Bearer s3cret", "x-background-hop": "2" });
  });

  it("stops when the job finished, when nothing was due, and at the hop limit", async () => {
    for (const [tick, pending, hop] of [[true, [], 0], [false, [{ id: 1 }], 0], [true, [{ id: 1 }], 3]]) {
      const { waitUntil, settle } = collectWaitUntil();
      const { calls, fetchImpl } = fakeFetch();
      createBackground({ worker: { tick: async () => tick }, db: stubDb(pending), config, waitUntil, fetchImpl }).kick(hop);
      await settle();
      expect(calls).toHaveLength(0);
    }
  });

  it("swallows a failed run instead of crashing the invocation", async () => {
    const { waitUntil, settle } = collectWaitUntil();
    const logs = [];
    createBackground({ worker: { tick: async () => { throw new Error("db down"); } }, db: stubDb([]), config, waitUntil, log: (m) => logs.push(m) }).kick();
    await settle();
    expect(logs[0]).toMatch(/db down/);
  });
});

describe("serverless routes with background sorting", () => {
  let db, app, bg, kicks;

  beforeEach(async () => {
    ({ db } = await testDb());
    const auth = createAuth({ verify: fakeVerifier(), db, adminEmails: [] });
    const importer = createImporter({ db, config });
    const classifier = createJevClassifier({ apiKey: "", fetchImpl: createFakeJevFetch(), sleep: async () => {} });
    const worker = createWorker({ db, llm: null, classifier, config });
    const { waitUntil, settle } = collectWaitUntil();
    const real = createBackground({ worker, db, config, waitUntil, fetchImpl: fakeFetch().fetchImpl });
    kicks = [];
    bg = { kick: (hop = 0) => (kicks.push(hop), real.kick(hop)), settle };
    app = createApp({ db, auth, importer, worker, background: bg, config });
  });

  const asUser = (r) => r.set("Authorization", "Bearer dev:bg@test.dev");

  it("an import sorts in the background with no polling at all", async () => {
    const res = await asUser(request(app).post("/api/imports"))
      .send({ v: 1, source: "console", videos: vids(30) }).expect(200);
    expect(kicks).toEqual([0]);
    await bg.settle();
    const job = await db.getJob(res.body.jobId);
    expect(job.state).toBe("completed");
    expect(job.processed).toBe(30);
  });

  it("a poll only restarts a job nobody is working on", async () => {
    const me = await asUser(request(app).get("/api/me")).expect(200);
    await db.upsertFromImport(me.body.id, vids(5), 10000);
    await db.createJob(me.body.id, { mode: "sync", tier: "pro", total: 5 });
    const job = await db.claimNextJob(60); // a live run holds it
    kicks.length = 0;
    await asUser(request(app).get("/api/jobs/current")).expect(200);
    expect(kicks).toEqual([]);
    await db.releaseLease(job.id); // that run died
    await asUser(request(app).get("/api/jobs/current")).expect(200);
    expect(kicks).toEqual([0]);
    await bg.settle();
  });

  it("the hand-off route answers at once and continues the chain", async () => {
    await request(app).get("/api/cron/advance").expect(401);
    await request(app).get("/api/cron/advance").set("authorization", "Bearer s3cret").set("x-background-hop", "2").expect(202);
    await request(app).get("/api/cron/advance").set("authorization", "Bearer s3cret").set("x-background-hop", "junk").expect(202);
    expect(kicks).toEqual([2, 0]);
    await bg.settle();
  });
});
