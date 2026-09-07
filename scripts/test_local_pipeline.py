# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "boto3>=1.35.0",
#     "moto[dynamodb]>=5.0",
#     "fastapi>=0.115.0",
#     "uvicorn>=0.32.0",
#     "pydantic>=2.9.0",
#     "python-multipart>=0.0.12",
# ]
# ///
"""Stage 2 Pipeline Integration Test (CLI -> FastAPI Backend -> Local Storage & DynamoDB -> Search API).

Validates the full on-premises data upload, auto-indexing, and search pipeline locally
without requiring AWS credentials or Docker. Can also run against an active LocalStack
instance when --endpoint-url is provided.

Usage:
    uv run scripts/test_local_pipeline.py
    uv run scripts/test_local_pipeline.py --endpoint-url http://localhost:4566
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import tempfile
import threading
import time
import urllib.request
from argparse import Namespace
from pathlib import Path
from typing import Any

# Configure mock environment variables before importing AWS modules
os.environ["AWS_ACCESS_KEY_ID"] = "mock-access-key"
os.environ["AWS_SECRET_ACCESS_KEY"] = "mock-secret-key"
os.environ["AWS_DEFAULT_REGION"] = "ap-northeast-1"
os.environ["TABLE_NAME"] = "GameQaDashboard-SearchIndex"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "cli"))
sys.path.insert(0, str(PROJECT_ROOT / "onprem" / "backend"))

import boto3
import moto
import qa_upload
import uvicorn


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


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


class ServerThread(threading.Thread):
    def __init__(self, app: Any, host: str, port: int):
        super().__init__(daemon=True)
        self.host = host
        self.port = port
        self.config = uvicorn.Config(
            app=app,
            host=host,
            port=port,
            log_level="warning",
            access_log=False,
        )
        self.server = uvicorn.Server(self.config)

    def run(self):
        self.server.run()

    def stop(self):
        self.server.should_exit = True


def wait_for_server(url: str, timeout: float = 5.0) -> bool:
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            with urllib.request.urlopen(f"{url}/api/health", timeout=1.0) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(0.1)
    return False


def run_pipeline_test(endpoint_url: str | None = None) -> bool:
    print("=" * 70)
    print("Stage 2: On-Premises Data Pipeline & Search Test")
    print("=" * 70)
    if endpoint_url:
        print(f"Targeting local DynamoDB endpoint: {endpoint_url}")
    else:
        print("Running with in-memory moto mock (zero external dependencies)...")

    table_name = "GameQaDashboard-SearchIndex"
    region = "ap-northeast-1"

    # Context manager for moto if no external endpoint_url is passed
    ctx = moto.mock_aws() if not endpoint_url else None
    if ctx:
        ctx.start()

    try:
        dynamodb_resource = boto3.resource(
            "dynamodb", region_name=region, endpoint_url=endpoint_url
        )

        # 1. Setup DynamoDB table
        print("\n1. Initializing DynamoDB table...")
        try:
            create_dynamodb_table(dynamodb_resource, table_name)
        except Exception:
            # Table might already exist on LocalStack
            pass
        print(f"   [OK] DynamoDB table '{table_name}' ready.")

        # 2. Setup temporary storage and start FastAPI backend
        with tempfile.TemporaryDirectory() as storage_dir:
            storage_path = Path(storage_dir)
            os.environ["STORAGE_PATH"] = str(storage_path)
            if endpoint_url:
                os.environ["DYNAMODB_ENDPOINT_URL"] = endpoint_url

            # Import onprem backend app and configure its storage
            import main as backend_main

            backend_main.STORAGE_PATH = storage_path
            backend_main.RUNS_DIR = storage_path / "runs"
            backend_main.KEYS_FILE = storage_path / "keys.json"
            backend_main.RUNS_DIR.mkdir(parents=True, exist_ok=True)
            backend_main.dynamodb = dynamodb_resource

            port = find_free_port()
            server_url = f"http://127.0.0.1:{port}"

            print(f"\n2. Starting FastAPI backend server at {server_url} ...")
            server_thread = ServerThread(backend_main.app, "127.0.0.1", port)
            server_thread.start()

            if not wait_for_server(server_url):
                print("   [FAIL] Backend server failed to start within timeout!", file=sys.stderr)
                server_thread.stop()
                return False
            print("   [OK] Backend server is healthy and ready.")

            # 3. Create personal API key for CLI upload
            print("\n3. Creating API key via /api/keys ...")
            create_key_req = urllib.request.Request(
                f"{server_url}/api/keys",
                data=json.dumps({"name": "Stage2 CLI Test Key"}).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "X-Forwarded-Email": "qa-tester@example.com",
                },
                method="POST",
            )
            with urllib.request.urlopen(create_key_req) as resp:
                key_data = json.loads(resp.read().decode("utf-8"))
            api_key = key_data["apiKey"]
            print(f"   [OK] Issued API key {key_data['keyId']} ({api_key[:12]}...).")

            # 4. Prepare test run artifacts (child files)
            print("\n4. Preparing test run artifacts (child files)...")
            with tempfile.TemporaryDirectory() as run_tmpdir:
                run_dir = Path(run_tmpdir)
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
                (run_dir / "crash.dmp").write_bytes(b"\x00" * 32)
                (run_dir / "screenshot.png").write_bytes(b"\x89PNG\r\n\x1a\n")

                run_id = "run-stage2-onprem-test"
                print(f"   Created sample run {run_id} in {run_dir}")

                # 5. Execute CLI HTTP upload
                print(f"\n5. Executing CLI HTTP upload ({server_url})...")
                upload_args = Namespace(
                    command="upload",
                    run_dir=run_dir,
                    run_id=run_id,
                    executed_at="2026-09-06T12:00:00Z",
                    game_version="v2.0.0-dev",
                    platform="PS5",
                    test_name="BossFight_Stage2",
                    result="PASSED",
                    avg_fps=59.5,
                    server_url=server_url,
                    api_key=api_key,
                    bucket=None,
                    role_arn=None,
                    google_client_id=None,
                    google_client_secret=None,
                    token_cache=None,
                    no_browser=True,
                    profile=None,
                    endpoint_url=None,
                    mock_auth=False,
                    region=region,
                    skip_transcode=True,
                    force_transcode=False,
                )

                ret = qa_upload.handle_upload(upload_args)
                if ret != 0:
                    print("   [FAIL] CLI HTTP upload failed!", file=sys.stderr)
                    server_thread.stop()
                    return False
                print("   [OK] CLI uploaded child files and manifest.json to backend.")

            # 6. Verify local storage files
            print("\n6. Verifying saved artifacts on disk...")
            saved_run_dir = storage_path / "runs" / run_id
            manifest_file = saved_run_dir / "manifest.json"
            assert manifest_file.exists(), f"manifest.json missing at {manifest_file}"
            manifest_data = json.loads(manifest_file.read_text(encoding="utf-8"))
            assert manifest_data["run_id"] == run_id
            assert manifest_data["platform"] == "PS5"
            assert manifest_data.get("schema_version") == "2.0"
            assert len(manifest_data.get("artifacts", [])) == 6
            print(
                f"   [OK] Verified {len(manifest_data['artifacts'])} artifacts and manifest.json in {saved_run_dir}."
            )

            # 7. Verify item auto-indexed in DynamoDB
            print("\n7. Checking DynamoDB index entry...")
            table = dynamodb_resource.Table(table_name)
            item = table.get_item(Key={"runId": run_id}).get("Item")
            if not item:
                print("   [FAIL] Item not found in DynamoDB!", file=sys.stderr)
                server_thread.stop()
                return False
            assert item["runId"] == run_id
            assert item["platform"] == "PS5"
            assert item["status"] == "PASSED"
            assert "artifacts" in item
            assert len(item["artifacts"]) == 6
            print(
                f"   [OK] Verified DynamoDB item: runId={item['runId']}, platform={item['platform']}, artifacts={len(item['artifacts'])}"
            )

            # 8. Query /api/search via HTTP POST
            print("\n8. Querying /api/search via HTTP POST...")
            search_body = json.dumps({"platform": "PS5"}).encode("utf-8")
            search_req = urllib.request.Request(
                f"{server_url}/api/search",
                data=search_body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(search_req) as resp:
                assert resp.status == 200
                runs = json.loads(resp.read().decode("utf-8"))

            assert len(runs) >= 1
            found_run = next((r for r in runs if r["runId"] == run_id), None)
            assert found_run is not None
            assert found_run["platform"] == "PS5"
            assert found_run["status"] == "PASSED"
            assert found_run["fpsDataUrl"].startswith("/data/runs/")
            assert len(found_run["artifacts"]) == 6
            print(f"   [OK] Search returned {len(runs)} run(s). Verified run: {found_run['runId']}")

            # 9. Query /api/search with non-matching filter
            search_body_failed = json.dumps({"status": "FAILED"}).encode("utf-8")
            search_req_failed = urllib.request.Request(
                f"{server_url}/api/search",
                data=search_body_failed,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(search_req_failed) as resp:
                runs_failed = json.loads(resp.read().decode("utf-8"))
            assert len(runs_failed) == 0
            print("   [OK] Filter status=FAILED correctly returned 0 runs.")

            # Stop the backend server
            server_thread.stop()

        print("\n" + "=" * 70)
        print("STAGE 2 PIPELINE TEST: ALL CHECKS PASSED!")
        print("=" * 70)
        return True

    finally:
        if ctx:
            ctx.stop()


def main():
    parser = argparse.ArgumentParser(
        description="Run local Stage 2 pipeline test (CLI -> Backend -> DynamoDB -> Search)"
    )
    parser.add_argument(
        "--endpoint-url",
        default=None,
        help="LocalStack DynamoDB endpoint URL (e.g., http://localhost:4566). If omitted, runs in-memory moto.",
    )
    args = parser.parse_args()
    success = run_pipeline_test(endpoint_url=args.endpoint_url)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
