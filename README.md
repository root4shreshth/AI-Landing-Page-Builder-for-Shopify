# AI Landing Page Builder for Shopify

**Wishluck take-home assignment.** Paste a product URL. The system then:
- reads the product and its brand
- studies competitor product pages, mostly Indian D2C stores
- remembers what it learns for each category
- generates **four genuinely different landing pages**: story-led, benefit-grid, social-proof and offer-led

Each page is real **Shopify OS 2.0 sections plus a JSON template**. Everything is editable in the theme editor, with a working add-to-cart and a sticky mobile ATC. Every page is checked for SEO / AEO / GEO, structured data, layout at 360 / 768 / 1440 and Lighthouse. It ships as a theme ZIP or is pushed with the Shopify CLI to an **unpublished** theme.

---

## For the Wishluck evaluation team

| What | Where |
|---|---|
| **Live app** | https://landing-page-builder-di17.onrender.com (open; free Render instance, so the first visit after 15 idle minutes takes about a minute to wake) |
| **Run it yourself in one command** | `docker compose up --build` → http://localhost:4180 ([details](#option-a-docker-one-command)) |
| **Results for the 5 test products** | [docs/results/RESULTS.md](docs/results/RESULTS.md): Lighthouse report screenshots, schema validation, design fingerprints, ATC and layout checks |
| **Dev store preview and theme editor** | Link, storefront password and collaborator access are in the submission form. They are never stored in this repository. |
| **Screen recording (5–7 min)** | Link in the submission form; it follows the script in [docs/DEMO.md](docs/DEMO.md) |

### Where each scoring area is covered

