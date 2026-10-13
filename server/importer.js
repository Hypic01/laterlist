// Import handling. One safety cap limits stored videos; every stored video is
// classified. The old plan and video_cap database columns are unused.

const VIDEO_ID_RE = /^[\w-]{5,20}$/;
const CONTROL_RE = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]", "g");

function sanitizeVideos(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (const v of raw.slice(0, 20000)) {
    if (!v || typeof v.id !== "string" || !VIDEO_ID_RE.test(v.id) || seen.has(v.id)) continue;
    seen.add(v.id);
    const clean = (s, max) =>
      String(s ?? "")
        .replace(CONTROL_RE, " ")
        .trim()
        .slice(0, max);
    out.push({
      id: v.id,
      title: clean(v.title, 300),
      channel: clean(v.channel, 120),
      durationSeconds: Number.isFinite(Number(v.durationSeconds)) && Number(v.durationSeconds) > 0 ? Math.floor(Number(v.durationSeconds)) : null,
      position: Number.isFinite(Number(v.position)) ? Math.floor(Number(v.position)) : null,
      publishedText: v.publishedText ? clean(v.publishedText, 60) : null,
    });
  }
  return out;
}

export function createImporter({ db, config }) {
  async function startJob(user, total) {
    // Only Haiku has a batch API; Jev sorts thousands in seconds synchronously.
    const mode = total > config.batchThreshold && config.classifier === "haiku" ? "batch" : "sync";
    // The job schema still requires a vestigial tier value.
    return db.createJob(user.id, { mode, tier: "pro", total });
  }

  return {
    async handleImport(user, body) {
      if (config.llmReady === false) {
        return { status: 503, body: { error: "the sorting engine isn't configured yet — check back soon" } };
      }
      const source = ["console", "extension", "file"].includes(body?.source) ? body.source : null;
      const videos = sanitizeVideos(body?.videos);
      if (!source || !videos) return { status: 400, body: { error: "malformed payload" } };
      if (!videos.length) return { status: 400, body: { error: "no valid videos in payload" } };

      const recent = await db.countRecentImports(user.id, 60);
      if (recent >= config.importsPerHour) {
        return { status: 429, body: { error: "too many imports — try again in an hour" } };
      }
      if (await db.getActiveJob(user.id)) {
        return { status: 409, body: { error: "a sort is already running — let it finish first" } };
      }

      const { added, duplicates, capped } = await db.upsertFromImport(user.id, videos, config.libraryCap);
      await db.createImport(user.id, source, videos.length, added);

      // Everything stored gets classified.
      const unscanned = await db.countUnscanned(user.id);
      let job = null;
      if (unscanned > 0) job = await startJob(user, unscanned);

      return {
        status: 200,
        body: {
          added,
          duplicates,
          capped,
          jobId: job?.id ?? null,
          willClassify: unscanned,
          // The shipped extension forwards this field numerically; nothing is
          // ever locked anymore, so it stays 0 to avoid a coordinated release.
          locked: 0,
        },
      };
    },

    async classifyRemaining(user) {
      if (config.llmReady === false) {
        return { status: 503, body: { error: "the sorting engine isn't configured yet — check back soon" } };
      }
      if (await db.getActiveJob(user.id)) {
        return { status: 409, body: { error: "a sort is already running — let it finish first" } };
      }
      const unscanned = await db.countUnscanned(user.id);
      if (!unscanned) return { status: 400, body: { error: "nothing left to sort" } };
      const job = await startJob(user, unscanned);
      return { status: 200, body: { jobId: job.id, willClassify: unscanned } };
    },
  };
}
