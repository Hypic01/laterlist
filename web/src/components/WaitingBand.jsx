import React, { useState } from "react";
import * as api from "../api.js";
import { ZapIcon } from "./icons.jsx";

// Under the board: a sort action whenever videos are waiting (a failed or
// interrupted sort leaves some unscanned). Split out of the old upgrade band.
export default function WaitingBand({ waitingCount, onToast, onJobStarted }) {
  const [busy, setBusy] = useState(false);

  const sortRemaining = async () => {
    setBusy(true);
    try {
      // Hand the started job up so the sorting bar appears immediately —
      // small jobs finish before any poll would ever show one.
      onJobStarted(await api.classifyRemaining());
    } catch (e) {
      onToast(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!(waitingCount > 0)) return null;
  return (
    <div className="waiting">
      <span className="waiting__icon"><ZapIcon size={20} /></span>
      <div className="waiting__text">
        <b>{waitingCount.toLocaleString()} videos are waiting to be sorted</b>
        <p>Laterlist files every one of them into your five rows.</p>
      </div>
      <button className="btn btn--primary" disabled={busy} onClick={sortRemaining}>
        <ZapIcon size={15} /> {busy ? "Starting…" : "Sort now"}
      </button>
    </div>
  );
}
