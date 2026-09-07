# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "fastapi>=0.115.0",
#     "uvicorn>=0.32.0",
#     "pydantic>=2.9.0",
#     "python-multipart>=0.0.12",
#     "aiofiles>=24.1.0",
# ]
# ///
"""Pipeline Integration Test (CLI -> FastAPI Backend -> Local Storage & SQLite -> Search API).

Validates the complete on-premises data upload, auto-indexing, and search pipeline locally
using SQLite WAL mode with zero external cloud dependencies.

Usage:
    uv run scripts/test_local_pipeline.py
"""

from __future__ import annotations

import json
import os
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from argparse import Namespace
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "cli"))
sys.path.insert(0, str(PROJECT_ROOT / "onprem" / "backend"))

import qa_upload
import uvicorn


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


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


def run_pipeline_test() -> bool:
    print("=" * 70)
    print("On-Premises Data Pipeline & SQLite Search Test")
    print("=" * 70)

    # Setup temporary storage and start FastAPI backend
    with tempfile.TemporaryDirectory() as storage_dir:
        storage_path = Path(storage_dir)
        db_path = storage_path / "db" / "qa.db"
        os.environ["STORAGE_PATH"] = str(storage_path)
        os.environ["DB_PATH"] = str(db_path)

        # Import onprem backend app and configure its storage
        import db
        import main as backend_main

        backend_main.STORAGE_PATH = storage_path
        backend_main.RUNS_DIR = storage_path / "runs"
        backend_main.RUNS_DIR.mkdir(parents=True, exist_ok=True)
        db.STORAGE_PATH = storage_path
        db.DB_PATH = db_path
        db.init_db()

        port = find_free_port()
        server_url = f"http://127.0.0.1:{port}"

        print(f"\n1. Starting FastAPI backend server at {server_url} ...")
        server_thread = ServerThread(backend_main.app, "127.0.0.1", port)
        server_thread.start()

        if not wait_for_server(server_url):
            print("   [FAIL] Backend server failed to start within timeout!", file=sys.stderr)
            server_thread.stop()
            return False
        print("   [OK] Backend server is healthy and ready.")

        # 2. Create personal API key for CLI upload
        print("\n2. Creating API key via /api/keys ...")
        create_key_req = urllib.request.Request(
            f"{server_url}/api/keys",
            data=json.dumps({"name": "OnPrem CLI Test Key"}).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-Forwarded-Email": "qa-tester@example.com",
            },
            method="POST",
        )
        with urllib.request.urlopen(create_key_req) as resp:
            key_data = json.loads(resp.read().decode("utf-8"))
        api_key = key_data["apiKey"]
        key_id = key_data["keyId"]
        print(f"   [OK] Issued API key {key_id} ({api_key[:12]}...).")

        # 3. List API keys and verify
        print("\n3. Listing API keys via /api/keys ...")
        list_keys_req = urllib.request.Request(
            f"{server_url}/api/keys",
            headers={"X-Forwarded-Email": "qa-tester@example.com"},
        )
        with urllib.request.urlopen(list_keys_req) as resp:
            keys_list = json.loads(resp.read().decode("utf-8"))
        assert len(keys_list) == 1
        assert keys_list[0]["keyId"] == key_id
        print(f"   [OK] Listed {len(keys_list)} key(s) for user.")

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
                "[2026.09.07-12.00.00:000][  0]LogInit: Display: Game QA started\n",
                encoding="utf-8",
            )
            (run_dir / "capture.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42\x00\x00")
            (run_dir / "crash.dmp").write_bytes(b"\x00" * 32)
            (run_dir / "screenshot.png").write_bytes(b"\x89PNG\r\n\x1a\n")

            run_id = "run-onprem-sqlite-test"
            print(f"   Created sample run {run_id} in {run_dir}")

            # 5. Execute CLI HTTP upload
            print(f"\n5. Executing CLI HTTP upload ({server_url})...")
            upload_args = Namespace(
                command="upload",
                run_dir=run_dir,
                run_id=run_id,
                executed_at="2026-09-07T12:00:00Z",
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
                region="ap-northeast-1",
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

        # 7. Verify SQLite database directly
        print("\n7. Checking SQLite database index entry...")
        run_record = db.get_run_by_id(run_id)
        assert run_record is not None, "Item not found in SQLite!"
        assert run_record["runId"] == run_id
        assert run_record["platform"] == "PS5"
        assert run_record["status"] == "PASSED"
        assert run_record["fpsDataUrl"] == f"/data/runs/{run_id}/fps_metrics.csv"
        assert len(run_record["artifacts"]) == 6
        print(
            f"   [OK] Verified SQLite run: runId={run_record['runId']}, platform={run_record['platform']}, avgFps={run_record.get('avgFps')}"
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

        # 9. Query /api/runs/{run_id} via HTTP GET
        print(f"\n9. Querying /api/runs/{run_id} via HTTP GET...")
        with urllib.request.urlopen(f"{server_url}/api/runs/{run_id}") as resp:
            assert resp.status == 200
            detail = json.loads(resp.read().decode("utf-8"))
        assert detail["runId"] == run_id
        assert detail["testName"] == "BossFight_Stage2"
        print(f"   [OK] Direct run lookup returned: {detail['testName']}")

        # 10. Query /api/search with non-matching filter
        print("\n10. Querying /api/search with non-matching filter (status=FAILED)...")
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

        # 11. Run tamper protection: re-uploading without --overwrite must fail with 409 Conflict
        print("\n11. Testing run tamper protection (HTTP 409 Conflict)...")
        conflict_req = urllib.request.Request(
            f"{server_url}/api/upload/runs/{run_id}/dummy_tamper.txt",
            data=b"tamper content",
            headers={"Authorization": f"Bearer {api_key}"},
            method="PUT",
        )
        try:
            urllib.request.urlopen(conflict_req)
            print("   [FAIL] Expected HTTP 409 Conflict on finalized run upload!", file=sys.stderr)
            server_thread.stop()
            return False
        except urllib.error.HTTPError as err:
            assert err.code == 409, f"Expected 409 Conflict, got {err.code}"
            print("   [OK] Finalized run modification correctly rejected with 409 Conflict.")

        # 12. Run overwrite: uploading with ?overwrite=true must succeed
        print("\n12. Testing run overwrite (?overwrite=true)...")
        overwrite_req = urllib.request.Request(
            f"{server_url}/api/upload/runs/{run_id}/dummy_updated.txt?overwrite=true",
            data=b"authorized overwrite content",
            headers={"Authorization": f"Bearer {api_key}"},
            method="PUT",
        )
        with urllib.request.urlopen(overwrite_req) as resp:
            assert resp.status == 200
        assert (storage_path / "runs" / run_id / "dummy_updated.txt").exists()
        print("   [OK] Upload with overwrite=true succeeded.")

        # 13. Storage status & quota check (507 Insufficient Storage)
        print("\n13. Testing storage status and quota check (HTTP 507)...")
        status_req = urllib.request.Request(f"{server_url}/api/storage/status")
        with urllib.request.urlopen(status_req) as resp:
            assert resp.status == 200
            st_data = json.loads(resp.read().decode("utf-8"))
        assert "totalBytes" in st_data and "freeBytes" in st_data
        print(f"   [OK] Storage status: {st_data['freePercent']}% free ({st_data['freeBytes']} bytes).")

        # Simulate low disk space by raising MIN_DISK_FREE_PERCENT to 100%
        original_quota = backend_main.MIN_DISK_FREE_PERCENT
        try:
            backend_main.MIN_DISK_FREE_PERCENT = 100.0  # Force quota failure
            quota_req = urllib.request.Request(
                f"{server_url}/api/upload/runs/run-quota-test/file.txt",
                data=b"quota test",
                headers={"Authorization": f"Bearer {api_key}"},
                method="PUT",
            )
            try:
                urllib.request.urlopen(quota_req)
                print("   [FAIL] Expected HTTP 507 Insufficient Storage!", file=sys.stderr)
                server_thread.stop()
                return False
            except urllib.error.HTTPError as err:
                assert err.code == 507, f"Expected 507, got {err.code}"
                print("   [OK] Upload correctly rejected with 507 Insufficient Storage.")
        finally:
            backend_main.MIN_DISK_FREE_PERCENT = original_quota

        # 14. Automated large-file cleanup
        print("\n14. Testing automated large-file cleanup for expired runs...")
        import cleanup
        cleanup.RUNS_DIR = storage_path / "runs"

        # Create an expired run from 45 days ago
        from datetime import datetime, timedelta, timezone
        expired_id = "run-expired-45days"
        expired_dir = storage_path / "runs" / expired_id
        expired_dir.mkdir(parents=True, exist_ok=True)
        (expired_dir / "fps_metrics.csv").write_text("frame,fps\n1,60.0\n", encoding="utf-8")
        (expired_dir / "memory_metrics.csv").write_text("timestamp,used_mb\n1,2000\n", encoding="utf-8")
        (expired_dir / "ue.log").write_text("[2026.07.20] log\n", encoding="utf-8")
        (expired_dir / "capture.mp4").write_bytes(b"\x00" * 4096)
        (expired_dir / "crash.dmp").write_bytes(b"\x00" * 2048)
        exp_manifest = {
            "run_id": expired_id,
            "executed_at": (datetime.now(timezone.utc) - timedelta(days=45)).isoformat(),
            "game_version": "v1.0.0",
            "platform": "PS5",
            "test_name": "OldBossTest",
            "status": "FAILED",
            "artifacts": [
                {"fileName": "fps_metrics.csv", "type": "fps"},
                {"fileName": "memory_metrics.csv", "type": "memory"},
                {"fileName": "ue.log", "type": "log"},
                {"fileName": "capture.mp4", "type": "video"},
                {"fileName": "crash.dmp", "type": "dump"},
            ],
        }
        (expired_dir / "manifest.json").write_text(json.dumps(exp_manifest), encoding="utf-8")
        db.upsert_run(
            run_id=expired_id,
            executed_at=exp_manifest["executed_at"],
            game_version="v1.0.0",
            platform="PS5",
            test_name="OldBossTest",
            status="FAILED",
            artifacts=exp_manifest["artifacts"],
            video_url=f"/data/runs/{expired_id}/capture.mp4",
        )

        clean_summary = cleanup.cleanup_expired_runs(days=30, dry_run=False, runs_dir=cleanup.RUNS_DIR)
        assert clean_summary["runs_purged"] == 1
        assert clean_summary["files_purged"] == 2
        # Verify preserved files
        assert (expired_dir / "manifest.json").exists()
        assert (expired_dir / "fps_metrics.csv").exists()
        assert (expired_dir / "memory_metrics.csv").exists()
        assert (expired_dir / "ue.log").exists()
        # Verify purged files
        assert not (expired_dir / "capture.mp4").exists()
        assert not (expired_dir / "crash.dmp").exists()
        # Verify SQLite updated
        exp_db_run = db.get_run_by_id(expired_id)
        assert exp_db_run is not None
        assert "videoUrl" not in exp_db_run
        print("   [OK] Large files (video, dump) purged; metrics, logs, and manifest preserved.")

        # 15. Delete API key and verify revocation
        print(f"\n15. Revoking API key {key_id} via DELETE /api/keys/{key_id}...")
        del_req = urllib.request.Request(
            f"{server_url}/api/keys/{key_id}",
            headers={"X-Forwarded-Email": "qa-tester@example.com"},
            method="DELETE",
        )
        with urllib.request.urlopen(del_req) as resp:
            assert resp.status == 204
        print("   [OK] API key deleted successfully.")

        # Verify deleted key cannot be used
        unauth_req = urllib.request.Request(
            f"{server_url}/api/upload/runs/{run_id}/dummy.txt",
            data=b"test",
            headers={"Authorization": f"Bearer {api_key}"},
            method="PUT",
        )
        try:
            urllib.request.urlopen(unauth_req)
            print("   [FAIL] Revoked key was accepted!", file=sys.stderr)
            server_thread.stop()
            return False
        except urllib.error.HTTPError as err:
            assert err.code == 401
            print("   [OK] Revoked key correctly rejected with 401 Unauthorized.")

        # Stop the backend server
        server_thread.stop()

    print("\n" + "=" * 70)
    print("PIPELINE INTEGRATION TEST: ALL CHECKS PASSED!")
    print("=" * 70)
    return True


def main():
    success = run_pipeline_test()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
