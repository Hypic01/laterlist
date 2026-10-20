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
  if (Array.isArray(data.goals)) {
    const seen = new Set();
    const goals = data.goals.slice(0, 4).map((g, gi) => {
      const name = str(g?.name, 60);
      const need = str(g?.need, 200);
      if (!name) throw new PicksDataError(`goal ${gi + 1} name is required`);
      if (!need) throw new PicksDataError(`goal ${gi + 1} need is required`);
      const picks = (Array.isArray(g.picks) ? g.picks : []).slice(0, 3).map((p, pi) => {
        const at = `goal ${gi + 1} pick ${pi + 1}`;
        if (!ID_RE.test(p?.id)) throw new PicksDataError(`${at} has a bad id`);
        if (seen.has(p.id)) throw new PicksDataError(`${at} is a duplicate pick`);
        seen.add(p.id);
        if (p.source !== "youtube" && p.source !== "saved") throw new PicksDataError(`${at} source is required`);
        const title = str(p.title, 200);
        const channel = str(p.channel, 100);
        const durationSeconds = int(p.durationSeconds);
        const author = str(p.author, 120);
        const action = str(p.action, 160);
        if (p.source === "youtube") {
          if (!title) throw new PicksDataError(`${at} title is required`);
          if (!channel) throw new PicksDataError(`${at} channel is required`);
          if (durationSeconds === null) throw new PicksDataError(`${at} durationSeconds is required`);
        }
        if (!author) throw new PicksDataError(`${at} author is required`);
        if (!action) throw new PicksDataError(`${at} action is required`);
        const start = int(p.start);
        let end = start === null ? null : int(p.end);
        if (end !== null && end <= start) end = null;
        return {
          id: p.id, source: p.source, title: title || p.id, channel, durationSeconds,
          author, why: str(p.why, 400), action,
          gets: (Array.isArray(p.gets) ? p.gets : []).map((x) => str(x, 200)).filter(Boolean).slice(0, 3),
          start, end, noTranscript: p.noTranscript === true,
          covers: (Array.isArray(p.covers) ? p.covers : []).filter((id) => ID_RE.test(id)).slice(0, 20),
        };
      });
      return { name, need, empty: picks.length ? str(g.empty, 120) : str(g.empty, 120) || "Nothing good enough this week.", picks };
    });
    for (const goal of goals) {
      for (const pick of goal.picks) {
        pick.covers = [...new Set(pick.covers.filter((id) => !seen.has(id)))];
      }
    }
    const closeButNo = (Array.isArray(data.closeButNo) ? data.closeButNo : [])
      .filter((c) => ID_RE.test(c?.id)).slice(0, 12)
      .map((c) => ({ id: c.id, goal: str(c.goal, 60), title: str(c.title, 200) || c.id, reason: str(c.reason, 200) }));
    return { week, error: "", notice: str(data.notice, 300), goals, closeButNo };
  }
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

export const isGoalSet = (set) => Array.isArray(set.goals);

export function allPicks(set) {
  return isGoalSet(set) ? set.goals.flatMap((g) => g.picks) : set.picks.map((p) => ({ ...p, source: "saved" }));
}

export function pickIds(set) {
  return [...allPicks(set).map((p) => p.id), ...set.closeButNo.map((c) => c.id)];
}

export const savedPickIds = (set) => allPicks(set).filter((p) => p.source === "saved").map((p) => p.id);

export const coverIds = (set) => [...new Set(allPicks(set).flatMap((p) => p.covers || []))];
