# 🏗️ RMC Pro — Plant SaaS

A multi-tenant SaaS platform (with an offline-capable standalone plant app) for Ready Mix Concrete plant operations.

> **Status:** Development Stage — Phase 1. Requirement and Design stages are complete and signed off (see `docs/`). This repository is the monorepo skeleton; modules are built per the Phase-1 sprint plan.

## Documentation

| Area | Location |
|------|----------|
| Requirement baseline | `docs/requirements/SRS-v1.4.md` |
| Design documents (12 + RBAC addendum + sign-off) | `docs/design/` |
| Development plan (Phase 1) | `docs/development/DEV-PLAN-01-phase1-development-stage-plan.md` |
| Original PWA prototype (archived reference) | `prototype/` |

## Tech Stack

Next.js (web) · NestJS (API) · PostgreSQL · Redis · SQLite (plant app, offline) · S3-compatible object storage · Electron (standalone plant app) · Docker / Nginx. Monorepo via **pnpm workspaces + Turborepo**.

## Repository Layout

```text
apps/
  api/         NestJS backend (REST + WebSocket)
  web/         Next.js web portal (tenant + super admin)
  plant-app/   Electron standalone plant app (added in Sprint 10)
packages/
  shared/      shared TS types, enums, error codes, permission keys
docker/        local infra (Postgres + Redis + MinIO)
docs/          requirements · design · development
prototype/     archived original PWA prototype
```

## Getting Started (local)

Prerequisites: Node ≥ 20, pnpm 10, Docker.

```bash
# 1. install
pnpm install

# 2. copy env
cp .env.example .env

# 3. start local infra (Postgres, Redis, MinIO)
docker compose -f docker/docker-compose.yml up -d

# 4. run apps (api on :4000, web on :3000)
pnpm dev
```

Health checks: API `http://localhost:4000/health` · Web `http://localhost:3000/api/health`.

## Scripts

```bash
pnpm dev         # run all apps in watch mode (turbo)
pnpm build       # build all packages/apps
pnpm typecheck   # type-check everything
pnpm lint        # eslint
pnpm format      # prettier write
```

## License

MIT — free to use and modify.
