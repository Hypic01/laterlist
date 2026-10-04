import React, { useEffect, useRef, useState } from "react";
import VideoCard from "./VideoCard.jsx";
import { SORTS } from "../lib.js";
import { ArrowLeftIcon, CheckIcon, SearchIcon } from "./icons.jsx";
import FloatingMenu from "./FloatingMenu.jsx";

const PAGE_SIZE = 60;

export default function CategoryView({ row, videos, chips, onMove, onDismiss, onDone, onBack,
  onOpenDetail, onTldr, query, onQuery, sort, onSort }) {
  const RowIcon = row.icon;
  const [limit, setLimit] = useState(PAGE_SIZE);
  const sentinelRef = useRef(null);
  const sortRef = useRef(null);
  const [sortOpen, setSortOpen] = useState(false);

  useEffect(() => { setLimit(PAGE_SIZE); }, [row.key, query]);

  // progressive loading: pull in the next page before the user reaches the bottom
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setLimit((l) => l + PAGE_SIZE);
    }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [videos.length, limit]);

  const shown = videos.slice(0, limit);

  return (
    <section className="catview" style={{ "--row-tint": row.tint }}>
      <header className="catview__header">
        <button className="btn btn--ghost" onClick={onBack}><ArrowLeftIcon size={15} /> Back</button>
        <span className="row__icon"><RowIcon size={16} /></span>
        <h2>{row.label}</h2>
        <span className="row__count">{videos.length.toLocaleString()}</span>
      </header>
      <div className="catview__search">
        <div className="searchbox searchbox--hero">
          <SearchIcon size={16} />
          <input type="search" placeholder={`Search in ${row.label.toLowerCase()}…`} value={query}
            onChange={(e) => onQuery(e.target.value)} aria-label={`Search in ${row.label}`} />
        </div>
      </div>
      {/* The toolbar hugs the grid: filters on the left, sort order on the right. */}
      <div className="catview__toolbar">
        <div className="catview__toolbar-filters">{chips}</div>
        <button ref={sortRef} type="button" className="select sortbox" aria-haspopup="menu"
          aria-expanded={sortOpen} aria-label={`Sort videos: ${SORTS[sort].label}`}
          onClick={() => setSortOpen((o) => !o)}>
          {SORTS[sort].label}
        </button>
        {sortOpen && (
          <FloatingMenu anchorRef={sortRef} onClose={() => setSortOpen(false)} label="Sort videos" matchWidth>
            {Object.entries(SORTS).map(([k, s]) => (
              <button key={k} role="menuitemradio" aria-checked={k === sort}
                onClick={() => { setSortOpen(false); onSort(k); sortRef.current?.focus(); }}>
                <span className="popmenu__check">{k === sort ? <CheckIcon size={12} /> : null}</span>
                {s.label}
              </button>
            ))}
          </FloatingMenu>
        )}
      </div>
      {videos.length === 0 ? (
        <div className="row__empty">
          {query.trim() ? `no matches for “${query.trim()}” in this row` : `— ${row.empty ?? "nothing here yet"} —`}
        </div>
      ) : (
        <>
          <div className="grid">
            {shown.map((v) => (
              <VideoCard key={v.id} video={v} onMove={onMove} onDismiss={onDismiss} onDone={onDone}
                onOpenDetail={onOpenDetail} onTldr={onTldr} />
            ))}
          </div>
          {videos.length > limit && (
            <div ref={sentinelRef} className="grid__sentinel" role="status">
              loading more · {(videos.length - limit).toLocaleString()} remaining
            </div>
          )}
        </>
      )}
    </section>
  );
}
