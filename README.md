# AI Landing Page Builder for Shopify

Paste a product URL. The system reads the product and the brand, studies competitor product pages, keeps what it learns per category, and generates **four distinct landing pages** (story-led, benefit-grid, social-proof, offer-led) as real **Shopify OS 2.0 sections and JSON templates**. These are editable in the theme editor and have a working add-to-cart and a sticky mobile ATC. Each page is checked for SEO / AEO / GEO, structured data, layout at 360/768/1440 and Lighthouse. It ships as a theme ZIP or is pushed with the Shopify CLI to an **unpublished** theme.

- **Dashboard:** http://localhost:5180 in development, or http://localhost:4180 in Docker.
- **Results from 5 real products:** [docs/results/RESULTS.md](docs/results/RESULTS.md)
- **Demo script:** [docs/DEMO.md](docs/DEMO.md)

---

## Quick start

### Option A: Docker (one command)

```bash
cp .env.example backend/.env        # add ANTHROPIC_API_KEY (and optionally SERPER/TAVILY, SHOPIFY_STORE)
docker compose up --build
```

Open http://localhost:4180. Postgres, migrations, the API and the dashboard all start together. Chromium for crawling, checks and Lighthouse is included in the image.
*Deploying to Shopify from inside the container needs a logged-in Shopify CLI. Use the theme ZIP download there, or run locally for CLI deploys.*

### Option B: local development

Requirements: Node 20+, Docker (for Postgres).

```bash
npm install
npx -w backend playwright install chromium
cp .env.example backend/.env        # fill in your keys
npm run db:up                       # Postgres on host port 5440
npx -w backend prisma migrate deploy
npm run dev:backend                 # API on http://localhost:4100
npm run dev:frontend                # dashboard on http://localhost:5180
```

Optional: `npm i -g @shopify/cli`, then run `shopify theme list --store <your-store>.myshopify.com` once to log in. After that the dashboard's **Deploy** button can push to an unpublished theme.

### Environment (`backend/.env`)

| Variable | Needed for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | brand tone and page copy | Claude Haiku by default (`LLM_MODEL_MAIN/FAST`). A full run costs about **$0.005**. |
| `SERPER_API_KEY` / `TAVILY_API_KEY` / `BRAVE_API_KEY` | competitor search | Any one is enough. Without one, a curated Indian D2C starter list is used, and you can also paste competitor URLs. |
| `SHOPIFY_STORE` | deploy and preview links | e.g. `my-dev-store.myshopify.com` |
| `SHOPIFY_STOREFRONT_PASSWORD` | storefront checks | Only for password-protected dev stores. |
| `DATABASE_URL` | Postgres | Defaults to the compose database on port 5440. |

### Tests and checks

```bash
npm run typecheck
npm test                 # vitest: renderer, schema validation, fingerprints, SSRF guard, extraction, e2e preview
npm run theme:check      # builds the theme and runs Shopify Theme Check (0 errors expected)
npm run evaluate         # end-to-end run on 5 products -> docs/results/RESULTS.md
```

---

## How it works

```
URL ─► Product ─► Brand ─► Tone ─► Competitors ─► Learnings ─► Generate (x4) ─► Validate ─► Package / Deploy
        facts     tokens   LLM     search+crawl   counted in    plan (code)     checklist    ZIP or CLI push
        (code)    (code)            (code)        code + memory copy (LLM)      browser      (unpublished)
                                                                render (code)   Lighthouse
```

The guiding rule: **code decides structure and facts, and the LLM only writes words.** The model never writes Liquid, HTML, prices, ratings, reviews or claims. Its output is a small JSON object validated by zod, and the renderer turns it into Shopify JSON templates that are validated again against the sections' real `{% schema %}`.

### 1. Product analysis (`backend/src/extract`, `services/analyze.ts`)
- Shopify stores are read from `/products/<handle>.js` first (variants, prices, images, options). Other stores fall back to JSON-LD, then the DOM.
- **Facts** are built with their evidence: specs from tables and lists, store promises (COD, free shipping, returns) from the page text, and real reviews and ratings only when the page has them. Every claim keeps the text it came from.
- **SSRF guard** (`net/url-guard.ts`): only public IPs (checked at DNS-lookup time through an undici Agent hook), only ports 80/443, redirects re-validated, robots.txt respected, polite per-host spacing.

