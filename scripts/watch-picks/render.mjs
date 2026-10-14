import fs from "node:fs";
import path from "node:path";
import { fmtTime } from "./subs.mjs";

export { PicksDataError, validatePicks } from "../../server/picks.js";
const ROW_LABEL = { learn: "Get the gist", watch: "Watch it" };
const VERDICT_TEMPLATE = "worth it | not | skipped";
const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const mdText = (s) => String(s).replace(/([\\[\]])/g, "\\$1");
const minutes = (sec) => (sec ? `${Math.max(1, Math.round(sec / 60))} min` : "");

export function weekId(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function watchUrl(id, start) {
  return `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ""}`;
}

export function bestPart(p) {
  if (p.start === null || p.start === undefined) return "Watch it all";
  if (p.end === null || p.end === undefined) return `Start at ${fmtTime(p.start)}`;
  return `Watch ${fmtTime(p.start)} to ${fmtTime(p.end)}`;
}

// Token values copied verbatim from web/src/styles.css :root (dark theme).
// Colour appears only on the category dot.
const CSS = `
:root {
  color-scheme: dark;
  --background: #191919;
  --foreground: #D9D9D9;
  --card: #212121;
  --secondary: #2E2E2E;
  --muted: #9A9A9A;
  --faint: #6E6E6E;
  --border: rgba(217, 217, 217, .10);
  --border-strong: rgba(217, 217, 217, .18);
  --cat-learn: #6695F7;
  --cat-watch: #70B665;
  --font-display: 'Fjalla One', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 24px; --space-6: 32px; --space-7: 48px;
  --radius-sm: 4px; --radius-md: 7px; --radius-lg: 11px; --radius-pill: 999px;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--background); color: var(--foreground); font: 15px/1.6 var(--font-body); }
main { max-width: 1040px; margin: 0 auto; padding: var(--space-7) var(--space-4); }
h1, h2, h3 { font-family: var(--font-display); font-weight: 400; margin: 0; }
a { color: inherit; text-decoration: none; }
a:hover { text-decoration: underline; }
.eyebrow, .label { color: var(--muted); font-size: 13px; margin: 0 0 var(--space-1); display: block; }
.focus { font-size: 34px; line-height: 1.2; margin-bottom: var(--space-4); }
.points { margin: 0 0 var(--space-4); padding-left: var(--space-5); }
.notice { color: var(--muted); margin: 0 0 var(--space-5); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: var(--space-4); margin: var(--space-6) 0; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; }
.thumb { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: var(--secondary); }
.body { padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
.body p { margin: 0; }
.row { color: var(--muted); font-size: 13px; display: flex; align-items: center; gap: var(--space-2); }
.dot { width: 8px; height: 8px; border-radius: var(--radius-pill); display: inline-block; }
.dot-learn { background: var(--cat-learn); }
.dot-watch { background: var(--cat-watch); }
h2 { font-size: 21px; line-height: 1.25; }
.meta { color: var(--muted); font-size: 13px; }
.faint { color: var(--faint); }
.chip { align-self: flex-start; border: 1px solid var(--border-strong); border-radius: var(--radius-pill); padding: 2px var(--space-3); font-size: 13px; }
.gets { margin: 0; padding-left: var(--space-5); }
.close { border-top: 1px solid var(--border); padding-top: var(--space-5); }
.close h3 { font-size: 18px; margin-bottom: var(--space-3); }
.close ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.reason { color: var(--muted); display: block; font-size: 13px; }
`;

const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`;

export function renderHtml(d) {
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>Watch picks · ${esc(d.week)}</title>`
    + `<link rel="preconnect" href="https://fonts.googleapis.com">`
    + `<link href="https://fonts.googleapis.com/css2?family=Fjalla+One&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">`
    + `<style>${CSS}</style></head><body><main>`
    + `<p class="eyebrow">Watch picks · week of ${esc(d.week)}</p>`;
  const tail = `</main></body></html>`;
  if (d.error) {
    return `${head}<h1 class="focus">Couldn't reach Laterlist this week</h1><p class="notice">${esc(d.error)}</p>${tail}`;
  }
  const points = d.focusPoints.length ? `<ul class="points">${d.focusPoints.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : "";
  const notice = d.notice ? `<p class="notice">${esc(d.notice)}</p>` : "";
  const cards = d.picks.map((p, i) => {
    const href = watchUrl(p.id, p.start);
    const meta = [p.channel, minutes(p.durationSeconds)].filter(Boolean).map(esc).join(" · ");
    const gets = p.gets.length ? `<ul class="gets">${p.gets.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : "";
    return `<article class="card">`
      + link(href, `<img class="thumb" src="https://i.ytimg.com/vi/${p.id}/hqdefault.jpg" alt="">`)
      + `<div class="body">`
      + `<p class="row"><span class="dot dot-${p.row}"></span>${i + 1} · ${ROW_LABEL[p.row]}</p>`
      + `<h2>${link(href, esc(p.title))}</h2>`
      + `<p class="meta">${meta}${p.noTranscript ? ` · <span class="faint">no transcript</span>` : ""}</p>`
      + `<p><span class="label">Why you, now</span>${esc(p.why)}</p>`
      + `<p class="chip">${esc(bestPart(p))}</p>`
      + gets
      + `</div></article>`;
  }).join("");
  const none = d.picks.length ? "" : `<p class="notice">No picks this week.</p>`;
  const close = d.closeButNo.length
    ? `<section class="close"><h3>Close, but no (${d.closeButNo.length})</h3><ul>`
      + d.closeButNo.map((c) => `<li>${link(watchUrl(c.id, null), esc(c.title))}<span class="reason">${esc(c.reason)}</span></li>`).join("")
      + `</ul></section>`
    : "";
  return `${head}<span class="label">Your focus this week</span><h1 class="focus">${esc(d.focus)}</h1>`
    + `${points}${notice}<section class="cards">${cards}</section>${none}${close}${tail}`;
}

