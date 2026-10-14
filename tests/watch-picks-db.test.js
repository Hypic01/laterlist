import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, seedUser, U1, U2 } from "./helpers.js";
import {
  PicksEnvError, loadPicksEnv, withReadOnly, validIds, formatDuration, compactAge,
  formatListLine, listEligible, getDetails, getTranscripts, checkAccess,
  DESCRIPTION_CAP, TRANSCRIPT_CAP,
} from "../scripts/watch-picks/db.mjs";

const vid = (n) => `vid${String(n).padStart(8, "0")}`; // 11 chars

async function seedVideo(pg, o) {
  await pg.query(
    `INSERT INTO videos (user_id, video_id, title, channel, duration_seconds, published_text,
       category, status, transcript, description, topics, playlist_position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [o.user ?? U1, o.id, o.title ?? "Title", o.channel ?? "Chan", o.duration ?? 600,
     o.published ?? "1 year ago", o.category === undefined ? "learn" : o.category, o.status ?? "scanned",
     o.transcript ?? null, o.description ?? null,
     o.topics === undefined ? null : JSON.stringify(o.topics), o.position ?? 1]
  );
}

function tmpFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "picks-env-"));
  const file = path.join(dir, ".env.picks");
  if (contents !== null) fs.writeFileSync(file, contents);
  return file;
}

describe("loadPicksEnv", () => {
  it("reads both keys and strips quotes", () => {
    const file = tmpFile('PICKS_DATABASE_URL="postgresql://r.ref:secretpw@host:6543/postgres"\nPICKS_EMAIL=me@test.dev\n');
    expect(loadPicksEnv(file)).toEqual({ url: "postgresql://r.ref:secretpw@host:6543/postgres", email: "me@test.dev", apiToken: "", appUrl: "https://laterlist-app.vercel.app" });
  });

  it("reads the optional API token and app URL", () => {
    const file = tmpFile("PICKS_DATABASE_URL=postgresql://r:p@h:6543/postgres\nPICKS_EMAIL=me@test.dev\nPICKS_API_TOKEN=wll_k\nPICKS_APP_URL=https://laterlist.test/\n");
    expect(loadPicksEnv(file)).toMatchObject({ apiToken: "wll_k", appUrl: "https://laterlist.test" });
    const bare = tmpFile("PICKS_DATABASE_URL=postgresql://r:p@h:6543/postgres\nPICKS_EMAIL=me@test.dev\n");
    expect(loadPicksEnv(bare)).toMatchObject({ apiToken: "", appUrl: "https://laterlist-app.vercel.app" });
  });

  it("missing file gives an actionable PicksEnvError", () => {
    const file = tmpFile(null);
    expect(() => loadPicksEnv(file)).toThrow(PicksEnvError);
    expect(() => loadPicksEnv(file)).toThrow(/Create it with PICKS_DATABASE_URL and PICKS_EMAIL/);
  });

  it("rejects the redacted [SENSITIVE] value and an empty file", () => {
    expect(() => loadPicksEnv(tmpFile('PICKS_DATABASE_URL="[SENSITIVE]"\nPICKS_EMAIL=me@test.dev\n'))).toThrow(PicksEnvError);
    expect(() => loadPicksEnv(tmpFile(""))).toThrow(PicksEnvError);
  });

  it("requires PICKS_EMAIL and never echoes the password", () => {
    const file = tmpFile("PICKS_DATABASE_URL=postgresql://r.ref:secretpw@host:6543/postgres\n");
    try {
      loadPicksEnv(file);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PicksEnvError);
      expect(e.message).toMatch(/PICKS_EMAIL/);
      expect(e.message).not.toMatch(/secretpw/);
    }
  });
});

describe("validIds", () => {
  it("drops malformed ids, dedupes, caps, and reports counts", () => {
    const r = validIds(`${vid(1)},${vid(1)},short,${vid(2)}' OR 1=1--,${vid(3)},${vid(4)}`, 2);
    expect(r.ids).toEqual([vid(1), vid(3)]);
    expect(r.dropped).toBe(1);
    expect(r.invalid).toBe(2);
  });

  it("accepts an array", () => {
    expect(validIds([vid(5)], 12).ids).toEqual([vid(5)]);
  });
});

