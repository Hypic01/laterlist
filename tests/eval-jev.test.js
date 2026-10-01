import { describe, it, expect } from "vitest";
import {
  buildJevRequest,
  mapJevResponse,
  callJev,
  createFakeJevFetch,
  scoreArm,
  compareArms,
  percentile,
  JEV_CRITERIA,
} from "../scripts/eval-jev.js";
import { CATEGORIES } from "../server/db.js";

const video = {
  id: "v1",
  title: "TFT Set 9 best comps",
  channel: "Mortdog",
  duration_seconds: 1200,
  published_text: "300K views • 3 years ago",
};

const jsonResponse = (status, body, headers = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

describe("buildJevRequest", () => {
  it("asks one choice question over exactly the five rows, plus a noul per topic", () => {
    const req = buildJevRequest(video, { tasteProfile: { interests: ["gaming", "design"], note: "I study UX" } });
    expect(req.model).toBe("typesafe/jev-1.13");
    expect(Object.keys(req.questions.category.criteria).sort()).toEqual([...CATEGORIES].sort());
    expect(req.questions.category.criteria).toEqual(JEV_CRITERIA);
    expect(req.questions.category.instructions).toContain("gaming, design");
    expect(req.questions.category.instructions).toContain("I study UX");
    expect(req.questions.topic_gaming).toEqual({ type: "noul", instructions: expect.stringContaining('"gaming"') });
    expect(req.questions.topic_movies_tv).toBeDefined();
    expect(req.questions.topic_other).toBeUndefined();
    // Metadata only, and the age text is what outdated needs.
    expect(req.state).toEqual({
      title: video.title,
      channel: video.channel,
      duration_seconds: 1200,
      age_and_views: video.published_text,
    });
  });
});

describe("mapJevResponse", () => {
  it("maps the choice, keeps the top two topics over 0.5, and prefers reported cost", () => {
    const r = mapJevResponse({
      answers: {
        category: { type: "choice", choice: "outdated", confidence: 0.83 },
        topic_gaming: { noul: 0.97 },
        topic_tech: { noul: 0.6 },
        topic_learning_how_to: { noul: 0.7 },
        topic_music: { noul: 0.1 },
      },
      usage: { input_tokens: 500, output_tokens: 0, cost: 0.00002 },
    });
    expect(r).toEqual({
      category: "outdated",
      confidence: 0.83,
      topics: ["gaming", "learning & how-to"],
      inputTokens: 500,
      costUsd: 0.00002,
    });
  });

  it("falls back to other, null confidence and token pricing when fields are missing", () => {
    const r = mapJevResponse({ answers: { category: { choice: "learn" } }, usage: { input_tokens: 1e6 } });
    expect(r.topics).toEqual(["other"]);
    expect(r.confidence).toBeNull();
    expect(r.costUsd).toBeCloseTo(0.042);
  });

  it("rejects a label outside the five rows", () => {
    expect(() => mapJevResponse({ answers: { category: { choice: "podcast" } } })).toThrow(/invalid category/);
  });
});

describe("callJev", () => {
  const noSleep = async () => {};

  it("retries 429, 5xx and in-flight-budget 402, then succeeds", async () => {
    const replies = [
      jsonResponse(429, "slow down"),
      jsonResponse(503, "busy"),
      jsonResponse(402, { error: { limit_source: "openrouter_in_flight_budget" } }),
      jsonResponse(200, { answers: {} }),
    ];
    let calls = 0;
    const body = await callJev({}, { apiKey: "k", fetchImpl: async () => replies[calls++], sleep: noSleep });
    expect(body).toEqual({ answers: {} });
    expect(calls).toBe(4);
  });

  it("fails fast on a quota 402 and on other 4xx", async () => {
    for (const reply of [jsonResponse(402, { error: "insufficient credits" }), jsonResponse(400, "bad request")]) {
      let calls = 0;
      await expect(
        callJev({}, { apiKey: "k", fetchImpl: async () => (calls++, reply), sleep: noSleep })
      ).rejects.toThrow(/jev 40/);
      expect(calls).toBe(1);
    }
  });

  it("gives up after maxAttempts", async () => {
    let calls = 0;
    await expect(
      callJev({}, { apiKey: "k", fetchImpl: async () => (calls++, jsonResponse(500, "down")), sleep: noSleep, maxAttempts: 3 })
    ).rejects.toThrow(/jev 500/);
    expect(calls).toBe(3);
  });

  it("round-trips through the fake OpenRouter", async () => {
    const body = await callJev(buildJevRequest(video), { apiKey: "", fetchImpl: createFakeJevFetch() });
    expect(CATEGORIES).toContain(mapJevResponse(body).category);
  });
});

describe("scoreArm", () => {
  const labeled = [
    { id: "a", label: "learn" },
    { id: "b", label: "learn" },
    { id: "c", label: "outdated" },
    { id: "d", label: "music" },
  ];

  it("computes accuracy, per-category precision/recall and counts failures as misses", () => {
    const preds = new Map([
      ["a", { category: "learn", confidence: 0.9 }],
      ["b", { category: "outdated", confidence: 0.6 }],
      ["c", { category: "outdated", confidence: 0.75 }],
      // d failed
    ]);
    const s = scoreArm(labeled, preds);
    expect(s.accuracy).toBe(0.5);
    expect(s.perCategory.learn).toEqual({ n: 2, precision: 1, recall: 0.5 });
    expect(s.perCategory.outdated).toEqual({ n: 1, precision: 0.5, recall: 1 });
    expect(s.perCategory.music).toEqual({ n: 1, precision: null, recall: 0 });
    expect(s.confusion.music.failed).toBe(1);
    expect(s.confusion.learn.outdated).toBe(1);
    const bucket = Object.fromEntries(s.byConfidence.map((b) => [b.bucket, b]));
    expect(bucket["0.8+"]).toEqual({ bucket: "0.8+", n: 1, accuracy: 1 });
    expect(bucket["0.5-0.7"]).toEqual({ bucket: "0.5-0.7", n: 1, accuracy: 0 });
  });
});

describe("compareArms", () => {
  it("only compares videos both arms classified", () => {
    const a = new Map([
      ["x", { category: "learn", topics: ["tech"] }],
      ["y", { category: "music", topics: ["music"] }],
      ["z", { category: "watch", topics: ["travel"] }],
    ]);
    const b = new Map([
      ["x", { category: "learn", topics: ["science", "tech"] }],
      ["y", { category: "entertainment", topics: ["comedy"] }],
    ]);
    expect(compareArms(["x", "y", "z"], a, b)).toEqual({ n: 2, categoryAgreement: 0.5, topicOverlap: 0.5 });
  });
});

describe("percentile", () => {
  it("uses nearest-rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 50)).toBeNull();
  });
});
