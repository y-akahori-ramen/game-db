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
- ATHENA_WORKGROUP_NAME (required)
- ATHENA_CATALOG_NAME (required, e.g. "s3tablescatalog/aws-s3")
- ATHENA_DATABASE_NAME (required, e.g. "b_my-bucket-name")
- ATHENA_TABLE_NAME (optional, default: "annotation")
- ATHENA_OUTPUT_LOCATION (optional, only needed if the workgroup does not enforce one)
- QUERY_POLL_INTERVAL_SECONDS (optional, default: 1.0)
- QUERY_TIMEOUT_SECONDS (optional, default: 30)

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
import time
from typing import Any

import boto3

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)

ATHENA = boto3.client("athena")

FILTER_TO_JSON_PATH = {
    "gameVersion": "game_version",
    "platform": "platform",
    "testName": "test_name",
    "status": "result",
}
REQUIRED_RESULT_FIELDS = (
    "run_id",
    "executed_at",
    "game_version",
    "platform",
    "test_name",
    "result",
    "fps_key",
    "memory_key",
    "log_key",
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
        query = _build_search_query(filter_payload)
        LOGGER.info("Executing Athena search query: %s", query)
        rows = _run_athena_query(query)
        results = [_annotation_row_to_summary(row) for row in rows]
        return _json_response(200, results)
    except ClientErrorResponse as exc:
        LOGGER.warning("Invalid search request: %s", exc.message)
        return _json_response(exc.status_code, {"message": exc.message})
    except Exception as exc:  # pragma: no cover - runtime safety net
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
    for key in FILTER_TO_JSON_PATH:
        value = payload.get(key)
        if value is None or value == "":
            continue
        if not isinstance(value, str):
            raise ClientErrorResponse(f"Filter '{key}' must be a string.")
        filter_payload[key] = value
    return filter_payload


def _build_search_query(filter_payload: dict[str, str]) -> str:
    catalog = _required_env("ATHENA_CATALOG_NAME")
    database = _required_env("ATHENA_DATABASE_NAME")
    table_name = os.environ.get("ATHENA_TABLE_NAME", "annotation")
    fully_qualified_table = f"{_quote_identifier(catalog)}.{_quote_identifier(database)}.{_quote_identifier(table_name)}"

    where_clauses = ["name = 'run-summary'"]
    for filter_name, json_field in FILTER_TO_JSON_PATH.items():
        value = filter_payload.get(filter_name)
        if value is None:
            continue
        escaped_value = _escape_sql_literal(value)
        where_clauses.append(
            f"json_extract_scalar(text_value, '$.{json_field}') = '{escaped_value}'"
        )

    return (
        "SELECT text_value "
        f"FROM {fully_qualified_table} "
        f"WHERE {' AND '.join(where_clauses)} "
        "ORDER BY json_extract_scalar(text_value, '$.executed_at') DESC"
    )


def _run_athena_query(query: str) -> list[dict[str, str]]:
    params: dict[str, Any] = {
        "QueryString": query,
        "WorkGroup": _required_env("ATHENA_WORKGROUP_NAME"),
    }
    output_location = os.environ.get("ATHENA_OUTPUT_LOCATION")
    if output_location:
        params["ResultConfiguration"] = {"OutputLocation": output_location}

    query_execution_id = ATHENA.start_query_execution(**params)["QueryExecutionId"]
    _wait_for_query(query_execution_id)
    return _fetch_all_rows(query_execution_id)


def _wait_for_query(query_execution_id: str) -> None:
    poll_interval = float(os.environ.get("QUERY_POLL_INTERVAL_SECONDS", "1.0"))
    timeout_seconds = int(os.environ.get("QUERY_TIMEOUT_SECONDS", "30"))
    deadline = time.time() + timeout_seconds

    while time.time() < deadline:
        execution = ATHENA.get_query_execution(QueryExecutionId=query_execution_id)[
            "QueryExecution"
        ]
        status = execution["Status"]["State"]
        if status == "SUCCEEDED":
            return
        if status in {"FAILED", "CANCELLED"}:
            reason = execution["Status"].get("StateChangeReason", "No reason provided")
            raise RuntimeError(f"Athena query {status.lower()}: {reason}")
        time.sleep(poll_interval)

    ATHENA.stop_query_execution(QueryExecutionId=query_execution_id)
    raise TimeoutError(f"Athena query timed out after {timeout_seconds} seconds.")


def _fetch_all_rows(query_execution_id: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    next_token: str | None = None
    column_names: list[str] | None = None

    while True:
        request: dict[str, Any] = {"QueryExecutionId": query_execution_id}
        if next_token:
            request["NextToken"] = next_token

        response = ATHENA.get_query_results(**request)
        result_set = response["ResultSet"]
        column_info = result_set["ResultSetMetadata"]["ColumnInfo"]
        if column_names is None:
            column_names = [column["Name"] for column in column_info]

        for row in result_set.get("Rows", []):
            values = [cell.get("VarCharValue", "") for cell in row.get("Data", [])]
            if column_names and values == column_names:
                continue
            if not values:
                continue
            normalized = {
                name: values[index] if index < len(values) else ""
                for index, name in enumerate(column_names)
            }
            rows.append(normalized)

        next_token = response.get("NextToken")
        if not next_token:
            return rows


def _annotation_row_to_summary(row: dict[str, str]) -> dict[str, Any]:
    raw_payload = row.get("text_value")
    if not raw_payload:
        raise ValueError("Athena row is missing text_value.")

    payload = json.loads(raw_payload)
    missing_fields = [
        field for field in REQUIRED_RESULT_FIELDS if not payload.get(field)
    ]
    if missing_fields:
        raise ValueError(
            f"run-summary annotation missing fields: {', '.join(missing_fields)}"
        )

    run_id = payload["run_id"]
    artifacts = [
        _to_artifact(run_id, payload["fps_key"], "fps"),
        _to_artifact(run_id, payload["memory_key"], "memory"),
        _to_artifact(run_id, payload["log_key"], "log"),
    ]

    summary: dict[str, Any] = {
        "runId": run_id,
        "gameVersion": payload["game_version"],
        "platform": payload["platform"],
        "testName": payload["test_name"],
        "status": payload["result"],
        "timestamp": payload["executed_at"],
        "fpsDataUrl": _to_cloudfront_data_url(run_id, payload["fps_key"]),
        "memoryDataUrl": _to_cloudfront_data_url(run_id, payload["memory_key"]),
        "logsDataUrl": _to_cloudfront_data_url(run_id, payload["log_key"]),
        "artifacts": artifacts,
    }

    video_key = payload.get("video_key")
    if video_key:
        video_artifact = _to_artifact(run_id, video_key, "video")
        artifacts.append(video_artifact)
        summary["videoUrl"] = video_artifact["url"]

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


def _escape_sql_literal(value: str) -> str:
    return value.replace("'", "''")


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _json_response(status_code: int, body: Any) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
