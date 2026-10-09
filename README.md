# Mailory

Multi-tenant email marketing & campaign automation SaaS (mailory.io).
Planning docs live in `docs/` — start with `docs/MAILORY_DISCOVERY.md`; task status in `docs/MAILORY_TASKS.md`. All 18 phases are implemented; what still needs a human (deploy, SES, DNS, legal, pricing) is in `docs/MAILORY_OPEN_ITEMS.md`. Operations: `docs/MAILORY_RUNBOOK.md`; pilot: `docs/MAILORY_PILOT.md`; public API: `docs/MAILORY_API.md`; pricing hypothesis: `docs/MAILORY_PRICING.md`.

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
