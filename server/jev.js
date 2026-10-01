// Jev classifier — TypeSafe's decision model via OpenRouter's decisions API.
// One request per video (title/channel/duration/age only, same metadata-only
// contract as Haiku), run through a small parallel pool. Chosen over Haiku on
// 2026-09-30: better agreement with a human judge, ~50x faster, ~10-20x
// cheaper. Jev returns no prose, so results carry reasoning = null and the UI
// hides the reason line. Haiku stays available behind CLASSIFIER=haiku.

import { createFakeLlm } from "./anthropic.js";
import { buildClassificationPrompt, RESULT_SCHEMA, TOPICS } from "./classify.js";
import { CATEGORIES } from "./db.js";

export const JEV_URL = "https://openrouter.ai/api/alpha/decisions";
export const JEV_DEFAULT_MODEL = "typesafe/jev-1.13";
const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1e6;

// The five rows, restated from classify.js RULES as one criterion per label.
// Keep the two in sync: both classifiers must sort by the same rules.
export const JEV_CRITERIA = {
  learn:
    "A good written summary would give the viewer about 95% of what the video offers. The value is in what is said: talks, explainers, interviews, advice, news analysis, and how-tos whose steps can be written down. Interviews, podcasts and conversations are learn even when the topic is visual. Walkthroughs of AI tools and apps are learn. When unsure between learn and watch, choose learn.",
  watch:
    "A summary would lose a significant part because the screen carries it: a workflow or tool being demonstrated live, designs or visual work being shown, physical technique, vlogs, travel and places, visual inspiration. Visual-craft how-tos you need to see done are watch: filming and cinematography, video editing, animation and motion, hands-on design-tool technique (e.g. Figma), hair and makeup.",
  music:
    "The point is listening: tracks, albums, mixes, DJ sets, live sets, '1 hour of X' compilations. Music-making tutorials are not music. Music is never outdated.",
  entertainment:
    "Fun is the point: gaming, memes, streamers, esports matches and highlights, variety shows. Personality- or celebrity-driven videos where the person is the draw (creator collabs, idols, influencers' daily life) are entertainment even when framed as tips. Pure entertainment is never outdated, regardless of age.",
  outdated:
    "Informational content whose information has been superseded. Only informational content can be outdated. AI tools and coding-stack tutorials (frameworks, libraries, app builds): about 1 year or older is outdated. Other tech and gadgets: about 2 years or older. Everything else is judged by content, never by age alone: health, fitness, psychology, habits, career, money basics, history and fundamentals stay current. Game guides, tips and meta analysis tied to a past season, patch, set or meta are outdated; game tips framed as timeless or universal are not.",
};

const TAGGED_TOPICS = TOPICS.filter((t) => t !== "other");
const topicKey = (t) => `topic_${t.replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "")}`;

// examples: the user's recent re-files (db.getRecentOverrides). Jev has no
// few-shot slot, so they ride in the category question's instructions — the
// same taste flywheel Haiku gets as TASTE CALIBRATION.
export function buildJevRequest(video, { model = JEV_DEFAULT_MODEL, tasteProfile = {}, examples = [] } = {}) {
  const interests = Array.isArray(tasteProfile.interests) ? tasteProfile.interests.filter(Boolean) : [];
  const note = String(tasteProfile.note || "").trim();
  const refiled = examples
    .map((e) => `"${e.title}" (${e.channel || "unknown"}): ${e.override_from ? `sorted as ${e.override_from}, ` : ""}they filed it as ${e.category}`)
    .join("; ");
  const instructions = [
    `Triage a YouTube "Watch Later" video into the row that best describes the kind of value it holds.`,
    `You only have metadata (title, channel, duration, age/views text); there is no transcript.`,
    `Precedence when rows overlap: music > outdated > watch > learn.`,
    interests.length ? `The user's interests include: ${interests.join(", ")}.` : "",
    note ? `In their own words: "${note}"` : "",
    refiled ? `The user re-filed these videos; treat their choices as ground truth for how they categorize: ${refiled}.` : "",
  ].filter(Boolean).join(" ");

  const questions = { category: { type: "choice", instructions, criteria: JEV_CRITERIA } };
  for (const t of TAGGED_TOPICS) {
    questions[topicKey(t)] = { type: "noul", instructions: `Is the subject of this video "${t}"?` };
  }
  return {
    model,
    state: {
      title: video.title,
      channel: video.channel || "unknown",
      duration_seconds: video.duration_seconds ?? null,
      age_and_views: video.published_text || "unknown",
    },
    questions,
  };
}

