import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PhoneApp from "../web/src/phone/PhoneApp.jsx";
import { PHONE_QUERY } from "../web/src/phone/useIsPhone.js";

const v = (id, position) => ({ id, title: `Title ${id}`, channel: "C", duration_seconds: 600, playlist_position: position, kept_at: null });
const board = { learn: [v("a", 1), v("b", 2)], watch: [v("c", 3)], music: [], entertainment: [], outdated: [] };
const me = (counts) => ({ email: "a@test.dev", plan: "pro", removeFromYoutube: false, counts });
const render = (props) => renderToStaticMarkup(React.createElement(PhoneApp, {
  board, job: null, reload: async () => {}, onSummaryUsed: () => {}, ...props,
}));

describe("PhoneApp", () => {
  it("keeps the phone layout when a phone is held sideways", () => {
    expect(PHONE_QUERY).toBe("(max-width: 640px), (pointer: coarse) and (max-height: 500px)");
  });

  it("opens on the Board with the three tabs and the review count", () => {
    const html = render({ me: me({ scanned: 3, unscanned: 0, done: 0, dismissed: 0 }) });
    expect(html).toContain("Your rows");
    expect(html).toContain('aria-label="Main"');
    expect(html).toContain('<span class="ph-tab__badge">3</span>');
    expect(html).toContain("Settings");
  });

  it("sends a brand new user to their computer", () => {
    expect(render({ me: me({ scanned: 0, unscanned: 0, done: 0, dismissed: 0 }) })).toContain("Start on your computer");
  });
});
