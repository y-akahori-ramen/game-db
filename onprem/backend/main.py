"""Game QA Dashboard On-Premises Backend API.

Provides:
1. Search API (/api/search) querying SQLite test_runs index (WAL mode).
2. Large-file streaming upload API (/api/upload/runs/{run_id}/{file_name}) saving
   asynchronously to local storage and auto-indexing manifest.json into SQLite.
3. Personal API key management API (/api/keys) for upload authentication.
"""

from __future__ import annotations

import json
import logging
import os
import posixpath
import shutil
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import aiofiles
from fastapi import FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import cleanup
import db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
LOGGER = logging.getLogger("qa-backend")

STORAGE_PATH = Path(os.environ.get("STORAGE_PATH", "/data")).resolve()
RUNS_DIR = STORAGE_PATH / "runs"

MIN_DISK_FREE_PERCENT = float(os.environ.get("MIN_DISK_FREE_PERCENT", "10.0"))
MIN_DISK_FREE_BYTES = int(os.environ.get("MIN_DISK_FREE_BYTES", str(1024 * 1024 * 1024)))

# Ensure base directories exist
RUNS_DIR.mkdir(parents=True, exist_ok=True)


def _get_disk_usage(path: Path) -> dict[str, Any]:
    try:
        total, used, free = shutil.disk_usage(path)
        free_percent = (free / total * 100.0) if total > 0 else 0.0
        return {
            "total_bytes": total,
            "used_bytes": used,
            "free_bytes": free,
            "free_percent": round(free_percent, 2),
        }
    except Exception as exc:
        LOGGER.warning("Failed to get disk usage for %s: %s", path, exc)
        return {
            "total_bytes": 0,
            "used_bytes": 0,
            "free_bytes": 0,
            "free_percent": 100.0,
        }


def _check_disk_quota(path: Path) -> None:
    usage = _get_disk_usage(path)
    if usage["total_bytes"] > 0:
        if usage["free_percent"] < MIN_DISK_FREE_PERCENT or usage["free_bytes"] < MIN_DISK_FREE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_507_INSUFFICIENT_STORAGE,
                detail=(
                    f"Insufficient storage space: {usage['free_percent']}% free "
                    f"({usage['free_bytes']} bytes free). "
                    f"Required minimum: {MIN_DISK_FREE_PERCENT}% or {MIN_DISK_FREE_BYTES} bytes."
                ),
            )


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Game QA Dashboard Backend", version="1.0.0", lifespan=lifespan)

allowed_origins_env = os.environ.get("ALLOWED_ORIGINS", "").strip()
if allowed_origins_env and allowed_origins_env != "*":
    allowed_origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()]
    origin_regex = None
else:
    allowed_origins = []
    origin_regex = r"^https?://(localhost|127\.0\.0\.1|.*\.internal\.example\.com)(:[0-9]+)?$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins if allowed_origins else [],
    allow_origin_regex=origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==============================================================================
# Models
# ==============================================================================

class SearchFilter(BaseModel):
    gameVersion: Optional[str] = None
    platform: Optional[str] = None
    testName: Optional[str] = None
    status: Optional[str] = None


class CreateKeyRequest(BaseModel):
    name: str = Field(default="CLI Key", max_length=50)


class KeyItem(BaseModel):
    keyId: str
    name: str
    email: str
    createdAt: str
    prefix: str


class CreateKeyResponse(BaseModel):
    keyId: str
    name: str
    email: str
    createdAt: str
    apiKey: str


# ==============================================================================
# API Key Management Helpers & Auth
# ==============================================================================

def _get_current_user_email(request: Request) -> str:
    # OAuth2-Proxy forwards authenticated email in X-Auth-Request-Email header
    email = request.headers.get("x-auth-request-email") or request.headers.get("x-forwarded-email")
    if email:
        return email.strip()
    return "local-dev@internal"


def _verify_api_key(api_key: str) -> dict[str, Any]:
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing API key",
        )
    key_info = db.verify_api_key(api_key)
    if not key_info:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or revoked API key",
        )
    return key_info


def _authenticate_upload_request(request: Request) -> None:
    # Check Bearer token or X-API-Key header
    auth_header = request.headers.get("authorization")
    api_key: Optional[str] = None
    if auth_header and auth_header.lower().startswith("bearer "):
        api_key = auth_header[7:].strip()
    if not api_key:
        api_key = request.headers.get("x-api-key")

    # If anonymous upload is explicitly allowed (e.g. for local dev/testing)
    if not api_key and os.environ.get("ALLOW_ANONYMOUS_UPLOAD", "").lower() == "true":
        return

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization required (provide Bearer token or X-API-Key header)",
        )
    _verify_api_key(api_key)


