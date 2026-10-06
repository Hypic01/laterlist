import React from "react";
import { Drawer } from "vaul";
import { ROWS } from "../rows.js";
import { formatDuration } from "../lib.js";
import { REMOVAL_NOTE } from "./copy.js";
import {
  ArrowLeftIcon, CheckIcon, ChevronRightIcon, ExternalIcon, MoveIcon, PlayIcon, SummaryIcon, XIcon,
} from "../components/icons.jsx";

export function SheetBody({ video, panel, onPanel, removalQueued, onPlay, onTldr, onMove, onDone, onDismiss }) {
  const row = ROWS.find((r) => r.key === video.category);
  const meta = [video.channel, video.duration_seconds != null && formatDuration(video.duration_seconds)]
    .filter(Boolean).join(" · ");

  if (panel === "move") {
    return (
      <div className="ph-sheet__body">
        <button className="ph-sheet__back" onClick={() => onPanel("main")}><ArrowLeftIcon size={16} /> Move to</button>
        <ul className="ph-sgroup">
          {ROWS.map((r) => (
            <li key={r.key}>
              <button className="ph-sitem" style={{ "--tint": r.tint }} disabled={r.key === video.category}
                onClick={() => onMove(r.key)}>
                <span className="ph-dot" aria-hidden="true" /> {r.label}
                {r.key === video.category ? <span className="ph-sitem__r">Here now</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="ph-sheet__body">
      <div className="ph-sheet__head">
        <img src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`} alt="" />
        <div><b>{video.title}</b>{meta ? <span>{meta}</span> : null}</div>
      </div>
      <a className="ph-btn ph-btn--primary" href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer">
        <ExternalIcon size={18} /> Open in YouTube
      </a>
      <div className="ph-sheet__two">
        <button className="ph-btn ph-btn--ghost" onClick={onPlay}><PlayIcon size={16} /> Play here</button>
        <button className="ph-btn ph-btn--ghost" onClick={onTldr}><SummaryIcon size={16} /> TL;DR</button>
      </div>
      <ul className="ph-sgroup">
        <li>
          <button className="ph-sitem" onClick={() => onPanel("move")}>
            <MoveIcon size={18} /> Move to<span className="ph-sitem__r">{row?.label}<ChevronRightIcon size={14} /></span>
          </button>
        </li>
      </ul>
      <ul className="ph-sgroup">
        <li><button className="ph-sitem" onClick={onDone}><CheckIcon size={18} /> Watched it, remove</button></li>
        <li><button className="ph-sitem ph-sitem--danger" onClick={onDismiss}><XIcon size={18} /> Not interested, remove</button></li>
      </ul>
      {removalQueued ? <p className="ph-note">{REMOVAL_NOTE}</p> : null}
    </div>
  );
}

// shadcn's Drawer is vaul under the hood: drag down or tap outside to close.
export default function VideoSheet({ video, open, onClose, ...body }) {
  if (!video) return null;
  return (
    <Drawer.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Drawer.Portal>
        <Drawer.Overlay className="ph-sheet__scrim" />
        <Drawer.Content className="ph-sheet" aria-describedby={undefined}>
          <div className="ph-sheet__handle" aria-hidden="true" />
          <Drawer.Title className="ph-sr">{video.title}</Drawer.Title>
          <SheetBody video={video} {...body} />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
