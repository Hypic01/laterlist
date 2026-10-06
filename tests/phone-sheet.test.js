import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetBody } from "../web/src/phone/VideoSheet.jsx";

const video = { id: "abc12345678", title: "A useful video", channel: "A channel", duration_seconds: 603, category: "learn" };
const noop = () => {};
const render = (props = {}) => renderToStaticMarkup(React.createElement(SheetBody, {
  video, panel: "main", onPanel: noop, removalQueued: false,
  onPlay: noop, onTldr: noop, onMove: noop, onDone: noop, onDismiss: noop, ...props,
}));

describe("SheetBody", () => {
  it("leads with Open in YouTube and lists every action", () => {
    const html = render();
    expect(html).toContain('href="https://www.youtube.com/watch?v=abc12345678"');
    expect(html).toContain("A channel · 10:03");
    expect(html).toContain("Play here");
    expect(html).toContain("TL;DR");
    expect(html).toContain("Worth learning from");
    expect(html).toContain("Watched it, remove");
    expect(html).toContain("Not interested, remove");
    expect(html).not.toContain("next time Laterlist is open on your computer");
  });

  it("explains when YouTube catches up, only when removal is on", () => {
    expect(render({ removalQueued: true }))
      .toContain("Removed videos leave your YouTube Watch Later the next time Laterlist is open on your computer.");
  });

  it("lists the five rows to move to, with the current one disabled", () => {
    const html = render({ panel: "move" });
    expect(html.match(/class="ph-sitem"/g)).toHaveLength(5);
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    expect(html).toContain("Here now");
  });
});
