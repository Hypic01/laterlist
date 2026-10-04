import { describe, expect, it, vi } from "vitest";
import { createRemovalController } from "../extension/src/removal.js";
import { WLL_REMOVE_DONE } from "../extension/src/messages.js";
import { CONNECTION_KEY, YOUTUBE_ACCOUNT_KEY } from "../extension/src/sync.js";
import { createExtensionApi } from "../extension/src/api.js";

function area(initial) {
  const data = { ...initial };
  return {
    get: vi.fn(async (key) => ({ [key]: data[key] })),
    set: vi.fn(async (values) => Object.assign(data, values)),
    peek: (key) => data[key],
  };
}

function harness({ syncing = false, account = "account||user", existing = null, removals = [] } = {}) {
  const local = area({
    [CONNECTION_KEY]: { apiUrl: "https://laterlist-app.vercel.app", token: "wll_token" },
    ...(account ? { [YOUTUBE_ACCOUNT_KEY]: account } : {}),
  });
  const tabs = {
    query: vi.fn(async () => existing ? [existing] : []),
    create: vi.fn(async (options) => ({ id: 42, status: "complete", ...options })),
    get: vi.fn(async (id) => ({ id, status: "complete" })),
    remove: vi.fn(async () => {}),
  };
  const results = removals.map(({ videoId }) => ({ videoId, ok: true }));
  const scripting = {
    executeScript: vi.fn(async (options) => options.files ? [] : [{ result: results }]),
  };
  const api = {
    pendingRemovals: vi.fn()
      .mockResolvedValueOnce({ removals })
      .mockResolvedValue({ removals: [] }),
    reportRemovals: vi.fn(async () => ({ ok: true })),
  };
  const publish = vi.fn(async () => {});
  const startSync = vi.fn(async () => ({ started: true }));
  const controller = createRemovalController({
    tabs, windows: {}, scripting, storage: { local }, api, publish,
    isSyncing: () => syncing, startSync,
  });
  return { controller, local, tabs, scripting, api, publish, startSync };
}

