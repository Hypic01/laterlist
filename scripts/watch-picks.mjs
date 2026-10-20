#!/usr/bin/env node
// Weekly watch picks: deterministic helpers for the watch-picks skill.
// Read-only against Laterlist; writes only to the weekly work folder and the
// vault Picks folder. Usage and design: .plans/weekly-watch-picks.md
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PicksEnvError, loadPicksEnv, connect, withReadOnly, validIds, listEligible,
  formatListLine, getDetails, getTranscripts, checkAccess,
} from "./watch-picks/db.mjs";
import { cleanVtt, pickSubFiles, libraryTranscripts, ytDlpArgs, runYtDlp, searchArgs, parseSearch, FETCH_BUDGET } from "./watch-picks/subs.mjs";
import {
  PicksDataError, validatePicks, renderHtml, renderMarkdown, outputPaths, pastPicks, weekId,
} from "./watch-picks/render.mjs";

import { PicksApiError, postPicks, fetchHistory } from "./watch-picks/api.mjs";

const PICKS_DIR = path.join(os.homedir(), "Obsidian", "Joon", "2. Areas", "Mentor", "Picks");

export const DEFAULTS = {
  envPath: path.join(os.homedir(), ".config", "watch-picks", ".env.picks"),
  workRoot: path.join(PICKS_DIR, ".work"),
  picksDir: PICKS_DIR,
  libraryDb: path.join(os.homedir(), "projects", "watch-later-librarian", "library.db"),
  ytDlp: "/Library/Frameworks/Python.framework/Versions/3.10/bin/yt-dlp",
};

const USAGE = "usage: watch-picks.mjs <work|check|list|search <query> [--limit N]|details <ids>|transcripts <ids>|fetch-subs <ids>|clean-subs|render <picks.json>|post <picks.json>|past [weeks]>";

function cleanSubs(work, out) {
  const subs = path.join(work, "subs");
  const chosen = pickSubFiles(fs.existsSync(subs) ? fs.readdirSync(subs) : []);
  const dir = path.join(work, "t");
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, f] of Object.entries(chosen)) {
    const text = cleanVtt(fs.readFileSync(path.join(subs, f), "utf8"));
    fs.writeFileSync(path.join(dir, `${id}.timed.txt`), text);
    out(`${id}\t${f}\t${text.length} chars`);
  }
  if (!Object.keys(chosen).length) out(`no .vtt files in ${subs}`);
}

