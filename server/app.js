// Route factory. Everything injected: db, auth, importer, worker (job engine).

import express from "express";
import fs from "node:fs";
import crypto from "node:crypto";
import { CATEGORIES } from "./db.js";
import { hashToken } from "./auth.js";
import { estimateCostUsd } from "./config.js";
import { PicksDataError, validatePicks, VERDICTS, pickIds, isRealDate } from "./picks.js";

const MAX_TRANSCRIPT_BYTES = 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 250000;
const TRANSCRIPT_FAILURE = "YouTube would not hand captions to our server. With the Chrome extension we fetch them straight from your browser instead.";

function optionalText(value, max) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function transcriptFields(body, defaultSource) {
  if (typeof body?.transcript !== "string" || !body.transcript.trim()) {
    return { error: { status: 400, body: { error: "transcript is required" } } };
  }
  if (Buffer.byteLength(body.transcript, "utf8") > MAX_TRANSCRIPT_BYTES) {
    return { error: { status: 413, body: { error: "transcript is too large" } } };
  }
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : body;
  const rawDuration = metadata.durationSeconds ?? metadata.duration_seconds;
  const duration = Number(rawDuration);
  const truncated = body.transcript.length > MAX_TRANSCRIPT_CHARS;
  return {
    value: {
      transcript: body.transcript.slice(0, MAX_TRANSCRIPT_CHARS),
      source: optionalText(body.source ?? metadata.source, 50) || defaultSource,
      description: optionalText(metadata.description, 5000),
      uploadDate: optionalText(metadata.uploadDate ?? metadata.upload_date, 40),
      durationSeconds: Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : null,
      channel: optionalText(metadata.channel, 120),
      truncated,
    },
  };
}

function publicApiToken(row) {
  return {
    id: row.id,
    scope: row.scope,
    label: row.label,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
  };
}

