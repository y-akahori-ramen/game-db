# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pandas",
#     "numpy",
# ]
# ///
"""Generate dummy QA metrics per test run into public/sample_data/run-XXX/,
plus the mock search index public/mock_data/runs.json.

CSV/JSON (not Parquet) matches how UE itself outputs FPS/memory stats and keeps
the format consistent with the log data, which is also handled as raw text.
run-003 uses JSON to exercise the read_json_auto loading path in the app.

Log sample data is public/sample_data/samplelog.log (a real UE log file), not
generated here; every run points at it.

Run with: uv run scripts/generate_sample_data.py
"""

import json
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"
SAMPLE_DIR = PUBLIC_DIR / "sample_data"
MOCK_DIR = PUBLIC_DIR / "mock_data"
DURATION_SEC = 300
SAMPLE_HZ = 2  # 2 samples per second

rng = np.random.default_rng(42)
random.seed(42)


@dataclass(frozen=True)
class RunSpec:
    run_id: str
    game_version: str
    platform: str
    test_name: str
    status: str  # PASSED | FAILED
    timestamp: str
    fmt: str  # csv | json
    base_fps: float
    drops: list[tuple[int, int, int]]  # (start_sec, length_sec, floor_fps)
    levels: list[str] = field(default_factory=lambda: ["PL_Level1", "PL_Level2"])


RUNS = [
    RunSpec(
        run_id="run-001",
        game_version="v1.2.0",
        platform="PS5",
        test_name="Level1_Playthrough",
        status="FAILED",
        timestamp="2026-08-01T10:15:00Z",
        fmt="csv",
        base_fps=55,
        drops=[(60, 8, 22), (145, 5, 15), (230, 12, 25)],
    ),
    RunSpec(
        run_id="run-002",
        game_version="v1.2.0",
        platform="Windows",
        test_name="Boss_Battle_Stress",
        status="PASSED",
        timestamp="2026-08-01T14:40:00Z",
        fmt="csv",
        base_fps=58,
        drops=[(120, 4, 35)],
    ),
    RunSpec(
        run_id="run-003",
        game_version="v1.3.0-beta",
        platform="iOS",
        test_name="Level1_Playthrough",
        status="PASSED",
        timestamp="2026-08-02T09:05:00Z",
        fmt="json",
        base_fps=29,
        drops=[(90, 6, 12), (200, 10, 15)],
    ),
]


def generate_fps(spec: RunSpec) -> pd.DataFrame:
    """Build a frame-by-frame FPS table matching UE's Stat/CSV output shape
    (see my-qa-dashboard/sample/fpssample.csv). Columns beyond the common set
    (log_time, frame, X, Y, Z, FPS, ActorName) are project-specific extras
    that the dashboard ignores; only PersistentLevel, FPSMs, GameThread,
    RenderThread, GPUFrame, RHIThreadTime and ElapsedTime are read.
    """
    n = DURATION_SEC * SAMPLE_HZ
    t = np.arange(n) / SAMPLE_HZ
    # Base fps with slow oscillation and noise
    fps = spec.base_fps + 4 * np.sin(t / 20) + rng.normal(0, 1.5, n)
    # Inject drop windows (heavy scenes)
    for start, length, floor in spec.drops:
        idx = (t >= start) & (t < start + length)
        fps[idx] = floor + rng.normal(0, 3, idx.sum())
    # Random single-frame spikes
    spikes = rng.choice(n, size=10, replace=False)
    fps[spikes] -= rng.uniform(10, spec.base_fps * 0.5, 10)
    fps = np.clip(fps, 5, spec.base_fps * 1.15)
    fps_ms = 1000.0 / fps

    # Split frame time across thread stats, each a plausible share of FPSMs.
    game_thread = fps_ms * rng.uniform(0.35, 0.45, n)
    render_thread = fps_ms * rng.uniform(0.25, 0.35, n)
    gpu_frame = fps_ms * rng.uniform(0.5, 0.65, n)
    rhi_thread_time = fps_ms * rng.uniform(0.1, 0.2, n)

    # ElapsedTime is the cumulative wall-clock time (sec) implied by each
    # frame's own duration, mirroring how UE stamps frames.
    elapsed_time = np.cumsum(fps_ms) / 1000.0

    # PersistentLevel switches once partway through the run, e.g. streaming
    # into a second level.
    switch_at = elapsed_time[-1] / 2
    persistent_level = np.where(elapsed_time < switch_at, spec.levels[0], spec.levels[-1])

    start_dt = datetime(2026, 7, 31, 5, 8, 44)
    log_time = [
        (start_dt + timedelta(seconds=float(s))).strftime("%Y.%m.%d-%H.%M.%S:") + f"{int((s % 1) * 1000):03d}"
        for s in elapsed_time
    ]
    frame = (np.arange(n) * 2 + 262).astype(np.int64)

    return pd.DataFrame(
        {
            "log_time": log_time,
            "frame": frame,
            "PersistentLevel": persistent_level,
            "X": 0.0,
            "Y": 0.0,
            "Z": 0.0,
            "FPS": fps.round(6),
            "FPSMs": fps_ms.round(6),
            "GameThread": game_thread.round(6),
            "RenderThread": render_thread.round(6),
            "GPUFrame": gpu_frame.round(6),
            "RHIThreadTime": rhi_thread_time.round(6),
            "ActorName": "",
            "ElapsedTime": elapsed_time.round(6),
        }
    )


