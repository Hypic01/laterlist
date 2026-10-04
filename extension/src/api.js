export class ExtensionApiError extends Error {
  constructor(code, message, status = 0, body = {}) {
    super(message);
    this.name = "ExtensionApiError";
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

function errorCode(status) {
  if (status === 400) return "BAD_IMPORT";
  if (status === 401) return "TOKEN_REJECTED";
  if (status === 403) return "ACCESS_DENIED";
  if (status >= 500) return "SERVER_ERROR";
  return "IMPORT_FAILED";
}

function endpointUrl(apiUrl, path) {
  const base = new URL(String(apiUrl || ""));
  if (!['http:', 'https:'].includes(base.protocol)) {
    throw new ExtensionApiError("INVALID_API_URL", "The saved server address is invalid.");
  }
  return new URL(path, base.origin).href;
}

function importsUrl(apiUrl) {
  return endpointUrl(apiUrl, "/api/imports");
}

function userMessage(value, fallback) {
  return String(value || fallback)
    .replace(/[—–]/g, ",")
    .replace(/\s+-\s+/g, ", ");
}

export function createExtensionApi({ fetch: fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is required");

  async function removalRequest({ apiUrl, token, path, method, body }) {
    let response;
    try {
      response = await fetchImpl(endpointUrl(apiUrl, path), {
        method,
        mode: "cors",
        credentials: "omit",
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          "X-Import-Token": token,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (error instanceof ExtensionApiError) throw error;
      throw new ExtensionApiError("NETWORK_ERROR", "Laterlist could not be reached.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ExtensionApiError(
        errorCode(response.status),
        userMessage(data.error, `Removal request failed with status ${response.status}.`),
        response.status,
        data,
      );
    }
    return data;
  }

  return {
    pendingRemovals({ apiUrl, token }) {
      return removalRequest({ apiUrl, token, path: "/api/youtube-removals", method: "GET" });
    },

    reportRemovals({ apiUrl, token, results }) {
      return removalRequest({
        apiUrl, token, path: "/api/youtube-removals/results", method: "POST", body: { results },
      });
    },

    async importVideos({ apiUrl, token, payload }) {
      let response;
      try {
        response = await fetchImpl(importsUrl(apiUrl), {
          method: "POST",
          mode: "cors",
          credentials: "omit",
          headers: {
            "Content-Type": "application/json",
            "X-Import-Token": token,
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        if (error instanceof ExtensionApiError) throw error;
        throw new ExtensionApiError("NETWORK_ERROR", "Laterlist could not be reached.");
      }

      const body = await response.json().catch(() => ({}));
      if (response.status === 409 || response.status === 429) {
        return {
          ok: true,
          skipped: true,
          status: response.status,
          reason: response.status === 409 ? "SORT_RUNNING" : "RATE_LIMITED",
          added: 0,
          duplicates: 0,
          jobId: null,
          willClassify: 0,
          locked: 0,
        };
      }
      if (!response.ok) {
        throw new ExtensionApiError(
          errorCode(response.status),
          userMessage(body.error, `Import failed with status ${response.status}.`),
          response.status,
          body,
        );
      }
      return { ok: true, ...body };
    },
  };
}
