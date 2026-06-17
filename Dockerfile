FROM node:22-bookworm-slim

WORKDIR /app

# better-sqlite3 собирается из исходников
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY src ./src
COPY scripts ./scripts
COPY env.example ./

RUN mkdir -p data/media

ENV NODE_ENV=production
ENV TZ=UTC

CMD ["node", "src/index.js"]