export async function main(argv, deps = {}) {
  const o = {
    ...DEFAULTS,
    connect,
    runYtDlp,
    fetchImpl: globalThis.fetch,
    now: new Date(),
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
    ...deps,
  };
  const [cmd, arg] = argv;
  const work = path.join(o.workRoot, weekId(o.now));
  const ensureWork = () => fs.mkdirSync(work, { recursive: true });

  const withDb = async (fn) => {
    const { url, email } = loadPicksEnv(o.envPath);
    const client = await o.connect(url);
    try {
      return await withReadOnly(client, (q) => fn(q, email));
    } finally {
      await client.end();
    }
  };

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

  try {
    switch (cmd) {
      case "work": {
        ensureWork();
        o.out(work);
        return 0;
      }
      case "check": {
        const r = await withDb((q, email) => checkAccess(q, { email }));
        for (const c of r.counts) o.out(`${c.category ?? "unsorted"}\t${c.status}\t${c.n}`);
        o.out(`other users' videos visible: ${r.others}`);
        o.out(`writable: ${r.writable ? "YES" : "no"}`);
        o.out(r.ok ? "OK: read-only and scoped to you" : `PROBLEM: ${r.problems.join("; ")}`);
        return r.ok ? 0 : 1;
      }
      case "list": {
        const exclude = [...new Set((await recentPicks(8)).map((p) => p.id))];
        const rows = await withDb((q, email) => listEligible(q, { email, excludeIds: exclude }));
        ensureWork();
        const file = path.join(work, "list.tsv");
        fs.writeFileSync(file, ["id\trow\tlength\tage\tchannel\ttitle\ttopics", ...rows.map(formatListLine)].join("\n") + "\n");
        o.out(`${rows.length} eligible videos (${exclude.length} recent picks excluded) -> ${file}`);
        return 0;
      }
      case "search": {
        if (!arg) {
          o.err("search needs a query");
          return 2;
        }
        if (argv.length > 2 && (argv[2] !== "--limit" || argv.length !== 4)) {
          o.err(USAGE);
          return 2;
        }
        const args = searchArgs(arg, argv[3] ?? 10);
        const result = await o.runYtDlp(o.ytDlp, args);
        if (result.code !== 0) {
          o.err(`search failed: ${result.stderr.split("\n").filter(Boolean).pop() || "no output"}`);
          return 1;
        }
        const rows = parseSearch(result.stdout);
        ensureWork();
        let n = 1;
        while (fs.existsSync(path.join(work, `search-${n}.json`))) n++;
        const file = path.join(work, `search-${n}.json`);
        fs.writeFileSync(file, JSON.stringify(rows, null, 2));
        for (const row of rows) o.out([row.id, row.durationSeconds, row.views ?? "", row.uploadDate, row.channel, row.title].join("\t"));
        o.out(`saved: ${file}`);
        return 0;
      }
      case "details": {
        const { ids, dropped } = validIds(arg, 40);
        if (!ids.length) {
          o.err("details needs comma-separated video ids");
          return 2;
        }
        const rows = await withDb((q, email) => getDetails(q, { email, ids }));
        ensureWork();
        const file = path.join(work, "details.json");
        fs.writeFileSync(file, JSON.stringify(rows, null, 2));
        o.out(`${rows.length} of ${ids.length} found${dropped ? `, ${dropped} over the cap of 40 dropped` : ""} -> ${file}`);
        return 0;
      }
      case "transcripts": {
        const { ids, dropped } = validIds(arg, 12);
        if (!ids.length) {
          o.err("transcripts needs comma-separated video ids");
          return 2;
        }
        const cached = await withDb((q, email) => getTranscripts(q, { email, ids }));
        const lib = libraryTranscripts(o.libraryDb, ids.filter((id) => !cached[id]));
        ensureWork();
        const dir = path.join(work, "t");
        fs.mkdirSync(dir, { recursive: true });
        const missing = [];
        for (const id of ids) {
          const text = cached[id] || lib[id];
          if (!text) {
            missing.push(id);
            continue;
          }
          fs.writeFileSync(path.join(dir, `${id}.txt`), text);
          o.out(`${id}\t${cached[id] ? "laterlist" : "library"}\t${text.length} chars`);
        }
        o.out(`missing: ${missing.join(",") || "none"}${dropped ? ` (${dropped} over the cap of 12 dropped)` : ""}`);
        o.out(`files in ${dir}`);
        return 0;
      }
      case "fetch-subs": {
        const { ids } = validIds(arg, FETCH_BUDGET);
        if (!ids.length) {
          o.err("fetch-subs needs comma-separated video ids");
          return 2;
        }
        ensureWork();
        const counter = path.join(work, "fetch-count.json");
        const used = fs.existsSync(counter) ? Number(JSON.parse(fs.readFileSync(counter, "utf8")).fetched) || 0 : 0;
        const take = ids.slice(0, Math.max(0, FETCH_BUDGET - used));
        if (!take.length) {
          o.out(`fetch budget used up (${FETCH_BUDGET} this week); judge the rest on metadata`);
          return 0;
        }
        // Count attempts, not successes: the budget protects the IP from YouTube's rate limit.
        fs.writeFileSync(counter, JSON.stringify({ fetched: used + take.length }));
        const subs = path.join(work, "subs");
        fs.mkdirSync(subs, { recursive: true });
        const r = await o.runYtDlp(o.ytDlp, ytDlpArgs(subs, take));
        if (take.length < ids.length) o.out(`fetched ${take.length} of ${ids.length}; budget of ${FETCH_BUDGET} this week reached`);
        cleanSubs(work, o.out);
        if (r.code !== 0) {
          o.out(`yt-dlp exited ${r.code}: ${r.stderr.split("\n").filter(Boolean).pop() || "no output"}`);
          return 1;
        }
        return 0;
      }
      case "clean-subs": {
        ensureWork();
        cleanSubs(work, o.out);
        return 0;
      }
      case "render": {
        if (!arg) {
          o.err("render needs the path to picks.json");
          return 2;
        }
        let raw;
        try {
          raw = JSON.parse(fs.readFileSync(arg, "utf8"));
        } catch (e) {
          throw new PicksDataError(`picks.json is not valid JSON: ${String(e.message).split("\n")[0]}`);
        }
        const data = validatePicks(raw);
        fs.mkdirSync(o.picksDir, { recursive: true });
        const { html, md } = outputPaths(o.picksDir, data.week);
        fs.writeFileSync(html, renderHtml(data));
        fs.writeFileSync(md, renderMarkdown(data));
        o.out(html);
        o.out(md);
        return 0;
      }
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
          o.out(Array.isArray(data.goals)
            ? `posted: yes (${data.goals.reduce((n, g) => n + g.picks.length, 0)} picks across ${data.goals.length} goals for ${data.week})`
            : `posted: yes (${data.picks.length} picks for ${data.week})`);
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
      case "past": {
        const weeks = Number(arg) > 0 ? Number(arg) : 8;
        o.out(JSON.stringify(await recentPicks(weeks), null, 2));
        return 0;
      }
      default:
        o.err(USAGE);
        return 2;
    }
  } catch (e) {
    if (e instanceof PicksEnvError || e instanceof PicksDataError) {
      o.err(e.message);
      return 2;
    }
    o.err(`watch-picks ${cmd} failed: ${String(e?.message || e).split("\n")[0]}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
