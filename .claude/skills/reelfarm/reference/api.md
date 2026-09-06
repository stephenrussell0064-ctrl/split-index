# ReelFarm API reference

Snapshot of <https://reel.farm/api-docs> taken **2026-09-06**. Their API moves — if a call
fails on an unknown field, re-check the live docs before assuming a bug in the CLI.

- Base URL: `https://reel.farm/api/v1`
- Auth: `Authorization: Bearer rf_...`
- Tier gate: Growth, Scale, Unlimited
- Rate limit: 20 requests / 60s sliding window, per user; max 3 concurrent slideshows
- TikTok: 6 publishes per account per 24h (`MEDIA_UPLOAD` drafts do not count against it)

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/account` | Subscription tier and credits |
| POST | `/slideshows/generate` | AI slideshow from a prompt (`additional_context`, `images[]`) |
| POST | `/slideshows/create` | Manual slideshow, full control (`slides[]`, `aspect_ratio`, `export_as_video`) |
| GET | `/slideshows/{id}/status` | Poll generation |
| POST | `/automations` | Create a recurring posting automation |
| GET | `/automations` | List automations |
| GET | `/automations/{id}` | Single automation |
| PATCH | `/automations/{id}` | Update settings / `slideshow_hooks[]` / pause via `action` |
| DELETE | `/automations/{id}` | Remove |
| POST | `/automations/{id}/run` | One-off generation (`hook`, `mode`) |
| POST | `/automations/{id}/schedule` | Add cron job (Pacific time) |
| PATCH | `/automations/{id}/schedule` | Update / batch modify jobs |
| DELETE | `/automations/{id}/schedule` | Remove a job |
| GET | `/videos` | List rendered videos |
| GET | `/videos/{id}` | Single video |
| GET | `/videos/{id}/analytics` | TikTok post metrics |
| POST | `/videos/{id}/publish` | Publish using the automation's settings |
| POST | `/tiktok/publish` | Standalone publish |
| GET | `/tiktok/accounts` | Connected accounts |
| GET | `/tiktok/posts` | Posts with engagement (`timeframe`, `sort`, `tiktok_account_id`) |
| GET | `/collections` | Image collections |
| GET | `/collections/{id}/images` | Images in a collection (`limit`, `offset`) |
| GET | `/pinterest/search` | Stock image search (`q` required, `cursor`) |
| GET | `/library/niches` | Slideshow niches |
| GET | `/library` | Real TikTok profiles for reference (`q`, `niche`, `product_medium`, `region`) |
| GET | `/library/profiles/{id}` | Profile detail |

Collection endpoints are read-only here — there is no documented image *upload* endpoint.
Build collections in the ReelFarm dashboard, or pass image URLs per slideshow via
`images[]` / `slides[].image_url`.

## POST /automations

```json
{
  "tiktok_account_id": "string (required)",
  "schedule": [{ "cron": "string" }],
  "title": "string",
  "product_id": 0,
  "slideshow_hooks": ["string"],
  "style": "string",
  "language": "string (default: English)",
  "tiktok_post_settings": {
    "caption":     { "mode": "prompt|static", "prompt_text": "string", "static_text": "string" },
    "description": { "mode": "prompt|static", "prompt_text": "string", "static_text": "string" },
    "auto_post": true,
    "visibility": "PUBLIC_TO_EVERYONE|SELF_ONLY|MUTUAL_FOLLOW_FRIENDS|FOLLOWER_OF_CREATOR",
    "auto_music": true,
    "post_mode": "MEDIA_UPLOAD|DIRECT_POST",
    "allow_comments": true,
    "allow_duet": true,
    "allow_stitch": true
  },
  "image_settings": {
    "first_slide": { "collection": "string", "mode": "string", "single_image": "string" },
    "all_slides": "collection id",
    "aspect_ratio": "4:5|9:16|1:1|16:9",
    "is_bg_overlay_on": false,
    "is_bg_overlay_on_hook_image": false,
    "background_opacity": 20,
    "keep_original_aspect_ratio": false,
    "text_on_first_slide_only": false,
    "no_text_on_slides": false,
    "auto_pull_images": false,
    "auto_images_no_text": false,
    "disable_auto_image_for_first_slide": false,
    "hook_grid_format": "single|1:2|1:3|2:1|2:2",
    "body_grid_format": "string",
    "cta_slide": { "check": false, "cta_collection_check": false, "cta_collection_id": "string", "image_id": "string" }
  }
}
```

Responds `201` with `automation_id`, and `schedule[]` entries gain a `job_id`.

## POST /automations/{id}/run

```json
{ "hook": "string (optional)", "mode": "export|draft_only (default: export)" }
```

The CLI defaults `mode` to `draft_only`. Responds `202`, generation is async — poll
`GET /videos`.

## GET /videos

Query: `automation_id`, `video_type` (`slideshow|ugc|greenscreen`), `status`
(`completed|processing|failed`), `finished`, `failed`, `created_after`, `created_before`,
`limit` (default 20, max 100), `offset`.

Returns `{ videos: [...], total, limit, offset }`; each video carries `created_at`,
`status`, `finished`, `failed`, `created_by_cron_id`, `video_type`, `slideshow_images[]`,
`prompt` (slideshows) or `video_url` (ugc/greenscreen).

## GET /videos/{id}/analytics

`post_id`, `video_id`, `title`, `caption`, `view_count`, `like_count`, `comment_count`,
`share_count`, `bookmark_count`, `tiktok_account_id`, `account_username`, `account_name`,
`event`, `publish_type`, `published_at`.

**No watch-time, completion or retention field exists.** Do not infer retention from this.

## POST /tiktok/publish

```json
{
  "video_id": "uuid (required)",
  "tiktok_account_id": "string (required)",
  "upload_type": "slides|video (default: slides)",
  "caption": "string (max 89 chars for slideshows)",
  "description": "string (max 4000)",
  "post_mode": "DIRECT_POST|MEDIA_UPLOAD (API default: DIRECT_POST)",
  "visibility": "PUBLIC_TO_EVERYONE|SELF_ONLY|MUTUAL_FOLLOW_FRIENDS|FOLLOWER_OF_CREATOR",
  "allow_comments": true,
  "allow_duet": true,
  "allow_stitch": true,
  "auto_music": true,
  "disclose_video_content": false,
  "disclose_brand_organic": false,
  "disclose_branded_content": false,
  "slideshow_image_urls": ["string"]
}
```

Note the API's own default is `DIRECT_POST` — **the CLI overrides this to `MEDIA_UPLOAD`**
unless `--confirm-live` is passed. Keep it that way.

`disclose_branded_content` / `disclose_brand_organic` matter if a post is ever run as paid
or sponsored placement; leave false for organic first-party content.

## GET /pinterest/search

Returns `{ images: [url], cursor, has_more, page, total_pages_allowed }`.

## slides[] object (POST /slideshows/create)

```json
{
  "image_url": "string",
  "image_urls": ["string"],
  "image_layout": "single|1:2|1:3|2:1|2:2",
  "aspect_ratio": "4:5|9:16|1:1|16:9",
  "text_position": "top|center|bottom",
  "is_cta": false,
  "text_items": [{
    "text": "string (required)",
    "font_size": "extra_extra_small|extra_small|small|medium|large|extra_large|raw",
    "text_color": "white|black|red|orange|green|cyan|light_blue|blue|dark_blue|indigo|light_purple|purple|pink|brown|clay|gold|army_green|dark_cyan|navy_blue|turquoise|periwinkle|pastel_purple|other_purple|salmon|yellow|light_grey|dark_grey",
    "text_style": "text|outline|background|light_background  (with a colour) — or outline|whiteText|blackText|white_background|black_50_background|{color}_text|{color}_outline|{color}_background|{color}_50_background (without)",
    "font": "TikTokDisplay-Bold|BebasNeue-Regular|CormorantGaramond-Regular|CormorantGaramond-Italic|Georgia-Italic",
    "text_width": "100%|80%|50%|full",
    "text_align": "left|center|right",
    "text_anchor": "padded|flush",
    "text_vertical_anchor": "padded|flush"
  }]
}
```

For Split Index hooks: `TikTokDisplay-Bold`, `white` with `black_50_background`, 9:16,
`text_position: top` reads cleanly over a screenshot without covering the number the hook
is pointing at.
