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
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import aiofiles
from fastapi import FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
LOGGER = logging.getLogger("qa-backend")

STORAGE_PATH = Path(os.environ.get("STORAGE_PATH", "/data")).resolve()
RUNS_DIR = STORAGE_PATH / "runs"

# Ensure base directories exist
RUNS_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="Game QA Dashboard Backend", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
# Health Check
# ==============================================================================

@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


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
async def upload_file(run_id: str, file_name: str, request: Request) -> dict[str, Any]:
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

    run_dir = RUNS_DIR / clean_run_id
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
        git_branch=manifest.get("git_branch"),
        git_commit=manifest.get("git_commit"),
        build_id=manifest.get("build_id"),
        error_summary=manifest.get("error_summary"),
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