# ==============================================================================
# Health & Storage Routes
# ==============================================================================

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/storage/status")
def storage_status() -> dict[str, Any]:
    usage = _get_disk_usage(RUNS_DIR)
    return {
        "storagePath": str(STORAGE_PATH),
        "runsDir": str(RUNS_DIR),
        "totalBytes": usage["total_bytes"],
        "usedBytes": usage["used_bytes"],
        "freeBytes": usage["free_bytes"],
        "freePercent": usage["free_percent"],
        "minFreePercent": MIN_DISK_FREE_PERCENT,
        "minFreeBytes": MIN_DISK_FREE_BYTES,
    }


@app.post("/api/storage/cleanup")
def trigger_cleanup(
    request: Request,
    days: int = Query(default=30, ge=1),
    dry_run: bool = Query(default=False),
    min_size_mb: Optional[float] = Query(default=None, ge=0.0),
) -> dict[str, Any]:
    _authenticate_upload_request(request)
    return cleanup.cleanup_expired_runs(
        days=days,
        dry_run=dry_run,
        min_size_mb=min_size_mb,
        runs_dir=RUNS_DIR,
    )


# ==============================================================================
# Personal API Key Management Routes
# ==============================================================================

@app.get("/api/keys", response_model=list[KeyItem])
def list_keys(request: Request) -> list[dict[str, Any]]:
    user_email = _get_current_user_email(request)
    return db.list_keys_for_email(user_email)


@app.post("/api/keys", response_model=CreateKeyResponse, status_code=status.HTTP_201_CREATED)
def create_key(req: CreateKeyRequest, request: Request) -> dict[str, Any]:
    user_email = _get_current_user_email(request)
    return db.create_api_key(name=req.name, email=user_email)


@app.delete("/api/keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_key(key_id: str, request: Request) -> Response:
    user_email = _get_current_user_email(request)
    deleted = db.delete_api_key(key_id=key_id, email=user_email)
    if not deleted:
        raise HTTPException(status_code=404, detail="Key not found")
    LOGGER.info("Deleted API key %s for %s", key_id, user_email)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ==============================================================================
# Streaming Upload & SQLite Indexing Route
# ==============================================================================

@app.put("/api/upload/runs/{run_id}/{file_name}")
@app.post("/api/upload/runs/{run_id}/{file_name}")
async def upload_file(
    run_id: str,
    file_name: str,
    request: Request,
    overwrite: bool = Query(default=False, description="Allow overwriting an already finalized run"),
) -> dict[str, Any]:
    """Streams request body asynchronously directly to disk under /data/runs/{run_id}/{file_name}.

    If file_name is manifest.json, parses it and indexes into SQLite.
    Supports arbitrarily large files (30GB+) without blocking the event loop or consuming memory.
    """
    _authenticate_upload_request(request)

    # Sanitize inputs
    clean_run_id = posixpath.basename(run_id)
    clean_file_name = posixpath.basename(file_name)
    if not clean_run_id or clean_run_id in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid run_id")
    if not clean_file_name or clean_file_name in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid file_name")

    # Check disk quota before accepting upload (HTTP 507)
    _check_disk_quota(RUNS_DIR)

    run_dir = RUNS_DIR / clean_run_id
    manifest_file = run_dir / "manifest.json"

    # Run tamper protection: reject upload to finalized runs unless overwrite=true (HTTP 409)
    if manifest_file.exists() and not overwrite:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Run '{clean_run_id}' is already finalized. To overwrite existing run data, specify overwrite=true.",
        )

    run_dir.mkdir(parents=True, exist_ok=True)
    target_file = run_dir / clean_file_name
    temp_file = run_dir / f".{clean_file_name}.tmp"

    total_bytes = 0
    try:
        async with aiofiles.open(temp_file, "wb") as f:
            async for chunk in request.stream():
                if chunk:
                    await f.write(chunk)
                    total_bytes += len(chunk)
        temp_file.replace(target_file)
    except Exception as exc:
        if temp_file.exists():
            temp_file.unlink(missing_ok=True)
        LOGGER.exception("Failed to write upload file %s: %s", target_file, exc)
        raise HTTPException(status_code=500, detail=f"Upload write failed: {exc}")

    LOGGER.info("Uploaded %s (bytes: %d)", target_file, total_bytes)

    # If manifest.json, index into SQLite
    if clean_file_name == "manifest.json":
        try:
            _index_manifest(target_file, clean_run_id)
        except Exception as exc:
            LOGGER.exception("Failed to index manifest %s: %s", target_file, exc)
            return {
                "status": "warning",
                "message": f"File uploaded but SQLite index failed: {exc}",
                "runId": clean_run_id,
                "fileName": clean_file_name,
                "bytes": total_bytes,
            }

    return {
        "status": "ok",
        "runId": clean_run_id,
        "fileName": clean_file_name,
        "bytes": total_bytes,
        "url": f"/data/runs/{clean_run_id}/{clean_file_name}",
    }


