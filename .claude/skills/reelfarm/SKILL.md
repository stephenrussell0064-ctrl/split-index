---
name: reelfarm
description: Split Index short-form marketing via ReelFarm — hold the 20-hook library with its art direction, emit paste-ready hook lists for the dashboard, and (where the plan has API access) push hooks into an automation, pick imagery, generate slideshows in draft mode and pull back per-hook reach and engagement. Use when the user mentions ReelFarm, reels, TikTok slideshows, marketing hooks, or ad creative batches.
---

# ReelFarm

Wraps the ReelFarm REST API (`https://reel.farm/api/v1`) for Split Index marketing.

## Before anything

**Credentials.** The CLI reads `REELFARM_API_KEY` from the environment. Never ask the
user to paste the key into chat, never write it into a file in this repo, and never echo
it. If it is missing, the script exits with instructions — relay those and stop.

```bash
export REELFARM_API_KEY=rf_...   # user runs this themselves, in their shell profile
```

**Plan gate.** API access requires Growth, Scale or Unlimited. `node scripts/rf.mjs account`
is the cheapest way to confirm the key works and the tier is sufficient. Run it first in
any session that will touch the API.

**No API access? Use dashboard mode.** As of 2026-09-06 this account is below Growth, so
every networked command will 401. Everything offline still works and is the point of the
skill today — see "Dashboard mode" below. Do not push the user toward an upgrade unasked.

**Publishing is outward-facing.** Every generation defaults to draft mode and every
publish defaults to `MEDIA_UPLOAD` (lands in the TikTok inbox as a draft, not live). Going
live requires `--confirm-live`, and you must get an explicit yes from the user for that
specific batch first. A previous approval never carries to the next batch. Draft mode also
sidesteps TikTok's cap of 6 publishes per account per 24h.

**Rate limits.** 20 requests per 60-second sliding window; max 3 concurrent slideshows.
The CLI self-throttles to ~3.2s between calls, so bulk commands are slow by design. Do not
work around it with parallel shells.

## The hook library

`hooks/split-index-hooks.json` holds 20 hooks — 10 hybrid/cardio, 10 gym-only. Each entry
carries:

| Field | Use |
|---|---|
| `id`, `batch` | Identity and audience segment (`hybrid` / `gym`) |
| `hook` | The full line — voiceover and the payload for `slideshow_hooks[]` |
| `short` | Trimmed to ≤70 chars for on-screen text where the full line would wrap badly |
| `frame` | First-frame art direction |
| `asset` | The Split Index screenshot that should carry it (preferred over stock) |
| `image_query` | Pinterest fallback query, only where stock imagery genuinely works |
| `mechanic`, `usp`, `next_beat` | Why it retains, what it sells, the 3–8s follow-through |
| `cold_reach` | `true` if it works on a cold audience; `false` means retargeting only |

**Imagery rule, and it matters more here than on a normal account.** 16 of the 20 hooks
pay off on a specific number or chart. Generic gym stock under a hook that promised data
reads as a scam and dies in the first second. Prefer `asset` (a real app screenshot) and
only fall back to `image_query` where the entry says so. Hooks 13 and 19 are the two that
genuinely want human-subject stock.

## Commands

All from the skill directory: `node scripts/rf.mjs <command>`.

```bash
node scripts/rf.mjs account                      # tier + credits — run this first
node scripts/rf.mjs accounts                     # connected TikTok accounts (get the id)
node scripts/rf.mjs collections                  # your image collections
node scripts/rf.mjs collections <collection_id>  # images inside one
node scripts/rf.mjs pinterest "<query>"          # stock image URLs

node scripts/rf.mjs hooks                        # print the local library
node scripts/rf.mjs hooks --batch gym --cold     # filter: gym-only, cold-reach-safe
node scripts/rf.mjs hooks --field short --json   # the slideshow_hooks[] payload

node scripts/rf.mjs automation:create <payload.json>
node scripts/rf.mjs automation:list
node scripts/rf.mjs automation:get <id>
node scripts/rf.mjs automation:hooks <id> --batch gym     # PATCH slideshow_hooks
node scripts/rf.mjs automation:run <id> --hook-id gym-15  # one-off, draft by default

node scripts/rf.mjs videos --status completed --limit 20
node scripts/rf.mjs video <video_id>
node scripts/rf.mjs analytics <video_id>
node scripts/rf.mjs report --limit 30            # joins analytics back to hooks

node scripts/rf.mjs publish <video_id> <tiktok_account_id> --caption "..."
```

## Dashboard mode (no API key)

Everything below runs offline and needs no key or plan. This is the working mode until
the account has API access.

```bash
node scripts/rf.mjs hooks --batch gym --field short --plain   # paste into the dashboard
node scripts/rf.mjs hooks --cold                              # cold-reach-safe subset, with art direction
node scripts/match.test.mjs                                   # offline regression test
```

Workflow: create the automation in the ReelFarm web dashboard, paste the `--plain` output
into its hook list, point it at a Split Index screenshot collection, and generate. Mirror
the same safe defaults the template uses — auto-post off, drafts rather than direct posts —
because the dashboard's defaults are not the CLI's.

Analytics then come from TikTok's own dashboard, not from `report`. When reading those,
the same caution applies: judge on engagement rate and completion, and remember view counts
are distorted by which videos the algorithm happened to push.

`templates/automation-split-index.json` is a ready payload with safe defaults
(`post_mode: MEDIA_UPLOAD`, `auto_post: false`). Fill in `tiktok_account_id` from
`accounts` and the collection ids from `collections` before posting it.

## Reading the report

`report` pulls completed videos, fetches analytics for each that has a TikTok post, and
matches them back to library hooks by substring against the video prompt, title and
caption. Matching is best-effort — a hook edited inside ReelFarm's dashboard will come back
`unmatched`. Say so rather than quietly dropping those rows.

Rank by engagement rate (likes + comments + shares + bookmarks ÷ views), not raw views —
a hook boosted onto one big feed distorts view counts. Retention is what you cannot see
here: the API exposes no watch-time or completion field, so **never claim a hook "retained
well"** from this data. It shows reach and engagement. Say that plainly.

## Claim safety when writing new hooks or captions

Two things in the product are explicitly provisional and must not be stated as fact:

- Sex and age factors in the strength engine are **beta**, not calibrated to real
  population data. Frame age handling as "the standard moves, not your number" — which is
  architecturally true — never as accuracy.
- Swim, cycle and ski cardio anchors are **provisional**; run and row are calibrated. Do
  not build a hook on an absolute swim or ski score.

Injury-risk copy stays framed as "relative to your baseline". An implied medical claim is
the one thing in this set that creates real liability.

## Reference

`reference/api.md` holds the endpoint list, request shapes and every documented enum value
(text colours, fonts, layouts, visibility, post modes). Read it before constructing a
payload rather than guessing field names. If a call 400s on an unknown field, re-check
against <https://reel.farm/api-docs> — their API moves and this reference is a snapshot
taken 2026-09-06.
