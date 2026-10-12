# Weekly watch picks: a personal, highly selective video mentor

**Date:** 2026-10-11
**Status:** design approved in chat by Joon; this written spec awaits his review
**Owner:** Joon (personal tool, not a Laterlist product feature)

## 3-second line

This is a weekly mentor for Joon. Every Monday it picks the 3 videos in his Watch Later that are actually worth his time this week, and says why.

## Why

Laterlist was built to save Joon time. Sorting tells him what each video *is*; it does not tell him what is worth *his* time. On 2026-10-08 he tried making the rows answer "is this worth my time?" and it broke, because the rows became personal. The strict rulebook fixed the rows by keeping them about the video only. This tool is where the personal question lives instead: rows say what a video is, the mentor says whether it is worth Joon's time now.

It also matches the approved launch plan (2026-08-15): the lasting value is a recurring "resurfacing" loop, not a one-time sort. This is that loop, built for one person first.

## Decisions (Joon, 2026-10-11)

| Question | Answer |
|---|---|
| Who is it for | Just Joon. Never shipped to other users. |
| Where it lives | A weekly Claude run on his Mac, on his Claude subscription. No product code in Laterlist, no API bill. |
| How many | 3 picks a week. |
| How it knows him | It reads his vault every week. No hand-maintained brief. |
| Delivery | A visual page that opens on his Mac, plus a copy in the vault. |
| Depth | Two stages: shortlist 12 from metadata, read those 12 transcripts, pick 3. |
| Source | Laterlist production database, read-only. |

Parked (not in this spec): recommending videos he never saved (needs YouTube search, its own project), a weekly "let go" list, sharing with other users, showing picks inside the Laterlist board.

## How it works

```
Monday 08:00, scheduled task on the Mac
  1. Read Joon      -> focus line + 3 to 5 focus points
  2. Read the list  -> eligible videos (read-only export)
  3. Shortlist 12   -> titles, channel, length, age, topics, description
  4. Read 12        -> transcripts (cached first, then yt-dlp)
  5. Pick 3         -> reasons, best part, close-but-no list
  6. Write          -> HTML page (opened) + vault note
```

### Pieces

| Piece | Where | Job |
|---|---|---|
| `watch-picks` skill | `~/.claude/skills/watch-picks/SKILL.md` | The weekly procedure, judging rules, page and note templates. Named to stay clear of the existing life `mentor` skill. |
| CLI | `scripts/watch-picks.mjs` plus `scripts/watch-picks/{db,subs,render}.mjs` in this repo | Does every deterministic job (export, transcripts, subtitle cleaning, page and note rendering, past picks). Reads Joon's rows from production inside a `BEGIN READ ONLY` transaction and prints JSON. Every statement runs on one client from `pool.connect()` (or a `pg.Client`), because the Supabase pooler on port 6543 is in transaction mode and separate `pool.query()` calls can land on different connections, which would make the read-only guard do nothing. Subcommands are listed in `.plans/weekly-watch-picks.md`. Uses the repo's `pg` dependency and connects as the read-only `picks_reader` role (see Production access). Never writes. The Monday run executes a clean copy at `~/projects/laterlist-runtime` (a detached worktree at `origin/main` nobody edits), because Joon's main checkout carries his own uncommitted work. |
| Work folder | `~/Obsidian/Joon/2. Areas/Mentor/Picks/.work/<week>/` | Lists, transcripts, subtitles and `picks.json` for the week. Inside the vault because the unattended run already has Read and Edit permission there; Obsidian hides dot folders. |
| Scheduled task | Claude desktop local scheduled tasks | Runs the skill Mondays at 08:00 on Opus 5.5, medium effort. Same "Mac must be awake" constraint as the 07:00 morning brief. |
| Output | `~/Obsidian/Joon/2. Areas/Mentor/Picks/YYYY-MM-DD.html` and `.md` | The page Joon sees and the archive the next run reads. |

### Step 1: read Joon

Sources, in priority order:

