import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Settings from "../web/src/components/Settings.jsx";

const base = {
  me: {
    email: "reader@test.dev", plan: "free", videoCap: 1000,
    summariesUsed: 0, summaryQuota: 100, youtubeRemovalAvailable: true,
  },
  extension: { present: true, connected: true, mismatch: false },
  extensionConnected: true,
  extensionVersionOk: true,
  removeFromYoutube: true,
  onToggleRemoveFromYoutube: vi.fn(),
  onBack: vi.fn(), onToast: vi.fn(), onRetakeQuiz: vi.fn(),
  onConnectExtension: vi.fn(), onImportManually: vi.fn(),
};

describe("YouTube removal setting", () => {
  it("shows On and Off controls with the current preference", () => {
    const html = renderToStaticMarkup(React.createElement(Settings, base));
    expect(html).toContain("Remove from YouTube too. When you remove a video here, the extension also takes it off your YouTube Watch Later.");
    expect(html).toMatch(/aria-pressed="true"[^>]*>On<\/button>/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Off<\/button>/);
  });

  it("hides the row when the server kill switch is off and guides older extensions", () => {
    const unavailable = renderToStaticMarkup(React.createElement(Settings, {
      ...base, me: { ...base.me, youtubeRemovalAvailable: false },
    }));
    expect(unavailable).not.toContain("Remove from YouTube too");
    const old = renderToStaticMarkup(React.createElement(Settings, {
      ...base, extensionVersionOk: false,
    }));
    expect(old).toContain("Update the Chrome extension to 1.3 to use this.");
  });
});