def generate_memory(spec: RunSpec) -> pd.DataFrame:
    n = DURATION_SEC * SAMPLE_HZ
    t = np.arange(n) / SAMPLE_HZ
    # Mobile-ish budgets for iOS, desktop/console otherwise
    ram_base, vram_base, heap_base = (
        (1200, 1500, 300) if spec.platform == "iOS" else (2048, 3000, 512)
    )
    # Gradually increasing RAM with GC-like drops
    ram = ram_base + t * 2.5 + rng.normal(0, 20, n)
    for gc_at in [90, 180, 260]:
        ram[t >= gc_at] -= 150
    vram = vram_base + 300 * np.sin(t / 40) + t * 1.2 + rng.normal(0, 30, n)
    heap = heap_base + t * 1.8 + rng.normal(0, 10, n)
    for gc_at in [70, 140, 210, 280]:
        heap[t >= gc_at] -= 80
    return pd.DataFrame(
        {
            "timestamp": t.astype(np.float64),
            "vram_mb": np.clip(vram, 0, None).round(1),
            "ram_mb": np.clip(ram, 0, None).round(1),
            "heap_mb": np.clip(heap, 0, None).round(1),
        }
    )


def write_metrics(df: pd.DataFrame, path: Path) -> None:
    if path.suffix == ".json":
        path.write_text(json.dumps(df.to_dict(orient="records")), encoding="utf-8")
    else:
        df.to_csv(path, index=False)
    print(f"wrote {path} ({len(df)} rows)")


def main() -> None:
    MOCK_DIR.mkdir(parents=True, exist_ok=True)
    summaries = []
    for spec in RUNS:
        run_dir = SAMPLE_DIR / spec.run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        fps_name = f"fps_metrics.{spec.fmt}"
        memory_name = f"memory_metrics.{spec.fmt}"
        write_metrics(generate_fps(spec), run_dir / fps_name)
        write_metrics(generate_memory(spec), run_dir / memory_name)
        # URLs are BASE_URL-relative (no leading slash), matching TestRunSummary
        # in src/services/SearchService.ts.
        summaries.append(
            {
                "runId": spec.run_id,
                "gameVersion": spec.game_version,
                "platform": spec.platform,
                "testName": spec.test_name,
                "status": spec.status,
                "timestamp": spec.timestamp,
                "fpsDataUrl": f"sample_data/{spec.run_id}/{fps_name}",
                "memoryDataUrl": f"sample_data/{spec.run_id}/{memory_name}",
                "logsDataUrl": "sample_data/samplelog.log",
            }
        )
    runs_json = MOCK_DIR / "runs.json"
    runs_json.write_text(json.dumps(summaries, indent=2), encoding="utf-8")
    print(f"wrote {runs_json} ({len(summaries)} runs)")


if __name__ == "__main__":
    main()
