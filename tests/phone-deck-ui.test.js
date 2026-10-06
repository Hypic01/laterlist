import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CleanupDeck, { DoneScreen } from "../web/src/phone/CleanupDeck.jsx";

const v = (id, category) => ({ id, category, title: `Title ${id}`, channel: "Channel", duration_seconds: 1161, playlist_position: 1, kept_at: null });
const noop = () => {};
const stats = (over = {}) => ({ reviewed: 1, removed: 1, kept: 0, moved: 0, removedSeconds: 600, ...over });
const deck = (props = {}) => renderToStaticMarkup(React.createElement(CleanupDeck, {
  deck: [v("a", "entertainment"), v("b", "watch")], startCount: 3, stats: stats(), removalQueued: false,
  onClose: noop, onDecide: noop, onOpenVideo: noop, onMove: noop, onTldr: noop, ...props,
}));
const done = (props = {}) => renderToStaticMarkup(React.createElement(DoneScreen, { stats: stats(), removalQueued: false, onClose: noop, ...props }));

describe("CleanupDeck", () => {
  it("shows progress, the front card, and a labelled button for every swipe", () => {
    const html = deck();
    expect(html).toContain("2 of 3");
    expect(html).toContain("Title a");
    expect(html).toContain("Just for fun");
    expect(html).toContain("Channel · 19:21");
    expect(html).toContain("Swipe left to remove, right to keep");
    expect(html).toContain(">Remove<");
    expect(html).toContain(">Keep<");
    expect(html).toContain("Wrong row? Move it");
    expect(html).toContain('aria-hidden="true"');
  });

  it("ends on the Done screen when the deck is empty", () => {
    expect(deck({ deck: [] })).toContain("You let go of 1 video");
  });
});

describe("DoneScreen", () => {
  it("says what the session gave back", () => {
    const html = done({ stats: stats({ reviewed: 4, removed: 3, kept: 1, removedSeconds: 7300 }), removalQueued: true });
    expect(html).toContain("You let go of 3 videos");
    expect(html).toContain("2 hours you no longer owe anyone."); // React escapes the apostrophe in "That's"
    expect(html).toContain("Removed videos leave your YouTube Watch Later the next time Laterlist is open on your computer.");
  });

  it("skips the hours line under an hour, and handles an empty pile", () => {
    expect(done()).not.toContain("you no longer owe anyone");
    expect(done({ stats: stats({ reviewed: 0, removed: 0 }) })).toContain("Nothing left to sort");
  });
});
