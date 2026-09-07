"""Unit tests for storage cleanup, quota check, and tamper protection in onprem backend."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

# Configure test environment paths before importing db/main/cleanup
test_storage_dir = tempfile.TemporaryDirectory()
storage_path = Path(test_storage_dir.name)
os.environ["STORAGE_PATH"] = str(storage_path)
os.environ["DB_PATH"] = str(storage_path / "db" / "qa.db")

import cleanup
import db

try:
    from fastapi import HTTPException
    import main as backend_main
    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False
    HTTPException = None  # type: ignore[assignment,misc]
    backend_main = None  # type: ignore[assignment]


class TestCleanupAndProtection(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cleanup.STORAGE_PATH = storage_path
        cleanup.RUNS_DIR = storage_path / "runs"
        cleanup.RUNS_DIR.mkdir(parents=True, exist_ok=True)
        if HAS_FASTAPI and backend_main:
            backend_main.STORAGE_PATH = storage_path
            backend_main.RUNS_DIR = storage_path / "runs"
        db.init_db()

    def setUp(self):
        # Reset DB tables
        with db.get_db() as conn:
            conn.execute("DELETE FROM test_runs")
            conn.execute("DELETE FROM api_keys")
        # Clean runs dir
        if cleanup.RUNS_DIR.exists():
            shutil.rmtree(cleanup.RUNS_DIR)
        cleanup.RUNS_DIR.mkdir(parents=True, exist_ok=True)

    def test_cleanup_preserves_metrics_and_deletes_large_video_and_dump(self):
        # Create an expired run (> 30 days old)
        old_time = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
        run_id = "run-old-001"
        run_dir = cleanup.RUNS_DIR / run_id
        run_dir.mkdir(parents=True, exist_ok=True)

        fps_file = run_dir / "fps_metrics.csv"
        fps_file.write_text("frame,fps\n1,60.0\n", encoding="utf-8")

        mem_file = run_dir / "memory_metrics.csv"
        mem_file.write_text("timestamp,used_mb\n1,2048\n", encoding="utf-8")

        log_file = run_dir / "ue.log"
        log_file.write_text("[2026.08.01-00.00.00:000] Game QA run\n", encoding="utf-8")

        video_file = run_dir / "gameplay.mp4"
        video_file.write_bytes(b"\x00" * 1024)

        dump_file = run_dir / "crash.dmp"
        dump_file.write_bytes(b"\x00" * 512)

        manifest_data = {
            "run_id": run_id,
            "executed_at": old_time,
            "game_version": "1.0",
            "platform": "PS5",
            "test_name": "TestBoss",
            "status": "PASSED",
            "artifacts": [
                {"fileName": "fps_metrics.csv", "type": "fps", "url": f"/data/runs/{run_id}/fps_metrics.csv"},
                {"fileName": "memory_metrics.csv", "type": "memory", "url": f"/data/runs/{run_id}/memory_metrics.csv"},
                {"fileName": "ue.log", "type": "log", "url": f"/data/runs/{run_id}/ue.log"},
                {"fileName": "gameplay.mp4", "type": "video", "url": f"/data/runs/{run_id}/gameplay.mp4"},
                {"fileName": "crash.dmp", "type": "dump", "url": f"/data/runs/{run_id}/crash.dmp"},
            ],
        }
        manifest_file = run_dir / "manifest.json"
        manifest_file.write_text(json.dumps(manifest_data, indent=2), encoding="utf-8")

        # Index into SQLite
        db.upsert_run(
            run_id=run_id,
            executed_at=old_time,
            game_version="1.0",
            platform="PS5",
            test_name="TestBoss",
            status="PASSED",
            artifacts=manifest_data["artifacts"],
            video_url=f"/data/runs/{run_id}/gameplay.mp4",
        )

        # 1. Dry run should not delete anything
        dry_result = cleanup.cleanup_expired_runs(days=30, dry_run=True, runs_dir=cleanup.RUNS_DIR)
        self.assertEqual(dry_result["runs_purged"], 1)
        self.assertEqual(dry_result["files_purged"], 2)  # gameplay.mp4 and crash.dmp
        self.assertTrue(video_file.exists())
        self.assertTrue(dump_file.exists())

        # 2. Actual run should delete large files but preserve metrics and logs
        real_result = cleanup.cleanup_expired_runs(days=30, dry_run=False, runs_dir=cleanup.RUNS_DIR)
        self.assertEqual(real_result["runs_purged"], 1)
        self.assertEqual(real_result["files_purged"], 2)

        # Verify preserved files
        self.assertTrue(manifest_file.exists(), "manifest.json must be preserved!")
        self.assertTrue(fps_file.exists(), "fps_metrics.csv must be preserved!")
        self.assertTrue(mem_file.exists(), "memory_metrics.csv must be preserved!")
        self.assertTrue(log_file.exists(), "ue.log must be preserved!")

        # Verify deleted files
        self.assertFalse(video_file.exists(), "gameplay.mp4 must be purged!")
        self.assertFalse(dump_file.exists(), "crash.dmp must be purged!")

        # Verify updated manifest.json
        updated_manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        art_map = {a["fileName"]: a for a in updated_manifest["artifacts"]}
        self.assertTrue(art_map["gameplay.mp4"].get("purged"))
        self.assertTrue(art_map["crash.dmp"].get("purged"))
        self.assertFalse(art_map["fps_metrics.csv"].get("purged", False))

        # Verify SQLite record: video_url is cleared, artifacts marked purged
        db_run = db.get_run_by_id(run_id)
        self.assertIsNotNone(db_run)
        self.assertNotIn("videoUrl", db_run)  # cleared to None/omitted
        db_art_map = {a["fileName"]: a for a in db_run["artifacts"]}
        self.assertTrue(db_art_map["gameplay.mp4"].get("purged"))
        self.assertTrue(db_art_map["crash.dmp"].get("purged"))
        self.assertFalse(db_art_map["fps_metrics.csv"].get("purged", False))

    def test_cleanup_ignores_recent_runs(self):
        recent_time = datetime.now(timezone.utc).isoformat()
        run_id = "run-recent-001"
        run_dir = cleanup.RUNS_DIR / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        video_file = run_dir / "gameplay.mp4"
        video_file.write_bytes(b"\x00" * 1024)

        manifest_data = {
            "run_id": run_id,
            "executed_at": recent_time,
            "artifacts": [{"fileName": "gameplay.mp4", "type": "video"}],
        }
        (run_dir / "manifest.json").write_text(json.dumps(manifest_data), encoding="utf-8")

        result = cleanup.cleanup_expired_runs(days=30, dry_run=False, runs_dir=cleanup.RUNS_DIR)
        self.assertEqual(result["runs_purged"], 0)
        self.assertEqual(result["files_purged"], 0)
        self.assertTrue(video_file.exists())

    @unittest.skipUnless(HAS_FASTAPI, "fastapi not installed")
    def test_disk_quota_check_raises_507_when_space_low(self):
        # Mock disk usage to return low free space (5% free)
        fake_usage = (100 * 1024 * 1024 * 1024, 95 * 1024 * 1024 * 1024, 5 * 1024 * 1024 * 1024)
        with patch("shutil.disk_usage", return_value=fake_usage):
            with self.assertRaises(HTTPException) as ctx:
                backend_main._check_disk_quota(cleanup.RUNS_DIR)
            self.assertEqual(ctx.exception.status_code, 507)
            self.assertIn("Insufficient storage space", ctx.exception.detail)

    @unittest.skipUnless(HAS_FASTAPI, "fastapi not installed")
    def test_disk_quota_check_passes_when_space_sufficient(self):
        # Mock disk usage to return plenty of free space (50% free, 50GB)
        fake_usage = (100 * 1024 * 1024 * 1024, 50 * 1024 * 1024 * 1024, 50 * 1024 * 1024 * 1024)
        with patch("shutil.disk_usage", return_value=fake_usage):
            # Should not raise exception
            backend_main._check_disk_quota(cleanup.RUNS_DIR)

    @unittest.skipUnless(HAS_FASTAPI, "fastapi not installed")
    def test_storage_status_endpoint(self):
        fake_usage = (1000, 400, 600)
        with patch("shutil.disk_usage", return_value=fake_usage):
            status = backend_main.storage_status()
            self.assertEqual(status["totalBytes"], 1000)
            self.assertEqual(status["usedBytes"], 400)
            self.assertEqual(status["freeBytes"], 600)
            self.assertEqual(status["freePercent"], 60.0)


if __name__ == "__main__":
    unittest.main()
