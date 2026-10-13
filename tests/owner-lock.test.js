import { describe, it, expect } from "vitest";
import { createAuth, fakeVerifier, hashToken } from "../server/auth.js";
import { loadConfig } from "../server/config.js";
import { testDb } from "./helpers.js";

async function appWith(opts) {
  const { db, pg } = await testDb();
  const auth = createAuth({ verify: fakeVerifier(), db, ...opts });
  return { auth, db, pg };
}

async function invoke(middleware, headers) {
  const req = { headers: { authorization: headers.Authorization || "" }, get: (name) => headers[name] };
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await middleware(req, res, () => { res.body = req.user; });
  return res;
}

const STRANGER = "33333333-3333-4333-a333-333333333333";
const OWNER = "44444444-4444-4444-a444-444444444444";

describe("owner lock", () => {
  it("lets an owner in (case-insensitive)", async () => {
    const { auth } = await appWith({ ownerEmails: ["Joon@Test.dev"] });
    const res = await invoke(auth.required, { Authorization: "Bearer dev:joon@test.dev" });
    expect(res.statusCode).toBe(200);
    expect(res.body.email).toBe("joon@test.dev");
  });

  it("refuses a non-owner with 403 and creates no user row", async () => {
    const { auth, pg } = await appWith({ ownerEmails: ["joon@test.dev"] });
    const res = await invoke(auth.required, { Authorization: "Bearer dev:stranger@test.dev" });
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "This Laterlist is private." });
    const { rows } = await pg.query("SELECT count(*)::int AS n FROM users WHERE email = $1", ["stranger@test.dev"]);
    expect(rows[0].n).toBe(0);
  });

  it("refuses a token that belongs to a non-owner", async () => {
    const { auth, db } = await appWith({ ownerEmails: ["joon@test.dev"] });
    await db.upsertUser({ id: STRANGER, email: "stranger@test.dev" });
    await db.createApiToken(STRANGER, { tokenHash: hashToken("wll_stranger"), scope: "imports", label: "t" });
    const res = await invoke(auth.importToken("imports"), { "X-Import-Token": "wll_stranger" });
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "This Laterlist is private." });
  });

  it("lets an owner's token through", async () => {
    const { auth, db } = await appWith({ ownerEmails: ["joon@test.dev"] });
    await db.upsertUser({ id: OWNER, email: "joon@test.dev" });
    await db.createApiToken(OWNER, { tokenHash: hashToken("wll_owner"), scope: "imports", label: "t" });
    const res = await invoke(auth.importToken("imports"), { "X-Import-Token": "wll_owner" });
    expect(res.statusCode).toBe(200);
    expect(res.body.email).toBe("joon@test.dev");
  });

  it("refuses everyone when locked with no owners (production)", async () => {
    const { auth } = await appWith({ ownerEmails: [], lockWhenEmpty: true });
    const res = await invoke(auth.required, { Authorization: "Bearer dev:joon@test.dev" });
    expect(res.statusCode).toBe(403);
  });

  it("is open with no owners and no lock (local dev)", async () => {
    const { auth } = await appWith({});
    const res = await invoke(auth.required, { Authorization: "Bearer dev:anyone@test.dev" });
    expect(res.statusCode).toBe(200);
  });
});

describe("config", () => {
  it("OWNER_EMAILS wins over ADMIN_EMAILS, lowercased", () => {
    expect(loadConfig({ OWNER_EMAILS: "Joon@X.dev, b@x.dev", ADMIN_EMAILS: "admin@x.dev" }).ownerEmails)
      .toEqual(["joon@x.dev", "b@x.dev"]);
  });

  it("falls back to ADMIN_EMAILS, and libraryCap defaults to 25000", () => {
    const c = loadConfig({ ADMIN_EMAILS: "Admin@X.dev" });
    expect(c.ownerEmails).toEqual(["admin@x.dev"]);
    expect(c.libraryCap).toBe(25000);
    expect(loadConfig({ LIBRARY_CAP: "500" }).libraryCap).toBe(500);
  });
});
