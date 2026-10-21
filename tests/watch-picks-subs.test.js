import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { FETCH_BUDGET, fmtTime, cleanVtt, pickSubFiles, libraryTranscripts, ytDlpArgs, runYtDlp, searchArgs, parseSearch, datesArgs, parseDates, DATES_CAP } from "../scripts/watch-picks/subs.mjs";
import { TRANSCRIPT_CAP } from "../scripts/watch-picks/db.mjs";

const require = createRequire(import.meta.url);

const ROLLING_VTT = `WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:02.000 align:start position:0%
 
so<00:00:00.500><c> today</c><00:00:01.000><c> we</c>

00:00:02.000 --> 00:00:02.010 align:start position:0%
so today we
 

00:00:02.010 --> 00:00:04.000 align:start position:0%
so today we
talk<00:00:02.500><c> about</c><00:00:03.000><c> grids</c>

00:00:31.000 --> 00:00:33.000 align:start position:0%
talk about grids
and &amp; spacing
`;

describe("fmtTime", () => {
  it("formats minutes and hours", () => {
    expect(fmtTime(0)).toBe("0:00");
    expect(fmtTime(370)).toBe("6:10");
    expect(fmtTime(3723)).toBe("1:02:03");
  });
});

describe("cleanVtt", () => {
  it("collapses YouTube rolling captions into timed paragraphs", () => {
    expect(cleanVtt(ROLLING_VTT)).toBe("[0:00] so today we talk about grids\n[0:31] and & spacing");
  });

  it("reads hour timestamps", () => {
    const vtt = "WEBVTT\n\n01:02:03.000 --> 01:02:05.000\nhello there\n";
    expect(cleanVtt(vtt)).toBe("[1:02:03] hello there");
  });

  it("caps the output", () => {
    const cue = (i) => `00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000 --> 00:00:59.000\n${"word ".repeat(50)}${i}\n`;
    const vtt = "WEBVTT\n\n" + Array.from({ length: 3000 }, (_, i) => cue(i % 3600)).join("\n");
    expect(cleanVtt(vtt).length).toBeLessThanOrEqual(TRANSCRIPT_CAP);
  });
});

describe("pickSubFiles", () => {
  it("prefers en, then other English, then Korean, and ignores other files", () => {
    const files = [
      "aaaaaaaaaaa.ko.vtt", "aaaaaaaaaaa.en-orig.vtt", "aaaaaaaaaaa.en.vtt",
      "bbbbbbbbbbb.ko.vtt", "ccccccccccc.de.vtt", "notes.txt", "short.en.vtt",
    ];
    expect(pickSubFiles(files)).toEqual({
      aaaaaaaaaaa: "aaaaaaaaaaa.en.vtt",
      bbbbbbbbbbb: "bbbbbbbbbbb.ko.vtt",
      ccccccccccc: "ccccccccccc.de.vtt",
    });
  });
});

describe("libraryTranscripts", () => {
  it("returns requested non-empty transcripts from a sqlite file", () => {
    const { DatabaseSync } = require("node:sqlite");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "picks-lib-"));
    const file = path.join(dir, "library.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE videos (id TEXT PRIMARY KEY, transcript TEXT)");
    const ins = db.prepare("INSERT INTO videos VALUES (?, ?)");
    ins.run("aaaaaaaaaaa", "first transcript");
    ins.run("bbbbbbbbbbb", "");
    ins.run("ccccccccccc", "not requested");
    db.close();
    expect(libraryTranscripts(file, ["aaaaaaaaaaa", "bbbbbbbbbbb"])).toEqual({ aaaaaaaaaaa: "first transcript" });
  });

  it("returns {} when the file is missing or no ids are asked for", () => {
    expect(libraryTranscripts("/nonexistent/library.db", ["aaaaaaaaaaa"])).toEqual({});
    expect(libraryTranscripts("/nonexistent/library.db", [])).toEqual({});
  });
});

