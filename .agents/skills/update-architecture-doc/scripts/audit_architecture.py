#!/usr/bin/env python3
"""audit_architecture.py - Automated Architecture Document Audit Tool.

Scans the game-db codebase (Backend API routes, SQLite schema, Frontend components & routes,
CLI options, Storage manifest) and compares them against docs/architecture.md.
Reports missing items, outdated component names, and undocumented capabilities.

Usage:
    python .agents/skills/update-architecture-doc/scripts/audit_architecture.py
    # or from repository root:
    python scripts/audit_architecture.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import NamedTuple


def find_repo_root() -> Path:
    """Find repository root by looking for AGENTS.md or .git."""
    curr = Path(__file__).resolve().parent
    while curr != curr.parent:
        if (curr / "AGENTS.md").exists() or (curr / "docs" / "architecture.md").exists():
            return curr
        curr = curr.parent
    raise RuntimeError("Repository root could not be determined")


class AuditResult(NamedTuple):
    category: str
    item: str
    status: str  # "OK" | "MISSING" | "OUTDATED"
    detail: str


def audit_backend_routes(repo_root: Path, doc_text: str) -> list[AuditResult]:
    results: list[AuditResult] = []
    main_py = repo_root / "onprem" / "backend" / "main.py"
    if not main_py.exists():
        return results

    content = main_py.read_text(encoding="utf-8")
    route_pattern = re.compile(r'@app\.(get|post|put|delete)\(\s*["\']([^"\']+)["\']')
    routes = route_pattern.findall(content)

    for method, path in routes:
        m = method.upper()
        # Clean path for matching (e.g. /api/upload/runs/{run_id}/{file_name})
        norm_path = path.split("?")[0]
        # Check if mentioned in doc
        # Handle curly braces or plain path in doc
        path_pattern = re.escape(norm_path).replace(r"\{", r"(\{|:)?").replace(r"\}", r"(\}|)?")
        found = bool(re.search(path_pattern, doc_text)) or norm_path in doc_text

        if found:
            results.append(AuditResult("Backend Route", f"{m} {norm_path}", "OK", "Found in document"))
        else:
            results.append(AuditResult("Backend Route", f"{m} {norm_path}", "MISSING", "Not found in architecture.md"))

    return results


def audit_sqlite_schema(repo_root: Path, doc_text: str) -> list[AuditResult]:
    results: list[AuditResult] = []
    db_py = repo_root / "onprem" / "backend" / "db.py"
    if not db_py.exists():
        return results

    content = db_py.read_text(encoding="utf-8")

    # Columns in test_runs
    expected_columns = [
        "run_id", "executed_at", "game_version", "platform", "test_name", "status",
        "avg_fps", "min_fps", "peak_memory_mb", "duration_seconds", "device_model",
        "triggered_by", "total_size_bytes", "artifacts_json", "fps_data_url",
        "memory_data_url", "logs_data_url", "video_url", "created_at", "updated_at"
    ]
    for col in expected_columns:
        if col in doc_text:
            results.append(AuditResult("SQLite Column (test_runs)", col, "OK", "Found in document"))
        else:
            results.append(AuditResult("SQLite Column (test_runs)", col, "MISSING", "Column not documented"))

    # Indices
    indices = [
        "idx_runs_executed_at", "idx_runs_platform_date", "idx_runs_status_date",
        "idx_runs_version_date", "idx_runs_test_name", "idx_keys_hash", "idx_keys_email"
    ]
    for idx in indices:
        if idx in doc_text:
            results.append(AuditResult("SQLite Index", idx, "OK", "Found in document"))
        else:
            results.append(AuditResult("SQLite Index", idx, "MISSING", "Index not documented"))

    return results


def audit_frontend_components(repo_root: Path, doc_text: str) -> list[AuditResult]:
    results: list[AuditResult] = []
    components_dir = repo_root / "my-qa-dashboard" / "src" / "components"
    if not components_dir.exists():
        return results

    key_components = [
        ("SearchPage", "Main search and test run filter view"),
        ("ComparePage", "Side-by-side run comparison (FPS/Memory diff)"),
        ("TrendsPage", "Multi-run performance & quality trends over time"),
        ("FpsChart", "FPS and frame thread time chart with virtual scrolling"),
        ("MemoryChart", "Memory breakdown chart with timeline synchronization"),
        ("FpsDiffChart", "Comparison diff chart for frame rates"),
        ("MemoryDiffChart", "Comparison diff chart for memory usage"),
        ("LogTable", "UE logs table with virtual scrolling & search"),
        ("MediaViewer", "Multi-media viewer (video & screenshot gallery)"),
        ("ArtifactsPanel", "Artifact download & in-browser client-zip packaging"),
        ("AccessKeyModal", "Personal API key issuance and management modal"),
    ]

    for comp, desc in key_components:
        found = comp in doc_text
        if found:
            results.append(AuditResult("Frontend Component", comp, "OK", desc))
        else:
            # Check for legacy names
            if comp == "MediaViewer" and "VideoPlayer" in doc_text:
                results.append(AuditResult("Frontend Component", comp, "OUTDATED", "Document refers to legacy 'VideoPlayer'"))
            elif comp == "AccessKeyModal" and "ApiKeyModal" in doc_text:
                results.append(AuditResult("Frontend Component", comp, "OUTDATED", "Document refers to legacy 'ApiKeyModal'"))
            else:
                results.append(AuditResult("Frontend Component", comp, "MISSING", desc))

    return results


def audit_frontend_features(repo_root: Path, doc_text: str) -> list[AuditResult]:
    results: list[AuditResult] = []

    features = [
        ("Client Routing (useAppRouter)", ["useAppRouter", "History API", "popstate"], "Deep-linkable client routing"),
        ("Timeline Sync", ["timeline", "タイムライン同期", "双方向同期"], "Sync chart cursor with video playback"),
        ("In-browser ZIP download", ["client-zip", "ZIP一括ダウンロード", "ZIP圧縮"], "Client-side zero-copy artifact bundling"),
        ("Regression Thresholds", ["thresholds", "回帰検知", "しきい値"], "Configurable threshold alerts for FPS/memory drops"),
        ("Code Splitting (lazy/Suspense)", ["lazy", "コード分割", "遅延ロード"], "Dynamic chunk loading for heavy pages"),
    ]

    for name, keywords, desc in features:
        found = any(k.lower() in doc_text.lower() for k in keywords)
        if found:
            results.append(AuditResult("Frontend Feature", name, "OK", desc))
        else:
            results.append(AuditResult("Frontend Feature", name, "MISSING", desc))

    return results


def audit_cli(repo_root: Path, doc_text: str) -> list[AuditResult]:
    results: list[AuditResult] = []
    cli_py = repo_root / "cli" / "qa_upload.py"
    if not cli_py.exists():
        return results

    content = cli_py.read_text(encoding="utf-8")

    cli_items = [
        ("Dual-mode target (On-Prem HTTP & AWS S3)", ["s3_bucket", "s3-bucket", "server-url"], "Supports both HTTP upload and S3"),
        ("Automatic ffmpeg transcoding", ["ffmpeg", "transcode", "faststart", "トランスコード"], "Web video H.264/AAC auto-transcoding"),
        ("Google OAuth 2.0 PKCE login", ["login", "pkce", "token.json"], "CLI login via OAuth 2.0 PKCE"),
        ("Overwrite finalized runs (--overwrite)", ["overwrite", "上書き"], "Conflict override option"),
        ("Artifacts classification v2.0", ["schema_version", "2.0", "artifacts"], "Extended artifact classification"),
    ]

    for name, keywords, desc in cli_items:
        found = any(k.lower() in doc_text.lower() for k in keywords)
        if found:
            results.append(AuditResult("CLI Feature", name, "OK", desc))
        else:
            results.append(AuditResult("CLI Feature", name, "MISSING", desc))

    return results


def audit_infra_status(repo_root: Path, doc_text: str) -> list[AuditResult]:
    results: list[AuditResult] = []
    infra_readme = repo_root / "infra" / "README.md"
    if not infra_readme.exists():
        return results

    content = infra_readme.read_text(encoding="utf-8")
    if "DEPRECATED" in content or "Retired" in content:
        if "CDK" in doc_text and ("廃止" in doc_text or "deprecated" in doc_text.lower() or "retired" in doc_text.lower()):
            results.append(AuditResult("Infra Status", "AWS CDK Deprecation Notice", "OK", "Deprecated status documented"))
        else:
            results.append(AuditResult("Infra Status", "AWS CDK Deprecation Notice", "MISSING", "AWS CDK deprecation / retired status should be noted"))

    return results


def run_audit() -> int:
    repo_root = find_repo_root()
    doc_path = repo_root / "docs" / "architecture.md"
    if not doc_path.exists():
        print(f"Error: {doc_path} not found", file=sys.stderr)
        return 1

    doc_text = doc_path.read_text(encoding="utf-8")

    all_results: list[AuditResult] = []
    all_results.extend(audit_backend_routes(repo_root, doc_text))
    all_results.extend(audit_sqlite_schema(repo_root, doc_text))
    all_results.extend(audit_frontend_components(repo_root, doc_text))
    all_results.extend(audit_frontend_features(repo_root, doc_text))
    all_results.extend(audit_cli(repo_root, doc_text))
    all_results.extend(audit_infra_status(repo_root, doc_text))

    missing_count = sum(1 for r in all_results if r.status in ("MISSING", "OUTDATED"))
    ok_count = sum(1 for r in all_results if r.status == "OK")

    print(f"=== Architecture Document Audit Report: docs/architecture.md ===")
    print(f"Total Checks: {len(all_results)} | OK: {ok_count} | Issues: {missing_count}\n")

    current_category = ""
    for r in all_results:
        if r.category != current_category:
            current_category = r.category
            print(f"\n[{current_category}]")

        mark = "✓" if r.status == "OK" else ("✗" if r.status == "MISSING" else "⚠")
        status_label = f"[{r.status}]"
        print(f"  {mark} {status_label:<10} {r.item:<45} - {r.detail}")

    print("\n" + "=" * 65)
    if missing_count == 0:
        print("✓ All architectural components and features are accurately documented!")
        return 0
    else:
        print(f"⚠ Found {missing_count} discrepancy/discrepancies. Please update docs/architecture.md.")
        return 2


if __name__ == "__main__":
    sys.exit(run_audit())
