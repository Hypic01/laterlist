import { openBackgroundTab } from "./tabs.js";
import { CONNECTION_KEY, YOUTUBE_ACCOUNT_KEY } from "./sync.js";
import { WLL_REMOVE_DONE } from "./messages.js";

const YOUTUBE_HOME = "https://www.youtube.com/";
const TAB_LOAD_TIMEOUT_MS = 20000;

export function createRemovalController({
  tabs,
  windows = null,
  scripting,
  storage,
  api,
  publish = () => {},
  isSyncing = () => false,
  startSync = () => {},
}) {
  if (!tabs || !scripting || !storage?.local || !api) {
    throw new Error("tabs, scripting, storage, and api are required");
  }

  const waiters = new Map();
  let flight = null;

  async function read(key) {
    return (await storage.local.get(key))?.[key] ?? null;
  }

  function settleTab(tabId, method, value) {
    const waiter = waiters.get(tabId);
    if (!waiter) return false;
    waiters.delete(tabId);
    clearTimeout(waiter.timer);
    waiter[method](value);
    return true;
  }

  function waitForTab(tab) {
    if (tab.status === "complete") return Promise.resolve(tab);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        settleTab(tab.id, "reject", new Error("TAB_LOAD_TIMEOUT"));
      }, TAB_LOAD_TIMEOUT_MS);
      waiters.set(tab.id, { resolve, reject, timer });
      // Recheck after registering: the load event can beat this waiter.
      if (typeof tabs.get === "function") {
        Promise.resolve(tabs.get(tab.id)).then((current) => {
          if (current?.status === "complete") settleTab(tab.id, "resolve", current);
        }).catch(() => {});
      }
    });
  }

  async function run(fromSyncDone, onNeedsBinding) {
    if (await isSyncing()) return { deferred: true };
    const connection = await read(CONNECTION_KEY);
    if (!connection?.apiUrl || !connection?.token) return { error: "NOT_CONNECTED" };
    const { apiUrl, token } = connection;
    const pending = await api.pendingRemovals({ apiUrl, token });
    const removals = (pending?.removals || []).slice(0, 50);
    if (!removals.length) return { removed: 0 };

    const expectedAccount = await read(YOUTUBE_ACCOUNT_KEY);
    if (!expectedAccount) {
      if (!fromSyncDone) onNeedsBinding();
      return { deferred: true, reason: "NOT_BOUND" };
    }

    let tab = null;
    let createdTab = false;
    try {
      const open = await tabs.query({ url: "https://www.youtube.com/*" });
      // Discarded tabs can't take injected scripts; reusing one would fail every drain.
      tab = (open || []).find((candidate) => candidate?.id && !candidate.discarded) || null;
      if (!tab) {
        tab = await openBackgroundTab({ tabs, windows }, YOUTUBE_HOME);
        createdTab = true;
      }
      if (!tab?.id) throw new Error("TAB_OPEN_FAILED");
      await waitForTab(tab);

      await scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN", files: ["remover.main.js"],
      });
      const videoIds = removals.map((item) => item.videoId);
      const injected = await scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: (args) => globalThis.__laterlistRemoveFromWatchLater(args),
        args: [{ videoIds, expectedAccount }],
      });
      const returned = (injected || []).find((entry) => entry && "result" in entry)?.result;
      const results = videoIds.map((videoId, index) => {
        const item = Array.isArray(returned) ? returned[index] : null;
        if (item?.videoId !== videoId || typeof item.ok !== "boolean") {
          return { videoId, ok: false, error: "NETWORK_ERROR" };
        }
        return item.ok
          ? { videoId, ok: true }
          : { videoId, ok: false, error: String(item.error || "NETWORK_ERROR") };
      });

      await api.reportRemovals({ apiUrl, token, results });
      const removed = results.filter((item) => item.ok).length;
      const failed = results.filter((item) => !item.ok).length;
      const remaining = await api.pendingRemovals({ apiUrl, token });
      const pendingCount = (remaining?.removals || []).length;
      const summary = { removed, failed, pending: pendingCount };
      await publish({ type: WLL_REMOVE_DONE, ...summary });
      return summary;
    } finally {
      if (tab?.id) settleTab(tab.id, "reject", new Error("TAB_CLOSED"));
      if (createdTab && tab?.id) {
        try {
          await tabs.remove(tab.id);
        } catch {
          // The user may have closed the temporary tab first.
        }
      }
    }
  }

  function drain({ fromSyncDone = false } = {}) {
    if (flight) return flight;
    let needsBinding = false;
    const current = run(fromSyncDone, () => { needsBinding = true; });
    flight = current;
    current.finally(() => {
      if (flight === current) flight = null;
      // The sync controller refuses to start while a removal drain is active.
      // Begin binding only after this flight has finished.
      if (needsBinding) {
        try {
          Promise.resolve(startSync({ mode: "delta", promoteFirstSync: false })).catch(() => {});
        } catch {
          // A failed binding sync can be retried by the next user action.
        }
      }
    }).catch(() => {});
    return current;
  }

  function handleTabUpdated(tabId, changeInfo = {}, tab = null) {
    if (changeInfo.status !== "complete" && tab?.status !== "complete") return false;
    return settleTab(tabId, "resolve", tab || { id: tabId, status: "complete" });
  }

  function handleTabRemoved(tabId) {
    return settleTab(tabId, "reject", new Error("TAB_CLOSED"));
  }

  return { drain, isRunning: () => !!flight, handleTabUpdated, handleTabRemoved };
}
