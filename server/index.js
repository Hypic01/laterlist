// Long-running entrypoint (local dev, Railway). Vercel uses api/index.js.
import path from "node:path";
import fs from "node:fs";
import express from "express";
import { buildApp, repoRoot } from "./boot.js";

const { app, worker, config } = await buildApp();

// ---- static site (landing at /, app at /app) ----
const webDist = path.join(repoRoot, "web", "dist");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(["/app", "/app/*path"], (req, res) => res.sendFile(path.join(webDist, "app", "index.html")));
  // Unknown pages get the designed 404 (Vercel serves the same file for its static misses).
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.status(404).sendFile(path.join(webDist, "404.html"));
  });
} else {
  app.get("/", (req, res) => res.type("text/plain").send("laterlist API. Frontend not built — run: npm run build:web"));
}

app.listen(config.port, () => {
  console.log(`laterlist listening on http://localhost:${config.port}`);
});
worker?.start();
