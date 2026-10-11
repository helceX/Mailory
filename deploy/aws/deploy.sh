#!/usr/bin/env bash
# Pull the current branch, rebuild images, run migrations, restart. Run on the EC2 host from deploy/aws.
set -euo pipefail
cd "$(dirname "$0")"
export COMPOSE_FILE=docker-compose.prod.yml
[ -f .env ] || { echo ".env missing (cp .env.example .env)"; exit 1; }
git -C ../.. pull --ff-only
PROFILE=()
grep -q '^DATABASE_URL=.*@db:' .env && PROFILE=(--profile with-db)
docker compose "${PROFILE[@]}" build
# A completed migration container must run again on each deployment.
docker compose "${PROFILE[@]}" up -d --force-recreate migrate
docker compose "${PROFILE[@]}" up -d --remove-orphans
docker image prune -f >/dev/null
for _ in $(seq 1 60); do
  curl -sfk "https://$(grep ^APP_DOMAIN= .env | cut -d= -f2)/api/health/ready" >/dev/null && { echo "healthy"; exit 0; }
  sleep 2
done
echo "NOT healthy — check: docker compose logs web worker migrate"; exit 1
