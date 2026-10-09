#!/usr/bin/env bash
# Pull the current branch, rebuild images, run migrations, restart. Run on the EC2 host from deploy/aws.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env missing (cp .env.example .env)"; exit 1; }
git -C ../.. pull --ff-only
PROFILE=()
grep -q '^DATABASE_URL=.*@db:' .env && PROFILE=(--profile with-db)
docker compose "${PROFILE[@]}" build
docker compose "${PROFILE[@]}" up -d --remove-orphans
docker image prune -f >/dev/null
for _ in $(seq 1 60); do
  curl -sfk "https://$(grep ^APP_DOMAIN= .env | cut -d= -f2)/api/health/ready" >/dev/null && { echo "healthy"; exit 0; }
  sleep 2
done
echo "NOT healthy — check: docker compose logs web worker migrate"; exit 1