// Maps a Jev response onto the classifier's result shape. Topics mirror
// validateResults: the top 1-2 above 0.5, else "other".
export function mapJevResponse(body) {
  const answer = body?.answers?.category;
  if (!CATEGORIES.includes(answer?.choice)) throw new Error(`jev returned invalid category "${answer?.choice}"`);
  const c = Number(answer.confidence);
  const topics = TAGGED_TOPICS
    .map((t) => [t, Number(body.answers[topicKey(t)]?.noul)])
    .filter(([, p]) => p >= 0.5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([t]) => t);
  const inputTokens = body.usage?.input_tokens ?? 0;
  return {
    category: answer.choice,
    confidence: Number.isFinite(c) ? c : null,
    topics: topics.length ? topics : ["other"],
    inputTokens,
    costUsd: Number.isFinite(body.usage?.cost) ? body.usage.cost : inputTokens * JEV_USD_PER_INPUT_TOKEN,
  };
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry policy from the OpenRouter cookbook: 429, 5xx and in-flight-budget 402
// back off and retry; any other 402 (quota exhausted) or 4xx fails.
export async function callJev(request, { apiKey, fetchImpl = fetch, maxAttempts = 6, sleep = defaultSleep, url = JEV_URL } = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    const retryable =
      res.status === 429 || res.status >= 500 || (res.status === 402 && text.includes("openrouter_in_flight_budget"));
    if (!retryable || attempt >= maxAttempts) throw new Error(`jev ${res.status}: ${text.slice(0, 200)}`);
    const retryAfter = Number(res.headers.get("retry-after"));
    const backoff = Math.min(30000, 1000 * 2 ** (attempt - 1)) + Math.random() * 250;
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff);
  }
}

// Deterministic stand-in for OpenRouter so dev and tests run with zero keys.
// It answers with the fake Haiku heuristic.
export function createFakeJevFetch() {
  const fake = createFakeLlm();
  return async (_url, init) => {
    const req = JSON.parse(init.body);
    const v = { id: "fake", title: req.state.title, channel: req.state.channel, duration_seconds: req.state.duration_seconds };
    const { data } = await fake.classifyChunk(buildClassificationPrompt([v], {}), RESULT_SCHEMA);
    const r = data.results[0];
    const answers = { category: { type: "choice", choice: r.category, confidence: 0.7 } };
    for (const t of TAGGED_TOPICS) answers[topicKey(t)] = { type: "noul", noul: r.topics.includes(t) ? 0.9 : 0.05 };
    const input_tokens = Math.ceil(init.body.length / 4);
    return new Response(JSON.stringify({ model: req.model, answers, usage: { input_tokens, output_tokens: 0 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

// The worker-facing classifier. Classifies a chunk through a fixed pool of
// parallel requests and returns whatever succeeded; the worker retries the
// rest through classify_attempts. Throws only when nothing succeeded, so a
// fully failed chunk takes the same path as a failed Haiku chunk. Retries per
// request stay short (3 attempts) to fit the serverless poll budget.
export function createJevClassifier({ apiKey, model = JEV_DEFAULT_MODEL, concurrency = 8, fetchImpl = fetch, sleep = defaultSleep }) {
  return {
    supportsBatch: false,
    async classifyChunk(videos, { tasteProfile = {}, examples = [] } = {}) {
      const results = [];
      let input = 0, costUsd = 0, next = 0, lastError = null;
      const work = async () => {
        while (next < videos.length) {
          const v = videos[next++];
          try {
            const body = await callJev(buildJevRequest(v, { model, tasteProfile, examples }), {
              apiKey, fetchImpl, maxAttempts: 3,
              // Cap every wait, Retry-After included: a chunk must fit the serverless poll budget.
              sleep: (ms) => sleep(Math.min(ms, 2000)),
            });
            const r = mapJevResponse(body);
            results.push({ id: v.id, category: r.category, reasoning: null, confidence: r.confidence, topics: r.topics });
            input += r.inputTokens;
            costUsd += r.costUsd;
          } catch (e) {
            lastError = e;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, videos.length) }, work));
      if (videos.length && !results.length) throw lastError || new Error("jev classified nothing");
      return { results, usage: { input, output: 0, costUsd } };
    },
  };
}
