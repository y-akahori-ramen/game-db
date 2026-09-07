"""SQLite database layer (WAL mode) for Game QA Dashboard backend."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator, Optional

LOGGER = logging.getLogger("qa-backend.db")

STORAGE_PATH = Path(os.environ.get("STORAGE_PATH", "/data")).resolve()
DB_PATH = Path(os.environ.get("DB_PATH", STORAGE_PATH / "db" / "qa.db")).resolve()


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """Initialize database tables and indexes if they do not exist."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        conn.executescript(
            """
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;

            -- 1. テスト実行サマリテーブル (検索インデックス)
            CREATE TABLE IF NOT EXISTS test_runs (
                run_id TEXT PRIMARY KEY,
                executed_at TEXT NOT NULL,
                game_version TEXT NOT NULL,
                platform TEXT NOT NULL,
                test_name TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('PASSED', 'FAILED', 'ABORTED')),
                avg_fps REAL,
                min_fps REAL,
                peak_memory_mb REAL,
                git_branch TEXT,
                git_commit TEXT,
                build_id TEXT,
                error_summary TEXT,
                artifacts_json TEXT NOT NULL,
                fps_data_url TEXT,
                memory_data_url TEXT,
                logs_data_url TEXT,
                video_url TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_runs_executed_at ON test_runs(executed_at DESC);
            CREATE INDEX IF NOT EXISTS idx_runs_platform_date ON test_runs(platform, executed_at DESC);
            CREATE INDEX IF NOT EXISTS idx_runs_status_date ON test_runs(status, executed_at DESC);
            CREATE INDEX IF NOT EXISTS idx_runs_test_name ON test_runs(test_name);

            -- 2. API キー管理テーブル
            CREATE TABLE IF NOT EXISTS api_keys (
                key_id TEXT PRIMARY KEY,
                key_hash TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                prefix TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_keys_hash ON api_keys(key_hash);
            CREATE INDEX IF NOT EXISTS idx_keys_email ON api_keys(email);
            """
        )
    LOGGER.info("Database initialized at %s (WAL mode)", DB_PATH)


def row_to_summary(row: sqlite3.Row) -> dict[str, Any]:
    try:
        artifacts = json.loads(row["artifacts_json"]) if row["artifacts_json"] else []
    except Exception:
        artifacts = []

    summary: dict[str, Any] = {
        "runId": row["run_id"],
        "gameVersion": row["game_version"],
        "platform": row["platform"],
        "testName": row["test_name"],
        "status": row["status"],
        "timestamp": row["executed_at"],
        "artifacts": artifacts,
    }
    if row["fps_data_url"]:
        summary["fpsDataUrl"] = row["fps_data_url"]
    if row["memory_data_url"]:
        summary["memoryDataUrl"] = row["memory_data_url"]
    if row["logs_data_url"]:
        summary["logsDataUrl"] = row["logs_data_url"]
    if row["video_url"]:
        summary["videoUrl"] = row["video_url"]
    if row["avg_fps"] is not None:
        summary["avgFps"] = float(row["avg_fps"])
    if row["min_fps"] is not None:
        summary["minFps"] = float(row["min_fps"])
    if row["peak_memory_mb"] is not None:
        summary["peakMemoryMb"] = float(row["peak_memory_mb"])
    if row["git_branch"]:
        summary["gitBranch"] = row["git_branch"]
    if row["git_commit"]:
        summary["gitCommit"] = row["git_commit"]
    if row["build_id"]:
        summary["buildId"] = row["build_id"]
    if row["error_summary"]:
        summary["errorSummary"] = row["error_summary"]
    return summary


