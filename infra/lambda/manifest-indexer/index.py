"""Manifest indexer Lambda.

Triggered by S3 ObjectCreated events for runs/*/manifest.json on the data bucket.
Reads the manifest, flattens the searchable fields, and upserts one DynamoDB item
per run (PK = runId), keeping the search index idempotent under event redelivery
and re-uploads.

Environment variables:
- TABLE_NAME (required): DynamoDB table for the run search index.

Malformed manifests are logged and skipped (no raise) so S3's async-invoke retry
does not loop on permanently bad objects.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.parse
from decimal import Decimal
from typing import Any

import boto3

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)

DYNAMODB = boto3.resource("dynamodb")
S3 = boto3.client("s3")

# Manifest fields that must be present and non-empty to index a run.
REQUIRED_MANIFEST_FIELDS = (
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

# Single fixed partition value so the all-index GSI can list every run by executedAt.
ALL_PARTITION_VALUE = "ALL"


def handler(event: dict[str, Any], context: Any) -> None:
    del context
    table = DYNAMODB.Table(_required_env("TABLE_NAME"))

    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        try:
            manifest = _load_manifest(bucket, key)
            item = _manifest_to_item(manifest)
        except Exception:
            LOGGER.exception("Skipping unindexable manifest s3://%s/%s", bucket, key)
            continue

        table.put_item(Item=item)
        LOGGER.info("Indexed run %s from s3://%s/%s", item["runId"], bucket, key)


def _load_manifest(bucket: str, key: str) -> dict[str, Any]:
    body = S3.get_object(Bucket=bucket, Key=key)["Body"].read()
    manifest = json.loads(body)
    if not isinstance(manifest, dict):
        raise ValueError("manifest.json must contain a JSON object.")
    return manifest


def _manifest_to_item(manifest: dict[str, Any]) -> dict[str, Any]:
    missing = [field for field in REQUIRED_MANIFEST_FIELDS if not manifest.get(field)]
    if missing:
        raise ValueError(f"manifest missing required fields: {', '.join(missing)}")

    item: dict[str, Any] = {
        "runId": manifest["run_id"],
        "executedAt": manifest["executed_at"],
        "gameVersion": manifest["game_version"],
        "platform": manifest["platform"],
        "testName": manifest["test_name"],
        "status": manifest["result"],
        "fpsKey": manifest["fps_key"],
        "memoryKey": manifest["memory_key"],
        "logKey": manifest["log_key"],
        "gsiAllPk": ALL_PARTITION_VALUE,
    }

    video_key = manifest.get("video_key")
    if video_key:
        item["videoKey"] = video_key

    avg_fps = manifest.get("avg_fps")
    if avg_fps is not None:
        item["avgFps"] = Decimal(str(avg_fps))

    return item


def _required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value
