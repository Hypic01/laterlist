import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PhoneRow from "../web/src/phone/PhoneRow.jsx";
import SwipeRow from "../web/src/phone/SwipeRow.jsx";

const v = (id, seconds, position) => ({
  id, title: `Title ${id}`, channel: `Channel ${id}`, duration_seconds: seconds, playlist_position: position, kept_at: null,
});
const board = { learn: [v("a", 600, 1), v("b", 1200, 2)], watch: [v("c", 3600, 3)], music: [], entertainment: [], outdated: [] };
const noop = () => {};
const render = (props = {}) => renderToStaticMarkup(React.createElement(PhoneRow, {
  rowKey: "learn", board, onBack: noop, onOpenVideo: noop, onMove: noop, onRemove: noop, onCleanRow: noop, ...props,
}));

describe("PhoneRow", () => {
  it("lists one row with its count, time, filters and clean-up entry", () => {
    const html = render();
    expect(html).toContain("Worth learning from");
    expect(html).toContain("2 videos · 30 m");
    expect(html).toContain("&lt; 5 min");
    expect(html).toContain("Clean up this row");
    expect(html).toContain("Title a");
    expect(html).toContain("Title b");
    expect(html).not.toContain("Title c");
    expect(html).toContain("10:00");
  });

  it("searches across every row when opened from the Board", () => {
    const html = render({ rowKey: null, startSearch: true });
    expect(html).toContain("All videos");
    expect(html).toContain('aria-label="Search videos"');
    expect(html).toContain("Title c");
    expect(html).not.toContain("Clean up this row");
  });

  it("shows the row's empty line", () => {
    expect(render({ rowKey: "music" })).toContain("All quiet in here.");
  });
});

describe("SwipeRow", () => {
  it("keeps its hidden actions out of the tab order until revealed", () => {
    const html = renderToStaticMarkup(React.createElement(SwipeRow, { onMove: noop, onRemove: noop },
      React.createElement("span", null, "child")));
    expect(html).toContain("child");
    expect(html).toContain("Move");
    expect(html).toContain("Remove");
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
  });
});
