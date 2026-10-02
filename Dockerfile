# One image, one process: the Bun server hosts both the WebSocket API and the
# built web client, so a deployment is a single URL. Adapted from the No Mercy
# image, including the "copy one coherent tree" fix that avoids broken workspace
# symlinks in the runtime stage.

FROM oven/bun:1.4.2-alpine AS base
WORKDIR /app

# --- deps -------------------------------------------------------------------
# Copied separately so a source-only change does not re-resolve dependencies.
FROM base AS deps
COPY package.json bun.lock ./
COPY packages/crypto/package.json   packages/crypto/
COPY packages/protocol/package.json packages/protocol/
COPY packages/server/package.json   packages/server/
COPY packages/web/package.json      packages/web/
RUN bun install --frozen-lockfile

# --- build the client -------------------------------------------------------
FROM deps AS build
COPY tsconfig.json ./
COPY packages ./packages
# The client talks to its own origin (relative /api and /ws), so there is no
# build-time server address to bake in.
RUN cd packages/web && bunx vite build

# --- runtime ----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
# One coherent tree, node_modules included, so workspace imports resolve.
COPY --from=build /app ./

ENV PORT=4040
ENV COPSE_STATIC=/app/packages/web/dist

# Local-SQLite mode writes a file, and this image runs as a non-root user over a
# root-owned /app - so the default of ./copse.db could not be created at all
# (SQLITE_CANTOPEN, which reads like a corrupt database and is really a
# directory the process cannot write). State gets its own writable directory,
# outside the code tree, declared as a volume so `docker rm` does not quietly
# take the messages with it. Mount a named volume (-v copse-data:/data) to keep
# them across a recreate. Hosted mode (TURSO_DATABASE_URL) ignores all of this.
RUN mkdir -p /data && chown bun:bun /data
ENV COPSE_DB=/data/copse.db
VOLUME /data

# COPSE_BOOTSTRAP must be provided at run time, or no first room can be created.
EXPOSE 4040

USER bun

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||4040)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "packages/server/src/main.ts"]
