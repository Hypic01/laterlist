import { describe, expect, it } from "vitest";
import { youtubeStateLabel } from "../web/src/components/CleanupChecklist.jsx";

describe("History YouTube status", () => {
  it("distinguishes confirmed removals, queued removals, and failures", () => {
    expect(youtubeStateLabel("removed")).toBe("off YouTube");
    expect(youtubeStateLabel("pending")).toBe("removing");
    expect(youtubeStateLabel("failed")).toBe("still on YouTube");
    expect(youtubeStateLabel(null)).toBeNull();
  });
});
