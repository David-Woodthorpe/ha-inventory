# syntax=docker/dockerfile:1

# Home Assistant passes these build arguments when it builds the add-on. They
# are optional for plain Docker builds.
ARG BUILD_ARCH
ARG BUILD_VERSION

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# gosu lets the entrypoint drop from root (needed to prepare /data) to the
# unprivileged node user before starting the server.
RUN apt-get update \
  && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps \
  && npm cache clean --force

COPY --from=build /app/build ./build
COPY server.js ./server.js
COPY scripts/seed.mjs ./scripts/seed.mjs
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV DATA_DIR=/data \
    PORT=3000

VOLUME ["/data"]
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
