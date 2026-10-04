import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 6;
const MARGIN = 8;
const ITEMS = '[role="menuitem"], [role="menuitemradio"]';

// Where the menu goes: below the trigger when it fits, above when it doesn't,
// otherwise the roomier side with a capped height. Always inside the viewport.
export function placeMenu({ anchor, menu, viewport, align = "end" }) {
  const below = viewport.height - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  const openUp = menu.height > below && (menu.height <= above || above > below);
  const maxHeight = openUp ? above : below;
  const height = Math.min(menu.height, maxHeight);
  const top = openUp ? anchor.top - GAP - height : anchor.bottom + GAP;
  const left = align === "end" ? anchor.right - menu.width : anchor.left;
  return {
    top,
    left: Math.min(Math.max(left, MARGIN), viewport.width - MARGIN - menu.width),
    maxHeight,
  };
}

// A menu rendered into <body> with fixed positioning, so no card, scroller, or
// hover transform can clip it. Closes on outside click, Escape, Tab, scroll, resize.
export default function FloatingMenu({ anchorRef, onClose, label, align = "end", matchWidth = false,
  className = "", children }) {
  const menuRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Measured before it is placed. opacity, not visibility: hidden items can't take focus.
  const [style, setStyle] = useState({ top: 0, left: 0, opacity: 0 });

  useLayoutEffect(() => {
    const anchor = anchorRef.current.getBoundingClientRect();
    const width = Math.max(menuRef.current.offsetWidth, matchWidth ? anchor.width : 0);
    const menu = { width, height: menuRef.current.scrollHeight };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    // Render at the width it was placed with, or a right-aligned menu drifts off its trigger.
    setStyle({ ...placeMenu({ anchor, menu, viewport, align }), minWidth: width });
  }, [anchorRef, align, matchWidth]);

  useEffect(() => {
    const items = [...menuRef.current.querySelectorAll(ITEMS)];
    (items.find((el) => el.getAttribute("aria-checked") === "true") || items[0])?.focus();
    const close = () => closeRef.current();
    const onScroll = (event) => { if (!menuRef.current?.contains(event.target)) close(); };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  const onKeyDown = (event) => {
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      closeRef.current();
      anchorRef.current?.focus();
      return;
    }
    const items = [...menuRef.current.querySelectorAll(ITEMS)];
    const index = items.indexOf(document.activeElement);
    const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 }[event.key];
    if (next === undefined || !items.length) return;
    event.preventDefault();
    items[(next + items.length) % items.length].focus();
  };

  return createPortal(
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div ref={menuRef} className={`popmenu ${className}`.trim()} role="menu" aria-label={label}
        style={style} onKeyDown={onKeyDown}>
        {children}
      </div>
    </>,
    document.body,
  );
}
