import { describe, expect, it } from "vitest";
import {
  availabilitySummary,
  createExtensionClient,
  isChromiumBrowser,
  parseExtensionIds,
} from "../web/src/extension.js";

describe("website extension helpers", () => {
  it("shows extension onboarding only in Chromium browsers that can use the desktop extension", () => {
    expect(isChromiumBrowser({
      userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
    })).toBe(true);
    expect(isChromiumBrowser({
      userAgent: "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/126.0.0.0 Mobile/15E148 Safari/604.1",
      userAgentData: { brands: [{ brand: "Google Chrome" }] },
    })).toBe(false);
    expect(isChromiumBrowser({
      userAgent: "Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/128.0",
    })).toBe(false);
  });

  it("accepts comma separated stable extension IDs and removes invalid duplicates", () => {
    const first = "abcdefghijklmnopabcdefghijklmnop";
    const second = "ponmlkjihgfedcbaponmlkjihgfedcba";
    expect(parseExtensionIds(`${first}, ${second}, ${first}, invalid`)).toEqual([first, second]);
  });

  it("explains unavailable playlist entries only when the completed walk proves a gap", () => {
    expect(availabilitySummary({ collected: 2724, unavailable: 72 })).toBe(
      "2,724 of 2,796 videos were available. The other 72 are private or deleted.",
    );
    expect(availabilitySummary({ collected: 100, unavailable: 0 })).toBe("");
    expect(availabilitySummary({ collected: 60 })).toBe("");
    expect(availabilitySummary({ collected: 99, unavailable: 1 })).toBe(
      "99 of 100 videos were available. The other video is private or deleted.",
    );
  });

  it("tells the extension whether a first sync may become a full read", async () => {
    const id = "abcdefghijklmnopabcdefghijklmnop";
    const sent = [];
    const runtime = {
      sendMessage(_id, message, reply) {
        sent.push(message);
        reply(message.type === "WLL_PING" ? { ok: true } : { started: true });
      },
    };
    const client = createExtensionClient({ runtime, extensionIds: [id] });
    await client.detect();
    await client.sync("delta", { promoteFirstSync: false });
    expect(sent.at(-1)).toMatchObject({ mode: "delta", promoteFirstSync: false });
  });
});
