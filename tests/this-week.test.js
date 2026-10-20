import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThisWeekView, applyVerdict, applyRemoved, removableCovers, mondayOf, bestPart, weekLabel } from "../web/src/components/ThisWeek.jsx";

const pick = (n, over = {}) => ({
  id: `vid0000000${n}`, title: `Video ${n}`, channel: "Chan", durationSeconds: 1860, row: "learn",
  why: `Why ${n}`, start: 184, end: 970, gets: ["One thing"], verdict: null, ...over,
});
const set = (over = {}) => ({
  week: "2026-10-12", focus: "Finish the portfolio", focusPoints: ["Case studies"], notice: "",
  picks: [pick(1), pick(2, { row: "watch", start: null, end: null }), pick(3)],
  closeButNo: [{ id: "vid00000009", title: "Close one", reason: "Repeats your notes", inLibrary: true }],
  ...over,
});
const cover = (n, gone = false) => ({ id: `vid0000000${n}`, title: `Saved ${n}`, channel: "Chan", durationSeconds: 600, gone });
const goalPick = (n, source = "youtube", over = {}) => ({
  ...pick(n), source, author: "Working designer", action: "Practice the walkthrough",
  covers: [cover(4), cover(5)], video: source === "saved" ? { category: "learn" } : null,
  ...over,
});
const goalSet = (over = {}) => ({
  week: "2026-10-19", notice: "", goals: [
    { name: "Land a design job", need: "Interview practice", empty: "", picks: [goalPick(1), goalPick(2, "saved")] },
    { name: "Make more work", need: "Ship a project", empty: "Nothing good enough this week.", picks: [] },
  ], closeButNo: [], ...over,
});
const view = (state, extra = {}) => renderToStaticMarkup(React.createElement(ThisWeekView, {
  state, thisMonday: "2026-10-12", onVerdict: () => {}, onRetry: () => {}, onOpenLibrary: () => {}, onOpenVideo: () => {}, ...extra,
}));

describe("ThisWeekView", () => {
  it("shows the focus, three cards, best parts and verdict buttons", () => {
    const html = view({ status: "ready", set: set() });
    expect(html).toContain("Week of Oct 12");
    expect(html).toContain("Finish the portfolio");
    expect((html.match(/class="pick"/g) || []).length).toBe(3);
    expect(html).toContain("Watch 3:04 to 16:10");
    expect(html).toContain("Watch it all");
    expect(html).toContain("https://www.youtube.com/watch?v=vid00000001&amp;t=184s");
    expect(html).toContain("Worth it");
    expect(html).toContain("Not for me");
    expect(html).toContain("Didn&#x27;t watch");
    expect(html).toContain("Close, but no (1)");
    expect(html).not.toMatch(/[–—]/);
  });

  it("marks the chosen verdict", () => {
    const html = view({ status: "ready", set: set({ picks: [pick(1, { verdict: "worth" }), pick(2), pick(3)] }) });
    expect(html).toMatch(/aria-pressed="true"[^>]*>Worth it/);
  });

  it("flags picks from an earlier week as stale", () => {
    const html = view({ status: "ready", set: set({ week: "2026-10-05" }) });
    expect(html).toContain("These are last week&#x27;s picks. Is your Mac awake Monday at 8?");
  });

  it("explains the empty state", () => {
    const html = view({ status: "ready", set: null });
    expect(html).toContain("Your first picks arrive Monday at 8 AM.");
    expect(html).toContain("Open your library");
  });

  it("shows loading and error states", () => {
    expect(view({ status: "loading" })).toContain('aria-busy="true"');
    const err = view({ status: "error", message: "offline" });
    expect(err).toContain("offline");
    expect(err).toContain("Retry");
  });

  it("renders hostile titles as text", () => {
    const html = view({ status: "ready", set: set({ picks: [pick(1, { title: '<img src=x onerror=alert(1)> & "디자인"' }), pick(2), pick(3)] }) });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;디자인&quot;");
  });
});

describe("goal picks view", () => {
  it("renders goal sections, counts, empty text and source pills", () => {
    const html = view({ status: "ready", set: goalSet() }, { thisMonday: "2026-10-19" });
    expect((html.match(/class="goal"/g) || []).length).toBe(2);
    expect(html).toContain("2 picks");
    expect(html).toContain("0 picks");
    expect(html).toContain("Nothing good enough this week.");
    expect(html).toContain("From YouTube");
    expect(html).toContain("In your Watch Later");
  });

  it("shows a category dot only for a saved pick", () => {
    const html = view({ status: "ready", set: goalSet() });
    expect((html.match(/class="pick__dot"/g) || []).length).toBe(1);
  });

  it("opens small cover blocks, collapses large ones and strikes gone rows", () => {
    const small = view({ status: "ready", set: goalSet({ goals: [
      { name: "Goal", need: "Now", picks: [goalPick(1, "youtube", { covers: [cover(4), cover(5, true)] })] },
    ] }) });
    expect(small).toMatch(/<details class="covers" open=""/);
    expect(small).toContain("Remove all 1");
    expect(small).toContain("covers__row--gone");
    const large = view({ status: "ready", set: goalSet({ goals: [
      { name: "Goal", need: "Now", picks: [goalPick(1, "youtube", {
        covers: Array.from({ length: 6 }, (_, i) => cover(i + 4)),
      })] },
    ] }) });
    expect(large).toContain('<details class="covers"');
    expect(large).not.toContain('<details class="covers" open=""');
    expect(large).toContain("Remove all 6");
  });

  it("renders hostile goal names and cover titles as text", () => {
    const html = view({ status: "ready", set: goalSet({ goals: [{
      name: '<img src=x onerror=alert(1)>', need: "Need", picks: [goalPick(1, "youtube", {
        covers: [{ ...cover(4), title: '<script>alert(1)</script>' }],
      })],
    }] }) });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("helpers", () => {
  it("removableCovers skips left-out and gone ids", () => {
    expect(removableCovers(goalPick(1, "youtube", { covers: [cover(4), cover(5, true), cover(6)] }), new Set([cover(6).id])))
      .toEqual([cover(4).id]);
  });

  it("applyRemoved marks ids gone in every pick", () => {
    const next = applyRemoved(goalSet(), [cover(4).id]);
    expect(next.goals[0].picks.map((p) => p.covers[0].gone)).toEqual([true, true]);
  });

  it("applyVerdict updates one pick only", () => {
    const next = applyVerdict(set(), "vid00000002", "not");
    expect(next.picks.map((p) => p.verdict)).toEqual([null, "not", null]);
  });

  it("mondayOf, bestPart and weekLabel", () => {
    expect(mondayOf(new Date(2026, 9, 18, 9))).toBe("2026-10-12");
    expect(bestPart({ start: 184, end: 970 })).toBe("Watch 3:04 to 16:10");
    expect(bestPart({ start: 184, end: null })).toBe("Start at 3:04");
    expect(bestPart({ start: null, end: null })).toBe("Watch it all");
    expect(weekLabel("2026-10-12")).toBe("Oct 12");
  });
});