describe("removal drain controller", () => {
  it("uses the shared removal event name", () => {
    expect(WLL_REMOVE_DONE).toBe("WLL_REMOVE_DONE");
  });

  it("defers while syncing, without reading the queue", async () => {
    const h = harness({ syncing: true });
    expect(await h.controller.drain()).toEqual({ deferred: true });
    expect(h.api.pendingRemovals).not.toHaveBeenCalled();
  });

  it("does nothing without a connection or pending rows", async () => {
    const empty = harness();
    expect(await empty.controller.drain()).toEqual({ removed: 0 });
    expect(empty.tabs.create).not.toHaveBeenCalled();
    expect(empty.scripting.executeScript).not.toHaveBeenCalled();
    const disconnected = harness({ removals: [{ videoId: "abc12345678", reason: "done" }] });
    disconnected.local.peek(CONNECTION_KEY).token = null;
    expect(await disconnected.controller.drain()).toEqual({ error: "NOT_CONNECTED" });
    expect(disconnected.api.pendingRemovals).not.toHaveBeenCalled();
  });

  it("starts a delta binding sync once, and the sync-done hook cannot loop", async () => {
    const removals = [{ videoId: "abc12345678", reason: "done" }];
    const h = harness({ account: null, removals });
    h.api.pendingRemovals.mockReset().mockResolvedValue({ removals });
    expect(await h.controller.drain()).toEqual({ deferred: true, reason: "NOT_BOUND" });
    expect(h.startSync).toHaveBeenCalledTimes(1);
    expect(h.startSync).toHaveBeenCalledWith({ mode: "delta", promoteFirstSync: false });
    expect(h.tabs.create).not.toHaveBeenCalled();
    expect(await h.controller.drain({ fromSyncDone: true })).toEqual({ deferred: true, reason: "NOT_BOUND" });
    expect(h.startSync).toHaveBeenCalledTimes(1);
  });

  it("injects the MAIN-world remover, reports results, publishes counts, and closes its tab", async () => {
    const removals = [
      { videoId: "first12345", reason: "done" },
      { videoId: "second12345", reason: "dismissed" },
    ];
    const h = harness({ removals });
    h.scripting.executeScript.mockImplementation(async (options) => options.files ? [] : [{
      result: [{ videoId: "first12345", ok: true }, { videoId: "second12345", ok: false, error: "EDIT_FAILED" }],
    }]);
    h.api.pendingRemovals.mockReset().mockResolvedValueOnce({ removals })
      .mockResolvedValueOnce({ removals: [removals[1]] });
    expect(await h.controller.drain()).toMatchObject({ removed: 1, failed: 1, pending: 1 });
    expect(h.tabs.create).toHaveBeenCalledWith({ url: "https://www.youtube.com/", active: false });
    expect(h.scripting.executeScript).toHaveBeenNthCalledWith(1, {
      target: { tabId: 42 }, world: "MAIN", files: ["remover.main.js"],
    });
    const call = h.scripting.executeScript.mock.calls[1][0];
    expect(call).toMatchObject({
      target: { tabId: 42 }, world: "MAIN",
      args: [{ videoIds: ["first12345", "second12345"], expectedAccount: "account||user" }],
    });
    expect(typeof call.func).toBe("function");
    expect(h.api.reportRemovals).toHaveBeenCalledWith({
      apiUrl: "https://laterlist-app.vercel.app", token: "wll_token",
      results: [{ videoId: "first12345", ok: true }, { videoId: "second12345", ok: false, error: "EDIT_FAILED" }],
    });
    expect(h.publish).toHaveBeenCalledWith({ type: WLL_REMOVE_DONE, removed: 1, failed: 1, pending: 1 });
    expect(h.tabs.remove).toHaveBeenCalledWith(42);
  });

  it("reuses an open YouTube tab without closing it", async () => {
    const existing = { id: 8, url: "https://www.youtube.com/watch?v=abc12345678", status: "complete" };
    const h = harness({ existing, removals: [{ videoId: "abc12345678", reason: "done" }] });
    await h.controller.drain();
    expect(h.tabs.create).not.toHaveBeenCalled();
    expect(h.tabs.remove).not.toHaveBeenCalled();
    expect(h.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 8 }, files: ["remover.main.js"],
    }));
  });

  // Chrome discards idle tabs to save memory, and scripts cannot be injected into
  // them. Reusing one would fail every drain, so open a fresh tab instead.
  it("skips a discarded YouTube tab and opens its own", async () => {
    const existing = { id: 8, url: "https://www.youtube.com/", status: "unloaded", discarded: true };
    const h = harness({ existing, removals: [{ videoId: "abc12345678", reason: "done" }] });
    await h.controller.drain();
    expect(h.tabs.create).toHaveBeenCalled();
    expect(h.scripting.executeScript).not.toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 8 },
    }));
    expect(h.tabs.remove).toHaveBeenCalledWith(42);
  });

  it("reports an account guard refusal to the site while the row stays pending", async () => {
    const removals = [{ videoId: "abc12345678", reason: "done" }];
    const h = harness({ removals });
    h.api.pendingRemovals.mockReset().mockResolvedValue({ removals });
    h.scripting.executeScript.mockImplementation(async (options) => options.files ? [] : [{
      result: [{ videoId: "abc12345678", ok: false, error: "ACCOUNT_MISMATCH" }],
    }]);
    expect(await h.controller.drain()).toEqual({ removed: 0, failed: 1, pending: 1 });
    expect(h.publish).toHaveBeenCalledWith({ type: WLL_REMOVE_DONE, removed: 0, failed: 1, pending: 1 });
  });

  it("shares one flight between concurrent drains", async () => {
    const h = harness({ removals: [{ videoId: "abc12345678", reason: "done" }] });
    let release;
    h.api.pendingRemovals.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ removals: [{ videoId: "abc12345678", reason: "done" }] });
    }));
    const first = h.controller.drain();
    const second = h.controller.drain();
    expect(first).toBe(second);
    expect(h.controller.isRunning()).toBe(true);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release();
    await first;
    expect(h.controller.isRunning()).toBe(false);
    expect(h.tabs.create).toHaveBeenCalledTimes(1);
    expect(h.api.reportRemovals).toHaveBeenCalledTimes(1);
  });
});

describe("extension removal API", () => {
  it("fetches and reports through authenticated CORS requests without cookies", async () => {
    const fetch = vi.fn(async (_url, init) => ({
      ok: true, status: 200,
      json: async () => init.method === "GET" ? { removals: [] } : { ok: true },
    }));
    const api = createExtensionApi({ fetch });
    const base = { apiUrl: "https://laterlist-app.vercel.app/app", token: "wll_secret" };
    await expect(api.pendingRemovals(base)).resolves.toEqual({ removals: [] });
    await expect(api.reportRemovals({ ...base, results: [{ videoId: "abc12345678", ok: true }] }))
      .resolves.toMatchObject({ ok: true });
    expect(fetch).toHaveBeenNthCalledWith(1, "https://laterlist-app.vercel.app/api/youtube-removals", {
      method: "GET", mode: "cors", credentials: "omit",
      headers: { "X-Import-Token": "wll_secret" },
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "https://laterlist-app.vercel.app/api/youtube-removals/results", {
      method: "POST", mode: "cors", credentials: "omit",
      headers: { "Content-Type": "application/json", "X-Import-Token": "wll_secret" },
      body: JSON.stringify({ results: [{ videoId: "abc12345678", ok: true }] }),
    });
  });

  it("maps a rejected import token to ExtensionApiError", async () => {
    const api = createExtensionApi({ fetch: vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({ error: "rejected" }),
    })) });
    await expect(api.pendingRemovals({ apiUrl: "https://laterlist-app.vercel.app", token: "bad" }))
      .rejects.toMatchObject({ name: "ExtensionApiError", code: "TOKEN_REJECTED", status: 401 });
  });
});
