# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "boto3>=1.34",
#     "moto[s3,dynamodb]>=5.0",
# ]
# ///
"""Stage 2 Pipeline Integration Test (CLI -> S3 -> Manifest Indexer -> DynamoDB -> Search API).

Validates the full data registration and search pipeline locally without requiring
AWS credentials or Docker. Can also run against an active LocalStack instance when
--endpoint-url is provided.

Usage:
    uv run scripts/test_local_pipeline.py
    uv run scripts/test_local_pipeline.py --endpoint-url http://localhost:4566
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

# Configure mock environment variables before importing AWS modules
os.environ["AWS_ACCESS_KEY_ID"] = "mock-access-key"
os.environ["AWS_SECRET_ACCESS_KEY"] = "mock-secret-key"
os.environ["AWS_DEFAULT_REGION"] = "ap-northeast-1"
os.environ["TABLE_NAME"] = "GameQaDashboard-SearchIndex"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "cli"))
sys.path.insert(0, str(PROJECT_ROOT / "infra" / "lambda" / "manifest-indexer"))
sys.path.insert(0, str(PROJECT_ROOT / "infra" / "lambda" / "search"))

import boto3
import moto
import qa_upload


def create_dynamodb_table(dynamodb_resource: Any, table_name: str):
    return dynamodb_resource.create_table(
        TableName=table_name,
        KeySchema=[
            {"AttributeName": "runId", "KeyType": "HASH"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "runId", "AttributeType": "S"},
            {"AttributeName": "platform", "AttributeType": "S"},
            {"AttributeName": "status", "AttributeType": "S"},
            {"AttributeName": "gsiAllPk", "AttributeType": "S"},
            {"AttributeName": "executedAt", "AttributeType": "S"},
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "platform-index",
                "KeySchema": [
                    {"AttributeName": "platform", "KeyType": "HASH"},
                    {"AttributeName": "executedAt", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            },
            {
                "IndexName": "status-index",
                "KeySchema": [
                    {"AttributeName": "status", "KeyType": "HASH"},
                    {"AttributeName": "executedAt", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            },
            {
                "IndexName": "all-index",
                "KeySchema": [
                    {"AttributeName": "gsiAllPk", "KeyType": "HASH"},
                    {"AttributeName": "executedAt", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            },
        ],
        BillingMode="PAY_PER_REQUEST",
    )


def run_pipeline_test(endpoint_url: str | None = None) -> bool:
    print("=" * 70)
    print("Stage 2: Local Data Pipeline Test")
    print("=" * 70)
    if endpoint_url:
        print(f"Targeting local endpoint: {endpoint_url}")
    else:
        print("Running with in-memory moto mock (zero external dependencies)...")

    bucket_name = "qa-data"
    table_name = "GameQaDashboard-SearchIndex"
    region = "ap-northeast-1"

    # Context manager for moto if no external endpoint_url is passed
    ctx = moto.mock_aws() if not endpoint_url else None
    if ctx:
        ctx.start()

    try:
        s3_client = boto3.client("s3", region_name=region, endpoint_url=endpoint_url)
        dynamodb_resource = boto3.resource(
            "dynamodb", region_name=region, endpoint_url=endpoint_url
        )

        # 1. Setup S3 bucket and DynamoDB table
        print("\n1. Initializing S3 bucket and DynamoDB table...")
        try:
            s3_client.create_bucket(
                Bucket=bucket_name,
                CreateBucketConfiguration={"LocationConstraint": region},
            )
        except Exception:
            # Bucket might already exist on LocalStack
            pass

        try:
            create_dynamodb_table(dynamodb_resource, table_name)
        except Exception:
            # Table might already exist on LocalStack
            pass
        print(
            f"   [OK] S3 bucket '{bucket_name}' and DynamoDB table '{table_name}' ready."
        )

        # 2. Prepare dummy run folder
        print("\n2. Preparing test run artifacts (child files)...")
        with tempfile.TemporaryDirectory() as tmpdir:
            run_dir = Path(tmpdir)
            (run_dir / "fps_metrics.csv").write_text(
                "frame,fps\n1,60.1\n2,59.9\n3,58.4\n", encoding="utf-8"
            )
            (run_dir / "memory_metrics.csv").write_text(
                "timestamp,used_mb\n1,4096\n2,4120\n", encoding="utf-8"
            )
            (run_dir / "ue.log").write_text(
                "[2026.09.06-12.00.00:000][  0]LogInit: Display: Game QA started\n",
                encoding="utf-8",
            )
            (run_dir / "capture.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42\x00\x00")

            run_id = "run-stage2-test"
            print(f"   Created sample run {run_id} in {run_dir}")

            # 3. Test CLI upload with mock auth
            print("\n3. Executing CLI upload (qa_upload.py with --mock-auth)...")
            args = qa_upload.parse_args() if False else None
            from argparse import Namespace

            upload_args = Namespace(
                command="upload",
                bucket=bucket_name,
                run_dir=run_dir,
                run_id=run_id,
                executed_at="2026-09-06T12:00:00Z",
                game_version="v2.0.0-dev",
                platform="PS5",
                test_name="BossFight_Stage2",
                result="PASSED",
                avg_fps=59.5,
                role_arn=None,
                google_client_id=None,
                google_client_secret=None,
                token_cache=None,
                no_browser=True,
                profile=None,
                endpoint_url=endpoint_url,
                mock_auth=True,
                region=region,
            )

            ret = qa_upload.handle_upload(upload_args)
            if ret != 0:
                print("   [FAIL] CLI upload failed!", file=sys.stderr)
                return False
            print("   [OK] CLI uploaded child files and manifest.json to S3.")

        # 4. Verify S3 contents
        manifest_key = f"runs/{run_id}/manifest.json"
        manifest_obj = s3_client.get_object(Bucket=bucket_name, Key=manifest_key)
        manifest_data = json.loads(manifest_obj["Body"].read().decode("utf-8"))
        assert manifest_data["run_id"] == run_id
        assert manifest_data["platform"] == "PS5"
        print(f"   [OK] Verified manifest in s3://{bucket_name}/{manifest_key}")

        # 5. Invoke Manifest Indexer Lambda handler
        print("\n4. Triggering manifest-indexer Lambda handler...")
        import importlib.util

        indexer_spec = importlib.util.spec_from_file_location(
            "manifest_indexer",
            str(PROJECT_ROOT / "infra" / "lambda" / "manifest-indexer" / "index.py"),
        )
        indexer_mod = importlib.util.module_from_spec(indexer_spec)
        indexer_spec.loader.exec_module(indexer_mod)
        indexer_mod.DYNAMODB = dynamodb_resource
        indexer_mod.S3 = s3_client

        s3_event = {
            "Records": [
                {
                    "s3": {
                        "bucket": {"name": bucket_name},
                        "object": {"key": manifest_key},
                    }
                }
            ]
        }
        indexer_mod.handler(s3_event, None)
        print("   [OK] manifest-indexer processed S3 event successfully.")

        # 6. Verify item in DynamoDB
        print("\n5. Checking DynamoDB index entry...")
        table = dynamodb_resource.Table(table_name)
        item = table.get_item(Key={"runId": run_id}).get("Item")
        if not item:
            print("   [FAIL] Item not found in DynamoDB!", file=sys.stderr)
            return False
        assert item["runId"] == run_id
        assert item["platform"] == "PS5"
        assert item["status"] == "PASSED"
        print(
            f"   [OK] Verified item in DynamoDB: runId={item['runId']}, platform={item['platform']}"
        )

        # 7. Invoke Search Lambda handler
        print("\n6. Querying /api/search via search Lambda handler...")
        search_spec = importlib.util.spec_from_file_location(
            "search_lambda",
            str(PROJECT_ROOT / "infra" / "lambda" / "search" / "index.py"),
        )
        search_mod = importlib.util.module_from_spec(search_spec)
        search_spec.loader.exec_module(search_mod)
        search_mod.DYNAMODB = dynamodb_resource

        # Query 1: All runs
        res_all = search_mod.handler(
            {"httpMethod": "POST", "body": json.dumps({})}, None
        )
        assert res_all["statusCode"] == 200
        runs_all = json.loads(res_all["body"])
        assert any(r["runId"] == run_id for r in runs_all)
        print(f"   [OK] Search (all): Found {len(runs_all)} runs.")

        # Query 2: Platform filter
        res_platform = search_mod.handler(
            {"httpMethod": "POST", "body": json.dumps({"platform": "PS5"})}, None
        )
        assert res_platform["statusCode"] == 200
        runs_ps5 = json.loads(res_platform["body"])
        assert any(r["runId"] == run_id for r in runs_ps5)
        print(f"   [OK] Search (platform=PS5): Found {len(runs_ps5)} matching runs.")

        # Query 3: Non-matching filter
        res_none = search_mod.handler(
            {
                "httpMethod": "POST",
                "body": json.dumps({"platform": "NintendoSwitch"}),
            },
            None,
        )
        assert res_none["statusCode"] == 200
        runs_none = json.loads(res_none["body"])
        assert not any(r["runId"] == run_id for r in runs_none)
        print("   [OK] Search (platform=NintendoSwitch): Correctly filtered out.")

        print("\n" + "=" * 70)
        print("ALL PIPELINE TESTS PASSED! Stage 2 is verified and fully functional.")
        print("=" * 70)
        return True

    finally:
        if ctx:
            ctx.stop()


def main():
    parser = argparse.ArgumentParser(
        description="Run local Stage 2 pipeline test (CLI -> S3 -> Indexer -> DynamoDB -> Search)."
    )
    parser.add_argument(
        "--endpoint-url",
        help="Custom S3/DynamoDB endpoint URL (e.g. http://localhost:4566 for LocalStack).",
    )
    args = parser.parse_args()

    success = run_pipeline_test(endpoint_url=args.endpoint_url)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
