import { createYtcfgRequestTemplate, currentYoutubeAccount } from "../../collector/innertube.js";

// The edit endpoint is a live-canary hypothesis. Keep it in one place so the
// verified request can be updated without changing the drain controller.
export const EDIT_PLAYLIST_PATH = "/youtubei/v1/browse/edit_playlist";
export const removeVideoAction = (videoId) => ({
  action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID",
  removedVideoId: videoId,
});

export async function removeFromWatchLater({
  win,
  fetch: fetchImpl,
  sleep,
  sha1,
  videoIds,
  expectedAccount,
}) {
  const ids = Array.isArray(videoIds) ? videoIds : [];
  const failAll = (error) => ids.map((videoId) => ({ videoId, ok: false, error }));
  const configured = (key) => win?.ytcfg?.get?.(key) ?? win?.ytcfg?.data_?.[key];
  if (configured("LOGGED_IN") === false) return failAll("SIGNED_OUT");
  if (!expectedAccount) return failAll("NOT_BOUND");
  if (currentYoutubeAccount(win) !== expectedAccount) return failAll("ACCOUNT_MISMATCH");

  let template;
  let context;
  try {
    template = await createYtcfgRequestTemplate({ win, path: EDIT_PLAYLIST_PATH, sha1 });
    context = JSON.parse(template.init.body).context;
  } catch {
    return failAll("NETWORK_ERROR");
  }

  const results = [];
  for (const [index, videoId] of ids.entries()) {
    if (index) await sleep(300);
    try {
      const response = await fetchImpl(template.url, {
        ...template.init,
        body: JSON.stringify({
          context,
          playlistId: "WL",
          actions: [removeVideoAction(videoId)],
        }),
      });
      if (!response.ok) {
        results.push({ videoId, ok: false, error: `HTTP_${response.status}` });
        continue;
      }
      const body = await response.json();
      results.push(body?.status === "STATUS_SUCCEEDED"
        ? { videoId, ok: true }
        : { videoId, ok: false, error: "EDIT_FAILED" });
    } catch {
      results.push({ videoId, ok: false, error: "NETWORK_ERROR" });
    }
  }
  return results;
}

globalThis.__laterlistRemoveFromWatchLater = (args) => removeFromWatchLater({
  win: window,
  fetch: window.fetch.bind(window),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ...args,
});
