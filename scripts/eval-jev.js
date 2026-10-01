// Jev vs Haiku classification eval. A read-only spike: it never writes to the
// database and never touches the production classify path. It runs the same
// videos through the current Haiku classifier (same prompt, chunking and
// validation as worker.js) and through Jev (TypeSafe's decision model, via
// OpenRouter), then reports accuracy, calibration, agreement, latency and cost.
//
//   node --env-file=.env scripts/eval-jev.js --file scripts/eval-jev.fixture.json
//   node --env-file=.env scripts/eval-jev.js --email you@example.com --limit 50 --sample 100
//   node --env-file=.env scripts/eval-jev.js --email you@example.com --export 100
//
// --export writes a random, unlabeled sample of that user's videos to
// spike/private/ with an empty "label" on each row. Fill the labels in by
// hand and pass the file back with --file: that is the unbiased head-to-head.
//
// Keys: ANTHROPIC_API_KEY, else Haiku via OPENROUTER_API_KEY, else fake (FAKE_LLM=1
// forces fake). OPENROUTER_API_KEY absent = fake Jev. DATABASE_URL for --email
// (absent = local PGlite dev DB). Taste examples are deliberately OFF in both arms: the override rows being scored
// are the same rows getRecentOverrides would feed in as examples.

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig, estimateCostUsd } from "../server/config.js";
import { createLlm, createFakeLlm } from "../server/anthropic.js";
import { buildClassificationPrompt, validateResults, RESULT_SCHEMA, TOPICS } from "../server/classify.js";
import { CATEGORIES } from "../server/db.js";
import {
  JEV_URL, JEV_DEFAULT_MODEL, JEV_CRITERIA, buildJevRequest, mapJevResponse, callJev, createFakeJevFetch,
} from "../server/jev.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The Jev client lives in server/jev.js (shared with the worker); re-exported
// here so the eval tests keep one import site.
export { JEV_URL, JEV_DEFAULT_MODEL, JEV_CRITERIA, buildJevRequest, mapJevResponse, callJev, createFakeJevFetch };
const TAGGED_TOPICS = TOPICS.filter((t) => t !== "other");

// Haiku through OpenRouter, for when no Anthropic key is at hand. Same model,
// same prompt and schema, same forced single tool call as server/anthropic.js;
// only the transport differs (OpenAI-style tools). Billed at Anthropic's rate.
export function createOpenRouterHaiku({ apiKey, model = "anthropic/claude-haiku-4.5", fetchImpl = fetch }) {
  return {
    async classifyChunk(prompt, schema) {
      const body = await callJev(
        {
          model,
          max_tokens: 4000,
          messages: [{ role: "user", content: prompt }],
          tools: [{ type: "function", function: { name: "emit_classification", description: "Return the classification results.", parameters: schema } }],
          tool_choice: { type: "function", function: { name: "emit_classification" } },
        },
        { apiKey, fetchImpl, url: "https://openrouter.ai/api/v1/chat/completions" }
      );
      const args = body.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!args) throw new Error("model did not return the classification tool call");
      return { data: JSON.parse(args), usage: { input: body.usage?.prompt_tokens ?? 0, output: body.usage?.completion_tokens ?? 0 } };
    },
  };
}

// ---- metrics ----

const CONFIDENCE_BUCKETS = [
  ["<0.5", (c) => c < 0.5],
  ["0.5-0.7", (c) => c >= 0.5 && c < 0.7],
  ["0.7-0.8", (c) => c >= 0.7 && c < 0.8],
  ["0.8+", (c) => c >= 0.8],
];

// labeled: [{ id, label }]; preds: Map id → { category, confidence }. Videos
// the arm failed to classify count as misses, so failures can't flatter it.
export function scoreArm(labeled, preds) {
  const confusion = Object.fromEntries(CATEGORIES.map((t) => [t, Object.fromEntries([...CATEGORIES, "failed"].map((p) => [p, 0]))]));
  let correct = 0;
  for (const { id, label } of labeled) {
    const pred = preds.get(id)?.category ?? "failed";
    confusion[label][pred]++;
    if (pred === label) correct++;
  }
  const perCategory = {};
  for (const cat of CATEGORIES) {
    const tp = confusion[cat][cat];
    const n = CATEGORIES.reduce((s, p) => s + confusion[cat][p], confusion[cat].failed);
    const predicted = CATEGORIES.reduce((s, t) => s + confusion[t][cat], 0);
    perCategory[cat] = { n, precision: predicted ? tp / predicted : null, recall: n ? tp / n : null };
  }
  const byConfidence = [...CONFIDENCE_BUCKETS, ["none", () => false]].map(([bucket, test]) => {
    const rows = labeled.filter(({ id }) => {
      const p = preds.get(id);
      if (!p) return false;
      return bucket === "none" ? p.confidence == null : p.confidence != null && test(p.confidence);
    });
    const hits = rows.filter(({ id, label }) => preds.get(id).category === label).length;
    return { bucket, n: rows.length, accuracy: rows.length ? hits / rows.length : null };
  });
  return { n: labeled.length, accuracy: labeled.length ? correct / labeled.length : null, perCategory, confusion, byConfidence };
}

