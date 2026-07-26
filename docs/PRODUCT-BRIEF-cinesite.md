# Product: CineSite (working name)

Ultra-cinematic small-business website builder that transforms an existing basic site into a distinctive, interactive, mobile-ready experience — preserving every page, link, and legal surface while upgrading UI/UX and visual storytelling.

## Skills (required)

Before any UI, layout, typography, color, motion, or page-generation work:

1. **Load and obey UI/UX Pro Max**
   - Cursor: `.cursor/skills/ui-ux-pro-max/SKILL.md` (also available globally under `~/.cursor/skills/ui-ux-pro-max/` when installed)
   - Claude Code: `.claude/skills/ui-ux-pro-max/SKILL.md` (also `~/.claude/skills/ui-ux-pro-max/` when installed)
2. Run the skill’s design-system search / Quick Reference steps **before** writing components.
3. Do not ship UI that violates UI/UX Pro Max recommendations or the anti-generic rules below.
4. If Python 3 is unavailable for the skill’s search scripts, ask the user to install it — do not install system packages yourself; fall back to the skill’s Quick Reference sections.

Install / refresh the skill in a project:

```bash
npx ui-ux-pro-max-cli@latest init --ai cursor
npx ui-ux-pro-max-cli@latest init --ai claude
# or every assistant:
npx ui-ux-pro-max-cli@latest init --ai all
```

## Goal

Build a developer platform that:

1. Ingests an existing small-business website (URL crawl or export)
2. Classifies business intent (data-focused vs product/service-focused vs hybrid)
3. Generates a cinematic visual system (AI video concept → frame sequence → compressed WebP stills used as the aesthetic layer)
4. Rebuilds the site with superior UI/UX while carrying over ALL content, routes, CTAs, privacy/terms/cookies, contact forms, and functional behaviors
5. Ships responsive, hover-interactive, mobile-compatible sites that do not look like generic AI templates

## Non-goals (do not build yet)

- General-purpose CMS competing with WordPress/Webflow on day one
- Arbitrary user video editing suite
- Marketplace / multi-tenant billing (stub only)
- Replacing the business’s brand identity without consent
- Inventing new legal pages — only improve presentation of existing ones (or generate stubs if missing, clearly flagged)

## Success criteria (Definition of Done for v0.1)

- [ ] Input: public URL of a basic SMB site → output: rebuilt Next.js site preview
- [ ] Content parity report: every discovered route/link/form/legal page mapped 1:1 or flagged
- [ ] Style mode locked from classification: `data` | `product` | `service` (product/service = hero focus on offering; data = analysis/metrics aesthetic)
- [ ] Visual pipeline: concept storyboard → N keyframes → WebP assets (<150KB avg) used in hero/sections (not raw video required for v0.1)
- [ ] Hover interactions on ≥3 primary UI regions (nav, cards, CTAs) with reduced-motion fallback
- [ ] Mobile: all critical flows usable at 375px width
- [ ] Privacy Policy, Terms, Cookie/Contact (if present on source) must appear in nav/footer of rebuild
- [ ] Lighthouse mobile Performance ≥ 80 on preview (target; document blockers)
- [ ] README: install, `ingest`, `classify`, `generate`, `preview` commands
- [ ] UI/UX Pro Max applied on every generated page (style, palette, fonts, UX checklist)

## Architecture gate (REQUIRED)

Before writing production code:

1. Explore / propose architecture
2. Propose file tree + data models
3. Propose 4 vertical slices (below)
4. STOP and wait for approval

### Proposed slices

**Slice 1 — Ingest & parity**  
Crawl/parse source site → site graph (pages, links, assets, forms, legal). Emit `parity.json`.

**Slice 2 — Intent & design system**  
Classify business type; generate design tokens + layout recipe (data vs product/service) **using UI/UX Pro Max**. No generic purple/Inter/card-grid defaults.