def upsert_run(
    run_id: str,
    executed_at: str,
    game_version: str,
    platform: str,
    test_name: str,
    status: str,
    artifacts: list[dict[str, Any]],
    avg_fps: Optional[float] = None,
    min_fps: Optional[float] = None,
    peak_memory_mb: Optional[float] = None,
    git_branch: Optional[str] = None,
    git_commit: Optional[str] = None,
    build_id: Optional[str] = None,
    error_summary: Optional[str] = None,
    fps_data_url: Optional[str] = None,
    memory_data_url: Optional[str] = None,
    logs_data_url: Optional[str] = None,
    video_url: Optional[str] = None,
) -> None:
    artifacts_json = json.dumps(artifacts)
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO test_runs (
                run_id, executed_at, game_version, platform, test_name,
                status, avg_fps, min_fps, peak_memory_mb,
                git_branch, git_commit, build_id, error_summary,
                artifacts_json, fps_data_url, memory_data_url, logs_data_url, video_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(run_id) DO UPDATE SET
                executed_at=excluded.executed_at,
                game_version=excluded.game_version,
                platform=excluded.platform,
                test_name=excluded.test_name,
                status=excluded.status,
                avg_fps=excluded.avg_fps,
                min_fps=excluded.min_fps,
                peak_memory_mb=excluded.peak_memory_mb,
                git_branch=excluded.git_branch,
                git_commit=excluded.git_commit,
                build_id=excluded.build_id,
                error_summary=excluded.error_summary,
                artifacts_json=excluded.artifacts_json,
                fps_data_url=excluded.fps_data_url,
                memory_data_url=excluded.memory_data_url,
                logs_data_url=excluded.logs_data_url,
                video_url=excluded.video_url
            """,
            (
                run_id,
                executed_at,
                game_version,
                platform,
                test_name,
                status,
                avg_fps,
                min_fps,
                peak_memory_mb,
                git_branch,
                git_commit,
                build_id,
                error_summary,
                artifacts_json,
                fps_data_url,
                memory_data_url,
                logs_data_url,
                video_url,
            ),
        )


def get_run_by_id(run_id: str) -> Optional[dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM test_runs WHERE run_id = ?", (run_id,))
        row = cursor.fetchone()
        if not row:
            return None
        return row_to_summary(row)


def search_runs(
    game_version: Optional[str] = None,
    platform: Optional[str] = None,
    test_name: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
) -> list[dict[str, Any]]:
    conditions: list[str] = []
    params: list[Any] = []

    if platform:
        conditions.append("platform = ?")
        params.append(platform)
    if status:
        conditions.append("status = ?")
        params.append(status)
    if test_name:
        conditions.append("test_name LIKE ?")
        params.append(f"%{test_name}%")
    if game_version:
        conditions.append("game_version LIKE ?")
        params.append(f"%{game_version}%")

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sql = f"SELECT * FROM test_runs {where_clause} ORDER BY executed_at DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    with get_db() as conn:
        cursor = conn.execute(sql, params)
        rows = cursor.fetchall()
        return [row_to_summary(row) for row in rows]


def hash_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def list_keys_for_email(email: str) -> list[dict[str, Any]]:
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT key_id, name, email, prefix, created_at, expires_at FROM api_keys WHERE email = ? ORDER BY created_at DESC",
            (email,),
        )
        rows = cursor.fetchall()
        return [
            {
                "keyId": row["key_id"],
                "name": row["name"],
                "email": row["email"],
                "createdAt": row["created_at"],
                "prefix": row["prefix"],
            }
            for row in rows
        ]


def create_api_key(name: str, email: str, expires_at: Optional[str] = None) -> dict[str, Any]:
    raw_secret = secrets.token_hex(24)
    api_key = f"gqa_live_{raw_secret}"
    key_id = f"key_{secrets.token_hex(8)}"
    now_iso = datetime.now(timezone.utc).isoformat()
    key_hash = hash_key(api_key)
    prefix = f"{api_key[:12]}..."

    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO api_keys (key_id, key_hash, name, email, prefix, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (key_id, key_hash, name, email, prefix, now_iso, expires_at),
        )

    LOGGER.info("Issued API key %s for %s (%s)", key_id, email, name)
    return {
        "keyId": key_id,
        "name": name,
        "email": email,
        "createdAt": now_iso,
        "apiKey": api_key,
    }


def delete_api_key(key_id: str, email: str) -> bool:
    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM api_keys WHERE key_id = ? AND email = ?",
            (key_id, email),
        )
        return cursor.rowcount > 0


def verify_api_key(api_key: str) -> Optional[dict[str, Any]]:
    if not api_key:
        return None
    key_hash = hash_key(api_key.strip())
    with get_db() as conn:
        cursor = conn.execute("SELECT * FROM api_keys WHERE key_hash = ?", (key_hash,))
        row = cursor.fetchone()
        if not row:
            return None
        if row["expires_at"]:
            try:
                exp_dt = datetime.fromisoformat(row["expires_at"])
                if exp_dt < datetime.now(timezone.utc):
                    LOGGER.warning("API key %s expired at %s", row["key_id"], row["expires_at"])
                    return None
            except Exception:
                pass
        return dict(row)


def get_runs_older_than(cutoff_iso: str) -> list[dict[str, Any]]:
    """Retrieve test runs executed before the specified ISO timestamp."""
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT * FROM test_runs WHERE executed_at < ? ORDER BY executed_at ASC",
            (cutoff_iso,),
        )
        rows = cursor.fetchall()
        return [row_to_summary(row) for row in rows]


def purge_run_artifacts(
    run_id: str,
    purged_file_names: set[str],
    clear_video: bool = False,
) -> bool:
    """Update SQLite record after artifacts have been purged from disk.

    Marks purged artifacts with 'purged': True and clears video_url if clear_video is True.
    """
    with get_db() as conn:
        cursor = conn.execute(
            "SELECT artifacts_json, video_url FROM test_runs WHERE run_id = ?",
            (run_id,),
        )
        row = cursor.fetchone()
        if not row:
            return False

        try:
            artifacts = json.loads(row["artifacts_json"]) if row["artifacts_json"] else []
        except Exception:
            artifacts = []

        for art in artifacts:
            fn = art.get("fileName")
            if fn in purged_file_names:
                art["purged"] = True

        new_artifacts_json = json.dumps(artifacts)
        if clear_video:
            conn.execute(
                "UPDATE test_runs SET artifacts_json = ?, video_url = NULL WHERE run_id = ?",
                (new_artifacts_json, run_id),
            )
        else:
            conn.execute(
                "UPDATE test_runs SET artifacts_json = ? WHERE run_id = ?",
                (new_artifacts_json, run_id),
            )
        return True