describe("formatting", () => {
  it("formatDuration", () => {
    expect(formatDuration(null)).toBe("?");
    expect(formatDuration(20)).toBe("1m");
    expect(formatDuration(1860)).toBe("31m");
    expect(formatDuration(3900)).toBe("1h05m");
  });

  it("compactAge reads English and Korean age text, then falls back to the upload year", () => {
    expect(compactAge("3 years ago", null)).toBe("3y");
    expect(compactAge("Streamed 11 months ago", null)).toBe("11mo");
    expect(compactAge("2 weeks ago", null)).toBe("2w");
    expect(compactAge("3년 전", null)).toBe("3y");
    expect(compactAge("5개월 전", null)).toBe("5mo");
    expect(compactAge(null, "20240115")).toBe("2024");
    expect(compactAge(null, null)).toBe("?");
  });

  it("formatListLine handles missing data", () => {
    const line = formatListLine({
      video_id: vid(1), category: "watch", duration_seconds: null, published_text: null,
      upload_date: null, channel: "", title: "Tabs\there\nand newline", topics: null,
    });
    const fields = line.split("\t");
    expect(fields).toHaveLength(7);
    expect(fields).toEqual([vid(1), "watch", "?", "?", "?", "Tabs here and newline", ""]);
    expect(line).not.toMatch(/null|NaN|undefined/);
  });

  it("formatListLine maps learn to gist and keeps 3 topics", () => {
    const line = formatListLine({
      video_id: vid(2), category: "learn", duration_seconds: 600, published_text: "1 year ago",
      upload_date: null, channel: "Chan", title: "Grids", topics: ["design", "layout", "grids", "extra"],
    });
    expect(line).toBe(`${vid(2)}\tgist\t10m\t1y\tChan\tGrids\tdesign, layout, grids`);
  });
});

describe("queries", () => {
  let db, pg;
  beforeEach(async () => {
    ({ db, pg } = await testDb());
    await seedUser(db, U1, "u1@test.dev");
    await seedUser(db, U2, "u2@test.dev");
  });

  it("listEligible keeps only learn/watch, open status, own rows, not excluded", async () => {
    await seedVideo(pg, { id: vid(1), category: "learn" });
    await seedVideo(pg, { id: vid(2), category: "watch" });
    await seedVideo(pg, { id: vid(3), category: "music" });
    await seedVideo(pg, { id: vid(4), category: "entertainment" });
    await seedVideo(pg, { id: vid(5), category: "outdated" });
    await seedVideo(pg, { id: vid(6), status: "done" });
    await seedVideo(pg, { id: vid(7), status: "dismissed" });
    await seedVideo(pg, { id: vid(8), category: null, status: "unscanned" });
    await seedVideo(pg, { id: vid(9) });
    await seedVideo(pg, { id: vid(10), user: U2 });
    const rows = await listEligible(pg, { email: "u1@test.dev", excludeIds: [vid(9)] });
    expect(rows.map((r) => r.video_id).sort()).toEqual([vid(1), vid(2)]);
  });

  it("getDetails is scoped to the user and caps descriptions", async () => {
    await seedVideo(pg, { id: vid(1), description: "x".repeat(5000) });
    await seedVideo(pg, { id: vid(2), user: U2, description: "theirs" });
    const rows = await getDetails(pg, { email: "u1@test.dev", ids: [vid(1), vid(2)] });
    expect(rows.map((r) => r.video_id)).toEqual([vid(1)]);
    expect(rows[0].description).toHaveLength(DESCRIPTION_CAP);
  });

  it("getTranscripts returns only non-empty own transcripts, capped", async () => {
    await seedVideo(pg, { id: vid(1), transcript: "y".repeat(30000) });
    await seedVideo(pg, { id: vid(2), transcript: "" });
    await seedVideo(pg, { id: vid(3), user: U2, transcript: "theirs" });
    const t = await getTranscripts(pg, { email: "u1@test.dev", ids: [vid(1), vid(2), vid(3)] });
    expect(Object.keys(t)).toEqual([vid(1)]);
    expect(t[vid(1)]).toHaveLength(TRANSCRIPT_CAP);
  });

  it("withReadOnly blocks writes and ends the transaction", async () => {
    await expect(
      withReadOnly(pg, (q) => q.query("CREATE TABLE should_fail (x int)"))
    ).rejects.toThrow(/read-only transaction/);
    await pg.query("CREATE TABLE fine_now (x int)");
  });

  it("checkAccess flags visible rows from other users", async () => {
    await seedVideo(pg, { id: vid(1) });
    await seedVideo(pg, { id: vid(2), user: U2 });
    const r = await withReadOnly(pg, (q) => checkAccess(q, { email: "u1@test.dev" }));
    expect(r.writable).toBe(false);
    expect(r.others).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/other users/);
  });

  it("checkAccess passes when the session is read-only and sees only its own rows", async () => {
    await seedVideo(pg, { id: vid(1) });
    const r = await withReadOnly(pg, (q) => checkAccess(q, { email: "u1@test.dev" }));
    expect(r).toMatchObject({ writable: false, others: 0, ok: true, problems: [] });
    expect(r.counts).toEqual([{ category: "learn", status: "scanned", n: 1 }]);
  });

  it("checkAccess flags an email with no videos", async () => {
    const r = await withReadOnly(pg, (q) => checkAccess(q, { email: "nobody@test.dev" }));
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/no videos found/);
  });
});
