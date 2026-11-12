# Demo script (about 6 minutes)

**Before you start:**
- Backend and dashboard are running (`npm run dev:backend`, `npm run dev:frontend`, or `docker compose up --build`).
- The Shopify CLI is logged in.
- One run is already finished, in case the network is slow. The live run takes about 90 seconds.

Have these open in tabs:
- Dashboard (http://localhost:5180)
- [docs/results/RESULTS.md](results/RESULTS.md)
- Shopify admin → Online Store → Themes

---

### 0:00 – Problem and approach (30s)
> "You paste a product URL and get four genuinely different landing pages as native Shopify sections. The merchant can edit them in the theme editor, add to cart works, and they're checked before anything is published. One rule runs through the whole thing: code decides structure and facts, and the model only writes words. So nothing on the page is invented."

### 0:30 – Start a run (45s)
1. On **Home**, paste `https://beminimalist.co/products/lip-peptide-complex-lip-mask` (or any Shopify product URL) and start the run.
2. Point at the live stage list (streamed over SSE): product → brand → tone → competitors → learnings → generate → validate.
3. While it runs, open a finished run from **History**.

### 1:15 – Product and brand (60s)
- **Product tab:** variants and prices from `/products/<handle>.js`, plus specs, store promises (COD, returns), and reviews only if the page has them. Each one shows where it came from.
- **Brand tab:** colours read from real rendered elements (browser default blue is ignored), fonts mapped to Shopify's font library, and tone with confidence values.
  - Change the primary colour and show that the designs re-render. This shows the brand profile is the single source of truth.

### 2:15 – Competitors and learnings (60s)
- **Competitors tab:** desktop and mobile screenshots of Indian D2C product pages, with blocked or failed pages listed honestly.
- **Learnings:** "6 of 6 pages show a size guide", each with links to the pages. Point out that the counts are computed in code, not by the LLM, and stored per category, so the next run starts with them.

### 3:15 – Designs and memory (75s)
- **Designs tab:** four directions with different hero types, section orders and colour strategies. Scroll one live preview; it's rendered from the same `.liquid` files Shopify uses.
- Open the similarity panel, e.g. "nearest sibling 0.59; section order 67% similar". Anything above 0.75 is re-rolled, and designs are compared against every earlier design in the category.
- **Reject** one with the tag *too similar*, then **Regenerate** it. The new one has to be different.
- **Approve** another. Its corner marks turn magenta, it goes into the package by default, and it steers future runs. Nothing goes live.
- Optional: show `RESULTS.md` → *Same product, second run*. The second run of the lip mask picks different layouts because memory penalises the first run's fingerprints.

### 4:30 – Checks (45s)
- **Checks & publish:** run the checks. The SEO/AEO/GEO/schema checklist shows passed / failed / needs verification, so it doesn't over-claim.
- Show the 360/768/1440 screenshots, the add-to-cart click, the sticky ATC, whether the ATC is visible on the first mobile screen, and the Lighthouse scores (local render, labelled as such).

### 5:15 – Publish (45s)
1. **Download the theme ZIP** (Dawn plus our sections and templates), or click **Deploy** to push to the unpublished theme. The live theme is refused.
2. Open the preview link (`?preview_theme_id=…&view=lp-…`) on the store and add to cart. This is the real Shopify cart, using the store's own variant IDs.
3. Open the theme editor link and change a heading font and a colour on one section.

### 6:00 – Wrap up (30s)
> "Five products across three categories are in RESULTS.md, with every number read back from the API. Known limits: template assignment is manual with CLI-only access (the Admin API adapter is next), and Lighthouse runs on the local render because dev stores are password protected. A full run costs about half a cent with Claude Haiku."