export function createApp({
  db,
  auth,
  importer,
  worker,
  background = null,
  mentor,
  transcripts,
  config,
  collectorPath,
  randomBytes = crypto.randomBytes,
}) {
  const app = express();
  const removalAllowed = (user) => config.youtubeRemoval === "all"
    || (config.youtubeRemoval === "admins" && !!user?.isAdmin);

  async function persistTranscript(userId, videoId, body, defaultSource) {
    const parsed = transcriptFields(body, defaultSource);
    if (parsed.error) return parsed.error;
    const { truncated, ...fields } = parsed.value;
    const found = await db.saveTranscript(userId, videoId, fields);
    if (!found) return { status: 404, body: { error: "unknown video" } };
    return {
      status: 200,
      body: { ok: true, truncated, transcriptAvailable: true },
    };
  }

  async function summaryBudgetPaused() {
    const kill = await db.getConfig("kill_switch");
    if (kill?.on) return true;
    const usage = await db.getConfig("global_usage");
    if (usage && Number(usage.est_cost_usd || 0) >= config.budgetUsd) {
      await db.setConfig("kill_switch", { on: true, reason: "budget ceiling reached" });
      return true;
    }
    return false;
  }

  const extensionOrigins = new Set(config.extensionOrigins || []);
  app.use((req, res, next) => {
    const imports = req.path === "/api/imports";
    if (!imports && !req.path.startsWith("/api/youtube-removals")) return next();
    res.vary("Origin");
    const origin = req.get("Origin");
    if (origin && extensionOrigins.has(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Access-Control-Allow-Headers", "content-type, x-import-token");
      res.set("Access-Control-Allow-Methods", imports ? "POST, OPTIONS" : "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });

  app.use(express.json({ limit: "12mb" }));

  app.get("/api/health", (req, res) => res.json({ ok: true }));

  app.get("/collector.js", (req, res) => {
    if (!collectorPath || !fs.existsSync(collectorPath)) return res.status(404).send("// collector not built");
    res.type("application/javascript").send(fs.readFileSync(collectorPath, "utf8"));
  });

  // ---- me ----
  app.get("/api/me", auth.required, async (req, res) => {
    const u = await db.getUser(req.user.id);
    const [counts, lastImportAt] = await Promise.all([
      db.counts(req.user.id),
      db.lastImportAt(req.user.id),
    ]);
    res.json({
      id: u.id,
      email: u.email,
      isAdmin: req.user.isAdmin,
      tasteProfile: u.taste_profile,
      counts,
      lastImportAt,
      hasTaste: u.taste_profile && Object.keys(u.taste_profile).length > 0,
      removeFromYoutube: removalAllowed(req.user) && u.remove_from_youtube !== false,
      youtubeRemovalAvailable: removalAllowed(req.user),
    });
  });

  app.put("/api/me/prefs", auth.required, async (req, res) => {
    const { removeFromYoutube } = req.body || {};
    if (typeof removeFromYoutube !== "boolean") {
      return res.status(400).json({ error: "removeFromYoutube must be a boolean" });
    }
    await db.setRemoveFromYoutube(req.user.id, removeFromYoutube);
    res.json({ ok: true, removeFromYoutube });
  });

  app.put("/api/me/taste", auth.required, async (req, res) => {
    const { interests, note } = req.body || {};
    if (interests && !Array.isArray(interests)) return res.status(400).json({ error: "interests must be an array" });
    const profile = {
      interests: (interests || []).map(String).slice(0, 15),
      note: String(note || "").slice(0, 280),
    };
    await db.setTasteProfile(req.user.id, profile);
    res.json({ ok: true });
  });

  app.delete("/api/me", auth.required, async (req, res) => {
    await db.deleteUser(req.user.id);
    res.json({ ok: true });
  });

  // ---- api tokens ----
  app.post("/api/tokens", auth.required, async (req, res) => {
    const scope = String(req.body?.scope || "");
    if (!["imports", "bridge", "picks"].includes(scope)) return res.status(400).json({ error: "unknown token scope" });
    if (scope === "bridge" && !req.user.isAdmin) return res.status(403).json({ error: "admin only" });
    const label = String(req.body?.label || "").trim().slice(0, 100);
    const token = "wll_" + randomBytes(32).toString("base64url");
    const row = await db.createApiToken(req.user.id, {
      tokenHash: hashToken(token),
      scope,
      label,
    });
    res.json({ token, ...publicApiToken(row) });
  });

  app.get("/api/tokens", auth.required, async (req, res) => {
    const tokens = await db.listApiTokens(req.user.id);
    res.json(tokens.map(publicApiToken));
  });

  app.delete("/api/tokens/:id", auth.required, async (req, res) => {
    const id = req.params.id;
    if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) {
      return res.status(404).json({ error: "unknown token" });
    }
    const ok = await db.revokeApiToken(req.user.id, id);
    if (!ok) return res.status(404).json({ error: "unknown token" });
    res.json({ ok: true });
  });

  // ---- imports & jobs ----
  app.post("/api/imports", auth.jwtOrToken("imports"), async (req, res) => {
    const result = await importer.handleImport(req.user, req.body);
    // Sort without waiting for a tab to poll. Registered before replying so
    // the work is attached to this invocation (waitUntil).
    if (result.body?.jobId) background?.kick();
    res.status(result.status).json(result.body);
  });

  app.post("/api/jobs/classify-remaining", auth.required, async (req, res) => {
    const result = await importer.classifyRemaining(req.user);
    if (result.body?.jobId) background?.kick();
    res.status(result.status).json(result.body);
  });

  app.get("/api/jobs/current", auth.required, async (req, res) => {
    // Serverless mode: polls only read. A job nobody is working (no live
    // lease, e.g. its run crashed) gets a background run restarted; without
    // background support, fall back to advancing it inside the poll.
    if (worker && config.serverless) {
      const active = await db.getActiveJob(req.user.id);
      if (active && background) {
        if (!active.lease_until || new Date(active.lease_until) < new Date()) background.kick();
      } else if (active) {
        await worker.tick({ budgetMs: config.pollAdvanceBudgetMs }).catch(() => {});
      }
    }
    const job = (await db.getActiveJob(req.user.id)) || (await db.getLatestJob(req.user.id));
    if (!job) return res.json({ job: null });
    res.json({
      job: {
        id: job.id,
        state: job.state,
        mode: job.mode,
        tier: job.tier,
        total: job.total,
        processed: job.processed,
        failed: job.failed,
        error: job.error,
      },
    });
  });

  app.post("/api/jobs/:id/cancel", auth.required, async (req, res) => {
    const ok = await db.cancelJob(req.user.id, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: "no cancellable job" });
    res.json({ ok: true });
  });

  // ---- board & video actions ----
  app.get("/api/board", auth.required, async (req, res) => {
    res.json(await db.getBoard(req.user.id));
  });

  app.get("/api/status", auth.required, async (req, res) => {
    const counts = await db.counts(req.user.id);
    const job = await db.getActiveJob(req.user.id);
    const kill = await db.getConfig("kill_switch");
    res.json({
      counts,
      job: job ? { id: job.id, state: job.state, total: job.total, processed: job.processed } : null,
      paused: !!kill?.on,
    });
  });

  app.get("/api/cleanup", auth.required, async (req, res) => {
    res.json(await db.getCleanup(req.user.id));
  });

  app.get("/api/youtube-removals", auth.jwtOrToken("imports"), async (req, res) => {
    const removals = removalAllowed(req.user)
      ? await db.pendingYoutubeRemovals(req.user.id)
      : [];
    res.json({ removals });
  });

  app.post("/api/youtube-removals/results", auth.jwtOrToken("imports"), async (req, res) => {
    if (!removalAllowed(req.user)) return res.json({ ok: true });
    const results = req.body?.results;
    if (!Array.isArray(results) || results.length > 50 || results.some((item) =>
      !item || typeof item !== "object" || Array.isArray(item)
      || typeof item.videoId !== "string" || !item.videoId
      || typeof item.ok !== "boolean"
      || (item.error !== undefined && typeof item.error !== "string")
    )) {
      return res.status(400).json({ error: "invalid removal results" });
    }
    await db.recordYoutubeRemovalResults(req.user.id, results);
    res.json({ ok: true });
  });

  app.get("/api/videos/:id", auth.required, async (req, res) => {
    const video = await db.getVideoDetail(req.user.id, req.params.id);
    if (!video) return res.status(404).json({ error: "unknown video" });
    res.json(video);
  });

  app.post("/api/videos/:id/transcript", auth.required, async (req, res) => {
    const result = await persistTranscript(req.user.id, req.params.id, req.body, "extension");
    res.status(result.status).json(result.body);
  });

  app.post("/api/videos/:id/transcript/fetch", auth.required, async (req, res) => {
    if (!(await db.getVideo(req.user.id, req.params.id))) {
      return res.status(404).json({ error: "unknown video" });
    }
    try {
      if (!transcripts) throw new Error("transcript fetcher unavailable");
      const fetched = await transcripts.fetchTranscript(req.params.id);
      const result = await persistTranscript(req.user.id, req.params.id, fetched, "server");
      if (result.status !== 200) return res.status(result.status).json(result.body);
      res.json(result.body);
    } catch {
      res.status(502).json({ error: TRANSCRIPT_FAILURE });
    }
  });

  app.post("/api/videos/:id/summary", auth.required, async (req, res) => {
    const [detail, user] = await Promise.all([
      db.getVideoDetail(req.user.id, req.params.id),
      db.getUser(req.user.id),
    ]);
    if (!detail) return res.status(404).json({ error: "unknown video" });
    if (detail.summary) {
      return res.json({ summary: detail.summary, cached: true });
    }
    const video = await db.getVideoTranscript(req.user.id, req.params.id);
    if (!video.transcript_available || !video.transcript) {
      return res.status(400).json({
        error: "Fetch the transcript before asking for a summary.",
        needsTranscript: true,
      });
    }

    if (!mentor) {
      return res.status(503).json({ error: "The summary service is not configured yet." });
    }
    if (await summaryBudgetPaused()) {
      return res.status(503).json({ error: "Summaries are temporarily paused. Please try again later." });
    }

    let generated;
    try {
      generated = await mentor.summarize(video, { tasteProfile: user.taste_profile || {} });
    } catch {
      return res.status(502).json({ error: "Couldn't summarize this video. Please try again." });
    }
    const usage = {
      input: Math.max(0, Math.floor(Number(generated.usage?.input) || 0)),
      output: Math.max(0, Math.floor(Number(generated.usage?.output) || 0)),
    };
    const saved = await db.saveSummary(req.user.id, req.params.id, {
      summary: generated.summary,
      model: generated.model || config.classifyModel,
      inputTokens: usage.input,
      outputTokens: usage.output,
    });

    // A concurrent request may have filled the cache while this request was at
    // the model. Return that winner.
    if (!saved) {
      const winner = await db.getSummary(req.user.id, req.params.id);
      if (winner) return res.json({ summary: winner.summary, cached: true });
      return res.status(502).json({ error: "Couldn't save this summary. Please try again." });
    }

    await db.addUsage({
      userId: req.user.id,
      jobId: null,
      inputTokens: usage.input,
      outputTokens: usage.output,
      videosClassified: 0,
      costUsd: estimateCostUsd({ inputTokens: usage.input, outputTokens: usage.output, batch: false }),
    });
    res.json({ summary: generated.summary, cached: false });
  });

  app.post("/api/videos/:id/category", auth.required, async (req, res) => {
    const { category } = req.body || {};
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: "unknown category" });
    const ok = await db.setCategory(req.user.id, req.params.id, category);
    if (!ok) return res.status(404).json({ error: "unknown video" });
    res.json({ ok: true });
  });

  app.post("/api/videos/:id/dismiss", auth.required, async (req, res) => {
    const ok = await db.dismiss(req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: "unknown video" });
    if (removalAllowed(req.user)) {
      await db.enqueueYoutubeRemovals(req.user.id, [req.params.id], "dismissed");
    }
    res.json({ ok: true });
  });

  app.post("/api/videos/:id/keep", auth.required, async (req, res) => {
    const ok = await db.keep(req.user.id, req.params.id);
    if (!ok) return res.status(404).json({ error: "unknown video" });
    res.json({ ok: true });
  });

  app.post("/api/videos/done", auth.required, async (req, res) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: "ids required" });
    const moved = await db.markDoneIds(req.user.id, ids.map(String).slice(0, 500));
    if (moved.length && removalAllowed(req.user)) {
      await db.enqueueYoutubeRemovals(req.user.id, moved, "done");
    }
    res.json({ ok: true, marked: moved.length });
  });

  // ---- weekly picks: the Mac run posts, the app shows (2026-10-12) ----
  app.post("/api/picks", auth.jwtOrToken("picks"), async (req, res) => {
    let set;
    try {
      set = validatePicks(req.body);
    } catch (e) {
      if (e instanceof PicksDataError) return res.status(400).json({ error: e.message });
      throw e;
    }
    if (set.error) return res.status(400).json({ error: "an error-only picks set is not stored" });
    const ids = pickIds(set);
    const have = await db.libraryHas(req.user.id, ids);
    const unknown = ids.find((id) => !have.has(id));
    if (unknown) return res.status(400).json({ error: `video ${unknown} is not in your library` });
    await db.upsertPickSet(req.user.id, set.week, set);
    res.json({ week: set.week, picks: set.picks.length });
  });

  app.get("/api/picks/current", auth.required, async (req, res) => {
    const row = await db.latestPickSet(req.user.id);
    if (!row) return res.json({ set: null });
    const p = row.payload;
    const [videos, verdicts] = await Promise.all([
      db.videosByIds(req.user.id, pickIds(p)),
      db.pickVerdicts(req.user.id, row.week),
    ]);
    res.json({
      set: {
        ...p,
        week: row.week,
        updatedAt: row.updated_at,
        picks: p.picks.map((x) => ({ ...x, video: videos[x.id] || null, verdict: verdicts[x.id] || null })),
        // Openable only while it is still on the board (scanned), where the app looks it up.
        closeButNo: p.closeButNo.map((x) => ({ ...x, inLibrary: videos[x.id]?.status === "scanned" })),
      },
    });
  });

  app.post("/api/picks/:week/verdict", auth.required, async (req, res) => {
    const { week } = req.params;
    const { videoId, verdict } = req.body || {};
    if (!isRealDate(week)) return res.status(400).json({ error: "bad week" });
    if (!VERDICTS.includes(verdict)) return res.status(400).json({ error: "verdict must be worth, not or skipped" });
    if (!/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ""))) return res.status(400).json({ error: "bad video id" });
    // Only a current pick of that week can get a verdict (and be marked done).
    const set = await db.pickSet(req.user.id, week);
    if (!set || !(set.payload.picks || []).some((x) => x.id === videoId)) {
      return res.status(404).json({ error: "that video is not one of this week's picks" });
    }
    await db.setPickVerdict(req.user.id, week, videoId, verdict);
    let marked = 0;
    if (verdict !== "skipped") {
      const moved = await db.markDoneIds(req.user.id, [videoId]);
      marked = moved.length;
      if (moved.length && removalAllowed(req.user)) {
        await db.enqueueYoutubeRemovals(req.user.id, moved, "done");
      }
    }
    res.json({ ok: true, marked });
  });

  app.get("/api/picks/history", auth.jwtOrToken("picks"), async (req, res) => {
    const weeks = Math.min(52, Math.max(1, Number(req.query.weeks) || 8));
    res.json(await db.pickHistory(req.user.id, weeks));
  });

  // Cron backstop (Vercel sends Authorization: Bearer CRON_SECRET): catches
  // abandoned jobs when nobody is polling. Also the hand-off target for a
  // background run nearing its time limit (x-background-hop counts the chain).
  app.get("/api/cron/advance", async (req, res) => {
    if (!config.cronSecret || req.headers.authorization !== `Bearer ${config.cronSecret}`) {
      return res.status(401).json({ error: "unauthorized" });
    }
    if (background) {
      const hop = Math.max(0, Math.min(Number.parseInt(req.headers["x-background-hop"], 10) || 0, 1000));
      background.kick(hop);
      return res.status(202).json({ ok: true });
    }
    if (worker) await worker.tick({ budgetMs: 50000 }).catch(() => {});
    res.json({ ok: true });
  });

  // ---- admin ----
  app.get("/api/admin/stats", auth.admin, async (req, res) => {
    res.json(await db.adminStats());
  });

  app.post("/api/admin/kill-switch", auth.admin, async (req, res) => {
    const { on, reason } = req.body || {};
    await db.setConfig("kill_switch", { on: !!on, reason: String(reason || "") });
    res.json({ ok: true, on: !!on });
  });

  return app;
}
