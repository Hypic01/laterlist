// Phone actions wait a few seconds before they reach the server, so Undo can
// cancel them and an undone remove never queues a YouTube removal. There is
// one module-level queue: it has to outlive PhoneApp (rotating the phone can
// unmount it), and it flushes when the page goes away.
import { getToken as defaultGetToken } from "../auth.js";

export const COMMIT_DELAY_MS = 5000;

const videoPath = (id) => `/api/videos/${encodeURIComponent(id)}`;

export function requestsFor(action) {
  switch (action.kind) {
    case "dismiss": return [{ url: `${videoPath(action.id)}/dismiss` }];
    case "done": return [{ url: "/api/videos/done", body: { ids: [action.id] } }];
    case "keep": return [{ url: `${videoPath(action.id)}/keep` }];
    case "move": return [
      { url: `${videoPath(action.id)}/category`, body: { category: action.category } },
      ...(action.keep ? [{ url: `${videoPath(action.id)}/keep` }] : []),
    ];
    default: throw new Error(`unknown action ${action.kind}`);
  }
}

export async function postRequest({ url, body }, token, { keepalive = false } = {}) {
  const res = await fetch(url, {
    method: "POST",
    keepalive,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // 404 means the video already left the board (say, removed on the computer).
  if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
}

export function createPendingQueue({ send = postRequest, getToken = defaultGetToken, delay = COMMIT_DELAY_MS } = {}) {
  const items = new Map(); // key -> { action, token, tokenPromise, timer }
  const listeners = new Set();
  let nextKey = 1;
  const emit = (event) => listeners.forEach((fn) => fn(event));

  const commit = (key, { keepalive = false } = {}) => {
    const item = items.get(key);
    if (!item) return Promise.resolve();
    clearTimeout(item.timer);
    items.delete(key);
    emit({ type: "change" });
    const run = (token) => Promise.all(requestsFor(item.action).map((r) => send(r, token, { keepalive })));
    // A keepalive flush can't wait for an async token; send what we have.
    const sent = keepalive || item.token !== undefined ? run(item.token) : item.tokenPromise.then(run);
    return sent.then(
      () => emit({ type: "settled", key, action: item.action, ok: true }),
      (error) => emit({ type: "settled", key, action: item.action, ok: false, error }),
    );
  };

  return {
    enqueue(action) {
      requestsFor(action); // an unknown kind throws now, not 5 s later
      const key = nextKey++;
      const item = { action, token: undefined };
      item.tokenPromise = Promise.resolve()
        .then(() => getToken())
        .then((t) => { item.token = t ?? null; return item.token; }, () => { item.token = null; return null; });
      item.timer = setTimeout(() => { void commit(key); }, delay);
      items.set(key, item);
      emit({ type: "change" });
      return key;
    },
    undo(key) {
      const item = items.get(key);
      if (!item) return null;
      clearTimeout(item.timer);
      items.delete(key);
      emit({ type: "change" });
      return item.action;
    },
    has(key) {
      return items.has(key);
    },
    flush({ keepalive = false } = {}) {
      return Promise.all([...items.keys()].map((key) => commit(key, { keepalive })));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}

export const pendingQueue = createPendingQueue();
