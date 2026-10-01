// Classification prompt + validation. Adapted from the original single-user
// app: persona is now template-driven per user (taste quiz + override
// flywheel), "ingest" became "learn", and video blocks are metadata-only —
// no transcripts in the hosted beta. Output shape is enforced API-side via
// structured outputs; validateResults stays as the second line of defense.

import { CATEGORIES } from "./db.js";
import { estimateCostUsd } from "./config.js";

export class ClassificationError extends Error {}

// General YouTube subject vocabulary. Shared by the onboarding quiz (what the
// user watches) and the per-video topic tags shown as board filter chips.
// "other" is the classifier's catch-all and is never offered in the quiz.
export const TOPICS = [
  "music", "gaming", "comedy", "movies & tv", "sports",
  "news & politics", "learning & how-to", "tech", "science", "food & cooking",
  "travel", "health & fitness", "beauty & fashion", "money & business",
  "vlogs & daily life", "cars", "other",
];

// JSON Schema for output_config.format. Numeric ranges are not supported in
// strict mode, so confidence is clamped in validateResults instead.
export const RESULT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: { type: "string", enum: [...CATEGORIES] },
          reasoning: { type: "string" },
          confidence: { type: "number" },
          topics: { type: "array", items: { type: "string", enum: [...TOPICS] } },
        },
        required: ["id", "category", "reasoning", "confidence", "topics"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

function persona(tasteProfile = {}) {
  const interests = Array.isArray(tasteProfile.interests) ? tasteProfile.interests.filter(Boolean) : [];
  const note = String(tasteProfile.note || "").trim();
  return [
    `You are triaging YouTube "Watch Later" videos for a user who saved hundreds or`,
    `thousands of them and never got back around. For each video, judge what kind of`,
    `value it holds so they can finally sort the backlog.`,
    interests.length ? `Their interests include: ${interests.join(", ")}.` : "",
    note ? `In their own words: "${note}"` : "",
    `Where their interests give signal, judge by THEIR interests; where they don't,`,
    `make a sensible general judgment.`,
  ].filter(Boolean).join("\n");
}

const RULES = `Classify each video into exactly one category:
- "learn": a good written summary would give the viewer ~95% of what the video
  offers — the value is in what is SAID: talks, explainers, interviews, advice, news
  analysis, and how-tos whose steps can be written down. Interviews, podcasts and
  conversations are learn even when the topic is visual. Walkthroughs of AI tools
  and apps are learn: a written step list captures them.
- "watch": a summary would lose a significant part because the SCREEN carries it — a
  workflow or tool being demonstrated live, designs or visual work being shown,
  physical technique, vlogs, travel and places, visual inspiration. Visual-craft
  how-tos you need to SEE done are watch: filming and cinematography, video editing,
  animation and motion, hands-on design-tool technique (e.g. Figma), hair and makeup.
  When unsure between learn and watch, choose learn.
- "music": the point is LISTENING — tracks, albums, mixes, DJ sets, live sets,
  "1 hour of X" compilations. Music-making TUTORIALS are not music (learn or watch).
  Music is never outdated.
- "entertainment": fun is the point — gaming, memes, streamers, esports matches and
  highlights, variety shows. Personality- or celebrity-driven videos where the person
  is the draw (creator collabs, idols, influencers' daily life) are entertainment
  even when framed as tips. Pure entertainment is never outdated, regardless of age.
- "outdated": informational content whose information has been superseded. Only
  informational content can be outdated. AI tools and coding-stack tutorials
  (frameworks, libraries, app builds): about 1 year or older is outdated. Other tech
  and gadgets: about 2 years or older. Everything else is judged by content, NEVER
  by age alone — health, fitness, psychology, habits, career, money basics, history
  and fundamentals stay current. IMPORTANT: game guides, tips and meta analysis
  tied to a season, patch, set, or meta that has since passed count as
  informational and ARE outdated — guide-style gaming content is not protected by
  the entertainment rule. Game tips framed as timeless or universal are not.
Precedence when categories overlap: music > outdated > watch > learn.

You are judging from METADATA ONLY — title, channel, duration, age. There is no
transcript. Confidence rubric (be honest, do not inflate):
- 0.8+: title and channel unambiguously settle it
- 0.7: strong signal with minor ambiguity
- 0.6: a plausible read of thin metadata — NORMAL here
- 0.5 or below: genuinely guessing

Also tag each video with 1-2 "topics" describing its SUBJECT (independent of
category), chosen ONLY from this list:
${TOPICS.join(", ")}`;

export function buildClassificationPrompt(videos, opts = {}) {
  const { tasteProfile, examples = [] } = opts;
  const taste = examples.length
    ? `\nTASTE CALIBRATION — the user manually re-filed these; treat their choices as
ground truth about how THEY categorize:
${examples
  .map(
    (e) =>
      `- "${e.title}" (${e.channel || "unknown"}): ${e.override_from ? `AI said ${e.override_from} → ` : ""}they filed it as ${e.category}`
  )
  .join("\n")}\n`
    : "";

  const blocks = videos.map(
    (v) => `--- VIDEO id: "${v.id}" ---
Title: ${v.title}
Channel: ${v.channel || "unknown"}
Duration: ${v.duration_seconds ?? v.durationSeconds ?? "unknown"} seconds
Saved-list position: ${v.playlist_position ?? v.position ?? "unknown"}
Age/views: ${v.published_text ?? v.publishedText ?? "unknown"}`
  );

  return `${persona(tasteProfile)}

${RULES}
${taste}
Classify ALL ${videos.length} videos below. Return one result object per video.

${blocks.join("\n\n")}`;
}

export function validateResults(data, expectedIds) {
  const results = data?.results;
  if (!Array.isArray(results)) throw new ClassificationError("no results array");
  for (const r of results) {
    if (typeof r.id !== "string") throw new ClassificationError("missing id");
    if (!CATEGORIES.includes(r.category)) {
      throw new ClassificationError(`invalid category "${r.category}" for ${r.id}`);
    }
    r.reasoning = String(r.reasoning ?? "").slice(0, 400);
    const c = Number(r.confidence);
    r.confidence = Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : null;
    const topics = Array.isArray(r.topics) ? r.topics.filter((t) => TOPICS.includes(t)).slice(0, 2) : [];
    r.topics = topics.length ? topics : ["other"];
  }
  const got = new Set(results.map((r) => r.id));
  // A duplicate id would collapse in the Set and could mask a missing one in
  // the size check below, so reject it explicitly before comparing to the batch.
  if (got.size !== results.length) {
    throw new ClassificationError("duplicate ids in results");
  }
  const want = new Set(expectedIds);
  if (got.size !== want.size || [...want].some((id) => !got.has(id))) {
    throw new ClassificationError("returned ids do not match the batch");
  }
  return results;
}

// The worker-facing classifier over the Haiku adapter (see server/jev.js for
// the default). One prompt per chunk; supports the Batches path for big jobs.
export function createHaikuClassifier({ llm }) {
  return {
    supportsBatch: true,
    async classifyChunk(videos, opts = {}) {
      const { data, usage } = await llm.classifyChunk(buildClassificationPrompt(videos, opts), RESULT_SCHEMA);
      const results = validateResults(data, videos.map((v) => v.id));
      const costUsd = estimateCostUsd({ inputTokens: usage.input, outputTokens: usage.output, batch: false });
      return { results, usage: { ...usage, costUsd } };
    },
  };
}
