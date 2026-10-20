import { describe, expect, it } from "vitest";
import {
  PicksDataError, allPicks, coverIds, isGoalSet, pickIds, savedPickIds, validatePicks,
} from "../server/picks.js";

const vid = (n) => `vid${String(n).padStart(8, "0")}`;
const pick = (n, over = {}) => ({
  id: vid(n), source: "youtube", title: `Video ${n}`, channel: "Chan",
  durationSeconds: 600, author: "Working designer", why: "Useful now",
  action: "Practice this week", gets: ["One thing"], start: 30, end: 300,
  noTranscript: false, covers: [], ...over,
});
const goal = (picks = [pick(1)], over = {}) => ({ name: "Find a design job", need: "Prepare for interviews", picks, ...over });
const set = (goals = [goal()]) => ({ week: "2026-10-19", notice: "", goals, closeButNo: [] });

describe("goal picks validation", () => {
  it("accepts a goal set and keeps legacy sets unchanged", () => {
    const legacy = validatePicks({ week: "2026-10-19", focus: "Portfolio", picks: [{ id: vid(1) }] });
    expect(legacy).toEqual({
      week: "2026-10-19", error: "", focus: "Portfolio", focusPoints: [], notice: "",
      picks: [{ id: vid(1), title: vid(1), channel: "", durationSeconds: null,
        row: "learn", why: "", start: null, end: null, gets: [], noTranscript: false }],
      closeButNo: [],
    });
    expect(isGoalSet(legacy)).toBe(false);
    expect(allPicks(legacy)).toMatchObject([{ id: vid(1), source: "saved" }]);
    const result = validatePicks(set([goal(), goal([], { name: "Make work" })]));
    expect(result.goals).toHaveLength(2);
    expect(isGoalSet(result)).toBe(true);
    expect(allPicks(result)).toHaveLength(1);
    expect(pickIds(result)).toEqual([vid(1)]);
    expect(savedPickIds(result)).toEqual([]);
  });

  it("caps goals at 4, picks per goal at 3, covers at 20", () => {
    const result = validatePicks(set(Array.from({ length: 5 }, (_, i) => goal(
      Array.from({ length: 4 }, (_, j) => pick(i * 10 + j + 1, { covers: Array.from({ length: 22 }, (_, k) => vid(k + 100)) })),
      { name: `Goal ${i}` },
    ))));
    expect(result.goals).toHaveLength(4);
    expect(result.goals.every((g) => g.picks.length === 3)).toBe(true);
    expect(result.goals[0].picks[0].covers).toHaveLength(20);
    expect(coverIds(result)).toHaveLength(20);
  });

  it.each([
    ["name", () => goal(undefined, { name: "" }), /goal 1.*name/],
    ["need", () => goal(undefined, { need: "" }), /goal 1.*need/],
    ["author", () => goal([pick(1, { author: "" })]), /goal 1 pick 1.*author/],
    ["action", () => goal([pick(1, { action: "" })]), /goal 1 pick 1.*action/],
    ["title", () => goal([pick(1, { title: "" })]), /goal 1 pick 1.*title/],
    ["channel", () => goal([pick(1, { channel: "" })]), /goal 1 pick 1.*channel/],
    ["duration", () => goal([pick(1, { durationSeconds: null })]), /goal 1 pick 1.*durationSeconds/],
  ])("requires %s", (_name, makeGoal, message) => {
    expect(() => validatePicks(set([makeGoal()]))).toThrowError(PicksDataError);
    expect(() => validatePicks(set([makeGoal()]))).toThrow(message);
  });

  it("rejects an unsupported source and duplicate picks", () => {
    expect(() => validatePicks(set([goal([pick(1, { source: "other" })])]))).toThrow(/source/);
    expect(() => validatePicks(set([goal([pick(1), pick(1)])]))).toThrow(/duplicate/);
  });

  it("strips picked ids and bad ids from covers", () => {
    const result = validatePicks(set([goal([
      pick(1, { covers: [vid(1), vid(2), "bad", vid(5)] }), pick(2),
    ])]));
    expect(result.goals[0].picks[0].covers).toEqual([vid(5)]);
    expect(coverIds(result)).toEqual([vid(5)]);
  });

  it("fills blank empty only for an empty goal", () => {
    const result = validatePicks(set([goal([], { empty: "" }), goal()]));
    expect(result.goals[0].empty).toBe("Nothing good enough this week.");
    expect(result.goals[1].empty).toBe("");
  });

  it("error-only sets skip every requirement", () => {
    expect(validatePicks({ week: "2026-10-19", error: "unavailable", goals: [{ picks: [{}] }] }).error).toBe("unavailable");
  });
});
