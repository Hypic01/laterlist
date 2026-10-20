import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it, expect, beforeEach } from "vitest";
import { testDb, seedUser, U1, U2 } from "./helpers.js";
import { main } from "../scripts/watch-picks.mjs";

const require = createRequire(import.meta.url);
const vid = (n) => `vid${String(n).padStart(8, "0")}`;
const NOW = new Date(2026, 9, 12, 8, 0); // Monday 2026-10-12

async function seedVideo(pg, o) {
  await pg.query(
    `INSERT INTO videos (user_id, video_id, title, channel, duration_seconds, published_text, category, status, transcript)
     VALUES ($1,$2,$3,'Chan',600,'1 year ago',$4,'scanned',$5)`,
    [o.user ?? U1, o.id, o.title ?? "Title", o.category ?? "learn", o.transcript ?? null]
  );
}

let pg, db, root, deps, out, err;
beforeEach(async () => {
  ({ db, pg } = await testDb());
  await seedUser(db, U1, "u1@test.dev");
  await seedUser(db, U2, "u2@test.dev");
  root = fs.mkdtempSync(path.join(os.tmpdir(), "picks-cli-"));
  const envPath = path.join(root, ".env.picks");
  fs.writeFileSync(envPath, "PICKS_DATABASE_URL=postgresql://r:pw@localhost:5432/db\nPICKS_EMAIL=u1@test.dev\n");
  out = [];
  err = [];
  deps = {
    envPath,
    workRoot: path.join(root, "work"),
    picksDir: path.join(root, "Picks"),
    libraryDb: path.join(root, "library.db"),
    connect: async () => ({ query: (...a) => pg.query(...a), end: async () => {} }),
    now: NOW,
    out: (s) => out.push(s),
    err: (s) => err.push(s),
  };
});

const work = () => path.join(root, "work", "2026-10-12");

