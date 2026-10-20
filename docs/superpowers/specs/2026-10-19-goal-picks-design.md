# Goal picks: the mentor picks from all of YouTube, by goal

**Date:** 2026-10-19
**Status:** direction approved in chat by Joon; this written spec awaits his review
**Owner:** Joon (personal tool)
**Supersedes:** the picking rules in `2026-10-11-weekly-watch-picks-design.md` and the This week card content in `2026-10-12-picks-in-laterlist-design.md`. Both specs listed "recommending videos he never saved" as out of scope; this spec brings it in. Delivery (Monday Mac run, `POST /api/picks`, This week home, verdicts) stays as built.

## 3-second line

Laterlist opens on the few videos you most need this week for your goals, from anywhere on YouTube, and shows which saved videos they make unnecessary.

## Why

Joon, 2026-10-19: his Watch Later has many videos on the same topic (communication, for example). One great video can replace all of them, which saves the most time. And the video he needs most may not be saved at all: he is job hunting as a product designer, so a strong design interview video is worth more than anything in his list, even if he never saved one.

So the mentor stops asking "which 3 saved videos are best?" and asks "what does Joon need right now for his goals, and what is the best video on YouTube for that?" Watch Later becomes a source of candidates and a cleanup target, not the boundary.

The test is need, not interest. A design interview video passes because of the job goal. Valorant fails even though he likes it. A makeup tutorial fails both ways. Joon judges a pick by its title: if the title makes him think "I need this", the pick is right.

## Decisions (Joon, 2026-10-19)

| Question | Answer |
|---|---|
| Where picks come from | Anywhere on YouTube. Saved videos compete on equal terms. |
| Old 3 Watch Later picks | Replaced by goal picks. |
| How many | The mentor decides. Usually one per live goal, up to 3 for a goal when they are all genuinely good, zero when nothing passes. |
| Quality bar | Credible author, real information, relevant to him right now, things he can learn and act on. |
| Covers list | Each pick lists the saved videos it makes unnecessary. Joon chooses whether to remove them. |
| Remove control | Both a Remove all button and per-video control; Remove all matters most. |
| Layout | A: grouped by goal (mockup chosen in the browser companion). |
| Goals source | Both: the growth ladder in the vault and the mentor agent's goals. |

## How it works

```
Monday 08:00, Joon's Mac (watch-picks skill, unchanged schedule)
  1. Read goals     -> live goals (1 to 4), each with what he needs from it now
  2. Find candidates per goal
       a. YouTube search  (CLI search, about 10 per goal)
       b. his Watch Later (CLI list, matched to the goal, about 5 per goal)
  3. Shortlist per goal -> about 6, read transcripts
  4. Pick 0 to 3 per goal (five checks below)
  5. Covers per pick -> saved videos the pick makes unnecessary
  6. CLI post -> Laterlist This week, grouped by goal
```

### Step 1: live goals

Joon's mentor agent (`~/projects/personal-agent-tapnote`, loop v2 from 2026-10-18) already owns his goals. Its intake sets the 6-month picture and the top two goals, and the Friday meeting writes this week's ONE thing and three priorities to `state/week.json` and mirrors them into `성장 사다리.md`. So "both" means the run reads the agent's weekly file and the ladder. It never writes either one.

The run reads, in this order:

1. `state/week.json` in the agent's state folder (location in that repo's `AGENTS.md`), only when its `week_start` is this week's Monday. Its `priorities` and `one_thing` are the strongest signal.
2. `2. Areas/Mentor/성장 사다리.md`: "6개월 뒤의 나" and the top two goals (filled by the intake), "이번 주 우선순위 셋", and the Q4 quests.
3. The 7 newest `Days/` notes and recent `1. Projects/` and `2. Areas/Job/` notes, only to sharpen what he needs inside each goal. For example, he has moved past applications to interviews, so interview prep beats resume tips.
4. `CLI past` for verdicts.

**Live goals:** each of this week's priorities, from source 1 or else from the ladder's "이번 주 우선순위 셋", is mapped to the goal it serves, and the top two goals are added. There is no activity gate. The run keeps at most 4, ordered by this week's priorities first. For each it writes a goal name (short, in his words) and one line on what he needs from it right now. Goals a video cannot help with, like moving boxes, are dropped without comment.

**When the week is empty:** if neither this week's priorities nor the top two goals exist, the run uses the Q4 quests from the ladder, Joon's own words, and sets `notice` to "No plan for this week yet, so these follow your Q4 quests."

If even the Q4 quests are missing, the run posts zero picks with a `notice` saying so. It never invents goals.

### Step 2: candidates

