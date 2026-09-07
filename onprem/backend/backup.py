"""SQLite WAL database backup utility.

Creates a safe, consistent online backup of the SQLite WAL database using
Python's built-in sqlite3.Connection.backup() API, verifies integrity,
and cleans up older backup snapshots.
"""

from __future__ import annotations

import argparse
import gzip
import logging
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
LOGGER = logging.getLogger("qa-backend.backup")


def backup_database(
    db_path: Path,
    output_dir: Path,
    keep_days: int = 14,
    compress: bool = True,
) -> Path:
    """Create a consistent online backup of the SQLite database.

    Args:
        db_path: Path to the SQLite database file.
        output_dir: Directory where backup files should be stored.
        keep_days: Number of days to retain backup files (0 to disable deletion).
        compress: Whether to gzip-compress the resulting backup file.

    Returns:
        Path to the generated backup file (.db or .db.gz).
    """
    db_path = db_path.resolve()
    output_dir = output_dir.resolve()

    if not db_path.exists():
        raise FileNotFoundError(f"Source database file not found: {db_path}")

    output_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    temp_backup_file = output_dir / f"qa_backup_{timestamp}.tmp"
    final_raw_file = output_dir / f"qa_backup_{timestamp}.db"

    LOGGER.info("Starting SQLite backup: %s -> %s", db_path, final_raw_file)

    # 1. Atomic online backup using sqlite3.Connection.backup()
    src_conn = sqlite3.connect(str(db_path))
    try:
        dest_conn = sqlite3.connect(str(temp_backup_file))
        try:
            src_conn.backup(dest_conn)
        finally:
            dest_conn.close()
    finally:
        src_conn.close()

    # 2. Integrity check on the backup snapshot
    chk_conn = sqlite3.connect(str(temp_backup_file))
    try:
        cur = chk_conn.cursor()
        cur.execute("PRAGMA integrity_check;")
        row = cur.fetchone()
        result = row[0] if row else "failed"
        if result != "ok":
            temp_backup_file.unlink(missing_ok=True)
            raise RuntimeError(f"Backup integrity check failed: {result}")
    finally:
        chk_conn.close()

    # Rename temp to final
    temp_backup_file.rename(final_raw_file)
    LOGGER.info("Backup integrity check passed (ok). Raw snapshot size: %d bytes", final_raw_file.stat().st_size)

    # 3. Optional gzip compression
    target_file = final_raw_file
    if compress:
        compressed_file = output_dir / f"qa_backup_{timestamp}.db.gz"
        LOGGER.info("Compressing snapshot to %s ...", compressed_file)
        with open(final_raw_file, "rb") as f_in:
            with gzip.open(compressed_file, "wb", compresslevel=6) as f_out:
                shutil.copyfileobj(f_in, f_out)
        final_raw_file.unlink(missing_ok=True)
        target_file = compressed_file
        LOGGER.info("Compressed backup saved: %s (%d bytes)", target_file, target_file.stat().st_size)

    # 4. Retention cleanup of older backups
    if keep_days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=keep_days)
        LOGGER.info("Purging backups older than %d days (cutoff: %s) ...", keep_days, cutoff.isoformat())
        purged_count = 0
        for item in output_dir.glob("qa_backup_*"):
            if item == target_file:
                continue
            try:
                mtime = datetime.fromtimestamp(item.stat().st_mtime, tz=timezone.utc)
                if mtime < cutoff:
                    item.unlink(missing_ok=True)
                    purged_count += 1
                    LOGGER.info("Purged old backup: %s", item.name)
            except Exception as exc:
                LOGGER.warning("Failed to inspect/delete %s: %s", item, exc)
        LOGGER.info("Retention cleanup completed: %d old backup files purged.", purged_count)

    return target_file


def main() -> int:
    parser = argparse.ArgumentParser(description="SQLite WAL Database Backup Tool")
    parser.add_argument(
        "--db-path",
        default=os.environ.get("DB_PATH", "/data/db/qa.db"),
        help="Path to source SQLite database (default: $DB_PATH or /data/db/qa.db)",
    )
    parser.add_argument(
        "--output-dir",
        default=os.environ.get("BACKUP_DIR", ""),
        help="Directory to store backups (default: <db_dir>/backups)",
    )
    parser.add_argument(
        "--keep-days",
        type=int,
        default=14,
        help="Number of days to keep backup files (default: 14, 0 to disable)",
    )
    parser.add_argument(
        "--no-compress",
        action="store_true",
        help="Disable gzip compression for the backup file",
    )

    args = parser.parse_args()

    db_path = Path(args.db_path)
    output_dir = Path(args.output_dir) if args.output_dir else db_path.parent / "backups"

    try:
        result_path = backup_database(
            db_path=db_path,
            output_dir=output_dir,
            keep_days=args.keep_days,
            compress=not args.no_compress,
        )
        LOGGER.info("Backup successfully completed: %s", result_path)
        return 0
    except Exception as exc:
        LOGGER.error("Backup failed: %s", exc, exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
