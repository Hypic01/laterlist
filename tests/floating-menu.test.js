import { describe, expect, it } from "vitest";
import { placeMenu } from "../web/src/components/FloatingMenu.jsx";

const viewport = { width: 1000, height: 800 };
const anchor = (top, left = 600, width = 30, height = 30) =>
  ({ top, bottom: top + height, left, right: left + width, width, height });

describe("placeMenu", () => {
  it("opens below the trigger when it fits, right-aligned to it", () => {
    const pos = placeMenu({ anchor: anchor(100), menu: { width: 200, height: 300 }, viewport });
    expect(pos.top).toBe(136);
    expect(pos.left).toBe(430);
  });

  // The card kebab sits at the bottom of a card; near the bottom of the screen
  // the menu has to open upward instead of running off the page.
  it("flips above the trigger when there is no room below", () => {
    const pos = placeMenu({ anchor: anchor(700), menu: { width: 200, height: 300 }, viewport });
    expect(pos.top).toBe(700 - 6 - 300);
  });

  it("caps the height to the roomier side when neither side fits", () => {
    const pos = placeMenu({ anchor: anchor(300), menu: { width: 200, height: 900 }, viewport });
    expect(pos.top).toBe(336);
    expect(pos.maxHeight).toBe(800 - 330 - 6 - 8);
  });

  it("stays inside the left and right edges of the screen", () => {
    expect(placeMenu({ anchor: anchor(100, 10), menu: { width: 200, height: 100 }, viewport }).left).toBe(8);
    expect(placeMenu({ anchor: anchor(100, 950), menu: { width: 200, height: 100 }, viewport, align: "start" }).left)
      .toBe(1000 - 8 - 200);
  });
});