describe("watch-picks CLI", () => {
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

  it("search writes numbered results without spending the subtitle budget", async () => {
    const calls = [];
    deps.runYtDlp = async (_bin, args) => {
      calls.push(args);
      return { code: 0, stderr: "", stdout: JSON.stringify({ entries: [
        { id: vid(1), title: "Interview", channel: "Chan", duration: 600, view_count: 10, upload_date: "20261019" },
      ] }) };
    };
    expect(await main(["search", "--exec rm -rf ~"], deps)).toBe(0);
    expect(await main(["search", "interview", "--limit", "2"], deps)).toBe(0);
    expect(calls[0].at(-1)).toBe("ytsearch10:--exec rm -rf ~");
    expect(calls[1].at(-1)).toBe("ytsearch2:interview");
    expect(fs.existsSync(path.join(work(), "search-1.json"))).toBe(true);
    expect(fs.existsSync(path.join(work(), "search-2.json"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(work(), "search-1.json"), "utf8"))).toHaveLength(1);
    expect(out.join("\n")).toContain(vid(1));
    expect(out).toContain(`saved: ${path.join(work(), "search-2.json")}`);
    expect(fs.existsSync(path.join(work(), "fetch-count.json"))).toBe(false);
  });

  it("reports the last search failure line", async () => {
    deps.runYtDlp = async () => ({ code: 1, stderr: "warning\nHTTP Error 429", stdout: "" });
    expect(await main(["search", "interview"], deps)).toBe(1);
    expect(err).toEqual(["search failed: HTTP Error 429"]);
  });

  it("post reports picks across goals for a goal set", async () => {
    withApi([{ status: 200, body: { week: "2026-10-12", picks: 2, warnings: [] } }]);
    const json = path.join(root, "goals.json");
    const gp = (id) => ({ id, source: "youtube", title: "Title", channel: "Chan", durationSeconds: 600,
      author: "Designer", why: "Useful", action: "Practice", gets: [], covers: [] });
    fs.writeFileSync(json, JSON.stringify({ week: "2026-10-12", goals: [
      { name: "Job", need: "Interview", picks: [gp(vid(1)), gp(vid(2))] },
      { name: "Project", need: "Ship", picks: [] },
    ], closeButNo: [] }));
    expect(await main(["post", json], deps)).toBe(0);
    expect(out).toContain("posted: yes (2 picks across 2 goals for 2026-10-12)");
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

  it("unknown command prints usage and exits 2", async () => {
    expect(await main(["nope"], deps)).toBe(2);
    expect(err[0]).toMatch(/^usage:/);
  });

  it("work prints the weekly folder", async () => {
    expect(await main(["work"], deps)).toBe(0);
    expect(out).toEqual([work()]);
    expect(fs.existsSync(work())).toBe(true);
  });

  it("missing env exits 2 with one actionable line", async () => {
    expect(await main(["list"], { ...deps, envPath: path.join(root, "absent") })).toBe(2);
    expect(err).toHaveLength(1);
    expect(err[0]).toMatch(/Create it with PICKS_DATABASE_URL/);
    expect(err[0]).not.toMatch(/at .*\.mjs/);
  });

  it("list writes list.tsv and skips recent picks", async () => {
    await seedVideo(pg, { id: vid(1), title: "Keep" });
    await seedVideo(pg, { id: vid(2), title: "Picked last week" });
    await seedVideo(pg, { id: vid(3), category: "music" });
    fs.mkdirSync(deps.picksDir, { recursive: true });
    fs.writeFileSync(path.join(deps.picksDir, "2026-10-05.md"),
      `---\nweek: 2026-10-05\n---\n## 1. [Picked last week](https://www.youtube.com/watch?v=${vid(2)})\nVerdict: worth it\n`);
    expect(await main(["list"], deps)).toBe(0);
    const lines = fs.readFileSync(path.join(work(), "list.tsv"), "utf8").split("\n").filter(Boolean);
    expect(lines[0]).toBe("id\trow\tlength\tage\tchannel\ttitle\ttopics");
    expect(lines.slice(1)).toEqual([`${vid(1)}\tgist\t10m\t1y\tChan\tKeep\t`]);
    expect(out[0]).toMatch(/^1 eligible videos \(1 recent picks excluded\)/);
  });

  it("transcripts uses Laterlist first, then library.db, and reports missing and the cap", async () => {
    await seedVideo(pg, { id: vid(1), transcript: "from laterlist" });
    await seedVideo(pg, { id: vid(2) });
    await seedVideo(pg, { id: vid(3) });
    const { DatabaseSync } = require("node:sqlite");
    const lib = new DatabaseSync(deps.libraryDb);
    lib.exec("CREATE TABLE videos (id TEXT PRIMARY KEY, transcript TEXT)");
    lib.prepare("INSERT INTO videos VALUES (?, ?)").run(vid(2), "from library");
    lib.close();
    const many = [vid(1), vid(2), vid(3), ...Array.from({ length: 12 }, (_, i) => vid(100 + i))].join(",");
    expect(await main(["transcripts", many], deps)).toBe(0);
    expect(fs.readFileSync(path.join(work(), "t", `${vid(1)}.txt`), "utf8")).toBe("from laterlist");
    expect(fs.readFileSync(path.join(work(), "t", `${vid(2)}.txt`), "utf8")).toBe("from library");
    expect(out.join("\n")).toMatch(new RegExp(`missing: ${vid(3)},`));
    expect(out.join("\n")).toMatch(/3 over the cap of 12 dropped/);
  });

  it("details rejects an empty id list", async () => {
    expect(await main(["details", "bad,ids"], deps)).toBe(2);
    expect(err[0]).toMatch(/details needs comma-separated video ids/);
  });

  it("clean-subs turns vtt files into timed transcripts", async () => {
    fs.mkdirSync(path.join(work(), "subs"), { recursive: true });
    fs.writeFileSync(path.join(work(), "subs", `${vid(1)}.en.vtt`), "WEBVTT\n\n00:00:05.000 --> 00:00:07.000\nhello grids\n");
    expect(await main(["clean-subs"], deps)).toBe(0);
    expect(fs.readFileSync(path.join(work(), "t", `${vid(1)}.timed.txt`), "utf8")).toBe("[0:05] hello grids");
  });

  it("render twice in one week never overwrites", async () => {
    const json = path.join(root, "picks.json");
    fs.writeFileSync(json, JSON.stringify({
      week: "2026-10-12", focus: "Case studies", focusPoints: [],
      picks: [{ id: vid(1), title: "One", row: "learn", why: "Because", gets: [] }], closeButNo: [],
    }));
    expect(await main(["render", json], deps)).toBe(0);
    const first = path.join(deps.picksDir, "2026-10-12.md");
    fs.writeFileSync(first, fs.readFileSync(first, "utf8").replace("Verdict: worth it | not | skipped", "Verdict: worth it"));
    expect(await main(["render", json], deps)).toBe(0);
    expect(fs.readFileSync(first, "utf8")).toContain("Verdict: worth it\n");
    expect(fs.existsSync(path.join(deps.picksDir, "2026-10-12 (2).md"))).toBe(true);
    expect(fs.existsSync(path.join(deps.picksDir, "2026-10-12 (2).html"))).toBe(true);
    expect(out).toContain(path.join(deps.picksDir, "2026-10-12.html"));
  });

  it("render with broken JSON exits 2", async () => {
    const json = path.join(root, "picks.json");
    fs.writeFileSync(json, "{ not json");
    expect(await main(["render", json], deps)).toBe(2);
    expect(err[0]).toMatch(/picks.json is not valid JSON/);
  });

  it("past prints parsed picks with verdicts", async () => {
    fs.mkdirSync(deps.picksDir, { recursive: true });
    fs.writeFileSync(path.join(deps.picksDir, "2026-10-05.md"),
      `---\nweek: 2026-10-05\n---\n## 1. [One](https://www.youtube.com/watch?v=${vid(1)})\nVerdict: not\n`);
    expect(await main(["past"], deps)).toBe(0);
    expect(JSON.parse(out[0])).toEqual([{ week: "2026-10-05", id: vid(1), title: "One", verdict: "not" }]);
  });

  it("fetch-subs passes a fixed argument list, cleans the output, and enforces the weekly budget", async () => {
    fs.mkdirSync(work(), { recursive: true });
    fs.writeFileSync(path.join(work(), "fetch-count.json"), JSON.stringify({ fetched: 16 }));
    const calls = [];
    deps.ytDlp = "/fake/yt-dlp";
    deps.runYtDlp = async (bin, args) => {
      calls.push({ bin, args });
      const dir = args[args.indexOf("-o") + 1].replace("%(id)s.%(ext)s", "");
      for (const url of args.slice(args.indexOf("--") + 1)) {
        const id = url.split("v=")[1];
        fs.writeFileSync(`${dir}${id}.en.vtt`, `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi ${id}\n`);
      }
      return { code: 0, stderr: "" };
    };
    const five = (start) => Array.from({ length: 5 }, (_, i) => vid(start + i)).join(",");
    expect(await main(["fetch-subs", five(1)], deps)).toBe(0);
    expect(calls[0].bin).toBe("/fake/yt-dlp");
    expect(calls[0].args.slice(0, 3)).toEqual(["--ignore-config", "--no-playlist", "--skip-download"]);
    expect(calls[0].args.slice(calls[0].args.indexOf("--") + 1)).toHaveLength(5);
    expect(fs.readFileSync(path.join(work(), "t", `${vid(1)}.timed.txt`), "utf8")).toBe(`[0:01] hi ${vid(1)}`);
    expect(await main(["fetch-subs", five(10)], deps)).toBe(0);
    expect(calls[1].args.slice(calls[1].args.indexOf("--") + 1)).toHaveLength(3);
    expect(out.join("\n")).toMatch(/fetched 3 of 5; budget of 24 this week reached/);
    expect(await main(["fetch-subs", five(20)], deps)).toBe(0);
    expect(calls).toHaveLength(2);
    expect(out.join("\n")).toMatch(/fetch budget used up/);
  });

  it("fetch-subs rejects non-ids and reports a failing yt-dlp", async () => {
    deps.runYtDlp = async () => ({ code: 1, stderr: "WARNING: x\nERROR: HTTP Error 429: Too Many Requests" });
    expect(await main(["fetch-subs", "--exec=rm"], deps)).toBe(2);
    expect(err[0]).toMatch(/fetch-subs needs comma-separated video ids/);
    expect(await main(["fetch-subs", vid(1)], deps)).toBe(1);
    expect(out.join("\n")).toMatch(/yt-dlp exited 1: ERROR: HTTP Error 429/);
  });

  it("check fails when other users' rows are visible", async () => {
    await seedVideo(pg, { id: vid(1) });
    await seedVideo(pg, { id: vid(2), user: U2 });
    expect(await main(["check"], deps)).toBe(1);
    expect(out.join("\n")).toMatch(/PROBLEM: it can see 1 videos from other users/);
    expect(out.join("\n")).toMatch(/writable: no/);
  });
});
