# Slideshow templates

Two shapes, both derived from Stephen's own edit of 22 Sep 2026 rather than from
a guess. His three changes, and why each is in both templates:

**The hook sits in a white box on the bottom third.** He moved it there off the
top, where a generated hook had been printed across the Split Index score it was
asking about. White-on-bottom reads as the question and leaves the data alone.
Everything after it stays light-black-on-top.

**The third slide pivots rather than piling on.** He replaced a second statistic
with "But how does this affect your hybrid performance?" — one question that
turns three numbers into the thing the product answers.

**The app closes, it does not open.** The screenshot is the payoff, not the
opener.

---

## The allow-list, and why it exists

Two exports invented product features. The first wrote "that's balanced for most
lifters", a norm the engine does not hold — its lift ratios are all relative to
the squat and there is no bench-to-deadlift figure anywhere in it. The second
named "Lactate clearance under load" and "Recovery capacity ratio", neither of
which appears anywhere in the codebase.

Both passed a prompt that said "never invent a figure", because neither was a
figure. A negative rule is not enough: the generator will fill any gap it is
asked to fill. So both templates carry an explicit list of what may be named,
and forbid everything outside it.

Keep `ALLOWED` in `shared-style.json` in step with the engine. If a capability
ships, add it. If one is renamed, rename it here the same day.

---

## `automation-hybrid-performance.json`

Stock photography for three slides, the app closing on the fourth.

Because the images are photographs rather than screens, the hook no longer has
to be provable by the picture behind it. That is what lets this template ask a
question the app answers instead of describing a screen.

The closing slide uses ReelFarm's CTA slide, which appends a fixed image and
writes no text on it by design. The words therefore land on slide 3, and the
screenshot answers them silently.

Collection ids take the form `user_collection_<numeric id>` — the number from
`rf.mjs collections`, with that prefix. A bare number is not accepted.

This template is bound to `user_collection_16250` (SI · Stock · hybrid) for the
three photo slides, and `user_collection_16264` (Split Index advert slides) for
the closing CTA. The CTA is the advert collection rather than `SI · App
screens` (16261) by Stephen's choice on 22 Sep — both are app imagery, and the
advert set is the finished one.

`tiktok_account_id` is filled by `scripts/bind-account.mjs`, which reads it from
`GET /accounts` and writes it into every template here. Do not retype it by
hand — it mixes `O` with `0` and runs of zeros, and a wrong id does not fail
loudly: `automation:create` accepts it and the automation posts to nothing.

## `automation-app-showcase.json`

No stock at all. Every slide is a screenshot, and every hook is about what the
product does rather than about the athlete's numbers.

This is the template most exposed to invention, because each slide is a claim
about capability with no photograph to hide behind. It carries the same
allow-list and the same ban, and it is the one to re-read first after any
generation.

---

## Before scheduling either

Rate limits are 20 requests a minute and 3 slideshows generating at once.
Generation costs one credit; sending to TikTok costs none.

Drafts reach TikTok under Inbox, then System Notifications — not the Drafts
folder. That is where the first batches went, and why the account looked empty
while ReelFarm reported "Published": a `MEDIA_UPLOAD` publish succeeds the
moment TikTok accepts the draft, and nothing is public until a human opens the
notification and taps through.

### Which templates post publicly, and which do not

`automation-hybrid-performance.json` alone is live: `auto_post` true,
`post_mode` `DIRECT_POST`, `visibility` `PUBLIC_TO_EVERYONE`. Its cron is
Monday, so it produces a public post every week with nobody in the loop.

The other three stay `auto_post` false / `MEDIA_UPLOAD` / `SELF_ONLY` on
purpose. One automation going live is a reversible experiment against one
weekly slot; four is the whole content schedule posting unreviewed before any
of it has been seen published. Promote the rest by copying those three fields
across once a couple of Monday batches have run and read well.

Two limits worth knowing before promoting more: TikTok allows 6 publishes per
account per 24h and `DIRECT_POST` counts against it (drafts do not), and
ReelFarm's own defaults are the live ones — an automation that omits
`tiktok_post_settings` entirely auto-posts publicly. The safe values in these
files are overrides, so a field deleted during editing fails open, not closed.

Cron runs on Pacific time. 10:00 there is 18:00 in the UK through British Summer
Time.
