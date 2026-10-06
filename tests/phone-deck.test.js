import { describe, expect, it } from "vitest";
import { ROWS, DURATIONS } from "../web/src/rows.js";
import { CATEGORIES } from "../web/src/components/VideoCard.jsx";
import {
  applyOverlay, buildDeck, findVideo, formatTotal, pruneOverlay, releaseVelocity, revertEffect, sessionStats,
  swipeOutcome, totalSeconds,
} from "../web/src/phone/deck.js";
import { REMOVAL_NOTE, SYNC_NOTE } from "../web/src/phone/copy.js";

const v = (id, category, position, extra = {}) => ({
  id, category, playlist_position: position, duration_seconds: 600,
  title: `Title ${id}`, channel: "Channel", kept_at: null, ...extra,
});
const board = () => ({
  learn: [v("a", "learn", 1), v("b", "learn", 9)],
  watch: [v("c", "watch", 5, { kept_at: "2026-10-05T00:00:00Z" })],
  music: [v("d", "music", 7)],
  entertainment: [],
  outdated: [],
});

describe("rows", () => {
  it("matches the desktop categories and length buckets", () => {
    expect(ROWS.map((r) => r.key)).toEqual(CATEGORIES.map((c) => c.key));
    expect(DURATIONS.map((d) => d.key)).toEqual(["xs", "md", "lg", "xl"]);
  });
});

describe("buildDeck", () => {
  it("mixes every row, oldest saved first, and skips kept videos", () => {
    expect(buildDeck(board()).map((x) => x.id)).toEqual(["b", "d", "a"]);
  });
  it("can stay inside one row", () => {
    expect(buildDeck(board(), { row: "learn" }).map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("overlay", () => {
  it("hides removed videos, marks kept ones, and moves rows", () => {
    const out = applyOverlay(board(), { a: { hide: true }, b: { kept: true }, d: { category: "watch", kept: false } });
    expect(out.learn.map((x) => x.id)).toEqual(["b"]);
    expect(out.learn[0].kept_at).toBe("pending");
    expect(out.watch.map((x) => x.id)).toEqual(["c", "d"]);
    expect(out.watch[1].category).toBe("watch");
    expect(out.music).toEqual([]);
    expect(buildDeck(out).map((x) => x.id)).toEqual(["d"]);
  });

  it("keeps an entry until the server's board reflects it", () => {
    const overlay = { a: { hide: true }, b: { kept: true }, d: { category: "watch", kept: false } };
    expect(pruneOverlay(board(), overlay)).toEqual(overlay);
    const fresh = {
      learn: [v("b", "learn", 9, { kept_at: "2026-10-05T01:00:00Z" })],
      watch: [v("c", "watch", 5), v("d", "watch", 7)],
      music: [], entertainment: [], outdated: [],
    };
    expect(pruneOverlay(fresh, overlay)).toEqual({});
  });

  it("undo puts back the earlier action, and never clobbers a newer one", () => {
    const moved = { category: "music", kept: false };
    const hidden = { hide: true };
    // move, then remove, then undo the remove: the move still shows
    expect(revertEffect({ a: hidden }, "a", hidden, moved)).toEqual({ a: moved });
    // undo with nothing before it clears the entry
    expect(revertEffect({ a: hidden }, "a", hidden, undefined)).toEqual({});
    // a newer action owns the entry now: leave it alone
    expect(revertEffect({ a: hidden }, "a", moved, undefined)).toEqual({ a: hidden });
  });

  it("finds a video in any row", () => {
    expect(findVideo(board(), "d").title).toBe("Title d");
    expect(findVideo(board(), "zzz")).toBeNull();
  });
});

describe("totals", () => {
  it("adds durations and prints hours and minutes", () => {
    expect(totalSeconds([v("a", "learn", 1), v("b", "learn", 2, { duration_seconds: null })])).toBe(600);
    expect(formatTotal(62058)).toBe("17 h 14 m");
    expect(formatTotal(2460)).toBe("41 m");
    expect(formatTotal(0)).toBe("0 m");
  });
});

describe("swipeOutcome", () => {
  it("commits past 35% of the card or on a fast flick", () => {
    expect(swipeOutcome(-130, 0, 340)).toBe("remove");
    expect(swipeOutcome(130, 0, 340)).toBe("keep");
    expect(swipeOutcome(-60, -0.8, 340)).toBe("remove");
    expect(swipeOutcome(60, 0.8, 340)).toBe("keep");
    expect(swipeOutcome(-60, -0.1, 340)).toBeNull();
    expect(swipeOutcome(10, 2, 340)).toBeNull();
  });
});

describe("releaseVelocity", () => {
  it("drops a stale flick when the finger paused before lifting", () => {
    expect(releaseVelocity(-0.9, 16)).toBe(-0.9);
    expect(releaseVelocity(-0.9, 300)).toBe(0);
  });
});

describe("sessionStats", () => {
  it("counts what the session did, minus undone actions", () => {
    const log = [
      { key: 1, kind: "dismiss", video: v("a", "learn", 1, { duration_seconds: 3600 }) },
      { key: 2, kind: "keep", video: v("b", "learn", 2) },
      { key: 3, kind: "move", video: v("c", "watch", 3) },
      { key: 4, kind: "done", video: v("d", "music", 4, { duration_seconds: 1800 }) },
    ];
    expect(sessionStats(log, new Set([4]))).toEqual({ reviewed: 3, removed: 1, kept: 1, moved: 1, removedSeconds: 3600 });
  });
});

describe("copy", () => {
  it("says exactly when YouTube catches up", () => {
    expect(REMOVAL_NOTE).toBe("Removed videos leave your YouTube Watch Later the next time Laterlist is open on your computer.");
    expect(SYNC_NOTE).toBe("New videos come in when Laterlist syncs on your computer.");
  });
});
