"""Unit tests for SQLite WAL backup utility (backup.py)."""

from __future__ import annotations

import gzip
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import backup


class TestSQLiteBackup(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_path = Path(self.temp_dir.name)
        self.db_path = self.base_path / "test_qa.db"
        self.backup_dir = self.base_path / "backups"

        # Initialize test SQLite DB in WAL mode with sample data
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("CREATE TABLE test_data (id INTEGER PRIMARY KEY, val TEXT);")
        conn.execute("INSERT INTO test_data (val) VALUES ('record_1'), ('record_2');")
        conn.commit()
        conn.close()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_backup_creates_valid_compressed_snapshot(self) -> None:
        result = backup.backup_database(
            db_path=self.db_path,
            output_dir=self.backup_dir,
            keep_days=14,
            compress=True,
        )

        self.assertTrue(result.exists())
        self.assertTrue(result.name.endswith(".db.gz"))

        # Decompress and verify content in newly decompressed DB
        decompressed_db = self.base_path / "restored.db"
        with gzip.open(result, "rb") as f_in, open(decompressed_db, "wb") as f_out:
            f_out.write(f_in.read())

        chk_conn = sqlite3.connect(str(decompressed_db))
        cur = chk_conn.cursor()
        cur.execute("PRAGMA integrity_check;")
        self.assertEqual(cur.fetchone()[0], "ok")

        cur.execute("SELECT COUNT(*), val FROM test_data GROUP BY id ORDER BY id;")
        rows = cur.fetchall()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0][1], "record_1")
        self.assertEqual(rows[1][1], "record_2")
        chk_conn.close()

    def test_backup_uncompressed(self) -> None:
        result = backup.backup_database(
            db_path=self.db_path,
            output_dir=self.backup_dir,
            keep_days=14,
            compress=False,
        )

        self.assertTrue(result.exists())
        self.assertTrue(result.name.endswith(".db"))

        chk_conn = sqlite3.connect(str(result))
        cur = chk_conn.cursor()
        cur.execute("PRAGMA integrity_check;")
        self.assertEqual(cur.fetchone()[0], "ok")
        chk_conn.close()

    def test_backup_retention_purges_old_files(self) -> None:
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        old_file = self.backup_dir / "qa_backup_20200101_000000.db.gz"
        old_file.write_bytes(b"dummy")

        # Set mtime to 30 days ago
        old_time = (datetime.now(timezone.utc) - timedelta(days=30)).timestamp()
        import os
        os.utime(str(old_file), (old_time, old_time))

        self.assertTrue(old_file.exists())

        result = backup.backup_database(
            db_path=self.db_path,
            output_dir=self.backup_dir,
            keep_days=7,
            compress=True,
        )

        self.assertTrue(result.exists())
        # Old file should have been purged
        self.assertFalse(old_file.exists())

    def test_backup_nonexistent_db_raises(self) -> None:
        with self.assertRaises(FileNotFoundError):
            backup.backup_database(
                db_path=self.base_path / "nonexistent.db",
                output_dir=self.backup_dir,
            )


if __name__ == "__main__":
    unittest.main()
