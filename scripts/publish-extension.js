// Chrome Web Store API v2 (requires CWS_PUBLISHER_ID), verified against:
// https://developer.chrome.com/docs/webstore/using-api
// https://developer.chrome.com/docs/webstore/api/reference/rest/v2/media/upload
import { execFile } from "node:child_process";
import { readFile as fsReadFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ITEM_ID = "iggeklmapgdaknfdblkhefnfaflbojeg";
const requiredEnv = ["CWS_CLIENT_ID", "CWS_CLIENT_SECRET", "CWS_REFRESH_TOKEN", "CWS_PUBLISHER_ID"];
const execFileAsync = promisify(execFile);

function redactor(values) {
  return (message) => {
    let result = String(message);
    // Also redact values echoed by a server in a URL/form-encoded error.
    const secrets = values.filter(Boolean).flatMap((value) => [
      value, encodeURIComponent(value), new URLSearchParams({ value }).toString().slice(6),
    ]).sort((a, b) => b.length - a.length);
    for (const value of secrets) result = result.split(value).join("[REDACTED]");
    return result;
  };
}

export function createPublisher({
  fetch = globalThis.fetch,
  env = process.env,
  readFile = fsReadFile,
  log = console.log,
  wait = sleep,
} = {}) {
  const config = Object.fromEntries(requiredEnv.map((name) => [name, env[name]]));
  const missing = requiredEnv.filter((name) => typeof config[name] !== "string" || !config[name].trim());
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

  const secrets = Object.values(config);
  const safe = redactor(secrets);
  const resource = `publishers/${encodeURIComponent(config.CWS_PUBLISHER_ID)}/items/${ITEM_ID}`;
  const itemUrl = `https://chromewebstore.googleapis.com/v2/${resource}`;
  let accessToken;
  let uploaded = false;

  async function request(label, url, options) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30000),
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch {
        throw new Error(`${label} (HTTP ${response.status}): ${text || "empty response"}`);
      }
      if (typeof data?.access_token === "string") secrets.push(data.access_token);
      if (!response.ok || data.error || data.errors || data.itemError) {
        throw new Error(`${label} (HTTP ${response.status}): ${JSON.stringify(data)}`);
      }
      return data;
    } catch (error) {
      throw new Error(safe(`${label}: ${error.message}`));
    }
  }

  async function getAccessToken() {
    const data = await request("OAuth token request failed", "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.CWS_CLIENT_ID,
        client_secret: config.CWS_CLIENT_SECRET,
        refresh_token: config.CWS_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });
    if (typeof data.access_token !== "string" || !data.access_token.trim()) {
      throw new Error("OAuth token response is missing access_token");
    }
    accessToken = data.access_token;
    secrets.push(accessToken);
    return accessToken;
  }

  async function upload(zipPath) {
    uploaded = false;
    if (!accessToken) throw new Error("Call getAccessToken() before uploading");
    const zip = await readFile(zipPath);
    let result = await request("Extension upload failed", `https://chromewebstore.googleapis.com/upload/v2/${resource}:upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/zip" },
      body: zip,
    });
    let state = result.uploadState;
    // The upload guide also uses UPLOAD_IN_PROGRESS; the enum reference uses
    // IN_PROGRESS. Neither is success. Poll a bounded number of times.
    for (let attempt = 0; ["IN_PROGRESS", "UPLOAD_IN_PROGRESS"].includes(state) && attempt < 30; attempt++) {
      await wait(2000);
      result = await request("Upload status request failed", `${itemUrl}:fetchStatus`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      state = result.lastAsyncUploadState;
    }
    if (state !== "SUCCEEDED") {
      throw new Error(safe(`Extension upload did not succeed: ${JSON.stringify(result)}`));
    }
    uploaded = true;
    log("Extension upload succeeded.");
    return result;
  }

  async function publish() {
    if (!uploaded) throw new Error("A successful upload is required before publishing");
    const result = await request("Extension publish failed", `${itemUrl}:publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ publishType: "DEFAULT_PUBLISH", skipReview: false }),
    });
    log(safe(`Extension submitted for review: ${JSON.stringify(result)}`));
    return result;
  }

  async function run(zipPath, { dryRun = false } = {}) {
    if (dryRun) {
      const zip = await readFile(zipPath);
      if (!zip.length) throw new Error("Extension zip is empty");
      // Only local artifact metadata goes here, never configuration or tokens.
      // Redacting placeholder letters (x/y/z) would corrupt the displayed path.
      log(`Dry run: would upload ${zipPath} (${zip.length} bytes) to item ${ITEM_ID}, then submit for review. No network calls.`);
      return;
    }
    await getAccessToken();
    await upload(zipPath);
    return publish();
  }

  return { getAccessToken, upload, publish, run };
}

export async function runCli({
  args = process.argv.slice(2),
  env = process.env,
  fetch = globalThis.fetch,
  readFile = fsReadFile,
  log = console.log,
  build = async () => {
    const { stdout } = await execFileAsync(process.execPath, [path.join(root, "extension/build-extension.js")], {
      cwd: root,
      // Never allow WLL_DEV to turn publishing into a dev build or stale zip.
      env: { ...env, WLL_DEV: "0" },
    });
    log(stdout.trimEnd());
  },
} = {}) {
  if (args.some((arg) => arg !== "--dry-run")) throw new Error("Usage: node scripts/publish-extension.js [--dry-run]");
  // Validate before building, reading files, or requesting a token.
  const publisher = createPublisher({ fetch, env, readFile, log });
  await build();
  const manifest = JSON.parse(await readFile(path.join(root, "extension/manifest.json"), "utf8"));
  return publisher.run(path.join(root, `extension/laterlist-${manifest.version}.zip`), {
    dryRun: args.includes("--dry-run"),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runCli().catch((error) => {
    console.error(redactor(requiredEnv.map((name) => process.env[name]))(error.message));
    process.exitCode = 1;
  });
}
