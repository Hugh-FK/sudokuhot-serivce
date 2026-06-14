#!/usr/bin/env bash
# Export remote D1 and upload SQL dump to R2.
# Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN is not set." >&2
  echo "GitHub: Settings -> Environments -> production -> Environment secrets" >&2
  exit 1
fi
if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "ERROR: CLOUDFLARE_ACCOUNT_ID is not set." >&2
  exit 1
fi

DB_NAME="${D1_DATABASE_NAME:-sudokuhot-db}"
R2_BUCKET="${R2_BUCKET:-sudokuhot}"
R2_PREFIX="${R2_PREFIX:-d1-backups}"
TS="$(date -u +%Y%m%d-%H%M%S)"
FILE="backups/${DB_NAME}-${TS}.sql"

mkdir -p backups

echo "Exporting D1: ${DB_NAME} -> ${FILE}"
pnpm exec wrangler d1 export "$DB_NAME" --remote --output "$FILE"

R2_KEY="${R2_PREFIX}/$(basename "$FILE")"
echo "Uploading to r2://${R2_BUCKET}/${R2_KEY}"
pnpm exec wrangler r2 object put "${R2_BUCKET}/${R2_KEY}" --file "$FILE"

echo "Done: r2://${R2_BUCKET}/${R2_KEY}"
