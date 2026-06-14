#!/usr/bin/env bash
# Export remote D1 and upload SQL dump to R2.
# Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() {
  echo "[d1-backup $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
}

notice() {
  log "$*"
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    echo "::notice title=D1 Backup::$*"
  fi
}

fail() {
  log "ERROR: $*" >&2
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    echo "::error::$*"
  fi
  exit 1
}

run_wrangler() {
  log ">> wrangler $*"
  stdbuf -oL -eL pnpm exec wrangler "$@" 2>&1 | stdbuf -oL sed 's/^/[wrangler] /'
}

write_step_summary() {
  [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] || return 0
  {
    echo "## D1 Backup"
    echo ""
    echo "| Item | Value |"
    echo "|------|-------|"
    echo "| Database | \`${DB_NAME}\` |"
    echo "| Export file | \`${FILE}\` |"
    echo "| Size | ${FILE_SIZE} bytes |"
    echo "| R2 bucket | \`${R2_BUCKET}\` |"
    echo "| R2 key | \`${R2_KEY}\` |"
    echo "| R2 URI | \`r2://${R2_BUCKET}/${R2_KEY}\` |"
    echo ""
    echo "Dashboard: **R2 → ${R2_BUCKET} → ${R2_PREFIX}/**"
  } >> "$GITHUB_STEP_SUMMARY"
}

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  fail "CLOUDFLARE_API_TOKEN is not set (GitHub: Environments → production → Environment secrets)"
fi
if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  fail "CLOUDFLARE_ACCOUNT_ID is not set"
fi

DB_NAME="${D1_DATABASE_NAME:-sudokuhot-db}"
R2_BUCKET="${R2_BUCKET:-sudokuhot}"
R2_PREFIX="${R2_PREFIX:-d1-backups}"
TS="$(date -u +%Y%m%d-%H%M%S)"
FILE="backups/${DB_NAME}-${TS}.sql"
R2_KEY="${R2_PREFIX}/$(basename "$FILE")"

mkdir -p backups

notice "Start backup: D1=${DB_NAME}, R2=${R2_BUCKET}/${R2_KEY}, account=${CLOUDFLARE_ACCOUNT_ID}"

log "Step 1/3: export remote D1 → ${FILE}"
run_wrangler d1 export "$DB_NAME" --remote --output "$FILE"

if [[ ! -s "$FILE" ]]; then
  fail "Export file missing or empty: ${FILE}"
fi
FILE_SIZE=$(wc -c < "$FILE" | tr -d ' ')
notice "Export OK (${FILE_SIZE} bytes)"

log "Step 2/3: upload to r2://${R2_BUCKET}/${R2_KEY} (--remote)"
run_wrangler r2 object put "${R2_BUCKET}/${R2_KEY}" --file "$FILE" --remote
notice "Upload command finished"

log "Step 3/3: verify remote object"
VERIFY="/tmp/r2-verify-$$.sql"
run_wrangler r2 object get "${R2_BUCKET}/${R2_KEY}" --remote --file "$VERIFY"
if [[ ! -s "$VERIFY" ]]; then
  rm -f "$VERIFY"
  fail "Upload reported success but remote object is missing or empty"
fi
VERIFY_SIZE=$(wc -c < "$VERIFY" | tr -d ' ')
rm -f "$VERIFY"
notice "Verify OK (remote ${VERIFY_SIZE} bytes)"

write_step_summary
notice "Done: r2://${R2_BUCKET}/${R2_KEY}"
