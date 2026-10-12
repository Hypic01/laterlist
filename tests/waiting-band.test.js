import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WaitingBand from "../web/src/components/WaitingBand.jsx";

const render = (waitingCount) => renderToStaticMarkup(React.createElement(WaitingBand, {
  waitingCount, onToast: () => {}, onJobStarted: () => {},
}));

describe("WaitingBand", () => {
  it("offers Sort now when videos are waiting, with no pricing words", () => {
    const html = render(1234);
    expect(html).toContain("1,234 videos are waiting to be sorted");
    expect(html).toContain("Sort now");
    expect(html).not.toMatch(/upgrade|pro\b|plan|free/i);
  });

  it("renders nothing when nothing is waiting", () => {
    expect(render(0)).toBe("");
  });
});
