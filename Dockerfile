# One image for the whole app: API + dashboard (served by the API) + Playwright Chromium for crawling,
# browser checks and Lighthouse + the Shopify CLI for theme deploys. Used by docker compose and Render.
FROM mcr.microsoft.com/playwright:v1.58.2-noble

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    SHOPIFY_CLI_NO_ANALYTICS=1 \
    STORAGE_DIR=/app/storage \
    PORT=4100
WORKDIR /app

# Shopify CLI for "Deploy to unpublished theme". On a server, set SHOPIFY_CLI_THEME_TOKEN (a Theme Access
# password) and SHOPIFY_STORE; locally the CLI uses your own login instead.
RUN npm install -g @shopify/cli@5.0.1 --no-audit --no-fund

# Dependencies first so source edits don't bust the npm layer (dev deps are needed for the builds).
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --no-audit --no-fund

COPY . .
RUN npx -w backend prisma generate \
 && npm run -w backend build \
 && npm run -w frontend build \
 && node scripts/build-theme.mjs

ENV NODE_ENV=production
EXPOSE 4100
# Apply migrations, then start the compiled API (it also serves the dashboard at /).
WORKDIR /app/backend
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/app.js"]
