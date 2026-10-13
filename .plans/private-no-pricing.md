# Private Laterlist (owner-only, no pricing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only Joon can sign in to Laterlist, and every trace of pricing, plans, limits and billing is gone.

**Architecture:** An owner lock in `server/auth.js` refuses non-owners before a user row is created (JWT and API-token paths). Billing code and its dependencies are deleted. Plan branches collapse to one safety cap (`libraryCap`). The web app loses its upgrade surfaces, gains a "private" screen, and the landing page becomes a plain sign-in page.

**Tech Stack:** Node 22 ESM, Express, vitest + PGlite + supertest, React (Vite), static HTML landing.

**Spec:** `docs/superpowers/specs/2026-10-12-private-no-pricing-design.md` (read it first).

**Who does what:** Tasks 1 to 5 = Codex (GPT-6 Sol medium) in this worktree, code + tests + commits only, no network. Task 6 = Claude (Vercel env, review, push, PR, deploy check).

**Working directory:** `/Users/joonwoopark/projects/laterlist-private` (branch `chore/private-no-pricing`, from `origin/main` at 081aba5). Never touch `/Users/joonwoopark/projects/laterlist` (Joon's main checkout).

## Global Constraints

- Owner lock: `ownerEmails` from `OWNER_EMAILS`, else `ADMIN_EMAILS`, lowercased. Active when non-empty, or in production (`config.serverless && !config.devFakeAuth`). Refusal = HTTP 403 with body exactly `{ "error": "This Laterlist is private." }`. Checked before `db.upsertUser`.
- `createAuth` stays backward compatible: with no `ownerEmails` and `lockWhenEmpty` false it behaves exactly as today (existing auth tests must pass unchanged).
- One safety cap: `libraryCap` from `LIBRARY_CAP`, default 25000. No other caps, quotas or plan checks.
- Keep: `BUDGET_USD` kill switch, worker invariants (`FOR UPDATE SKIP LOCKED`, chunking, crash re-adoption), `YOUTUBE_REMOVAL`, the old domain, all DB columns (no migration, no data deletion).
- Do not touch: `extension/`, `collector/`, `scripts/watch-picks*`, sorting rules (`server/classify.js` RULES, `server/jev.js` JEV_CRITERIA, `docs/sorting-rubric.md`).
- Copy: no em or en dashes in any new user-facing text.
- Design tokens: `web/src/styles.css` and the landing's inline token block are unchanged; new CSS uses existing tokens only.
- `npm test` must be green before every commit, except the known Codex-sandbox `listen EPERM` failures in untouched route tests (report their count). Never weaken a test to pass; delete or rewrite a test only when it asserted the removed pricing behavior, and list each one in your report.
- Never commit `.env*`.

## Review Focus

1. **A stranger signs in with Google.** They get the private screen and no `users` row is created. (Task 1 tests)
2. **Production deploy without `OWNER_EMAILS`.** Everyone is refused and the log says why; nobody silently gets in. (Task 1 test `refuses everyone when locked with no owners`)
3. **The extension's import token belongs to a non-owner.** Refused with the same 403. (Task 1 token test)
4. **A library already above 1,000 videos.** Imports keep storing up to 25,000; nothing says "plan". (Task 3 importer test)
5. **TL;DR after many uses this month.** Never 402. (Task 3 summaries test)

---

### Task 1: Owner lock

**Files:**
- Modify: `server/config.js`, `server/auth.js`, `server/boot.js`
- Create: `tests/owner-lock.test.js`

**Interfaces:**
- Produces: `config.ownerEmails: string[]`, `config.libraryCap: number`; `createAuth({ verify, db, adminEmails, ownerEmails = [], lockWhenEmpty = false })`.

- [x] **Step 1: Write the failing tests.** Create `tests/owner-lock.test.js`:

```js
import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createAuth, fakeVerifier, hashToken } from "../server/auth.js";
import { loadConfig } from "../server/config.js";
import { testDb } from "./helpers.js";

async function appWith(opts) {
  const { db, pg } = await testDb();
  const auth = createAuth({ verify: fakeVerifier(), db, ...opts });
  const app = express();
  app.get("/whoami", auth.required, (req, res) => res.json(req.user));
  app.get("/tok", auth.importToken("imports"), (req, res) => res.json(req.user));
  return { app, db, pg };
}

const STRANGER = "33333333-3333-4333-a333-333333333333";
const OWNER = "44444444-4444-4444-a444-444444444444";

describe("owner lock", () => {
  it("lets an owner in (case-insensitive)", async () => {
    const { app } = await appWith({ ownerEmails: ["Joon@Test.dev"] });
    const res = await request(app).get("/whoami").set("Authorization", "Bearer dev:joon@test.dev").expect(200);
    expect(res.body.email).toBe("joon@test.dev");
  });

  it("refuses a non-owner with 403 and creates no user row", async () => {
    const { app, pg } = await appWith({ ownerEmails: ["joon@test.dev"] });
    const res = await request(app).get("/whoami").set("Authorization", "Bearer dev:stranger@test.dev").expect(403);
    expect(res.body).toEqual({ error: "This Laterlist is private." });
    const { rows } = await pg.query("SELECT count(*)::int AS n FROM users WHERE email = $1", ["stranger@test.dev"]);
    expect(rows[0].n).toBe(0);
  });

  it("refuses a token that belongs to a non-owner", async () => {
    const { app, db } = await appWith({ ownerEmails: ["joon@test.dev"] });
    await db.upsertUser({ id: STRANGER, email: "stranger@test.dev" });
    await db.createApiToken(STRANGER, { tokenHash: hashToken("wll_stranger"), scope: "imports", label: "t" });
    const res = await request(app).get("/tok").set("X-Import-Token", "wll_stranger").expect(403);
    expect(res.body).toEqual({ error: "This Laterlist is private." });
  });

  it("lets an owner's token through", async () => {
    const { app, db } = await appWith({ ownerEmails: ["joon@test.dev"] });
    await db.upsertUser({ id: OWNER, email: "joon@test.dev" });
    await db.createApiToken(OWNER, { tokenHash: hashToken("wll_owner"), scope: "imports", label: "t" });
    const res = await request(app).get("/tok").set("X-Import-Token", "wll_owner").expect(200);
    expect(res.body.email).toBe("joon@test.dev");
  });

  it("refuses everyone when locked with no owners (production)", async () => {
    const { app } = await appWith({ ownerEmails: [], lockWhenEmpty: true });
    await request(app).get("/whoami").set("Authorization", "Bearer dev:joon@test.dev").expect(403);
  });

  it("is open with no owners and no lock (local dev)", async () => {
    const { app } = await appWith({});
    await request(app).get("/whoami").set("Authorization", "Bearer dev:anyone@test.dev").expect(200);
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
```

If `db.createApiToken`'s second argument uses different key names, read `server/db.js` (around line 66) and match it in the test; do not change `db.js`.

- [x] **Step 2: Run to verify failure.** `npx vitest run tests/owner-lock.test.js` → FAIL (403 expectations get 200; `ownerEmails` undefined).

- [x] **Step 3: Implement.**

In `server/config.js`, inside the returned object next to `adminEmails`, add:

```js
    // Private tool (2026-10-12): only these emails may sign in. Falls back to
    // ADMIN_EMAILS when OWNER_EMAILS is unset. Empty in production refuses everyone.
    ownerEmails: (env.OWNER_EMAILS || env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    // Safety limit on stored videos (not a plan): default is the old fair-use number.
    libraryCap: Number(env.LIBRARY_CAP) || 25000,
```

In `server/auth.js`, change `createAuth` to:

```js
export function createAuth({ verify, db, adminEmails = [], ownerEmails = [], lockWhenEmpty = false }) {
  const admins = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const owners = new Set(ownerEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const locked = owners.size > 0 || lockWhenEmpty;
  const PRIVATE = { error: "This Laterlist is private." };
  let warned = false;

  // Laterlist is a private tool: only owners get in, checked before any
  // user row is created. Locked with no owners refuses everyone, loudly.
  function isOwner(email) {
    if (!locked) return true;
    if (!owners.size && !warned) {
      warned = true;
      console.error("[auth] OWNER_EMAILS is not set: this private Laterlist refuses every sign-in");
    }
    return owners.has(String(email || "").toLowerCase());
  }
```

In `required`, after the `invalid token claims` check and before `db.upsertUser`, add:

```js
    if (!isOwner(claims.email)) return res.status(403).json(PRIVATE);
```

In `importToken`, after `if (!user) return ...` and before building `req.user`, add:

```js
      if (!isOwner(user.email)) return res.status(403).json(PRIVATE);
```

In `server/boot.js`, change the `createAuth` call to:

```js
  const auth = createAuth({
    verify,
    db,
    adminEmails: config.adminEmails,
    ownerEmails: config.ownerEmails,
    lockWhenEmpty: config.serverless && !config.devFakeAuth,
  });
```

- [ ] **Step 4: Run.** `npx vitest run tests/owner-lock.test.js tests/auth.test.js` → PASS (auth.test.js unchanged).
- [ ] **Step 5: Full suite + commit.** `npm test`, then `git add server/config.js server/auth.js server/boot.js tests/owner-lock.test.js && git commit -m "feat(auth): private Laterlist, owner-only sign-in"`.

---

### Task 2: Remove billing

**Files:**
- Delete: `server/billing.js`, `tests/billing.test.js`
- Modify: `server/boot.js`, `server/app.js`, `server/config.js`, `package.json`, `package-lock.json`

- [x] **Step 1:** In `server/boot.js` remove the `createBilling` import, the `let billing = null` block that checks the Polar env, and the `billing` property passed to `createApp`.
- [x] **Step 2:** In `server/app.js` remove the `billing` parameter, the `/api/billing/webhook` mount (and the comment about mounting before `express.json`), and the `/api/billing/checkout` and `/api/billing/portal` routes. Update the file's header comment so it no longer mentions billing or freemium.
- [x] **Step 3:** In `server/config.js` remove the five `polar*` keys and their comment.
- [ ] **Step 4:** Remove `@polar-sh/sdk` and `standardwebhooks` from `package.json` dependencies. Do not run `npm install` (no network). Instead edit `package-lock.json` by removing those two entries from the root `packages[""].dependencies` block and their `node_modules/@polar-sh/sdk` and `node_modules/standardwebhooks` package entries (plus any of their transitive entries that nothing else depends on, if you can determine that with certainty; if not, leave transitive entries). Claude re-runs `npm install` outside the sandbox to normalize the lockfile.
- [x] **Step 5:** Delete `server/billing.js` and `tests/billing.test.js`. Remove any other test cases that only exercised billing routes (grep `tests/` for `billing`), listing each in the report.
- [ ] **Step 6: Verify.** `grep -rniE "polar|billing|standardwebhooks" server tests package.json` returns nothing (except unrelated words; report any hit you keep). `npm test` green.
- [ ] **Step 7: Commit.** `git commit -am "chore: remove billing (Laterlist is private)"` (include the deletions with `git add -A server tests package.json package-lock.json` first).

---

### Task 3: Remove plans and limits (server)

**Files:**
- Modify: `server/config.js`, `server/importer.js`, `server/app.js`, any server file that branches on plan (`grep -rnE "betaPro|isPro|plan === .pro.|freeVideoCap|proVideoCap|freeSummaryQuota|betaAllowlist" server`)
- Modify tests that asserted plan behavior: start from `grep -lnE "betaPro|plan|quota|402|videoCap|freeVideoCap|proVideoCap|BETA_" tests`

- [x] **Step 1: Write the failing tests** (add to the existing files that cover these areas, matching their setup style):
  - Importer: a user with no plan imports 1,500 videos and all 1,500 are stored (`added` 1500, `capped` 0); with `libraryCap` set to 100 in the test config, 150 imported stores 100 and reports `capped` 50.
  - Summaries: a user who already has 150 summaries this month gets a TL;DR, never a 402.
  - `/api/me`: the response has none of `plan`, `betaPro`, `summaryQuota`, `summariesUsed`, `videoCap`, `proEndsAt`, `proInterval`, and still has `id`, `email`, `isAdmin`, `counts`, `lastImportAt`, `removeFromYoutube`, `youtubeRemovalAvailable`.
- [x] **Step 2: Run them** and confirm they fail for the right reason.
- [x] **Step 3: Implement.**
  - `server/config.js`: remove `betaProForAll`, `freeVideoCap`, `proVideoCap`, `freeSummaryQuota`, `betaAllowlist` and the tier comment above them.
  - `server/importer.js`: remove `isPro` and the beta allowlist check; store with `config.libraryCap`; start jobs with a single tier value (pass `"pro"` if the worker's job API still requires a tier argument, and leave a one-line comment that tiers are vestigial). Update the file's header comment.
  - `server/app.js`: in `/api/me` drop the removed fields and the `countSummariesThisMonth` call; in the summary route drop the `bypass` / quota / 402 block and any `summaryQuota` in responses.
  - Any other plan branch the grep finds: collapse to the always-allowed path.
- [x] **Step 4: Update existing tests** that asserted free caps, quotas, 402s, `betaPro` or plan fields: rewrite them to the new behavior or delete them if they only tested removed behavior. List every changed or deleted test in your report.
- [ ] **Step 5: Verify.** `grep -rnE "betaPro|isPro|freeVideoCap|proVideoCap|freeSummaryQuota|betaAllowlist|BETA_PRO|BETA_ALLOWLIST" server tests` returns nothing. `npm test` green.
- [ ] **Step 6: Commit.** `git commit -am "chore: one safety cap, no plans or quotas"`.

---

### Task 4: Web app

**Files:**
- Delete: `web/src/components/UpgradeBand.jsx`
- Modify: `web/src/App.jsx`, `web/src/components/Settings.jsx`, `web/src/components/VideoDetail.jsx`, `web/src/api.js`, `web/src/styles.css`
- Create: `web/src/components/PrivateScreen.jsx`
- Modify tests: the web tests that reference Upgrade, plan, quota or betaPro (start from `grep -lnE "Upgrade|betaPro|plan|quota|videoCap" tests`)

- [x] **Step 1: Write the failing tests** (match the existing component test style, e.g. `tests/video-detail.test.js`, `tests/settings-removal.test.js`):
  - Settings renders no "Plan" heading and no "Upgrade to Pro" button for a `me` without plan fields.
  - VideoDetail renders no upgrade card and no quota text.
  - `PrivateScreen` renders "This Laterlist is private." and a Sign out button that calls its `onSignOut` prop.
- [x] **Step 2: Implement.**
  - Create `web/src/components/PrivateScreen.jsx`:

```jsx
export default function PrivateScreen({ onSignOut }) {
  return (
    <div className="empty-hero">
      <h2>This Laterlist is private.</h2>
      <p>Only its owner can sign in.</p>
      <button className="btn btn--ghost" onClick={onSignOut}>Sign out</button>
    </div>
  );
}
```

  - `web/src/App.jsx`: where `/api/me` is loaded, if the request fails with status 403 and error `This Laterlist is private.`, render `<PrivateScreen onSignOut={...} />` using the app's existing sign-out function (find it; do not write a new auth flow). Remove the `UpgradeBand` import and render, the `?upgraded=1` effect and toast, `atCap` and every `me.plan` / `me.videoCap` use. Replace the capped message with `${capped.toLocaleString()} older videos skipped, your library is full` and the empty-board paragraph's last sentence ("Your newest ... sort free.") by nothing.
  - `Settings.jsx`: remove the Plan block, `managePlan`, `upgrade`, and their imports.
  - `VideoDetail.jsx`: remove the upgrade card, its state (`upgradeOpen`, `upgradeBusy`, `upgradeCardRef`), and any quota or 402 messaging; a failed TL;DR shows the server's error text as today.
  - `api.js`: remove `checkoutUrl` and `portalUrl`.
  - `styles.css`: remove the UpgradeBand and upgrade-card rules (only those).
- [x] **Step 3: Update web tests** that asserted the removed UI; list each.
- [ ] **Step 4: Verify.** `grep -rniE "upgrade|betaPro|checkoutUrl|portalUrl|summaryQuota|videoCap|me\.plan" web/src` returns nothing. `npm test` green. `npm run build:web` succeeds.
- [ ] **Step 5: Commit.** `git commit -am "chore(web): no upgrade surfaces, private screen"` (add the new and deleted files with `git add -A web/src tests`).

---

### Task 5: Landing, legal pages, docs

**Files:**
- Modify: `web/index.html`, `web/public/privacy.html`, `web/public/terms.html`, `README.md`, `AGENTS.md`

- [x] **Step 1: Landing.** In `web/index.html`:
  - Keep `<head>` (meta, fonts, theme guard script, token block, styles) as is.
  - In `<nav>`, remove the `Pricing` link. Keep the seal, wordmark, "for YouTube", theme toggle and the Sign in button.
  - Replace everything between `</nav>` and `<footer>` with:

```html
    <header class="hero">
      <h1>Your private Laterlist.</h1>
      <div class="cta">
        <a class="btn btn-primary" href="/app?signin=1">Sign in</a>
      </div>
    </header>
```

  - Footer: keep Privacy, Terms and Sign in; remove Feedback.
  - Scripts at the end: keep the theme toggle code. Remove the GSAP `<script src>` tag and any animation code that targets removed elements (`.frame`, `.reveal`, sections). Leave no code that queries elements that no longer exist without a null check.
  - Remove CSS rules that only styled removed sections (pricing, frame, how, privacy section) if you can identify them with certainty; leave shared rules.
- [x] **Step 2: Legal pages.** `privacy.html`: remove the "Payment status" bullet. `terms.html`: remove the "Pro subscription" heading and its list. Change nothing else.
- [x] **Step 3: Docs.** `README.md` and `AGENTS.md`: describe Laterlist as a private, single-user tool for Joon; remove freemium, Pro, beta pricing, Polar and Stripe facts; document `OWNER_EMAILS` (falls back to `ADMIN_EMAILS`; empty in production refuses everyone) and `LIBRARY_CAP` (default 25000). Keep every other fact.
- [ ] **Step 4: Verify.** `grep -niE "pricing|\\$4|/month|subscription|refund|pro plan|upgrade" web/index.html web/public/terms.html web/public/privacy.html` shows nothing about paid plans (the privacy page's "YouTube subscriptions" data bullet is fine). `npm test` green; `npm run build:web` succeeds.
- [ ] **Step 5: Commit.** `git commit -am "chore: plain sign-in landing, no pricing in legal pages or docs"`.

**Codex stops here and reports:** commit hashes, test totals, the `listen EPERM` count if any, every test changed or deleted with the reason, and any deviation from this plan.

---

### Task 6: Claude: env, review, ship

- [ ] **Step 1:** Outside the sandbox: `npm install` in this worktree to normalize `package-lock.json`, then `npm test` (expect all green, no EPERM) and `npm run build:web`. Commit the lockfile if it changed.
- [ ] **Step 2:** Review the diff against this plan and the spec (`git diff origin/main`), especially: lock checked before `upsertUser`; no plan branch left; landing script has no dangling selectors.
- [ ] **Step 3:** Dev check in the built-in browser: `DEV_FAKE_AUTH=1 FAKE_LLM=1 npm start` in this worktree; landing shows only the sign-in; the app has no pricing in the board, Settings or video detail; no console errors.
- [ ] **Step 4:** Set the production owner before merge: `printf '%s' 'doldorijw@gmail.com' | vercel env add OWNER_EMAILS production` (project `watch-later-web`). Confirm with `vercel env ls production | grep OWNER_EMAILS`.
- [ ] **Step 5:** Push, open the PR, and after Joon OKs, merge (squash). Then check production: the landing page has no pricing; Joon signs in and sees his board.

## Definition of Done

1. `npm test` green and `npm run build:web` passes.
2. `grep -rniE "polar|upgrade to pro|betaPro|BETA_PRO|checkoutUrl|summaryQuota" server web/src` finds nothing.
3. Owner lock tests pass (owner in, stranger 403 with no user row, stranger token 403, production-without-owners refuses all, dev open).
4. Production: `OWNER_EMAILS` set; landing is the plain sign-in; Joon signs in fine.

## Deviations

- Task 1 owner-lock tests invoke the auth middleware directly instead of Supertest routes because this sandbox rejects `listen` with `EPERM`. The same owner, token, status, body, and database assertions remain.

- Task 2 retains `node_modules/standardwebhooks` in `package-lock.json` because `@anthropic-ai/sdk` requires it. The direct dependency and Polar package entry were removed. Historical billing columns, migration names, and the DB persistence test remain because the plan forbids a migration or data deletion.

- Task 3 route and summary test files were updated as required, but their Supertest cases cannot pass in this sandbox because `listen` is denied. The new listener-free private-limits tests and watch-picks tests pass; Claude must run the changed route tests outside the sandbox.

- Task 4 targeted component tests and `build:web` pass. Full `npm test` still has only sandbox listener failures, including the Task 3 changed route files, so the strict changed-test gate remains unverified.

- Git could not create the index lock under the sandbox-protected main checkout metadata, so Tasks 1 to 5 remain uncommitted. No lock bypass was attempted.
- Task 5 followed the explicit instruction to keep the landing `<head>` and all other legal text unchanged. Those retained areas still say `1,000 videos sorted free, with 100 summaries a month` (landing metadata) and describe a free tier and paid liability (terms). Claude should resolve this conflict with the plan goal before shipping.
- `AGENTS.md` was absent in this worktree. A minimal file was created before Task 1 per the global instructions and updated with Task 5 documentation.
- Task 3 put the new importer, summary, and `/api/me` red/green cases in `tests/private-limits.test.js` rather than the existing Supertest files, because the required cases could not run through a listener in this sandbox. The existing plan assertions in those files were still updated.
- Task 4 added the React import omitted from the provided `PrivateScreen.jsx` snippet so this repository's Vitest JSX transform and web build can render it.
- The plan's named `superpowers:subagent-driven-development` and `superpowers:executing-plans` skills were not available in this session, so the numbered steps were executed directly without delegation.
