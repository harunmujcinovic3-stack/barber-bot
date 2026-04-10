# Playwright base image met Chromium voorgeïnstalleerd
# Dit scheelt ~5 min build tijd en is veel stabieler dan Playwright apart installeren
FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

# Installeer dependencies (gebruik ci voor reproduceerbare builds)
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Kopieer de rest van de code
COPY . .

# Persistent data directory (Railway volume wordt hier gemount)
RUN mkdir -p /data/screenshots
ENV DATA_DIR=/data
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start het Klippr process
CMD ["node", "index.js"]