export function renderMarkdown(d, { posted = false } = {}) {
  const lines = ["---", `week: ${d.week}`, "type: watch-picks", "---", "", `# Watch picks, week of ${d.week}`, ""];
  if (d.error) {
    lines.push("Couldn't reach Laterlist this week.", "", `Error: ${d.error}`, "");
    return lines.join("\n");
  }
  lines.push(`**Your focus this week:** ${d.focus}`);
  for (const f of d.focusPoints) lines.push(`- ${f}`);
  lines.push("");
  if (d.notice) lines.push(`> ${d.notice}`, "");
  if (!d.picks.length) lines.push("No picks this week.", "");
  d.picks.forEach((p, i) => {
    lines.push(`## ${i + 1}. [${mdText(p.title)}](${watchUrl(p.id, p.start)})`);
    lines.push([p.channel, minutes(p.durationSeconds), ROW_LABEL[p.row], bestPart(p), p.noTranscript ? "no transcript" : ""]
      .filter(Boolean).join(" · "));
    lines.push("", `Why you, now: ${p.why}`);
    for (const g of p.gets) lines.push(`- ${g}`);
    lines.push("", posted ? "Verdict: tap it in Laterlist" : `Verdict: ${VERDICT_TEMPLATE}`, "");
  });
  if (d.closeButNo.length) {
    lines.push("## Close, but no", "");
    for (const c of d.closeButNo) lines.push(`- [${mdText(c.title)}](${watchUrl(c.id, null)}): ${c.reason}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function parsePicksNote(md) {
  const text = String(md);
  const week = (text.match(/^week:\s*(\d{4}-\d{2}-\d{2})\s*$/m) || [])[1] || null;
  const picks = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("## ")) {
      current = null;
      const m = line.match(/^## \d+\. \[(.*)\]\(https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/);
      if (m) {
        current = { id: m[2], title: m[1].replace(/\\([\\[\]])/g, "$1"), verdict: null };
        picks.push(current);
      }
      continue;
    }
    const v = line.match(/^Verdict:\s*(.*)$/);
    if (v && current) {
      const said = v[1].trim().toLowerCase();
      current.verdict = said && said !== VERDICT_TEMPLATE && said !== "tap it in laterlist" ? said : null;
    }
  }
  return { week, picks };
}

export function outputPaths(dir, week) {
  for (let n = 1; ; n++) {
    const name = n === 1 ? week : `${week} (${n})`;
    const md = path.join(dir, `${name}.md`);
    const html = path.join(dir, `${name}.html`);
    if (!fs.existsSync(md) && !fs.existsSync(html)) return { md, html };
  }
}

export function pastPicks(dir, { now = new Date(), weeks = 8 } = {}) {
  if (!fs.existsSync(dir)) return [];
  const cutoff = new Date(`${weekId(now)}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - weeks * 7);
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})( \(\d+\))?\.md$/);
    if (!m || new Date(`${m[1]}T00:00:00`) < cutoff) continue;
    const { picks } = parsePicksNote(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const p of picks) out.push({ week: m[1], ...p });
  }
  return out;
}
