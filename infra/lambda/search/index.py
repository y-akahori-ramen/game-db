"""Search Lambda for /api/search.

Request contract (API Gateway REST API Lambda proxy integration):
- Preferred method: POST
- Expected JSON body shape matches frontend SearchFilter:
    {
      "gameVersion"?: string,
      "platform"?: string,
      "testName"?: string,
      "status"?: string
    }
- GET is also tolerated by reading event["queryStringParameters"].

Environment variables:
- TABLE_NAME (required): DynamoDB run search index table.
- MAX_RESULTS (optional, default: 200)

Query strategy:
- platform given  -> Query GSI platform-index (PK platform, SK executedAt DESC)
- status given    -> Query GSI status-index (PK status, SK executedAt DESC)
- otherwise       -> Query GSI all-index (fixed PK "ALL", SK executedAt DESC)
Remaining filter fields are applied via FilterExpression.

Response contract:
- 200 with body containing a JSON array of TestRunSummary objects:
    {
      "runId": string,
      "gameVersion": string,
      "platform": string,
      "testName": string,
      "status": "PASSED" | "FAILED",
      "timestamp": string,
      "fpsDataUrl": string,
      "memoryDataUrl": string,
      "logsDataUrl": string,
      "videoUrl"?: string,
      "artifacts": [{ "url": string, "fileName": string, "type": string }, ...]
    }
"""

from __future__ import annotations

import json
import logging
import os
import posixpath
from typing import Any

import boto3
from boto3.dynamodb.conditions import Attr, Key

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)

DYNAMODB = boto3.resource("dynamodb")

FILTER_KEYS = ("gameVersion", "platform", "testName", "status")
ALL_PARTITION_VALUE = "ALL"
REQUIRED_ITEM_FIELDS = (
    "runId",
    "executedAt",
    "gameVersion",
    "platform",
    "testName",
    "status",
)


class ClientErrorResponse(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    del context
    try:
        filter_payload = _parse_filter_payload(event)
        items = _query_runs(filter_payload)
        results = [_item_to_summary(item) for item in items]
        return _json_response(200, results)
    except ClientErrorResponse as exc:
        LOGGER.warning("Invalid search request: %s", exc.message)
        return _json_response(exc.status_code, {"message": exc.message})
    except Exception:  # pragma: no cover - runtime safety net
        LOGGER.exception("Search Lambda failed")
        return _json_response(500, {"message": "Internal server error"})


def _parse_filter_payload(event: dict[str, Any]) -> dict[str, str]:
    method = (event.get("httpMethod") or "").upper()
    if method == "POST":
        raw_body = event.get("body")
        if raw_body in (None, ""):
            payload: dict[str, Any] = {}
        else:
            try:
                payload = json.loads(raw_body)
            except json.JSONDecodeError as exc:
                raise ClientErrorResponse("Request body must be valid JSON.") from exc
            if not isinstance(payload, dict):
                raise ClientErrorResponse("Request body must be a JSON object.")
    else:
        payload = event.get("queryStringParameters") or {}
        if not isinstance(payload, dict):
            raise ClientErrorResponse(
                "queryStringParameters must be an object when provided."
            )

    filter_payload: dict[str, str] = {}
    for key in FILTER_KEYS:
        value = payload.get(key)
        if value is None or value == "":
            continue
        if not isinstance(value, str):
            raise ClientErrorResponse(f"Filter '{key}' must be a string.")
        filter_payload[key] = value
    return filter_payload


def _query_runs(filter_payload: dict[str, str]) -> list[dict[str, Any]]:
    table = DYNAMODB.Table(_required_env("TABLE_NAME"))
    max_results = int(os.environ.get("MAX_RESULTS", "200"))

    if "platform" in filter_payload:
        index_name = "platform-index"
        key_condition = Key("platform").eq(filter_payload["platform"])
        filter_fields = [k for k in filter_payload if k != "platform"]
    elif "status" in filter_payload:
        index_name = "status-index"
        key_condition = Key("status").eq(filter_payload["status"])
        filter_fields = [k for k in filter_payload if k != "status"]
    else:
        index_name = "all-index"
        key_condition = Key("gsiAllPk").eq(ALL_PARTITION_VALUE)
        filter_fields = list(filter_payload)

    query_params: dict[str, Any] = {
        "IndexName": index_name,
        "KeyConditionExpression": key_condition,
        "ScanIndexForward": False,  # executedAt DESC (newest first)
    }

    filter_expression = None
    for field in filter_fields:
        condition = Attr(field).eq(filter_payload[field])
        filter_expression = (
            condition if filter_expression is None else filter_expression & condition
        )
    if filter_expression is not None:
        query_params["FilterExpression"] = filter_expression

    items: list[dict[str, Any]] = []
    last_evaluated_key: dict[str, Any] | None = None
    while len(items) < max_results:
        if last_evaluated_key:
            query_params["ExclusiveStartKey"] = last_evaluated_key
        response = table.query(**query_params)
        items.extend(response.get("Items", []))
        last_evaluated_key = response.get("LastEvaluatedKey")
        if not last_evaluated_key:
            break

    return items[:max_results]


def _item_to_summary(item: dict[str, Any]) -> dict[str, Any]:
    missing_fields = [field for field in REQUIRED_ITEM_FIELDS if not item.get(field)]
    if missing_fields:
        raise ValueError(
            f"Search index item missing fields: {', '.join(missing_fields)}"
        )

    run_id = item["runId"]
    artifacts: list[dict[str, Any]] = []
    fps_url: str | None = None
    memory_url: str | None = None
    log_url: str | None = None
    video_url: str | None = None

    for art in item.get("artifacts", []):
        art_type = art.get("type", "other")
        file_name = art.get("file_name") or posixpath.basename(art.get("s3_key", ""))
        url = _to_cloudfront_data_url(run_id, file_name)
        artifact_entry: dict[str, Any] = {
            "url": url,
            "fileName": file_name,
            "type": art_type,
        }
        if "size_bytes" in art and art["size_bytes"] is not None:
            artifact_entry["sizeBytes"] = int(art["size_bytes"])
        artifacts.append(artifact_entry)

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
        "gameVersion": item["gameVersion"],
        "platform": item["platform"],
        "testName": item["testName"],
        "status": item["status"],
        "timestamp": item["executedAt"],
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

    return summary


def _to_artifact(run_id: str, object_key: str, artifact_type: str) -> dict[str, str]:
    return {
        "url": _to_cloudfront_data_url(run_id, object_key),
        "fileName": posixpath.basename(object_key),
        "type": artifact_type,
    }


def _to_cloudfront_data_url(run_id: str, object_key: str) -> str:
    return f"/data/runs/{run_id}/{posixpath.basename(object_key)}"


def _required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _json_response(status_code: int, body: Any) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
