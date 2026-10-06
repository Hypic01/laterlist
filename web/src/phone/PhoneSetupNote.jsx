import React from "react";
import { SYNC_NOTE } from "./copy.js";
import { BrandMark } from "../components/icons.jsx";

// A new user on a phone can't import (no extension), so point them at a computer.
export default function PhoneSetupNote({ host }) {
  return (
    <section className="ph-setup">
      <span className="ph-setup__mark"><BrandMark size={28} /></span>
      <h1>Start on your computer</h1>
      <p>Laterlist reads your Watch Later through a Chrome extension, so the first import happens on a computer. Open {host}/app in Chrome there, then come back here.</p>
      <p className="ph-note">{SYNC_NOTE}</p>
    </section>
  );
}
