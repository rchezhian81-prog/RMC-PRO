# syntax=docker/dockerfile:1
#
# RMC Web (Next.js) production image.
# Build context MUST be the repository root (monorepo). Example manual build:
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://rmc.<DOMAIN> -t rmc-web:local .
#
# IMPORTANT: NEXT_PUBLIC_API_URL is baked into the client bundle at BUILD time.
# It must be the public API origin (Option A: https://rmc.<DOMAIN>). Rebuild the
# image to change it — a runtime env var will NOT take effect.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app

# ---- install deps + build ----
FROM base AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# UI V2 rollout flag (PRESENTATION ONLY), baked into the bundle at build time like
# every NEXT_PUBLIC_* value. Defaults to empty -> resolveUiV2() reads OFF, so the
# canonical production image is byte-for-byte the current UI. Only a build that
# explicitly passes --build-arg NEXT_PUBLIC_UI_V2=1 (the -uiv2 preview image)
# ships the Deep Violet Matte skin. A runtime env var can NOT flip this.
ARG NEXT_PUBLIC_UI_V2
ENV NEXT_PUBLIC_UI_V2=$NEXT_PUBLIC_UI_V2
ENV NEXT_TELEMETRY_DISABLED=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @rmc/shared build && pnpm --filter @rmc/web build

# ---- runtime (standalone server) ----
FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
# Standalone output mirrors the monorepo layout under apps/web/.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
# `output: standalone` does NOT bundle public/ — copy it explicitly, or every
# /public asset (brand logos, etc.) 404s in production.
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
