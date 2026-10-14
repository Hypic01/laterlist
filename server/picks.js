export function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export class PicksDataError extends Error {}

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

export function validatePicks(data) {
  if (!data || typeof data !== "object") throw new PicksDataError("picks.json is not an object");
  if (!isRealDate(data.week)) throw new PicksDataError("week must be a real YYYY-MM-DD date");
  const week = data.week;
  const error = str(data.error, 300);
  if (error) return { week, error, focus: "", focusPoints: [], notice: "", picks: [], closeButNo: [] };
  const focus = str(data.focus, 200);
  if (!focus) throw new PicksDataError("focus is required");
  const picks = (Array.isArray(data.picks) ? data.picks : []).slice(0, 3).map((p, i) => {
    if (!ID_RE.test(p?.id)) throw new PicksDataError(`pick ${i + 1} has a bad id`);
    const start = int(p.start);
    let end = start === null ? null : int(p.end);
    if (end !== null && end <= start) end = null;
    return {
      id: p.id,
      title: str(p.title, 200) || p.id,
      channel: str(p.channel, 100),
      durationSeconds: int(p.durationSeconds),
      row: p.row === "watch" ? "watch" : "learn",
      why: str(p.why, 400),
      start,
      end,
      gets: (Array.isArray(p.gets) ? p.gets : []).map((g) => str(g, 200)).filter(Boolean).slice(0, 3),
      noTranscript: p.noTranscript === true,
    };
  });
  const closeButNo = (Array.isArray(data.closeButNo) ? data.closeButNo : [])
    .filter((c) => ID_RE.test(c?.id))
    .slice(0, 12)
    .map((c) => ({ id: c.id, title: str(c.title, 200) || c.id, reason: str(c.reason, 200) }));
  return {
    week,
    error: "",
    focus,
    focusPoints: (Array.isArray(data.focusPoints) ? data.focusPoints : []).map((f) => str(f, 200)).filter(Boolean).slice(0, 5),
    notice: str(data.notice, 300),
    picks,
    closeButNo,
  };
}

export const VERDICTS = ["worth", "not", "skipped"];

export function pickIds(set) {
  return [...set.picks.map((p) => p.id), ...set.closeButNo.map((c) => c.id)];
}
