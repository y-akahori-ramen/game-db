#!/usr/bin/env bash
# ==============================================================================
# Game QA Dashboard - Artifact Storage Retention Cleanup Script
#
# Scans test runs older than RETENTION_DAYS (default: 30 days) and physically
# purges large gameplay videos (.mp4) and crash dumps (.dmp), while permanently
# preserving metrics CSV/JSON, raw logs, manifest.json, and SQLite index rows.
#
# Usage:
#   ./run_cleanup.sh [--days 30] [--dry-run] [--min-size-mb 10]
#
# Recommended cron setup (e.g. daily at 03:00 UTC):
#   0 3 * * * /path/to/game-db/onprem/scripts/run_cleanup.sh >> /var/log/game-qa-cleanup.log 2>&1
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ONPREM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${ONPREM_DIR}"

CONTAINER_NAME="game-qa-backend"

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: Container ${CONTAINER_NAME} is not running." >&2
    exit 1
fi

# Load RETENTION_DAYS from .env if present and not overridden by CLI args
DAYS_ARG=""
if [[ $# -eq 0 ]] && [[ -f .env ]]; then
    RETENTION_DAYS=$(grep -E "^RETENTION_DAYS=" .env | cut -d '=' -f2 | tr -d ' "' || true)
    if [[ -n "${RETENTION_DAYS}" ]]; then
        DAYS_ARG="--days ${RETENTION_DAYS}"
    fi
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting artifact retention cleanup via ${CONTAINER_NAME}..."

docker compose exec -T backend python3 cleanup.py ${DAYS_ARG} "$@"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Artifact retention cleanup finished successfully."
