import React, { useRef, useState } from "react";
import { formatDuration } from "../lib.js";
import {
  CheckIcon,
  ExternalIcon,
  MoreIcon,
  PlayIcon,
  SparklesIcon,
  XIcon,
} from "./icons.jsx";
import FloatingMenu from "./FloatingMenu.jsx";

// Display names match the board's row titles; keys stay the API's category ids.
export const CATEGORIES = [
  { key: "learn", label: "Worth learning from" },
  { key: "watch", label: "Worth watching" },
  { key: "music", label: "Music" },
  { key: "entertainment", label: "Just for fun" },
  { key: "outdated", label: "Outdated" },
];

export default function VideoCard({ video, onMove, onDismiss, onDone, onOpenDetail, onTldr }) {
  // hq720 (1280x720) exists for most videos; hqdefault (480x360) always exists
  const [fallback, setFallback] = useState(false);
  // Deleted/private videos still answer hqdefault, with YouTube's 120x90 grey placeholder.
  const [dead, setDead] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // A private or deleted video has no content to summarize, so TL;DR stays off its card.
  const unavailable = /^\[(private|deleted) video\]$/i.test(video.title);
  const kebabRef = useRef(null);
  const thumb = `https://i.ytimg.com/vi/${video.id}/${fallback ? "hqdefault" : "hq720"}.jpg`;
  const ytUrl = `https://www.youtube.com/watch?v=${video.id}`;
  return (
    <article className="card">
      <button className="card__thumbwrap" onClick={() => onOpenDetail?.(video, "play")}
        aria-label={`Play "${video.title}" here`}>
        {dead ? (
          <div className="card__thumbdead"><PlayIcon size={16} /> No thumbnail</div>
        ) : (
          <img className="card__thumb" src={thumb} alt="" loading="lazy"
            onLoad={(e) => {
              // A missing size also loads as the 120px placeholder: try hqdefault before giving up.
              if (e.currentTarget.naturalWidth > 120) return;
              if (!fallback) setFallback(true); else setDead(true);
            }}
            onError={() => { if (!fallback) setFallback(true); else setDead(true); }} />
        )}
        <div className="card__open"><span><PlayIcon size={13} /> Play here</span></div>
        {video.duration_seconds != null && (
          <span className="card__duration">{formatDuration(video.duration_seconds)}</span>
        )}
      </button>
      <div className="card__body">
        <h3 className="card__title" title={video.title}>
          <button onClick={() => onOpenDetail?.(video)}>{video.title}</button>
        </h3>
        <div className="card__channel">{video.channel}</div>
        {video.reasoning && (
          <div className="card__reasoning" title={video.reasoning}>
            <SparklesIcon size={13} />
            <span>{video.reasoning}</span>
          </div>
        )}
        {/* The features live on the card face so they can be discovered;
            housekeeping actions live behind the kebab. */}
        <div className="card__actions">
          {!unavailable && (
            <button onClick={() => onTldr?.(video)} aria-label={`TL;DR for "${video.title}"`}>
              <SparklesIcon size={13} /> TL;DR
            </button>
          )}
          <div className="card__menuwrap">
            <button ref={kebabRef} className="card__kebab" aria-haspopup="menu" aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)} aria-label="More actions" data-tip="More actions" data-tip-pos="above">
              <MoreIcon size={14} />
            </button>
            {menuOpen && (
              <FloatingMenu anchorRef={kebabRef} onClose={() => setMenuOpen(false)} label="More actions">
                <a href={ytUrl} target="_blank" rel="noreferrer" role="menuitem"
                  onClick={() => setMenuOpen(false)}>
                  <ExternalIcon size={12} /> Open on YouTube
                </a>
                {CATEGORIES.filter((c) => c.key !== video.category).map((c) => (
                  <button key={c.key} role="menuitem"
                    onClick={() => { setMenuOpen(false); onMove(video.id, c.key); }}>
                    <span className="card__menu-dot" style={{ background: `var(--cat-${c.key})` }} />
                    Move to {c.label}
                  </button>
                ))}
                <button role="menuitem"
                  onClick={() => { setMenuOpen(false); onDone(video.id); }}>
                  <CheckIcon size={12} /> Watched it, remove
                </button>
                <button role="menuitem" className="menu-danger"
                  onClick={() => { setMenuOpen(false); onDismiss(video.id); }}>
                  <XIcon size={12} /> Not interested, remove
                </button>
                <div className="popmenu__hint">
                  <SparklesIcon size={11} /> Moves teach the AI your taste
                </div>
              </FloatingMenu>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
