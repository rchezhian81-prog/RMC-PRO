# syntax=docker/dockerfile:1
#
# RMC API (NestJS) production image.
# Build context MUST be the repository root (monorepo) — the compose file uses
# `context: ..` because it lives in ./docker. Example manual build:
#   docker build -f apps/api/Dockerfile -t rmc-api:local .
#
# The runtime image is dev-dependency-free (built via `pnpm deploy --prod`) and
# runs compiled JS only — migrations/seed use dist/*.js, no ts-node needed.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ---- install deps + build + prune ----
FROM base AS build
# Workspace manifests first for better layer caching.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# Sources.
COPY packages/shared packages/shared
COPY apps/api apps/api
# Build shared then api, then produce a pruned, self-contained deploy dir.
RUN pnpm --filter @rmc/shared build \
 && pnpm --filter @rmc/api build \
 && pnpm --filter @rmc/api deploy --prod --legacy /prod/api

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /prod/api ./
# Drop privileges (node user ships with the base image).
USER node
EXPOSE 4000
# Container-level health probe against the unprefixed /health route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
