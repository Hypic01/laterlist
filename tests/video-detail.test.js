import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import VideoDetail from "../web/src/components/VideoDetail.jsx";
import { LearnIcon } from "../web/src/components/icons.jsx";

const video = {
  id: "abc12345678",
  title: "A useful video",
  channel: "A channel",
  duration_seconds: 603,
  category: "learn",
  reasoning: "The ideas carry the value.",
  topics: ["tech"],
  transcript_available: false,
};

const baseProps = {
  video,
  rowMeta: { label: "Worth learning from", tint: "#f472b6", icon: LearnIcon },
  extensionPresent: false,
  onBack: vi.fn(),
  onMove: vi.fn(),
  onDismiss: vi.fn(),
  onDone: vi.fn(),
  onToast: vi.fn(),
};

describe("VideoDetail M4 actions", () => {
  it("shows the YouTube removal promise when the connected extension supports it", () => {
    const html = renderToStaticMarkup(React.createElement(VideoDetail, {
      ...baseProps,
      removesFromYoutube: true,
      me: { plan: "free", isAdmin: false, summariesUsed: 2, summaryQuota: 100 },
    }));
    expect(html).toContain("Mark watched hides it here and takes it off your YouTube Watch Later.");
    expect(html).not.toContain("Your YouTube Watch Later stays unchanged.");
  });

  it("shows click-to-play, local watched state, and the external fallback", () => {
    const html = renderToStaticMarkup(React.createElement(VideoDetail, {
      ...baseProps,
      me: { plan: "free", isAdmin: false, summariesUsed: 2, summaryQuota: 100 },
    }));

    expect(html).toContain('aria-label="Play &quot;A useful video&quot; here"');
    expect(html).toContain("Play here");
    expect(html).not.toContain("<iframe");
    expect(html).toContain("Mark watched");
    expect(html).toContain("Your YouTube Watch Later stays unchanged.");
    expect(html).not.toContain("Learn</button>");
    expect(html).toContain('aria-label="TL;DR. 2 of 100 TL;DRs used this month"');
    expect(html).toContain('class="detail__quota"');
    expect(html).toContain("2/100");
    expect(html).toContain("Open on YouTube</a>");
    expect(html).toContain("Not interested</button>");
    expect(html).not.toContain(">Dismiss</button>");
  });

  it("starts one privacy-enhanced inline player for a play intent", () => {
    const html = renderToStaticMarkup(React.createElement(VideoDetail, {
      ...baseProps,
      intent: "play",
      me: { plan: "free", isAdmin: false, summariesUsed: 2, summaryQuota: 100 },
    }));

    expect(html.match(/<iframe/g)).toHaveLength(1);
    expect(html).toContain("https://www.youtube-nocookie.com/embed/abc12345678");
    expect(html).toContain("autoplay=1");
    expect(html).toContain("playsinline=1");
    expect(html).toContain('title="YouTube player for &quot;A useful video&quot;"');
    expect(html).toContain('referrerPolicy="strict-origin-when-cross-origin"');
    expect(html).toContain('allowfullscreen=""');
  });

  it("does not show a free meter for Pro", () => {
    const html = renderToStaticMarkup(React.createElement(VideoDetail, {
      ...baseProps,
      me: { plan: "pro", isAdmin: false, summariesUsed: 12, summaryQuota: 100 },
    }));

    expect(html).not.toContain("Learn</button>");
    expect(html).toContain("TL;DR</button>");
    expect(html).not.toContain("detail__quota");
  });
});
