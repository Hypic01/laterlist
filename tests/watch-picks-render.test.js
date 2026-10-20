import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  PicksDataError, weekId, validatePicks, watchUrl, bestPart, renderHtml, renderMarkdown,
  parsePicksNote, outputPaths, pastPicks,
} from "../scripts/watch-picks/render.mjs";

const pick = (over = {}) => ({
  id: "aaaaaaaaaaa", title: "Grids", channel: "Chan", durationSeconds: 1860, row: "learn",
  why: "Because.", start: 370, end: 1180, gets: ["One", "Two"], ...over,
});
const base = (over = {}) => ({
  week: "2026-10-12", focus: "Case studies", focusPoints: ["Rewrite"], picks: [pick()],
  closeButNo: [{ id: "bbbbbbbbbbb", title: "Mistakes", reason: "Repeat" }], ...over,
});
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "picks-out-"));
const goalSet = () => validatePicks({ week: "2026-10-19", notice: "", goals: [
  { name: "Find a design job", need: "Practice interviews", picks: [
    { id: "aaaaaaaaaaa", source: "youtube", title: "Walkthrough", channel: "Chan", durationSeconds: 600,
      author: "Working designer", why: "Useful now", action: "Practice today", gets: ["A step"],
      start: 60, end: 300, covers: ["ccccccccccc"] },
  ] },
  { name: "Ship a project", need: "Finish a slice", picks: [] },
], closeButNo: [] });

describe("goal set rendering", () => {
  it("groups HTML and Markdown by goal and round-trips every pick", () => {
    const data = goalSet();
    data.goals[1].picks = [{ ...data.goals[0].picks[0], id: "ddddddddddd", title: "Project video", source: "saved", covers: [] }];
    const html = renderHtml(data);
    const md = renderMarkdown(data);
    expect(html).toContain("Find a design job");
    expect(html).toContain("Ship a project");
    expect(html).toContain("From YouTube");
    expect(html).toContain("In your Watch Later");
    expect(html).toContain("Working designer");
    expect(html).toContain("Practice today");
    expect(html).toContain("Covers: 1 saved videos");
    expect(md).toContain("Covers: 1 saved videos");
    expect(parsePicksNote(md).picks).toEqual([
      { id: "aaaaaaaaaaa", title: "Walkthrough", verdict: null },
      { id: "ddddddddddd", title: "Project video", verdict: null },
    ]);
  });
});

describe("weekId", () => {
  it("returns the Monday of the local week", () => {
    expect(weekId(new Date(2026, 9, 12, 8, 0))).toBe("2026-10-12"); // Monday
    expect(weekId(new Date(2026, 9, 14, 23, 0))).toBe("2026-10-12"); // Wednesday
    expect(weekId(new Date(2026, 9, 18, 9, 0))).toBe("2026-10-12"); // Sunday
  });
});

describe("validatePicks", () => {
  it("rejects a bad id, a bad week and a missing focus", () => {
    expect(() => validatePicks(base({ picks: [pick({ id: "nope" })] }))).toThrow(PicksDataError);
    expect(() => validatePicks(base({ week: "Oct 12" }))).toThrow(PicksDataError);
    expect(() => validatePicks(base({ focus: "" }))).toThrow(PicksDataError);
  });

  it("keeps at most 3 picks and drops an end that is not after start", () => {
    const d = validatePicks(base({ picks: [pick(), pick({ id: "ccccccccccc", start: 100, end: 50 }), pick({ id: "ddddddddddd" }), pick({ id: "eeeeeeeeeee" })] }));
    expect(d.picks).toHaveLength(3);
    expect(d.picks[1]).toMatchObject({ start: 100, end: null });
  });

  it("error-only data skips the focus requirement", () => {
    expect(validatePicks({ week: "2026-10-12", error: "connect ECONNREFUSED" })).toMatchObject({
      error: "connect ECONNREFUSED", picks: [],
    });
  });
});

describe("links and best part", () => {
  it("adds &t= only when there is a start", () => {
    expect(watchUrl("aaaaaaaaaaa", 370)).toBe("https://www.youtube.com/watch?v=aaaaaaaaaaa&t=370s");
    expect(watchUrl("aaaaaaaaaaa", null)).toBe("https://www.youtube.com/watch?v=aaaaaaaaaaa");
  });

  it("describes the best part", () => {
    expect(bestPart({ start: 370, end: 1180 })).toBe("Watch 6:10 to 19:40");
    expect(bestPart({ start: 370, end: null })).toBe("Start at 6:10");
    expect(bestPart({ start: null, end: null })).toBe("Watch it all");
  });
});

