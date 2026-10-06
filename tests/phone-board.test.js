import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PhoneBoard from "../web/src/phone/PhoneBoard.jsx";
import PhoneSetupNote from "../web/src/phone/PhoneSetupNote.jsx";

const v = (id, seconds, position) => ({
  id, title: `Title ${id}`, channel: "Channel", duration_seconds: seconds, playlist_position: position, kept_at: null,
});
const board = { learn: [v("a", 600, 1), v("b", 1200, 2)], watch: [v("c", 3600, 3)], music: [], entertainment: [], outdated: [] };
const noop = () => {};
const render = (props = {}) => renderToStaticMarkup(React.createElement(PhoneBoard, {
  board, deckCount: 3, job: null, onOpenRow: noop, onStartCleanup: noop, onSearch: noop, ...props,
}));

describe("PhoneBoard", () => {
  it("shows the pile as one number with its total time", () => {
    const html = render();
    expect(html).toContain("<b>3</b>");
    expect(html).toContain("1 h 30 m of watching");
    expect(html).toContain("Start clean up");
  });

  it("lists every row, and empty rows show their line but can't be opened", () => {
    const html = render();
    expect(html).toContain("Worth learning from");
    expect(html).toContain("<small>30 m</small>");
    expect(html).toContain("All quiet in here.");
    expect(html.match(/<button class="ph-group__row"/g)).toHaveLength(2);
  });

  it("says when everything has been reviewed", () => {
    const html = render({ deckCount: 0 });
    expect(html).toContain("Everything here has been reviewed.");
    expect(html).not.toContain("Start clean up");
  });

  it("shows sorting progress while a job runs", () => {
    expect(render({ job: { state: "running", processed: 5, total: 20 } })).toContain("Sorting 5 of 20…");
  });
});

describe("PhoneSetupNote", () => {
  it("sends a new user to their computer", () => {
    const html = renderToStaticMarkup(React.createElement(PhoneSetupNote, { host: "laterlist-app.vercel.app" }));
    expect(html).toContain("Start on your computer");
    expect(html).toContain("laterlist-app.vercel.app/app");
    expect(html).toContain("New videos come in when Laterlist syncs on your computer.");
  });
});
