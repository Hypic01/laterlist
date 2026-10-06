import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api.js";
import { isFirstRun } from "../lib.js";
import { ROWS } from "../rows.js";
import { applyOverlay, buildDeck, findVideo, pruneOverlay, revertEffect, sessionStats } from "./deck.js";
import { COMMIT_DELAY_MS, pendingQueue } from "./pendingQueue.js";
import { REMOVAL_NOTE } from "./copy.js";
import PhoneBoard from "./PhoneBoard.jsx";
import PhoneSetupNote from "./PhoneSetupNote.jsx";
import PhoneRow from "./PhoneRow.jsx";
import VideoSheet from "./VideoSheet.jsx";
import CleanupDeck from "./CleanupDeck.jsx";
import PhoneSettings from "./PhoneSettings.jsx";
import VideoDetail from "../components/VideoDetail.jsx";
import Onboarding from "../components/Onboarding.jsx";
import { BrandMark, CardsIcon, SettingsIcon } from "../components/icons.jsx";
import "./phone.css";

const TOAST_TEXT = { dismiss: "Removed", done: "Marked watched", keep: "Kept" };
const TAB_SCREENS = new Set(["board", "row", "settings"]);
const ROOT = [{ name: "board" }];

export default function PhoneApp({ me, board, job, reload, onSummaryUsed }) {
  // Screens form a stack. A "sheet" entry sits on top of the screen it covers.
  const [stack, setStack] = useState([{ name: "board" }]);
  const [overlay, setOverlay] = useState({});
  const [toast, setToast] = useState(null); // { text, key }
  const [log, setLog] = useState([]);
  const [undone, setUndone] = useState(() => new Set());
  const [importLinked, setImportLinked] = useState(false);
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const effectsRef = useRef(new Map()); // action key -> { id, effect, previous }
  const pendingTabRef = useRef(null);
  const lastSheetVideoRef = useRef(null);
  const toastTimer = useRef(null);
  const reloadTimer = useRef(null);

  const top = stack[stack.length - 1];
  const sheetOpen = top.name === "sheet";
  const screen = sheetOpen ? stack[stack.length - 2] : top;
  const view = useMemo(() => applyOverlay(board, overlay), [board, overlay]);
  const deckAll = useMemo(() => buildDeck(view), [view]);
  const removalQueued = Boolean(me.removeFromYoutube) && importLinked;
  // The sheet keeps its last video while it animates closed.
  if (sheetOpen) lastSheetVideoRef.current = top.video;
  const sheetBase = lastSheetVideoRef.current;
  const liveSheetVideo = sheetBase ? findVideo(view, sheetBase.id) ?? sheetBase : null;

  // ---- navigation: every history entry holds a full snapshot of the stack, so
  // Back AND Forward (Safari's edge swipes) restore exactly what was there.
  const commitStack = (next, mode) => {
    if (mode === "push") history.pushState({ phoneStack: next }, "");
    else history.replaceState({ phoneStack: next }, "");
    stackRef.current = next;
    setStack(next);
  };
  const push = (entry) => commitStack([...stackRef.current, entry], "push");
  const back = () => history.back();
  const replaceTop = (entry) => commitStack([...stackRef.current.slice(0, -1), entry], "replace");
  const switchTab = (entry) => {
    const depth = stackRef.current.length - 1;
    if (depth === 0) { commitStack([entry], "replace"); return; }
    pendingTabRef.current = entry; // applied when the history jump lands
    history.go(-depth);
  };
  useEffect(() => {
    history.replaceState({ phoneStack: ROOT }, "");
    const onPop = (e) => {
      if (pendingTabRef.current) {
        const next = [pendingTabRef.current];
        pendingTabRef.current = null;
        history.replaceState({ phoneStack: next }, "");
        stackRef.current = next;
        setStack(next);
        return;
      }
      const restored = Array.isArray(e.state?.phoneStack) ? e.state.phoneStack : ROOT;
      stackRef.current = restored;
      setStack(restored);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ---- data that only the phone needs
  useEffect(() => { setOverlay((o) => pruneOverlay(board, o)); }, [board]);
  useEffect(() => {
    api.listTokens().then((tokens) => setImportLinked(tokens.some((t) => t.scope === "imports")), () => {});
  }, []);

  // ---- toast + the undo queue
  const flashToast = useCallback((text, key = null) => {
    setToast({ text, key });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), key ? COMMIT_DELAY_MS : 3000);
  }, []);

  useEffect(() => pendingQueue.subscribe((event) => {
    if (event.type !== "settled") return;
    const entry = effectsRef.current.get(event.key);
    effectsRef.current.delete(event.key);
    if (!event.ok) {
      if (entry) setOverlay((o) => revertEffect(o, entry.id, entry.effect, entry.previous));
      flashToast("Couldn't save that. Check your connection and try again.");
    }
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => { reload().catch(() => {}); }, 400);
  }), [flashToast, reload]);

  useEffect(() => {
    const flush = () => { void pendingQueue.flush({ keepalive: true }); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    document.documentElement.classList.add("is-phone");
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      document.documentElement.classList.remove("is-phone");
      // Turning into the desktop layout mid-session: send what's pending, then
      // refresh the board the desktop is about to show.
      void pendingQueue.flush({ keepalive: true }).then(() => reloadRef.current().catch(() => {}));
    };
  }, []);

  const act = (action, video, effect, text) => {
    const previous = overlayRef.current[video.id];
    overlayRef.current = { ...overlayRef.current, [video.id]: effect };
    setOverlay((o) => ({ ...o, [video.id]: effect }));
    const key = pendingQueue.enqueue(action);
    effectsRef.current.set(key, { id: video.id, effect, previous });
    setLog((l) => [...l, { key, kind: action.kind, video }]);
    flashToast(text, key);
  };
  const remove = (video, kind = "dismiss") => act({ kind, id: video.id }, video, { hide: true }, TOAST_TEXT[kind]);
  const keep = (video) => act({ kind: "keep", id: video.id }, video, { kept: true }, TOAST_TEXT.keep);
  const move = (video, category, alsoKeep = false) => act(
    { kind: "move", id: video.id, category, keep: alsoKeep }, video, { category, kept: alsoKeep },
    `Moved to ${ROWS.find((r) => r.key === category)?.label ?? category}`,
  );
  const undo = () => {
    if (!toast?.key) return;
    const action = pendingQueue.undo(toast.key);
    const entry = effectsRef.current.get(toast.key);
    effectsRef.current.delete(toast.key);
    if (action) {
      if (entry) setOverlay((o) => revertEffect(o, entry.id, entry.effect, entry.previous));
      setUndone((u) => new Set(u).add(toast.key));
    }
    setToast(null);
  };

  // ---- screens
  const openSheet = (video, { panel = "main", fromDeck = false } = {}) => {
    push({ name: "sheet", video, panel, fromDeck });
  };
  const deckEntry = (row) => ({ name: "deck", row, startCount: buildDeck(view, { row }).length });
  const resetSession = () => { setLog([]); setUndone(new Set()); };
  const startDeck = (row) => { resetSession(); push(deckEntry(row)); };
  const closeDeck = () => (stackRef.current.length > 1 ? back() : switchTab({ name: "board" }));
  const retakeQuiz = () => { api.saveTaste({ interests: [], note: "" }).catch(() => {}); push({ name: "quiz" }); };

  let body;
  if (screen.name === "board") {
    body = isFirstRun(me.counts)
      ? <PhoneSetupNote host={globalThis.location?.host ?? ""} />
      : (
        <PhoneBoard board={view} deckCount={deckAll.length} job={job}
          onOpenRow={(row) => push({ name: "row", row })}
          onStartCleanup={() => startDeck(null)}
          onSearch={() => push({ name: "row", row: null, search: true })} />
      );
  } else if (screen.name === "row") {
    body = (
      <PhoneRow key={`${screen.row}:${Boolean(screen.search)}`} rowKey={screen.row} board={view}
        startSearch={Boolean(screen.search)} onBack={back}
        onOpenVideo={(v) => openSheet(v)} onMove={(v) => openSheet(v, { panel: "move" })}
        onRemove={(v) => remove(v)} onCleanRow={(row) => startDeck(row)} />
    );
  } else if (screen.name === "deck") {
    body = (
      <CleanupDeck deck={buildDeck(view, { row: screen.row })} startCount={screen.startCount}
        stats={sessionStats(log, undone)} removalQueued={removalQueued} onClose={closeDeck}
        onDecide={(outcome, v) => (outcome === "remove" ? remove(v) : keep(v))}
        onOpenVideo={(v) => openSheet(v, { fromDeck: true })}
        onMove={(v) => openSheet(v, { panel: "move", fromDeck: true })}
        onTldr={(v) => push({ name: "detail", video: v, intent: "tldr" })} />
    );
  } else if (screen.name === "settings") {
    body = <PhoneSettings me={me} reload={reload} onToast={flashToast} onRetakeQuiz={retakeQuiz} removalQueued={removalQueued} />;
  } else if (screen.name === "quiz") {
    body = <Onboarding onDone={() => reload().then(back)} />;
  } else if (screen.name === "detail") {
    const video = findVideo(view, screen.video.id) ?? screen.video;
    body = (
      <div className="ph-detail">
        <VideoDetail video={video} rowMeta={ROWS.find((r) => r.key === video.category)} me={me}
          intent={screen.intent} extensionPresent={false} removesFromYoutube={false}
          youtubeNote={removalQueued ? `Mark watched hides it here. ${REMOVAL_NOTE}` : null}
          onBack={back} onMove={async (id, category) => move(video, category)}
          onDismiss={async () => remove(video)} onDone={async () => remove(video, "done")}
          onToast={flashToast} onSummaryUsed={onSummaryUsed} />
      </div>
    );
  }

  const sheetProps = sheetOpen && liveSheetVideo ? {
    panel: top.panel,
    onPanel: (panel) => replaceTop({ ...top, panel }),
    removalQueued,
    onPlay: () => replaceTop({ name: "detail", video: liveSheetVideo, intent: "play" }),
    onTldr: () => replaceTop({ name: "detail", video: liveSheetVideo, intent: "tldr" }),
    onMove: (category) => { move(liveSheetVideo, category, top.fromDeck); back(); },
    onDone: () => { remove(liveSheetVideo, "done"); back(); },
    onDismiss: () => { remove(liveSheetVideo, "dismiss"); back(); },
  } : { panel: "main", onPanel: () => {} };

  const tabsVisible = TAB_SCREENS.has(screen.name);
  const onSettings = screen.name === "settings";

  return (
    <div className={`ph-app${tabsVisible ? " has-tabs" : ""}`}>
      {body}

      {toast ? (
        <div className="ph-toast" role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.key ? <button onClick={undo}>Undo</button> : null}
        </div>
      ) : null}

      {tabsVisible ? (
        <nav className="ph-tabs" aria-label="Main">
          <button className={`ph-tab${onSettings ? "" : " is-on"}`} aria-current={onSettings ? undefined : "page"}
            onClick={() => switchTab({ name: "board" })}>
            <BrandMark size={20} />Board
          </button>
          <button className="ph-tab" onClick={() => { resetSession(); switchTab(deckEntry(null)); }}>
            <CardsIcon size={20} />Clean up
            {deckAll.length ? <span className="ph-tab__badge">{deckAll.length}</span> : null}
          </button>
          <button className={`ph-tab${onSettings ? " is-on" : ""}`} aria-current={onSettings ? "page" : undefined}
            onClick={() => switchTab({ name: "settings" })}>
            <SettingsIcon size={20} />Settings
          </button>
        </nav>
      ) : null}

      <VideoSheet video={liveSheetVideo} open={sheetOpen} onClose={back} {...sheetProps} />
    </div>
  );
}
