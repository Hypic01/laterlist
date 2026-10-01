import React, { useEffect, useRef, useState } from "react";
import * as api from "../api.js";
import { CHROME_STORE_URL, INTEREST_OPTIONS } from "../lib.js";
import { CheckIcon, ExternalIcon, SyncIcon } from "./icons.jsx";
import ImportPanel from "./ImportPanel.jsx";

const ACTIVE_JOB = new Set(["queued", "running", "awaiting_batch"]);

// busy = the app is working on this step (spinner). An active step that is
// waiting on the user (a button) shows a plain ring instead.
function Step({ state, busy = false, title, children }) {
  return (
    <li className={`setup__step setup__step--${state}${busy ? " setup__step--busy" : ""}`}>
      <span className="setup__dot" aria-hidden="true">
        {state === "done" ? <CheckIcon size={13} /> : busy ? <SyncIcon size={13} /> : null}
      </span>
      <div className="setup__copy">
        <b>{title}</b>
        {children}
      </div>
    </li>
  );
}

// Optional taste chips. Each toggle saves after a short pause; a pending save
// is flushed if the screen closes first (the first sorted videos arrive).
function TasteChips({ me }) {
  const note = me?.tasteProfile?.note ?? "";
  const [picked, setPicked] = useState(() => new Set(me?.tasteProfile?.interests ?? []));
  const timer = useRef(null);
  const pending = useRef(null);
  const flush = () => {
    clearTimeout(timer.current);
    if (!pending.current) return;
    const interests = pending.current;
    pending.current = null;
    api.saveTaste({ interests, note }).catch(() => {});
  };
  useEffect(() => flush, []);
  const toggle = (t) => {
    const next = new Set(picked);
    next.has(t) ? next.delete(t) : next.add(t);
    setPicked(next);
    pending.current = [...next];
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };
  return (
    <section className="setup__taste" aria-labelledby="setup-taste-title">
      <h3 id="setup-taste-title">While you wait: what do you use YouTube for?</h3>
      <p>Optional. It helps the AI judge what's worth your time.</p>
      <div className="onboard__chips" role="group" aria-label="Pick your interests">
        {INTEREST_OPTIONS.map((t) => (
          <button key={t} type="button" className={`chip${picked.has(t) ? " chip--active" : ""}`}
            onClick={() => toggle(t)} aria-pressed={picked.has(t)}>
            {t}
          </button>
        ))}
      </div>
    </section>
  );
}

export default function SetupScreen({
  me, extension, collection, job, extensionBusy = false, extensionSyncing = false,
  onConnect, onSync, onImported, onConnectExtension,
}) {
  const present = Boolean(extension?.present);
  const connected = present && extension.connected && !extension.mismatch;
  const sorting = Boolean(job && ACTIVE_JOB.has(job.state));
  const failed = job?.state === "failed" && job.error;

  if (!extension?.isChromium) {
    return (
      <div className="setup">
        <ImportPanel onImported={onImported} extension={extension}
          onConnectExtension={onConnectExtension} extensionBusy={extensionBusy} />
        {failed ? <div className="importer__error" role="alert">{job.error}</div> : null}
        <TasteChips me={me} />
      </div>
    );
  }

  const count = Number(collection?.count) || 0;
  const fetchBody = sorting ? (
    <p>{`${Number(job.processed || 0).toLocaleString()} of ${Number(job.total || 0).toLocaleString()} sorted. Your board opens as soon as the first ones land.`}</p>
  ) : collection || extensionSyncing ? (
    <p>{count ? `${count.toLocaleString()} videos so far` : "Opening your Watch Later…"}</p>
  ) : connected ? (
    <button className="btn btn--primary" type="button" onClick={onSync}>
      <SyncIcon size={15} /> Fetch my Watch Later
    </button>
  ) : null;

  return (
    <div className="setup">
      <h2>Let's get your Watch Later</h2>
      <p className="setup__lead">Three quick steps. Your board starts filling in seconds.</p>
      <ol className="setup__steps">
        <Step state={present ? "done" : "active"} title={present ? "Extension added" : "Add the Chrome extension"}>
          {present ? null : (
            <>
              <p>It reads your Watch Later right in your browser. Come back to this tab after adding it.</p>
              <a className="btn btn--primary" href={CHROME_STORE_URL} target="_blank" rel="noreferrer">
                <ExternalIcon size={14} /> Add to Chrome
              </a>
            </>
          )}
        </Step>
        <Step state={connected ? "done" : present ? "active" : "waiting"} busy={extensionBusy}
          title={connected ? `Connected to ${extension.accountEmail}` : "Connect it to your account"}>
          {present && extension.mismatch ? (
            <>
              <p>This extension is connected to a different account.</p>
              <button className="btn btn--primary" type="button" disabled={extensionBusy} onClick={onConnect}>
                {extensionBusy ? "Reconnecting…" : "Reconnect"}
              </button>
            </>
          ) : present && !connected ? (
            <button className="btn btn--primary" type="button" disabled={extensionBusy} onClick={onConnect}>
              {extensionBusy ? "Connecting…" : "Connect"}
            </button>
          ) : null}
        </Step>
        <Step state={connected ? "active" : "waiting"} busy={sorting || Boolean(collection) || extensionSyncing}
          title={sorting ? "Sorting your videos" : "Fetching your list"}>
          {fetchBody}
        </Step>
      </ol>
      {failed ? <div className="importer__error" role="alert">{job.error}</div> : null}
      <TasteChips me={me} />
    </div>
  );
}
