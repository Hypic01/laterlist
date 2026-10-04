import React, { useEffect, useState } from "react";
import * as api from "../api.js";
import { CheckIcon, HistoryIcon, XIcon } from "./icons.jsx";

export function youtubeStateLabel(state) {
  return { removed: "off YouTube", pending: "removing", failed: "still on YouTube" }[state] || null;
}

export default function CleanupChecklist() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.getCleanup().then(setRows).catch(() => setRows([])); }, []);
  if (!rows) return <div className="loading">loading…</div>;
  return (
    <div className="history">
      <p className="history__hint">
        <HistoryIcon size={15} />
        Videos you remove here also leave your YouTube Watch Later when the extension is connected. Anything marked still on YouTube needs a manual cleanup.
      </p>
      <table>
        <thead>
          <tr><th>Status</th><th>Title</th><th>Channel</th></tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id}>
              <td>
                {v.status === "done"
                  ? <span className="pill pill--done"><CheckIcon size={12} /> done</span>
                  : <span className="pill pill--dismissed"><XIcon size={12} /> not interested</span>}
                {youtubeStateLabel(v.youtube_state) ? (
                  <span className={`pill ${v.youtube_state === "removed" ? "pill--done" : "pill--dismissed"}`}
                    style={{ marginLeft: "var(--space-2)" }}>
                    {youtubeStateLabel(v.youtube_state)}
                  </span>
                ) : null}
              </td>
              <td><a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank"
                rel="noreferrer">{v.title}</a></td>
              <td>{v.channel}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan="3">nothing cleared yet. Mark videos watched or not interested from the board</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
