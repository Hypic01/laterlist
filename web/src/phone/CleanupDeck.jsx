import React, { useRef, useState } from "react";
import { ROWS } from "../rows.js";
import { formatDuration } from "../lib.js";
import { swipeOutcome } from "./deck.js";
import { REMOVAL_NOTE, SYNC_NOTE } from "./copy.js";
import { CheckIcon, PlayIcon, SummaryIcon, XIcon } from "../components/icons.jsx";

const LEAVE_MS = 220;
const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function DeckCard({ video, back = false, cardRef, style, stamp, stampOpacity, handlers, onTldr }) {
  const row = ROWS.find((r) => r.key === video.category);
  const meta = [video.channel, video.duration_seconds != null && formatDuration(video.duration_seconds)]
    .filter(Boolean).join(" · ");
  return (
    <article ref={cardRef} className={`ph-card${back ? " ph-card--back" : ""}`} style={style}
      aria-hidden={back ? "true" : undefined} {...handlers}>
      {stamp ? (
        <span className={`ph-stamp ph-stamp--${stamp}`} style={{ opacity: stampOpacity }}>
          {stamp === "remove" ? "REMOVE" : "KEEP"}
        </span>
      ) : null}
      <img src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`} alt="" draggable={false} />
      <div className="ph-card__body">
        {row ? <span className="ph-pill" style={{ "--tint": row.tint }}><span className="ph-dot" aria-hidden="true" />{row.label}</span> : null}
        <h2>{video.title}</h2>
        {meta ? <p className="ph-card__meta">{meta}</p> : null}
        {back ? (
          <span className="ph-card__tldr"><SummaryIcon size={14} /> TL;DR</span>
        ) : (
          <button className="ph-card__tldr" onClick={() => onTldr(video)}><SummaryIcon size={14} /> TL;DR</button>
        )}
      </div>
    </article>
  );
}

export function DoneScreen({ stats, removalQueued, onClose }) {
  if (!stats.reviewed) {
    return (
      <section className="ph-done">
        <div className="ph-done__ring"><CheckIcon size={36} /></div>
        <h1>Nothing left to sort</h1>
        <p>{SYNC_NOTE}</p>
        <button className="ph-btn ph-btn--primary ph-done__cta" onClick={onClose}>Back to board</button>
      </section>
    );
  }
  const hours = Math.floor(stats.removedSeconds / 3600);
  return (
    <section className="ph-done">
      <div className="ph-done__ring"><CheckIcon size={36} /></div>
      <h1>{stats.removed ? `You let go of ${stats.removed} ${stats.removed === 1 ? "video" : "videos"}` : "All reviewed"}</h1>
      {hours >= 1 ? <p>That's {hours} {hours === 1 ? "hour" : "hours"} you no longer owe anyone.</p> : null}
      <div className="ph-done__stats">
        <div><b>{stats.removed}</b><span>Removed</span></div>
        <div><b>{stats.kept}</b><span>Kept</span></div>
        <div><b>{stats.moved}</b><span>Moved</span></div>
      </div>
      {removalQueued && stats.removed ? <p className="ph-note">{REMOVAL_NOTE}</p> : null}
      <button className="ph-btn ph-btn--primary ph-done__cta" onClick={onClose}>Back to board</button>
    </section>
  );
}

export default function CleanupDeck({ deck, startCount, stats, removalQueued, onClose, onDecide, onOpenVideo, onMove, onTldr }) {
  const [drag, setDrag] = useState({ dx: 0, dy: 0, width: 340, active: false });
  const [leaving, setLeaving] = useState(null);
  const startRef = useRef(null);
  const draggedRef = useRef(false);
  const cardRef = useRef(null);
  const card = deck[0];
  const next = deck[1];

  if (!card) return <DoneScreen stats={stats} removalQueued={removalQueued} onClose={onClose} />;

  const decide = (outcome) => {
    if (leaving) return;
    if (reducedMotion()) { onDecide(outcome, card); return; }
    setLeaving(outcome);
    setTimeout(() => {
      setLeaving(null);
      setDrag((d) => ({ ...d, dx: 0, dy: 0, active: false }));
      onDecide(outcome, card);
    }, LEAVE_MS);
  };

  const handlers = {
    onPointerDown: (e) => {
      if (leaving) return;
      startRef.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastT: e.timeStamp, v: 0, captured: false };
    },
    onPointerMove: (e) => {
      const s = startRef.current;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (!s.captured) {
        if (Math.hypot(dx, dy) < 8) return;
        s.captured = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      const dt = Math.max(1, e.timeStamp - s.lastT);
      s.v = (e.clientX - s.lastX) / dt;
      s.lastX = e.clientX;
      s.lastT = e.timeStamp;
      setDrag({ dx, dy, width: cardRef.current?.offsetWidth || 340, active: true });
    },
    onPointerUp: (e) => {
      const s = startRef.current;
      startRef.current = null;
      if (!s?.captured) return;
      draggedRef.current = true;
      const width = cardRef.current?.offsetWidth || 340;
      const outcome = swipeOutcome(e.clientX - s.x, s.v, width);
      if (outcome) decide(outcome);
      else setDrag((d) => ({ ...d, dx: 0, dy: 0, active: false }));
    },
    onPointerCancel: () => {
      startRef.current = null;
      setDrag((d) => ({ ...d, dx: 0, dy: 0, active: false }));
    },
    // A drag that ends over the TL;DR button must not also press it.
    onClickCapture: (e) => {
      if (draggedRef.current) { e.preventDefault(); e.stopPropagation(); }
      draggedRef.current = false;
    },
  };

  const threshold = drag.width * 0.35;
  const stamp = leaving || (drag.dx < -24 ? "remove" : drag.dx > 24 ? "keep" : null);
  const stampOpacity = leaving ? 1 : Math.min(1, Math.abs(drag.dx) / threshold);
  const off = leaving === "remove" ? -1 : 1;
  const style = leaving
    ? { transform: `translateX(${off * 150}%) rotate(${off * 18}deg)`, transition: `transform ${LEAVE_MS}ms var(--ease)` }
    : {
      transform: `translate(${drag.dx}px, ${drag.dy * 0.2}px) rotate(${(drag.dx / drag.width) * 12}deg)`,
      transition: drag.active ? "none" : "transform var(--speed) var(--ease)",
    };

  const total = Math.max(startCount, stats.reviewed + deck.length);

  return (
    <section className="ph-deck">
      <header className="ph-deck__top">
        <button className="ph-iconbtn" onClick={onClose} aria-label="Close clean up"><XIcon size={20} /></button>
        <span className="ph-deck__count">{stats.reviewed + 1} of {total}</span>
        <span className="ph-iconbtn ph-iconbtn--ghost" aria-hidden="true" />
      </header>
      <div className="ph-progress" aria-hidden="true"><i style={{ width: `${(stats.reviewed / total) * 100}%` }} /></div>

      <div className="ph-deck__stack">
        {next ? <DeckCard key={next.id} video={next} back /> : null}
        <DeckCard key={card.id} video={card} cardRef={cardRef} style={style} stamp={stamp}
          stampOpacity={stampOpacity} handlers={handlers} onTldr={onTldr} />
      </div>

      <p className="ph-deck__hint">Swipe left to remove, right to keep</p>
      <div className="ph-deck__acts">
        <button className="ph-act ph-act--remove" onClick={() => decide("remove")}><span><XIcon size={26} /></span>Remove</button>
        <button className="ph-act ph-act--watch" onClick={() => onOpenVideo(card)}><span><PlayIcon size={20} /></span>Watch</button>
        <button className="ph-act ph-act--keep" onClick={() => decide("keep")}><span><CheckIcon size={26} /></span>Keep</button>
      </div>
      <button className="ph-deck__move" onClick={() => onMove(card)}>Wrong row? Move it</button>
    </section>
  );
}
