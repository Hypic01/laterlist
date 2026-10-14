// Talks to Laterlist with the picks-scoped key. Every failure becomes a
// PicksApiError so the CLI can fall back to the local page.
export class PicksApiError extends Error {}

async function send(url, { apiToken, fetchImpl, method = "GET", body }) {
  if (!apiToken) throw new PicksApiError("PICKS_API_TOKEN is not set in .env.picks");
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { "content-type": "application/json", "x-import-token": apiToken },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new PicksApiError(`could not reach Laterlist: ${String(e?.message || e).split("\n")[0]}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new PicksApiError(`Laterlist said ${res.status}: ${data?.error || "no detail"}`);
  return data;
}

export function postPicks({ appUrl, apiToken, data, fetchImpl = globalThis.fetch }) {
  return send(`${appUrl}/api/picks`, { apiToken, fetchImpl, method: "POST", body: data });
}

export async function fetchHistory({ appUrl, apiToken, weeks = 8, fetchImpl = globalThis.fetch }) {
  const rows = await send(`${appUrl}/api/picks/history?weeks=${weeks}`, { apiToken, fetchImpl });
  if (!Array.isArray(rows)) throw new PicksApiError("Laterlist sent an unexpected history shape");
  return rows;
}
