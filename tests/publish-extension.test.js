import { describe, expect, it, vi } from "vitest";
import { createPublisher, ITEM_ID, runCli } from "../scripts/publish-extension.js";

const env = {
  CWS_CLIENT_ID: "dummy-client",
  CWS_CLIENT_SECRET: "dummy-secret",
  CWS_REFRESH_TOKEN: "dummy-refresh",
  CWS_PUBLISHER_ID: "dummy-publisher",
};
const token = "dummy-access";
const zip = Buffer.from("dummy-zip");
const zipPath = "/tmp/dummy-extension.zip";
const resource = `publishers/dummy-publisher/items/${ITEM_ID}`;
const itemUrl = `https://chromewebstore.googleapis.com/v2/${resource}`;
const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });

function setup(responses = [reply({ access_token: token }), reply({ uploadState: "SUCCEEDED" }), reply({ state: "PENDING_REVIEW" })]) {
  const fetch = vi.fn(async () => {
    if (!responses.length) throw new Error("Unexpected fetch call");
    return responses.shift();
  });
  const readFile = vi.fn(async () => zip);
  const log = vi.fn();
  const wait = vi.fn(async () => {});
  const publisher = createPublisher({ fetch, env, readFile, log, wait });
  return { publisher, fetch, readFile, log, wait };
}

