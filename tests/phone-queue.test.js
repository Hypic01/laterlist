import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMIT_DELAY_MS, createPendingQueue, requestsFor } from "../web/src/phone/pendingQueue.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(overrides = {}) {
  const sent = [];
  const events = [];
  const queue = createPendingQueue({
    send: async (request, token, opts) => { sent.push({ ...request, token, keepalive: Boolean(opts?.keepalive) }); },
    getToken: async () => "tok-1",
    ...overrides,
  });
  queue.subscribe((event) => events.push(event));
  return { queue, sent, events };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); });
afterEach(() => { vi.useRealTimers(); });

describe("requestsFor", () => {
  it("maps each phone action to its API calls", () => {
    expect(requestsFor({ kind: "dismiss", id: "abc" })).toEqual([{ url: "/api/videos/abc/dismiss" }]);
    expect(requestsFor({ kind: "done", id: "abc" })).toEqual([{ url: "/api/videos/done", body: { ids: ["abc"] } }]);
    expect(requestsFor({ kind: "keep", id: "abc" })).toEqual([{ url: "/api/videos/abc/keep" }]);
    expect(requestsFor({ kind: "move", id: "abc", category: "music", keep: true })).toEqual([
      { url: "/api/videos/abc/category", body: { category: "music" } },
      { url: "/api/videos/abc/keep" },
    ]);
    expect(requestsFor({ kind: "move", id: "abc", category: "music", keep: false })).toHaveLength(1);
  });
});

describe("pendingQueue", () => {
  it("sends nothing until the delay passes, then sends with the captured token", async () => {
    const { queue, sent, events } = setup();
    queue.enqueue({ kind: "dismiss", id: "abc" });
    await tick();
    vi.advanceTimersByTime(COMMIT_DELAY_MS - 1);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(1);
    await tick();
    expect(sent).toEqual([{ url: "/api/videos/abc/dismiss", token: "tok-1", keepalive: false }]);
    expect(events.at(-1)).toMatchObject({ type: "settled", ok: true, action: { id: "abc" } });
  });

  it("undo cancels the call and hands back the action", async () => {
    const { queue, sent } = setup();
    const key = queue.enqueue({ kind: "keep", id: "abc" });
    expect(queue.has(key)).toBe(true);
    expect(queue.undo(key)).toEqual({ kind: "keep", id: "abc" });
    expect(queue.has(key)).toBe(false);
    vi.advanceTimersByTime(COMMIT_DELAY_MS);
    await tick();
    expect(sent).toEqual([]);
    expect(queue.undo(key)).toBeNull();
  });

  it("flush sends everything at once with keepalive", async () => {
    const { queue, sent } = setup();
    queue.enqueue({ kind: "dismiss", id: "a" });
    queue.enqueue({ kind: "done", id: "b" });
    await tick();
    await queue.flush({ keepalive: true });
    expect(sent.map((r) => [r.url, r.keepalive, r.token])).toEqual([
      ["/api/videos/a/dismiss", true, "tok-1"],
      ["/api/videos/done", true, "tok-1"],
    ]);
  });

  it("reports a failed send so the phone can put the card back", async () => {
    const { queue, events } = setup({ send: async () => { throw new Error("offline"); } });
    queue.enqueue({ kind: "dismiss", id: "abc" });
    await tick();
    await queue.flush();
    expect(events.at(-1)).toMatchObject({ type: "settled", ok: false, action: { id: "abc" } });
  });

  it("sends two actions on one video in the order they were made", async () => {
    const sent = [];
    let releaseFirst;
    const queue = createPendingQueue({
      getToken: async () => "tok-1",
      send: (request) => {
        sent.push(request.body?.category);
        return sent.length === 1 ? new Promise((resolve) => { releaseFirst = resolve; }) : Promise.resolve();
      },
    });
    queue.enqueue({ kind: "move", id: "abc", category: "watch" });
    queue.enqueue({ kind: "move", id: "abc", category: "music" });
    await tick();
    const flushed = queue.flush();
    await tick();
    expect(sent).toEqual(["watch"]); // music waits for watch to land
    releaseFirst();
    await flushed;
    expect(sent).toEqual(["watch", "music"]);
  });

  it("a pagehide flush still waits for the sign-in token", async () => {
    let resolveToken;
    const { queue, sent } = setup({ getToken: () => new Promise((resolve) => { resolveToken = resolve; }) });
    queue.enqueue({ kind: "dismiss", id: "abc" });
    const flushed = queue.flush({ keepalive: true });
    await tick();
    expect(sent).toEqual([]);
    resolveToken("tok-late");
    await flushed;
    expect(sent).toEqual([{ url: "/api/videos/abc/dismiss", token: "tok-late", keepalive: true }]);
  });

  it("rejects an unknown action right away", () => {
    const { queue } = setup();
    expect(() => queue.enqueue({ kind: "explode", id: "abc" })).toThrow("unknown action explode");
  });
});
