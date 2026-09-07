"""Game QA Dashboard On-Premises Backend API.

Provides:
1. Search API (/api/search) querying AWS DynamoDB search index.
2. Large-file streaming upload API (/api/upload/runs/{run_id}/{file_name}) saving
   directly to local storage and auto-indexing manifest.json into DynamoDB.
3. Personal API key management API (/api/keys) for upload authentication.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import posixpath
import secrets
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Optional

import boto3
from boto3.dynamodb.conditions import Attr, Key
from fastapi import FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
LOGGER = logging.getLogger("qa-backend")

STORAGE_PATH = Path(os.environ.get("STORAGE_PATH", "/data")).resolve()
RUNS_DIR = STORAGE_PATH / "runs"
KEYS_FILE = STORAGE_PATH / "keys.json"
TABLE_NAME = os.environ.get("TABLE_NAME", "GameQaDashboard-SearchIndex")
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", os.environ.get("AWS_REGION", "ap-northeast-1"))
DYNAMODB_ENDPOINT_URL = os.environ.get("DYNAMODB_ENDPOINT_URL")

# Ensure base directories exist
RUNS_DIR.mkdir(parents=True, exist_ok=True)

# DynamoDB client
dynamodb_kwargs: dict[str, Any] = {"region_name": AWS_REGION}
if DYNAMODB_ENDPOINT_URL:
    dynamodb_kwargs["endpoint_url"] = DYNAMODB_ENDPOINT_URL

dynamodb = boto3.resource("dynamodb", **dynamodb_kwargs)

app = FastAPI(title="Game QA Dashboard Backend", version="1.0.0")

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
# API Key Management Helpers
# ==============================================================================

def _hash_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def _load_keys() -> list[dict[str, Any]]:
    if not KEYS_FILE.exists():
        return []
    try:
        data = json.loads(KEYS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except Exception as exc:
        LOGGER.warning("Could not read keys file: %s", exc)
    return []


def _save_keys(keys: list[dict[str, Any]]) -> None:
    KEYS_FILE.parent.mkdir(parents=True, exist_ok=True)
    KEYS_FILE.write_text(json.dumps(keys, indent=2), encoding="utf-8")


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
    key_hash = _hash_key(api_key.strip())
    keys = _load_keys()
    for item in keys:
        if item.get("keyHash") == key_hash:
            return item
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or revoked API key",
    )


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
    all_keys = _load_keys()
    user_keys = [k for k in all_keys if k.get("email") == user_email]
    return [
        {
            "keyId": k["keyId"],
            "name": k.get("name", "CLI Key"),
            "email": k["email"],
            "createdAt": k["createdAt"],
            "prefix": k.get("prefix", "gqa_..."),
        }
        for k in user_keys
    ]


@app.post("/api/keys", response_model=CreateKeyResponse, status_code=status.HTTP_201_CREATED)
def create_key(req: CreateKeyRequest, request: Request) -> dict[str, Any]:
    user_email = _get_current_user_email(request)
    raw_secret = secrets.token_hex(24)
    api_key = f"gqa_live_{raw_secret}"
    key_id = f"key_{secrets.token_hex(8)}"
    now_iso = datetime.now(timezone.utc).isoformat()
    key_hash = _hash_key(api_key)
    prefix = f"{api_key[:12]}..."

    new_record = {
        "keyId": key_id,
        "name": req.name,
        "email": user_email,
        "keyHash": key_hash,
        "prefix": prefix,
        "createdAt": now_iso,
    }

    keys = _load_keys()
    keys.append(new_record)
    _save_keys(keys)

    LOGGER.info("Issued API key %s for %s (%s)", key_id, user_email, req.name)
    return {
        "keyId": key_id,
        "name": req.name,
        "email": user_email,
        "createdAt": now_iso,
        "apiKey": api_key,
    }


@app.delete("/api/keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_key(key_id: str, request: Request) -> Response:
    user_email = _get_current_user_email(request)
    keys = _load_keys()
    original_len = len(keys)
    keys = [k for k in keys if not (k.get("keyId") == key_id and k.get("email") == user_email)]
    if len(keys) == original_len:
        raise HTTPException(status_code=404, detail="Key not found")
    _save_keys(keys)
    LOGGER.info("Deleted API key %s for %s", key_id, user_email)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ==============================================================================
# Streaming Upload & DynamoDB Indexing Route
# ==============================================================================

@app.put("/api/upload/runs/{run_id}/{file_name}")
@app.post("/api/upload/runs/{run_id}/{file_name}")
async def upload_file(run_id: str, file_name: str, request: Request) -> dict[str, Any]:
    """Streams request body directly to disk under /data/runs/{run_id}/{file_name}.

    If file_name is manifest.json, parses it and indexes into DynamoDB.
    Supports arbitrarily large files (30GB+) without memory overhead.
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
        with open(temp_file, "wb") as f:
            async for chunk in request.stream():
                if chunk:
                    f.write(chunk)
                    total_bytes += len(chunk)
        temp_file.replace(target_file)
    except Exception as exc:
        if temp_file.exists():
            temp_file.unlink(missing_ok=True)
        LOGGER.exception("Failed to write upload file %s: %s", target_file, exc)
        raise HTTPException(status_code=500, detail=f"Upload write failed: {exc}")

    LOGGER.info("Uploaded %s (bytes: %d)", target_file, total_bytes)

    # If manifest.json, index into DynamoDB
    if clean_file_name == "manifest.json":
        try:
            _index_manifest(target_file, clean_run_id)
        except Exception as exc:
            LOGGER.exception("Failed to index manifest %s: %s", target_file, exc)
            return {
                "status": "warning",
                "message": f"File uploaded but DynamoDB index failed: {exc}",
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

    item: dict[str, Any] = {
        "runId": manifest.get("run_id", run_id),
        "executedAt": manifest.get("executed_at", datetime.now(timezone.utc).isoformat()),
        "gameVersion": manifest.get("game_version", "unknown"),
        "platform": manifest.get("platform", "unknown"),
        "testName": manifest.get("test_name", "unknown"),
        "status": manifest.get("result", "PASSED"),
        "gsiAllPk": "ALL",
    }

    avg_fps = manifest.get("avg_fps")
    if avg_fps is not None:
        item["avgFps"] = Decimal(str(avg_fps))

    min_fps = manifest.get("min_fps")
    if min_fps is not None:
        item["minFps"] = Decimal(str(min_fps))

    peak_memory = manifest.get("peak_memory_mb")
    if peak_memory is not None:
        item["peakMemoryMb"] = Decimal(str(peak_memory))

    artifacts = manifest.get("artifacts", [])
    clean_artifacts = []
    for art in artifacts:
        clean_art = dict(art)
        if "size_bytes" in clean_art and clean_art["size_bytes"] is not None:
            clean_art["size_bytes"] = int(clean_art["size_bytes"])
        clean_artifacts.append(clean_art)
    item["artifacts"] = clean_artifacts

    table = dynamodb.Table(TABLE_NAME)
    table.put_item(Item=item)
    LOGGER.info("Successfully indexed run %s into DynamoDB table %s", item["runId"], TABLE_NAME)


# ==============================================================================
# Search API Routes
# ==============================================================================

@app.post("/api/search")
def search_runs_post(filter_payload: SearchFilter) -> list[dict[str, Any]]:
    return _execute_search(filter_payload)


@app.get("/api/search")
def search_runs_get(
    gameVersion: Optional[str] = Query(None),
    platform: Optional[str] = Query(None),
    testName: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
) -> list[dict[str, Any]]:
    payload = SearchFilter(
        gameVersion=gameVersion,
        platform=platform,
        testName=testName,
        status=status,
    )
    return _execute_search(payload)


def _execute_search(filter_payload: SearchFilter) -> list[dict[str, Any]]:
    table = dynamodb.Table(TABLE_NAME)
    payload_dict = {k: v for k, v in filter_payload.model_dump().items() if v}

    query_kwargs: dict[str, Any] = {"ScanIndexForward": False, "Limit": 200}

    # Query strategy matching DynamoDB GSI index design
    if payload_dict.get("platform"):
        query_kwargs["IndexName"] = "platform-index"
        query_kwargs["KeyConditionExpression"] = Key("platform").eq(payload_dict["platform"])
        del payload_dict["platform"]
    elif payload_dict.get("status"):
        query_kwargs["IndexName"] = "status-index"
        query_kwargs["KeyConditionExpression"] = Key("status").eq(payload_dict["status"])
        del payload_dict["status"]
    else:
        query_kwargs["IndexName"] = "all-index"
        query_kwargs["KeyConditionExpression"] = Key("gsiAllPk").eq("ALL")

    filter_expr = None
    for field, val in payload_dict.items():
        cond = Attr(field).eq(val)
        filter_expr = cond if filter_expr is None else filter_expr & cond

    if filter_expr is not None:
        query_kwargs["FilterExpression"] = filter_expr

    try:
        response = table.query(**query_kwargs)
        items = response.get("Items", [])
    except Exception as exc:
        LOGGER.exception("DynamoDB query failed: %s", exc)
        raise HTTPException(status_code=500, detail="Database search failed")

    return [_item_to_summary(it) for it in items]


def _item_to_summary(item: dict[str, Any]) -> dict[str, Any]:
    run_id = item["runId"]
    artifacts: list[dict[str, Any]] = []
    fps_url: Optional[str] = None
    memory_url: Optional[str] = None
    log_url: Optional[str] = None
    video_url: Optional[str] = None

    for art in item.get("artifacts", []):
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
        artifacts.append(art_entry)

        if art_type == "fps" and not fps_url:
            fps_url = url
        elif art_type == "memory" and not memory_url:
            memory_url = url
        elif art_type == "log" and not log_url:
            log_url = url
        elif art_type == "video" and not video_url:
            video_url = url

    summary: dict[str, Any] = {
        "runId": run_id,
        "gameVersion": item.get("gameVersion", "unknown"),
        "platform": item.get("platform", "unknown"),
        "testName": item.get("testName", "unknown"),
        "status": item.get("status", "PASSED"),
        "timestamp": item.get("executedAt", ""),
        "artifacts": artifacts,
    }

    if fps_url:
        summary["fpsDataUrl"] = fps_url
    if memory_url:
        summary["memoryDataUrl"] = memory_url
    if log_url:
        summary["logsDataUrl"] = log_url
    if video_url:
        summary["videoUrl"] = video_url
    if item.get("avgFps") is not None:
        summary["avgFps"] = float(item["avgFps"])
    if item.get("minFps") is not None:
        summary["minFps"] = float(item["minFps"])
    if item.get("peakMemoryMb") is not None:
        summary["peakMemoryMb"] = float(item["peakMemoryMb"])

    return summary