def _index_manifest(manifest_path: Path, run_id: str) -> None:
    content = manifest_path.read_text(encoding="utf-8")
    manifest = json.loads(content)
    if not isinstance(manifest, dict):
        raise ValueError("manifest.json must be a JSON object")

    raw_status = manifest.get("status") or manifest.get("result") or "PASSED"
    status_str = str(raw_status).upper()
    valid_status = status_str if status_str in ("PASSED", "FAILED", "ABORTED") else "PASSED"

    artifacts = manifest.get("artifacts", [])
    clean_artifacts: list[dict[str, Any]] = []
    fps_data_url: Optional[str] = None
    memory_data_url: Optional[str] = None
    logs_data_url: Optional[str] = None
    video_url: Optional[str] = None

    for art in artifacts:
        art_type = art.get("type", "other")
        file_name = art.get("file_name") or posixpath.basename(art.get("s3_key", ""))
        url = f"/data/runs/{run_id}/{file_name}"
        art_entry = {
            "url": url,
            "fileName": file_name,
            "type": art_type,
        }
        if "size_bytes" in art and art["size_bytes"] is not None:
            art_entry["sizeBytes"] = int(art["size_bytes"])
        clean_artifacts.append(art_entry)

        if art_type == "fps" and not fps_data_url:
            fps_data_url = url
        elif art_type == "memory" and not memory_data_url:
            memory_data_url = url
        elif art_type == "log" and not logs_data_url:
            logs_data_url = url
        elif art_type == "video" and not video_url:
            video_url = url

    total_size_bytes = manifest.get("total_size_bytes")
    if total_size_bytes is not None:
        try:
            total_size_bytes = int(total_size_bytes)
        except (ValueError, TypeError):
            total_size_bytes = None
    if total_size_bytes is None and clean_artifacts:
        calculated_size = sum(art.get("sizeBytes", 0) for art in clean_artifacts)
        if calculated_size > 0:
            total_size_bytes = calculated_size

    duration_seconds = manifest.get("duration_seconds")
    if duration_seconds is not None:
        try:
            duration_seconds = float(duration_seconds)
        except (ValueError, TypeError):
            duration_seconds = None

    db.upsert_run(
        run_id=manifest.get("run_id", run_id),
        executed_at=manifest.get("executed_at", datetime.now(timezone.utc).isoformat()),
        game_version=manifest.get("game_version", "unknown"),
        platform=manifest.get("platform", "unknown"),
        test_name=manifest.get("test_name", "unknown"),
        status=valid_status,
        artifacts=clean_artifacts,
        avg_fps=float(manifest["avg_fps"]) if manifest.get("avg_fps") is not None else None,
        min_fps=float(manifest["min_fps"]) if manifest.get("min_fps") is not None else None,
        peak_memory_mb=float(manifest["peak_memory_mb"]) if manifest.get("peak_memory_mb") is not None else None,
        duration_seconds=duration_seconds,
        device_model=manifest.get("device_model"),
        triggered_by=manifest.get("triggered_by"),
        total_size_bytes=total_size_bytes,
        fps_data_url=fps_data_url,
        memory_data_url=memory_data_url,
        logs_data_url=logs_data_url,
        video_url=video_url,
    )
    LOGGER.info("Successfully indexed run %s into SQLite database", run_id)


# ==============================================================================
# Search & Run API Routes
# ==============================================================================

@app.post("/api/search")
def search_runs_post(
    filter_payload: SearchFilter,
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    return db.search_runs(
        game_version=filter_payload.gameVersion,
        platform=filter_payload.platform,
        test_name=filter_payload.testName,
        status=filter_payload.status,
        limit=limit,
        offset=offset,
    )


@app.get("/api/search")
def search_runs_get(
    gameVersion: Optional[str] = Query(None),
    platform: Optional[str] = Query(None),
    testName: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    return db.search_runs(
        game_version=gameVersion,
        platform=platform,
        test_name=testName,
        status=status,
        limit=limit,
        offset=offset,
    )


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    """Retrieve a single test run summary by runId."""
    clean_run_id = posixpath.basename(run_id)
    if not clean_run_id or clean_run_id in (".", ".."):
        raise HTTPException(status_code=400, detail="Invalid run_id")
    run = db.get_run_by_id(clean_run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run
