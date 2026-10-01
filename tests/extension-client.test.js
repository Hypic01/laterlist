import { afterEach, describe, expect, it } from "vitest";
import { createExtensionClient } from "../web/src/extension.js";

const fakeRuntime = () => ({
  lastError: undefined,
  sendMessage(_id, _message, callback) { callback({ ok: true, version: "9.9.9" }); },
});

describe("extension client", () => {
  const original = globalThis.chrome;
  afterEach(() => { globalThis.chrome = original; });

  it("finds an extension installed after the page loaded", async () => {
    delete globalThis.chrome;
    const client = createExtensionClient({ extensionIds: ["abc"] });
    expect((await client.detect()).present).toBe(false);
    // Chrome exposes chrome.runtime once an externally_connectable extension exists.
    globalThis.chrome = { runtime: fakeRuntime() };
    const found = await client.detect();
    expect(found.present).toBe(true);
    expect(found.version).toBe("9.9.9");
  });
});
