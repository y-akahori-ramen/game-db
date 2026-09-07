#!/usr/bin/env bash
# ==============================================================================
# Game QA Dashboard - Production Deployment & Verification Script
#
# Performs pre-flight checks, verifies environment variables and persistent storage
# paths, builds frontend assets (if needed), starts Docker Compose services,
# and verifies health checks.
#
# Usage:
#   cd onprem && ./deploy.sh
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${SCRIPT_DIR}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_ok() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_err() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

echo "=================================================================="
echo "  Game QA Analytics Dashboard - Production Deployment"
echo "=================================================================="

# ------------------------------------------------------------------------------
# 1. Check prerequisite tools
# ------------------------------------------------------------------------------
log_info "Checking prerequisite tools..."
command -v docker >/dev/null 2>&1 || { log_err "docker is not installed or not in PATH"; exit 1; }
docker compose version >/dev/null 2>&1 || { log_err "docker compose plugin is not installed"; exit 1; }
log_ok "Docker and Docker Compose are available."

# ------------------------------------------------------------------------------
# 2. Check .env configuration
# ------------------------------------------------------------------------------
log_info "Checking .env configuration..."
if [[ ! -f .env ]]; then
    log_err ".env file not found in ${SCRIPT_DIR}."
    echo "  Please copy .env.example to .env and configure your production settings:"
    echo "    cp .env.example .env"
    echo "    vi .env"
    exit 1
fi

# Safely parse .env file
while IFS='=' read -r key val || [[ -n "$key" ]]; do
    key="$(echo "$key" | sed -e 's/^[[:space:]]*//')"
    [[ -z "$key" || "$key" == \#* ]] && continue
    val="$(echo "$val" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    # Strip enclosing single or double quotes
    if [[ "$val" =~ ^\"(.*)\"$ ]]; then
        val="${BASH_REMATCH[1]}"
    elif [[ "$val" =~ ^\'(.*)\'$ ]]; then
        val="${BASH_REMATCH[1]}"
    fi
    export "$key=$val" 2>/dev/null || true
done < .env


# Validate Google OAuth credentials
MISSING_ENV=0
if [[ -z "${GOOGLE_CLIENT_ID:-}" ]] || [[ "${GOOGLE_CLIENT_ID:-}" == *"your-google-client-id"* ]]; then
    log_warn "GOOGLE_CLIENT_ID is unset or still uses default placeholder."
    MISSING_ENV=1
fi

if [[ -z "${GOOGLE_CLIENT_SECRET:-}" ]] || [[ "${GOOGLE_CLIENT_SECRET:-}" == *"your-google-client-secret"* ]]; then
    log_warn "GOOGLE_CLIENT_SECRET is unset or still uses default placeholder."
    MISSING_ENV=1
fi

if [[ -z "${OAUTH2_PROXY_COOKIE_SECRET:-}" ]] || [[ "${OAUTH2_PROXY_COOKIE_SECRET:-}" == *"your-random-cookie-secret"* ]]; then
    log_warn "OAUTH2_PROXY_COOKIE_SECRET is unset or still uses default placeholder."
    MISSING_ENV=1
fi

if [[ ${MISSING_ENV} -eq 1 ]]; then
    log_warn "Some OAuth credentials are using placeholders. Web login may fail until configured."
else
    log_ok "Google OAuth2 credentials are configured."
fi

# ------------------------------------------------------------------------------
# 3. Check persistent storage directories
# ------------------------------------------------------------------------------
log_info "Checking persistent storage directories..."
if [[ -n "${HOST_STORAGE_DATA_PATH:-}" ]]; then
    mkdir -p "${HOST_STORAGE_DATA_PATH}"
    if [[ ! -w "${HOST_STORAGE_DATA_PATH}" ]]; then
        log_err "Storage data directory is not writable: ${HOST_STORAGE_DATA_PATH}"
        exit 1
    fi
    log_ok "Artifacts storage directory: ${HOST_STORAGE_DATA_PATH} (writable)"
else
    log_ok "Artifacts storage: Docker named volume (qa_data)"
fi

if [[ -n "${HOST_STORAGE_DB_PATH:-}" ]]; then
    mkdir -p "${HOST_STORAGE_DB_PATH}"
    if [[ ! -w "${HOST_STORAGE_DB_PATH}" ]]; then
        log_err "SQLite DB directory is not writable: ${HOST_STORAGE_DB_PATH}"
        exit 1
    fi
    log_ok "SQLite DB directory: ${HOST_STORAGE_DB_PATH} (writable)"
else
    log_ok "SQLite DB storage: Docker named volume (qa_db)"
fi

# ------------------------------------------------------------------------------
# 4. Check Frontend SPA Build
# ------------------------------------------------------------------------------
log_info "Checking frontend SPA build assets..."
DIST_INDEX="${ROOT_DIR}/my-qa-dashboard/dist/index.html"
if [[ ! -f "${DIST_INDEX}" ]]; then
    log_warn "Frontend build assets not found at ${DIST_INDEX}."
    if command -v npm >/dev/null 2>&1; then
        log_info "Building frontend SPA assets for production (VITE_USE_MOCK=false)..."
        VITE_USE_MOCK=false npm --prefix "${ROOT_DIR}/my-qa-dashboard" run build
        log_ok "Frontend built successfully."
    else
        log_err "npm is not installed. Please build frontend manually: (cd my-qa-dashboard && npm run build)"
        exit 1
    fi
else
    log_ok "Frontend build assets found."
fi

# ------------------------------------------------------------------------------
# 5. Build and launch Docker Compose services
# ------------------------------------------------------------------------------
log_info "Starting Docker Compose services..."
docker compose build
docker compose up -d

# ------------------------------------------------------------------------------
# 6. Verify service health
# ------------------------------------------------------------------------------
log_info "Waiting for services to become healthy..."
APP_PORT="${HOST_PORT:-8080}"
HEALTH_URL="http://localhost:${APP_PORT}/api/health"

MAX_ATTEMPTS=20
ATTEMPT=1
HEALTHY=0

while [[ ${ATTEMPT} -le ${MAX_ATTEMPTS} ]]; do
    if curl -sSf "${HEALTH_URL}" >/dev/null 2>&1; then
        HEALTHY=1
        break
    fi
    echo -n "."
    sleep 2
    ATTEMPT=$((ATTEMPT + 1))
done
echo ""

if [[ ${HEALTHY} -eq 1 ]]; then
    echo "=================================================================="
    log_ok "Game QA Analytics Dashboard is up and healthy!"
    echo "=================================================================="
    echo "  Web Dashboard:  http://localhost:${APP_PORT} (or ${APP_URL:-https://qa-dashboard.internal.example.com})"
    echo "  Health Check:   ${HEALTH_URL}"
    echo "  Backend API:    http://localhost:${APP_PORT}/api/"
    echo ""
    echo "Maintenance Commands:"
    echo "  - SQLite Backup:     ./scripts/backup_db.sh"
    echo "  - Artifact Cleanup:  ./scripts/run_cleanup.sh"
    echo "  - View Logs:         docker compose logs -f"
    echo "=================================================================="
else
    log_err "Health check did not pass within timeout (${HEALTH_URL})."
    echo "Check container status and logs with:"
    echo "  docker compose ps"
    echo "  docker compose logs"
    exit 1
fi
