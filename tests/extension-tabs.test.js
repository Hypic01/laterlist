import { describe, expect, it, vi } from "vitest";
import { openBackgroundTab } from "../extension/src/tabs.js";

describe("openBackgroundTab", () => {
  it("opens a background tab normally", async () => {
    const tabs = { create: vi.fn(async (opts) => ({ id: 1, ...opts })) };
    const tab = await openBackgroundTab({ tabs }, "https://www.youtube.com/playlist?list=WL");
    expect(tab.id).toBe(1);
    expect(tabs.create).toHaveBeenCalledWith({ url: "https://www.youtube.com/playlist?list=WL", active: false });
  });

  it("uses an explicit window when the browser has no current window (Arc)", async () => {
    const tabs = { create: vi.fn()
      .mockRejectedValueOnce(new Error("No current window"))
      .mockImplementation(async (opts) => ({ id: 2, ...opts })) };
    const windows = { getAll: vi.fn(async () => [{ id: 7 }]), create: vi.fn() };
    const tab = await openBackgroundTab({ tabs, windows }, "https://www.youtube.com/playlist?list=WL");
    expect(tab).toMatchObject({ id: 2, windowId: 7, active: false });
    expect(windows.create).not.toHaveBeenCalled();
  });

  it("opens its own unfocused window when there are no windows at all", async () => {
    const tabs = { create: vi.fn().mockRejectedValue(new Error("No current window")) };
    const windows = {
      getAll: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 9, tabs: [{ id: 3 }] })),
    };
    const tab = await openBackgroundTab({ tabs, windows }, "https://www.youtube.com/watch?v=x");
    expect(tab.id).toBe(3);
    expect(windows.create).toHaveBeenCalledWith({ url: "https://www.youtube.com/watch?v=x", focused: false });
  });

  it("does not hide other errors", async () => {
    const tabs = { create: vi.fn().mockRejectedValue(new Error("Invalid url")) };
    await expect(openBackgroundTab({ tabs, windows: { getAll: vi.fn() } }, "x")).rejects.toThrow("Invalid url");
  });
});
