import React, { useEffect, useRef, useState } from "react";
import * as api from "../api.js";
import { formatDuration, parseTopics } from "../lib.js";
import { CATEGORIES } from "./VideoCard.jsx";
import {
  ArrowLeftIcon,
  CheckIcon,
  ExternalIcon,
  PlayIcon,
  SparklesIcon,
  SummaryIcon,
  XIcon,
} from "./icons.jsx";
import FloatingMenu from "./FloatingMenu.jsx";

const SUMMARY_BUSY = new Set(["fetching", "summarizing"]);

function transcriptPayload(result) {
  const metadata = result?.metadata || {};
  return {
    transcript: result?.transcript,
    source: result?.source || "extension",
    description: result?.description ?? metadata.description ?? null,
    uploadDate: result?.uploadDate ?? metadata.uploadDate ?? null,
    durationSeconds: result?.durationSeconds ?? metadata.durationSeconds ?? null,
    channel: result?.channel ?? metadata.channel ?? null,
  };
}

export default function VideoDetail({
  video: preview,
  rowMeta,
  intent = null,
  extensionPresent,
  removesFromYoutube = false,
  youtubeNote = null,
  fetchTranscriptFromExtension,
  onBack,
  onMove,
  onDismiss,
  onDone,
  onToast,
}) {
  const [video, setVideo] = useState(preview);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState("");
  const [fallback, setFallback] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const moveRef = useRef(null);
  const [playing, setPlaying] = useState(intent === "play");
  const [doneState, setDoneState] = useState("idle");
  const [summary, setSummary] = useState(null);
  const [summaryState, setSummaryState] = useState("idle");
  const [summaryError, setSummaryError] = useState("");
  const intentDoneRef = useRef(false);
  const playerRef = useRef(null);

  useEffect(() => {
    let active = true;
    setVideo(preview);
    setDetailLoading(true);
    setDetailError("");
    setFallback(false);
    setPlaying(intent === "play");
    setDoneState("idle");
    setSummary(null);
    setSummaryState("idle");
    setSummaryError("");

    api.getVideo(preview.id).then(
      (detail) => {
        if (!active) return;
        setVideo(detail);
        setDetailLoading(false);
      },
      (error) => {
        if (!active) return;
        setDetailError(error.message || "The video details could not load.");
        setDetailLoading(false);
      },
    );
    return () => { active = false; };
  }, [preview.id, intent]);

  useEffect(() => {
    if (playing) playerRef.current?.focus();
  }, [playing, preview.id]);

  const transcriptAvailable = Boolean(video.transcript_available);
  const RowIcon = rowMeta?.icon;
  const thumb = `https://i.ytimg.com/vi/${video.id}/${fallback ? "hqdefault" : "maxresdefault"}.jpg`;
  const ytUrl = `https://www.youtube.com/watch?v=${video.id}`;
  const embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}?autoplay=1&playsinline=1&rel=0`;

  const meta = [
    video.channel,
    video.duration_seconds != null && formatDuration(video.duration_seconds),
    video.upload_date && `uploaded ${video.upload_date}`,
  ].filter(Boolean).join(" · ");

  const loadSummary = async () => {
    if (detailLoading || SUMMARY_BUSY.has(summaryState) || summaryState === "done") return;
    setSummaryError("");

    try {
      if (!transcriptAvailable) {
        // This state lands before the first request. A fast transcript fetch can
        // never make the click appear inert.
        setSummaryState("fetching");
        if (extensionPresent && fetchTranscriptFromExtension) {
          const captured = await fetchTranscriptFromExtension(video.id);
          if (!captured?.ok || !captured.transcript) {
            throw new Error(captured?.message || captured?.error || "The extension could not read captions for this video.");
          }
          await api.saveTranscript(video.id, transcriptPayload(captured));
        } else {
          await api.fetchTranscriptFromServer(video.id);
        }
        setVideo((current) => ({ ...current, transcript_available: true }));
      }

      // This state also lands before the summary request, including when the
      // transcript request finishes inside the same click.
      setSummaryState("summarizing");
      const result = await api.summarizeVideo(video.id);
      setSummary(result.summary);
      setSummaryState("done");
    } catch (error) {
      setSummaryError(error.message || "The summary could not be generated.");
      setSummaryState("error");
    }
  };

  // A TL;DR click on the card carries into this view as an intent:
  // act on it exactly once, as soon as the detail has loaded.
  useEffect(() => {
    intentDoneRef.current = false;
  }, [preview.id]);
  useEffect(() => {
    if (!intent || intentDoneRef.current || detailLoading) return;
    intentDoneRef.current = true;
    if (intent === "tldr") loadSummary();
  });

  const move = async (category) => {
    setMoveOpen(false);
    await onMove(video.id, category);
    setVideo((current) => ({ ...current, category }));
  };

  const dismiss = async () => {
    await onDismiss(video.id);
    onBack();
  };

  const markWatched = async () => {
    if (!onDone || doneState !== "idle") return;
    setDoneState("saving");
    try {
      await onDone(video.id);
      setDoneState("done");
    } catch (error) {
      setDoneState("idle");
      onToast?.(error.message || "The video could not be marked watched.");
    }
  };

  const summaryButtonLabel = summaryState === "fetching"
    ? "Fetching the transcript…"
    : summaryState === "summarizing"
      ? "Summarizing…"
      : "TL;DR";

  return (
    <section className="detail" style={{ "--row-tint": rowMeta?.tint }}>
      <header className="catview__header">
        <button className="btn btn--ghost" onClick={onBack}>
          <ArrowLeftIcon size={15} /> Back
        </button>
      </header>

      <div className={`detail__hero${playing ? " detail__hero--playing" : ""}`}>
        {playing ? (
          <iframe
            ref={playerRef}
            className="detail__player"
            src={embedUrl}
            title={`YouTube player for "${video.title}"`}
            tabIndex={0}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button className="detail__poster" onClick={() => setPlaying(true)}
            aria-label={`Play "${video.title}" here`}>
            <img className="detail__thumb" src={thumb} alt=""
              onLoad={(e) => { if (e.currentTarget.naturalWidth <= 120 && !fallback) setFallback(true); }}
              onError={() => { if (!fallback) setFallback(true); }} />
            <span className="detail__play"><PlayIcon size={19} /> Play here</span>
          </button>
        )}
      </div>
      <div className="detail__head">
        <h2 className="detail__title">{video.title}</h2>
        {meta ? <div className="detail__meta">{meta}</div> : null}
        <div className="detail__tags">
          {rowMeta && RowIcon ? (
            <span className="pill pill--category"><RowIcon size={12} /> {rowMeta.label}</span>
          ) : null}
          {parseTopics(video).map((topic) => <span key={topic} className="pill pill--topic">{topic}</span>)}
          {video.vault_note_path ? <span className="pill pill--vault">in vault</span> : null}
        </div>
        {video.reasoning ? (
          <div className="detail__reasoning">
            <SparklesIcon size={15} />
            <p>{video.reasoning}</p>
          </div>
        ) : null}
        {video.description ? <p className="detail__description">{video.description}</p> : null}
        {detailError ? <div className="detail__error" role="alert">{detailError}</div> : null}
      </div>

      {/* One bar: the filled button is the screen's job (decide this video's fate);
          features sit beside it, row moves and dismissal on the right. */}
      <div className="detail__actions">
        <button className="btn btn--primary" onClick={markWatched} disabled={doneState !== "idle"}
          data-tip-align="start" data-tip={youtubeNote ?? (removesFromYoutube
            ? "Hides it here and takes it off your YouTube Watch Later."
            : "Hides it from this board. Your YouTube Watch Later stays unchanged.")}
          aria-describedby="detail-watched-note">
          <CheckIcon size={14} />
          {doneState === "saving" ? "Marking…" : doneState === "done" ? "Marked watched" : "Mark watched"}
        </button>
        <button className="btn btn--ghost detail__summary-button" onClick={loadSummary}
          disabled={detailLoading || SUMMARY_BUSY.has(summaryState)}>
          <SummaryIcon size={15} /> {summaryButtonLabel}
        </button>
        <a className="btn btn--ghost" href={ytUrl} target="_blank" rel="noreferrer">
          <ExternalIcon size={15} /> Open on YouTube
        </a>
        <div className="topbar__spacer" />
        <button ref={moveRef} type="button" className="select detail__move" aria-haspopup="menu"
          aria-expanded={moveOpen} aria-label="Move to another row" onClick={() => setMoveOpen((o) => !o)}>
          Move to…
        </button>
        {moveOpen && (
          <FloatingMenu anchorRef={moveRef} onClose={() => setMoveOpen(false)} label="Move to another row" matchWidth>
            {CATEGORIES.filter((c) => c.key !== video.category).map((c) => (
              <button key={c.key} role="menuitem" onClick={() => move(c.key)}>
                <span className="card__menu-dot" style={{ background: `var(--cat-${c.key})` }} />
                {c.label}
              </button>
            ))}
          </FloatingMenu>
        )}
        <button className="btn btn--ghost" onClick={dismiss}>
          <XIcon size={14} /> Not interested
        </button>
      </div>

      {/* Read by screen readers, shown on touch screens where the tooltip can't appear. */}
      <p id="detail-watched-note" className="detail__note">
        {youtubeNote ?? (removesFromYoutube
          ? "Mark watched hides it here and takes it off your YouTube Watch Later."
          : "Mark watched hides it from this board. Your YouTube Watch Later stays unchanged.")}
      </p>

      {summaryError ? <div className="detail__error" role="alert">{summaryError}</div> : null}
      {SUMMARY_BUSY.has(summaryState) ? (
        <div className="summary__thinking" role="status" aria-live="polite">
          <SparklesIcon size={14} /> {summaryButtonLabel}
        </div>
      ) : null}

      {summary ? (
        <div className="summary">
          <div className="summary__block">
            <div className="summary__label"><SummaryIcon size={12} /> tl;dr</div>
            <p className="summary__tldr">{summary.tldr}</p>
          </div>
          {summary.points?.length ? (
            <div className="summary__block">
              <div className="summary__label"><SparklesIcon size={12} /> key points</div>
              <ul className="summary__points">
                {summary.points.map((point, index) => <li key={`${index}:${point}`}>{point}</li>)}
              </ul>
            </div>
          ) : null}
          {summary.watchIf ? (
            <div className="summary__block summary__verdict">
              <div className="summary__label"><ExternalIcon size={12} /> watch anyway if</div>
              <p>{summary.watchIf}</p>
            </div>
          ) : null}
        </div>
      ) : null}

    </section>
  );
}
