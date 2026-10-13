import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Settings from "../web/src/components/Settings.jsx";
import VideoDetail from "../web/src/components/VideoDetail.jsx";
import PrivateScreen from "../web/src/components/PrivateScreen.jsx";

describe("private web surfaces", () => {
  it("Settings has no plan heading or upgrade button", () => {
    const html = renderToStaticMarkup(React.createElement(Settings, {
      me: { email: "joon@test.dev", tasteProfile: {}, youtubeRemovalAvailable: false },
      extension: {}, onBack: () => {}, onToast: () => {}, onRetakeQuiz: () => {},
    }));
    expect(html).not.toContain("<h3>Plan</h3>");
    expect(html).not.toContain("Upgrade to Pro");
  });

  it("VideoDetail has no upgrade card or quota text", () => {
    const html = renderToStaticMarkup(React.createElement(VideoDetail, {
      video: { id: "abc12345678", title: "A video", category: "learn" },
      me: { email: "joon@test.dev" },
      onBack: () => {}, onMove: () => {}, onDismiss: () => {}, onDone: () => {},
    }));
    expect(html).not.toContain("summary__upgrade");
    expect(html).not.toContain("detail__quota");
    expect(html).not.toContain("TL;DRs used this month");
  });

  it("PrivateScreen explains the lock and signs out", () => {
    const onSignOut = vi.fn();
    const tree = PrivateScreen({ onSignOut });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("This Laterlist is private.");
    expect(html).toContain("Sign out");
    tree.props.children[2].props.onClick();
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