### 2. Brand (`extract/brand-capture.ts`, `brand-derive.ts`, `catalogue/fonts.ts`)
- Playwright renders the page and reads computed styles of real elements (buttons, headings, body, links), plus a k-means palette from a screenshot.
- Colours are ranked by where they're used. Browser default colours (link blue and similar) are ignored. Contrast is enforced (accent ≥ 4.5:1 on its background).
- Fonts are mapped to the **verified Shopify font library**, so `font_picker` settings are always valid.
- Haiku classifies tone and image style, with confidence values. Everything can be corrected in the dashboard, which re-renders the designs.

### 3. Competitors and learnings (`backend/src/research`)
- Search runs through Serper, Tavily or Brave with an Indian D2C bias. Without a search key it uses a curated per-category starter list and resolves each store to a matching product page.
- Each page is crawled at desktop and mobile size and turned into **page signals** (sticky ATC, reviews near the price, FAQ, size guide, pincode or delivery check, comparison table, and so on).
- **Learnings are counted in code**, e.g. "6 of 6 pages: size guide", and each links to the pages that show it. They're stored per category (`CategoryLearning`), so later runs in the same category start with that knowledge.
- Failures (blocked, timeout, robots) are recorded and shown. Nothing is padded to reach 8 competitors.

### 4. Generation and memory (`backend/src/design`, `services/generate.ts`, `ai/copy.ts`)
- **Planner (code):** each direction has 18–24 structural variants: hero type, section order, image layout, colour strategy (light / banded / contrast / warm), density and radius. Sections whose facts are missing are dropped, never invented. For example, there's no reviews section without real reviews and no fact strip without at least 2 measured specs.
- **Fingerprints:** every design is reduced to `sectionOrder`, `heroType`, `composition`, `visualStyle`, `imageLayout` and `atcPlacement`. Weighted similarity uses 25 / 20 / 20 / 15 / 10 / 10. Candidates are scored against **sibling designs and every earlier design in the category**, and anything above **0.75** is re-rolled. The dashboard shows the explanation, e.g. "section order: 67% similar".
- **Feedback memory:** similarity to a *rejected* design counts ×1.2, so look-alikes are avoided more strongly. Similarity to an *approved* design counts ×0.9, so future runs may stay closer to it. Reasons and tags are stored and shown.
- **Copy (Haiku):** one structured call per design (`messages.parse` with a zod schema). Numbers in the copy that aren't in the facts are flagged in `copyCheck.unsupportedNumbers` and fail the GEO checklist.
- **Regenerate** replaces one design with a new one that must differ from the others.

### 5. Shopify theme (`shopify/`, `scripts/build-theme.mjs`)
- `shopify/base` is **Dawn v16.1.1**, vendored. `shopify/lp` is our section library, overlaid on top of it. The build produces a complete, valid theme.
- **15 sections:** `lp-hero`, `lp-purchase`, `lp-sticky-atc`, `lp-benefits`, `lp-specs`, `lp-faq`, `lp-gallery`, `lp-comparison`, `lp-reviews`, `lp-trust`, `lp-offer`, `lp-story`, `lp-facts`, `lp-marquee`, `lp-seo`. Each has colour, font_picker, image, text and show/hide settings, and blocks for repeated items, so merchants can edit everything in the theme editor.
- **Add to cart reads the live `product` object.** Variant IDs, prices and availability always come from the store the theme is installed on. `lp-cart.js` (vanilla, no dependencies) handles variant and quantity state, `/cart/add.js`, errors, sold-out state, Dawn's cart notification or drawer and the sticky ATC (IntersectionObserver).
- **Structured data:** `lp-seo` emits Product (one Offer per variant) and BreadcrumbList, and `lp-faq` emits FAQPage, all built only from real data.
- One design becomes `templates/product.lp-<handle>-<direction>.json`.