describe("Chrome Web Store API v2 publisher", () => {
  it("names every missing variable before any fetch or build", async () => {
    const fetch = vi.fn();
    const build = vi.fn();
    const readFile = vi.fn();
    await expect(runCli({ args: [], env: {}, fetch, build, readFile })).rejects.toThrow(
      "Missing required environment variables: CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_PUBLISHER_ID",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
  });

  it("requires publisher ID even when OAuth credentials are provided", () => {
    const fetch = vi.fn();
    expect(() => createPublisher({ fetch, env: { ...env, CWS_PUBLISHER_ID: "   " } })).toThrow("CWS_PUBLISHER_ID");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends token, raw zip upload, and review submission in order", async () => {
    const { publisher, fetch, readFile } = setup();
    await expect(publisher.run(zipPath)).resolves.toEqual({ state: "PENDING_REVIEW" });
    expect(readFile).toHaveBeenCalledWith(zipPath);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://oauth2.googleapis.com/token",
      `https://chromewebstore.googleapis.com/upload/v2/${resource}:upload`,
      `${itemUrl}:publish`,
    ]);
    const tokenRequest = fetch.mock.calls[0][1];
    expect(tokenRequest.method).toBe("POST");
    expect(Object.fromEntries(tokenRequest.body)).toEqual({
      client_id: env.CWS_CLIENT_ID,
      client_secret: env.CWS_CLIENT_SECRET,
      refresh_token: env.CWS_REFRESH_TOKEN,
      grant_type: "refresh_token",
    });
    const uploadRequest = fetch.mock.calls[1][1];
    expect(uploadRequest.method).toBe("POST");
    expect(uploadRequest.headers).toEqual({ Authorization: `Bearer ${token}`, "Content-Type": "application/zip" });
    expect(uploadRequest.body).toBe(zip);
    const publishRequest = fetch.mock.calls[2][1];
    expect(publishRequest.method).toBe("POST");
    expect(publishRequest.headers.Authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(publishRequest.body)).toEqual({ publishType: "DEFAULT_PUBLISH", skipReview: false });
  });

  it.each(["FAILED", "FAILURE", "NOT_FOUND", "UPLOAD_STATE_UNSPECIFIED", undefined])(
    "blocks submission after upload state %s and surfaces the response", async (uploadState) => {
      const { publisher, fetch } = setup([
        reply({ access_token: token }), reply({ uploadState, detail: "package validation failed" }),
      ]);
      await expect(publisher.run(zipPath)).rejects.toThrow("package validation failed");
      await expect(publisher.publish()).rejects.toThrow("successful upload is required");
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("surfaces item errors even in a nominally successful upload", async () => {
    const { publisher, fetch } = setup([
      reply({ access_token: token }),
      reply({ uploadState: "SUCCEEDED", itemError: [{ error_detail: "Invalid manifest version" }] }),
    ]);
    await expect(publisher.run(zipPath)).rejects.toThrow("Invalid manifest version");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["IN_PROGRESS", "UPLOAD_IN_PROGRESS"])("polls %s before submitting", async (uploadState) => {
    const { publisher, fetch, wait } = setup([
      reply({ access_token: token }), reply({ uploadState }),
      reply({ lastAsyncUploadState: "IN_PROGRESS" }), reply({ lastAsyncUploadState: "SUCCEEDED" }),
      reply({ state: "PENDING_REVIEW" }),
    ]);
    await publisher.run(zipPath);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[2]).toEqual([
      `${itemUrl}:fetchStatus`,
      expect.objectContaining({ method: "GET", headers: { Authorization: `Bearer ${token}` } }),
    ]);
    expect(fetch.mock.calls[4][0]).toBe(`${itemUrl}:publish`);
  });

  it("blocks publishing if asynchronous processing fails", async () => {
    const { publisher, fetch } = setup([
      reply({ access_token: token }), reply({ uploadState: "IN_PROGRESS" }),
      reply({ lastAsyncUploadState: "FAILED", detail: "Invalid package" }),
    ]);
    await expect(publisher.run(zipPath)).rejects.toThrow("Invalid package");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("bounds polling and never publishes an unfinished upload", async () => {
    const { publisher, fetch, wait } = setup([
      reply({ access_token: token }), reply({ uploadState: "IN_PROGRESS" }),
      ...Array.from({ length: 30 }, () => reply({ lastAsyncUploadState: "IN_PROGRESS" })),
    ]);
    await expect(publisher.run(zipPath)).rejects.toThrow("did not succeed");
    expect(wait).toHaveBeenCalledTimes(30);
    expect(fetch).toHaveBeenCalledTimes(32);
  });

  it("surfaces non-2xx publish errors", async () => {
    const { publisher } = setup([
      reply({ access_token: token }), reply({ uploadState: "SUCCEEDED" }),
      reply({ error: { message: "Review already pending" } }, 409),
    ]);
    await expect(publisher.run(zipPath)).rejects.toThrow("HTTP 409");
  });

  it("surfaces non-JSON server errors and stops before publishing", async () => {
    const { publisher, fetch } = setup([
      reply({ access_token: token }), new Response("Service unavailable", { status: 503 }),
    ]);
    await expect(publisher.run(zipPath)).rejects.toThrow("Service unavailable");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not upload when the token response lacks a token", async () => {
    const { publisher, fetch } = setup([reply({})]);
    await expect(publisher.run(zipPath)).rejects.toThrow("missing access_token");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("prevents publishing without a successful upload and resets success for a new failed upload", async () => {
    const { publisher, fetch } = setup([
      reply({ access_token: token }), reply({ uploadState: "SUCCEEDED" }), reply({ uploadState: "FAILED" }),
    ]);
    await expect(publisher.publish()).rejects.toThrow("successful upload is required");
    await expect(publisher.upload(zipPath)).rejects.toThrow("getAccessToken");
    expect(fetch).not.toHaveBeenCalled();
    await publisher.getAccessToken();
    await publisher.upload(zipPath);
    await expect(publisher.upload(zipPath)).rejects.toThrow("FAILED");
    await expect(publisher.publish()).rejects.toThrow("successful upload is required");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("builds and validates the zip for --dry-run without network calls", async () => {
    const fetch = vi.fn();
    const build = vi.fn(async () => {});
    const log = vi.fn();
    const readFile = vi.fn(async (file) => {
      expect(build).toHaveBeenCalledTimes(1);
      return file.endsWith("manifest.json") ? '{"version":"0.0.1"}' : zip;
    });
    await runCli({ args: ["--dry-run"], env, fetch, build, readFile, log });
    expect(fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("extension/laterlist-0.0.1.zip"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining(ITEM_ID));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("No network calls"));
  });

  it("rejects an empty dry-run zip without requesting a token", async () => {
    const fetch = vi.fn();
    const publisher = createPublisher({ fetch, env, readFile: async () => Buffer.alloc(0) });
    await expect(publisher.run(zipPath, { dryRun: true })).rejects.toThrow("zip is empty");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not leak credentials or access tokens in successful logs", async () => {
    const { publisher, log } = setup([
      reply({ access_token: token }), reply({ uploadState: "SUCCEEDED" }),
      reply({ state: "PENDING_REVIEW", warningInfo: { warnings: [{ description: Object.values(env).join(" ") + ` ${token}` }] } }),
    ]);
    await publisher.run(zipPath);
    const logs = log.mock.calls.flat().join("\n");
    for (const secret of [...Object.values(env), token]) expect(logs).not.toContain(secret);
    expect(logs).toContain("[REDACTED]");
  });

  it("redacts credentials echoed in errors while preserving the store's reason", async () => {
    const { publisher, log } = setup([
      reply({ access_token: token }), reply({ error: { message: `Invalid package ${Object.values(env).join(" ")} ${token}` } }, 400),
    ]);
    let message;
    try { await publisher.run(zipPath); } catch (error) { message = error.message; }
    expect(message).toContain("Invalid package");
    expect(message).toContain("[REDACTED]");
    for (const secret of [...Object.values(env), token]) expect(message).not.toContain(secret);
    expect(log).not.toHaveBeenCalled();
  });

  it("redacts encoded OAuth secrets and network exceptions", async () => {
    const config = { ...env, CWS_CLIENT_SECRET: "dummy secret+value" };
    const fetch = vi.fn(async () => {
      throw new Error(`Request failed: ${encodeURIComponent(config.CWS_CLIENT_SECRET)} ${config.CWS_REFRESH_TOKEN}`);
    });
    const publisher = createPublisher({ fetch, env: config });
    await expect(publisher.getAccessToken()).rejects.toThrow("Request failed: [REDACTED] [REDACTED]");
  });
});