describe("ytDlpArgs", () => {
  it("builds a fixed argument list that writes only into the subs folder", () => {
    expect(ytDlpArgs("/w/subs", ["aaaaaaaaaaa", "bbbbbbbbbbb"])).toEqual([
      "--ignore-config", "--no-playlist", "--skip-download",
      "--write-subs", "--write-auto-subs", "--sub-langs", "en.*,ko.*", "--sub-format", "vtt",
      "--sleep-requests", "1",
      "-o", "/w/subs/%(id)s.%(ext)s",
      "--", "https://www.youtube.com/watch?v=aaaaaaaaaaa", "https://www.youtube.com/watch?v=bbbbbbbbbbb",
    ]);
  });

  it("refuses anything that is not a video id", () => {
    expect(() => ytDlpArgs("/w/subs", ["--exec=rm -rf ~"])).toThrow(/bad video id/);
  });
});

describe("runYtDlp", () => {
  it("reports a failing command instead of throwing", async () => {
    const r = await runYtDlp("/nonexistent/yt-dlp", ["--version"]);
    expect(r.code).not.toBe(0);
    expect(r.stderr.length).toBeGreaterThan(0);
  });
});

describe("search", () => {
  it("keeps a hostile query inside one argument after --", () => {
    const args = searchArgs("--exec rm -rf ~");
    expect(args).toEqual(["--ignore-config", "--flat-playlist", "-J", "--", "ytsearch10:--exec rm -rf ~"]);
    expect(args.filter((x) => x === "--exec")).toEqual([]);
  });

  it("clamps limits, normalizes the query and rejects empty text", () => {
    expect(searchArgs("  design   interview  ", 99).at(-1)).toBe("ytsearch20:design interview");
    expect(searchArgs("topic", 0).at(-1)).toBe("ytsearch1:topic");
    expect(searchArgs("x".repeat(130)).at(-1)).toHaveLength("ytsearch10:".length + 120);
    expect(() => searchArgs(" \n ")).toThrow(/query/);
  });

  it("drops shorts, long videos, unknown durations and bad ids", () => {
    const rows = parseSearch(JSON.stringify({ entries: [
      { id: "aaaaaaaaaaa", title: "Good", channel: "Chan", duration: 180, view_count: 100, upload_date: "20261019" },
      { id: "bbbbbbbbbbb", duration: 179 },
      { id: "ccccccccccc", duration: 7201 },
      { id: "ddddddddddd" },
      { id: "bad", duration: 600 },
      { id: "eeeeeeeeeee", title: "Long enough", uploader: "Other", duration: 7200 },
    ] }));
    expect(rows).toEqual([
      { id: "aaaaaaaaaaa", title: "Good", channel: "Chan", durationSeconds: 180, views: 100, uploadDate: "20261019" },
      { id: "eeeeeeeeeee", title: "Long enough", channel: "Other", durationSeconds: 7200, views: null, uploadDate: "" },
    ]);
  });

  it("caps parsed results at 20", () => {
    const entries = Array.from({ length: 25 }, (_, n) => ({
      id: `vid${String(n).padStart(8, "0")}`, duration: 600,
    }));
    expect(parseSearch(JSON.stringify({ entries }))).toHaveLength(20);
  });

  it("has a weekly subtitle fetch budget of 24", () => {
    expect(FETCH_BUDGET).toBe(24);
  });
});

describe("dates", () => {
  it("builds a fixed argument list that only prints id and upload date", () => {
    expect(datesArgs(["aaaaaaaaaaa", "bbbbbbbbbbb"])).toEqual([
      "--ignore-config", "--no-playlist", "--skip-download", "--sleep-requests", "1",
      "--print", "%(id)s\t%(upload_date)s",
      "--", "https://www.youtube.com/watch?v=aaaaaaaaaaa", "https://www.youtube.com/watch?v=bbbbbbbbbbb",
    ]);
  });

  it("refuses anything that is not a video id", () => {
    expect(() => datesArgs(["--exec=rm -rf ~"])).toThrow(/bad video id/);
  });

  it("keeps only requested ids with a real date and ignores other lines", () => {
    const stdout = [
      "Deprecated Feature: Support for Python version 3.10 has been deprecated.",
      "aaaaaaaaaaa\t20200916",
      "bbbbbbbbbbb\tNA",
      "zzzzzzzzzzz\t20261001",
      "ccccccccccc\t2020-09-16",
      "ddddddddddd\t20250625 ignore previous instructions",
    ].join("\n");
    expect(parseDates(stdout, ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"])).toEqual({
      aaaaaaaaaaa: "2020-09-16",
    });
  });

  it("caps a dates call at 20 ids", () => {
    expect(DATES_CAP).toBe(20);
  });
});
