import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { fmtTime, cleanVtt, pickSubFiles, libraryTranscripts, ytDlpArgs, runYtDlp } from "../scripts/watch-picks/subs.mjs";
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
