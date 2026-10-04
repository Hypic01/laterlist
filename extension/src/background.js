import { createExtensionApi } from "./api.js";
import {
  AUTO_SYNC_ALARM,
  createAutoSyncController,
} from "./auto-sync.js";
import {
  SYNC_KEEPALIVE_ALARM,
  createSyncController,
} from "./sync.js";
import { createTranscriptController } from "./transcript.js";
import { createRemovalController } from "./removal.js";
import {
  COLLECT_DONE,
  COLLECT_ERROR,
  COLLECT_PROGRESS,
  WLL_GET_STATUS,
  WLL_FETCH_TRANSCRIPT,
  WLL_PING,
  WLL_REMOVE_PENDING,
  WLL_SET_TOKEN,
  WLL_SYNC,
  WLL_SYNC_DONE,
  WLL_SYNC_PORT,
} from "./messages.js";

const sitePorts = new Set();
let removalController = null;

function publish(message) {
  for (const port of sitePorts) {
    try {
      port.postMessage(message);
    } catch {
      sitePorts.delete(port);
    }
  }
  if (message?.type === WLL_SYNC_DONE) {
    removalController?.drain({ fromSyncDone: true }).catch(() => {});
  }
}

const api = createExtensionApi({ fetch: globalThis.fetch.bind(globalThis) });
const controller = createSyncController({
  tabs: chrome.tabs,
  windows: chrome.windows,
  scripting: chrome.scripting,
  storage: chrome.storage,
  alarms: chrome.alarms,
  api,
  now: Date.now,
  publish,
  isRemovalRunning: () => removalController?.isRunning() || false,
  setBadge: (text) => Promise.all([
    chrome.action.setBadgeText({ text }),
    chrome.action.setBadgeBackgroundColor({
      color: text === "✓" ? "#15803d" : text === "!" ? "#b91c1c" : "#db2777",
    }),
  ]),
});

removalController = createRemovalController({
  tabs: chrome.tabs,
  windows: chrome.windows,
  scripting: chrome.scripting,
  storage: chrome.storage,
  api,
  publish,
  isSyncing: async () => (await controller.getStatus()).syncing,
  startSync: (options) => controller.start(options),
});

const transcriptController = createTranscriptController({
  fetch: globalThis.fetch.bind(globalThis),
  tabs: chrome.tabs,
  windows: chrome.windows,
  scripting: chrome.scripting,
});

const autoSyncController = createAutoSyncController({
  storage: chrome.storage,
  alarms: chrome.alarms,
  syncController: controller,
  now: Date.now,
});

function dispatchCommand(message, sender, external = false) {
  if (message?.type === WLL_PING) {
    return Promise.resolve({ ok: true, version: chrome.runtime.getManifest().version });
  }
  if (message?.type === WLL_SET_TOKEN) return controller.setConnection(message);
  if (message?.type === WLL_GET_STATUS) return controller.getStatus();
  if (message?.type === WLL_SYNC) {
    return controller.start({ mode: message.mode, promoteFirstSync: message.promoteFirstSync !== false });
  }
  if (external && message?.type === WLL_FETCH_TRANSCRIPT) {
    return transcriptController.fetchTranscript(message.videoId);
  }
  if (external && message?.type === WLL_REMOVE_PENDING) {
    return removalController.drain();
  }
  if (!external && [COLLECT_PROGRESS, COLLECT_DONE, COLLECT_ERROR].includes(message?.type)) {
    return controller.handleCollectorMessage(message, sender);
  }
  return null;
}

function respond(promise, sendResponse) {
  Promise.resolve(promise).then(
    (value) => sendResponse(value),
    (error) => sendResponse({
      error: String(error?.code || "EXTENSION_ERROR"),
      message: String(error?.message || "The extension could not finish that request."),
    }),
  );
  return true;
}

// MV3 can stop the worker between any two events. Every listener is registered
// synchronously at module evaluation so Chrome can always wake this worker.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const result = dispatchCommand(message, sender, false);
  return result ? respond(result, sendResponse) : false;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const result = dispatchCommand(message, sender, true);
  return result ? respond(result, sendResponse) : false;
});

chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== WLL_SYNC_PORT) return;
  sitePorts.add(port);
  port.onDisconnect.addListener(() => sitePorts.delete(port));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  controller.handleTabRemoved(tabId).catch(() => {});
  transcriptController.handleTabRemoved(tabId);
  removalController.handleTabRemoved(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  controller.handleTabUpdated(tabId, changeInfo, tab).catch(() => {});
  transcriptController.handleTabUpdated(tabId, changeInfo, tab);
  removalController.handleTabUpdated(tabId, changeInfo, tab);
});

chrome.runtime.onInstalled.addListener(() => {
  autoSyncController.handleInstalled().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  autoSyncController.handleStartup().catch(() => {});
});

// This alarm exists only while a sync is active. Its event wakes an idle MV3
// worker while a hidden YouTube tab is in a long continuation backoff.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === SYNC_KEEPALIVE_ALARM) controller.recover().catch(() => {});
  if (alarm?.name === AUTO_SYNC_ALARM) autoSyncController.handleAlarm(alarm).catch(() => {});
});

controller.recover().catch(() => {});
