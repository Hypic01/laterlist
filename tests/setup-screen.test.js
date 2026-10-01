import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SetupScreen from "../web/src/components/SetupScreen.jsx";

const me = { email: "new@example.com", tasteProfile: null };
const ext = (patch) => ({ checking: false, present: false, connected: false, mismatch: false,
  accountEmail: me.email, isChromium: true, ...patch });
const render = (props) => renderToStaticMarkup(React.createElement(SetupScreen, {
  me, extension: ext(), collection: null, job: null, onConnect() {}, onSync() {},
  onImported() {}, onConnectExtension() {}, ...props,
}));

describe("SetupScreen", () => {
  it("starts with installing the extension, and offers the quiz as optional", () => {
    const html = render({});
    expect(html).toContain("Let&#x27;s get your Watch Later");
    expect(html).toContain("Add to Chrome");
    expect(html).toContain("While you wait");
    // Chrome users who'd rather not install still have a way in.
    expect(html).toContain("paste it in yourself");
    // Unfinished steps show their number.
    expect(html).toMatch(/setup__dot[^>]*>1</);
  });
  it("offers a manual Connect once the extension is found", () => {
    const html = render({ extension: ext({ present: true }) });
    expect(html).toContain("Extension added");
    expect(html).toContain(">Connect<");
  });
  it("never offers Connect for an extension tied to another account", () => {
    const html = render({ extension: ext({ present: true, connected: true, mismatch: true }) });
    expect(html).toContain("Reconnect");
  });
  it("shows the live fetch count while the list downloads", () => {
    const html = render({ extension: ext({ present: true, connected: true }),
      collection: { phase: "collecting", count: 214, expectedTotal: null } });
    expect(html).toContain("Connected to new@example.com");
    expect(html).toContain("214 videos");
  });
  it("shows sorting progress once the sort starts", () => {
    const html = render({ extension: ext({ present: true, connected: true }),
      job: { id: 1, state: "running", processed: 16, total: 214 } });
    expect(html).toContain("Sorting your videos");
    expect(html).toContain("16 of 214");
  });
  it("shows a fetch button when connected but nothing is running", () => {
    const html = render({ extension: ext({ present: true, connected: true }) });
    expect(html).toContain("Fetch my Watch Later");
  });
  it("uses the paste-it-yourself import outside Chromium", () => {
    const html = render({ extension: ext({ isChromium: false }) });
    expect(html).not.toContain("Add to Chrome");
    expect(html).toContain("Copy the collector");
    expect(html).toContain("While you wait");
  });
  it("shows sorting progress for paste imports outside Chromium", () => {
    const html = render({ extension: ext({ isChromium: false }),
      job: { id: 3, state: "running", processed: 25, total: 600 } });
    expect(html).toContain("Sorting your videos");
    expect(html).toContain("25 of 600");
    expect(html).not.toContain("Copy the collector");
    expect(html).not.toContain("Add to Chrome");
  });
  it("shows sorting progress for a Chrome user who pasted instead of installing", () => {
    const html = render({ job: { id: 4, state: "queued", processed: 0, total: 80 } });
    expect(html).toContain("Sorting your videos");
    expect(html).not.toContain("Add to Chrome");
    expect(html).not.toContain("Copy the collector");
  });
  it("shows the last failure under the checklist", () => {
    const html = render({ extension: ext({ present: true, connected: true }),
      job: { id: 2, state: "failed", error: "Sorting is temporarily paused." } });
    expect(html).toContain("Sorting is temporarily paused.");
  });
});
