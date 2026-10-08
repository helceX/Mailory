#!/usr/bin/env bash
# Runs every browser e2e suite against a real `next dev` server, started and stopped by this script.
# Needs: DATABASE_URL and REDIS_URL (migrated database), a Chromium for playwright-core (CHROMIUM_PATH or the default
# playwright cache), and `pnpm install` done. Usage: pnpm test:e2e [suite ...]   (default: all)
set -uo pipefail
cd "$(dirname "$0")/.."

: "${DATABASE_URL:?DATABASE_URL is required}" "${REDIS_URL:?REDIS_URL is required}"
PORT="${E2E_PORT:-3100}"
BASE="http://localhost:${PORT}"
TMP="$(mktemp -d)"
SUITES=("$@")
[ ${#SUITES[@]} -eq 0 ] && SUITES=(audience templates senders campaigns sending automation ai api import dashboard cleanup domaincheck)

if [ -z "${CHROMIUM_PATH:-}" ]; then
  CHROMIUM_PATH="$(node -e "try{console.log(require('playwright-core').chromium.executablePath())}catch{}")"
  [ -x "$CHROMIUM_PATH" ] || unset CHROMIUM_PATH
  export CHROMIUM_PATH
fi

export MOCK_DNS_FILE="$TMP/dns.json"; echo '{}' > "$MOCK_DNS_FILE"
export SESSION_SECRET="$(printf 'a%.0s' {1..64})"      # the sending e2e signs unsubscribe tokens with the same secret
export APP_URL="$BASE" E2E_BASE_URL="$BASE" DNS_RESOLVER=mock AI_PROVIDER=mock

setsid bash -c "cd apps/web && exec npx next dev -p ${PORT}" > "$TMP/web.log" 2>&1 &
SERVER=$!
cleanup() { kill -- "-${SERVER}" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

for _ in $(seq 1 120); do
  curl -sf "${BASE}/api/health" >/dev/null && break
  sleep 1
done
curl -sf "${BASE}/api/health" >/dev/null || { echo "server did not start:"; tail -30 "$TMP/web.log"; exit 1; }
# Warm the compiler for the routes every suite touches, so the first test of a suite is not a cold compile.
for p in /login /register /dashboard /templates; do curl -s -o /dev/null "${BASE}${p}" || true; done

clear_limits() {
  (cd apps/web && node -e "
    const { Redis } = require('ioredis');
    const r = new Redis(process.env.REDIS_URL);
    (async () => { const keys = [...(await r.keys('rl:*')), ...(await r.keys('dc:*'))]; if (keys.length) await r.del(keys); await r.quit(); })();
  ") || true
}

FAILED=()
for s in "${SUITES[@]}"; do
  echo "=== e2e: ${s}"
  clear_limits
  if ! timeout 600 node "e2e/${s}.e2e.cjs"; then FAILED+=("$s"); fi
done

echo
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "FAILED suites: ${FAILED[*]}"
  echo "--- last server log lines:"; tail -20 "$TMP/web.log"
  exit 1
fi
echo "all e2e suites passed (${#SUITES[@]})"