**Slice 3 — Cinematic asset pipeline**  
Storyboard concept around the business → generate/select frames → compress to WebP → attach to layout slots. Offline/mock generator acceptable if API keys absent.

**Slice 4 — Rebuild & interactivity**  
Emit Next.js site: preserve routes/content; upgrade UI per UI/UX Pro Max; hover states; mobile; footer legal links; preview server.

## Hard constraints

- Prefer Next.js (App Router) + TypeScript + Tailwind
- Local-first CLI; cloud generation optional behind env flags
- No new major dependencies without asking
- Do not invent business facts (prices, claims, addresses) — only reuse source content
- Accessibility: keyboard nav, focus rings, `prefers-reduced-motion`
- Security: sanitize crawled HTML; never execute remote scripts in the builder process
- Performance: WebP frames, lazy-load below fold, no autoplay video required in v0.1

## Design system rules (anti-generic AI look)

UI/UX Pro Max is the quality bar and primary design authority. Also enforce:

- One composition per viewport (not a dashboard unless source is data-product)
- Brand/product name as hero-level signal when source is branded
- Expressive typography (no Inter/Roboto/Arial/system as primary)
- Atmospheric backgrounds (gradient/image/pattern) — not flat single color
- Full-bleed hero visual plane for promotional sites; no inset hero cards
- Hero budget: brand + one headline + one support line + one CTA group + one dominant visual
- No floating badges/stickers over hero media
- Cards only when they contain interaction; otherwise strip chrome
- One job per section
- Real visual anchors from the business (product, place, craft) — cinematic WebP frames support this; not abstract purple blobs
- Intentional motion (2–3 purposeful interactions), not noise
- Avoid: purple-on-white gradients, cream+terracotta cliché, broadsheet hairline newspaper layouts, emoji decoration, glow spam, pill clusters, multi-layer shadow stacks
- If source site is data-focused → emulate data-analysis aesthetic (charts, density, precision)
- If product/service-focused → offering is the center of the first viewport

## Content fidelity rules

1. Discover all internal links; rebuild equivalent routes
2. Carry over: nav, footer, CTAs, forms, embeds (map or stub with clear TODO), privacy/terms/cookies
3. Improve UI/UX only — do not drop sections because they are “ugly”
4. Produce a `MISSING.md` for anything that cannot be ported automatically
5. Mobile parity: every desktop function has a mobile equivalent (burger nav, tap targets ≥44px)

## Interaction requirements

- Hover (desktop): subtle state changes on nav items, feature tiles, primary CTA
- Touch: no hover-only affordances; use press/active states
- Respect `prefers-reduced-motion: reduce`

## CLI UX contract

```
cinesite ingest <url>        → .cinesite/site-graph.json + parity.json
cinesite classify            → intent + design tokens (via UI/UX Pro Max)
cinesite generate-visuals    → webp frame pack
cinesite build               → /out site
cinesite preview             → local server
```

Exit codes: 0 ok, 1 user error, 2 system error. `--json` for machine output. `--dry-run` for mutating steps.

## Open questions (ask me — do not invent)

1. Hosting target (Vercel / static export / WordPress embed)?
2. AI video provider (or mock frames only for v0.1)?
3. Brand name for the builder product?
4. Must preserve exact source URLs/paths or can remap?
5. Multi-language sites in scope for v0.1?

## Implementation protocol

1. Explore (or scaffold) and report findings in ≤15 bullets
2. Propose architecture + file tree + slice plan → WAIT
3. Implement Slice 1 only after approval
4. After each slice: tests + demo command + short ADR of decisions/deferrals
5. Prefer smallest design that passes acceptance tests
6. On any UI slice: explicitly confirm UI/UX Pro Max was consulted (style, palette, fonts, UX)

## First response format

Return ONLY:

- Architecture proposal
- File tree
- Slice 1 detailed tasks
- Open questions list
- Confirmation that UI/UX Pro Max skill paths are present

NO production code until I reply “approved”.