### 6. Previews and validation (`backend/src/render`, `backend/src/validate`)
- **One renderer for previews and Shopify:** the dashboard previews render the **same `.liquid` files** with LiquidJS and a small Shopify shim. They aren't a separate HTML imitation.
- The **checklist** is read from the rendered page and covers SEO, AEO, GEO and schema: one H1, heading order, alt text, lazy and responsive images, Product / Offer / FAQ / Breadcrumb schema, answer-style FAQ, facts stated in text, no unsupported numbers, and so on. Each item is *passed*, *failed*, *needs verification* or *n/a*. Items the theme layout renders (meta title, canonical) are marked *needs verification* rather than claimed.
- **Browser checks (Playwright):** 360/768/1440 screenshots, horizontal overflow, H1 count, JS errors, a real click on Add to cart (the cart request is captured), sticky ATC behaviour, and whether the ATC is visible on the first 360×740 screen.
- **Lighthouse 12** (mobile) runs on the local render.

### 7. Publish (`services/publish.ts`, `services/shopify-cli.ts`)
- **Theme ZIP:** Dawn plus the sections plus the selected (by default approved) templates, uploadable through Online Store → Themes → Upload.
- **CLI deploy:** `shopify theme push --unpublished` or `--theme <id> --nodelete`. Before every push the CLI's theme list is checked, and **the live theme is refused**. The CLI runs with an argument array and no shell, and every argument is validated. Each push is recorded with preview links (`?preview_theme_id=…&view=<template>`) and theme editor links.
- A **product CSV** export lets you import the source product into a dev store without the Admin API.

### Dashboard (`frontend/`)
React, Vite, Tailwind and react-query. Run progress streams over SSE. The tabs are:
- **Product:** facts with their evidence, stages, cost, tokens
- **Brand:** editable tokens, fonts and tone
- **Competitors:** screenshots, signals, failures, and learnings with counts and evidence links
- **Designs:** live previews, similarity explanation, approve / reject / regenerate
- **Checks and publish:** checklist, screenshots, Lighthouse, ZIP, deploy history

There's also a **History** page listing every run.

---

## What approving a design does
1. It marks the design *approved* in the dashboard.
2. It's included by default in the theme package and the CLI deploy.
3. It acts as a positive memory signal for the next runs in that category.

**Nothing goes live.** Deploys only go to an unpublished theme. To use a page, publish the theme yourself and pick the template under *Products → Theme template*.

---

## Known limits (honest)
- **Template assignment:** the CLI can't assign a template to a product, so you choose it in the product editor. Before that, every design can be previewed with `?view=`. The Admin API path (`themeCreate` / `themeFilesUpsert` / `productUpdate templateSuffix`) is the upgrade route and isn't built yet.
- **Competitor coverage:** with no search credits, the starter list sometimes yields fewer than 8 usable pages. The run says so instead of padding.
- **Lighthouse and browser checks** run on the local render, because dev stores are password protected. Storefront scores will differ because Shopify adds its own scripts.
- **Rich Results Test:** JSON-LD is validated locally. Google's Rich Results Test is a manual check.
- **Design saturation:** after many runs of the same product, a direction can run low on distinct variants (about 0.8 similarity). The planner reports it instead of shipping a duplicate.
- **Docker image:** it doesn't carry a Shopify CLI login, so deploys run from a local checkout.

## Next steps
- Admin API adapter: create the theme, upsert files and assign the template in one step.
- Lighthouse and the cart test against the deployed storefront preview, using the storefront password.
- Vision-model extraction of competitor layouts to add to the DOM signals.
- More hero and section variants per direction, and A/B results fed back into memory.

## Repository layout
```
backend/            Express + TypeScript + Prisma (Postgres)
  src/extract       product, brand, reviews, specs, claims
  src/research      search, crawl, page signals, learnings
  src/design        planner, fingerprints, data-only sections
  src/ai            Claude client (usage + cost), tone, copy
  src/render        JSON template renderer, LiquidJS preview, styles, schema validation
  src/validate      SEO/AEO/GEO checklist, browser checks, Lighthouse
  src/services      run pipeline, checks, publish, Shopify CLI
frontend/           React dashboard
shopify/base        Dawn v16.1.1 (vendored)
shopify/lp          lp-* sections, snippets, assets
scripts/            theme build, evaluation, static preview server
docs/               results, demo script
```
