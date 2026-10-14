import React, { useCallback, useEffect, useState } from "react";
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
  return { ...set, picks: set.picks.map((p) => (p.id === videoId ? { ...p, verdict } : p)) };
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

export function ThisWeekView({ state, thisMonday, busyId = null, onVerdict, onRetry, onOpenLibrary, onOpenVideo }) {
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

  return (
    <ThisWeekView state={state} thisMonday={mondayOf()} busyId={busyId} onVerdict={onVerdict}
      onRetry={load} onOpenLibrary={onOpenLibrary} onOpenVideo={onOpenVideo} />
  );
}
