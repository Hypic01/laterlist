import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import VideoCard from "../web/src/components/VideoCard.jsx";

const video = {
  id: "vid00000001",
  title: "A very good video",
  channel: "A channel",
  duration_seconds: 300,
  category: "learn",
  reasoning: "teaches something",
};

const baseProps = {
  video,
  onMove: () => {},
  onDismiss: () => {},
  onDone: () => {},
  onOpenDetail: () => {},
  onTldr: () => {},
};

describe("VideoCard face", () => {
  it("plays in Laterlist from the thumbnail and keeps Done off the face", () => {
    const html = renderToStaticMarkup(React.createElement(VideoCard, baseProps));
    expect(html).toContain('aria-label="Play &quot;A very good video&quot; here"');
    expect(html).toContain("Play here");
    expect(html).toContain("TL;DR");
    // Done now lives in the kebab menu as "Remove · watched it".
    expect(html).not.toContain(">done<");
    expect(html).not.toContain("Mark ");
  });

  it("keeps Learn off the card face while it's still coming soon", () => {
    // Learn lives in the video detail view only; the card shows TL;DR and the menu.
    const html = renderToStaticMarkup(React.createElement(VideoCard, baseProps));
    expect(html).not.toContain("Learn");
  });
});