export function compareArms(ids, a, b) {
  let both = 0, agree = 0, topicOverlap = 0;
  for (const id of ids) {
    const pa = a.get(id), pb = b.get(id);
    if (!pa || !pb) continue;
    both++;
    if (pa.category === pb.category) agree++;
    if (pa.topics.some((t) => pb.topics.includes(t))) topicOverlap++;
  }
  return { n: both, categoryAgreement: both ? agree / both : null, topicOverlap: both ? topicOverlap / both : null };
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

// ---- arms ----

async function runHaiku(videos, { llm, chunkSize, tasteProfile }) {
  const preds = new Map();
  const chunkMs = [];
  let inputTokens = 0, outputTokens = 0, failedChunks = 0;
  const start = Date.now();
  for (let i = 0; i < videos.length; i += chunkSize) {
    const chunk = videos.slice(i, i + chunkSize);
    const t0 = Date.now();
    // Two attempts per chunk: the worker retries failed chunks too, and a
    // one-off bad response shouldn't knock 25 videos out of the comparison.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { data, usage } = await llm.classifyChunk(buildClassificationPrompt(chunk, { tasteProfile }), RESULT_SCHEMA);
        inputTokens += usage.input;
        outputTokens += usage.output;
        for (const r of validateResults(data, chunk.map((v) => v.id))) preds.set(r.id, r);
        break;
      } catch (e) {
        console.warn(`\n[haiku] chunk ${i / chunkSize} attempt ${attempt} failed: ${e.message}`);
        if (attempt === 2) failedChunks++;
      }
    }
    chunkMs.push(Date.now() - t0);
    process.stdout.write(`\r[haiku] ${Math.min(i + chunkSize, videos.length)}/${videos.length}`);
  }
  process.stdout.write("\n");
  const n = videos.length;
  const syncCost = estimateCostUsd({ inputTokens, outputTokens, batch: false });
  return {
    preds,
    stats: {
      mode: "sync Messages API (prod imports over 500 use Batches: half price, much slower)",
      wallMs: Date.now() - start,
      chunkSize,
      chunkMsP50: percentile(chunkMs, 50),
      chunkMsP95: percentile(chunkMs, 95),
      failedChunks,
      inputTokens,
      outputTokens,
      costUsd: syncCost,
      costPer1kSync: n ? (syncCost / n) * 1000 : null,
      costPer1kBatch: n ? (estimateCostUsd({ inputTokens, outputTokens, batch: true }) / n) * 1000 : null,
    },
  };
}

