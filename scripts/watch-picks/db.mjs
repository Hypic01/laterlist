import fs from "node:fs";
import pg from "pg";

// Read-only data access for the weekly watch picks. Every function takes a
// `q` with .query(sql, params) — a single pg.Client in production, PGlite in
// tests. Never a pg.Pool: the Supabase pooler is in transaction mode, so
// separate pool queries could escape the BEGIN READ ONLY guard.

export class PicksEnvError extends Error {}

export const DESCRIPTION_CAP = 1000;
export const TRANSCRIPT_CAP = 20000;

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function loadPicksEnv(envPath) {
  let raw;
  try {
    raw = fs.readFileSync(envPath, "utf8");
  } catch {
    throw new PicksEnvError(
      `No ${envPath}. Create it with PICKS_DATABASE_URL and PICKS_EMAIL (.plans/weekly-watch-picks.md, Task 0).`
    );
  }
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  const url = env.PICKS_DATABASE_URL || "";
  const email = env.PICKS_EMAIL || "";
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new PicksEnvError(`PICKS_DATABASE_URL in ${envPath} is missing or not a postgres:// URL.`);
  }
  if (!email.includes("@")) {
    throw new PicksEnvError(`PICKS_EMAIL in ${envPath} is missing.`);
  }
  return { url, email };
}

export async function connect(url) {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const client = new pg.Client({
    connectionString: url,
    ssl: local ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  return client;
}

export async function withReadOnly(q, fn) {
  await q.query("BEGIN READ ONLY");
  try {
    return await fn(q);
  } finally {
    await q.query("ROLLBACK");
  }
}

export function validIds(ids, max) {
  const raw = (Array.isArray(ids) ? ids : String(ids || "").split(","))
    .map((s) => String(s).trim())
    .filter(Boolean);
  const valid = raw.filter((s) => ID_RE.test(s));
  const unique = [...new Set(valid)];
  return {
    ids: unique.slice(0, max),
    dropped: Math.max(0, unique.length - max),
    invalid: raw.length - valid.length,
  };
}

export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "?";
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

const AGE_UNITS = {
  year: "y", month: "mo", week: "w", day: "d", hour: "h",
  "년": "y", "개월": "mo", "주": "w", "일": "d", "시간": "h",
};

export function compactAge(publishedText, uploadDate) {
  const m = String(publishedText || "").match(/(\d+)\s*(year|month|week|day|hour|년|개월|주|일|시간)/i);
  if (m) return `${m[1]}${AGE_UNITS[m[2].toLowerCase()]}`;
  const y = String(uploadDate || "").match(/^(\d{4})/);
  return y ? y[1] : "?";
}

const flat = (s) => String(s ?? "").replace(/[\t\r\n]+/g, " ").replace(/ {2,}/g, " ").trim();
const ROWS = { learn: "gist", watch: "watch" };

export function formatListLine(row) {
  const topics = Array.isArray(row.topics)
    ? row.topics.map(flat).filter(Boolean).slice(0, 3).join(", ")
    : "";
  return [
    row.video_id,
    ROWS[row.category] || flat(row.category) || "?",
    formatDuration(row.duration_seconds),
    compactAge(row.published_text, row.upload_date),
    flat(row.channel) || "?",
    flat(row.title) || "?",
    topics,
  ].join("\t");
}

export async function listEligible(q, { email, excludeIds = [] }) {
  const { rows } = await q.query(
    `SELECT v.video_id, v.title, v.channel, v.duration_seconds, v.published_text,
            v.upload_date, v.category, v.topics
       FROM videos v JOIN users u ON u.id = v.user_id
      WHERE u.email = $1
        AND v.category IN ('learn', 'watch')
        AND v.status NOT IN ('done', 'dismissed')
        AND NOT (v.video_id = ANY($2::text[]))
      ORDER BY v.playlist_position NULLS LAST, v.video_id`,
    [email, excludeIds]
  );
  return rows;
}

export async function getDetails(q, { email, ids }) {
  const { rows } = await q.query(
    `SELECT v.video_id, v.title, v.channel, v.duration_seconds, v.category, v.description
       FROM videos v JOIN users u ON u.id = v.user_id
      WHERE u.email = $1 AND v.video_id = ANY($2::text[])
      ORDER BY v.video_id`,
    [email, ids]
  );
  return rows.map((r) => ({ ...r, description: String(r.description || "").slice(0, DESCRIPTION_CAP) }));
}

export async function getTranscripts(q, { email, ids }) {
  const { rows } = await q.query(
    `SELECT v.video_id, v.transcript
       FROM videos v JOIN users u ON u.id = v.user_id
      WHERE u.email = $1 AND v.video_id = ANY($2::text[])
        AND v.transcript IS NOT NULL AND v.transcript <> ''`,
    [email, ids]
  );
  return Object.fromEntries(rows.map((r) => [r.video_id, String(r.transcript).slice(0, TRANSCRIPT_CAP)]));
}

// Run inside withReadOnly. Proves the two guarantees the weekly run relies on:
// the session cannot write, and it sees no other user's videos.
export async function checkAccess(q, { email }) {
  const { rows: counts } = await q.query(
    `SELECT v.category, v.status, count(*)::int AS n
       FROM videos v JOIN users u ON u.id = v.user_id
      WHERE u.email = $1
      GROUP BY 1, 2 ORDER BY 1, 2`,
    [email]
  );
  const { rows: [{ n: others }] } = await q.query(
    `SELECT count(*)::int AS n FROM videos
      WHERE user_id NOT IN (SELECT id FROM users WHERE email = $1)`,
    [email]
  );
  await q.query("SAVEPOINT probe");
  let writable = true;
  try {
    await q.query("CREATE TEMP TABLE _picks_probe (x int)");
  } catch {
    writable = false;
  }
  await q.query("ROLLBACK TO SAVEPOINT probe");
  const problems = [];
  if (writable) problems.push("the session can write");
  if (others > 0) problems.push(`it can see ${others} videos from other users`);
  if (!counts.length) problems.push("no videos found for PICKS_EMAIL");
  return { counts, others, writable, ok: problems.length === 0, problems };
}
