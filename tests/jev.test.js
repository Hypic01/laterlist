import { describe, it, expect } from "vitest";
import { buildJevRequest, createJevClassifier, createFakeJevFetch } from "../server/jev.js";
import { CATEGORIES } from "../server/db.js";

const video = (id, title = "How Postgres indexes work") => ({
  id,
  title,
  channel: "Hussein Nasser",
  duration_seconds: 1800,
  published_text: "210K views • 1 year ago",
});

describe("buildJevRequest re-file examples", () => {
  it("puts the user's re-files into the category instructions as ground truth", () => {
    const req = buildJevRequest(video("a"), {
      examples: [
        { title: "Boiler Room set", channel: "Boiler Room", override_from: "watch", category: "music" },
        { title: "Figma auto layout", channel: "", override_from: null, category: "watch" },
      ],
    });
    const ins = req.questions.category.instructions;
    expect(ins).toContain("treat their choices as ground truth");
    expect(ins).toContain('"Boiler Room set" (Boiler Room): sorted as watch, they filed it as music');
    expect(ins).toContain('"Figma auto layout" (unknown): they filed it as watch');
  });

  it("adds nothing when there are no re-files", () => {
    expect(buildJevRequest(video("a")).questions.category.instructions).not.toContain("re-filed");
  });
});

describe("createJevClassifier", () => {
  const noSleep = async () => {};

  it("classifies a chunk in parallel with null reasoning and summed cost", async () => {
    const c = createJevClassifier({ apiKey: "", fetchImpl: createFakeJevFetch(), concurrency: 3, sleep: noSleep });
    expect(c.supportsBatch).toBe(false);
    const vids = ["a", "b", "c", "d", "e"].map((id) => video(id));
    const { results, usage } = await c.classifyChunk(vids);
    expect(results.map((r) => r.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
    for (const r of results) {
      expect(CATEGORIES).toContain(r.category);
      expect(r.reasoning).toBeNull();
      expect(r.topics.length).toBeGreaterThan(0);
    }
    expect(usage.input).toBeGreaterThan(0);
    expect(usage.output).toBe(0);
    expect(usage.costUsd).toBeGreaterThan(0);
  });

  it("returns the videos that succeeded when some requests fail", async () => {
    const fake = createFakeJevFetch();
    const fetchImpl = async (url, init) =>
      JSON.parse(init.body).state.title === "broken" ? new Response("bad request", { status: 400 }) : fake(url, init);
    const c = createJevClassifier({ apiKey: "", fetchImpl, sleep: noSleep });
    const { results } = await c.classifyChunk([video("a"), video("b", "broken"), video("c")]);
    expect(results.map((r) => r.id).sort()).toEqual(["a", "c"]);
  });

  it("caps retry waits, even a long Retry-After", async () => {
    const waits = [];
    const replies = [new Response("busy", { status: 429, headers: { "retry-after": "120" } })];
    const fake = createFakeJevFetch();
    const c = createJevClassifier({
      apiKey: "",
      fetchImpl: async (url, init) => replies.shift() ?? fake(url, init),
      sleep: async (ms) => waits.push(ms),
    });
    const { results } = await c.classifyChunk([video("a")]);
    expect(results).toHaveLength(1);
    expect(waits).toEqual([2000]);
  });

  it("gives up on a hung request instead of waiting forever", async () => {
    const fake = createFakeJevFetch();
    const fetchImpl = (url, init) =>
      JSON.parse(init.body).state.title === "hangs"
        ? new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)))
        : fake(url, init);
    const c = createJevClassifier({ apiKey: "", fetchImpl, sleep: async () => {}, requestTimeoutMs: 50 });
    const { results } = await c.classifyChunk([video("a"), video("b", "hangs")]);
    expect(results.map((r) => r.id)).toEqual(["a"]);
  });

  it("throws when nothing in the chunk succeeded", async () => {
    const c = createJevClassifier({ apiKey: "", fetchImpl: async () => new Response("down", { status: 400 }), sleep: noSleep });
    await expect(c.classifyChunk([video("a"), video("b")])).rejects.toThrow(/jev 400/);
  });

  it("sends the re-file examples with every request", async () => {
    const bodies = [];
    const fake = createFakeJevFetch();
    const c = createJevClassifier({
      apiKey: "",
      fetchImpl: async (url, init) => (bodies.push(JSON.parse(init.body)), fake(url, init)),
      sleep: noSleep,
    });
    await c.classifyChunk([video("a"), video("b")], {
      examples: [{ title: "Lofi radio", channel: "Lofi Girl", override_from: "learn", category: "music" }],
    });
    expect(bodies).toHaveLength(2);
    for (const b of bodies) expect(b.questions.category.instructions).toContain('"Lofi radio" (Lofi Girl)');
  });
});
