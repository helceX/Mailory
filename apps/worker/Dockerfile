# Production image for the queue worker. Build from the MONOREPO ROOT:
#   docker build -f apps/worker/Dockerfile -t mailory-worker .
# Workspace packages ship raw TypeScript, so the worker runs through tsx
# (called directly: pnpm/corepack would need a writable HOME).
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/deliverability/package.json packages/deliverability/package.json
COPY packages/email/package.json packages/email/package.json
COPY packages/sending/package.json packages/sending/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/validation/package.json packages/validation/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm --filter @mailory/worker build

FROM node:22-bookworm-slim AS runner
WORKDIR /repo
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 worker && adduser --system --uid 1001 worker
COPY --from=builder --chown=worker:worker /repo ./
USER worker
CMD ["apps/worker/node_modules/.bin/tsx", "apps/worker/src/index.ts"]
