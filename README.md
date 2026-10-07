# Mailory

Multi-tenant email marketing & campaign automation SaaS (mailory.io).
Planning docs live in `docs/` — start with `docs/MAILORY_DISCOVERY.md`; task status in `docs/MAILORY_TASKS.md`.

## Layout

`apps/web` (Next.js) · `apps/worker` (BullMQ) · `packages/{config,db,ui}`

## Local setup

Needs Node >= 22.12, pnpm 10, PostgreSQL 16+, Redis.

```
pnpm install
cp .env.example apps/web/.env.local   # also apps/worker, packages/db
pnpm db:migrate
pnpm dev            # http://localhost:3000   (health: /api/health, /api/health/ready)
pnpm dev:worker
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