async function runJev(videos, { apiKey, fetchImpl, model, concurrency, tasteProfile }) {
  const preds = new Map();
  const itemMs = [];
  let costUsd = 0, inputTokens = 0, failed = 0, done = 0, next = 0;
  const start = Date.now();
  const worker = async () => {
    while (next < videos.length) {
      const v = videos[next++];
      const t0 = Date.now();
      try {
        const r = mapJevResponse(await callJev(buildJevRequest(v, { model, tasteProfile }), { apiKey, fetchImpl }));
        preds.set(v.id, r);
        costUsd += r.costUsd;
        inputTokens += r.inputTokens;
      } catch (e) {
        failed++;
        console.warn(`\n[jev] ${v.id} failed: ${e.message}`);
      }
      itemMs.push(Date.now() - t0);
      process.stdout.write(`\r[jev] ${++done}/${videos.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, videos.length) }, worker));
  process.stdout.write("\n");
  const n = videos.length;
  return {
    preds,
    stats: {
      model,
      concurrency,
      wallMs: Date.now() - start,
      itemMsP50: percentile(itemMs, 50),
      itemMsP95: percentile(itemMs, 95),
      failed,
      inputTokens,
      avgInputTokensPerVideo: n ? inputTokens / n : null,
      costUsd,
      costPer1k: n ? (costUsd / n) * 1000 : null,
    },
  };
}

// ---- data ----

const VIDEO_COLS = "video_id AS id, title, channel, duration_seconds, published_text, category, override_from";

async function openDb(config) {
  // Deliberately not buildApp(): that runs migrations, and this script must
  // only ever SELECT, including against production.
  if (config.databaseUrl) {
    const pg = (await import("pg")).default;
    const local = /localhost|127\.0\.0\.1/.test(config.databaseUrl);
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1, ssl: local ? false : { rejectUnauthorized: false } });
    return { query: (sql, params) => pool.query(sql, params), close: () => pool.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(process.env.PGLITE_DIR || path.join(repoRoot, "dev-pgdata"));
  return { query: (sql, params) => db.query(sql, params), close: () => db.close() };
}

async function exportSample({ email, count }, config) {
  const db = await openDb(config);
  try {
    const { rows } = await db.query(
      `SELECT ${VIDEO_COLS} FROM videos v JOIN users u ON u.id = v.user_id
       WHERE lower(u.email) = lower($1) ORDER BY random() LIMIT $2`,
      [email, count]
    );
    const out = path.join(repoRoot, "spike", "private", `jev-labels-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const blank = rows.map(({ id, title, channel, duration_seconds, published_text }) =>
      ({ id, title, channel, duration_seconds, published_text, label: "" }));
    fs.writeFileSync(out, JSON.stringify(blank, null, 2));
    console.log(`wrote ${rows.length} unlabeled videos to ${path.relative(process.cwd(), out)}`);
    console.log(`fill each "label" with one of: ${CATEGORIES.join(", ")}, then run with --file`);
  } finally {
    await db.close();
  }
}

async function loadFromDb({ email, limit, sample }, config) {
  const db = await openDb(config);
  try {
    const { rows: users } = await db.query("SELECT id, taste_profile FROM users WHERE lower(email) = lower($1)", [email]);
    if (!users.length) throw new Error(`no user with email ${email}`);
    const user = users[0];
    const { rows: overrides } = await db.query(
      `SELECT ${VIDEO_COLS} FROM videos WHERE user_id = $1 AND manual_override
       ORDER BY override_seq DESC NULLS LAST LIMIT $2`,
      [user.id, limit]
    );
    const { rows: sampled } = sample
      ? await db.query(
          `SELECT ${VIDEO_COLS} FROM videos WHERE user_id = $1 AND NOT manual_override AND category IS NOT NULL
           ORDER BY random() LIMIT $2`,
          [user.id, sample]
        )
      : { rows: [] };
    return {
      source: `db overrides for ${email}`,
      tasteProfile: user.taste_profile || {},
      labeled: overrides.map((r) => ({ ...r, label: r.category })),
      unlabeled: sampled,
    };
  } finally {
    await db.close();
  }
}

// Rows with a blank label are still classified; they count toward agreement
// and get judged by hand in the HTML report (scripts/eval-jev-report.js).
function loadFromFile(file, limit) {
  const rows = JSON.parse(fs.readFileSync(file, "utf8")).slice(0, limit);
  const labeled = [], unlabeled = [];
  for (const [i, r] of rows.entries()) {
    const label = String(r.label ?? "").trim();
    const row = { ...r, id: String(r.id ?? `row-${i}`) };
    if (!label) { unlabeled.push(row); continue; }
    if (!CATEGORIES.includes(label)) throw new Error(`row ${i}: label "${label}" must be one of ${CATEGORIES.join(", ")}`);
    labeled.push({ ...row, label });
  }
  return { source: `file ${path.basename(file)}`, tasteProfile: {}, labeled, unlabeled };
}

// ---- report ----

const pct = (x) => (x == null ? "  -  " : `${(x * 100).toFixed(0).padStart(3)}%`);
const usd = (x) => (x == null ? "-" : `$${x.toFixed(x < 0.01 ? 5 : 3)}`);

function printArmScore(name, s) {
  console.log(`\n  ${name}: ${pct(s.accuracy)} accuracy on ${s.n}`);
  console.log(`    ${"category".padEnd(14)}   n  precision  recall`);
  for (const [cat, c] of Object.entries(s.perCategory)) {
    console.log(`    ${cat.padEnd(14)}${String(c.n).padStart(4)}     ${pct(c.precision)}    ${pct(c.recall)}`);
  }
  console.log(`    confidence: ${s.byConfidence.filter((b) => b.n).map((b) => `${b.bucket} ${pct(b.accuracy).trim()} (n=${b.n})`).join(" · ")}`);
  console.log(`    confusion (rows = truth): ${CATEGORIES.map((t) => `${t}→{${Object.entries(s.confusion[t]).filter(([, n]) => n).map(([p, n]) => `${p}:${n}`).join(" ")}}`).join("  ")}`);
}

function printReport(report) {
  const { haiku, jev } = report;
  console.log(`\n=== Jev vs Haiku · ${report.source} · ${report.counts.labeled} labeled + ${report.counts.unlabeled} unlabeled ===`);
  if (report.fakes.length) console.log(`  FAKE ARMS: ${report.fakes.join(", ")} (plumbing check only, numbers mean nothing)`);
  if (report.overrideCaveat) {
    console.log(
      `  NOTE: these are hard cases the current classifier already got wrong once` +
        ` (${report.overrideCaveat.withOverrideFrom} of ${report.counts.labeled} have override_from).` +
        ` Haiku is expected to score low here; use a hand-labeled --file for the fair head-to-head.`
    );
  }
  if (report.counts.labeled) {
    printArmScore("haiku", report.scores.haiku);
    printArmScore("jev", report.scores.jev);
  }
  const a = report.agreement;
  console.log(`\n  agreement (n=${a.n}): category ${pct(a.categoryAgreement)} · topic overlap ${pct(a.topicOverlap)}`);
  console.log(`\n  speed + cost`);
  console.log(`    haiku  wall ${(haiku.wallMs / 1000).toFixed(1)}s · chunk p50 ${haiku.chunkMsP50}ms p95 ${haiku.chunkMsP95}ms (${haiku.chunkSize}/chunk) · failed chunks ${haiku.failedChunks}`);
  console.log(`           ${usd(haiku.costPer1kSync)}/1k videos sync, ${usd(haiku.costPer1kBatch)}/1k batch (${haiku.inputTokens} in / ${haiku.outputTokens} out tokens)`);
  console.log(`    jev    wall ${(jev.wallMs / 1000).toFixed(1)}s · item p50 ${jev.itemMsP50}ms p95 ${jev.itemMsP95}ms (x${jev.concurrency}) · failed ${jev.failed}`);
  console.log(`           ${usd(jev.costPer1k)}/1k videos (${jev.avgInputTokensPerVideo?.toFixed(0)} input tokens/video incl. ${TAGGED_TOPICS.length} topic questions)`);
}

// ---- main ----

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      email: { type: "string" },
      limit: { type: "string" },
      sample: { type: "string", default: "0" },
      concurrency: { type: "string", default: "8" },
      "jev-model": { type: "string" },
      export: { type: "string" },
    },
  });
  const config = loadConfig();
  if (values.export) {
    if (!values.email) throw new Error("--export needs --email");
    return exportSample({ email: values.email, count: Number(values.export) }, config);
  }
  if (!values.file === !values.email) {
    console.error("usage: scripts/eval-jev.js (--file labeled.json | --email you@example.com [--sample N | --export N]) [--limit N] [--concurrency N] [--jev-model id]");
    process.exit(2);
  }
  // --file uses every labeled row unless told otherwise; --email defaults to 50.
  const limit = values.limit ? Number(values.limit) : values.file ? Infinity : 50;
  const data = values.file
    ? loadFromFile(values.file, limit)
    : await loadFromDb({ email: values.email, limit, sample: Number(values.sample) }, config);
  const videos = [...data.labeled, ...data.unlabeled];
  if (!videos.length) throw new Error(`no videos found (${data.source})`);

  const fakes = [];
  const apiKey = process.env.OPENROUTER_API_KEY || "";
  let llm;
  if (config.anthropicApiKey && !config.fakeLlm) {
    llm = createLlm({ apiKey: config.anthropicApiKey, model: config.classifyModel });
  } else if (apiKey && !config.fakeLlm) {
    llm = createOpenRouterHaiku({ apiKey });
  } else {
    llm = createFakeLlm();
    fakes.push("haiku");
  }
  const fetchImpl = apiKey ? fetch : createFakeJevFetch();
  if (!apiKey) fakes.push("jev");

  const haiku = await runHaiku(videos, { llm, chunkSize: config.chunkSize, tasteProfile: data.tasteProfile });
  const jev = await runJev(videos, {
    apiKey,
    fetchImpl,
    model: values["jev-model"] || process.env.JEV_MODEL || JEV_DEFAULT_MODEL,
    concurrency: Number(values.concurrency),
    tasteProfile: data.tasteProfile,
  });

  const labeled = data.labeled.map(({ id, label }) => ({ id, label }));
  const report = {
    ranAt: new Date().toISOString(),
    source: data.source,
    fakes,
    counts: { labeled: labeled.length, unlabeled: data.unlabeled.length },
    overrideCaveat: values.email ? { withOverrideFrom: data.labeled.filter((v) => v.override_from).length } : null,
    scores: { haiku: scoreArm(labeled, haiku.preds), jev: scoreArm(labeled, jev.preds) },
    agreement: compareArms(videos.map((v) => v.id), haiku.preds, jev.preds),
    haiku: haiku.stats,
    jev: jev.stats,
    videos: videos.map((v) => ({
      id: v.id,
      title: v.title,
      channel: v.channel,
      duration_seconds: v.duration_seconds ?? null,
      published_text: v.published_text ?? null,
      label: v.label ?? null,
      haiku: haiku.preds.get(v.id) ?? null,
      jev: jev.preds.get(v.id) ? { ...jev.preds.get(v.id) } : null,
    })),
  };
  printReport(report);

  // spike/private is gitignored: the per-video dump holds real saved titles.
  const outDir = path.join(repoRoot, "spike", "private");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `jev-eval-${report.ranAt.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n  full report: ${path.relative(process.cwd(), out)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
