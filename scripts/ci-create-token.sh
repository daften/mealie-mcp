#!/usr/bin/env bash
# Logs in as the admin account a fresh Mealie seeds, and emits a long-lived API token to stdout.
# Requires the mealie-ci container to be running (docker-compose.ci.yml).
set -euo pipefail

MEALIE_URL=${1:-http://localhost:9925}
# Mealie's documented first-run defaults, on an ephemeral CI container. Not secrets.
ADMIN_EMAIL=changeme@example.com
ADMIN_PASSWORD=MyPassword

# Wait for the API, and for the first-run seeding that creates the admin (up to 6 minutes). The
# about route answers before seeding has finished, so a successful login is the real signal.
echo "Waiting for Mealie at $MEALIE_URL …" >&2
SESSION=""
for i in $(seq 1 72); do
  SESSION=$(curl -sf -X POST "$MEALIE_URL/api/auth/token" \
    --data-urlencode "username=$ADMIN_EMAIL" --data-urlencode "password=$ADMIN_PASSWORD" 2>/dev/null \
    | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p') || true
  if [ -n "$SESSION" ]; then
    echo "Mealie ready after $((i * 5))s" >&2
    break
  fi
  if [ "$i" -eq 72 ]; then
    echo "Timed out waiting for Mealie" >&2
    exit 1
  fi
  sleep 5
done

RAW=$(curl -sf -X POST "$MEALIE_URL/api/users/api-tokens" \
  -H "Authorization: Bearer $SESSION" -H 'Content-Type: application/json' \
  -d '{"name":"CI Integration Test"}')
TOKEN=$(echo "$RAW" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

if [ -z "$TOKEN" ]; then
  echo "Failed to extract the token from Mealie's response" >&2
  exit 1
fi

echo "$TOKEN"
