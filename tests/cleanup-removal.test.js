import { describe, expect, it } from "vitest";
import { historyHint, youtubeStateLabel } from "../web/src/components/CleanupChecklist.jsx";

describe("History YouTube status", () => {
  it("distinguishes confirmed removals, queued removals, and failures", () => {
    expect(youtubeStateLabel("removed")).toBe("off YouTube");
    expect(youtubeStateLabel("pending")).toBe("removing");
    expect(youtubeStateLabel("failed")).toBe("still on YouTube");
    expect(youtubeStateLabel(null)).toBeNull();
  });

  // The kill switch, an old extension, or the setting being off all mean nothing
  // leaves YouTube, so the hint must not promise it then.
  it("only promises automatic removal when removal is actually active", () => {
    expect(historyHint(true)).toContain("also leave your YouTube Watch Later");
    expect(historyHint(false)).toContain("safe to remove from your real Watch Later");
    expect(historyHint(false)).not.toContain("also leave your YouTube Watch Later");
    expect(historyHint(false)).not.toContain("never changes");
  });
});
