import { afterEach, describe, expect, it, vi } from "vitest";
import { WLL_REMOVE_PENDING } from "../extension/src/messages.js";

afterEach(() => vi.unstubAllGlobals());

function event() {
  return { addListener: vi.fn() };
}

function area() {
  return {
    get: vi.fn(async (key) => ({ [key]: undefined })),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
}

describe("background removal command", () => {
  it("accepts the drain command only from an external site message", async () => {
    const chrome = {
      tabs: { onRemoved: event(), onUpdated: event() },
      windows: {},
      scripting: {},
      storage: { local: area(), session: area(), sync: area() },
      alarms: { onAlarm: event(), clear: vi.fn(async () => {}) },
      action: { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}) },
      runtime: {
        onMessage: event(), onMessageExternal: event(), onConnectExternal: event(),
        onInstalled: event(), onStartup: event(),
        getManifest: () => ({ version: "1.3.0" }),
      },
    };
    const fetch = vi.fn(async () => { throw new Error("unexpected network call"); });
    vi.stubGlobal("chrome", chrome);
    vi.stubGlobal("fetch", fetch);
    vi.resetModules();
    await import("../extension/src/background.js");

    const internal = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const external = chrome.runtime.onMessageExternal.addListener.mock.calls[0][0];
    expect(internal({ type: WLL_REMOVE_PENDING }, {}, vi.fn())).toBe(false);
    const result = await new Promise((resolve) => {
      expect(external({ type: WLL_REMOVE_PENDING }, {}, resolve)).toBe(true);
    });
    expect(result).toEqual({ error: "NOT_CONNECTED" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
