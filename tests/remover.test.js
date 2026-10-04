import { describe, expect, it, vi } from "vitest";
import {
  EDIT_PLAYLIST_PATH,
  removeVideoAction,
  removeFromWatchLater,
} from "../extension/src/remover.main.js";

function page({ account = "account||user", loggedIn = true } = {}) {
  const values = {
    LOGGED_IN: loggedIn,
    DATASYNC_ID: account,
    INNERTUBE_API_KEY: "page-key",
    INNERTUBE_CONTEXT: { client: { clientName: "WEB", clientVersion: "2.1" } },
  };
  return {
    location: { origin: "https://www.youtube.com", href: "https://www.youtube.com/" },
    document: { cookie: "SAPISID=page-cookie" },
    ytcfg: { get: (key) => values[key] },
  };
}

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function harness(overrides = {}) {
  const fetch = vi.fn(async () => response(200, { status: "STATUS_SUCCEEDED" }));
  const sleep = vi.fn(async () => {});
  return {
    win: page(), fetch, sleep, sha1: async () => "a".repeat(40),
    videoIds: ["first12345", "second12345"], expectedAccount: "account||user",
    ...overrides,
  };
}

describe("Watch Later remover", () => {
  it("uses an authenticated edit_playlist request, one action per video, with pacing", async () => {
    const args = harness();
    expect(EDIT_PLAYLIST_PATH).toBe("/youtubei/v1/browse/edit_playlist");
    expect(removeVideoAction("first12345")).toEqual({
      action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: "first12345",
    });
    expect(await removeFromWatchLater(args)).toEqual([
      { videoId: "first12345", ok: true },
      { videoId: "second12345", ok: true },
    ]);
    expect(args.fetch).toHaveBeenCalledTimes(2);
    expect(args.sleep).toHaveBeenCalledTimes(1);
    expect(args.sleep).toHaveBeenCalledWith(300);
    for (const [index, [url, init]] of args.fetch.mock.calls.entries()) {
      const parsedUrl = new URL(url);
      expect(parsedUrl.pathname).toBe(EDIT_PLAYLIST_PATH);
      expect(parsedUrl.searchParams.get("key")).toBe("page-key");
      expect(parsedUrl.searchParams.get("prettyPrint")).toBe("false");
      expect(init).toMatchObject({
        method: "POST", credentials: "include",
        headers: { "x-origin": "https://www.youtube.com" },
      });
      expect(init.headers.authorization).toMatch(/^SAPISIDHASH /);
      expect(JSON.parse(init.body)).toEqual({
        context: { client: { clientName: "WEB", clientVersion: "2.1" } },
        playlistId: "WL",
        actions: [removeVideoAction(args.videoIds[index])],
      });
    }
  });

  it("refuses a mismatched or unbound account without fetching", async () => {
    const mismatch = harness({ expectedAccount: "someone-else" });
    expect(await removeFromWatchLater(mismatch)).toEqual(mismatch.videoIds.map((videoId) => ({
      videoId, ok: false, error: "ACCOUNT_MISMATCH",
    })));
    expect(mismatch.fetch).not.toHaveBeenCalled();
    const unbound = harness({ expectedAccount: null });
    expect(await removeFromWatchLater(unbound)).toEqual(unbound.videoIds.map((videoId) => ({
      videoId, ok: false, error: "NOT_BOUND",
    })));
    expect(unbound.fetch).not.toHaveBeenCalled();
  });

  it("reports signed out before attempting to fetch", async () => {
    const args = harness({ win: page({ loggedIn: false }) });
    expect(await removeFromWatchLater(args)).toEqual(args.videoIds.map((videoId) => ({
      videoId, ok: false, error: "SIGNED_OUT",
    })));
    expect(args.fetch).not.toHaveBeenCalled();
  });

  it("maps non-success responses and thrown fetches per video", async () => {
    const args = harness({ videoIds: ["a12345678", "b12345678", "c12345678", "d12345678"] });
    args.fetch
      .mockResolvedValueOnce(response(200, { status: "STATUS_FAILED" }))
      .mockResolvedValueOnce(response(500, {}))
      .mockRejectedValueOnce(new Error("network gone"))
      .mockResolvedValueOnce(response(204, { status: "STATUS_SUCCEEDED" }));
    expect(await removeFromWatchLater(args)).toEqual([
      { videoId: "a12345678", ok: false, error: "EDIT_FAILED" },
      { videoId: "b12345678", ok: false, error: "HTTP_500" },
      { videoId: "c12345678", ok: false, error: "NETWORK_ERROR" },
      { videoId: "d12345678", ok: true },
    ]);
    expect(args.sleep).toHaveBeenCalledTimes(3);
  });
});
