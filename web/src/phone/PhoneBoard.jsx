import React from "react";
import { ROWS } from "../rows.js";
import { SORTS } from "../lib.js";
import { formatTotal, totalSeconds } from "./deck.js";
import { SYNC_NOTE } from "./copy.js";
import { BrandMark, CardsIcon, ChevronRightIcon, SearchIcon } from "../components/icons.jsx";

const ACTIVE_STATES = new Set(["queued", "running", "awaiting_batch"]);

export default function PhoneBoard({ board, deckCount, job, onOpenRow, onStartCleanup, onSearch }) {
  const all = ROWS.flatMap((r) => board[r.key] ?? []);
  const fan = [...all].sort(SORTS["added-new"].fn).slice(0, 3);
  const sorting = Boolean(job && ACTIVE_STATES.has(job.state));

  return (
    <section className="ph-board">
      <header className="ph-bar">
        <div className="ph-brand"><BrandMark size={20} /><span>Laterlist</span></div>
        <button className="ph-iconbtn" onClick={onSearch} aria-label="Search all videos"><SearchIcon size={20} /></button>
      </header>

      <div className="ph-hero">
        {fan.length ? (
          <div className="ph-hero__fan" aria-hidden="true">
            {fan.map((v) => <img key={v.id} src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`} alt="" />)}
          </div>
        ) : null}
        <p className="ph-hero__label">Waiting in Watch Later</p>
        <p className="ph-hero__count"><b>{all.length.toLocaleString()}</b><span>{all.length === 1 ? "video" : "videos"}</span></p>
        <p className="ph-hero__time">{formatTotal(totalSeconds(all))} of watching</p>
        {sorting ? (
          <p className="ph-hero__job" role="status">
            Sorting {Number(job.processed || 0).toLocaleString()} of {Number(job.total || 0).toLocaleString()}…
          </p>
        ) : null}
        {deckCount > 0 ? (
          <button className="ph-btn ph-btn--primary" onClick={onStartCleanup}><CardsIcon size={20} /> Start clean up</button>
        ) : (
          <p className="ph-hero__clear">{all.length ? "Everything here has been reviewed." : SYNC_NOTE}</p>
        )}
      </div>

      <h2 className="ph-label">Your rows</h2>
      <ul className="ph-group">
        {ROWS.map((r) => {
          const list = board[r.key] ?? [];
          const Icon = r.icon;
          const body = (
            <>
              <span className="ph-tile" style={{ "--tint": r.tint }}><Icon size={20} /></span>
              <span className="ph-group__name">{r.label}<small>{list.length ? formatTotal(totalSeconds(list)) : r.empty}</small></span>
              <span className="ph-group__count">{list.length}</span>
            </>
          );
          return (
            <li key={r.key}>
              {list.length ? (
                <button className="ph-group__row" onClick={() => onOpenRow(r.key)}>
                  {body}<ChevronRightIcon size={16} className="ph-group__chev" />
                </button>
              ) : (
                <div className="ph-group__row is-empty">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