1. `2. Areas/Mentor/성장 사다리.md`: this week's three priorities (set in the Friday retro) and the Q4 quests. This is the main signal.
2. The last 7 days of `2. Areas/Mentor/Days/` notes.
3. Notes changed in the last 14 days under `1. Projects/` and `2. Areas/Job/`.
4. The last 4 weeks of `2. Areas/Mentor/Picks/*.md`, including Joon's verdict lines.

Output: one "Your focus this week" sentence and 3 to 5 focus points, shown at the top of the page so Joon can catch a wrong guess at a glance.

### Step 2: read the list

The export returns Joon's videos where:

- `category` is `learn` (Get the gist) or `watch` (Watch it). Music, Entertainment and Let it go are dropped for free.
- `status` is not `done` or `dismissed`.
- the video was not a pick in the last 8 weeks (checked against past Picks notes).

Fields: `video_id, title, channel, duration_seconds, published_text, upload_date, category, topics, description, transcript_available`.

Joon's user row is found by `PICKS_EMAIL` in `~/.config/watch-picks/.env.picks`, outside every checkout.

### Step 3: shortlist 12

Judged on title, channel, length, age, topics and description (when present) against the focus points. Prefer variety of source over three videos from one channel. Write one line per finalist saying why it made the list.

### Step 4: read 12

Transcript sources, in order:

1. Production cache (`videos.transcript`) via `watch-picks.mjs transcripts`.
2. The old app's `~/projects/watch-later-librarian/library.db` (2,124 cached transcripts).
3. `watch-picks.mjs fetch-subs`, which runs yt-dlp itself with a fixed argument list (`--ignore-config`, subtitles only, output only into the work folder). At most 8 videos per week, enforced in code: YouTube has blocked caption downloads after about 10 from one IP in this project's earlier tests.

Cap each transcript at about 20,000 characters. If a fetch fails or YouTube rate-limits, judge that finalist on metadata and mark it "(no transcript)".

### Step 5: pick 3

A pick must pass all four:

1. **Fits the focus.** It serves one of this week's priorities, not just a general interest.
2. **High quality.** Concrete, from someone who has done the thing, not padded or clickbait. The transcript is the evidence.
3. **Not a repeat.** Does not mostly restate what Joon's vault notes already cover (search `3. Resources/` and project notes for the topic).
4. **Won't muddy.** Does not push against something Joon has already settled (his decision docs, his standards) without a strong reason, and is at his level.

The 3 should build on one theme when the focus allows. For each pick, record: why him, now (one or two sentences, specific to his focus); the best part to watch as a time range when the transcript has timings, or "watch it all"; and 2 or 3 things he will get.

The other 9 finalists go in "Close, but no" with a one-line reason each, so the selectivity is visible.

### Step 6: write

**HTML page** (opened with `open` after writing):

