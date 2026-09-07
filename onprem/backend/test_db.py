"""Unit tests for onprem/backend/db.py SQLite database layer."""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

# Set temporary DB path before importing db
temp_dir = tempfile.TemporaryDirectory()
os.environ["STORAGE_PATH"] = temp_dir.name
os.environ["DB_PATH"] = str(Path(temp_dir.name) / "db" / "qa.db")

import db


class TestSQLiteDatabase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db.init_db()

    def setUp(self):
        # Clean tables before each test
        with db.get_db() as conn:
            conn.execute("DELETE FROM test_runs")
            conn.execute("DELETE FROM api_keys")

    def test_journal_mode_is_wal(self):
        with db.get_db() as conn:
            cursor = conn.execute("PRAGMA journal_mode;")
            mode = cursor.fetchone()[0]
            self.assertEqual(mode.lower(), "wal")

    def test_upsert_and_get_run(self):
        artifacts = [
            {"fileName": "fps_metrics.csv", "type": "fps", "url": "/data/runs/run-001/fps_metrics.csv"},
            {"fileName": "capture.mp4", "type": "video", "url": "/data/runs/run-001/capture.mp4"},
        ]
        db.upsert_run(
            run_id="run-001",
            executed_at="2026-09-07T12:00:00Z",
            game_version="v1.0.0",
            platform="PS5",
            test_name="CombatTest",
            status="PASSED",
            artifacts=artifacts,
            avg_fps=59.8,
            min_fps=45.2,
            peak_memory_mb=4200.5,
            duration_seconds=300.5,
            device_model="PlayStation 5 CFI-1200",
            triggered_by="nightly",
            total_size_bytes=1048576,
            fps_data_url="/data/runs/run-001/fps_metrics.csv",
            video_url="/data/runs/run-001/capture.mp4",
        )

        run = db.get_run_by_id("run-001")
        self.assertIsNotNone(run)
        self.assertEqual(run["runId"], "run-001")
        self.assertEqual(run["gameVersion"], "v1.0.0")
        self.assertEqual(run["platform"], "PS5")
        self.assertEqual(run["testName"], "CombatTest")
        self.assertEqual(run["status"], "PASSED")
        self.assertEqual(run["timestamp"], "2026-09-07T12:00:00Z")
        self.assertEqual(run["avgFps"], 59.8)
        self.assertEqual(run["minFps"], 45.2)
        self.assertEqual(run["peakMemoryMb"], 4200.5)
        self.assertEqual(run["durationSeconds"], 300.5)
        self.assertEqual(run["deviceModel"], "PlayStation 5 CFI-1200")
        self.assertEqual(run["triggeredBy"], "nightly")
        self.assertEqual(run["totalSizeBytes"], 1048576)
        self.assertEqual(run["fpsDataUrl"], "/data/runs/run-001/fps_metrics.csv")
        self.assertEqual(run["videoUrl"], "/data/runs/run-001/capture.mp4")
        self.assertEqual(len(run["artifacts"]), 2)

    def test_upsert_replaces_existing_run(self):
        db.upsert_run(
            run_id="run-update",
            executed_at="2026-09-07T12:00:00Z",
            game_version="v1.0.0",
            platform="Win64",
            test_name="Benchmark",
            status="FAILED",
            artifacts=[],
            avg_fps=30.0,
        )
        # Update with new status and avg_fps
        db.upsert_run(
            run_id="run-update",
            executed_at="2026-09-07T12:05:00Z",
            game_version="v1.0.1",
            platform="Win64",
            test_name="Benchmark",
            status="PASSED",
            artifacts=[],
            avg_fps=60.0,
        )

        run = db.get_run_by_id("run-update")
        self.assertEqual(run["status"], "PASSED")
        self.assertEqual(run["gameVersion"], "v1.0.1")
        self.assertEqual(run["avgFps"], 60.0)

    def test_search_runs_filtering_and_sorting(self):
        # Insert 3 runs with different dates, platforms, statuses
        db.upsert_run(
            run_id="run-a",
            executed_at="2026-09-05T10:00:00Z",
            game_version="1.0.0",
            platform="PS5",
            test_name="BossFight",
            status="PASSED",
            artifacts=[],
        )
        db.upsert_run(
            run_id="run-b",
            executed_at="2026-09-06T10:00:00Z",
            game_version="1.1.0-alpha",
            platform="XSX",
            test_name="BossFight_Hard",
            status="FAILED",
            artifacts=[],
        )
        db.upsert_run(
            run_id="run-c",
            executed_at="2026-09-07T10:00:00Z",
            game_version="1.1.0-beta",
            platform="PS5",
            test_name="TutorialLevel",
            status="PASSED",
            artifacts=[],
        )
        db.upsert_run(
            run_id="run-d",
            executed_at="2026-09-08T10:00:00Z",
            game_version="1.2.0",
            platform="Windows",
            test_name="CrashRecovery",
            status="ABORTED",
            artifacts=[],
        )

        # 1. Order by executed_at DESC by default
        all_runs = db.search_runs()
        self.assertEqual(len(all_runs), 4)
        self.assertEqual([r["runId"] for r in all_runs], ["run-d", "run-c", "run-b", "run-a"])

        # 2. Filter by platform
        ps5_runs = db.search_runs(platform="PS5")
        self.assertEqual(len(ps5_runs), 2)
        self.assertEqual([r["runId"] for r in ps5_runs], ["run-c", "run-a"])

        # 3. Filter by status
        failed_runs = db.search_runs(status="FAILED")
        self.assertEqual(len(failed_runs), 1)
        self.assertEqual(failed_runs[0]["runId"], "run-b")

        aborted_runs = db.search_runs(status="ABORTED")
        self.assertEqual(len(aborted_runs), 1)
        self.assertEqual(aborted_runs[0]["runId"], "run-d")

        # 4. Filter by test_name substring
        boss_runs = db.search_runs(test_name="BossFight")
        self.assertEqual(len(boss_runs), 2)

        # 5. Filter by game_version substring
        beta_runs = db.search_runs(game_version="beta")
        self.assertEqual(len(beta_runs), 1)
        self.assertEqual(beta_runs[0]["runId"], "run-c")

        # 6. Pagination
        page_1 = db.search_runs(limit=1, offset=0)
        self.assertEqual(len(page_1), 1)
        self.assertEqual(page_1[0]["runId"], "run-d")

        page_2 = db.search_runs(limit=1, offset=1)
        self.assertEqual(len(page_2), 1)
        self.assertEqual(page_2[0]["runId"], "run-c")

    def test_api_key_lifecycle(self):
        # 1. Create key
        key_result = db.create_api_key(name="CI Build Key", email="ci-bot@example.com")
        key_id = key_result["keyId"]
        api_key = key_result["apiKey"]
        self.assertTrue(api_key.startswith("gqa_live_"))

        # 2. Verify key
        verified = db.verify_api_key(api_key)
        self.assertIsNotNone(verified)
        self.assertEqual(verified["key_id"], key_id)
        self.assertEqual(verified["name"], "CI Build Key")
        self.assertEqual(verified["email"], "ci-bot@example.com")

        # 3. Invalid key verification
        self.assertIsNone(db.verify_api_key("gqa_live_invalidkey"))
        self.assertIsNone(db.verify_api_key(""))

        # 4. List keys for email
        user_keys = db.list_keys_for_email("ci-bot@example.com")
        self.assertEqual(len(user_keys), 1)
        self.assertEqual(user_keys[0]["keyId"], key_id)

        # Other user has no keys
        other_keys = db.list_keys_for_email("other@example.com")
        self.assertEqual(len(other_keys), 0)

        # 5. Delete key
        self.assertTrue(db.delete_api_key(key_id, "ci-bot@example.com"))
        self.assertIsNone(db.verify_api_key(api_key))
        self.assertEqual(len(db.list_keys_for_email("ci-bot@example.com")), 0)

        # 6. Deleting non-existing key returns False
        self.assertFalse(db.delete_api_key("non-existent-id", "ci-bot@example.com"))

    def test_api_key_expired(self):
        # Create key with expired date
        key_result = db.create_api_key(
            name="Expired Key",
            email="tester@example.com",
            expires_at="2020-01-01T00:00:00Z",
        )
        api_key = key_result["apiKey"]
        # Verification should return None
        self.assertIsNone(db.verify_api_key(api_key))


if __name__ == "__main__":
    unittest.main()