- **YouTube search.** New CLI subcommand `search "<query>" [--limit 10]`. It runs yt-dlp `ytsearchN:<query>` with `--flat-playlist -J` and fixed arguments inside the CLI, the same safety pattern as `fetch-subs`. It returns id, title, channel, duration, view count, upload date. The skill writes 1 to 2 queries per goal, aimed at what he needs (for example "product design interview portfolio presentation"), never at his interests. Shorts (under 3 minutes) and videos over 2 hours are dropped by the CLI.
- **Watch Later.** `CLI list` as today, but the skill matches it per goal (the 3 subagents get the goal list instead of focus points). Music, Entertainment and Let it go rows stay excluded.

### Step 3 and 4: judge and pick

Shortlist about 6 per goal, preferring different channels, then read transcripts (cached, else `fetch-subs`). A pick must pass all five:

1. **Needed now.** It serves a live goal at his current stage: a new grad on OPT applying to product design roles. A great video aimed at senior designers or career switchers fails.
2. **Credible author.** The person has done the thing (working designer, hiring manager, recruiter at a real company), not a channel that only makes career content. The card names who they are in one line.
3. **Real information.** The transcript shows concrete steps, examples and stories. Hype, vague motivation and long intros fail. A strong title over a thin transcript fails.
4. **Actionable.** He can do something with it this week. The card states that action in one line ("Cut your portfolio walkthrough to 10 minutes"). Interesting but not actionable fails.
5. **Not a repeat, won't muddy.** His notes do not already cover it, and it does not argue against a settled decision of his without strong reason.

Views and likes only break ties. They never decide a pick alone.

Zero picks for a goal is a valid outcome. The page says "Nothing good enough this week" for that goal.

### Step 5: covers

For each pick, the mentor lists saved videos (from `CLI list`, any of the learn and watch rows) whose main content the pick already covers, judged on title, description and, when cached, transcript. A saved video is listed only when the pick clearly covers it or is clearly better on the same topic. When unsure, leave it out. A pick that itself comes from Watch Later can still cover other saved videos. Covers are capped at 20 per pick.

### Subtitle budget

`FETCH_BUDGET` goes from 8 per week to 24 per week (about 6 per goal across 4 goals), still enforced by the CLI with the existing spacing. On a 429, sign-in wall or budget hit, the run stops fetching and judges the rest on title, description and channel with `noTranscript: true`. A pick with `noTranscript` must pass check 2 on the channel alone and gets the line "Picked without reading the transcript" on its card. **Builder's call: 24.** Lower it if YouTube starts rate limiting.

## Payload

`pick_sets.payload` is jsonb, so no migration. The validator in `server/picks.js` changes to this shape:

```json
{
  "week": "2026-10-19",
  "notice": "",
  "goals": [
    {
      "name": "Land a product design job",
      "need": "Interviews are starting; presenting work out loud is the gap.",
      "picks": [
        {
          "id": "<11 char id>",
          "source": "youtube",
          "title": "...", "channel": "...", "durationSeconds": 2530,
          "author": "Senior product designer at a large tech company, runs hiring loops",
          "why": "...",
          "action": "Rewrite your portfolio walkthrough to 10 minutes.",
          "gets": ["...", "..."],
          "start": 370, "end": 1180,
          "noTranscript": false,
          "covers": ["<id>", "<id>"]
        }
      ],
      "empty": "Nothing good enough this week."
    }
  ],
  "closeButNo": [ { "id": "<id>", "goal": "<goal name>", "title": "...", "reason": "..." } ]
}
```

Validation rules:

- 0 to 4 goals; 0 to 3 picks per goal; `name` and `need` required and capped (60 and 200 characters).
- `source` is `youtube` or `saved`. For `saved`, the id must be in Joon's library (400 naming it otherwise). For `youtube`, `title`, `channel` and `durationSeconds` are required in the payload, since there is no library row to join.
- `author` and `action` required on every pick (capped at 120 and 160 characters).
- Every `covers` id must be in the library, not done or dismissed at post time, and not the pick itself. Unknown ids are dropped with a warning in the response, not a 400, so one stale id does not lose the week.
- The same video may not be picked twice in one set.
- Old flat payloads (`focus`, `picks`) still render, so past weeks keep working.

## This week screen (layout A)

