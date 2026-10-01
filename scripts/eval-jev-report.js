// Turns an eval-jev JSON report into a local HTML page where a human judges
// each video. Accuracy only means something against a person's call, so the
// page shows both classifiers' picks side by side, puts the disagreements
// first (they decide the winner), and scores live as verdicts come in.
// Verdicts live in the page's localStorage and export as a --file labels JSON.
//
//   node scripts/eval-jev-report.js                 # newest report in spike/private
//   node scripts/eval-jev-report.js path/to/report.json

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(repoRoot, "spike", "private");

const input =
  process.argv[2] ||
  fs.readdirSync(dir).filter((f) => /^jev-eval-.*\.json$/.test(f)).sort().map((f) => path.join(dir, f)).pop();
if (!input) {
  console.error("no report found; run scripts/eval-jev.js first");
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(input, "utf8"));

// The page only needs the per-video picks and the run stats.
const data = {
  ranAt: report.ranAt,
  source: report.source,
  fakes: report.fakes,
  // Labels from the user (db re-files, their own labels file) count as verdicts;
  // the bundled fixture labels are mine, so the user judges those fresh.
  prefill: !report.source.includes("fixture"),
  haiku: report.haiku,
  jev: report.jev,
  videos: report.videos.map((v) => ({
    id: v.id,
    title: v.title,
    channel: v.channel,
    duration: v.duration_seconds ?? null,
    age: v.published_text ?? null,
    label: v.label,
    haiku: v.haiku && { category: v.haiku.category, confidence: v.haiku.confidence, reasoning: v.haiku.reasoning },
    jev: v.jev && { category: v.jev.category, confidence: v.jev.confidence },
  })),
};
const html = fs
  .readFileSync(path.join(repoRoot, "scripts", "eval-jev-report.html"), "utf8")
  .replace("/*__DATA__*/null", JSON.stringify(data).replace(/</g, "\\u003c"));
const out = input.replace(/\.json$/, ".html");
fs.writeFileSync(out, html);
console.log(out);
