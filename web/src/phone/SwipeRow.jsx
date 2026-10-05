import React, { useRef, useState } from "react";
import { MoveIcon, XIcon } from "../components/icons.jsx";

const ACTION_WIDTH = 76;
const OPEN_X = -ACTION_WIDTH * 2;

// One list row that slides left to show Move and Remove. Vertical scrolling
// stays native (touch-action: pan-y). We only take over once the finger moves
// more sideways than down. A long swipe past 60% removes straight away.
export default function SwipeRow({ children, onMove, onRemove }) {
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(null);
  const swallowClick = useRef(false);
  const open = x !== 0;

  const onPointerDown = (e) => {
    start.current = { x: e.clientX, y: e.clientY, base: x, axis: null };
  };
  const onPointerMove = (e) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (s.axis === null) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (s.axis === "x") {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDragging(true);
      }
    }
    if (s.axis === "x") setX(Math.min(0, s.base + dx));
  };
  const onPointerUp = (e) => {
    const s = start.current;
    start.current = null;
    if (!s || s.axis !== "x") return;
    swallowClick.current = true;
    setDragging(false);
    const finalX = Math.min(0, s.base + (e.clientX - s.x));
    const width = e.currentTarget.offsetWidth || 375;
    if (finalX < -width * 0.6) { setX(0); onRemove(); return; }
    setX(finalX < OPEN_X / 2 ? OPEN_X : 0);
  };
  const onPointerCancel = () => {
    start.current = null;
    setDragging(false);
    setX(0);
  };
  // A drag must not also count as a tap, and a tap on an open row closes it.
  const onClickCapture = (e) => {
    if (swallowClick.current || open) {
      e.preventDefault();
      e.stopPropagation();
      if (!swallowClick.current) setX(0);
    }
    swallowClick.current = false;
  };

  return (
    <div className="ph-swipe">
      <div className="ph-swipe__actions" aria-hidden={!open}>
        <button className="ph-swipe__move" tabIndex={open ? 0 : -1} onClick={() => { setX(0); onMove(); }}>
          <MoveIcon size={18} />Move
        </button>
        <button className="ph-swipe__remove" tabIndex={open ? 0 : -1} onClick={() => { setX(0); onRemove(); }}>
          <XIcon size={18} />Remove
        </button>
      </div>
      <div className={`ph-swipe__front${dragging ? " is-dragging" : ""}`} style={{ transform: `translateX(${x}px)` }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel} onClickCapture={onClickCapture}>
        {children}
      </div>
    </div>
  );
}