- Eyebrow `Week of Oct 19`, title This week, `notice` when present.
- One section per goal: goal name in the display font, the "need" line small and muted, and a pick count on the right.
- **Pick card:** thumbnail (`hqdefault` by id), a source tag (`From YouTube` or `In your Watch Later`, mono pill, monochrome), title linking to YouTube at the best part, channel and length, the author line, "Why you, now", the action line, best-part chip, 2 or 3 gets, then the verdict buttons as today (Worth it, Not for me, Didn't watch). Category dot only for saved picks; YouTube picks have none, because color means category.
- **Covers block under the card:** "Covers N saved videos", open by default when N is 1 to 5, collapsed when more. Each row: title and a Leave it toggle that takes that video out of Remove all (client state only, nothing is saved). Button: `Remove all N` (N updates as rows are left out). Titles open the video's detail page.
- **Remove all:** new endpoint `POST /api/videos/dismiss` with `{ ids }` (up to 500), which runs the same `db.dismiss` per id and queues YouTube removals in one call when removal is allowed, exactly like the single dismiss. After success the block shows "Removed N. They leave your YouTube Watch Later next time Laterlist is open on your computer." (the existing copy) with an Undo for 10 seconds. Undo calls a new `POST /api/videos/restore` with `{ ids }`, which sets those rows back from `dismissed` to `scanned` and cancels their pending YouTube removals. The existing keep endpoint cannot do this, because it only touches `scanned` rows. If the extension already took a video off YouTube before Undo, the video comes back in Laterlist only, and the toast says "Back in Laterlist. 2 were already off YouTube."
- **Covered videos already removed** (or done) since the post: shown struck through and not counted.
- **Empty goal:** goal header plus the `empty` line.
- **Close, but no:** grouped under one collapsed block as today, each row tagged with its goal.
- **Phone:** same sections in one column; covers block collapsed by default; Remove all is full width with a 44px target.
- Design rules unchanged: tokens from `docs/design-system.md` only, no new colors, copy has no dashes.

## Verdicts

Same three buttons and table. For `saved` picks, Worth it and Not for me mark done as today. For `youtube` picks the verdict is saved only (there is no library row). The 8-week no-repeat rule reads `GET /api/picks/history`, which now returns youtube picks too (id, title, verdict), so the run skips any video picked in the last 8 weeks wherever it came from.

## Mac side changes

- `scripts/watch-picks/subs.mjs`: `FETCH_BUDGET` 24; new `search` function using the same `runYtDlp` wrapper.
- `scripts/watch-picks.mjs`: new `search` subcommand writing `WORK/search-<n>.json`; `post` and the local fallback page render the new shape (fallback page grouped by goal, covers as a plain list).
- `scripts/watch-picks/render.mjs`: vault note grouped by goal.
- `~/.claude/skills/watch-picks/SKILL.md`: rewritten steps 1 to 6 per this spec. "Exactly 3 picks" goes away. The shell allowlist stays the single `node .../watch-picks.mjs` entry plus `open`.
- After merge, move the runtime worktree: `git -C ~/projects/laterlist-runtime checkout --detach origin/main` (after a fetch). Without this, Monday keeps running the old logic.
- Memory and decision doc: update `laterlist-watch-picks` memory (the "Parked: recommending unsaved videos" line is now built) and add a decision doc in `1. Projects/Laterlist/`.

## Errors

| Case | Behavior |
|---|---|
| yt-dlp search fails or is rate limited | That goal uses Watch Later candidates only; `notice` says search was down. |
| No plan this week | Q4 quests are used, and `notice` says so. No Q4 quests either: zero picks with a notice. |
| A covers id unknown at post time | Dropped, warning in the response, set still saved. |
| Remove all partly fails | Report how many were removed; failed rows stay unstruck so Joon can retry. |
| Laterlist unreachable on Monday | Existing fallback: local page plus vault note. |

## Out of scope

Picking inside the server, other users, push notifications, any change to the 5 rows or the sorting rulebook, adding YouTube picks to Watch Later or the library (Joon just watches them from the link), YouTube Data API keys.

## Testing

- Server (vitest, PGlite): new validator shape (goal and pick caps, `source` rules, required fields, covers filtering and warnings, duplicate pick rejected, old shape still accepted); `POST /api/videos/dismiss` bulk with and without removal allowed; `POST /api/videos/restore` restores dismissed rows and cancels pending removals; history includes youtube picks; verdict on a youtube pick saves without touching videos.
- Web: This week renders goal sections, empty goal, source tags, covers open and collapsed, Leave it changes the Remove all count, Remove all calls the bulk endpoint and shows undo, already removed covers are struck, old flat payload still renders.
- CLI: `search` builds fixed yt-dlp args (no user text becomes a flag; query passed as a single `ytsearchN:` argument), filters shorts and over 2 hours, respects budget; `post` with the new shape; fallback page renders by goal.

## Done means

1. `npm test` green.
2. In dev: posting a sample payload with 2 goals (one with 2 picks including a youtube pick with 6 covers, one empty) shows layout A; Leave it and Remove all work; removed videos leave the Library rows; reload keeps verdicts; no console errors; 375px has no sideways scroll.
3. A manual production run of the `watch-picks` task after the runtime worktree is moved posts goal picks, and Joon reads at least one title and thinks "I need this."
4. Joon's verdict check stays as set on 10-12 (next check about 2026-10-26), now counting goal picks.

## Calls I made (Joon, check these)

1. Up to 4 goals a week, most urgent first.
2. Goals come from your mentor agent's weekly plan and the growth ladder. There is no activity check, and the Q4 quests are the fallback.
3. Shorts and videos over 2 hours are never picked.
4. Subtitle budget 24 a week.
5. YouTube picks carry no category color and are not added to your library.
6. Covers only list videos the pick clearly covers; when unsure, leave them out.
7. Remove all has a 10 second Undo. Videos already off YouTube come back in Laterlist only.