| Area (marks) | What was built | Where to see it |
|---|---|---|
| **Page design quality (20)** | 15 editorial sections (hero variants, fact strip, brand band, story chapters, comparison and more). The brand's own colours and fonts come from the live page. Four directions with 18–24 structural variants each. Pages match the brand, and data-only sections use verified facts only. | Dashboard **Designs** tab (desktop / tablet / mobile); screenshots in [RESULTS.md](docs/results/RESULTS.md) |
| **Shopify and theme editor (20)** | Dawn v16.1.1 plus our `lp-*` sections. Every text, colour, font, image and show/hide setting is editable in the theme editor. ATC reads the live `product` object, so the store's real variant IDs are used. CLI deploy goes to an unpublished theme, and the live theme is refused. | [Shopify theme](#5-shopify-theme-shopify-scriptsbuild-thememjs), dashboard **Checks & publish** tab, dev store link |
| **SEO, AEO and GEO (15)** | A 24-item checklist read from the rendered page, honest about what it can't verify. Product, Offer, FAQPage and BreadcrumbList JSON-LD come from real data only. FAQ questions about delivery, COD or returns are dropped unless the store confirms that promise. Numbers not in the product data are flagged. | [SEO / AEO / GEO approach](#seo--aeo--geo-approach), RESULTS.md → *Structured data validation* |
| **Competitor research and learnings (15)** | Marketplaces, media and the brand itself are filtered out. Ranking favours Indian D2C stores. Brand home pages are resolved to a matching product page. Learnings are **counted in code** ("6 of 6 pages: size guide") with links to the pages, and every design lists the learnings it applied. No competitor wording is copied. | Dashboard **Competitors** tab, [how competitors are picked](#3-competitors-and-learnings-backendsrcresearch) |
| **Memory and no repeats (10)** | Layout fingerprints scored against sibling designs **and every earlier design in the category**, with 0.75 as the replace threshold. Approve and reject feedback steers later runs. A second run of the same product gives new layouts. | RESULTS.md → *Design fingerprints* and *Same product, second run* |
| **Mobile, speed and ATC (10)** | ATC on the first 360×740 screen, sticky ATC, no overflow, Lighthouse mobile. Every design is tested by clicking Add to cart in a real browser. | RESULTS.md summary: 24/24 cart, 24/24 sticky, 24/24 first-screen ATC, 24/24 no overflow; Lighthouse 97 / 100 / 100 / 100 average |
| **Code, README and video (10)** | TypeScript throughout, zod contracts, 140 tests, Theme Check with 0 errors, honest limits listed below | This README, `npm test`, [Known limits](#known-limits-honest) |
| **Extra marks** | ✅ One-command Docker setup (`docker compose up --build`). ❌ A/B testing and generated product images are not built; see [Next steps](#next-steps). | |

---

## Quick start

### Option A: Docker (one command)

```bash
cp .env.example backend/.env        # add ANTHROPIC_API_KEY (optionally SERPER_API_KEY, SHOPIFY_STORE)
docker compose up --build
```

Open http://localhost:4180. Postgres, migrations, the API and the dashboard start together, and Chromium (for crawling, checks and Lighthouse) is in the image. To deploy to Shopify from the container, set `SHOPIFY_CLI_THEME_TOKEN` (see [Environment](#environment-backendenv)); the theme ZIP download always works.

### Option B: local development

Requirements: Node 20+ and Docker (for Postgres).

```bash
npm install
npx -w backend playwright install chromium
cp .env.example backend/.env        # fill in your keys
npm run db:up                       # Postgres on host port 5440
npx -w backend prisma migrate deploy
npm run dev:backend                 # API on http://localhost:4100
npm run dev:frontend                # dashboard on http://localhost:5180
```

Optionally, install the CLI with `npm i -g @shopify/cli`, then run `shopify theme list --store <your-store>.myshopify.com` once to log in. After that, the dashboard's **Deploy** button pushes to an unpublished theme.

### Option C: hosted (Render + Supabase, both free)

This is how the live app runs.
- **App:** `render.yaml` is a Render Blueprint for the Docker web service.
- **Database:** Supabase Postgres. Unlike Render's free Postgres, it doesn't expire.

1. Create a Supabase project and copy its **Session pooler** connection string (port 5432).
2. On render.com, choose **New → Blueprint** and pick this repository.
3. Fill in the secrets:
   - `DATABASE_URL`: the Supabase string
   - `ANTHROPIC_API_KEY`
   - optional: `APP_PASSWORD` (puts a password on the whole site), `SHOPIFY_STORE`, `SHOPIFY_CLI_THEME_TOKEN`, `SERPER_API_KEY`
4. Click **Apply**. The first build takes about 10 minutes.
5. Optional: copy your local data across with `bash scripts/copy-db.sh`. It reads `TARGET_DATABASE_URL` from `backend/.env`, copies everything in one transaction, refuses a target that already has data, and compares row counts per table.

The free instance has 512 MB RAM and 0.1 CPU, so the blueprint turns on `LOW_MEMORY=1`:
- one job at a time
- Chromium closes between stages
- pages are crawled without scripts or web fonts

It also sets `LIGHTHOUSE=off`; the checks say Lighthouse was skipped rather than showing a score.

### Environment (`backend/.env`)

| Variable | Needed for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | tone and page copy | Claude Haiku by default (`LLM_MODEL_MAIN` / `LLM_MODEL_FAST`). A full run costs about **$0.005**. |
| `SERPER_API_KEY` / `TAVILY_API_KEY` / `BRAVE_API_KEY` | competitor search | Any one is enough. Without one, a curated Indian D2C starter list is used, and you can paste competitor URLs too. |
| `SHOPIFY_STORE` | deploy and preview links | e.g. `my-dev-store.myshopify.com` |
| `SHOPIFY_CLI_THEME_TOKEN` | deploy from a server | A [Theme Access](https://apps.shopify.com/theme-access) password; replaces the interactive CLI login |
| `SHOPIFY_STOREFRONT_PASSWORD` | storefront checks | Only for password-protected dev stores |
| `DATABASE_URL` | Postgres | Defaults to the compose database on port 5440 |
| `APP_PASSWORD` | hosted deployments | When set, the whole site asks for this password (any username) |
| `MAX_RUNS_PER_CLIENT_HOUR` / `MAX_RUNS_PER_HOUR` | hosted deployments | Caps on actions that spend LLM credits |
| `LOW_MEMORY` / `LIGHTHOUSE` | small hosts | `LOW_MEMORY=1` for 512 MB instances; `LIGHTHOUSE=off` skips Lighthouse and says so |

### Tests and checks

```bash
npm run typecheck
npm test                 # 140 vitest tests: renderer, schema validation, fingerprints, SSRF guard, extraction, e2e preview
npm run theme:check      # builds the theme and runs Shopify Theme Check (0 errors)
npm run evaluate         # end-to-end run on the 5 products -> docs/results/RESULTS.md
```

---

## How it works

```
URL ─► Product ─► Brand ─► Tone ─► Competitors ─► Learnings ─► Generate (x4) ─► Validate ─► Package / Deploy
        facts     tokens   LLM     search+crawl   counted in    plan (code)     checklist    ZIP or CLI push
        (code)    (code)            (code)        code + memory copy (LLM)      browser      (unpublished)
                                                                render (code)   Lighthouse
```

The guiding rule: **code decides structure and facts; the LLM only writes words.** The model never writes Liquid, HTML, prices, ratings, reviews or claims. Its output is a small JSON object validated by zod. The renderer turns that into Shopify JSON templates, which are validated again against the sections' real `{% schema %}`.

### 1. Product analysis (`backend/src/extract`, `services/analyze.ts`)
- **Where data comes from:** Shopify stores are read from `/products/<handle>.js` first (variants, prices, images, options). Other stores fall back to JSON-LD, then the DOM.
- **Facts with evidence:** specs come from tables and lists, store promises (COD, free shipping, returns) from the page text, and reviews and ratings only when the page really has them. Every claim keeps the text it came from.
- **SSRF guard** (`net/url-guard.ts):**
  - only public IPs, checked at DNS-lookup time
  - only ports 80 and 443
  - redirects are re-checked
  - robots.txt is respected, with polite spacing between requests to the same host

### 2. How the brand analysis works (`extract/brand-capture.ts`, `brand-derive.ts`, `catalogue/fonts.ts`)
- **Styles:** Playwright renders the product page and reads the **computed styles of real elements**: the add-to-cart button, other buttons, headings, body text, links, header and large background areas. It also takes a k-means colour palette from a screenshot.
- **Colours:** brand colours are ranked by evidence: where they appear in the page's styles (buttons, links, backgrounds), confirmed against the screenshot palette. Monochrome sites fall back to the button or text colour, with lower confidence. Browser default colours (link blue and similar) are ignored, and the accent is forced to at least 4.5:1 contrast.
- **Fonts:** mapped to the **verified Shopify font library**, so every `font_picker` setting is valid.
- **Tone:** Haiku classifies tone of voice and image style from the headings, CTAs and a screenshot, with a confidence value for each.
- **Corrections:** every value shows its confidence and can be corrected in the **Brand** tab. Corrections are kept for future runs of that brand.
- **Fallback:** if the page can't be rendered, the run continues with neutral defaults marked as unverified.

### 3. Competitors and learnings (`backend/src/research`)
**How competitors are picked**
1. **Queries** are built from the product's type words, e.g. "oversized hoodie brand india buy online" or "best hoodie brands india d2c".
2. **Filtered out:** marketplaces (Amazon, Flipkart, Myntra, Nykaa and others), social and media sites, review sites, and the brand itself.
3. **Scoring** is deterministic, from 0 to 1. Keyword overlap counts 45%. Page type counts 25% (a product page beats a collection, which beats a home page). An Indian D2C signal adds 15% (a `.in` domain, ₹ pricing, or India in the listing), and search rank adds 15%. Each pick stores a written rationale.
4. **One page per domain.** Brand home and collection pages are resolved to a **matching product page** through the store's `/products.json`.
5. **Without a search key**, a curated per-category list of Indian D2C stores is used, and you can always add your own competitor URLs.
6. **Failures** (blocked, timeout, disallowed by robots.txt) are recorded and shown. Nothing is padded to reach 8.

**How learnings work**
- **Page signals:** each competitor page is crawled at desktop and mobile size and turned into signals: sticky ATC, reviews near the price, FAQ, size guide, delivery or pincode check, comparison table, struck-through price and more.
- **Counted in code, no LLM:** learnings like "5 of 6 pages: FAQ section" are counted, each with links to the pages that show it, and each with a written recommendation for our pages that is only used where our product data supports it.
- **Stored per category** (`CategoryLearning`), so every later run in that category starts with them.
- **Applied visibly:** every design records which learnings it applied (`appliedLearnings`), e.g. "Sticky mobile add-to-cart included" or "Comparison table as a differentiator (rare among competitors)". No competitor text ever reaches the copy prompt; only the counted signals steer layout, and the model is told not to copy competitor wording.

### 4. Layout memory and how designs don't repeat (`backend/src/design`, `services/generate.ts`, `ai/copy.ts`)
- **Planner (code):** each direction has 18–24 structural variants, combining hero type, section order, image layout, colour strategy (light / banded / contrast / warm), density and corner radius. Sections without facts are dropped, never invented: there's no reviews section without real reviews, and no fact strip without at least two measured specs.
- **Fingerprints:** every candidate is reduced to six features: section order (weight 25%), hero type (20%), sections used (20%), visual style (15%), image layout (10%) and ATC placement (10%).
- **Scored against everything that came before:** candidates are compared with the other designs in the same run **and with every earlier design in the category**, stored in `DesignFingerprint`. Anything at **0.75 or above** is replaced by the next least similar candidate. The dashboard explains each score, e.g. "section order: 67% similar".
- **Feedback memory:** similarity to a *rejected* design counts ×1.2, so look-alikes are avoided harder. Similarity to an *approved* design counts ×0.9, so later runs may stay closer to it. Reasons and tags are stored and shown.
- **Copy:** one structured Haiku call per design (`messages.parse` with a zod schema). Earlier headlines in the category are passed in so new copy doesn't repeat them.
- **Regenerate** replaces a single design with one that must differ from the others.

### 5. Shopify theme (`shopify/`, `scripts/build-theme.mjs`)
- **Base theme:** `shopify/base` is **Dawn v16.1.1**, vendored, and `shopify/lp` is our section library on top. The build produces a complete, valid theme.
- **15 sections:** `lp-hero`, `lp-purchase`, `lp-sticky-atc`, `lp-benefits`, `lp-specs`, `lp-faq`, `lp-gallery`, `lp-comparison`, `lp-reviews`, `lp-trust`, `lp-offer`, `lp-story`, `lp-facts`, `lp-marquee` and `lp-seo`. Each has colour, `font_picker`, image, text and show/hide settings, plus blocks for repeated items.
- **Add to cart reads the live `product` object,** so variant IDs, prices and availability always come from the store the theme is installed on. `lp-cart.js` is vanilla JS with no dependencies. It handles variant and quantity state, `/cart/add.js`, errors, sold-out state, Dawn's cart drawer or notification, and the sticky ATC.
- **One template per design:** `templates/product.lp-<handle>-<direction>.json`.

### 6. Previews and validation (`backend/src/render`, `backend/src/validate`)
- **One renderer for previews and Shopify:** dashboard previews render the **same `.liquid` files** with LiquidJS and a small Shopify shim, not a separate imitation.
- **Browser checks (Playwright)**, run for every design:
  - screenshots at 360 / 768 / 1440
  - horizontal overflow and H1 count
  - JS errors
  - a real click on Add to cart, with the cart request captured
  - sticky ATC behaviour
  - whether the ATC is on the first 360×740 screen
- **Lighthouse 12** (mobile preset): scores plus the full HTML report, linked from the **Checks & publish** tab.

### SEO / AEO / GEO approach
- **SEO:** exactly one H1 and a logical heading order. Descriptive alt text on every image. Images below the first screen are lazy-loaded, and all images are responsive (`srcset`, width, height). A breadcrumb links to the collection, and handles are readable. Meta title and canonical come from the theme layout, so they're marked *needs verification* rather than claimed.
- **Structured data:**
  - `lp-seo` emits **Product** with **one Offer per variant** (price, currency, availability) and **BreadcrumbList**.
  - `lp-faq` emits **FAQPage**, matching the visible questions exactly.
  - Ratings appear only when real reviews exist.
  - All of it is checked in the app and on validator.schema.org (see RESULTS.md).
- **AEO (answer engines):**
  - FAQs are answer-first and stand on their own, at 6–70 words each.
  - They cover what shoppers ask: size or fit, material, care, delivery and returns.
  - Policy questions are **removed unless the store confirms that promise**.
- **GEO (generative engines):**
  - facts are stated in plain text, and a quotable specs table appears when specs exist
  - the page says who the product is for
  - the brand is named consistently
  - every number in the copy must exist in the product data, or it's flagged and fails the check
- **Honest results:** each item is *passed*, *failed*, *needs verification* or *n/a*, and nothing is counted as passed without being checked.

### 7. Publish (`services/publish.ts`, `services/shopify-cli.ts`)
- **Theme ZIP:** Dawn plus the sections plus the selected (by default, approved) templates, ready for Online Store → Themes → Upload.
- **CLI deploy:** `shopify theme push --unpublished` or `--theme <id> --nodelete`.
  - **Live theme refused:** the theme list is checked before every push.
  - **Safe CLI calls:** the CLI runs with an argument array and no shell, and every argument is validated.
  - **Recorded:** each push is logged with preview links (`?preview_theme_id=…&view=<template>`) and theme editor links.
- **Product CSV export**, so the source product can be imported into a dev store without the Admin API.

### Dashboard (`frontend/`)
React, Vite, Tailwind and react-query, with run progress streamed over SSE.

| Tab | Shows |
|---|---|
| **Product** | facts with evidence, stages, cost |
| **Brand** | editable tokens, fonts and tone |
| **Competitors** | screenshots, signals and learnings with evidence |
| **Designs** | previews at three widths, similarity explanation, approve / reject / regenerate |
| **Checks & publish** | checklist, screenshots, Lighthouse, ZIP, deploy history |

A **History** page lists every run.

**What approving a design does:**
1. It marks the design approved.
2. It includes the design in the package and deploy by default.
3. It acts as a positive memory signal for later runs in that category.

Nothing goes live: deploys only go to unpublished themes.

---

## Known limits (honest)
- **Template assignment is manual:** with CLI-only access, a template is assigned to a product in the product editor. Until then, every design can be previewed with `?view=`. The Admin API route (`themeCreate` / `themeFilesUpsert` / `productUpdate templateSuffix`) is the upgrade and isn't built.
- **Competitor coverage:** the search API ran out of free credits, so the curated starter list was used. Some products got 3–6 usable competitor pages instead of 8, and each run says so instead of padding.
- **Lighthouse runs on the local render** of the same sections, because the dev store is password protected. Storefront scores will differ, since Shopify adds its own scripts. On the free Render instance, Lighthouse is off.
- **Rich Results Test:** Google's tool only fetches public URLs. The JSON-LD is validated on validator.schema.org instead, and the markup files are in `docs/results/schema/` to paste into the Rich Results Test "Code" tab.
- **Live app files are temporary:** on the free Render instance, preview and screenshot files are lost on every restart. Runs copied from development show their data, but not their preview files, which say "Preview file not found". New runs on the live app have full previews until the next restart. The database (Supabase) is persistent.
- **Live app is slow:** with 0.1 CPU a run takes several minutes, and pages are crawled without scripts, so script-only widgets (some review apps) aren't seen.
- **Design saturation:** after many runs of the same product, a direction can run short of unused layouts. The planner then ships the least similar candidate and reports its score (about 0.8) instead of hiding it.

## Next steps
- **Admin API adapter:** create the theme, upload files and **assign the template** in one step.
- **A/B testing:** split traffic between two approved templates of the same product (a theme snippet with a sticky cookie plus `?view=`), report add-to-cart rate per variant, and feed the winner back into memory.
- **Generated imagery:** banners and lifestyle images in the brand's palette for the hero and story sections.
- **Persistent files:** store previews and screenshots in object storage (Supabase Storage) so the hosted app keeps them across restarts.
- **Storefront testing:** Lighthouse and the cart test against the deployed storefront preview, using the storefront password.
- **Vision model:** extract competitor layouts with a vision model, in addition to the DOM signals.

## Security and privacy
- **Secrets:** they live only in `backend/.env` (git-ignored) or the host's secret settings; `.env.example` holds placeholders.
- **Crawling:** every outbound request goes through the SSRF guard, and robots.txt is respected.
- **Hosted app:** it can be password-protected (`APP_PASSWORD`), and actions that spend LLM credits are capped per visitor and per hour.
- **Shopify:** deploys never touch the live theme.

## Repository layout
```
backend/            Express + TypeScript + Prisma (Postgres)
  src/extract       product, brand, reviews, specs, claims
  src/research      search, candidates, crawl, page signals, learnings
  src/design        planner, fingerprints, data-only sections
  src/ai            Claude client (usage + cost), tone, copy
  src/render        JSON template renderer, LiquidJS preview, styles, schema validation
  src/validate      SEO/AEO/GEO checklist, browser checks, Lighthouse
  src/services      run pipeline, checks, publish, Shopify CLI
  src/net           SSRF guard, robots.txt, access gate and limits
frontend/           React dashboard
shopify/base        Dawn v16.1.1 (vendored)
shopify/lp          lp-* sections, snippets, assets
scripts/            theme build, evaluation, database copy, static preview server
docs/               results (RESULTS.md), demo script
render.yaml         Render Blueprint (hosted deployment)
docker-compose.yml  Postgres + app, one command
```
