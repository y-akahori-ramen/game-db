#!/usr/bin/env bash
# ==============================================================================
# Game QA Dashboard - SQLite Database Backup Script
#
# Performs an atomic, consistent online backup of the SQLite WAL database
# via Python's sqlite3 Connection.backup() inside the backend container.
#
# Usage:
#   ./backup_db.sh [--output-dir /path/to/host/backups] [--keep-days 14] [--no-compress]
#
# Recommended cron setup (e.g. daily at 02:00 UTC):
#   0 2 * * * /path/to/game-db/onprem/scripts/backup_db.sh >> /var/log/game-qa-backup.log 2>&1
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

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting SQLite WAL online backup via ${CONTAINER_NAME}..."

docker compose exec -T backend python3 backup.py "$@"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] SQLite WAL online backup finished successfully."
