import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { TRANSCRIPT_CAP } from "./db.mjs";

const require = createRequire(import.meta.url);
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const FETCH_BUDGET = 8;

export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

// YouTube auto-captions repeat each line across rolling cues and wrap words
// in timing tags. Keep each new line once, with the start time of its cue,
// then group into ~30 s paragraphs so a reader can name a time range.
export function cleanVtt(vtt, { paragraphSeconds = 30 } = {}) {
  const cues = [];
  let t = null;
  let last = "";
  for (const line of String(vtt).replace(/\r/g, "").split("\n")) {
    const m = line.match(/^(?:(\d+):)?(\d{2}):(\d{2})\.\d{3}\s+-->/);
    if (m) {
      t = Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      continue;
    }
    if (t === null) continue;
    const text = line
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || /^\d+$/.test(text) || text === last) continue;
    last = text;
    cues.push({ t, text });
  }
  const paras = [];
  for (const c of cues) {
    const p = paras[paras.length - 1];
    if (p && c.t - p.t < paragraphSeconds) p.parts.push(c.text);
    else paras.push({ t: c.t, parts: [c.text] });
  }
  return paras.map((p) => `[${fmtTime(p.t)}] ${p.parts.join(" ")}`).join("\n").slice(0, TRANSCRIPT_CAP);
}

export function pickSubFiles(files) {
  const best = {};
  for (const f of files) {
    const m = f.match(/^([A-Za-z0-9_-]{11})\.([^.]+)\.vtt$/);
    if (!m) continue;
    const [, id, lang] = m;
    const rank = lang === "en" ? 0 : lang.startsWith("en") ? 1 : lang.startsWith("ko") ? 2 : 3;
    if (!best[id] || rank < best[id].rank) best[id] = { file: f, rank };
  }
  return Object.fromEntries(Object.entries(best).map(([id, v]) => [id, v.file]));
}

function loadSqlite() {
  // node:sqlite prints an ExperimentalWarning on Node 22; keep the CLI output clean.
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => (String(w).includes("SQLite") ? undefined : emit.call(process, w, ...rest));
  try {
    return require("node:sqlite").DatabaseSync;
  } finally {
    process.emitWarning = emit;
  }
}

export function libraryTranscripts(dbPath, ids) {
  if (!ids.length || !fs.existsSync(dbPath)) return {};
  const DatabaseSync = loadSqlite();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const marks = ids.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, transcript FROM videos WHERE id IN (${marks}) AND transcript IS NOT NULL AND transcript <> ''`)
      .all(...ids);
    return Object.fromEntries(rows.map((r) => [r.id, String(r.transcript).slice(0, TRANSCRIPT_CAP)]));
  } finally {
    db.close();
  }
}

// yt-dlp is never run from the shell by the skill: it accepts --exec and any
// output path, and the run reads third-party text. Fixed arguments only,
// user config ignored, output confined to the work folder.
export function ytDlpArgs(subsDir, ids) {
  for (const id of ids) {
    if (!ID_RE.test(id)) throw new Error(`bad video id: ${String(id).slice(0, 20)}`);
  }
  return [
    "--ignore-config", "--no-playlist", "--skip-download",
    "--write-subs", "--write-auto-subs", "--sub-langs", "en.*,ko.*", "--sub-format", "vtt",
    "--sleep-requests", "1",
    "-o", path.join(subsDir, "%(id)s.%(ext)s"),
    "--", ...ids.map((id) => `https://www.youtube.com/watch?v=${id}`),
  ];
}

export function runYtDlp(bin, args) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 180000, maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
      resolve({
        code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
        stderr: String(stderr || error?.message || "").trim(),
      });
    });
  });
}