- Header: week date and the focus line.
- Three cards: thumbnail (`https://i.ytimg.com/vi/<id>/hqdefault.jpg`), title linked to `https://www.youtube.com/watch?v=<id>&t=<start>s`, channel and length, "Why you, now", best part chip, what you'll get.
- Chips and links are monochrome. In Laterlist, color means category only (the chat mockup's blue chip was a mockup shortcut, not the design).
- "Close, but no" list.
- Styled with Laterlist's existing tokens from `docs/design-system.md` (monochrome, Fjalla One headings, Inter body). No new colors or fonts. Self-contained file, no external scripts.

**Vault note** (same content in markdown) with a verdict line under each pick that Joon fills in:

```
Verdict: worth it | not | skipped
```

The next run reads these verdicts as part of step 1.

## Guardrails

- Read-only against production, enforced twice: the `picks_reader` role has SELECT only and row policies that show it Joon's rows alone, and the export script runs inside `BEGIN READ ONLY`.
- Never writes to Laterlist, never deletes anything, never touches YouTube beyond fetching subtitles for at most 8 videos a week.
- Joon judges the picks. The tool never grades itself.
- Picks only from Joon's own Watch Later.

## Errors

| Case | Behavior |
|---|---|
| Database unreachable | No picks. The page says "Couldn't reach Laterlist this week" with the error in one line. Nothing guessed from stale data. |
| Fewer than 3 eligible videos | Pick what exists and say so. |
| A transcript fails | Judge on metadata, mark "(no transcript)". |
| No recent vault signal | Fall back to the Q4 quests in `성장 사다리.md` and say so in the focus line. |
| Mac asleep at 08:00 | Same as the morning brief: runs when the scheduler next can, or Joon runs `/watch-picks` by hand. |

## Production access

Checked 2026-10-11: the `DATABASE_URL` in `.env.vercel` is `[SENSITIVE]`, because Vercel redacts sensitive variables on `env pull`. There is no usable production key on disk, and the app's own key (full access as `postgres`) is the wrong one to hand a weekly script anyway.

So the run gets its own login, created once by Joon in the Supabase SQL editor (the exact SQL goes in the implementation plan):

- A role `picks_reader` with LOGIN, a password Joon picks, `USAGE` on schema `public`, and `SELECT` on `users` and `videos` only.
- Row level security is already on for every table with no policies, so the role also needs two SELECT policies: `users` where the email is Joon's, and `videos` where `user_id` is Joon's. It can never see another user's rows.
- Joon saves the pooler connection string (`postgresql://picks_reader.<project-ref>:<password>@aws-0-us-west-1.pooler.supabase.com:6543/postgres`) in `~/.config/watch-picks/.env.picks`, outside every checkout so it can never be committed. The CLI reads only that file.

## Running unattended

Joon's existing scheduled tasks avoid Bash entirely, because a shell command triggers a permission prompt nobody is awake to approve and the run hangs. This run gets exactly one allowlist entry in `~/.claude/settings.json` (via the `update-config` skill), approved by Joon (open item 1):

- `Bash(node /Users/joonwoopark/projects/laterlist-runtime/scripts/watch-picks.mjs:*)`

yt-dlp is deliberately not allowlisted: it accepts `--exec` (run any command) and any output path, and this run reads third-party titles, descriptions and transcripts that could carry injected text. The CLI's `fetch-subs` runs it instead with fixed arguments. `open` is already allowed. Everything else uses Read, Glob, Grep and Write. No blanket bypass.

## Done means

**Build is done when** (checked by running it, not by reading code):

1. `node scripts/watch-picks.mjs check` passes and `list` writes Joon's eligible videos. As `picks_reader`, a write attempt errors and a query for another user's videos returns 0 rows.
2. Production row counts and `status` values for Joon's videos are identical before and after a full run.
3. A full run on real data writes both the HTML page and the vault note, and the page opens in the browser with working thumbnails and links that start at the best-part time.
4. The focus line visibly comes from this week's priorities in `성장 사다리.md`.
5. The scheduled task exists for Mondays 08:00 and a manual trigger of it produces the same output.

**The mentor works when** (Joon judges):

1. First run: Joon agrees with the focus line and approves at least 2 of the 3 picks, reasons included.
2. Over the first 3 weeks: in at least 2 of them, Joon watches 2 or more picks and marks most of the watched ones "worth it". Review after the third run. If it fails, look at whether the picks were wrong or the format was ignored before changing anything else.

## Open before the build

1. ~~May the Monday run read production every week without asking?~~ **Yes** (Joon, 2026-10-11). Add the allowlist above during the build.
2. ~~Does the key on disk connect?~~ No, it is redacted. Joon creates `picks_reader` and saves `~/.config/watch-picks/.env.picks` (Task 0 of the plan).

## Related

- Strict sorting rulebook decision, 2026-10-08 (vault): why the rows stay objective.
- Launch plan, 2026-08-15 (`~/.gstack/projects/Hypic01-watch-later-web/joonwoopark-agent-youtube-watch-later-removal-design-20260815.md`): the resurfacing loop as the moat.
- Life mentor system: `~/Obsidian/Joon/2. Areas/Mentor/Mentor System.md` and the `mentor` skill.
