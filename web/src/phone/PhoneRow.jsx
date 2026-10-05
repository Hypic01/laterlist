import React, { useMemo, useState } from "react";
import { DURATIONS, ROWS } from "../rows.js";
import { SORTS, formatDuration } from "../lib.js";
import { formatTotal, totalSeconds } from "./deck.js";
import SwipeRow from "./SwipeRow.jsx";
import {
  ArrowLeftIcon, CardsIcon, ChevronRightIcon, MoreIcon, SearchIcon, SlidersIcon,
} from "../components/icons.jsx";

// One row as a plain list (rowKey), or every row with search open (rowKey null).
export default function PhoneRow({ rowKey, board, startSearch = false, onBack, onOpenVideo, onMove, onRemove, onCleanRow }) {
  const row = ROWS.find((r) => r.key === rowKey) || null;
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(startSearch);
  const [duration, setDuration] = useState(null);
  const [sort, setSort] = useState("added-new");
  const source = row ? board[row.key] ?? [] : ROWS.flatMap((r) => board[r.key] ?? []);

  const videos = useMemo(() => {
    let out = source;
    if (duration) {
      const bucket = DURATIONS.find((d) => d.key === duration);
      out = out.filter((v) => bucket.test(v.duration_seconds));
    }
    const q = query.trim().toLowerCase();
    if (q) out = out.filter((v) => `${v.title} ${v.channel}`.toLowerCase().includes(q));
    return [...out].sort(SORTS[sort].fn);
  }, [source, duration, query, sort]);

  return (
    <section className="ph-row">
      <header className="ph-bar">
        <button className="ph-back" onClick={onBack}><ArrowLeftIcon size={18} /> Board</button>
        <div className="ph-bar__actions">
          <label className="ph-iconbtn ph-sort">
            <SlidersIcon size={18} />
            <span className="ph-sr">Sort videos</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {Object.entries(SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
            </select>
          </label>
          <button className="ph-iconbtn" onClick={() => setSearching((s) => !s)} aria-label="Search" aria-pressed={searching}>
            <SearchIcon size={18} />
          </button>
        </div>
      </header>

      <div className="ph-row__title" style={{ "--tint": row?.tint }}>
        {row ? <span className="ph-dot" aria-hidden="true" /> : null}
        <h1>{row ? row.label : "All videos"}</h1>
      </div>
      <p className="ph-row__sub">{source.length} {source.length === 1 ? "video" : "videos"} · {formatTotal(totalSeconds(source))}</p>

      {searching ? (
        <div className="ph-search">
          <SearchIcon size={16} />
          <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Title or channel" aria-label="Search videos" />
        </div>
      ) : null}

      <div className="ph-chips" role="group" aria-label="Filter by length">
        {DURATIONS.map((d) => (
          <button key={d.key} className={`ph-chip${duration === d.key ? " is-on" : ""}`} aria-pressed={duration === d.key}
            onClick={() => setDuration(duration === d.key ? null : d.key)}>
            {d.label}
          </button>
        ))}
      </div>

      {row && source.length ? (
        <button className="ph-cleanrow" onClick={() => onCleanRow(row.key)}>
          <CardsIcon size={18} /> Clean up this row <span>{source.length}<ChevronRightIcon size={14} /></span>
        </button>
      ) : null}

      {videos.length ? (
        <ul className="ph-list">
          {videos.map((v) => (
            <li key={v.id}>
              <SwipeRow onMove={() => onMove(v)} onRemove={() => onRemove(v)}>
                <button className="ph-video" onClick={() => onOpenVideo(v)}>
                  <span className="ph-video__thumb">
                    <img src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" loading="lazy" />
                    {v.duration_seconds != null ? <span className="ph-dur">{formatDuration(v.duration_seconds)}</span> : null}
                  </span>
                  <span className="ph-video__text">
                    <span className="ph-video__title">{v.title}</span>
                    <span className="ph-video__channel">{v.channel}</span>
                  </span>
                  <MoreIcon size={16} className="ph-video__more" />
                </button>
              </SwipeRow>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ph-empty">{query || duration ? "No videos match." : row?.empty ?? "No videos yet."}</p>
      )}
    </section>
  );
}
