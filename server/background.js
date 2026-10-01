// Background sorting for serverless deploys. Before this, a job only moved
// while the user's tab polled /api/jobs/current, so closing the tab stopped
// the sort. Now starting a job (or a poll that finds an idle one) kicks a run
// that works after the response is sent (waitUntil), and when a run nears the
// function's time limit with work left it hands off to a fresh invocation by
// calling the CRON_SECRET-protected /api/cron/advance. Leases keep any
// overlapping runs from working the same job; the hop cap bounds a runaway.

import { waitUntil as vercelWaitUntil } from "@vercel/functions";

export function createBackground({ worker, db, config, waitUntil = vercelWaitUntil, fetchImpl = fetch, log = () => {} }) {
  async function run(hop) {
    const worked = await worker.tick({ budgetMs: config.backgroundBudgetMs });
    if (!worked) return; // nothing due, or another run holds the lease
    const pending = await db.getJobsInState(["queued", "running"]);
    if (!pending.length) return;
    if (hop >= config.backgroundMaxHops) {
      log(`background: hop limit ${config.backgroundMaxHops} reached with ${pending.length} job(s) left`);
      return;
    }
    if (!config.cronSecret) {
      log("background: no CRON_SECRET, cannot hand off; polls and cron will finish the job");
      return;
    }
    const res = await fetchImpl(`${config.appUrl}/api/cron/advance`, {
      headers: { authorization: `Bearer ${config.cronSecret}`, "x-background-hop": String(hop + 1) },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) log(`background: hand-off answered ${res.status}`);
  }

  return {
    // Fire and forget: the caller has already answered (or is about to).
    kick(hop = 0) {
      waitUntil(run(hop).catch((e) => log(`background run failed: ${e.message}`)));
    },
  };
}
