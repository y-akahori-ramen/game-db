"""Automated storage cleanup for Game QA Dashboard.

Purges expired large files (videos, crash dumps) from runs older than a retention threshold (default: 30 days).
Strictly preserves essential analysis data:
- manifest.json
- fps_metrics.csv
- memory_metrics.csv
- ue.log

Updates manifest.json and SQLite database (marks artifacts as purged and clears video_url).

Usage:
    python cleanup.py [--days 30] [--dry-run] [--min-size-mb 50]
"""

from __future__ import annotations

import argparse
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
LOGGER = logging.getLogger("qa-backend.cleanup")

DEFAULT_RETENTION_DAYS = int(os.environ.get("RETENTION_DAYS", "30"))
STORAGE_PATH = Path(os.environ.get("STORAGE_PATH", "/data")).resolve()
RUNS_DIR = STORAGE_PATH / "runs"

PROTECTED_FILE_NAMES = {
    "manifest.json",
    "fps_metrics.csv",
    "memory_metrics.csv",
    "ue.log",
}
PROTECTED_EXTENSIONS = {".csv", ".log", ".json"}
LARGE_FILE_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm", ".dmp", ".dump"}


def is_protected_file(file_name: str) -> bool:
    name_lower = file_name.lower()
    if name_lower in PROTECTED_FILE_NAMES:
        return True
    ext = Path(name_lower).suffix
    return ext in PROTECTED_EXTENSIONS


def is_purgeable_file(file_path: Path, min_size_bytes: Optional[int] = None) -> bool:
    if not file_path.is_file():
        return False
    name = file_path.name
    if is_protected_file(name):
        return False

    suffix = file_path.suffix.lower()
    if suffix in LARGE_FILE_EXTENSIONS:
        return True

    if min_size_bytes is not None:
        try:
            return file_path.stat().st_size >= min_size_bytes
        except OSError:
            return False

    return False


def get_run_timestamp(run_dir: Path) -> Optional[datetime]:
    manifest_path = run_dir / "manifest.json"
    if manifest_path.is_file():
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
            exec_at = data.get("executed_at") or data.get("timestamp")
            if exec_at:
                # Replace trailing 'Z' for fromisoformat compatibility in python < 3.11
                if exec_at.endswith("Z"):
                    exec_at = exec_at[:-1] + "+00:00"
                dt = datetime.fromisoformat(exec_at)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt
        except Exception as exc:
            LOGGER.warning("Could not read executed_at from %s: %s", manifest_path, exc)

    # Fallback to directory mtime
    try:
        mtime = run_dir.stat().st_mtime
        return datetime.fromtimestamp(mtime, tz=timezone.utc)
    except OSError:
        return None


