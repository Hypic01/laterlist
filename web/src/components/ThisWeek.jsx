import React, { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api.js";

// This week: the Monday Mac run's 3 picks. Laterlist opens here (2026-10-12).

const ROW = {
  learn: { label: "Get the gist", tint: "var(--cat-learn)" },
  watch: { label: "Watch it", tint: "var(--cat-watch)" },
};
const VERDICTS = [["worth", "Worth it"], ["not", "Not for me"], ["skipped", "Didn't watch"]];
const pad = (n) => String(n).padStart(2, "0");
const WEEK = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function mondayOf(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function weekLabel(week) {
  const [y, m, d] = week.split("-").map(Number);
  return WEEK.format(new Date(y, m - 1, d));
}

function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export function bestPart(p) {
  if (p.start === null || p.start === undefined) return "Watch it all";
  if (p.end === null || p.end === undefined) return `Start at ${clock(p.start)}`;
  return `Watch ${clock(p.start)} to ${clock(p.end)}`;
}

const watchUrl = (id, start) => `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ""}`;

export function applyVerdict(set, videoId, verdict) {
  if (Array.isArray(set.goals)) {
    return { ...set, goals: set.goals.map((g) => ({
      ...g, picks: g.picks.map((p) => (p.id === videoId ? { ...p, verdict } : p)),
    })) };
  }
  return { ...set, picks: set.picks.map((p) => (p.id === videoId ? { ...p, verdict } : p)) };
}

export const removableCovers = (pick, leftOut) => pick.covers
  .filter((cover) => !cover.gone && !leftOut.has(cover.id)).map((cover) => cover.id);

export function applyRemoved(set, ids) {
  const removed = new Set(ids);
  return { ...set, goals: set.goals.map((g) => ({
    ...g, picks: g.picks.map((p) => ({
      ...p, covers: p.covers.map((c) => (removed.has(c.id) ? { ...c, gone: true } : c)),
    })),
  })) };
}

function applyRestored(set, ids) {
  const restored = new Set(ids);
  return { ...set, goals: set.goals.map((g) => ({
    ...g, picks: g.picks.map((p) => ({
      ...p, covers: p.covers.map((c) => (restored.has(c.id) ? { ...c, gone: false } : c)),
    })),
  })) };
}

function PickCard({ pick, index, busy, onVerdict }) {
  const row = ROW[pick.row] || ROW.learn;
  const href = watchUrl(pick.id, pick.start);
  const length = pick.durationSeconds ? `${Math.max(1, Math.round(pick.durationSeconds / 60))} min` : "";
  const meta = [pick.channel, length].filter(Boolean).join(" · ");
  return (
    <article className="pick">
      <a className="pick__thumb" href={href} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
        <img src={`https://i.ytimg.com/vi/${pick.id}/hqdefault.jpg`} alt="" loading="lazy" />
      </a>
      <div className="pick__body">
        <p className="pick__row"><span className="pick__dot" style={{ background: row.tint }} />{index + 1} · {row.label}</p>
        <h3 className="pick__title"><a href={href} target="_blank" rel="noopener noreferrer">{pick.title}</a></h3>
        {meta || pick.noTranscript ? (
          <p className="pick__meta">{meta}{pick.noTranscript ? <span className="pick__faint">{meta ? " · " : ""}no transcript</span> : null}</p>
        ) : null}
        <p className="pick__why"><span className="pick__label">Why you, now</span>{pick.why}</p>
        <a className="pick__chip" href={href} target="_blank" rel="noopener noreferrer">{bestPart(pick)}</a>
        {pick.gets?.length ? <ul className="pick__gets">{pick.gets.map((g) => <li key={g}>{g}</li>)}</ul> : null}
        <div className="pick__verdicts" role="group" aria-label="Your verdict">
          {VERDICTS.map(([key, label]) => (
            <button key={key} type="button" disabled={busy} aria-pressed={pick.verdict === key}
              className={`btn ${pick.verdict === key ? "btn--primary" : "btn--ghost"} pick__verdict`}
              onClick={() => onVerdict(pick.id, key)}>{label}</button>
          ))}
        </div>
      </div>
    </article>
  );
}

function CoversBlock({ pick, onOpenVideo, onRemove, onUndo, undo, busy }) {
  const [leftOut, setLeftOut] = useState(new Set());
  const [open, setOpen] = useState(() => {
    const phone = typeof window !== "undefined" && window.matchMedia?.("(max-width: 640px)").matches;
    const active = pick.covers.filter((c) => !c.gone).length;
    return !phone && active >= 1 && active <= 5;
  });
  const ids = removableCovers(pick, leftOut);
  return (
    <details className="covers" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Covers {pick.covers.length} saved {pick.covers.length === 1 ? "video" : "videos"}</summary>
      <div className="covers__content">
        <ul className="covers__list">
          {pick.covers.map((c) => (
            <li key={c.id} className={`covers__row${c.gone ? " covers__row--gone" : ""}`}>
              <button type="button" className="covers__title" onClick={() => onOpenVideo(c.id)}>{c.title}</button>
              {!c.gone ? <button type="button" className="covers__leave" aria-pressed={leftOut.has(c.id)}
                onClick={() => setLeftOut((before) => {
                  const next = new Set(before);
                  if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                  return next;
                })}>Leave it</button> : null}
            </li>
          ))}
        </ul>
        {ids.length ? <button type="button" className="btn btn--primary covers__remove" disabled={busy}
          onClick={() => onRemove(pick.id, ids)}>Remove all {ids.length}</button> : null}
        {undo ? <div className="covers__undo" role="status">
          <span>Removed {undo.ids.length}. They leave your YouTube Watch Later next time Laterlist is open on your computer.</span>
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => onUndo(pick.id)}>Undo</button>
        </div> : null}
      </div>
    </details>
  );
}

function GoalPickCard({ pick, busy, onVerdict, onOpenVideo, onRemove, onUndo, undo }) {
  const href = watchUrl(pick.id, pick.start);
  const length = pick.durationSeconds ? `${Math.max(1, Math.round(pick.durationSeconds / 60))} min` : "";
  const meta = [pick.channel, length].filter(Boolean).join(" · ");
  const tint = ROW[pick.video?.category]?.tint || ROW.learn.tint;
  return (
    <article className="pick goalPick">
      <a className="pick__thumb" href={href} target="_blank" rel="noopener noreferrer" tabIndex={-1} aria-hidden="true">
        <img src={`https://i.ytimg.com/vi/${pick.id}/hqdefault.jpg`} alt="" loading="lazy" />
      </a>
      <div className="pick__body">
        <p className="pick__row">
          {pick.source === "saved" ? <span className="pick__dot" style={{ background: tint }} /> : null}
          <span className="goalPick__source">{pick.source === "saved" ? "In your Watch Later" : "From YouTube"}</span>
        </p>
        <h3 className="pick__title"><a href={href} target="_blank" rel="noopener noreferrer">{pick.title}</a></h3>
        {meta ? <p className="pick__meta">{meta}</p> : null}
        <p className="goalPick__author">{pick.author}</p>
        <p className="pick__why"><span className="pick__label">Why you, now</span>{pick.why}</p>
        <p className="goalPick__action">{pick.action}</p>
        <a className="pick__chip" href={href} target="_blank" rel="noopener noreferrer">{bestPart(pick)}</a>
        {pick.gets?.length ? <ul className="pick__gets">{pick.gets.map((g) => <li key={g}>{g}</li>)}</ul> : null}
        {pick.noTranscript ? <p className="pick__faint">Picked without reading the transcript</p> : null}
        <div className="pick__verdicts" role="group" aria-label="Your verdict">
          {VERDICTS.map(([key, label]) => (
            <button key={key} type="button" disabled={busy} aria-pressed={pick.verdict === key}
              className={`btn ${pick.verdict === key ? "btn--primary" : "btn--ghost"} pick__verdict`}
              onClick={() => onVerdict(pick.id, key)}>{label}</button>
          ))}
        </div>
      </div>
      {pick.covers?.length ? <CoversBlock pick={pick} onOpenVideo={onOpenVideo} onRemove={onRemove}
        onUndo={onUndo} undo={undo} busy={busy} /> : null}
    </article>
  );
}

function GoalSection({ goal, busyId, onVerdict, onOpenVideo, onRemove, onUndo, undoByPick }) {
  const count = goal.picks.length;
  return (
    <section className="goal">
      <header className="goal__header">
        <div><h3 className="goal__name">{goal.name}</h3><p className="goal__need">{goal.need}</p></div>
        <span className="goal__count">{count} {count === 1 ? "pick" : "picks"}</span>
      </header>
      {count ? <div className="week__picks">{goal.picks.map((pick) => (
        <GoalPickCard key={pick.id} pick={pick} busy={busyId === pick.id} onVerdict={onVerdict}
          onOpenVideo={onOpenVideo} onRemove={onRemove} onUndo={onUndo} undo={undoByPick?.[pick.id]} />
      ))}</div> : <p className="goal__empty">{goal.empty || "Nothing good enough this week."}</p>}
    </section>
  );
}

export function ThisWeekView({ state, thisMonday, busyId = null, onVerdict, onRetry, onOpenLibrary, onOpenVideo, onRemove, onUndo, undoByPick = {} }) {
  if (state.status === "loading") {
    return (
      <section className="week" aria-busy="true">
        <div className="week__picks">{[0, 1, 2].map((i) => <div key={i} className="pick pick--skeleton" />)}</div>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="week">
        <p className="week__notice">Couldn't load this week's picks: {state.message}</p>
        <button type="button" className="btn btn--ghost" onClick={onRetry}>Retry</button>
      </section>
    );
  }
  const set = state.set;
  if (!set) {
    return (
      <section className="week week--empty">
        <p className="week__eyebrow">This week</p>
        <h2 className="week__focus">Your first picks arrive Monday at 8 AM.</h2>
        <p className="week__notice">Every Monday, Claude on your Mac reads your notes and your Watch Later, then sends the 3 videos most worth your time here.</p>
        <button type="button" className="btn btn--ghost" onClick={onOpenLibrary}>Open your library</button>
      </section>
    );
  }
  if (Array.isArray(set.goals)) {
    return (
      <div className="week">
        <p className="week__eyebrow">Week of {weekLabel(set.week)}</p>
        <h2 className="week__focus">This week</h2>
        {set.week < thisMonday ? <p className="week__notice">These are last week's picks. Is your Mac awake Monday at 8?</p> : null}
        {set.notice ? <p className="week__notice">{set.notice}</p> : null}
        {set.goals.map((goal, index) => <GoalSection key={`${goal.name}-${index}`} goal={goal} busyId={busyId}
          onVerdict={onVerdict} onOpenVideo={onOpenVideo} onRemove={onRemove} onUndo={onUndo} undoByPick={undoByPick} />)}
        {set.closeButNo?.length ? <details className="week__close">
          <summary>Close, but no ({set.closeButNo.length})</summary>
          <ul>{set.closeButNo.map((c) => <li key={c.id}>
            {c.goal ? <span className="goalPick__source">{c.goal}</span> : null}
            {c.inLibrary ? <button type="button" className="week__close-title" onClick={() => onOpenVideo(c.id)}>{c.title}</button>
              : <span className="week__close-title">{c.title}</span>}
            <span className="week__reason">{c.reason}</span>
          </li>)}</ul>
        </details> : null}
      </div>
    );
  }
  return (
    <section className="week">
      <p className="week__eyebrow">Week of {weekLabel(set.week)} · your focus</p>
      <h2 className="week__focus">{set.focus}</h2>
      {set.focusPoints?.length ? <ul className="week__points">{set.focusPoints.map((f) => <li key={f}>{f}</li>)}</ul> : null}
      {set.week < thisMonday ? <p className="week__notice">These are last week's picks. Is your Mac awake Monday at 8?</p> : null}
      {set.notice ? <p className="week__notice">{set.notice}</p> : null}
      <div className="week__picks">
        {set.picks.map((p, i) => <PickCard key={p.id} pick={p} index={i} busy={busyId === p.id} onVerdict={onVerdict} />)}
      </div>
      {set.closeButNo?.length ? (
        <details className="week__close">
          <summary>Close, but no ({set.closeButNo.length})</summary>
          <ul>
            {set.closeButNo.map((c) => (
              <li key={c.id}>
                {c.inLibrary
                  ? <button type="button" className="week__close-title" onClick={() => onOpenVideo(c.id)}>{c.title}</button>
                  : <span className="week__close-title">{c.title}</span>}
                <span className="week__reason">{c.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export default function ThisWeek({ onOpenLibrary, onOpenVideo, onLibraryChanged = () => {}, onToast = () => {} }) {
  const [state, setState] = useState({ status: "loading" });
  const [busyId, setBusyId] = useState(null);
  const [undoByPick, setUndoByPick] = useState({});
  const undoTimers = useRef({});

  useEffect(() => () => Object.values(undoTimers.current).forEach(clearTimeout), []);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const { set } = await api.getCurrentPicks();
      setState({ status: "ready", set });
    } catch (e) {
      setState({ status: "error", message: e.message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onVerdict = async (videoId, verdict) => {
    if (state.status !== "ready" || !state.set) return;
    const before = state.set;
    setState({ status: "ready", set: applyVerdict(before, videoId, verdict) });
    setBusyId(videoId);
    try {
      await api.setPickVerdict(before.week, videoId, verdict);
      if (verdict !== "skipped") onLibraryChanged();
    } catch (e) {
      setState({ status: "ready", set: before });
      onToast(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const onRemove = async (pickId, ids) => {
    setBusyId(pickId);
    try {
      const { removed } = await api.dismissVideos(ids);
      if (removed.length) {
        setState((before) => ({ ...before, set: applyRemoved(before.set, removed) }));
        setUndoByPick((before) => ({ ...before, [pickId]: { ids: removed } }));
        clearTimeout(undoTimers.current[pickId]);
        undoTimers.current[pickId] = setTimeout(() => {
          setUndoByPick((before) => { const next = { ...before }; delete next[pickId]; return next; });
        }, 10000);
        onLibraryChanged();
      }
      if (removed.length !== ids.length) onToast(`Removed ${removed.length} of ${ids.length}. Try the remaining videos again.`);
    } catch (e) {
      onToast(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const onUndo = async (pickId) => {
    const ids = undoByPick[pickId]?.ids;
    if (!ids) return;
    setBusyId(pickId);
    try {
      const { restored, alreadyOffYoutube } = await api.restoreVideos(ids);
      setState((before) => ({ ...before, set: applyRestored(before.set, restored) }));
      clearTimeout(undoTimers.current[pickId]);
      setUndoByPick((before) => { const next = { ...before }; delete next[pickId]; return next; });
      onToast(`Back in Laterlist.${alreadyOffYoutube.length ? ` ${alreadyOffYoutube.length} were already off YouTube.` : ""}`);
      onLibraryChanged();
    } catch (e) {
      onToast(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ThisWeekView state={state} thisMonday={mondayOf()} busyId={busyId} onVerdict={onVerdict}
      onRetry={load} onOpenLibrary={onOpenLibrary} onOpenVideo={onOpenVideo}
      onRemove={onRemove} onUndo={onUndo} undoByPick={undoByPick} />
  );
}
