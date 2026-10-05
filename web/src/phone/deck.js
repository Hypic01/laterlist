// Pure logic for the phone layout: what Clean up shows, how optimistic
// actions overlay the board, and the small numbers the screens print.
import { SORTS } from "../lib.js";
import { ROWS } from "../rows.js";

export const ROW_KEYS = ROWS.map((r) => r.key);

// Every sorted video still to review, oldest saved first. That is the desktop's
// "Added: oldest" sort. Kept videos never come back.
export function buildDeck(board, { row = null } = {}) {
  const keys = row ? [row] : ROW_KEYS;
  return keys
    .flatMap((k) => board?.[k] ?? [])
    .filter((v) => !v.kept_at)
    .sort(SORTS["added-old"].fn);
}

// The phone shows an action before the server confirms it. An overlay entry
// says what the user did:
//   { hide: true }                 removed (not interested or watched)
//   { kept: true }                 swiped right
//   { category, kept }             moved (kept too when moved from Clean up)
export function applyOverlay(board, overlay) {
  const out = Object.fromEntries(ROW_KEYS.map((k) => [k, []]));
  for (const k of ROW_KEYS) {
    for (const v of board?.[k] ?? []) {
      const o = overlay[v.id];
      if (!o) { out[k].push(v); continue; }
      if (o.hide) continue;
      const category = o.category && out[o.category] ? o.category : k;
      out[category].push({ ...v, category, kept_at: o.kept ? (v.kept_at ?? "pending") : v.kept_at });
    }
  }
  return out;
}

// An entry stays until a fresh board reflects it, so a reload that started
// before the action landed can't bring the card back.
export function pruneOverlay(board, overlay) {
  const found = new Map();
  for (const k of ROW_KEYS) for (const v of board?.[k] ?? []) found.set(v.id, { ...v, category: k });
  const next = {};
  for (const [id, o] of Object.entries(overlay)) {
    const v = found.get(id);
    if (!v) continue; // gone from the board: confirmed
    const confirmed = !o.hide
      && (!o.kept || Boolean(v.kept_at))
      && (!o.category || v.category === o.category);
    if (!confirmed) next[id] = o;
  }
  return next;
}

export function findVideo(board, id) {
  for (const k of ROW_KEYS) {
    const hit = (board?.[k] ?? []).find((v) => v.id === id);
    if (hit) return hit;
  }
  return null;
}

export function totalSeconds(videos) {
  return videos.reduce((sum, v) => sum + (Number(v.duration_seconds) || 0), 0);
}

// "17 h 14 m", "41 m", "0 m". Whole minutes.
export function formatTotal(seconds) {
  const mins = Math.floor((Number(seconds) || 0) / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} h ${m} m` : `${m} m`;
}

// A drag commits past 35% of the card, or on a flick faster than 0.5 px/ms.
// Under 24 px it is a tap that jittered, never a decision.
export function swipeOutcome(dx, velocity, width) {
  if (Math.abs(dx) < 24) return null;
  if (dx <= -width * 0.35 || velocity <= -0.5) return "remove";
  if (dx >= width * 0.35 || velocity >= 0.5) return "keep";
  return null;
}

export function sessionStats(log, undone) {
  const live = log.filter((e) => !undone.has(e.key));
  const removed = live.filter((e) => e.kind === "dismiss" || e.kind === "done");
  return {
    reviewed: live.length,
    removed: removed.length,
    kept: live.filter((e) => e.kind === "keep").length,
    moved: live.filter((e) => e.kind === "move").length,
    removedSeconds: totalSeconds(removed.map((e) => e.video)),
  };
}