describe("renderHtml", () => {
  it("renders hostile titles as text", () => {
    const evil = `<script>alert("x")</script> & "Design" | [UX] 디자인`;
    const html = renderHtml(validatePicks(base({
      picks: [pick({ title: evil, why: "<img src=x onerror=alert(1)>" })],
      closeButNo: [{ id: "bbbbbbbbbbb", title: evil, reason: "</li><b>bold</b>" }],
    })));
    expect(html).not.toMatch(/<script>alert/);
    expect(html).not.toMatch(/<img src=x/);
    expect(html).not.toMatch(/<b>bold<\/b>/);
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;Design&quot; | [UX] 디자인");
  });

  it("links to the best part, labels the row, and stays monochrome", () => {
    const html = renderHtml(validatePicks(base({ picks: [pick(), pick({ id: "ccccccccccc", row: "watch", start: null, end: null })] })));
    expect(html).toContain("https://www.youtube.com/watch?v=aaaaaaaaaaa&amp;t=370s");
    expect(html).toContain("Watch 6:10 to 19:40");
    expect(html).toContain("Watch it all");
    expect(html).toContain("Get the gist");
    expect(html).toContain("Watch it");
    expect(html).toContain("https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg");
    const hexes = new Set(html.match(/#[0-9A-Fa-f]{6}\b/g));
    expect([...hexes].sort()).toEqual(["#191919", "#212121", "#2E2E2E", "#6695F7", "#6E6E6E", "#70B665", "#9A9A9A", "#D9D9D9"].sort());
    expect(html).not.toMatch(/[–—]/);
  });

  it("renders the error page", () => {
    const html = renderHtml(validatePicks({ week: "2026-10-12", error: "connect ECONNREFUSED" }));
    expect(html).toContain("Couldn't reach Laterlist this week");
    expect(html).toContain("connect ECONNREFUSED");
  });
});

describe("markdown note", () => {
  it("round-trips picks and reads verdicts", () => {
    const d = validatePicks(base({ picks: [pick({ title: "Design [UX] | grids" }), pick({ id: "ccccccccccc", title: "Two" })] }));
    let md = renderMarkdown(d);
    expect(md).toContain("Verdict: worth it | not | skipped");
    expect(md).not.toMatch(/[–—]/);
    let parsed = parsePicksNote(md);
    expect(parsed.week).toBe("2026-10-12");
    expect(parsed.picks).toEqual([
      { id: "aaaaaaaaaaa", title: "Design [UX] | grids", verdict: null },
      { id: "ccccccccccc", title: "Two", verdict: null },
    ]);
    md = md.replace("Verdict: worth it | not | skipped", "Verdict: Worth it");
    parsed = parsePicksNote(md);
    expect(parsed.picks[0].verdict).toBe("worth it");
    expect(parsed.picks[1].verdict).toBe(null);
  });

  it("does not count close-but-no videos as picks", () => {
    const parsed = parsePicksNote(renderMarkdown(validatePicks(base())));
    expect(parsed.picks.map((p) => p.id)).toEqual(["aaaaaaaaaaa"]);
  });
});

describe("outputPaths", () => {
  it("never returns an existing file", () => {
    const dir = tmpDir();
    expect(outputPaths(dir, "2026-10-12").md).toBe(path.join(dir, "2026-10-12.md"));
    fs.writeFileSync(path.join(dir, "2026-10-12.md"), "Verdict: worth it");
    expect(outputPaths(dir, "2026-10-12")).toEqual({
      md: path.join(dir, "2026-10-12 (2).md"),
      html: path.join(dir, "2026-10-12 (2).html"),
    });
  });
});

describe("pastPicks", () => {
  it("reads notes from the last N weeks only", () => {
    const dir = tmpDir();
    const note = (week, id) => renderMarkdown(validatePicks(base({ week, picks: [pick({ id })] })));
    fs.writeFileSync(path.join(dir, "2026-10-05.md"), note("2026-10-05", "aaaaaaaaaaa"));
    fs.writeFileSync(path.join(dir, "2026-10-05 (2).md"), note("2026-10-05", "ccccccccccc"));
    fs.writeFileSync(path.join(dir, "2026-07-06.md"), note("2026-07-06", "ddddddddddd"));
    fs.writeFileSync(path.join(dir, "notes.md"), "## 1. [x](https://www.youtube.com/watch?v=eeeeeeeeeee)");
    const past = pastPicks(dir, { now: new Date(2026, 9, 12, 8, 0), weeks: 8 });
    expect(past.map((p) => p.id).sort()).toEqual(["aaaaaaaaaaa", "ccccccccccc"]);
  });

  it("returns [] when the folder does not exist", () => {
    expect(pastPicks("/nonexistent/picks", { now: new Date(), weeks: 8 })).toEqual([]);
  });
});

describe("posted note", () => {
  it("says to tap the verdict in Laterlist and parses it as unfilled", () => {
    const md = renderMarkdown(validatePicks(base()), { posted: true });
    expect(md).toContain("Verdict: tap it in Laterlist");
    expect(md).not.toContain("worth it | not | skipped");
    expect(parsePicksNote(md).picks[0].verdict).toBe(null);
  });
});