def cleanup_expired_runs(
    days: int = DEFAULT_RETENTION_DAYS,
    dry_run: bool = False,
    min_size_mb: Optional[float] = None,
    runs_dir: Optional[Path] = None,
) -> dict[str, Any]:
    """Scans runs_dir and purges large files older than `days` days.

    Preserves manifest.json, CSV metrics, and logs.
    Updates manifest.json and SQLite database.
    """
    target_dir = (runs_dir or RUNS_DIR).resolve()
    if not target_dir.exists():
        return {
            "runs_scanned": 0,
            "runs_purged": 0,
            "files_purged": 0,
            "bytes_freed": 0,
            "purged_items": [],
            "dry_run": dry_run,
            "cutoff_date": datetime.now(timezone.utc).isoformat(),
        }

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    min_size_bytes = int(min_size_mb * 1024 * 1024) if min_size_mb is not None else None

    runs_scanned = 0
    runs_purged = 0
    files_purged = 0
    bytes_freed = 0
    purged_items: list[dict[str, Any]] = []

    LOGGER.info(
        "Starting cleanup: retention=%d days, cutoff=%s, dry_run=%s, dir=%s",
        days,
        cutoff.isoformat(),
        dry_run,
        target_dir,
    )

    for entry in target_dir.iterdir():
        if not entry.is_dir():
            continue

        runs_scanned += 1
        run_id = entry.name
        run_time = get_run_timestamp(entry)

        if not run_time or run_time >= cutoff:
            continue

        # Run is older than retention cutoff
        purged_in_this_run: set[str] = set()
        video_purged = False

        for file_path in entry.iterdir():
            if not is_purgeable_file(file_path, min_size_bytes):
                continue

            try:
                f_size = file_path.stat().st_size
            except OSError:
                f_size = 0

            item_info = {
                "runId": run_id,
                "fileName": file_path.name,
                "sizeBytes": f_size,
                "path": str(file_path),
            }

            if file_path.suffix.lower() in {".mp4", ".avi", ".mov", ".mkv", ".webm"}:
                video_purged = True

            if not dry_run:
                try:
                    file_path.unlink()
                    LOGGER.info("Deleted large file: %s (%d bytes)", file_path, f_size)
                except Exception as exc:
                    LOGGER.error("Failed to delete %s: %s", file_path, exc)
                    continue

            purged_in_this_run.add(file_path.name)
            files_purged += 1
            bytes_freed += f_size
            purged_items.append(item_info)

        if purged_in_this_run:
            runs_purged += 1
            if not dry_run:
                # 1. Update manifest.json if present
                manifest_path = entry / "manifest.json"
                if manifest_path.is_file():
                    try:
                        m_data = json.loads(manifest_path.read_text(encoding="utf-8"))
                        for art in m_data.get("artifacts", []):
                            fn = art.get("file_name") or art.get("fileName")
                            if fn in purged_in_this_run:
                                art["purged"] = True
                        manifest_path.write_text(json.dumps(m_data, indent=2), encoding="utf-8")
                    except Exception as exc:
                        LOGGER.warning("Failed to update manifest.json for %s: %s", run_id, exc)

                # 2. Update SQLite database
                try:
                    db.purge_run_artifacts(run_id, purged_in_this_run, clear_video=video_purged)
                except Exception as exc:
                    LOGGER.warning("Failed to update SQLite for run %s: %s", run_id, exc)

    LOGGER.info(
        "Cleanup finished: scanned=%d, purged_runs=%d, files=%d, bytes_freed=%d, dry_run=%s",
        runs_scanned,
        runs_purged,
        files_purged,
        bytes_freed,
        dry_run,
    )

    return {
        "runs_scanned": runs_scanned,
        "runs_purged": runs_purged,
        "files_purged": files_purged,
        "bytes_freed": bytes_freed,
        "purged_items": purged_items,
        "dry_run": dry_run,
        "cutoff_date": cutoff.isoformat(),
    }


def parse_args(args: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Clean up expired large files from Game QA Dashboard runs."
    )
    parser.add_argument(
        "--days",
        type=int,
        default=DEFAULT_RETENTION_DAYS,
        help=f"Retention period in days (default: {DEFAULT_RETENTION_DAYS}, env: RETENTION_DAYS).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate cleanup without deleting any files.",
    )
    parser.add_argument(
        "--min-size-mb",
        type=float,
        default=None,
        help="Optional minimum file size threshold in MB for non-standard large files.",
    )
    parser.add_argument(
        "--storage-path",
        type=Path,
        default=None,
        help="Override base storage path (default: /data or STORAGE_PATH env).",
    )
    return parser.parse_args(args)


def main() -> None:
    parsed = parse_args()
    runs_dir = (parsed.storage_path / "runs") if parsed.storage_path else RUNS_DIR
    result = cleanup_expired_runs(
        days=parsed.days,
        dry_run=parsed.dry_run,
        min_size_mb=parsed.min_size_mb,
        runs_dir=runs_dir,
    )
    print(
        f"Cleanup complete. Scanned {result['runs_scanned']} runs, "
        f"purged {result['files_purged']} files across {result['runs_purged']} runs. "
        f"Bytes freed: {result['bytes_freed'] / (1024 * 1024):.2f} MB "
        f"{'(DRY RUN)' if result['dry_run'] else ''}"
    )


if __name__ == "__main__":
    main()
