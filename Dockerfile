# AI Affiliate Studio — single-container image (web + inline worker + PGlite on a volume).
# Used by Fly.io (fly.toml) but works with any Docker host.

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# ffmpeg-static downloads its Linux binary in an install script (allowed via package.json "allowScripts").
RUN npm ci
COPY . .
# devDependencies are kept: `next start` loads next.config.ts and they are needed for `npm run db:*`.
RUN npm run build

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/assets ./assets
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/worker ./worker
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json /app/next.config.ts /app/drizzle.config.ts ./
EXPOSE 3000
# Bind explicitly: Fly sets HOSTNAME to the machine id, which would make Next listen on one interface only.
# Cap the V8 heap so GC runs before the 1GB VM is exhausted (PGlite WASM memory sits outside the heap).
ENV NODE_OPTIONS=--max-old-space-size=384
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
