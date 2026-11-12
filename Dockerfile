# One image for the whole app: API + dashboard (served by the API) + Playwright Chromium for crawling,
# browser checks and Lighthouse. The Playwright base image already contains Chromium and its system libraries.
FROM mcr.microsoft.com/playwright:v1.58.2-noble

ENV NODE_ENV=development \
    PORT=4100 \
    STORAGE_DIR=/app/storage \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    SHOPIFY_CLI_NO_ANALYTICS=1
WORKDIR /app

# Install dependencies first so source edits don't bust the npm layer.
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --no-audit --no-fund

COPY . .
RUN npx -w backend prisma generate \
 && npm run -w frontend build \
 && node scripts/build-theme.mjs

EXPOSE 4100
# Apply migrations, then start the API (which also serves the dashboard at /).
CMD ["sh", "-c", "npx -w backend prisma migrate deploy && npm run -w backend start"]
